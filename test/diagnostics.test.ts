// Owner diagnostics (docs/DIAGNOSTICS.md): the recorder's pauses and GPS
// speed readings kept with a recorded run (run-recorder P5(e), migration
// 0076), and the owner's fixed read-only lookups behind DIAGNOSTICS_TOKEN
// and the owner's own app session. Garmin and WHOOP data and other members'
// data never come back.
import { env, applyD1Migrations, SELF } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { issueAppJwt } from '../src/auth';
import { runWorkoutWriteBatch } from '../src/workout-write-fence';
import {
  decodeSpeeds,
  parseRecordingDiagnostics,
  serializeRecordingDiagnostics,
  type RecordingDiagnostics,
} from '../src/recordingDiagnostics';
import { diagnosticsDays, diagnosticsSince } from '../src/services/diagnostics';

const BASE = 'https://tres-fort.test';
const TOKEN = 'test-diagnostics-token-0123456789abcdef';
const TODAY = new Date().toISOString().slice(0, 10);
const START_MS = Date.parse(`${TODAY}T00:30:00Z`);

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});

const iso = (ms: number) => new Date(ms).toISOString().replace('.000Z', 'Z');

/** A run with a point every 10 s and one pause (a new track). */
function tcx(): string {
  const point = (i: number) =>
    `<Trackpoint><Time>${iso(START_MS + i * 10_000)}</Time><Position><LatitudeDegrees>${(45.5 + i * 0.0001).toFixed(7)}`
    + `</LatitudeDegrees><LongitudeDegrees>-122.6000000</LongitudeDegrees></Position>`
    + `<HeartRateBpm><Value>150</Value></HeartRateBpm></Trackpoint>`;
  const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, k) => point(from + k)).join('');
  return '<?xml version="1.0"?><TrainingCenterDatabase><Activities><Activity Sport="Running">'
    + `<Id>${iso(START_MS)}</Id><Lap StartTime="${iso(START_MS)}"><TotalTimeSeconds>500</TotalTimeSeconds>`
    + '<DistanceMeters>1500</DistanceMeters><Intensity>Active</Intensity><TriggerMethod>Manual</TriggerMethod>'
    + `<Track>${range(0, 30)}</Track><Track>${range(40, 60)}</Track>`
    + '</Lap></Activity></Activities></TrainingCenterDatabase>';
}

/** A tapped pause, then an automatic one, and three fixes. */
const DIAGNOSTICS: RecordingDiagnostics = {
  v: 1,
  auto_pause: true,
  pauses: [
    { start_ms: START_MS + 300_000, end_ms: START_MS + 400_000, automatic: false },
    { start_ms: START_MS + 450_000, end_ms: START_MS + 455_500, automatic: true },
  ],
  speeds: { start_ms: START_MS, dt_ms: [0, 1000, 1000], speed_cms: [350, null, 12], accuracy_dm: [50, 48, 120] },
};

describe('diagnostics format', () => {
  it('keeps well-formed diagnostics and decodes the fixes', () => {
    const parsed = parseRecordingDiagnostics(JSON.stringify(DIAGNOSTICS));
    expect(parsed).toEqual(DIAGNOSTICS);
    expect(parseRecordingDiagnostics(serializeRecordingDiagnostics(parsed!))).toEqual(DIAGNOSTICS);
    expect(decodeSpeeds(DIAGNOSTICS.speeds!)).toEqual([
      { t_ms: START_MS, speed_mps: 3.5, accuracy_m: 5 },
      { t_ms: START_MS + 1000, speed_mps: null, accuracy_m: 4.8 },
      { t_ms: START_MS + 2000, speed_mps: 0.12, accuracy_m: 12 },
    ]);
    // A pause still open at the end, and no speeds.
    expect(parseRecordingDiagnostics({
      v: 1, auto_pause: null, pauses: [{ start_ms: START_MS, end_ms: null, automatic: true }], speeds: null,
    })).not.toBeNull();
  });

  it('keeps the motion level around each fix when the app sends it', () => {
    const withMotion: RecordingDiagnostics = {
      ...DIAGNOSTICS,
      speeds: { ...DIAGNOSTICS.speeds!, motion_mg: [412, null, 18] },
    };
    const parsed = parseRecordingDiagnostics(JSON.stringify(withMotion));
    expect(parsed).toEqual(withMotion);
    expect(parseRecordingDiagnostics(serializeRecordingDiagnostics(parsed!))).toEqual(withMotion);
    expect(decodeSpeeds(withMotion.speeds!).map((fix) => fix.motion_g)).toEqual([0.412, null, 0.018]);
    // Runs from before motion levels decode as they did.
    expect(decodeSpeeds(DIAGNOSTICS.speeds!).some((fix) => 'motion_g' in fix)).toBe(false);
  });

  it('refuses diagnostics that are not well formed', () => {
    const [tapped, auto] = DIAGNOSTICS.pauses as [RecordingDiagnostics['pauses'][0], RecordingDiagnostics['pauses'][0]];
    const speeds = DIAGNOSTICS.speeds!;
    const bad: unknown[] = [
      'not json',
      {},
      { ...DIAGNOSTICS, v: 2 },
      { ...DIAGNOSTICS, extra: 1 },
      { ...DIAGNOSTICS, auto_pause: 'yes' },
      { v: 1, auto_pause: null, pauses: [], speeds: null },
      { ...DIAGNOSTICS, pauses: [{ ...tapped, automatic: 'no' }] },
      { ...DIAGNOSTICS, pauses: [{ ...tapped, end_ms: tapped.start_ms - 1 }] },
      { ...DIAGNOSTICS, pauses: [{ ...tapped, end_ms: null }, auto] },
      { ...DIAGNOSTICS, pauses: [auto, tapped] },
      { ...DIAGNOSTICS, pauses: [{ ...tapped, start_ms: 5 }] },
      { ...DIAGNOSTICS, speeds: { ...speeds, dt_ms: [1, 1000, 1000] } },
      { ...DIAGNOSTICS, speeds: { ...speeds, dt_ms: [0, -1, 1000] } },
      { ...DIAGNOSTICS, speeds: { ...speeds, speed_cms: [350, 12] } },
      { ...DIAGNOSTICS, speeds: { ...speeds, speed_cms: [350, -1, 12] } },
      { ...DIAGNOSTICS, speeds: { ...speeds, accuracy_dm: [50, null, 120] } },
      { ...DIAGNOSTICS, speeds: { ...speeds, dt_ms: [] , speed_cms: [], accuracy_dm: [] } },
      { ...DIAGNOSTICS, speeds: { ...speeds, motion_mg: [412, 18] } },
      { ...DIAGNOSTICS, speeds: { ...speeds, motion_mg: [412, -1, 18] } },
      { ...DIAGNOSTICS, speeds: { ...speeds, motion_mg: [412, 20_001, 18] } },
      { ...DIAGNOSTICS, speeds: { ...speeds, motion_mg: 'x' } },
    ];
    for (const value of bad) expect(parseRecordingDiagnostics(value), JSON.stringify(value).slice(0, 160)).toBeNull();
  });

  it('reads day windows', () => {
    expect(diagnosticsSince('2026-11-11', 1)).toBe('2026-11-11');
    expect(diagnosticsSince('2026-03-01', 2)).toBe('2026-02-28');
    expect(diagnosticsDays(undefined, 14, 90)).toBe(14);
    expect(diagnosticsDays('90', 14, 90)).toBe(90);
    for (const value of ['0', '91', 'x', '1.5', '-1']) expect(diagnosticsDays(value, 14, 90)).toBeNull();
  });
});

async function ownerJwt(): Promise<{ id: string; jwt: string }> {
  const r = await SELF.fetch(`${BASE}/auth/dev`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ secret: 'test-dev' }),
  });
  expect(r.status).toBe(200);
  const body = await r.json<{ jwt: string; user: { id: string } }>();
  return { id: body.user.id, jwt: body.jwt };
}

async function memberJwt(): Promise<{ id: string; jwt: string }> {
  await ownerJwt();
  const id = crypto.randomUUID();
  await env.DB.prepare('INSERT INTO users (id,apple_sub,created_at) VALUES (?1,?1,?2)').bind(id, Date.now()).run();
  return { id, jwt: await issueAppJwt(id, 'test-secret') };
}

async function upload(jwt: string, fields: Record<string, string>) {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  form.append('file', new Blob([tcx()]), `${fields.id}.tcx`);
  const r = await SELF.fetch(`${BASE}/api/activities/recordings`, {
    method: 'POST', headers: { Authorization: `Bearer ${jwt}` }, body: form,
  });
  return { status: r.status, body: await r.json<any>() };
}

/** The owner's test account has intervals.icu credentials and no network,
 * so its upload keeps the run and reports the intervals.icu copy failed. */
async function uploadAsOwner(jwt: string, fields: Record<string, string>) {
  const res = await upload(jwt, fields);
  // 201 when kept and copied, or the intervals.icu error with `stored: true`.
  expect(res.status === 201 || res.body.stored === true, JSON.stringify(res.body)).toBe(true);
}

async function lookup(path: string, bearer = TOKEN) {
  const r = await SELF.fetch(`${BASE}/diagnostics${path}`, { headers: { Authorization: `Bearer ${bearer}` } });
  return { status: r.status, body: await r.json<any>(), cache: r.headers.get('Cache-Control') };
}

const diagnosticsRows = async (activityId: string) => (await env.DB
  .prepare('SELECT COUNT(*) AS n FROM recording_diagnostics WHERE activity_id = ?1')
  .bind(activityId).first<{ n: number }>())!.n;

describe('recorder diagnostics with a recorded run', () => {
  it('keeps them, never replaces them on a retry, exports them and deletes them with the run', async () => {
    const member = await memberJwt();
    const id = crypto.randomUUID();
    const activityId = `recording:activity:${member.id}:${id}`;
    expect((await upload(member.jwt, { id, date: TODAY, diagnostics: JSON.stringify(DIAGNOSTICS) })).status).toBe(201);
    const row = await env.DB.prepare('SELECT pause_count, fix_count, diagnostics FROM recording_diagnostics WHERE activity_id = ?1')
      .bind(activityId).first<{ pause_count: number; fix_count: number; diagnostics: string }>();
    expect(row).toMatchObject({ pause_count: 2, fix_count: 3 });
    expect(JSON.parse(row!.diagnostics)).toEqual(DIAGNOSTICS);

    const changed = { ...DIAGNOSTICS, auto_pause: false };
    expect((await upload(member.jwt, { id, date: TODAY, diagnostics: JSON.stringify(changed) })).status).toBe(200);
    const kept = await env.DB.prepare('SELECT diagnostics FROM recording_diagnostics WHERE activity_id = ?1')
      .bind(activityId).first<{ diagnostics: string }>();
    expect(JSON.parse(kept!.diagnostics).auto_pause).toBe(true);

    const exported = await SELF.fetch(`${BASE}/api/me/export`, { headers: { Authorization: `Bearer ${member.jwt}` } });
    const training = (await exported.json<any>()).training;
    expect(training.recording_diagnostics.find((x: any) => x.activity_id === activityId).diagnostics).toEqual(DIAGNOSTICS);

    const deleted = await SELF.fetch(`${BASE}/api/activities/recordings/${id}`, {
      method: 'DELETE', headers: { Authorization: `Bearer ${member.jwt}` },
    });
    expect(deleted.status).toBe(200);
    expect(await diagnosticsRows(activityId)).toBe(0);
    expect((await upload(member.jwt, { id, date: TODAY, diagnostics: JSON.stringify(DIAGNOSTICS) })).body)
      .toMatchObject({ deleted: true });
    expect(await diagnosticsRows(activityId)).toBe(0);
  });

  it('fills diagnostics a first attempt left out', async () => {
    const member = await memberJwt();
    const id = crypto.randomUUID();
    const activityId = `recording:activity:${member.id}:${id}`;
    expect((await upload(member.jwt, { id, date: TODAY })).status).toBe(201);
    expect(await diagnosticsRows(activityId)).toBe(0);
    expect((await upload(member.jwt, { id, date: TODAY, diagnostics: JSON.stringify(DIAGNOSTICS) })).status).toBe(200);
    expect(await diagnosticsRows(activityId)).toBe(1);
  });

  it('keeps the run without malformed diagnostics, so they never block an upload', async () => {
    const member = await memberJwt();
    const tooLong = { ...DIAGNOSTICS, speeds: { ...DIAGNOSTICS.speeds!, dt_ms: [0, 86_400_001, 0] } };
    for (const diagnostics of ['{', '{}', JSON.stringify({ ...DIAGNOSTICS, v: 3 }), JSON.stringify(tooLong)]) {
      const id = crypto.randomUUID();
      const res = await upload(member.jwt, { id, date: TODAY, diagnostics });
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ ok: true, diagnostics_ignored: true });
      expect(await diagnosticsRows(`recording:activity:${member.id}:${id}`)).toBe(0);
    }
    // Well-formed ones say nothing.
    const fine = await upload(member.jwt, { id: crypto.randomUUID(), date: TODAY, diagnostics: JSON.stringify(DIAGNOSTICS) });
    expect(fine.body.diagnostics_ignored).toBeUndefined();
  });
});

describe('owner diagnostics lookups', () => {
  it('needs the token, and only the owner session may use the web door', async () => {
    const owner = await ownerJwt();
    expect((await SELF.fetch(`${BASE}/diagnostics/recordings`)).status).toBe(401);
    expect((await lookup('/recordings', 'wrong-token-wrong-token-wrong-token-x')).status).toBe(401);
    // The owner's app session is not the diagnostics token, and vice versa.
    expect((await lookup('/recordings', owner.jwt)).status).toBe(401);
    const member = await memberJwt();
    const asMember = await SELF.fetch(`${BASE}/api/me/diagnostics/recordings`, {
      headers: { Authorization: `Bearer ${member.jwt}` },
    });
    expect(asMember.status).toBe(404);
    const asOwner = await SELF.fetch(`${BASE}/api/me/diagnostics/recordings`, {
      headers: { Authorization: `Bearer ${owner.jwt}` },
    });
    expect(asOwner.status).toBe(200);
    expect((await lookup('/recordings?days=91')).status).toBe(400);
    const index = await lookup('');
    expect(Object.keys(index.body.lookups)).toEqual(
      ['recordings', 'activities', 'activities/:id', 'sessions', 'audit', 'sync', 'reports', 'reports/:id', 'reports/:id/screenshot'],
    );
  });

  it("shows the owner's runs with tapped and automatic pauses, never another member's", async () => {
    const owner = await ownerJwt();
    const id = crypto.randomUUID();
    const activityId = `recording:activity:${owner.id}:${id}`;
    await uploadAsOwner(owner.jwt, { id, date: TODAY, diagnostics: JSON.stringify(DIAGNOSTICS) });
    const member = await memberJwt();
    const theirs = crypto.randomUUID();
    expect((await upload(member.jwt, { id: theirs, date: TODAY })).status).toBe(201);

    const list = await lookup('/recordings');
    expect(list.status).toBe(200);
    expect(list.cache).toBe('no-store');
    const mine = list.body.recordings.find((r: any) => r.id === activityId);
    expect(mine).toMatchObject({ recording_id: id, state: 'shown', pause_count: 2, fix_count: 3, has_diagnostics: true });
    expect(list.body.recordings.some((r: any) => r.recording_id === theirs)).toBe(false);
    const theirId = `recording:activity:${member.id}:${theirs}`;
    expect((await lookup(`/activities/${encodeURIComponent(theirId)}`)).status).toBe(404);

    const detail = await lookup(`/activities/${encodeURIComponent(activityId)}`);
    expect(detail.status).toBe(200);
    expect(detail.body.activity).toMatchObject({ id: activityId, source: 'recording', state: 'shown' });
    const run = detail.body.run_details.find((d: any) => d.activity_id === activityId);
    expect(run.recorder.auto_pause_on).toBe(true);
    expect(run.recorder.pauses.map((p: any) => [p.tapped, p.duration_s])).toEqual([[true, 100], [false, 5.5]]);
    expect(run.recorder.gps_fixes).toHaveLength(3);
    expect(run.route_segments.map((s: any[]) => s.length)).toEqual([31, 21]);
    expect(run.heart_rate.readings.length).toBeGreaterThan(0);

    // Each lookup leaves an audit record, which the audit lookup itself skips.
    const reads = await env.DB.prepare(
      "SELECT actor, args FROM audit_log WHERE user_id = ?1 AND tool = 'diagnostics_read' ORDER BY created_at",
    ).bind(owner.id).all<{ actor: string; args: string }>();
    expect(reads.results.map((r) => r.actor).every((a) => a === 'diagnostics')).toBe(true);
    expect(reads.results.some((r) => JSON.parse(r.args).id === activityId)).toBe(true);
    const audit = await lookup('/audit');
    expect(audit.body.records.some((r: any) => r.tool === 'diagnostics_read')).toBe(false);
  });

  it('marks a run merged into its intervals.icu copy, and links the copies', async () => {
    const owner = await ownerJwt();
    const id = crypto.randomUUID();
    const recording = `recording:activity:${owner.id}:${id}`;
    await uploadAsOwner(owner.jwt, { id, date: TODAY, diagnostics: JSON.stringify(DIAGNOSTICS) });
    const copy = `intervals:test-copy-${id}`;
    await env.DB.prepare(
      `INSERT INTO external_activities (id,user_id,source,external_id,date,kind,synced_at,raw)
       VALUES (?1,?2,'intervals',?3,?4,'run',1,'{"device_name":"iPhone"}')`,
    ).bind(copy, owner.id, `copy-${id}`, TODAY).run();
    await env.DB.prepare(
      'UPDATE external_activities SET deleted_at = 1, duplicate_of = ?2, canonical = 0 WHERE id = ?1',
    ).bind(recording, copy).run();

    const list = await lookup('/recordings');
    expect(list.body.recordings.find((r: any) => r.id === recording).state).toBe('merged_into_copy');
    const detail = await lookup(`/activities/${encodeURIComponent(copy)}`);
    expect(detail.body.activity.raw).toEqual({ device_name: 'iPhone' });
    expect(detail.body.copies.map((c: any) => [c.id, c.state])).toEqual([[recording, 'merged_into_copy']]);
    // The recording's pauses come with the copy that hid it.
    const run = detail.body.run_details.find((d: any) => d.activity_id === recording);
    expect(run.recorder.pauses).toHaveLength(2);
  });

  it('leaves out Garmin and WHOOP data', async () => {
    const owner = await ownerJwt();
    const suffix = crypto.randomUUID();
    const insert = (source: string, id: string, duplicateOf: string | null) => env.DB.prepare(
      `INSERT INTO external_activities (id,user_id,source,external_id,date,kind,synced_at,deleted_at,duplicate_of)
       VALUES (?1,?2,?3,?4,?5,'run',1,?6,?7)`,
    ).bind(id, owner.id, source, id, TODAY, duplicateOf ? 1 : null, duplicateOf).run();
    const intervals = `intervals:${suffix}`;
    await insert('intervals', intervals, null);
    await insert('garmin', `garmin:${suffix}`, intervals);
    await insert('whoop', `whoop:${suffix}`, null);

    const list = await lookup('/activities');
    const sources = new Set(list.body.activities.map((a: any) => a.source));
    expect(sources.has('garmin')).toBe(false);
    expect(sources.has('whoop')).toBe(false);
    expect(list.body.excluded_sources).toEqual(['garmin', 'whoop']);
    expect((await lookup(`/activities/${encodeURIComponent(`garmin:${suffix}`)}`)))
      .toMatchObject({ status: 403, body: { error: 'restricted_source' } });
    expect((await lookup(`/activities/${encodeURIComponent(`whoop:${suffix}`)}`)).status).toBe(403);
    const detail = await lookup(`/activities/${encodeURIComponent(intervals)}`);
    expect(detail.body.copies).toEqual([]);
    const sync = await lookup('/sync');
    expect(sync.body.sources_last_30_days.map((s: any) => s.source)).not.toContain('garmin');
    expect(sync.body.sources_last_30_days.map((s: any) => s.source)).not.toContain('whoop');
  });

  it('lists sessions with their sets', async () => {
    const owner = await ownerJwt();
    const sessionId = crypto.randomUUID();
    const planId = crypto.randomUUID();
    await env.DB.prepare(
      "INSERT INTO plans(id,user_id,name,status,version,created_at,updated_at) VALUES (?1,?2,'test','archived',1,1,1)",
    ).bind(planId, owner.id).run();
    await runWorkoutWriteBatch(env.DB, [env.DB.prepare(
      `INSERT INTO sessions (id,user_id,plan_id,date,status,created_at,updated_at)
       VALUES (?1,?2,?3,?4,'in_progress',1,1)`,
    ).bind(sessionId, owner.id, planId, TODAY)]);
    const sessions = await lookup('/sessions?days=2');
    expect(sessions.status).toBe(200);
    const found = sessions.body.sessions.find((s: any) => s.id === sessionId);
    expect(found).toMatchObject({ date: TODAY, sets: [] });
  });
});

describe('the app and the server agree', () => {
  it("parses the app's exact diagnostics JSON (ios/TresFortTests/RecordingDiagnosticsTests.swift)", () => {
    const fromApp = '{"auto_pause":true,"pauses":[{"automatic":false,"end_ms":1793000090000,"start_ms":1793000060000},'
      + '{"automatic":true,"end_ms":null,"start_ms":1793000120000}],"speeds":{"accuracy_dm":[50,48,120],'
      + '"dt_ms":[0,1000,1000],"speed_cms":[346,null,10],"start_ms":1793000000000},"v":1}';
    expect(parseRecordingDiagnostics(fromApp)).toEqual({
      v: 1,
      auto_pause: true,
      pauses: [
        { start_ms: 1793000060000, end_ms: 1793000090000, automatic: false },
        { start_ms: 1793000120000, end_ms: null, automatic: true },
      ],
      speeds: { start_ms: 1793000000000, dt_ms: [0, 1000, 1000], speed_cms: [346, null, 10], accuracy_dm: [50, 48, 120] },
    });
  });
});
