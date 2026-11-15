import { env, applyD1Migrations, SELF } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';

import { authorizeReviewConnectCode, createCoachConnectCode, ensureOwnerUser } from '../src/db';

// Bindings from vitest.config.ts.
const REVIEW_CODE = 'test-review-code-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const REVIEW_USER = 'directory-review-member';
const BASE = 'https://tres-fort.test';
const REDIRECT = 'https://claude.ai/api/mcp/auth_callback';

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});

async function addUser(id: string) {
  // The owner exists first, as in production; with no OWNER_APPLE_SUB the
  // earliest account is the owner, which the review code must never reach.
  await ensureOwnerUser(env.DB, env.OWNER_APPLE_SUB);
  await env.DB.prepare('INSERT INTO users (id,apple_sub,created_at) VALUES (?1,?1,?2)').bind(id, Date.now()).run();
}

async function pkce() {
  const verifier = 'verifier-' + crypto.randomUUID() + crypto.randomUUID();
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  const challenge = btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return { verifier, challenge };
}

async function registerClient() {
  const reg = await SELF.fetch(`${BASE}/oauth/register`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ redirect_uris: [REDIRECT], client_name: 'Claude' }),
  });
  return (await reg.json<{ client_id: string }>()).client_id;
}

/** Submits the consent form with a connect code; returns the bound user, or the refusal status. */
async function connectWith(connectCode: string): Promise<{ status: number; userId?: string }> {
  const client_id = await registerClient();
  const { verifier, challenge } = await pkce();
  const form = new FormData();
  form.set('client_id', client_id);
  form.set('redirect_uri', REDIRECT);
  form.set('code_challenge', challenge);
  form.set('scope', 'mcp');
  form.set('passphrase', connectCode);
  const authorized = await SELF.fetch(`${BASE}/oauth/authorize`, { method: 'POST', body: form, redirect: 'manual' });
  if (authorized.status !== 302) return { status: authorized.status };
  const code = new URL(authorized.headers.get('location')!).searchParams.get('code')!;
  const token = new FormData();
  token.set('grant_type', 'authorization_code');
  token.set('code', code);
  token.set('redirect_uri', REDIRECT);
  token.set('client_id', client_id);
  token.set('code_verifier', verifier);
  const tokens = await (await SELF.fetch(`${BASE}/oauth/token`, { method: 'POST', body: token })).json<any>();
  const row = await env.DB.prepare('SELECT user_id FROM oauth_tokens WHERE refresh_token IS NOT NULL ORDER BY rowid DESC LIMIT 1')
    .first<{ user_id: string }>();
  expect(tokens.token_type).toBe('Bearer');
  return { status: 302, userId: row!.user_id };
}

const grant = () => ({
  code: crypto.randomUUID().replace(/-/g, ''), client_id: 'client', redirect_uri: REDIRECT,
  code_challenge: 'challenge', scope: 'mcp', resource: null, expires_at: Date.now() + 600_000,
});

describe('standing review connect code', () => {
  it('connects the synthetic review member repeatedly, and only that member', async () => {
    await addUser(REVIEW_USER);
    expect(await connectWith(REVIEW_CODE)).toEqual({ status: 302, userId: REVIEW_USER });
    // Reusable, unlike a member's one-time code.
    expect(await connectWith(REVIEW_CODE)).toEqual({ status: 302, userId: REVIEW_USER });
    expect((await connectWith(REVIEW_CODE.slice(0, -1) + 'b')).status).toBe(401);
  });

  it('leaves member connect codes working as before', async () => {
    await addUser(REVIEW_USER);
    const owner = (await ensureOwnerUser(env.DB, env.OWNER_APPLE_SUB))!;
    const { code } = await createCoachConnectCode(env.DB, owner.id);
    expect(await connectWith(code)).toEqual({ status: 302, userId: owner.id });
    expect((await connectWith(code)).status).toBe(401);
  });

  it('never reaches the owner, even when it is the configured review member', async () => {
    const owner = (await ensureOwnerUser(env.DB, env.OWNER_APPLE_SUB))!;
    expect(await authorizeReviewConnectCode(env.DB, { code: REVIEW_CODE, userId: owner.id, ownerUserId: owner.id },
      REVIEW_CODE, grant())).toBe(false);
  });

  it('refuses an account that could hold someone else\'s data', async () => {
    const config = { code: REVIEW_CODE, userId: REVIEW_USER, ownerUserId: null as string | null };
    const attempt = (c = config) => authorizeReviewConnectCode(env.DB, c, REVIEW_CODE, grant());

    expect(await attempt()).toBe(false); // the review member doesn't exist yet
    await addUser(REVIEW_USER);
    expect(await attempt()).toBe(true);

    expect(await attempt({ ...config, ownerUserId: REVIEW_USER })).toBe(false);

    const ts = Date.now();
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO groups (id,name,created_by,created_at) VALUES ('g-review','Crew',?1,?2)`).bind(REVIEW_USER, ts),
      env.DB.prepare(`INSERT INTO group_members (group_id,user_id,joined_at) VALUES ('g-review',?1,?2)`).bind(REVIEW_USER, ts),
    ]);
    expect(await attempt()).toBe(false);
    await env.DB.prepare('DELETE FROM group_members WHERE user_id=?1').bind(REVIEW_USER).run();
    expect(await attempt()).toBe(true);

    await env.DB.prepare(`INSERT INTO external_activities (id,user_id,source,external_id,date,kind,synced_at)
      VALUES ('a-review',?1,'healthkit','hk-1','2026-11-01','run',?2)`).bind(REVIEW_USER, ts).run();
    expect(await attempt()).toBe(false);
    await env.DB.prepare('DELETE FROM external_activities WHERE user_id=?1').bind(REVIEW_USER).run();

    await env.DB.prepare(`UPDATE users SET intervals_api_key='sealed:v1:x' WHERE id=?1`).bind(REVIEW_USER).run();
    expect(await attempt()).toBe(false);
  });

  it('is off unless both values are set and the code is long enough', async () => {
    await addUser(REVIEW_USER);
    const run = (code: string | undefined, userId: string | undefined, submitted = REVIEW_CODE) =>
      authorizeReviewConnectCode(env.DB, { code, userId, ownerUserId: null }, submitted, grant());
    expect(await run(undefined, REVIEW_USER)).toBe(false);
    expect(await run(REVIEW_CODE, undefined)).toBe(false);
    expect(await run('short-code', REVIEW_USER, 'short-code')).toBe(false);
    expect(await run(REVIEW_CODE, REVIEW_USER, '')).toBe(false);
    expect(await run(REVIEW_CODE, REVIEW_USER)).toBe(true);
  });
});
