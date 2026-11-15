// WHOOP connection and sync (docs/plans/whoop). Offline: the service takes an
// injected fetcher, and the routes' WHOOP calls are answered by fetchMock.
import {
  applyD1Migrations, createExecutionContext, env, fetchMock, waitOnExecutionContext,
} from 'cloudflare:test';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import worker, { runWhoopCron } from '../src/index';
import { issueAppJwt } from '../src/auth';
import {
  createGroup, createWhoopOAuthCompletion, disconnectWhoop, exportUserData, finishWhoopOAuth, getGroupFeed, getRecentActivities,
  getWhoopStatus, listRecoveryDays, saveAthleteThreshold, setActivityEffort, syncWhoop, syncWhoopEvent, upsertHealthKitActivity, whoopAccessToken,
} from '../src/db';
import type { Fetcher } from '../src/intervals';
import {
  buildRecoveryDays, parseWhoopOffset, parseWhoopWorkout, sportForWhoopName, verifyWhoopWebhook,
  whoopWebhookSignature,
} from '../src/whoop';
import type { ExternalActivityRow } from '../src/types';

beforeAll(async () => { await applyD1Migrations(env.DB, env.TEST_MIGRATIONS); });
beforeEach(() => { fetchMock.activate(); fetchMock.disableNetConnect(); });
const contexts: ExecutionContext[] = [];
async function settle() { await Promise.all(contexts.splice(0).map(waitOnExecutionContext)); }
afterEach(async () => { await settle(); fetchMock.deactivate(); });

async function request(url: string, init?: RequestInit) {
  const context = createExecutionContext();
  contexts.push(context);
  return worker.fetch(new Request(url, init), env, context);
}

const WHOOP = 'https://api.prod.whoop.com';
const HOUR = 3_600_000;
const now = Date.now();
const iso = (ms: number) => new Date(ms).toISOString();

async function member(timezone = 'UTC') {
  const id = crypto.randomUUID();
  const sessionId = sid();
  await env.DB.prepare('INSERT INTO users(id,apple_sub,created_at,timezone) VALUES (?1,?1,1,?2)').bind(id, timezone).run();
  return { id, sessionId, jwt: await issueAppJwt(id, 'test-secret', { sessionId }) };
}
function sid() { return (crypto.randomUUID() + crypto.randomUUID()).replace(/-/g, ''); }
function headers(jwt: string) { return { Authorization: `Bearer ${jwt}`, 'content-type': 'application/json' }; }

async function connect(userId: string, opts: { providerUserId?: string; expiresAt?: number | null } = {}) {
  const sessionId = 'session-' + userId;
  const completion = await createWhoopOAuthCompletion(env.DB, userId, sessionId, {
    accessToken: 'access-1', refreshToken: 'refresh-1',
    expiresAt: opts.expiresAt === undefined ? now + HOUR : opts.expiresAt,
    scopes: 'read:workout offline', providerUserId: opts.providerUserId ?? String(Math.floor(Math.random() * 1e9)),
  }, env.CREDENTIAL_ENCRYPTION_KEY);
  const result = await finishWhoopOAuth(env.DB, env, userId, sessionId, completion);
  expect(result).toMatchObject({ connected: true });
}

function workout(over: Record<string, unknown> = {}, score: Record<string, unknown> = {}) {
  const start = now - 5 * HOUR;
  return {
    id: crypto.randomUUID(), user_id: 1, created_at: iso(start), updated_at: iso(start),
    start: iso(start), end: iso(start + HOUR), timezone_offset: '-05:00', sport_name: 'running',
    score_state: 'SCORED',
    score: {
      strain: 12.34, average_heart_rate: 150, max_heart_rate: 182, kilojoule: 2092, percent_recorded: 100,
      distance_meter: 10000, altitude_gain_meter: 40,
      zone_durations: { zone_zero_milli: 0, zone_one_milli: 600000, zone_two_milli: 1200000,
        zone_three_milli: 1200000, zone_four_milli: 600000, zone_five_milli: 0 },
      ...score,
    },
    ...over,
  };
}
const sleepId = '11111111-2222-4333-8444-555555555555';
const wake = Date.parse('2026-11-07T12:30:00Z'); // 07:30 at -05:00
function sleep(over: Record<string, unknown> = {}) {
  return {
    id: sleepId, cycle_id: 93845, user_id: 1, created_at: iso(wake), updated_at: iso(wake), nap: false,
    start: iso(wake - 8 * HOUR), end: iso(wake), timezone_offset: '-05:00', score_state: 'SCORED',
    score: {
      stage_summary: { total_in_bed_time_milli: 28_800_000, total_awake_time_milli: 1_800_000,
        total_no_data_time_milli: 0, total_light_sleep_time_milli: 14_400_000,
        total_slow_wave_sleep_time_milli: 5_400_000, total_rem_sleep_time_milli: 7_200_000,
        sleep_cycle_count: 4, disturbance_count: 10 },
      sleep_needed: { baseline_milli: 27_000_000, need_from_sleep_debt_milli: 0,
        need_from_recent_strain_milli: 0, need_from_recent_nap_milli: 0 },
      respiratory_rate: 15.2, sleep_performance_percentage: 98, sleep_efficiency_percentage: 91.7,
    },
    ...over,
  };
}
const recovery = {
  cycle_id: 93845, sleep_id: sleepId, user_id: 1, created_at: iso(wake), updated_at: iso(wake),
  score_state: 'SCORED',
  score: { user_calibrating: false, recovery_score: 44, resting_heart_rate: 64, hrv_rmssd_milli: 31.81,
    spo2_percentage: 95.6875, skin_temp_celsius: 33.7 },
};
const cycle = {
  id: 93845, user_id: 1, created_at: iso(wake), updated_at: iso(wake), start: iso(wake - 8 * HOUR),
  timezone_offset: '-05:00', score_state: 'SCORED',
  score: { strain: 5.29, kilojoule: 8288, average_heart_rate: 68, max_heart_rate: 141 },
};

interface FakeWhoop {
  workouts?: unknown[]; recoveries?: unknown[]; sleeps?: unknown[]; cycles?: unknown[];
  refreshStatus?: number; collectionStatus?: number; onCollection?: (path: string) => Promise<void>;
}
function fakeWhoop(data: FakeWhoop) {
  const calls: string[] = [];
  const urls: string[] = [];
  let refreshes = 0;
  const fetcher: Fetcher = async (input, init) => {
    const url = new URL(input);
    calls.push(`${init?.method ?? 'GET'} ${url.pathname}`);
    urls.push(url.pathname + url.search);
    if (url.pathname === '/oauth/oauth2/token') {
      refreshes += 1;
      const status = data.refreshStatus ?? 200;
      return { ok: status === 200, status, json: async () => ({
        access_token: `access-${refreshes + 1}`, refresh_token: `refresh-${refreshes + 1}`, expires_in: 3600,
        scope: 'read:workout offline', token_type: 'bearer',
      }) };
    }
    if (url.pathname.startsWith('/developer/v2/')) {
      await data.onCollection?.(url.pathname);
      const status = data.collectionStatus ?? 200;
      const collection = url.pathname.replace('/developer/v2/', '');
      const records = collection === 'activity/workout' ? data.workouts
        : collection === 'recovery' ? data.recoveries
          : collection === 'activity/sleep' ? data.sleeps
            : collection === 'cycle' ? data.cycles : [];
      return { ok: status === 200, status, json: async () => ({ records: records ?? [] }) };
    }
    return { ok: false, status: 404, json: async () => ({}) };
  };
  return { fetcher, calls, urls, refreshes: () => refreshes };
}

async function whoopRows(userId: string) {
  return (await env.DB.prepare("SELECT * FROM external_activities WHERE user_id = ?1 AND source = 'whoop' ORDER BY id")
    .bind(userId).all<ExternalActivityRow & { strain: number | null }>()).results;
}

describe('WHOOP mapping', () => {
  it('maps a scored workout to the sport, kind, energy and WHOOP strain', () => {
    const w = parseWhoopWorkout(workout())!;
    expect(w).toMatchObject({ sport: 'run', kind: 'run', strain: 12.3, averageHr: 150, maxHr: 182,
      calories: 500, distanceM: 10000, offsetSec: -18000 });
    expect(w.zoneDurationsMs).toEqual([0, 600000, 1200000, 1200000, 600000, 0]);
  });

  it('keeps an unscored workout without measurements and skips activities that are not training', () => {
    expect(parseWhoopWorkout(workout({ score_state: 'PENDING_SCORE' }))).toMatchObject({
      scored: false, strain: null, averageHr: null, calories: null });
    expect(parseWhoopWorkout(workout({ sport_name: 'sauna' }))).toBeNull();
    expect(parseWhoopWorkout(workout({ id: 'not-a-uuid' }))).toBeNull();
    expect(sportForWhoopName('functional-fitness')).toBe('cross_training');
    expect(sportForWhoopName('Hiking/Rucking')).toBe('hike');
    expect(sportForWhoopName('weightlifting')).toBe('strength');
    expect(sportForWhoopName('something-new')).toBe('other');
  });

  it('parses timezone offsets', () => {
    expect(parseWhoopOffset('-05:00')).toBe(-18000);
    expect(parseWhoopOffset('+0530')).toBe(19800);
    expect(parseWhoopOffset('Z')).toBe(0);
    expect(parseWhoopOffset('EST')).toBeNull();
  });

  it('builds one day per cycle, dated by the morning the member woke up', () => {
    const [day] = buildRecoveryDays([recovery], [sleep()], [cycle]);
    expect(day).toMatchObject({
      cycleId: '93845', date: '2026-11-07', recoveryScore: 44, hrvRmssdMs: 31.8, restingHr: 64, spo2Pct: 95.7,
      skinTempC: 33.7, calibrating: false, sleepMs: 27_000_000, inBedMs: 28_800_000, sleepPerformancePct: 98,
      sleepEfficiencyPct: 91.7, respiratoryRate: 15.2, dayStrain: 5.3,
    });
    // A cycle that began in the evening with no sleep yet belongs to the next morning.
    const evening = { ...cycle, id: 93846, start: '2026-11-08T03:30:00Z', score_state: 'PENDING_SCORE' };
    expect(buildRecoveryDays([], [], [evening])[0]).toMatchObject({ date: '2026-11-08', dayStrain: null });
    // Naps never stand in for the night.
    expect(buildRecoveryDays([recovery], [sleep({ nap: true })], [cycle])[0]!.sleepMs).toBeNull();
  });

  it('verifies webhook signatures', async () => {
    const body = JSON.stringify({ user_id: 1, id: 'x', type: 'workout.updated' });
    const ts = String(now);
    const sig = await whoopWebhookSignature('secret', ts, body);
    expect(await verifyWhoopWebhook('secret', ts, sig, body, now)).toBe(true);
    expect(await verifyWhoopWebhook('other', ts, sig, body, now)).toBe(false);
    expect(await verifyWhoopWebhook('secret', ts, sig, body + ' ', now)).toBe(false);
    expect(await verifyWhoopWebhook('secret', String(now - 2 * 86_400_000), sig, body, now)).toBe(false);
    expect(await verifyWhoopWebhook('secret', null, sig, body, now)).toBe(false);
  });
});

describe('WHOOP connect', () => {
  it('connects through start, callback and finish, then syncs in the background', async () => {
    const user = await member();
    const start = await request('https://test/auth/whoop/start', { method: 'POST', headers: headers(user.jwt) });
    expect(start.status).toBe(200);
    const authorize = new URL((await start.json<{ authorize_url: string }>()).authorize_url);
    expect(authorize.origin + authorize.pathname).toBe(`${WHOOP}/oauth/oauth2/auth`);
    expect(authorize.searchParams.get('scope')).toContain('offline');
    expect(authorize.searchParams.get('redirect_uri')).toBe('https://test/auth/whoop/callback');
    const state = authorize.searchParams.get('state')!;

    fetchMock.get(WHOOP).intercept({ path: '/oauth/oauth2/token', method: 'POST' })
      .reply(200, { access_token: 'synthetic-access', refresh_token: 'synthetic-refresh', expires_in: 3600, scope: 'offline' });
    fetchMock.get(WHOOP).intercept({ path: '/developer/v2/user/profile/basic' })
      .reply(200, { user_id: 424242, email: 'x@example.com', first_name: 'A', last_name: 'B' });
    const callback = await request(`https://test/auth/whoop/callback?code=abc&state=${state}`, { redirect: 'manual' });
    expect(callback.status).toBe(302);
    const location = new URL(callback.headers.get('Location')!);
    expect(location.protocol + location.host).toBe('tresfort:whoop-connected');
    const completion = location.searchParams.get('completion');
    expect(completion).toMatch(/^[A-Za-z0-9_-]{43}$/);

    // The state is single use.
    const replay = await request(`https://test/auth/whoop/callback?code=abc&state=${state}`, { redirect: 'manual' });
    expect(replay.headers.get('Location')).toBe('tresfort://whoop-connected?error=bad_state');

    // Another app session cannot redeem it.
    const otherSession = await issueAppJwt(user.id, 'test-secret', { sessionId: sid() });
    const stolen = await request('https://test/auth/whoop/finish', {
      method: 'POST', headers: headers(otherSession), body: JSON.stringify({ completion }) });
    expect(stolen.status).toBe(400);

    const run = workout();
    for (const path of ['activity/workout', 'recovery', 'activity/sleep', 'cycle']) {
      fetchMock.get(WHOOP).intercept({ path: new RegExp(`^/developer/v2/${path}\\?`) })
        .reply(200, { records: path === 'activity/workout' ? [run] : [] });
    }
    // Stolen attempts consume nothing; the original session finishes it.
    const finish = await request('https://test/auth/whoop/finish', {
      method: 'POST', headers: headers(user.jwt), body: JSON.stringify({ completion }) });
    expect(finish.status).toBe(200);
    await settle();
    expect(await getWhoopStatus(env.DB, env, user.id)).toMatchObject({ configured: true, connected: true, needs_reauth: false });
    const stored = await env.DB.prepare(`SELECT access_token, refresh_token, provider_user_id FROM provider_connections WHERE user_id = ?1`)
      .bind(user.id).first<{ access_token: string; refresh_token: string; provider_user_id: string }>();
    expect(stored!.provider_user_id).toBe('424242');
    expect(stored!.access_token).toMatch(/^sealed:v1:/);
    expect(stored!.access_token).not.toContain('synthetic');
    expect(await whoopRows(user.id)).toHaveLength(1);

    const status = await request('https://test/api/me/whoop', { headers: headers(user.jwt) });
    expect(await status.json()).toMatchObject({ connected: true });
  });

  it('refuses a WHOOP account already linked to another member', async () => {
    const a = await member(), b = await member();
    await connect(a.id, { providerUserId: '777' });
    const completion = await createWhoopOAuthCompletion(env.DB, b.id, 's', {
      accessToken: 'x', refreshToken: 'y', expiresAt: null, scopes: null, providerUserId: '777',
    }, env.CREDENTIAL_ENCRYPTION_KEY);
    expect(await finishWhoopOAuth(env.DB, env, b.id, 's', completion)).toEqual({ error: 'account_in_use' });
  });

  it('reports a declined authorization back to the app', async () => {
    const r = await request('https://test/auth/whoop/callback?error=access_denied&state=x', { redirect: 'manual' });
    expect(r.headers.get('Location')).toBe('tresfort://whoop-connected?error=access_denied');
  });
});

describe('WHOOP tokens', () => {
  it('refreshes an expiring token once and rotates both tokens', async () => {
    const user = await member();
    await connect(user.id, { expiresAt: now + 30_000 });
    const fake = fakeWhoop({});
    const first = await whoopAccessToken(env.DB, env, user.id, fake.fetcher);
    expect(first).toMatchObject({ ok: true, token: 'access-2' });
    const second = await whoopAccessToken(env.DB, env, user.id, fake.fetcher);
    expect(second).toMatchObject({ ok: true, token: 'access-2' });
    expect(fake.refreshes()).toBe(1);
    const row = await env.DB.prepare('SELECT token_version, refresh_lease_until FROM provider_connections WHERE user_id = ?1')
      .bind(user.id).first<{ token_version: number; refresh_lease_until: number | null }>();
    expect(row).toEqual({ token_version: 2, refresh_lease_until: null });
  });

  it('lets only one of two concurrent requests spend the refresh token', async () => {
    const user = await member();
    await connect(user.id, { expiresAt: now - 1 });
    const fake = fakeWhoop({});
    const results = await Promise.all([
      whoopAccessToken(env.DB, env, user.id, fake.fetcher),
      whoopAccessToken(env.DB, env, user.id, fake.fetcher),
    ]);
    expect(fake.refreshes()).toBe(1);
    expect(results.filter(r => r.ok)).not.toHaveLength(0);
  });

  it('never lets a refresh from an old connection overwrite a reconnect', async () => {
    const user = await member();
    await connect(user.id, { expiresAt: now - 1 });
    const inner = fakeWhoop({});
    const noop: Fetcher = async () => ({ ok: true, status: 204, json: async () => ({}) });
    // While WHOOP answers the refresh, the member disconnects and connects
    // again: the new row also starts at token_version 1.
    const racing: Fetcher = async (input, init) => {
      if (new URL(input).pathname === '/oauth/oauth2/token') {
        await disconnectWhoop(env.DB, env, user.id, noop);
        await connect(user.id, { expiresAt: now + HOUR });
      }
      return inner.fetcher(input, init);
    };
    expect(await whoopAccessToken(env.DB, env, user.id, racing)).toEqual({ ok: false, reason: 'not_connected' });
    expect(await whoopAccessToken(env.DB, env, user.id, inner.fetcher)).toMatchObject({ ok: true, token: 'access-1' });
    const row = await env.DB.prepare('SELECT token_version, refresh_lease_until FROM provider_connections WHERE user_id = ?1')
      .bind(user.id).first();
    expect(row).toEqual({ token_version: 1, refresh_lease_until: null });
  });

  it('asks for a reconnect when WHOOP refuses the refresh token', async () => {
    const user = await member();
    await connect(user.id, { expiresAt: now - 1 });
    const fake = fakeWhoop({ refreshStatus: 400 });
    expect(await whoopAccessToken(env.DB, env, user.id, fake.fetcher)).toEqual({ ok: false, reason: 'reauth' });
    expect(await getWhoopStatus(env.DB, env, user.id)).toMatchObject({ connected: true, needs_reauth: true });
    expect((await syncWhoop(env.DB, env, user.id, { fetcher: fake.fetcher })).status).toBe('reauth');
  });

  it('keeps the connection on a transient refresh failure', async () => {
    const user = await member();
    await connect(user.id, { expiresAt: now - 1 });
    expect(await whoopAccessToken(env.DB, env, user.id, fakeWhoop({ refreshStatus: 503 }).fetcher))
      .toEqual({ ok: false, reason: 'transient' });
    expect(await getWhoopStatus(env.DB, env, user.id)).toMatchObject({ needs_reauth: false });
    expect(await whoopAccessToken(env.DB, env, user.id, fakeWhoop({}).fetcher)).toMatchObject({ ok: true });
  });
});

describe('WHOOP sync', () => {
  it('stores workouts with WHOOP strain and a heart-rate load, and recovery days', async () => {
    const user = await member('America/New_York');
    await connect(user.id);
    await saveAthleteThreshold(env.DB, user.id, {
      id: crypto.randomUUID(), sport: 'run', metric: 'threshold_hr', value: 165, effective_date: '2020-01-01' });
    const run = workout();
    const fake = fakeWhoop({ workouts: [run], recoveries: [recovery], sleeps: [sleep()], cycles: [cycle] });
    const result = await syncWhoop(env.DB, env, user.id, { fetcher: fake.fetcher });
    expect(result).toEqual({ status: 'ok', workouts: 1, days: 1 });
    const [row] = await whoopRows(user.id);
    expect(row).toMatchObject({
      id: `whoop:${user.id}:${run.id}`, kind: 'run', sport: 'run', name: 'Run', strain: 12.3, average_hr: 150,
      calories: 500, distance_m: 10000, training_load: null, moving_time_sec: 3600, source_timezone: 'GMT-0500',
      load_method: 'heart_rate_average', deleted_at: null,
    });
    expect(row!.effective_load).toBeGreaterThan(0);
    const days = await listRecoveryDays(env.DB, user.id, '2026-11-01', '2026-11-30');
    expect(days).toEqual([expect.objectContaining({ date: '2026-11-07', recovery_score: 44, hrv_rmssd_ms: 31.8,
      resting_hr: 64, sleep_ms: 27_000_000, day_strain: 5.3, calibrating: false, source: 'whoop' })]);
    // The member's own export carries the recovery days; the tokens never.
    const exported = await exportUserData(env.DB, user.id);
    expect((exported?.training as { daily_recovery: unknown[] }).daily_recovery)
      .toEqual([expect.objectContaining({ date: '2026-11-07', recovery_score: 44, source: 'whoop' })]);
    expect(JSON.stringify(exported)).not.toContain('sealed:v1:');

    // A second sync with nothing new writes nothing.
    const before = (await whoopRows(user.id))[0]!.synced_at;
    await syncWhoop(env.DB, env, user.id, { fetcher: fake.fetcher });
    expect((await whoopRows(user.id))[0]!.synced_at).toBe(before);

    // A workout WHOOP no longer lists is hidden.
    await syncWhoop(env.DB, env, user.id, { fetcher: fakeWhoop({ recoveries: [recovery], sleeps: [sleep()], cycles: [cycle] }).fetcher });
    expect((await whoopRows(user.id))[0]!.deleted_at).not.toBeNull();
  });

  it('keeps the first-sync window until a full sync succeeds', async () => {
    const user = await member();
    await connect(user.id);
    const DAY = 24 * HOUR;
    const old = workout({ start: iso(now - 60 * DAY), end: iso(now - 60 * DAY + HOUR) });
    // The first sync fails, then a 14-day retry (Sync now) still backfills 90 days.
    expect((await syncWhoop(env.DB, env, user.id, { fetcher: fakeWhoop({ collectionStatus: 500 }).fetcher })).status)
      .toBe('fetch_failed');
    const retry = fakeWhoop({ workouts: [old] });
    expect((await syncWhoop(env.DB, env, user.id, { fetcher: retry.fetcher, days: 14 })).status).toBe('ok');
    const start = Date.parse(new URL(`https://x${retry.urls[0]}`).searchParams.get('start')!);
    expect(start).toBeLessThanOrEqual(now - 89 * DAY);
    // After that, a 14-day sync stays 14 days.
    const later = fakeWhoop({ workouts: [old] });
    await syncWhoop(env.DB, env, user.id, { fetcher: later.fetcher, days: 14 });
    const laterStart = Date.parse(new URL(`https://x${later.urls[0]}`).searchParams.get('start')!);
    expect(laterStart).toBeGreaterThan(now - 15 * DAY);
  });

  it('never lets an older sync land after a newer one', async () => {
    const user = await member();
    await connect(user.id);
    const w = workout();
    const data: FakeWhoop = { workouts: [w] };
    let second: Awaited<ReturnType<typeof syncWhoop>> | null = null;
    let fetched = 0;
    data.onCollection = async (path) => {
      if (path !== '/developer/v2/activity/workout' || fetched++ > 0) return;
      // While this sync holds its snapshot, WHOOP deletes the workout and a
      // webhook's sync arrives: it waits its turn instead of racing.
      data.workouts = [w];
      const deleted = fakeWhoop({});
      second = await syncWhoop(env.DB, env, user.id, { fetcher: deleted.fetcher, days: 30 });
    };
    const fake = fakeWhoop(data);
    const wrapped: Fetcher = async (input, init) => {
      const res = await fake.fetcher(input, init);
      if (new URL(input).pathname === '/developer/v2/activity/workout') data.workouts = [];
      return res;
    };
    await syncWhoop(env.DB, env, user.id, { fetcher: wrapped });
    expect(second).toMatchObject({ status: 'busy' });
    // The holder ran again with the waiting sync's window, so the deletion wins.
    expect((await whoopRows(user.id))[0]!.deleted_at).not.toBeNull();
    const conn = await env.DB.prepare(`SELECT sync_lease_until, sync_pending_days, sync_attempt FROM provider_connections
        WHERE user_id = ?1`).bind(user.id).first();
    expect(conn).toMatchObject({ sync_lease_until: null, sync_pending_days: null, sync_attempt: 1 });
    expect(fetched).toBe(2);
  });

  it('hands back a window it could not finish', async () => {
    const user = await member();
    await connect(user.id);
    const DAY = 24 * HOUR;
    await syncWhoop(env.DB, env, user.id, { fetcher: fakeWhoop({}).fetcher });
    const pending = async () => (await env.DB.prepare(`SELECT sync_lease_until, sync_pending_days FROM provider_connections
        WHERE user_id = ?1`).bind(user.id).first<{ sync_lease_until: number | null; sync_pending_days: number | null }>())!;
    // A webhook arrives during every pass: after its last pass the holder
    // leaves the still-queued window for the next sync instead of dropping it.
    const data: FakeWhoop = {};
    let busy = 0;
    data.onCollection = async (path) => {
      if (path !== '/developer/v2/activity/workout') return;
      if ((await syncWhoop(env.DB, env, user.id, { fetcher: fakeWhoop({}).fetcher, days: 200 })).status === 'busy') busy += 1;
    };
    await syncWhoop(env.DB, env, user.id, { fetcher: fakeWhoop(data).fetcher });
    expect(busy).toBe(3);
    expect(await pending()).toMatchObject({ sync_lease_until: null, sync_pending_days: 200 });
    const next = fakeWhoop({});
    await syncWhoop(env.DB, env, user.id, { fetcher: next.fetcher });
    expect(Date.parse(new URL(`https://x${next.urls[0]}`).searchParams.get('start')!)).toBeLessThanOrEqual(now - 199 * DAY);
    expect(await pending()).toMatchObject({ sync_pending_days: null });

    // A window that fails to load is kept too, so the cron reaches back that far.
    expect((await syncWhoop(env.DB, env, user.id, { fetcher: fakeWhoop({ collectionStatus: 500 }).fetcher, days: 120 })).status)
      .toBe('fetch_failed');
    expect(await pending()).toMatchObject({ sync_lease_until: null, sync_pending_days: 120 });

    // So is the window of a sync that finds another request refreshing the token.
    await env.DB.prepare(`UPDATE provider_connections SET sync_pending_days = NULL, expires_at = ?2,
        refresh_lease_until = ?3 WHERE user_id = ?1`).bind(user.id, now - HOUR, now + HOUR).run();
    expect((await syncWhoop(env.DB, env, user.id, { fetcher: fakeWhoop({}).fetcher, days: 150 })).status).toBe('busy');
    expect(await pending()).toMatchObject({ sync_pending_days: 150 });
  });

  it('picks up the window of a sync whose Worker died', async () => {
    const user = await member();
    await connect(user.id);
    const DAY = 24 * HOUR;
    await syncWhoop(env.DB, env, user.id, { fetcher: fakeWhoop({}).fetcher });
    // A sync claimed a 63-day window, then its Worker stopped before letting go.
    await env.DB.prepare(`UPDATE provider_connections SET sync_rerun_days = 63, sync_lease_until = ?2,
        sync_attempt = sync_attempt + 1 WHERE user_id = ?1`).bind(user.id, now - 1).run();
    const next = fakeWhoop({});
    expect((await syncWhoop(env.DB, env, user.id, { fetcher: next.fetcher })).status).toBe('ok');
    expect(Date.parse(new URL(`https://x${next.urls[0]}`).searchParams.get('start')!)).toBeLessThanOrEqual(now - 62 * DAY);
    const conn = await env.DB.prepare('SELECT sync_rerun_days, sync_lease_until FROM provider_connections WHERE user_id = ?1')
      .bind(user.id).first();
    expect(conn).toEqual({ sync_rerun_days: null, sync_lease_until: null });
  });

  it('leaves rows alone when WHOOP cannot be read', async () => {
    const user = await member();
    await connect(user.id);
    await syncWhoop(env.DB, env, user.id, { fetcher: fakeWhoop({ workouts: [workout()] }).fetcher });
    const result = await syncWhoop(env.DB, env, user.id, { fetcher: fakeWhoop({ collectionStatus: 503 }).fetcher });
    expect(result.status).toBe('fetch_failed');
    expect((await whoopRows(user.id))[0]!.deleted_at).toBeNull();
  });

  it('writes nothing for a sync that outlives a disconnect', async () => {
    const user = await member();
    await connect(user.id);
    const fake = fakeWhoop({
      workouts: [workout()],
      onCollection: async (path) => {
        if (path.endsWith('activity/workout')) await env.DB.prepare('DELETE FROM provider_connections WHERE user_id = ?1').bind(user.id).run();
      },
    });
    await syncWhoop(env.DB, env, user.id, { fetcher: fake.fetcher });
    expect(await whoopRows(user.id)).toHaveLength(0);
  });

  it('disconnects: forgets tokens, hides workouts and deletes recovery days', async () => {
    const user = await member();
    await connect(user.id);
    await syncWhoop(env.DB, env, user.id, {
      fetcher: fakeWhoop({ workouts: [workout()], recoveries: [recovery], sleeps: [sleep()], cycles: [cycle] }).fetcher });
    fetchMock.get(WHOOP).intercept({ path: '/developer/v2/user/access', method: 'DELETE' }).reply(204, '');
    const r = await request('https://test/api/me/whoop', { method: 'DELETE', headers: headers(user.jwt) });
    expect(await r.json()).toEqual({ disconnected: true });
    expect(await getWhoopStatus(env.DB, env, user.id)).toMatchObject({ connected: false });
    expect((await whoopRows(user.id))[0]!.deleted_at).not.toBeNull();
    expect(await listRecoveryDays(env.DB, user.id, '2026-01-01', '2026-12-31')).toEqual([]);
    expect(await disconnectWhoop(env.DB, env, user.id, fakeWhoop({}).fetcher)).toEqual({ disconnected: false });
  });
});

describe('WHOOP dedup and privacy', () => {
  it('hides a WHOOP run that overlaps an intervals.icu run, and an Apple Health copy of a WHOOP workout', async () => {
    const user = await member();
    await connect(user.id);
    const start = now - 5 * HOUR;
    const date = iso(start).slice(0, 10);
    await env.DB.prepare(`INSERT INTO external_activities
        (id,user_id,source,external_id,date,start_date_local_ms,kind,name,moving_time_sec,elapsed_time_sec,
         synced_at,canonical,start_date_utc_ms,source_timezone)
      VALUES (?1,?2,'intervals','i1',?3,?4,'run','Garmin run',3300,3400,1,1,?4,'UTC')`)
      .bind(`intervals:${user.id}:i1`, user.id, date, start + 4 * 60_000).run();
    const run = workout();
    const lift = workout({ id: crypto.randomUUID(), sport_name: 'yoga', start: iso(start - 3 * HOUR), end: iso(start - 2 * HOUR) });
    await syncWhoop(env.DB, env, user.id, { fetcher: fakeWhoop({ workouts: [run, lift] }).fetcher });
    const rows = await whoopRows(user.id);
    const whoopRun = rows.find(r => r.external_id === run.id)!;
    expect(whoopRun).toMatchObject({ duplicate_of: `intervals:${user.id}:i1`, canonical: 0 });
    expect(whoopRun.deleted_at).not.toBeNull();

    const yoga = rows.find(r => r.external_id === lift.id)!;
    expect(yoga.deleted_at).toBeNull();
    // The copy's date is its own start's: three hours earlier can be the day before.
    const copy = await upsertHealthKitActivity(env.DB, user.id, {
      id: crypto.randomUUID(), date: iso(start - 3 * HOUR).slice(0, 10),
      start_date_local_ms: start - 3 * HOUR, start_date_utc_ms: start - 3 * HOUR,
      source_timezone: 'UTC', kind: 'yoga', name: 'Yoga', moving_time_sec: 3600, elapsed_time_sec: 3600,
      distance_m: null, average_watts: null, average_hr: null, max_hr: null, calories: null,
      elevation_gain_m: null, raw: null,
    });
    expect(copy).toMatchObject({ duplicate_of: yoga.id, canonical: 0 });

    // When the intervals.icu run goes away, the WHOOP run comes back.
    await env.DB.prepare(`UPDATE external_activities SET deleted_at = ?2 WHERE id = ?1`).bind(`intervals:${user.id}:i1`, now).run();
    await syncWhoop(env.DB, env, user.id, { fetcher: fakeWhoop({ workouts: [run, lift] }).fetcher });
    expect((await whoopRows(user.id)).find(r => r.external_id === run.id)).toMatchObject({ deleted_at: null, duplicate_of: null });
  });

  it('charts a WHOOP workout from the heart rate of the Apple Health copy behind it, in either order', async () => {
    // WHOOP's API gives a workout's average and max only; the readings WHOOP
    // writes to Apple Health during the workout come with the Health copy.
    const start = now - 5 * HOUR;
    const date = iso(start).slice(0, 10);
    const heartRate = Array.from({ length: 300 }, (_, t) => ({ t, v: 130 + Math.floor(t / 10) }));
    const healthCopy = (userId: string) => upsertHealthKitActivity(env.DB, userId, {
      id: crypto.randomUUID(), date, start_date_local_ms: start, start_date_utc_ms: start,
      source_timezone: 'UTC', kind: 'run', name: 'Running', moving_time_sec: 3600, elapsed_time_sec: 3600,
      distance_m: 10000, average_watts: null, average_hr: 150, max_hr: 182, calories: null,
      elevation_gain_m: null, raw: null, streams: { heart_rate: heartRate },
    });
    const chart = async (jwt: string, id: string) => {
      const r = await request(`https://test/api/activities/${encodeURIComponent(id)}/streams`, { headers: headers(jwt) });
      return { status: r.status, body: await r.json<any>() };
    };

    for (const healthFirst of [false, true]) {
      const user = await member();
      await connect(user.id);
      const run = workout();
      const copyFirst = healthFirst ? await healthCopy(user.id) : null;
      await syncWhoop(env.DB, env, user.id, { fetcher: fakeWhoop({ workouts: [run] }).fetcher });
      const whoopRun = (await whoopRows(user.id)).find(r => r.external_id === run.id)!;
      expect(whoopRun.deleted_at).toBeNull();
      const copy = copyFirst
        ? await env.DB.prepare('SELECT * FROM external_activities WHERE id = ?1').bind(copyFirst.id).first<ExternalActivityRow>()
        : await healthCopy(user.id);
      expect(copy).toMatchObject({ duplicate_of: whoopRun.id, canonical: 0 });

      const res = await chart(user.jwt, whoopRun.id);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ activity_id: copy!.id, source: 'healthkit' });
      expect(res.body.streams.heart_rate[0]).toBe(130);
      expect(res.body.streams.speed_mps).toBeNull();
    }
  });

  it('keeps WHOOP workouts out of the coach and the group feed', async () => {
    const user = await member();
    await connect(user.id);
    await syncWhoop(env.DB, env, user.id, { fetcher: fakeWhoop({ workouts: [workout()] }).fetcher });
    expect(await whoopRows(user.id)).toHaveLength(1);
    expect(await getRecentActivities(env.DB, user.id, { to: '2099-01-01', range: 100_000 })).toEqual([]);
    const group = await createGroup(env.DB, user.id, 'test');
    const feed = await getGroupFeed(env.DB, group.id, null, null, 25, user.id);
    expect(JSON.stringify(feed)).not.toContain('whoop');
    // The coach cannot rate (and so read) a WHOOP workout by id; the member can.
    const [row] = await whoopRows(user.id);
    expect(await setActivityEffort(env.DB, user.id, row!.id, 6, undefined, { coach: true })).toBeNull();
    expect(await setActivityEffort(env.DB, user.id, row!.id, 6)).toMatchObject({ id: row!.id, effort: 6 });
  });
});

describe('WHOOP webhook and cron', () => {
  it('re-syncs the member named by a signed webhook and refuses unsigned ones', async () => {
    const user = await member();
    await connect(user.id, { providerUserId: '31337' });
    const body = JSON.stringify({ user_id: 31337, id: crypto.randomUUID(), type: 'workout.updated', trace_id: 't' });
    const ts = String(Date.now());
    const unsigned = await request('https://test/webhooks/whoop', { method: 'POST', body,
      headers: { 'x-whoop-signature-timestamp': ts, 'x-whoop-signature': 'bad' } });
    expect(unsigned.status).toBe(401);

    for (const path of ['activity/workout', 'recovery', 'activity/sleep', 'cycle']) {
      fetchMock.get(WHOOP).intercept({ path: new RegExp(`^/developer/v2/${path}\\?`) })
        .reply(200, { records: path === 'activity/workout' ? [workout()] : [] });
    }
    const signed = await request('https://test/webhooks/whoop', { method: 'POST', body, headers: {
      'x-whoop-signature-timestamp': ts, 'x-whoop-signature': await whoopWebhookSignature('test-whoop-secret', ts, body) } });
    expect(signed.status).toBe(200);
    await settle();
    expect(await whoopRows(user.id)).toHaveLength(1);
  });

  it('reaches back past 14 days for an older record a webhook names', async () => {
    const user = await member();
    await connect(user.id);
    const DAY = 24 * HOUR;
    const oldStart = now - 60 * DAY;
    const old = workout({ start: iso(oldStart), end: iso(oldStart + HOUR) });
    const nightEnd = now - 50 * DAY;
    const oldSleepId = 'aaaaaaaa-2222-4333-8444-555555555555';
    const oldSleep = sleep({ id: oldSleepId, cycle_id: 777, start: iso(nightEnd - 8 * HOUR), end: iso(nightEnd) });
    const oldCycle = { ...cycle, id: 777, start: iso(nightEnd - 8 * HOUR) };
    const oldRecovery = { ...recovery, cycle_id: 777, sleep_id: oldSleepId };
    await syncWhoop(env.DB, env, user.id, { fetcher: fakeWhoop({
      workouts: [old], sleeps: [oldSleep], cycles: [oldCycle], recoveries: [oldRecovery] }).fetcher });
    expect((await whoopRows(user.id))[0]!.deleted_at).toBeNull();

    // WHOOP deleted the old workout: the event's window covers it.
    const afterDelete = fakeWhoop({ sleeps: [oldSleep], cycles: [oldCycle], recoveries: [oldRecovery] });
    await syncWhoopEvent(env.DB, env, user.id, { type: 'workout.deleted', id: old.id }, { fetcher: afterDelete.fetcher });
    expect((await whoopRows(user.id))[0]!.deleted_at).not.toBeNull();
    const startParam = new URL(`https://x${afterDelete.urls[0]}`).searchParams.get('start')!;
    expect(Date.parse(startParam)).toBeLessThan(oldStart);

    // WHOOP rescored that night: the recovery event names its sleep.
    const rescored = { ...oldRecovery, score: { ...oldRecovery.score, recovery_score: 81 } };
    await syncWhoopEvent(env.DB, env, user.id, { type: 'recovery.updated', id: oldSleepId }, {
      fetcher: fakeWhoop({ sleeps: [oldSleep], cycles: [oldCycle], recoveries: [rescored] }).fetcher });
    const date = iso(nightEnd - 5 * HOUR).slice(0, 10); // the -05:00 morning
    expect(await listRecoveryDays(env.DB, user.id, date, date))
      .toEqual([expect.objectContaining({ recovery_score: 81 })]);
  });

  it('syncs members the webhooks missed', async () => {
    const user = await member();
    await connect(user.id);
    const fake = fakeWhoop({ workouts: [workout()] });
    const result = await runWhoopCron(env.DB, env, Date.now(), { fetcher: fake.fetcher });
    expect(result.members).toBeGreaterThanOrEqual(1);
    expect(await whoopRows(user.id)).toHaveLength(1);
    const again = await runWhoopCron(env.DB, env, Date.now(), { fetcher: fake.fetcher });
    expect(again.members).toBe(0);
  });

  it('validates the recovery range', async () => {
    const user = await member();
    expect((await request('https://test/api/me/recovery?from=2026-11-01', { headers: headers(user.jwt) })).status).toBe(400);
    const ok = await request('https://test/api/me/recovery?from=2026-11-01&to=2026-11-07', { headers: headers(user.jwt) });
    expect(await ok.json()).toEqual({ days: [] });
  });
});
