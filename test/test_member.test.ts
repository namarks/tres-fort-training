// POST/DELETE /api/me/test-member — the owner's throwaway account for trying
// the new-member setup on their own phone. Only the owner may create one,
// at most one exists, and DELETE removes only a test member.
import { env, applyD1Migrations, SELF } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { issueAppJwt } from '../src/auth';
import { TEST_MEMBER_APPLE_SUB_PREFIX, testMemberDeletionKey } from '../src/db';

const BASE = 'https://lift-coach.test';
const auth = (jwt: string) => ({ Authorization: `Bearer ${jwt}` });

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});

async function owner(): Promise<{ id: string; jwt: string }> {
  const r = await SELF.fetch(`${BASE}/auth/dev`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ secret: 'test-dev' }),
  });
  expect(r.status).toBe(200);
  const body = await r.json<{ jwt: string; user: { id: string } }>();
  return { id: body.user.id, jwt: body.jwt };
}

async function member(): Promise<{ id: string; jwt: string }> {
  const id = crypto.randomUUID();
  await env.DB.prepare(
    'INSERT INTO users (id,apple_sub,email,display_name,created_at) VALUES (?1,?2,?3,?4,?5)',
  )
    .bind(id, `sub-member-${id}`, 'member@test', 'Member', Date.now())
    .run();
  return { id, jwt: await issueAppJwt(id, 'test-secret') };
}

async function create(jwt: string) {
  return SELF.fetch(`${BASE}/api/me/test-member`, { method: 'POST', headers: auth(jwt) });
}

async function remove(jwt: string) {
  return SELF.fetch(`${BASE}/api/me/test-member`, { method: 'DELETE', headers: auth(jwt) });
}

async function testMemberIds(): Promise<string[]> {
  const rows = await env.DB.prepare(
    'SELECT id FROM users WHERE substr(apple_sub, 1, ?2) = ?1',
  )
    .bind(TEST_MEMBER_APPLE_SUB_PREFIX, TEST_MEMBER_APPLE_SUB_PREFIX.length)
    .all<{ id: string }>();
  return rows.results.map((r) => r.id);
}

describe('owner test member', () => {
  it('lets the owner create a fresh, empty account with its own session', async () => {
    const o = await owner();
    const r = await create(o.jwt);
    expect(r.status).toBe(201);
    const body = await r.json<{ jwt: string; user: { id: string; email: string | null; display_name: string } }>();
    expect(body.user.id).not.toBe(o.id);
    expect(body.user).toEqual({ id: body.user.id, email: null, display_name: 'Test member' });
    expect(await testMemberIds()).toEqual([body.user.id]);

    // The bearer is the test member's, and it looks like a brand-new account.
    const me = await SELF.fetch(`${BASE}/api/me`, { headers: auth(body.jwt) });
    expect(me.status).toBe(200);
    const profile = await me.json<any>();
    expect(profile.display_name).toBe('Test member');
    expect(profile.coach.is_owner).toBe(false);
    const state = await SELF.fetch(`${BASE}/api/state`, { headers: auth(body.jwt) });
    expect(state.status).toBe(200);
    const s = await state.json<any>();
    expect(s.plan).toBeNull();
    expect(s.sessions).toEqual([]);

    // The owner's own session keeps working.
    const ownerMe = await SELF.fetch(`${BASE}/api/me`, { headers: auth(o.jwt) });
    expect((await ownerMe.json<any>()).coach.is_owner).toBe(true);

    const audit = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM audit_log WHERE user_id = ?1 AND tool = 'create_test_member'",
    )
      .bind(o.id)
      .first<{ n: number }>();
    expect(audit?.n).toBe(1);
  });

  it('replaces an earlier test member and revokes its session', async () => {
    const o = await owner();
    const first = await (await create(o.jwt)).json<{ jwt: string; user: { id: string } }>();
    const second = await (await create(o.jwt)).json<{ jwt: string; user: { id: string } }>();
    expect(second.user.id).not.toBe(first.user.id);
    expect(await testMemberIds()).toEqual([second.user.id]);
    const stale = await SELF.fetch(`${BASE}/api/me`, { headers: auth(first.jwt) });
    expect(stale.status).toBe(401);
  });

  it('finishes an interrupted test-member deletion on the next create', async () => {
    const o = await owner();
    const first = await (await create(o.jwt)).json<{ jwt: string; user: { id: string } }>();
    // A deletion whose intent committed but whose cleanup never ran.
    const digest = await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(testMemberDeletionKey(first.user.id)),
    );
    const keyHash = [...new Uint8Array(digest)]
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
    await env.DB.prepare(
      `INSERT INTO account_deletion_intents
         (user_id, idempotency_key_sha256, apple_revocation, created_at)
       VALUES (?1, ?2, NULL, ?3)`,
    )
      .bind(first.user.id, keyHash, Date.now())
      .run();
    // Its own session is already revoked, so the app treats it as gone.
    expect((await remove(first.jwt)).status).toBe(401);

    const second = await (await create(o.jwt)).json<{ user: { id: string } }>();
    expect(await testMemberIds()).toEqual([second.user.id]);
  });

  it('keeps only the newest test member when creates overlap', async () => {
    const o = await owner();
    // Another device's create that inserted its row after this one's.
    const other = crypto.randomUUID();
    await env.DB.prepare(
      'INSERT INTO users (id,apple_sub,email,display_name,created_at) VALUES (?1,?2,NULL,?3,?4)',
    )
      .bind(other, `${TEST_MEMBER_APPLE_SUB_PREFIX}${other}`, 'Test member', Date.now() + 60_000)
      .run();
    const r = await create(o.jwt);
    expect(r.status).toBe(409);
    expect(await testMemberIds()).toEqual([other]);
  });

  it('answers 404 to anyone but the owner, including a test member', async () => {
    await owner();
    const m = await member();
    expect((await create(m.jwt)).status).toBe(404);
    expect(await testMemberIds()).toEqual([]);

    const o = await owner();
    const t = await (await create(o.jwt)).json<{ jwt: string }>();
    expect((await create(t.jwt)).status).toBe(404);
    expect((await testMemberIds()).length).toBe(1);
  });

  it('lets a test member delete itself, revoking its session', async () => {
    const o = await owner();
    const t = await (await create(o.jwt)).json<{ jwt: string; user: { id: string } }>();
    const r = await remove(t.jwt);
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true });
    expect(await testMemberIds()).toEqual([]);
    expect((await SELF.fetch(`${BASE}/api/me`, { headers: auth(t.jwt) })).status).toBe(401);
    // The owner is untouched.
    expect((await SELF.fetch(`${BASE}/api/me`, { headers: auth(o.jwt) })).status).toBe(200);
  });

  it('never deletes a real account through the test-member route', async () => {
    const o = await owner();
    const m = await member();
    expect((await remove(o.jwt)).status).toBe(404);
    expect((await remove(m.jwt)).status).toBe(404);
    const live = await env.DB.prepare('SELECT COUNT(*) AS n FROM users WHERE id IN (?1, ?2)')
      .bind(o.id, m.id)
      .first<{ n: number }>();
    expect(live?.n).toBe(2);
  });
});
