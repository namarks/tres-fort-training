// Connect links (bring-your-own-ai-coach P10): after the member allows sharing
// with Claude in the app, the app hands Claude an MCP URL carrying a one-time
// connect code. Claude's sign-in then completes without another Très Fort page.
import { applyD1Migrations, env, SELF } from 'cloudflare:test';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { issueAppJwt } from '../src/auth';
import { oauthTokenDigest } from '../src/credentials';
import { createCoachConnectCode } from '../src/db';

const BASE = 'https://tres-fort.test';
const CLAUDE = 'https://claude.ai/api/mcp/auth_callback';
const CHATGPT = 'https://chatgpt.com/connector/oauth/test-callback';
const MEMBER = '6b1f8e43-1c8d-4b1e-9a51-3f8f3a0c2d17';
let jwt: string;

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
  await env.DB.prepare('INSERT INTO users (id, apple_sub, created_at) VALUES (?1, ?2, ?3)')
    .bind(MEMBER, 'connect-link-member', Date.now()).run();
  jwt = await issueAppJwt(MEMBER, env.APP_JWT_SECRET);
});

async function newLink(): Promise<string> {
  const response = await SELF.fetch(`${BASE}/api/me/mcp-passphrase`, {
    method: 'POST', headers: { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' }, body: '{}',
  });
  expect(response.status).toBe(200);
  const { code } = await response.json<{ code: string }>();
  return `${BASE}/mcp/c/${code}`;
}

async function client(redirect = CLAUDE) {
  const registered = await SELF.fetch(`${BASE}/oauth/register`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_name: 'Claude', redirect_uris: [redirect] }),
  });
  const { client_id } = await registered.json<{ client_id: string }>();
  const verifier = crypto.randomUUID() + crypto.randomUUID();
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  const challenge = btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return { client_id, verifier, challenge, redirect };
}

type Client = Awaited<ReturnType<typeof client>>;

function authorize(c: Client, resource: string, extra: Record<string, string> = {}) {
  const params = new URLSearchParams({ client_id: c.client_id, redirect_uri: c.redirect, response_type: 'code',
    code_challenge_method: 'S256', code_challenge: c.challenge, resource, scope: 'mcp', state: 'claude-state', ...extra });
  return SELF.fetch(`${BASE}/oauth/authorize?${params}`, { redirect: 'manual' });
}

function token(c: Client, body: Record<string, string>, resource: string) {
  return SELF.fetch(`${BASE}/oauth/token`, { method: 'POST', body: new URLSearchParams({
    client_id: c.client_id, resource, ...body,
  }) });
}

const codes = () => env.DB.prepare('SELECT COUNT(*) AS n FROM coach_connect_codes WHERE user_id = ?1').bind(MEMBER).first('n');

describe('connect links', () => {
  it('point an unauthenticated MCP call at metadata naming the link as the resource', async () => {
    const link = await newLink();
    const unauthorized = await SELF.fetch(link, { method: 'POST', body: '{}' });
    expect(unauthorized.status).toBe(401);
    const header = unauthorized.headers.get('www-authenticate')!;
    const metadataURL = /resource_metadata="([^"]+)"/.exec(header)![1]!;
    expect(metadataURL).toBe(`${BASE}/.well-known/oauth-protected-resource${new URL(link).pathname}`);
    const metadata = await (await SELF.fetch(metadataURL)).json<{ resource: string; authorization_servers: string[] }>();
    expect(metadata).toMatchObject({ resource: link, authorization_servers: [BASE] });
    // Looking at the metadata neither spends nor checks the code.
    expect(await codes()).toBe(1);
    // The plain endpoint is unchanged.
    const plain = await SELF.fetch(`${BASE}/mcp`, { method: 'POST', body: '{}' });
    expect(plain.headers.get('www-authenticate')).toContain(`${BASE}/.well-known/oauth-protected-resource"`);
    expect((await SELF.fetch(`${BASE}/.well-known/oauth-protected-resource/mcp/c/short`)).status).toBe(404);
  });

  it('send Claude straight back with a code for the member who made the link, once', async () => {
    const link = await newLink();
    const claude = await client();
    const response = await authorize(claude, link);
    expect(response.status).toBe(302);
    const callback = new URL(response.headers.get('location')!);
    expect(callback.origin + callback.pathname).toBe(CLAUDE);
    expect(callback.searchParams.get('state')).toBe('claude-state');
    const code = callback.searchParams.get('code')!;
    expect(await env.DB.prepare('SELECT user_id, resource FROM oauth_codes WHERE code = ?1').bind(code).first())
      .toEqual({ user_id: MEMBER, resource: `${BASE}/mcp` });
    expect(await codes()).toBe(0);
    expect(await env.DB.prepare(`SELECT COUNT(*) AS n FROM audit_log
      WHERE user_id = ?1 AND tool = 'approve_coach_connection' AND result = 'connect_link'`).bind(MEMBER).first('n')).toBe(1);

    expect((await token(claude, { grant_type: 'authorization_code', code, redirect_uri: CLAUDE, code_verifier: 'wrong' }, link)).status).toBe(400);
    const exchanged = await token(claude, { grant_type: 'authorization_code', code, redirect_uri: CLAUDE, code_verifier: claude.verifier }, link);
    expect(exchanged.status).toBe(200);
    const tokens = await exchanged.json<{ access_token: string; refresh_token: string }>();
    expect(await env.DB.prepare('SELECT user_id FROM oauth_tokens WHERE access_token = ?1')
      .bind(await oauthTokenDigest(tokens.access_token)).first('user_id')).toBe(MEMBER);

    // Claude keeps calling the link's URL with the bearer, and refreshes with it as the resource.
    const call = await SELF.fetch(link, { method: 'POST',
      headers: { Authorization: `Bearer ${tokens.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) });
    expect(call.status).toBe(200);
    expect((await call.json<any>()).result.tools.length).toBeGreaterThan(10);
    const refreshed = await token(claude, { grant_type: 'refresh_token', refresh_token: tokens.refresh_token }, link);
    expect(refreshed.status).toBe(200);

    // A spent link signs in the ordinary way: the page with phone approval.
    const again = await authorize(await client(), link);
    expect(again.status).toBe(200);
    const html = await again.text();
    expect(html).toContain('Open Très Fort to review access');
    expect(html).not.toContain(new URL(link).pathname.slice(7));
  });

  it('only finish for Claude, leaving the code for Claude when another app tries it', async () => {
    const link = await newLink();
    const other = await authorize(await client(CHATGPT), link);
    expect(other.status).toBe(200);
    expect(await other.text()).toContain('Connect Très Fort');
    expect(await codes()).toBe(1);
    expect((await authorize(await client(), link)).status).toBe(302);
  });

  it('fall back to the page when the link has expired', async () => {
    const link = await newLink();
    await env.DB.prepare('UPDATE coach_connect_codes SET expires_at = ?2 WHERE user_id = ?1').bind(MEMBER, Date.now() - 1).run();
    const response = await authorize(await client(), link);
    expect(response.status).toBe(200);
    expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM oauth_codes').first('n')).toBe(0);
  });

  it('refuse other resources under the endpoint and never log a link code', async () => {
    const claude = await client();
    for (const resource of [`${BASE}/mcp/c/short`, `${BASE}/mcp/other`, `${BASE}/mcp/c/${'a'.repeat(43)}/x`, `https://other.test/mcp`]) {
      expect((await authorize(claude, resource)).status).toBe(400);
    }
    const link = await newLink();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      expect((await authorize(claude, link, { scope: 'admin' })).status).toBe(400);
      const logged = JSON.stringify(warn.mock.calls);
      expect(logged).toContain('/mcp/c/[link]');
      expect(logged).not.toContain(new URL(link).pathname.slice(7));
    } finally {
      warn.mockRestore();
    }
    expect(await codes()).toBe(1);
  });

  it('is the same one-time code the connect-code form accepts', async () => {
    const { code } = await createCoachConnectCode(env.DB, MEMBER);
    const response = await authorize(await client(), `${BASE}/mcp/c/${code}`);
    expect(response.status).toBe(302);
  });
});
