// Member usage (docs/DIAGNOSTICS.md, "Members", migration 0078): which app
// build each member runs, when they last used Tres Fort, and which features
// they use, read only by the owner's own app session.
import { env, applyD1Migrations, SELF } from 'cloudflare:test';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { issueAppJwt } from '../src/auth';
import { deleteUserAccount, exportUserData, parseIosUserAgent, recordAppUse, resetAppUseThrottle } from '../src/db';
import { memberUsageDays } from '../src/services/memberUsage';

const BASE = 'https://tres-fort.test';
const TOKEN = 'test-diagnostics-token-0123456789abcdef';
const TODAY = new Date().toISOString().slice(0, 10);
const UA_81 = 'TresFort/81 CFNetwork/3826.500.111 Darwin/25.1.0';
const UA_70 = 'TresFort/70 CFNetwork/1568.100.1 Darwin/24.4.0';

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});

beforeEach(() => resetAppUseThrottle());

async function ownerJwt(): Promise<{ id: string; jwt: string }> {
  const r = await SELF.fetch(`${BASE}/auth/dev`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ secret: 'test-dev' }),
  });
  expect(r.status).toBe(200);
  const body = await r.json<{ jwt: string; user: { id: string } }>();
  return { id: body.user.id, jwt: body.jwt };
}

async function member(name = 'Member'): Promise<{ id: string; jwt: string; webJwt: string }> {
  await ownerJwt();
  const id = crypto.randomUUID();
  await env.DB.prepare('INSERT INTO users (id,apple_sub,display_name,created_at) VALUES (?1,?1,?2,?3)')
    .bind(id, name, Date.now()).run();
  return {
    id,
    jwt: await issueAppJwt(id, 'test-secret'),
    webJwt: await issueAppJwt(id, 'test-secret', { client: 'web' }),
  };
}

const get = (path: string, jwt: string, userAgent?: string) => SELF.fetch(`${BASE}${path}`, {
  headers: { Authorization: `Bearer ${jwt}`, ...(userAgent ? { 'User-Agent': userAgent } : {}) },
});

const appUse = async (userId: string) => (await env.DB
  .prepare('SELECT client, build, os_version, first_seen_at, last_seen_at FROM member_app_use WHERE user_id = ?1 ORDER BY client, build')
  .bind(userId).all<Record<string, unknown>>()).results;

async function members(jwt: string, days?: number) {
  const r = await get(`/api/me/diagnostics/members${days ? `?days=${days}` : ''}`, jwt);
  return { status: r.status, body: r.status === 200 ? await r.json<any>() : null, cache: r.headers.get('Cache-Control') };
}

describe('reading the app build from the User-Agent', () => {
  it('reads the build and iOS version every build sends', () => {
    expect(parseIosUserAgent(UA_81)).toEqual({ build: '81', osVersion: 'iOS 26.1' });
    expect(parseIosUserAgent(UA_70)).toEqual({ build: '70', osVersion: 'iOS 18.4' });
    expect(parseIosUserAgent('TresFortWidgets/82 CFNetwork/1568 Darwin/23.6.0')).toEqual({ build: '82', osVersion: 'iOS 17.6' });
    expect(parseIosUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 18_4 like Mac OS X)')).toEqual({ build: null, osVersion: null });
    expect(parseIosUserAgent('curl/8.5.0')).toEqual({ build: null, osVersion: null });
    expect(parseIosUserAgent(undefined)).toEqual({ build: null, osVersion: null });
  });

  it('reads day windows', () => {
    expect(memberUsageDays(undefined)).toBe(30);
    expect(memberUsageDays('365')).toBe(365);
    for (const value of ['0', '366', 'x', '1.5', '-1']) expect(memberUsageDays(value)).toBeNull();
  });
});

describe('recording app use', () => {
  it('keeps each build a member runs, the web and coach clients, and the days', async () => {
    const m = await member();
    expect((await get('/api/me', m.jwt, UA_70)).status).toBe(200);
    expect((await get('/api/me', m.jwt, UA_81)).status).toBe(200);
    expect((await get('/api/me', m.webJwt, 'Mozilla/5.0')).status).toBe(200);
    const rows = await appUse(m.id);
    expect(rows.map((r) => [r.client, r.build, r.os_version])).toEqual([
      ['ios', '70', 'iOS 18.4'],
      ['ios', '81', 'iOS 26.1'],
      ['web', '', null],
    ]);
    const days = await env.DB.prepare('SELECT day, client FROM member_active_days WHERE user_id = ?1 ORDER BY client')
      .bind(m.id).all();
    expect(days.results).toEqual([{ day: TODAY, client: 'ios' }, { day: TODAY, client: 'web' }]);
  });

  it('writes at most once every few minutes, and only moves forward', async () => {
    const m = await member();
    await recordAppUse(env.DB, m.id, 'ios', UA_81, 1_000_000);
    await recordAppUse(env.DB, m.id, 'ios', UA_81, 1_060_000);
    expect((await appUse(m.id))[0]).toMatchObject({ first_seen_at: 1_000_000, last_seen_at: 1_000_000 });
    await recordAppUse(env.DB, m.id, 'ios', UA_81, 1_400_000);
    expect((await appUse(m.id))[0]).toMatchObject({ first_seen_at: 1_000_000, last_seen_at: 1_400_000 });
    resetAppUseThrottle();
    await recordAppUse(env.DB, m.id, 'ios', UA_81, 1_200_000);
    expect((await appUse(m.id))[0]).toMatchObject({ last_seen_at: 1_400_000 });
  });

  it('records the first use after UTC midnight even inside the throttle', async () => {
    const m = await member();
    const midnight = Date.parse('2026-11-14T00:00:00Z');
    await recordAppUse(env.DB, m.id, 'ios', UA_81, midnight - 60_000);
    await recordAppUse(env.DB, m.id, 'ios', UA_81, midnight + 60_000);
    const days = await env.DB.prepare('SELECT day FROM member_active_days WHERE user_id = ?1 ORDER BY day')
      .bind(m.id).all<{ day: string }>();
    expect(days.results.map((r) => r.day)).toEqual(['2026-11-13', '2026-11-14']);
    expect((await appUse(m.id))[0]).toMatchObject({ last_seen_at: midnight + 60_000 });
  });

  it('never fails a request when the write fails', async () => {
    const broken = {
      prepare: () => ({ bind: () => ({}) }),
      batch: async () => { throw new Error('no such table: member_app_use'); },
    } as unknown as D1Database;
    await expect(recordAppUse(broken, 'someone', 'ios', UA_81)).resolves.toBeUndefined();
  });

  it('records an AI coaching connection', async () => {
    const owner = await ownerJwt();
    const r = await SELF.fetch(`${BASE}/mcp`, {
      method: 'POST',
      headers: { Authorization: 'Bearer test-mcp-token', 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    });
    expect(r.status).toBe(200);
    expect((await appUse(owner.id)).some((row) => row.client === 'coach')).toBe(true);
  });

  it('is in the member export and goes with the account', async () => {
    const m = await member();
    await recordAppUse(env.DB, m.id, 'ios', UA_81);
    const exported = await exportUserData(env.DB, m.id) as any;
    expect(exported.app_use.builds).toEqual([expect.objectContaining({ client: 'ios', build: '81' })]);
    expect(exported.app_use.active_days).toHaveLength(1);
    const deleted = await deleteUserAccount(env.DB, m.id, undefined, `member-usage-${m.id}`);
    expect('ok' in deleted).toBe(true);
    expect(await appUse(m.id)).toEqual([]);
    const days = await env.DB.prepare('SELECT COUNT(*) AS n FROM member_active_days WHERE user_id = ?1').bind(m.id).first<{ n: number }>();
    expect(days?.n).toBe(0);
  });
});

describe('the Members page', () => {
  it('opens only for the owner, never through the diagnostics token', async () => {
    const owner = await ownerJwt();
    const m = await member();
    expect((await members(m.jwt)).status).toBe(404);
    expect((await SELF.fetch(`${BASE}/diagnostics/members`, { headers: { Authorization: `Bearer ${TOKEN}` } })).status).toBe(404);
    const ok = await members(owner.jwt);
    expect(ok.status).toBe(200);
    expect(ok.cache).toBe('no-store');
    expect((await members(owner.jwt, 366)).status).toBe(400);
    const audit = await env.DB
      .prepare("SELECT args FROM audit_log WHERE user_id = ?1 AND tool = 'diagnostics_read' ORDER BY created_at DESC LIMIT 1")
      .bind(owner.id).first<{ args: string }>();
    expect(JSON.parse(audit!.args)).toEqual({ lookup: 'members', days: 30 });
  });

  it("shows each member's build, days and features, with Garmin and WHOOP only as connected", async () => {
    const owner = await ownerJwt();
    const m = await member('Ian');
    expect((await get('/api/me', m.jwt, UA_70)).status).toBe(200);
    expect((await get('/api/me', m.jwt, UA_81)).status).toBe(200);
    const ts = Date.now();
    const planId = crypto.randomUUID();
    const workoutId = crypto.randomUUID();
    const sessionId = crypto.randomUUID();
    const old = new Date(ts - 100 * 86_400_000).toISOString().slice(0, 10);
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO plans (id,user_id,name,status,version,meta,created_at,updated_at)
        VALUES (?1,?2,'Plan','active',1,?3,?4,?4)`)
        .bind(planId, m.id, JSON.stringify({ schedule: { version: 1, week: { mon: workoutId, tue: null, wed: null, thu: null, fri: null, sat: null, sun: null } } }), ts),
      env.DB.prepare(`INSERT INTO workouts (id,plan_id,name,order_index,created_at,updated_at) VALUES (?1,?2,'Lift',0,?3,?3)`)
        .bind(workoutId, planId, ts),
      env.DB.prepare(`INSERT INTO sessions (id,user_id,plan_id,workout_id,date,status,completed_at,created_at,updated_at)
        VALUES (?1,?2,?3,?4,?5,'completed',?6,?6,?6)`).bind(sessionId, m.id, planId, workoutId, TODAY, ts),
      env.DB.prepare(`INSERT INTO set_logs (id,session_id,exercise_id,set_index,weight,reps,logged_at,source)
        VALUES (?1,?2,(SELECT id FROM exercises LIMIT 1),1,100,5,?3,'ios')`).bind(crypto.randomUUID(), sessionId, ts),
      ...[
        ['recording', TODAY, null, null],
        // Merged into its intervals.icu copy: still a recorded run.
        ['recording', TODAY, ts, 'some-copy'],
        // Deleted by the member: not counted.
        ['recording', TODAY, ts, null],
        ['healthkit', old, null, null],
        // Plain intervals.icu sync, and a run typed in by hand that synced back.
        ['intervals', TODAY, null, null],
        ['garmin', TODAY, null, null],
        ['whoop', TODAY, null, null],
      ].map(([source, date, deletedAt, duplicateOf]) => env.DB.prepare(
        `INSERT INTO external_activities (id,user_id,source,external_id,date,kind,synced_at,deleted_at,duplicate_of)
         VALUES (?1,?2,?3,?1,?4,'run',?5,?6,?7)`,
      ).bind(crypto.randomUUID(), m.id, source, date, ts, deletedAt, duplicateOf)),
      env.DB.prepare(`INSERT INTO external_activities (id,user_id,source,external_id,date,kind,synced_at,raw)
         VALUES (?1,?2,'intervals',?1,?3,'run',?4,?5)`)
        .bind(crypto.randomUUID(), m.id, TODAY, ts, JSON.stringify({ external_id: `tresfort:activity:${crypto.randomUUID()}` })),
      env.DB.prepare(`INSERT INTO external_activities (id,user_id,source,external_id,date,kind,synced_at,raw)
         VALUES (?1,?2,'intervals',?1,?3,'ride',?4,'not json')`).bind(crypto.randomUUID(), m.id, TODAY, ts),
      env.DB.prepare(`INSERT INTO provider_connections (user_id,provider,connection_id,provider_user_id,access_token,refresh_token,connected_at,updated_at)
        VALUES (?1,'garmin',?2,'g','sealed:v1:a','sealed:v1:r',?3,?3)`).bind(m.id, crypto.randomUUID(), ts),
    ]);

    const page = await members(owner.jwt);
    const ian = page.body.members.find((x: any) => x.user_id === m.id);
    expect(ian).toMatchObject({
      display_name: 'Ian',
      is_owner: false,
      is_test_member: false,
      app: { ios: { build: '81', os_version: 'iOS 26.1' }, web_last_seen_at: null, coach_last_seen_at: null },
      active_days: { any: 1, ios: 1, web: 0, coach: 0 },
      last_activity_date: TODAY,
      recent: {
        workouts_completed: 1,
        sets_logged: 1,
        runs_recorded: 2,
        apple_health_workouts: 0,
        intervals_activities: 2,
        manual_activities: 1,
        plan_changes: { app: 0, web: 0, coach: 0 },
      },
      totals: { workouts_completed: 1, sets_logged: 1, runs_recorded: 2, apple_health_workouts: 1 },
      setup: {
        workouts: 1, weekly_routine: true, block: false, event: false, groups: 0,
        apple_health: true, intervals: 'not_connected', whoop: 'not_connected', garmin: 'connected',
      },
    });
    expect(ian.builds.map((b: any) => b.build)).toEqual(expect.arrayContaining(['70', '81']));
    // Garmin and WHOOP rows never reach a count.
    expect(JSON.stringify(ian.recent)).not.toMatch(/garmin|whoop/);
    expect(page.body.members.find((x: any) => x.user_id === owner.id)).toMatchObject({ is_owner: true });
    expect(page.body.excluded_sources).toEqual(['garmin', 'whoop']);
  });

  it('counts exactly the window of UTC days, and shows a broken intervals.icu connection', async () => {
    const owner = await ownerJwt();
    const m = await member();
    const dayAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
    await env.DB.batch([
      ...[0, 6, 7, 8].map((n) => env.DB.prepare("INSERT INTO member_active_days (user_id, day, client) VALUES (?1, ?2, 'ios')")
        .bind(m.id, dayAgo(n))),
      // markIntervalsAuthError clears the athlete id and sets the error.
      env.DB.prepare('UPDATE users SET intervals_auth_error_at = ?2 WHERE id = ?1').bind(m.id, Date.now()),
    ]);
    const week = (await members(owner.jwt, 7)).body.members.find((x: any) => x.user_id === m.id);
    expect(week.active_days).toMatchObject({ any: 2, ios: 2 });
    expect(week.setup.intervals).toBe('needs_reconnect');
  });
});
