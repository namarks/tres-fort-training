// Garmin connection and workout files (docs/plans/garmin). Offline: the
// service takes an injected fetcher, and the routes' Garmin calls are
// answered by fetchMock. All Garmin values here are synthetic.
import {
  applyD1Migrations, createExecutionContext, env, fetchMock, waitOnExecutionContext,
} from 'cloudflare:test';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import worker, { runGarminCron } from '../src/index';
import { issueAppJwt } from '../src/auth';
import {
  createGarminOAuthCompletion, createGroup, disconnectGarmin, finishGarminOAuth, garminAccessToken, getGarminStatus,
  getGroupFeed, getRecentActivities, getState, handleGarminDeregistrations, handleGarminPermissionChanges,
  processGarminFiles, queueGarminActivityFiles, upsertHealthKitActivity,
} from '../src/db';
import {
  garminAuthorizeUrl, garminCodeChallenge, isGarminFileUrl, isGarminPushAddress, parseGarminActivityFiles,
  parseGarminDeregistrations, parseGarminPermissionChanges, type GarminFetcher,
} from '../src/garmin';
import { activityFit } from './fitWriter';

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

const API = 'https://apis.garmin.com';
const AUTH = 'https://diauth.garmin.com';
const PUSH_PATH = `/webhooks/garmin/${env.GARMIN_PUSH_SECRET}`;
const GARMIN_IP = '204.77.162.10';
const HOUR = 3_600_000;
const now = Date.now();

function sid() { return (crypto.randomUUID() + crypto.randomUUID()).replace(/-/g, ''); }
function headers(jwt: string) { return { Authorization: `Bearer ${jwt}`, 'content-type': 'application/json' }; }

async function member() {
  const id = crypto.randomUUID();
  const sessionId = sid();
  await env.DB.prepare('INSERT INTO users(id,apple_sub,created_at,timezone) VALUES (?1,?1,1,?2)').bind(id, 'UTC').run();
  return { id, sessionId, jwt: await issueAppJwt(id, 'test-secret', { sessionId }) };
}

let garminIds = 0;
async function connect(userId: string, opts: {
  garminUserId?: string; expiresAt?: number | null; permissions?: string[];
} = {}) {
  const garminUserId = opts.garminUserId ?? `g-${Date.now().toString(36)}-${garminIds++}`;
  const completion = await createGarminOAuthCompletion(env.DB, userId, 'session', {
    accessToken: 'access-1', refreshToken: 'refresh-1',
    expiresAt: opts.expiresAt === undefined ? now + 24 * HOUR : opts.expiresAt,
    providerUserId: garminUserId, permissions: opts.permissions ?? ['ACTIVITY_EXPORT', 'HEALTH_EXPORT'],
  }, env.CREDENTIAL_ENCRYPTION_KEY);
  expect(await finishGarminOAuth(env.DB, env, userId, 'session', completion)).toMatchObject({ connected: true });
  return garminUserId;
}

let activityIds = 1_000;
function fileUrl(activityId: string) {
  return `${API}/wellness-api/rest/activityFile?id=${activityId}&token=synthetic-${activityId}`;
}
function announced(garminUserId: string, over: Record<string, unknown> = {}) {
  const activityId = String(activityIds++);
  return {
    userId: garminUserId, summaryId: activityId, activityId: Number(activityId), fileType: 'FIT',
    callbackURL: fileUrl(activityId), startTimeInSeconds: Math.floor((now - 5 * HOUR) / 1000), manual: false,
    activityName: 'Morning Run', activityType: 'RUNNING', deviceName: 'Forerunner 945', ...over,
  };
}
const runFit = (start = new Date(now - 5 * HOUR).toISOString()) =>
  activityFit({ start, seconds: 1800, sport: 1, hr: 150, power: null, distanceM: 6000 });

/** Serves activity files by id; anything else is a 404. */
function fakeGarmin(files: Record<string, Uint8Array | number> = {}) {
  const calls: string[] = [];
  let refreshes = 0;
  const fetcher: GarminFetcher = async (input, init) => {
    const url = new URL(input);
    calls.push(`${init?.method ?? 'GET'} ${url.host}${url.pathname}`);
    if (url.host === 'diauth.garmin.com') {
      refreshes += 1;
      return Response.json({ access_token: `access-${refreshes + 1}`, refresh_token: `refresh-${refreshes + 1}`, expires_in: 86400 });
    }
    if (url.pathname === '/wellness-api/rest/activityFile') {
      const file = files[url.searchParams.get('id') ?? ''];
      if (file === undefined) return new Response(null, { status: 404 });
      return typeof file === 'number' ? new Response(null, { status: file }) : new Response(file, { status: 200 });
    }
    if (url.pathname === '/partner-gateway/rest/user/registration' && init?.method === 'DELETE') {
      return new Response(null, { status: 204 });
    }
    return new Response(null, { status: 404 });
  };
  return { fetcher, calls, refreshes: () => refreshes };
}

async function garminRows(userId: string) {
  return (await env.DB.prepare("SELECT * FROM external_activities WHERE user_id = ?1 AND source = 'garmin' ORDER BY id")
    .bind(userId).all<Record<string, any>>()).results;
}
async function fileRow(userId: string, activityId: string) {
  return env.DB.prepare('SELECT * FROM garmin_activity_files WHERE user_id = ?1 AND activity_id = ?2')
    .bind(userId, activityId).first<Record<string, any>>();
}
function push(body: unknown, over: { ip?: string; clientId?: string; path?: string } = {}) {
  return request(`https://test${over.path ?? PUSH_PATH}`, {
    method: 'POST', body: JSON.stringify(body),
    headers: {
      'content-type': 'application/json', 'garmin-client-id': over.clientId ?? env.GARMIN_CLIENT_ID!,
      'cf-connecting-ip': over.ip ?? GARMIN_IP,
    },
  });
}

describe('Garmin adapter', () => {
  it('builds a PKCE authorize URL', async () => {
    const challenge = await garminCodeChallenge('verifier-0123456789-0123456789-0123456789-01');
    expect(challenge).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const url = new URL(garminAuthorizeUrl('client', 'https://test/cb', 'state', challenge));
    expect(url.origin + url.pathname).toBe('https://connect.garmin.com/oauth2Confirm');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      response_type: 'code', client_id: 'client', code_challenge: challenge, code_challenge_method: 'S256',
      redirect_uri: 'https://test/cb', state: 'state',
    });
  });

  it('accepts pushes only from Garmin addresses and files only from Garmin', () => {
    expect(isGarminPushAddress('204.77.163.255')).toBe(true);
    expect(isGarminPushAddress('185.132.79.1')).toBe(true);
    expect(isGarminPushAddress('204.77.164.0')).toBe(false);
    expect(isGarminPushAddress('1.2.3.4')).toBe(false);
    expect(isGarminPushAddress('2001:db8::1')).toBe(false);
    expect(isGarminPushAddress(null)).toBe(false);
    expect(isGarminFileUrl(fileUrl('1'))).toBe(true);
    expect(isGarminFileUrl('http://apis.garmin.com/wellness-api/rest/activityFile?id=1')).toBe(false);
    expect(isGarminFileUrl('https://evil.example/wellness-api/rest/activityFile?id=1')).toBe(false);
    expect(isGarminFileUrl('https://apis.garmin.com:8443/wellness-api/rest/activityFile?id=1')).toBe(false);
    expect(isGarminFileUrl('https://u:p@apis.garmin.com/wellness-api/rest/activityFile?id=1')).toBe(false);
    expect(isGarminFileUrl('https://apis.garmin.com/wellness-api/rest/other?id=1')).toBe(false);
  });

  it('parses the notifications it uses and drops unusable entries', () => {
    const good = announced('g1');
    const files = parseGarminActivityFiles({ activityFiles: [
      good,
      { ...announced('g1'), callbackURL: 'https://evil.example/x' },
      { ...announced('g1'), userId: 'bad id!' },
      { ...announced('g1'), activityId: -4 },
      { ...announced('g1'), deviceName: 'Forerunner\n945', fileType: 'tcx' },
    ] });
    expect(files).toHaveLength(2);
    expect(files[0]).toMatchObject({ userId: 'g1', activityId: String(good.activityId), fileType: 'FIT',
      deviceName: 'Forerunner 945', activityType: 'RUNNING', manual: false });
    expect(files[1]).toMatchObject({ fileType: 'TCX', deviceName: 'Forerunner 945' });
    expect(parseGarminDeregistrations({ deregistrations: [{ userId: 'g1' }, { userId: 'g1' }, { userId: 7 }] }))
      .toEqual(['g1']);
    expect(parseGarminPermissionChanges({ userPermissionsChange: [
      { userId: 'g1', permissions: ['ACTIVITY_EXPORT'], changeTimeInSeconds: 20 },
      { userId: 'g1', permissions: [], changeTimeInSeconds: 10 },
    ] })).toEqual([{ userId: 'g1', permissions: ['ACTIVITY_EXPORT'] }]);
    expect(parseGarminActivityFiles('nope')).toEqual([]);
  });
});

describe('Garmin connect', () => {
  it('connects through start, callback and finish with PKCE', async () => {
    const user = await member();
    const start = await request('https://test/auth/garmin/start', { method: 'POST', headers: headers(user.jwt) });
    expect(start.status).toBe(200);
    expect(start.headers.get('Cache-Control')).toBe('no-store');
    const authorize = new URL((await start.json<{ authorize_url: string }>()).authorize_url);
    expect(authorize.searchParams.get('redirect_uri')).toBe('https://test/auth/garmin/callback');
    expect(authorize.searchParams.get('code_challenge_method')).toBe('S256');
    const state = authorize.searchParams.get('state')!;
    const challenge = authorize.searchParams.get('code_challenge')!;

    let tokenForm = '';
    fetchMock.get(AUTH).intercept({
      path: '/di-oauth2-service/oauth/token', method: 'POST',
      body: (b: string) => { tokenForm = b; return true; },
    }).reply(200, { access_token: 'synthetic-access', refresh_token: 'synthetic-refresh', expires_in: 86400 });
    fetchMock.get(API).intercept({ path: '/partner-gateway/rest/user/id' }).reply(200, { userId: 'garmin-user-1' });
    fetchMock.get(API).intercept({ path: '/partner-gateway/rest/user/permissions' })
      .reply(200, { permissions: ['HEALTH_EXPORT', 'ACTIVITY_EXPORT'] });
    const callback = await request(`https://test/auth/garmin/callback?code=abc&state=${state}`, { redirect: 'manual' });
    expect(callback.status).toBe(302);
    const location = new URL(callback.headers.get('Location')!);
    expect(location.protocol + location.host).toBe('tresfort:garmin-connected');
    const completion = location.searchParams.get('completion');
    expect(completion).toMatch(/^[A-Za-z0-9_-]{43}$/);

    // The verifier sent with the code is the one the challenge was made from.
    const form = new URLSearchParams(tokenForm);
    expect(form.get('grant_type')).toBe('authorization_code');
    expect(form.get('client_secret')).toBe(env.GARMIN_CLIENT_SECRET);
    expect(form.get('redirect_uri')).toBe('https://test/auth/garmin/callback');
    expect(await garminCodeChallenge(form.get('code_verifier')!)).toBe(challenge);
    const sealed = await env.DB.prepare(`SELECT COUNT(*) AS n FROM provider_oauth_states WHERE user_id = ?1`)
      .bind(user.id).first<{ n: number }>();
    expect(sealed!.n).toBe(0);

    // The state is single use.
    const replay = await request(`https://test/auth/garmin/callback?code=abc&state=${state}`, { redirect: 'manual' });
    expect(replay.headers.get('Location')).toBe('tresfort://garmin-connected?error=bad_state');

    // Another app session cannot redeem the completion.
    const other = await issueAppJwt(user.id, 'test-secret', { sessionId: sid() });
    const stolen = await request('https://test/auth/garmin/finish', {
      method: 'POST', headers: headers(other), body: JSON.stringify({ completion }) });
    expect(stolen.status).toBe(400);

    const finish = await request('https://test/auth/garmin/finish', {
      method: 'POST', headers: headers(user.jwt), body: JSON.stringify({ completion }) });
    expect(finish.status).toBe(200);
    expect(await finish.json()).toEqual({ connected: true, activity_permission: true });
    const stored = await env.DB.prepare(`SELECT access_token, refresh_token, provider_user_id, scopes
        FROM provider_connections WHERE user_id = ?1 AND provider = 'garmin'`)
      .bind(user.id).first<Record<string, string>>();
    expect(stored).toMatchObject({ provider_user_id: 'garmin-user-1', scopes: 'ACTIVITY_EXPORT HEALTH_EXPORT' });
    expect(stored!.access_token).toMatch(/^sealed:v1:/);
    expect(JSON.stringify(stored)).not.toContain('synthetic');

    const status = await request('https://test/api/me/garmin', { headers: headers(user.jwt) });
    expect(await status.json()).toMatchObject({ configured: true, connected: true, activity_permission: true, needs_reauth: false });
  });

  it('reports a declined authorization and a missing refresh token back to the app', async () => {
    const declined = await request('https://test/auth/garmin/callback?error=access_denied&state=x', { redirect: 'manual' });
    expect(declined.headers.get('Location')).toBe('tresfort://garmin-connected?error=access_denied');

    const user = await member();
    const start = await request('https://test/auth/garmin/start', { method: 'POST', headers: headers(user.jwt) });
    const state = new URL((await start.json<{ authorize_url: string }>()).authorize_url).searchParams.get('state')!;
    fetchMock.get(AUTH).intercept({ path: '/di-oauth2-service/oauth/token', method: 'POST' })
      .reply(200, { access_token: 'synthetic-access', expires_in: 86400 });
    const r = await request(`https://test/auth/garmin/callback?code=abc&state=${state}`, { redirect: 'manual' });
    expect(r.headers.get('Location')).toBe('tresfort://garmin-connected?error=no_refresh_token');
  });

  it('refuses a Garmin account already linked to another member', async () => {
    const a = await member(), b = await member();
    await connect(a.id, { garminUserId: 'shared-garmin' });
    const completion = await createGarminOAuthCompletion(env.DB, b.id, 's', {
      accessToken: 'x', refreshToken: 'y', expiresAt: null, providerUserId: 'shared-garmin', permissions: [],
    }, env.CREDENTIAL_ENCRYPTION_KEY);
    expect(await finishGarminOAuth(env.DB, env, b.id, 's', completion)).toEqual({ error: 'account_in_use' });
  });

  it('refreshes an expiring token once and keeps the rotated refresh token', async () => {
    const user = await member();
    await connect(user.id, { expiresAt: now + 60_000 });
    const fake = fakeGarmin();
    expect(await garminAccessToken(env.DB, env, user.id, fake.fetcher)).toMatchObject({ ok: true, token: 'access-2' });
    expect(await garminAccessToken(env.DB, env, user.id, fake.fetcher)).toMatchObject({ ok: true, token: 'access-2' });
    expect(fake.refreshes()).toBe(1);
  });

  it('disconnects, tells Garmin, and forgets the member’s Garmin workouts', async () => {
    const user = await member();
    const garminUserId = await connect(user.id);
    const file = announced(garminUserId);
    await queueGarminActivityFiles(env.DB, env, parseGarminActivityFiles({ activityFiles: [file] }));
    await processGarminFiles(env.DB, env, { userId: user.id, fetcher: fakeGarmin({ [file.activityId]: runFit() }).fetcher });
    expect(await garminRows(user.id)).toHaveLength(1);

    fetchMock.get(API).intercept({ path: '/partner-gateway/rest/user/registration', method: 'DELETE' }).reply(204, '');
    const r = await request('https://test/api/me/garmin', { method: 'DELETE', headers: headers(user.jwt) });
    expect(await r.json()).toEqual({ disconnected: true, garmin_notified: true });
    expect(await getGarminStatus(env.DB, env, user.id)).toMatchObject({ connected: false });
    const [row] = await garminRows(user.id);
    expect(row!.deleted_at).not.toBeNull();
    const hr = await env.DB.prepare('SELECT COUNT(*) AS n FROM activity_heart_rates WHERE user_id = ?1')
      .bind(user.id).first<{ n: number }>();
    expect(hr!.n).toBe(0);
    const power = await env.DB.prepare('SELECT COUNT(*) AS n FROM activity_power_series WHERE user_id = ?1')
      .bind(user.id).first<{ n: number }>();
    expect(power!.n).toBe(0);
    expect(await disconnectGarmin(env.DB, env, user.id, fakeGarmin().fetcher))
      .toEqual({ disconnected: false, garmin_notified: false });
  });
});

describe('Garmin push', () => {
  it('answers only a push at the secret path, from Garmin, for this app', async () => {
    expect((await push({}, { path: '/webhooks/garmin/wrong-secret' })).status).toBe(404);
    expect((await push({}, { clientId: 'someone-else' })).status).toBe(403);
    expect((await push({}, { ip: '1.2.3.4' })).status).toBe(403);
    expect((await push({ deregistrations: [] })).status).toBe(200);
    // A body that is not JSON is acknowledged so Garmin stops retrying it.
    const garbled = await request(`https://test${PUSH_PATH}`, { method: 'POST', body: '{', headers: {
      'garmin-client-id': env.GARMIN_CLIENT_ID!, 'cf-connecting-ip': GARMIN_IP } });
    expect(garbled.status).toBe(200);
  });

  it('queues an announced workout, answers, then imports the file', async () => {
    const user = await member();
    const garminUserId = await connect(user.id);
    const file = announced(garminUserId);
    fetchMock.get(API).intercept({ path: `/wellness-api/rest/activityFile?id=${file.activityId}&token=synthetic-${file.activityId}` })
      .reply(200, Buffer.from(runFit()));
    const r = await push({ activityFiles: [file, announced('someone-not-connected')] });
    expect(r.status).toBe(200);
    const queued = await fileRow(user.id, String(file.activityId));
    expect(queued!.callback_url).toMatch(/^sealed:v1:/);
    expect(queued!.callback_url).not.toContain('synthetic');
    await settle();
    expect(await fileRow(user.id, String(file.activityId))).toMatchObject({ outcome: 'imported', attempts: 1 });
    const [row] = await garminRows(user.id);
    expect(row).toMatchObject({ kind: 'run', name: 'Morning Run', external_id: String(file.activityId),
      moving_time_sec: 1800, average_hr: 150, deleted_at: null });
    expect(await getGarminStatus(env.DB, env, user.id)).toMatchObject({ last_synced_at: expect.any(Number) });

    // The member sees it, attributed to the device.
    const state = await getState(env.DB, user.id, 0, 0);
    const mine = state.external_activities.find((a: { id: string }) => a.id === row!.id);
    expect(mine).toMatchObject({ source_attribution: 'Garmin Forerunner 945' });
  });

  it('records why a file could not be imported, and retries a failed download', async () => {
    const user = await member();
    const garminUserId = await connect(user.id);
    const gone = announced(garminUserId), tcx = announced(garminUserId, { fileType: 'TCX' });
    const broken = announced(garminUserId), flaky = announced(garminUserId);
    await queueGarminActivityFiles(env.DB, env, parseGarminActivityFiles({ activityFiles: [gone, tcx, broken, flaky] }));
    const first = fakeGarmin({
      [gone.activityId]: 410, [broken.activityId]: new Uint8Array([1, 2, 3]), [flaky.activityId]: 503,
    });
    const run = await processGarminFiles(env.DB, env, { userId: user.id, fetcher: first.fetcher });
    expect(run).toEqual({ imported: 0, failed: 3, pending: 1 });
    expect(await fileRow(user.id, String(gone.activityId))).toMatchObject({ outcome: 'gone' });
    expect(await fileRow(user.id, String(tcx.activityId))).toMatchObject({ outcome: 'unsupported' });
    expect(await fileRow(user.id, String(broken.activityId))).toMatchObject({ outcome: 'invalid' });
    expect(await fileRow(user.id, String(flaky.activityId))).toMatchObject({ outcome: null, lease_until: null, attempts: 1 });
    // A TCX file is never downloaded.
    expect(first.calls.filter(c => c.includes('activityFile'))).toHaveLength(3);

    // The cron retries the one still pending.
    const retry = await runGarminCron(env.DB, env, Date.now(), { fetcher: fakeGarmin({ [flaky.activityId]: runFit() }).fetcher });
    expect(retry.failed).toBe(false);
    expect(await fileRow(user.id, String(flaky.activityId))).toMatchObject({ outcome: 'imported', attempts: 2 });
    expect(await garminRows(user.id)).toHaveLength(1);

    // A link past its lifetime is given up on without a download.
    const late = announced(garminUserId);
    await queueGarminActivityFiles(env.DB, env, parseGarminActivityFiles({ activityFiles: [late] }), now - 24 * HOUR);
    const lateRun = fakeGarmin({ [late.activityId]: runFit() });
    await processGarminFiles(env.DB, env, { userId: user.id, fetcher: lateRun.fetcher });
    expect(await fileRow(user.id, String(late.activityId))).toMatchObject({ outcome: 'gone' });
    expect(lateRun.calls).toEqual([]);
  });

  it('keeps a downloaded workout when its import fails, and imports it later without downloading again', async () => {
    const user = await member();
    const garminUserId = await connect(user.id);
    const file = announced(garminUserId);
    const activityId = String(file.activityId);
    await queueGarminActivityFiles(env.DB, env, parseGarminActivityFiles({ activityFiles: [file] }));
    await env.DB.prepare(`CREATE TRIGGER garmin_test_fail BEFORE INSERT ON external_activities
        WHEN NEW.source = 'garmin' BEGIN SELECT RAISE(ABORT, 'synthetic failure'); END`).run();
    try {
      const first = await processGarminFiles(env.DB, env, { userId: user.id, fetcher: fakeGarmin({ [activityId]: runFit() }).fetcher });
      expect(first).toEqual({ imported: 0, failed: 0, pending: 1 });
    } finally {
      await env.DB.prepare('DROP TRIGGER garmin_test_fail').run();
    }
    const staged = await fileRow(user.id, activityId);
    expect(staged).toMatchObject({ outcome: null, lease_until: null, attempts: 1 });
    expect(JSON.parse(staged!.workout)).toMatchObject({ v: 1, kind: 'run', avg_hr: 150 });

    // The link has expired and Garmin would now answer 410; the staged copy is used instead.
    await env.DB.prepare('UPDATE garmin_activity_files SET received_at = ?3 WHERE user_id = ?1 AND activity_id = ?2')
      .bind(user.id, activityId, now - 30 * HOUR).run();
    const later = fakeGarmin({ [activityId]: 410 });
    const retry = await runGarminCron(env.DB, env, Date.now(), { fetcher: later.fetcher });
    expect(retry).toEqual({ failed: false, files: 1 });
    expect(later.calls).toEqual([]);
    expect(await fileRow(user.id, activityId)).toMatchObject({ outcome: 'imported', workout: null, attempts: 2 });
    const [row] = await garminRows(user.id);
    expect(row).toMatchObject({ kind: 'run', average_hr: 150, deleted_at: null });
    const hr = await env.DB.prepare('SELECT point_count FROM activity_heart_rates WHERE activity_id = ?1')
      .bind(row!.id).first<{ point_count: number }>();
    expect(hr!.point_count).toBeGreaterThan(0);
  });

  it('keeps a staged workout when Garmin announces the file again', async () => {
    const user = await member();
    const garminUserId = await connect(user.id);
    const file = announced(garminUserId);
    const activityId = String(file.activityId);
    await queueGarminActivityFiles(env.DB, env, parseGarminActivityFiles({ activityFiles: [file] }));
    await env.DB.prepare(`CREATE TRIGGER garmin_test_fail2 BEFORE INSERT ON external_activities
        WHEN NEW.source = 'garmin' BEGIN SELECT RAISE(ABORT, 'synthetic failure'); END`).run();
    try {
      await processGarminFiles(env.DB, env, { userId: user.id, fetcher: fakeGarmin({ [activityId]: runFit() }).fetcher });
    } finally {
      await env.DB.prepare('DROP TRIGGER garmin_test_fail2').run();
    }
    await queueGarminActivityFiles(env.DB, env, parseGarminActivityFiles({ activityFiles: [file] }));
    expect(await fileRow(user.id, activityId)).toMatchObject({ attempts: 1, workout: expect.any(String) });
    const retry = fakeGarmin({ [activityId]: 410 });
    await processGarminFiles(env.DB, env, { userId: user.id, fetcher: retry.fetcher });
    expect(retry.calls).toEqual([]);
    expect(await fileRow(user.id, activityId)).toMatchObject({ outcome: 'imported' });
  });

  it('never lets a run whose lease lapsed overwrite the run that claimed the file next', async () => {
    const user = await member();
    const garminUserId = await connect(user.id);
    const file = announced(garminUserId);
    const activityId = String(file.activityId);
    await queueGarminActivityFiles(env.DB, env, parseGarminActivityFiles({ activityFiles: [file] }));
    const slow = fakeGarmin({ [activityId]: runFit() });
    const stalling: GarminFetcher = async (input, init) => {
      if (input.includes('activityFile')) {
        // Three minutes later another run finds the lease expired and claims the file.
        await processGarminFiles(env.DB, env, { userId: user.id, now: Date.now() + 3 * 60_000,
          fetcher: fakeGarmin({ [activityId]: 410 }).fetcher });
      }
      return slow.fetcher(input, init);
    };
    await processGarminFiles(env.DB, env, { userId: user.id, fetcher: stalling });
    expect(await fileRow(user.id, activityId)).toMatchObject({ outcome: 'gone', attempts: 2, workout: null });
    // The first run still had the file, so the workout is kept.
    expect(await garminRows(user.id)).toHaveLength(1);
  });

  it('never imports a workout after the member stops sharing activities mid-download', async () => {
    const user = await member();
    const garminUserId = await connect(user.id);
    const file = announced(garminUserId);
    await queueGarminActivityFiles(env.DB, env, parseGarminActivityFiles({ activityFiles: [file] }));
    const inner = fakeGarmin({ [file.activityId]: runFit() });
    const racing: GarminFetcher = async (input, init) => {
      if (input.includes('activityFile')) {
        await handleGarminPermissionChanges(env.DB, [{ userId: garminUserId, permissions: ['HEALTH_EXPORT'] }]);
      }
      return inner.fetcher(input, init);
    };
    await processGarminFiles(env.DB, env, { userId: user.id, fetcher: racing });
    expect(await garminRows(user.id)).toHaveLength(0);
    const hr = await env.DB.prepare('SELECT COUNT(*) AS n FROM activity_heart_rates WHERE user_id = ?1')
      .bind(user.id).first<{ n: number }>();
    expect(hr!.n).toBe(0);
  });

  it('imports a workout once even when Garmin announces it again', async () => {
    const user = await member();
    const garminUserId = await connect(user.id);
    const file = announced(garminUserId);
    const fake = fakeGarmin({ [file.activityId]: runFit() });
    for (let i = 0; i < 2; i++) {
      await queueGarminActivityFiles(env.DB, env, parseGarminActivityFiles({ activityFiles: [file] }));
      await processGarminFiles(env.DB, env, { userId: user.id, fetcher: fake.fetcher });
    }
    expect(await garminRows(user.id)).toHaveLength(1);
    expect(fake.calls.filter(c => c.includes('activityFile'))).toHaveLength(1);
  });

  it('drops the member when Garmin deregisters them', async () => {
    const user = await member();
    const garminUserId = await connect(user.id);
    const file = announced(garminUserId);
    await queueGarminActivityFiles(env.DB, env, parseGarminActivityFiles({ activityFiles: [file] }));
    expect((await push({ deregistrations: [{ userId: garminUserId }] })).status).toBe(200);
    expect(await getGarminStatus(env.DB, env, user.id)).toMatchObject({ connected: false });
    expect(await fileRow(user.id, String(file.activityId))).toBeNull();
    expect(await handleGarminDeregistrations(env.DB, [garminUserId])).toBe(0);
  });

  it('stops taking workouts when the member stops sharing them', async () => {
    const user = await member();
    const garminUserId = await connect(user.id);
    const pending = announced(garminUserId);
    await queueGarminActivityFiles(env.DB, env, parseGarminActivityFiles({ activityFiles: [pending] }));
    expect(await handleGarminPermissionChanges(env.DB, [{ userId: garminUserId, permissions: ['HEALTH_EXPORT'] }])).toBe(1);
    expect(await getGarminStatus(env.DB, env, user.id)).toMatchObject({ connected: true, activity_permission: false });
    expect(await fileRow(user.id, String(pending.activityId))).toBeNull();
    const later = announced(garminUserId);
    expect(await queueGarminActivityFiles(env.DB, env, parseGarminActivityFiles({ activityFiles: [later] }))).toEqual([]);
    expect(await fileRow(user.id, String(later.activityId))).toBeNull();
  });

  it('never imports a file announced to a connection the member has since replaced', async () => {
    const user = await member();
    const garminUserId = await connect(user.id);
    const file = announced(garminUserId);
    await queueGarminActivityFiles(env.DB, env, parseGarminActivityFiles({ activityFiles: [file] }));
    const connectionId = (await fileRow(user.id, String(file.activityId)))!.connection_id;
    await connect(user.id, { garminUserId });
    // Reconnecting drops what the old connection queued; re-insert it to race.
    await env.DB.prepare(`INSERT INTO garmin_activity_files
        (user_id, activity_id, connection_id, callback_url, file_type, meta, received_at)
      SELECT id, ?2, ?3, 'sealed:v1:x', 'FIT', '{}', ?4 FROM users WHERE id = ?1`)
      .bind(user.id, String(file.activityId), connectionId, now).run();
    await processGarminFiles(env.DB, env, { userId: user.id, fetcher: fakeGarmin({ [file.activityId]: runFit() }).fetcher });
    expect(await fileRow(user.id, String(file.activityId))).toMatchObject({ outcome: 'disconnected' });
    expect(await garminRows(user.id)).toHaveLength(0);
  });
});

describe('Garmin dedup and privacy', () => {
  it('yields to an intervals.icu copy and wins over an Apple Health copy', async () => {
    const user = await member();
    const garminUserId = await connect(user.id);
    const start = now - 5 * HOUR;
    const date = new Date(start).toISOString().slice(0, 10);
    const ride = announced(garminUserId, { activityType: 'CYCLING', activityName: 'Ride' });
    const run = announced(garminUserId);
    const rideStart = now - 9 * HOUR;
    await env.DB.prepare(`INSERT INTO external_activities
        (id,user_id,source,external_id,date,start_date_local_ms,kind,name,moving_time_sec,elapsed_time_sec,
         synced_at,canonical,start_date_utc_ms,source_timezone)
      VALUES (?1,?2,'intervals','i1',?3,?4,'ride','Ride',3600,3600,1,1,?4,'UTC')`)
      .bind(`intervals:${user.id}:i1`, user.id, date, rideStart + 60_000).run();
    await queueGarminActivityFiles(env.DB, env, parseGarminActivityFiles({ activityFiles: [ride, run] }));
    await processGarminFiles(env.DB, env, { userId: user.id, fetcher: fakeGarmin({
      [ride.activityId]: activityFit({ start: new Date(rideStart).toISOString(), seconds: 3600, hr: 140, power: 200, distanceM: 30000 }),
      [run.activityId]: runFit(new Date(start).toISOString()),
    }).fetcher });
    const rows = await garminRows(user.id);
    const garminRide = rows.find(r => r.external_id === String(ride.activityId))!;
    const garminRun = rows.find(r => r.external_id === String(run.activityId))!;
    expect(garminRide).toMatchObject({ duplicate_of: `intervals:${user.id}:i1`, canonical: 0 });
    // The ride's power is kept behind the intervals.icu copy (run-detail-charts P7).
    const power = await env.DB.prepare('SELECT point_count FROM activity_power_series WHERE activity_id = ?1')
      .bind(garminRide.id).first<{ point_count: number }>();
    expect(power?.point_count).toBe(3600);
    expect(garminRun).toMatchObject({ deleted_at: null, canonical: 1 });

    const copy = await upsertHealthKitActivity(env.DB, user.id, {
      id: crypto.randomUUID(), date, start_date_local_ms: start, start_date_utc_ms: start,
      source_timezone: 'UTC', kind: 'run', name: 'Run', moving_time_sec: 1800, elapsed_time_sec: 1800,
      distance_m: 6000, average_watts: null, average_hr: null, max_hr: null, calories: null,
      elevation_gain_m: null, raw: null,
    });
    expect(copy).toMatchObject({ duplicate_of: garminRun.id, canonical: 0 });
  });

  it('keeps Garmin workouts out of the coach and the group feed', async () => {
    const user = await member();
    const garminUserId = await connect(user.id);
    const file = announced(garminUserId);
    await queueGarminActivityFiles(env.DB, env, parseGarminActivityFiles({ activityFiles: [file] }));
    await processGarminFiles(env.DB, env, { userId: user.id, fetcher: fakeGarmin({ [file.activityId]: runFit() }).fetcher });
    expect(await garminRows(user.id)).toHaveLength(1);
    expect(await getRecentActivities(env.DB, user.id, { to: '2099-01-01', range: 100_000 })).toEqual([]);
    const group = await createGroup(env.DB, user.id, 'test');
    const feed = await getGroupFeed(env.DB, group.id, null, null, 25, user.id);
    expect(JSON.stringify(feed)).not.toContain('garmin:');
    expect(JSON.stringify(feed)).not.toContain('Morning Run');
  });

  it('is dormant until the Garmin secrets are set', async () => {
    const bare = { ...env, GARMIN_CLIENT_ID: undefined, GARMIN_CLIENT_SECRET: undefined, GARMIN_PUSH_SECRET: undefined };
    expect(await runGarminCron(env.DB, bare, Date.now())).toEqual({ failed: false, files: 0 });
    const user = await member();
    const context = createExecutionContext();
    const start = await worker.fetch(new Request('https://test/auth/garmin/start', {
      method: 'POST', headers: headers(user.jwt) }), bare, context);
    await waitOnExecutionContext(context);
    expect(start.status).toBe(503);
    const pushContext = createExecutionContext();
    const pushed = await worker.fetch(new Request(`https://test${PUSH_PATH}`, { method: 'POST', body: '{}', headers: {
      'garmin-client-id': 'test-garmin-client', 'cf-connecting-ip': GARMIN_IP } }), bare, pushContext);
    await waitOnExecutionContext(pushContext);
    expect(pushed.status).toBe(404);
  });
});
