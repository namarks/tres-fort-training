// "Report a problem" (migration 0077, docs/DIAGNOSTICS.md): members send a
// report from the app with an optional screenshot and activity; the owner
// reads every member's reports through the diagnostics lookups, and an
// attached activity's details only while the member's 14-day consent lasts.
// Garmin and WHOOP activities can never be attached.
import { env, applyD1Migrations, SELF } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { issueAppJwt } from '../src/auth';
import { bytesToBase64, parseProblemReport, screenshotType, PROBLEM_REPORT_LIMITS } from '../src/problemReports';
import { submitProblemReport } from '../src/services/problemReports';
import { diagnosticsReport } from '../src/services/diagnostics';
import { deleteUserAccount } from '../src/db';

const BASE = 'https://tres-fort.test';
const TOKEN = 'test-diagnostics-token-0123456789abcdef';
const TODAY = new Date().toISOString().slice(0, 10);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
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
  await env.DB.prepare("INSERT INTO users (id,apple_sub,display_name,created_at) VALUES (?1,?1,'Sam',?2)")
    .bind(id, Date.now()).run();
  return { id, jwt: await issueAppJwt(id, 'test-secret') };
}

async function insertActivity(userId: string, source: string, deletedAt: number | null = null): Promise<string> {
  const id = `${source}:${crypto.randomUUID()}`;
  await env.DB.prepare(
    `INSERT INTO external_activities (id,user_id,source,external_id,date,kind,name,synced_at,deleted_at)
     VALUES (?1,?2,?3,?1,?4,'run','Morning run',1,?5)`,
  ).bind(id, userId, source, TODAY, deletedAt).run();
  return id;
}

async function send(jwt: string, fields: Record<string, string>, screenshot?: Uint8Array) {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  if (screenshot) form.append('screenshot', new Blob([screenshot], { type: 'image/jpeg' }), 'screenshot.jpg');
  const r = await SELF.fetch(`${BASE}/api/me/problem-reports`, {
    method: 'POST', headers: { Authorization: `Bearer ${jwt}` }, body: form,
  });
  return { status: r.status, body: await r.json<any>() };
}

async function lookup(path: string) {
  const r = await SELF.fetch(`${BASE}/diagnostics${path}`, { headers: { Authorization: `Bearer ${TOKEN}` } });
  return r;
}

const fields = (extra: Record<string, string> = {}) => ({
  id: crypto.randomUUID(),
  kind: 'bug',
  message: 'The timer froze after I paused.',
  platform: 'ios',
  app_version: '1.2',
  build: '80',
  os_version: 'iOS 26.1',
  device: 'iPhone14,2',
  screen: 'profile',
  ...extra,
});

describe('report format', () => {
  it('reads the fields and cuts long context instead of refusing it', () => {
    const parsed = parseProblemReport({ ...fields(), device: 'x'.repeat(500), contact: '  ', message: ' Hi\u0007 ' });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.input.message).toBe('Hi');
    expect(parsed.input.contact).toBeNull();
    expect(parsed.input.context.device).toHaveLength(80);
    expect(parsed.input.context.platform).toBe('ios');
  });

  it('refuses a report it cannot keep', () => {
    const cases: [Record<string, unknown>, string][] = [
      [{ ...fields(), id: 'nope' }, 'invalid_id'],
      [{ ...fields(), kind: 'spam' }, 'invalid_kind'],
      [{ ...fields(), message: '   ' }, 'missing_message'],
      [{ ...fields(), message: 'x'.repeat(PROBLEM_REPORT_LIMITS.messageChars + 1) }, 'message_too_long'],
      [{ ...fields(), contact: 'x'.repeat(201) }, 'contact_too_long'],
    ];
    for (const [value, error] of cases) expect(parseProblemReport(value)).toEqual({ ok: false, error });
  });

  it('knows JPEG and PNG screenshots only', () => {
    expect(screenshotType(JPEG)).toBe('image/jpeg');
    expect(screenshotType(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]))).toBe('image/png');
    expect(screenshotType(new TextEncoder().encode('<svg></svg>'))).toBeNull();
    expect(bytesToBase64(new Uint8Array(70_000).fill(65)).length).toBe(93_336);
  });
});

describe('sending a report', () => {
  it('keeps a report with its screenshot and activity once, and a retry returns it', async () => {
    const member = await memberJwt();
    const activity = await insertActivity(member.id, 'recording');
    const report = fields({ kind: 'activity', activity_id: activity, contact: 'sam@example.com', screen: 'activity' });
    const first = await send(member.jwt, report, JPEG);
    expect(first.status).toBe(201);
    expect(first.body.report).toMatchObject({ id: report.id, activity_attached: true, has_screenshot: true });
    const until = first.body.report.activity_access_until;
    expect(until - first.body.report.created_at).toBe(PROBLEM_REPORT_LIMITS.activityAccessMs);

    const retry = await send(member.jwt, { ...report, message: 'changed' });
    expect(retry.status).toBe(200);
    expect(retry.body).toMatchObject({ deduplicated: true, report: { id: report.id, activity_access_until: until } });
    const row = await env.DB.prepare('SELECT message, context FROM problem_reports WHERE id = ?1').bind(report.id)
      .first<{ message: string; context: string }>();
    expect(row!.message).toBe(report.message);
    expect(JSON.parse(row!.context)).toEqual({
      platform: 'ios', app_version: '1.2', build: '80', os_version: 'iOS 26.1', device: 'iPhone14,2', screen: 'activity',
    });

    // Another member can't take the id.
    const other = await memberJwt();
    expect((await send(other.jwt, report)).status).toBe(409);
  });

  it("keeps the report without an activity that is someone else's, Garmin's or WHOOP's", async () => {
    const member = await memberJwt();
    const other = await memberJwt();
    for (const [activity, reason] of [
      [await insertActivity(other.id, 'recording'), 'not_found'],
      [await insertActivity(member.id, 'garmin'), 'restricted_source'],
      [await insertActivity(member.id, 'whoop'), 'restricted_source'],
    ] as const) {
      const res = await send(member.jwt, fields({ kind: 'activity', activity_id: activity }));
      expect(res.status).toBe(201);
      expect(res.body.report).toMatchObject({ activity_attached: false, activity_ignored: reason, activity_access_until: null });
    }
  });

  it('refuses a bad screenshot and too many reports in a day', async () => {
    const member = await memberJwt();
    expect((await send(member.jwt, fields(), new TextEncoder().encode('<html>'))).body.error).toBe('invalid_screenshot');
    const big = new Uint8Array(PROBLEM_REPORT_LIMITS.screenshotBytes + 1);
    big.set(JPEG);
    expect((await send(member.jwt, fields(), big)).status).toBe(413);
    expect((await send(member.jwt, { ...fields(), kind: 'nope' })).body.error).toBe('invalid_kind');

    const now = Date.now();
    for (let i = 0; i < PROBLEM_REPORT_LIMITS.perDay; i++) {
      const parsed = parseProblemReport(fields());
      if (!parsed.ok) throw new Error('bad fixture');
      expect((await submitProblemReport(env.DB, member.id, parsed.input, null, now)).ok).toBe(true);
    }
    const limited = await send(member.jwt, fields());
    expect(limited).toMatchObject({ status: 429, body: { error: 'rate_limited' } });
  });

  it('exports reports with the account and deletes them with it', async () => {
    const member = await memberJwt();
    const report = fields();
    expect((await send(member.jwt, report, JPEG)).status).toBe(201);
    const exported = await SELF.fetch(`${BASE}/api/me/export`, { headers: { Authorization: `Bearer ${member.jwt}` } });
    expect(exported.status).toBe(200);
    const body = await exported.json<any>();
    expect(body.training.problem_reports).toEqual([expect.objectContaining({
      id: report.id,
      kind: 'bug',
      context: expect.objectContaining({ build: '80' }),
      screenshot: { content_type: 'image/jpeg', base64: bytesToBase64(JPEG) },
    })]);

    const deleted = await deleteUserAccount(env.DB, member.id, undefined, crypto.randomUUID());
    expect(deleted, JSON.stringify(deleted)).toMatchObject({ ok: true });
    const left = await env.DB.prepare('SELECT COUNT(*) AS n FROM problem_report_screenshots WHERE report_id = ?1')
      .bind(report.id).first<{ n: number }>();
    expect(left!.n).toBe(0);
    expect(await env.DB.prepare('SELECT id FROM problem_reports WHERE id = ?1').bind(report.id).first()).toBeNull();
  });
});

describe('reading reports', () => {
  it("lists every member's reports and shows an attached activity while consent lasts", async () => {
    const owner = await ownerJwt();
    const member = await memberJwt();
    const activity = await insertActivity(member.id, 'recording');
    const report = fields({ kind: 'activity', activity_id: activity });
    expect((await send(member.jwt, report, JPEG)).status).toBe(201);
    const plain = fields({ kind: 'feedback', message: 'Love it' });
    expect((await send(member.jwt, plain)).status).toBe(201);

    const list = await lookup('/reports?days=1');
    expect(list.status).toBe(200);
    expect(list.headers.get('Cache-Control')).toBe('no-store');
    const reports = (await list.json<any>()).reports;
    const listed = reports.find((r: any) => r.id === report.id);
    expect(listed).toMatchObject({
      kind: 'activity',
      member: { user_id: member.id, display_name: 'Sam', is_owner: false },
      has_screenshot: true,
      activity_id: activity,
      activity_access: { status: 'open' },
    });
    expect(reports.find((r: any) => r.id === plain.id).activity_access).toBeNull();

    const detail = await (await lookup(`/reports/${report.id}`)).json<any>();
    expect(detail.activity).toMatchObject({ available: true, activity: { id: activity, state: 'shown' } });

    const shot = await lookup(`/reports/${report.id}/screenshot`);
    expect(shot.headers.get('Content-Type')).toBe('image/jpeg');
    expect(new Uint8Array(await shot.arrayBuffer())).toEqual(JPEG);
    expect((await lookup(`/reports/${plain.id}/screenshot`)).status).toBe(404);

    // After 14 days, only the report.
    const later = await diagnosticsReport(env.DB, owner.id, report.id, Date.now() + PROBLEM_REPORT_LIMITS.activityAccessMs + 1);
    expect(later.ok && later.body.activity).toEqual({ available: false, reason: 'consent_expired' });

    // The member deleting the activity ends access too.
    await env.DB.prepare('UPDATE external_activities SET deleted_at = 1 WHERE id = ?1').bind(activity).run();
    const gone = await (await lookup(`/reports/${report.id}`)).json<any>();
    expect(gone.activity).toEqual({ available: false, reason: 'deleted_by_member' });

    // Every read leaves an audit row naming the report and the member.
    const audit = await env.DB.prepare(
      "SELECT args FROM audit_log WHERE user_id = ?1 AND tool = 'diagnostics_read' AND args LIKE ?2",
    ).bind(owner.id, `%${report.id}%`).all<{ args: string }>();
    expect(audit.results.map((r) => JSON.parse(r.args))).toContainEqual({ lookup: 'reports/:id', id: report.id, member: member.id });
  });

  it('opens the owner web door to the owner only', async () => {
    const owner = await ownerJwt();
    const member = await memberJwt();
    const get = (jwt: string) => SELF.fetch(`${BASE}/api/me/diagnostics/reports`, { headers: { Authorization: `Bearer ${jwt}` } });
    expect((await get(owner.jwt)).status).toBe(200);
    expect((await get(member.jwt)).status).toBe(404);
    expect((await lookup('/reports/not-a-uuid')).status).toBe(400);
    expect((await lookup(`/reports/${crypto.randomUUID()}`)).status).toBe(404);
  });
});
