import { applyD1Migrations, env, SELF } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { programWeekOn, scheduledExtras, weekPatternOn, weekdayOf } from '../src/calendarProjection';
import { getProjectedCalendar } from '../src/db';
import { normalizeProgram, parsePlanMeta, type TrainingProgram, type WeeklySchedule } from '../src/types';
import shared from '../ios/TresFortTests/Fixtures/ProgramWeeks.json';

// Blocks of weeks (docs/plans/progressive-plans P0, spec.md).

describe('shared TypeScript/Swift block fixtures', () => {
  const schedule = { version: 1, ...shared.schedule } as WeeklySchedule;
  for (const fixture of shared.cases) {
    it(fixture.name, () => {
      const program = fixture.program
        ? normalizeProgram(shared.programs[fixture.program as keyof typeof shared.programs])!
        : null;
      expect(programWeekOn(program, fixture.date)).toBe(fixture.expected_week);
      expect(weekPatternOn(schedule, program, fixture.date).week[weekdayOf(fixture.date)] ?? null)
        .toBe(fixture.expected_workout);
      const live = ['kb_a', 'kb_b', 'intervals', 'tempo', 'easy_run', 'long_6', 'long_8', 'long_10', 'stretch'];
      expect(scheduledExtras(schedule, fixture.date, '2026-01-01', live, [], program))
        .toEqual(fixture.expected_extras);
    });
  }

  it('drops a malformed stored block instead of breaking the plan', () => {
    expect(normalizeProgram({ id: 'x', start: 'soon', weeks: [] })).toBeUndefined();
    expect(normalizeProgram({ id: 'x', start: '2026-11-09', weeks: [] })).toBeUndefined();
    expect(parsePlanMeta(JSON.stringify({ program: { start: '2026-11-09' } })).program).toBeUndefined();
  });
});

const BASE = 'https://tres-fort.test';
const TOKEN = 'test-mcp-token';

beforeAll(async () => { await applyD1Migrations(env.DB, env.TEST_MIGRATIONS); });

async function setup() {
  const auth = await SELF.fetch(`${BASE}/auth/dev`, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ secret: 'test-dev' }) });
  const { jwt } = await auth.json<{ jwt: string }>();
  const headers = { 'content-type': 'application/json', Authorization: `Bearer ${jwt}` };
  const call = async (method: string, path: string, body?: object) => {
    const response = await SELF.fetch(`${BASE}/api/${path}`, { method, headers, body: body && JSON.stringify(body) });
    return { status: response.status, body: await response.json<any>() };
  };
  const plan = (await call('POST', 'plan', { name: 'Blocks' })).body;
  const workout = async (name: string, lift = true) => {
    const day = (await call('POST', 'workouts', { name })).body;
    if (lift) await call('POST', `workouts/${day.id}/exercises`, { exercise: 'ex_goblet_squat', target_sets: 3, target_reps: 8 });
    return day.id as string;
  };
  const ids = {
    kb: await workout('Kettlebell A'),
    long8: await workout('Long run 8'),
    long10: await workout('Long run 10'),
    easy: await workout('Easy run'),
    stretch: await workout('Stretching', false),
  };
  const version = async () => (await env.DB.prepare('SELECT version, meta FROM plans WHERE id=?1')
    .bind(plan.id).first<{ version: number; meta: string }>())!;
  const owner = await env.DB.prepare('SELECT user_id FROM plans WHERE id=?1').bind(plan.id).first<{ user_id: string }>();
  const routine = await call('PUT', 'plan/schedule', { week: { mon: ids.kb, sun: ids.easy },
    expected_version: (await version()).version });
  expect(routine.status).toBe(200);
  return { call, ids, version, plan, userId: owner!.user_id };
}

const block = (ids: Record<string, string>) => ({
  name: 'Marathon build', start: '2030-01-07', repeat: false,
  weeks: [
    { label: 'Base', week: { mon: ids.kb, sun: ids.long8 }, extras: { wed: [ids.stretch] } },
    { label: 'Build', week: { mon: ids.kb, sun: ids.long10 } },
  ],
});

describe('a block of weeks over REST', () => {
  let f: Awaited<ReturnType<typeof setup>>;
  // The real-D1 pool restores this suite seed for each test; only the behavior
  // under test belongs inside its timeout, not eleven repeated setup writes.
  beforeAll(async () => { f = await setup(); });

  it('stores the block, versions it and makes the calendar follow it', async () => {
    const before = await f.version();
    const put = await f.call('PUT', 'plan/program', { program: block(f.ids), expected_version: before.version });
    expect(put.status).toBe(200);
    expect(put.body).toMatchObject({ ok: true, version: before.version + 1,
      program: { name: 'Marathon build', start: '2030-01-07', repeat: false,
        weeks: [{ label: 'Base', week: { mon: f.ids.kb, sun: f.ids.long8, tue: null }, extras: { wed: [f.ids.stretch] } },
          { label: 'Build', week: { sun: f.ids.long10 } }] } });
    const stored = parsePlanMeta((await f.version()).meta).program as TrainingProgram;
    expect(stored.id).toEqual(expect.any(String));

    const cal = await getProjectedCalendar(env.DB, f.userId, '2030-01-06', '2030-01-27', '2030-01-01');
    const on = (date: string) => cal.find((cell) => cell.date === date);
    expect(on('2030-01-06')?.workout_id).toBe(f.ids.easy);    // the Sunday before: routine
    expect(on('2030-01-09')?.extras).toEqual([f.ids.stretch]); // week 1 Wednesday extra
    expect(on('2030-01-13')?.workout_id).toBe(f.ids.long8);   // week 1 Sunday
    expect(on('2030-01-20')?.workout_id).toBe(f.ids.long10);  // week 2 Sunday
    expect(on('2030-01-27')?.workout_id).toBe(f.ids.easy);    // block over: routine again

    const audit = await env.DB.prepare(
      "SELECT actor FROM audit_log WHERE tool='set_program' ORDER BY created_at DESC LIMIT 1").first<{ actor: string }>();
    expect(audit?.actor).toBe('ios');

    // Editing keeps the block's id; a stale version is a conflict.
    const again = await f.call('PUT', 'plan/program', { program: { ...block(f.ids), repeat: true },
      expected_version: before.version + 1 });
    expect(again.body.program.id).toBe(stored.id);
    const stale = await f.call('PUT', 'plan/program', { program: block(f.ids), expected_version: before.version });
    expect(stale.status).toBe(409);
    expect(stale.body).toMatchObject({ conflict: true, current_version: before.version + 2 });

    const cleared = await f.call('DELETE', `plan/program?expected_version=${before.version + 2}`);
    expect(cleared.status).toBe(200);
    expect(cleared.body.program).toBeNull();
    expect(parsePlanMeta((await f.version()).meta).program).toBeUndefined();
    const after = await getProjectedCalendar(env.DB, f.userId, '2030-01-13', '2030-01-13', '2030-01-01');
    expect(after[0]?.workout_id).toBe(f.ids.easy);
  });

  it('rejects a bad block before writing', async () => {
    const { version } = await f.version();
    const put = (program: unknown, extra: object = {}) =>
      f.call('PUT', 'plan/program', { program, expected_version: version, ...extra });
    expect((await put({ ...block(f.ids), start: '2030-01-08' })).body).toEqual({ error: 'invalid_start' });
    expect((await put({ ...block(f.ids), start: '2030-02-30' })).body).toEqual({ error: 'invalid_start' });
    expect((await put({ ...block(f.ids), weeks: [] })).body).toEqual({ error: 'invalid_weeks' });
    expect((await put({ ...block(f.ids), weeks: Array(53).fill({ week: {} }) })).body).toEqual({ error: 'invalid_weeks' });
    expect((await put({ ...block(f.ids), weeks: [{ label: 'x'.repeat(41), week: {} }] })).body)
      .toEqual({ error: 'invalid_label' });
    expect((await put({ ...block(f.ids), weeks: [{ week: { mon: 'nope' } }] })).body)
      .toEqual({ error: 'unknown_day_ref', ref: 'nope', week: 0 });
    expect((await put({ ...block(f.ids), weeks: [{ week: {}, extras: { mon: ['missing'] } }] })).body)
      .toEqual({ error: 'unknown_day_ref', ref: 'missing', week: 0 });
    const typo = await put({ ...block(f.ids), weeks: [{ week: { monday: f.ids.kb }, extras: { wed: 'x', funday: [] } }] });
    expect(typo.status).toBe(400);
    expect(typo.body.fields).toEqual(['program.weeks.0.week.monday', 'program.weeks.0.extras.wed',
      'program.weeks.0.extras.funday']);
    const unknown = await put({ ...block(f.ids), color: 'red', weeks: [{ week: {}, mood: 1 }] }, { surprise: true });
    expect(unknown.status).toBe(400);
    expect(unknown.body.fields).toEqual(expect.arrayContaining(['surprise', 'program.color', 'program.weeks.0.mood']));
    expect((await f.version()).version).toBe(version);
    // Keep the existing budget for the full set of real-Worker validation PUTs.
  }, 10_000);

  it('preserves extras that gain exercises and accepts additional full workouts', async () => {
    const sent = block(f.ids);
    await f.call('PUT', 'plan/program', { program: sent, expected_version: (await f.version()).version });
    expect((await f.call('POST', `workouts/${f.ids.stretch}/exercises`,
      { exercise: 'ex_plank', target_sets: 2, target_reps: 1, target_duration_s: 30 })).status).toBe(201);
    const resent = await f.call('PUT', 'plan/program', { program: sent, expected_version: (await f.version()).version });
    expect(resent.status).toBe(200);
    expect(resent.body.program.weeks[0].extras).toEqual({ wed: [f.ids.stretch] });
    expect((await f.call('PUT', 'plan/program', { program: { ...sent, weeks: [{ week: {}, extras: { fri: [f.ids.kb] } }] },
      expected_version: (await f.version()).version })).body)
      .toMatchObject({ ok: true, program: { weeks: [{ extras: { fri: [f.ids.kb] } }] } });
  });

  it('clears a deleted or archived workout from every week', async () => {
    let { version } = await f.version();
    await f.call('PUT', 'plan/program', { program: block(f.ids), expected_version: version });
    ({ version } = await f.version());
    const removed = await f.call('DELETE', `workouts/${f.ids.long8}?expected_version=${version}`);
    expect(removed.status).toBe(200);
    let program = parsePlanMeta((await f.version()).meta).program!;
    expect(program.weeks[0]!.week.sun).toBeNull();
    expect(program.weeks[1]!.week.sun).toBe(f.ids.long10);
    ({ version } = await f.version());
    const archived = await f.call('PATCH', `workouts/${f.ids.long10}`, { archived_at: Date.now(), expected_version: version });
    expect(archived.status).toBe(200);
    program = parsePlanMeta((await f.version()).meta).program!;
    expect(program.weeks[1]!.week.sun).toBeNull();
    expect(program.weeks[0]!.extras).toEqual({ wed: [f.ids.stretch] });
  });
});

describe('a block of weeks from the coach', () => {
  let f: Awaited<ReturnType<typeof setup>>;
  // Isolated D1 storage restores this seed before each case. The fixture's
  // eleven REST writes should not consume each coach test's five-second budget.
  beforeAll(async () => { f = await setup(); });

  async function mcp(name: string, args: unknown) {
    const response = await SELF.fetch(`${BASE}/mcp`, { method: 'POST',
      headers: { 'content-type': 'application/json', Authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }) });
    return JSON.parse((await response.json<any>()).result.content[0].text);
  }

  it('resolves workouts by name and writes the audit trail and a note', async () => {
    const result = await mcp('set_program', { program: { start: '2030-03-04', repeat: true, weeks: [
      { label: 'A', week: { mon: 'Kettlebell A' } }, { label: 'B', week: { mon: 'easy run' } }] } });
    expect(result).toMatchObject({ ok: true, program: { repeat: true,
      weeks: [{ week: { mon: f.ids.kb } }, { week: { mon: f.ids.easy } }] } });
    const cal = await getProjectedCalendar(env.DB, f.userId, '2030-03-04', '2030-03-25', '2030-03-01');
    expect(cal.filter((cell) => weekdayOf(cell.date) === 'mon').map((cell) => cell.workout_id))
      .toEqual([f.ids.kb, f.ids.easy, f.ids.kb, f.ids.easy]);
    const audit = await env.DB.prepare(
      "SELECT actor FROM audit_log WHERE tool='set_program' ORDER BY created_at DESC LIMIT 1").first<{ actor: string }>();
    expect(audit?.actor).toBe('mcp');
    const note = await env.DB.prepare("SELECT body FROM notes ORDER BY created_at DESC LIMIT 1").first<{ body: string }>();
    expect(note?.body).toMatch(/block of 2 weeks/);
    expect(await mcp('set_program', { program: { start: '2030-03-04', weeks: [{ week: { monday: 'Kettlebell A' } }] } }))
      .toEqual({ error: 'invalid_weekday', weekday: 'monday', week: 0 });
    expect(await mcp('set_program', { program: null })).toMatchObject({ ok: true, program: null });
  });

  it("shows the coach this week of the block in today's workout", async () => {
    const every = Object.fromEntries(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((d) => [d, 'Long run 10']));
    await mcp('set_program', { program: { name: 'Cycle', start: '2024-01-01', repeat: true,
      weeks: [{ label: 'Only', week: every }] } });
    const today = await mcp('get_today_workout', {});
    expect(today.program_week).toEqual({ name: 'Cycle', week: 1, of: 1, label: 'Only', repeat: true });
    expect(Object.values(today.schedule)).toEqual(Array(7).fill('Long run 10'));
    await mcp('set_program', { program: null });
    const plain = await mcp('get_today_workout', {});
    expect(plain.program_week).toBeUndefined();
    expect(plain.schedule).toMatchObject({ mon: 'Kettlebell A', sun: 'Easy run', tue: null });
  });
});
