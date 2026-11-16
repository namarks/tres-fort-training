import { applyD1Migrations, env, SELF } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { applySlotTargets, weekTargetsOn } from '../src/programTargets';
import { normalizeProgram, parsePlanMeta } from '../src/types';
import { buildEventBlock, setProgram } from '../src/db';
import shared from '../ios/TresFortTests/Fixtures/ProgramTargets.json';

// Targets that change from week to week (docs/plans/progressive-plans P1).

describe('shared TypeScript/Swift week target fixtures', () => {
  const program = normalizeProgram(shared.program)!;
  for (const fixture of shared.cases) {
    it(fixture.name, () => {
      const slot = shared.slots.find((candidate) => candidate.id === fixture.slot)! as any;
      const { id: _id, exercise_id: _exercise, ...effective } =
        applySlotTargets(slot, weekTargetsOn(program, fixture.date)[slot.id]);
      expect(effective).toEqual(fixture.expected);
    });
  }

  it('keeps only known target fields of the right type from a stored block', () => {
    const stored = normalizeProgram({ id: 'x', start: '2026-11-09', weeks: [{ week: {}, targets: {
      a: { target_sets: 0, target_reps: 6, target_weight: 'heavy', colour: 'red', run_steps: null },
      b: { target_sets: 2.5 }, c: 'nope' } }] })!;
    expect(stored.weeks[0]!.targets).toEqual({ a: { target_reps: 6, run_steps: null } });
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
  const plan = (await call('POST', 'plan', { name: 'Week targets' })).body;
  const day = (await call('POST', 'workouts', { name: 'Bells' })).body;
  const slot = async (body: object) => (await call('POST', `workouts/${day.id}/exercises`, body)).body;
  const swing = await slot({ exercise: 'ex_kb_swing', target_sets: 5, target_reps: 10, target_reps_max: 15,
    target_weight: 24, target_weight_unit: 'kg' });
  const plank = await slot({ exercise: 'ex_plank', target_sets: 3, target_reps: 1, target_duration_s: 45 });
  const run = (await call('POST', 'workouts', { name: 'Long run' })).body;
  const runSlot = (await call('POST', `workouts/${run.id}/exercises`, { exercise: 'ex_outdoor_run',
    target_sets: 1, target_reps: 1, run_steps: [{ kind: 'work', distance_m: 12875 }] })).body;
  const version = async () => (await env.DB.prepare('SELECT version, meta FROM plans WHERE id=?1')
    .bind(plan.id).first<{ version: number; meta: string }>())!;
  return { call, plan, day, run, swing, plank, runSlot, version };
}

const weekOf = (day: string, run: string) => ({ mon: day, sun: run });

async function programWriteCounts(planID: string) {
  return env.DB.prepare(`SELECT
    (SELECT COUNT(*) FROM plan_snapshots WHERE plan_id=?1) AS snapshots,
    (SELECT COUNT(*) FROM audit_log WHERE user_id=(SELECT user_id FROM plans WHERE id=?1)) AS audit,
    (SELECT COUNT(*) FROM notes WHERE user_id=(SELECT user_id FROM plans WHERE id=?1)) AS notes`)
    .bind(planID).first();
}

describe('program edits preserve started workout targets', () => {
  it('rejects changed active lifting prescriptions but allows effective no-ops and future or other-workout edits', async () => {
    const f = await setup();
    const base = { start: '2030-01-07', weeks: [
      { week: weekOf(f.day.id, f.run.id), targets: { [f.swing.id]: { target_weight: 28 } } },
      { week: weekOf(f.day.id, f.run.id) },
    ] };
    expect((await f.call('PUT', 'plan/program', { expected_version: (await f.version()).version, program: base })).status).toBe(200);
    const session = (await f.call('POST', 'sessions', { date: '2030-01-07', workout_id: f.day.id })).body;
    expect((await f.call('PATCH', `sessions/${session.id}?expected_attempt=${session.attempt}`, { status: 'in_progress' })).status).toBe(200);
    const before = await f.version(), counts = await programWriteCounts(f.plan.id);
    for (const targets of [
      { [f.swing.id]: { target_weight: 20 } }, { [f.swing.id]: { target_sets: 2 } },
      { [f.swing.id]: { target_reps: 8 } }, { [f.plank.id]: { target_duration_s: 30 } },
      { [f.swing.id]: { target_rpe: 6 } },
    ]) {
      const changed = { ...base, weeks: [{ ...base.weeks[0], targets }, base.weeks[1]] };
      expect(await f.call('PUT', 'plan/program', { expected_version: before.version, program: changed }))
        .toEqual({ status: 400, body: { error: 'active_workout_targets_changed' } });
      expect(await f.version()).toEqual(before);
      expect(await programWriteCounts(f.plan.id)).toEqual(counts);
    }
    const harmless = { ...base, name: 'Reviewed', weeks: [
      { ...base.weeks[0], targets: {
        [f.swing.id]: { target_weight: 28, target_sets: 5, target_reps: 10 },
        [f.runSlot.id]: { run_steps: [{ kind: 'work', distance_m: 9000 }] },
      } },
      { ...base.weeks[1], targets: { [f.swing.id]: { target_weight: 32 } } },
    ] };
    expect((await f.call('PUT', 'plan/program', { expected_version: before.version, program: harmless })).status).toBe(200);
    const after = await f.version();
    expect(after.version).toBe(before.version + 1);
    expect((await f.call('DELETE', `plan/program?expected_version=${after.version}`)).body)
      .toEqual({ error: 'active_workout_targets_changed' });
    expect(await f.version()).toEqual(after);
  });

  it('checks a repeating week on an additional session exact date, including run steps', async () => {
    const f = await setup();
    const base = { start: '2030-01-07', repeat: true, weeks: [
      { week: weekOf(f.day.id, f.run.id) }, { week: weekOf(f.day.id, f.run.id) },
    ] };
    expect((await f.call('PUT', 'plan/program', { expected_version: (await f.version()).version, program: base })).status).toBe(200);
    const primary = (await f.call('POST', 'sessions', { date: '2030-02-04', workout_id: f.day.id })).body;
    const extra = (await f.call('POST', 'sessions', { id: crypto.randomUUID(), date: primary.date,
      workout_id: f.run.id, additional: true, expected_attempt: 0 })).body;
    expect(extra.slot).toBe(1);
    expect((await f.call('PATCH', `sessions/${extra.id}?expected_attempt=${extra.attempt}`, { status: 'in_progress' })).status).toBe(200);
    const version = (await f.version()).version;
    const altered = { ...base, weeks: [
      { ...base.weeks[0], targets: { [f.runSlot.id]: { run_steps: [{ kind: 'work', distance_m: 5000 }] } } },
      base.weeks[1],
    ] };
    expect((await f.call('PUT', 'plan/program', { expected_version: version, program: altered })).body)
      .toEqual({ error: 'active_workout_targets_changed' });
    // The scheduled primary has not started and is a different workout.
    const harmless = { ...base, weeks: [
      { ...base.weeks[0], targets: { [f.swing.id]: { target_weight: 20 } } }, base.weeks[1],
    ] };
    expect((await f.call('PUT', 'plan/program', { expected_version: version, program: harmless })).status).toBe(200);
    expect((await env.DB.prepare('SELECT status FROM sessions WHERE id=?1').bind(primary.id).first<any>()).status).toBe('planned');
  });

  it('protects every active circuit member when a valid round-count change is proposed', async () => {
    const f = await setup();
    expect((await f.call('PUT', `workouts/${f.day.id}/groups`, {
      group_id: crypto.randomUUID(), exercises: [f.swing.id, f.plank.id], target_sets: 3,
      round_rest: 60, transition_rest: 10, expected_version: (await f.version()).version,
    })).status).toBe(200);
    const session = (await f.call('POST', 'sessions', { date: '2030-01-07', workout_id: f.day.id })).body;
    await f.call('PATCH', `sessions/${session.id}?expected_attempt=${session.attempt}`, { status: 'in_progress' });
    const before = await f.version();
    const program = { start: '2030-01-07', weeks: [{ week: weekOf(f.day.id, f.run.id), targets: {
      [f.swing.id]: { target_sets: 2 }, [f.plank.id]: { target_sets: 2 },
    } }] };
    expect(await f.call('PUT', 'plan/program', { expected_version: before.version, program }))
      .toEqual({ status: 400, body: { error: 'active_workout_targets_changed' } });
    expect(await f.version()).toEqual(before);
  });

  it('compares session swap prescriptions and allows clearing a block with no active target change', async () => {
    const f = await setup();
    const session = (await f.call('POST', 'sessions', { date: '2030-01-07', workout_id: f.day.id })).body;
    await f.call('PATCH', `sessions/${session.id}?expected_attempt=${session.attempt}`, { status: 'in_progress' });
    const version = (await f.version()).version;
    const swap = await f.call('POST', `sessions/${session.id}/exercises/${f.swing.id}/swap`, {
      to_exercise: 'ex_goblet_squat', expected_attempt: session.attempt, expected_version: version, expected_revision: 0,
    });
    expect(swap.status).toBe(200);
    const program = { start: '2030-01-07', weeks: [{ week: weekOf(f.day.id, f.run.id),
      targets: { [f.swing.id]: { target_weight: 24 } } }] };
    expect((await f.call('PUT', 'plan/program', { expected_version: version, program })).body)
      .toEqual({ error: 'active_workout_targets_changed' });
    const harmless = { ...program, weeks: [{ week: weekOf(f.day.id, f.run.id) }] };
    expect((await f.call('PUT', 'plan/program', { expected_version: version, program: harmless })).status).toBe(200);
    expect((await f.call('DELETE', `plan/program?expected_version=${version + 1}`)).status).toBe(200);
  });

  it('closes the race when a workout starts between target review and the atomic plan claim', async () => {
    const f = await setup(), before = await f.version(), counts = await programWriteCounts(f.plan.id);
    const user = (await env.DB.prepare('SELECT user_id FROM plans WHERE id=?1').bind(f.plan.id).first<{ user_id: string }>())!.user_id;
    let started = false;
    const racingDb = new Proxy(env.DB, {
      get(target, property) {
        if (property === 'batch') return async (statements: D1PreparedStatement[]) => {
          if (!started) {
            started = true;
            await env.DB.prepare(`INSERT INTO sessions
              (id,user_id,plan_id,workout_id,date,status,started_at,created_at,updated_at)
              VALUES (?1,?2,?3,?4,'2030-01-07','in_progress',1,1,1)`)
              .bind(crypto.randomUUID(), user, f.plan.id, f.day.id).run();
          }
          return target.batch(statements);
        };
        const value = Reflect.get(target, property, target);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    }) as D1Database;
    expect(await setProgram(racingDb, user, { start: '2030-01-07', weeks: [
      { week: weekOf(f.day.id, f.run.id), targets: { [f.swing.id]: { target_weight: 20 } } },
    ] }, before.version)).toEqual({ error: 'active_workout_targets_changed' });
    expect(started).toBe(true);
    expect(await f.version()).toEqual(before);
    expect(await programWriteCounts(f.plan.id)).toEqual(counts);
  });

  it('uses the same guard when an event builder atomically replaces the block and event', async () => {
    const f = await setup();
    await f.call('PUT', 'plan/schedule', { expected_version: (await f.version()).version,
      week: weekOf(f.day.id, f.run.id) });
    const session = (await f.call('POST', 'sessions', { date: '2030-01-13', workout_id: f.run.id })).body;
    await f.call('PATCH', `sessions/${session.id}?expected_attempt=${session.attempt}`, { status: 'in_progress' });
    const before = await f.version(), counts = await programWriteCounts(f.plan.id);
    const user = (await env.DB.prepare('SELECT user_id FROM plans WHERE id=?1').bind(f.plan.id).first<{ user_id: string }>())!.user_id;
    const result = await buildEventBlock(env.DB, user, { today: '2030-01-07', start: '2030-01-07',
      race: { name: 'Race', date: '2030-03-31', discipline: 'run', distance_m: 21097 },
      long_run_weekday: 'sun', long_run_now_m: 5000, peak_m: 18000, workout_weekday: null,
    }, { expectedVersion: before.version, attribution: { actor: 'ios', operation: 'build_program' } });
    expect(result).toEqual({ error: 'active_workout_targets_changed' });
    expect(await f.version()).toEqual(before);
    expect(await programWriteCounts(f.plan.id)).toEqual(counts);
  });
});

describe('per-week targets over REST', () => {
  it('stores each week its own targets and captures them when the workout starts', async () => {
    const f = await setup();
    const put = await f.call('PUT', 'plan/program', { expected_version: (await f.version()).version, program: {
      start: '2030-01-07', weeks: [
        { label: 'Base', week: weekOf(f.day.id, f.run.id) },
        { label: 'Build', week: weekOf(f.day.id, f.run.id), targets: {
          [f.swing.id]: { target_weight: 28, target_reps: 12 },
          [f.plank.id]: { target_duration_s: 60 },
          [f.runSlot.id]: { run_steps: [{ kind: 'work', distance_m: 16093 }] } } },
      ] } });
    expect(put.status).toBe(200);
    const stored = parsePlanMeta((await f.version()).meta).program!;
    expect(stored.weeks[0]!.targets).toBeUndefined();
    expect(stored.weeks[1]!.targets![f.swing.id]).toEqual({ target_weight: 28, target_reps: 12 });
    expect(typeof stored.weeks[1]!.targets![f.runSlot.id]!.run_steps).toBe('string');

    // Week 2 with an app prescription: the snapshot reads that version's week.
    const { version } = await f.version();
    const session = (await f.call('POST', 'sessions', { date: '2030-01-14', workout_id: f.day.id })).body;
    const logged = await f.call('POST', `sessions/${session.id}/sets`, { id: crypto.randomUUID(),
      exercise_id: 'ex_kb_swing', template_exercise_id: f.swing.id, set_index: 1, weight: 28, reps: 12,
      weight_unit: 'kg', expected_attempt: session.attempt,
      prescription: { plan_id: f.plan.id, version, day_id: f.day.id } });
    expect(logged.status).toBe(201);
    const captured = await env.DB.prepare('SELECT runner_targets FROM sessions WHERE id=?1')
      .bind(session.id).first<{ runner_targets: string }>();
    expect(JSON.parse(captured!.runner_targets).slots).toEqual([
      expect.objectContaining({ slot_id: f.swing.id, sets: 5, reps: 12, reps_max: 15, weight: 28, weight_unit: 'kg' }),
      expect.objectContaining({ slot_id: f.plank.id, duration_s: 60 }),
    ]);

    // Week 1 without a prescription: the live slots, unchanged.
    const plain = (await f.call('POST', 'sessions', { date: '2030-01-07', workout_id: f.day.id })).body;
    await f.call('POST', `sessions/${plain.id}/sets`, { id: crypto.randomUUID(), exercise_id: 'ex_kb_swing',
      template_exercise_id: f.swing.id, set_index: 1, weight: 24, reps: 10, weight_unit: 'kg',
      expected_attempt: plain.attempt });
    const week1 = await env.DB.prepare('SELECT runner_targets FROM sessions WHERE id=?1')
      .bind(plain.id).first<{ runner_targets: string }>();
    expect(JSON.parse(week1!.runner_targets).slots[0]).toMatchObject({ reps: 10, weight: 24 });

    // Week 2 without a prescription: the bound week overrides the live slots.
    const sql = (await f.call('POST', 'sessions', { date: '2030-01-15', workout_id: f.day.id })).body;
    await f.call('POST', `sessions/${sql.id}/sets`, { id: crypto.randomUUID(), exercise_id: 'ex_plank',
      template_exercise_id: f.plank.id, set_index: 1, weight: 0, reps: 1, duration_s: 60, weight_unit: 'lb',
      expected_attempt: sql.attempt });
    const week2 = await env.DB.prepare('SELECT runner_targets FROM sessions WHERE id=?1')
      .bind(sql.id).first<{ runner_targets: string }>();
    expect(JSON.parse(week2!.runner_targets).slots).toEqual([
      expect.objectContaining({ reps: 12, weight: 28 }), expect.objectContaining({ duration_s: 60, is_timed: 1 })]);

    // Completing with no sets captures the week's targets too.
    const quick = (await f.call('POST', 'sessions', { date: '2030-01-16', workout_id: f.day.id })).body;
    const done = await f.call('PATCH', `sessions/${quick.id}?expected_attempt=${quick.attempt}`, { status: 'completed' });
    expect(done.status).toBe(200);
    const week2Done = await env.DB.prepare('SELECT runner_targets FROM sessions WHERE id=?1')
      .bind(quick.id).first<{ runner_targets: string }>();
    expect(JSON.parse(week2Done!.runner_targets).slots[0]).toMatchObject({ reps: 12, weight: 28 });
  });

  it('reads the week from the same plan row as the snapshot, wrapping a repeating block', async () => {
    const f = await setup();
    const put = await f.call('PUT', 'plan/program', { expected_version: (await f.version()).version, program: {
      start: '2030-01-07', repeat: true, weeks: [
        { week: weekOf(f.day.id, f.run.id) },
        { week: weekOf(f.day.id, f.run.id), targets: { [f.swing.id]: { target_weight: 32, target_reps_max: null } } },
      ] } });
    expect(put.status).toBe(200);
    const program = parsePlanMeta((await f.version()).meta).program!;
    // Before the start, both weeks, and the same two weeks again.
    for (const date of ['2030-01-06', '2030-01-07', '2030-01-16', '2030-01-22', '2030-01-29', '2030-03-04']) {
      const session = (await f.call('POST', 'sessions', { date, workout_id: f.day.id })).body;
      const done = await f.call('PATCH', `sessions/${session.id}?expected_attempt=${session.attempt}`,
        { status: 'completed' });
      expect(done.status).toBe(200);
      const row = await env.DB.prepare('SELECT runner_targets FROM sessions WHERE id=?1')
        .bind(session.id).first<{ runner_targets: string }>();
      const week = weekTargetsOn(program, date)[f.swing.id];
      expect(JSON.parse(row!.runner_targets).slots[0], date).toMatchObject(week
        ? { weight: 32, reps_max: null } : { weight: 24, reps_max: 15 });
    }
    expect(weekTargetsOn(program, '2030-01-29')[f.swing.id]).toBeDefined();
  });

  it('rejects targets that break the slot rules before writing', async () => {
    const f = await setup();
    const { version } = await f.version();
    const put = (targets: object) => f.call('PUT', 'plan/program', { expected_version: version,
      program: { start: '2030-01-07', weeks: [{ week: weekOf(f.day.id, f.run.id), targets }] } });
    expect((await put({ nope: { target_reps: 5 } })).body).toEqual({ error: 'unknown_slot', slot: 'nope', week: 0 });
    expect((await put({ [f.swing.id]: { target_reps: 0 } })).body)
      .toEqual({ error: 'invalid_targets', slot: f.swing.id, week: 0, fields: ['target_reps'] });
    expect((await put({ [f.swing.id]: { target_reps: 20 } })).body)
      .toEqual({ error: 'invalid_targets', slot: f.swing.id, week: 0, fields: ['target_reps_max'] });
    expect((await put({ [f.swing.id]: { run_steps: [{ kind: 'work', distance_m: 400 }] } })).body)
      .toMatchObject({ error: 'invalid_targets', fields: ['run_steps'] });
    const unknown = await put({ [f.swing.id]: { cues: 'hips' } });
    expect(unknown.status).toBe(400);
    expect(unknown.body.fields).toEqual([`program.weeks.0.targets.${f.swing.id}.cues`]);
    expect((await f.version()).version).toBe(version);
  });

  it('drops saved targets a slot no longer takes when the block is sent back, and checks new ones', async () => {
    const f = await setup();
    const program = (targets: object) => ({ start: '2030-01-07', weeks: [
      { week: weekOf(f.day.id, f.run.id), targets }] });
    const first = await f.call('PUT', 'plan/program', { expected_version: (await f.version()).version,
      program: program({ [f.runSlot.id]: { run_steps: [{ kind: 'work', distance_m: 16093 }] },
        [f.plank.id]: { target_duration_s: 60 }, [f.swing.id]: { target_reps: 12 } }) });
    expect(first.status).toBe(200);
    // The app sends back what it read: run steps as stored text.
    const saved = parsePlanMeta((await f.version()).meta).program!.weeks[0]!.targets!;
    // The run slot drops its own steps, then becomes another exercise.
    expect((await f.call('PATCH', `workouts/${f.run.id}/exercises/${f.runSlot.id}`, { run_steps: null }))
      .status).toBe(200);
    const swapped = await f.call('POST', `workouts/${f.run.id}/exercises/${f.runSlot.id}/swap`,
      { to_exercise: 'ex_kb_swing', expected_version: (await f.version()).version });
    expect(swapped.status).toBe(200);
    expect((await f.call('DELETE', `workouts/${f.day.id}/exercises/${f.plank.id}`)).status).toBe(200);

    const resent = await f.call('PUT', 'plan/program', { expected_version: (await f.version()).version,
      program: program(saved) });
    expect(resent.status).toBe(200);
    expect(parsePlanMeta((await f.version()).meta).program!.weeks[0]!.targets)
      .toEqual({ [f.swing.id]: { target_reps: 12 } });

    // A new entry for the swapped slot, or one for a deleted slot, still fails.
    const { version } = await f.version();
    expect((await f.call('PUT', 'plan/program', { expected_version: version, program: program({
      [f.runSlot.id]: { run_steps: [{ kind: 'work', distance_m: 5000 }] } }) })).body)
      .toMatchObject({ error: 'invalid_targets', slot: f.runSlot.id, fields: ['run_steps'] });
    expect((await f.call('PUT', 'plan/program', { expected_version: version, program: program({
      [f.plank.id]: { target_duration_s: 90 } }) })).body)
      .toEqual({ error: 'unknown_slot', slot: f.plank.id, week: 0 });
    expect((await f.version()).version).toBe(version);
  });

  it('moves a group together and follows slots through a rebuild', async () => {
    const f = await setup();
    let { version } = await f.version();
    const grouped = await f.call('PUT', `workouts/${f.day.id}/groups`, { group_id: crypto.randomUUID(),
      exercises: [f.swing.id, f.plank.id], round_rest: 30, transition_rest: 0, target_sets: 3,
      expected_version: version });
    expect(grouped.status).toBe(200);
    ({ version } = await f.version());
    const put = (targets: object) => f.call('PUT', 'plan/program', { expected_version: version,
      program: { start: '2030-01-07', weeks: [{ week: weekOf(f.day.id, f.run.id), targets }] } });
    const groupId = (await env.DB.prepare('SELECT group_id FROM template_exercises WHERE id=?1')
      .bind(f.swing.id).first<{ group_id: string }>())!.group_id;
    expect((await put({ [f.swing.id]: { target_sets: 4 } })).body)
      .toEqual({ error: 'group_sets_mismatch', group_id: groupId, week: 0 });
    const both = await put({ [f.swing.id]: { target_sets: 4 }, [f.plank.id]: { target_sets: 4 } });
    expect(both.status).toBe(200);
  });

  it('keeps a group and its weeks agreeing when the group changes', async () => {
    const f = await setup();
    await f.call('POST', `workouts/${f.day.id}/exercises`, { exercise: 'ex_goblet_squat', target_sets: 3, target_reps: 8 });
    let { version } = await f.version();
    const program = (targets: object) => f.call('PUT', 'plan/program', { expected_version: version,
      program: { start: '2030-01-07', weeks: [{ week: weekOf(f.day.id, f.run.id), targets }] } });
    // Week 1 gives the ungrouped swing four rounds.
    expect((await program({ [f.swing.id]: { target_sets: 4 } })).status).toBe(200);
    ({ version } = await f.version());
    const groupId = crypto.randomUUID();
    const group = (target_sets: number) => f.call('PUT', `workouts/${f.day.id}/groups`, { group_id: groupId,
      exercises: [f.swing.id, f.plank.id], round_rest: 30, transition_rest: 0, target_sets,
      expected_version: version });
    // Grouping it with the plank, which that week leaves alone, would split
    // the group in that week, whatever the group's own count.
    for (const sets of [3, 4]) {
      const split = await group(sets);
      expect(split.status).toBe(400);
      expect(split.body).toEqual({ error: 'group_sets_mismatch', group_id: groupId, week: 0 });
    }
    expect((await f.version()).version).toBe(version);
    // Once the week names both, the group can have its own count.
    expect((await program({ [f.swing.id]: { target_sets: 4 }, [f.plank.id]: { target_sets: 4 } })).status)
      .toBe(200);
    ({ version } = await f.version());
    expect((await group(3)).status).toBe(200);
    ({ version } = await f.version());
    // Changing the group's own count leaves the week whole.
    const coach = async (name: string, args: unknown) => JSON.parse((await (await SELF.fetch(`${BASE}/mcp`, {
      method: 'POST', headers: { 'content-type': 'application/json', Authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
    })).json<any>()).result.content[0].text);
    const adjusted = await coach('adjust_today', { intent: 'reduce_volume', magnitude: 'moderate' });
    expect(adjusted.error).toBeUndefined();
    const sets = await env.DB.prepare('SELECT target_sets FROM template_exercises WHERE id=?1')
      .bind(f.swing.id).first<{ target_sets: number }>();
    expect(sets!.target_sets).toBeLessThan(3);
    expect(parsePlanMeta((await f.version()).meta).program!.weeks[0]!.targets).toMatchObject({
      [f.swing.id]: { target_sets: 4 }, [f.plank.id]: { target_sets: 4 } });
    ({ version } = await f.version());

    // A rebuild that pulls a third slot, which the week leaves alone, into
    // the group is checked the same way.
    const member = { group_id: groupId, group_rest_seconds: 30, group_transition_seconds: 0, target_sets: 3 };
    const workouts = [
      { name: 'Bells', exercises: [
        { exercise: 'ex_kb_swing', target_reps: 10, target_weight: 24, target_weight_unit: 'kg', ...member },
        { exercise: 'ex_plank', target_reps: 1, target_duration_s: 45, ...member },
        { exercise: 'ex_goblet_squat', target_reps: 8, ...member }] },
      { name: 'Long run', exercises: [{ exercise: 'ex_outdoor_run', target_sets: 1, target_reps: 1 }] }];
    const rebuilt = await SELF.fetch(`${BASE}/mcp`, { method: 'POST',
      headers: { 'content-type': 'application/json', Authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call',
        params: { name: 'update_plan', arguments: { expected_version: version, workouts } } }) });
    const text = (await rebuilt.json<any>()).result.content[0].text;
    expect(JSON.parse(text)).toMatchObject({ error: 'group_sets_mismatch', week: 0 });
    expect((await f.version()).version).toBe(version);
  });
});

describe('per-week targets from the coach', () => {
  async function mcp(name: string, args: unknown) {
    const response = await SELF.fetch(`${BASE}/mcp`, { method: 'POST',
      headers: { 'content-type': 'application/json', Authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }) });
    return JSON.parse((await response.json<any>()).result.content[0].text);
  }

  it("sets a week's targets, shows them in today's workout and keeps them through update_plan", async () => {
    const f = await setup();
    const every = Object.fromEntries(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((d) => [d, 'Bells']));
    const set = await mcp('set_program', { program: { start: '2024-01-01', repeat: true, weeks: [
      { label: 'Heavy', week: every, targets: { [f.swing.id]: { target_weight: 32 } } }] } });
    expect(set).toMatchObject({ ok: true });
    const today = await mcp('get_today_workout', {});
    expect(today.program_week.targets).toEqual([
      { slot_id: f.swing.id, workout: 'Bells', exercise: expect.any(String), target_weight: 32 }]);

    const plan = await mcp('get_current_plan', {});
    const rebuilt = await mcp('update_plan', { expected_version: plan.version, workouts: [
      { name: 'Bells', exercises: [
        { exercise: 'ex_kb_swing', target_sets: 5, target_reps: 10, target_weight: 24, target_weight_unit: 'kg' }] },
      { name: 'Long run', exercises: [{ exercise: 'ex_outdoor_run', target_sets: 1, target_reps: 1 }] }] });
    expect(rebuilt).toMatchObject({ conflict: false });
    const program = parsePlanMeta((await f.version()).meta).program!;
    const [slotId] = Object.keys(program.weeks[0]!.targets ?? {});
    const newSwing = await env.DB.prepare(`SELECT te.id FROM template_exercises te JOIN workouts w ON w.id=te.workout_id
      WHERE w.plan_id=?1 AND te.exercise_id='ex_kb_swing' AND w.name='Bells'`).bind(f.plan.id).first<{ id: string }>();
    expect(slotId).toBe(newSwing!.id);
    expect(program.weeks[0]!.targets![slotId!]).toEqual({ target_weight: 32 });
    await mcp('set_program', { program: null });
  });

  it("logs a coach's set without a unit in the unit the week sets", async () => {
    const f = await setup();
    const every = Object.fromEntries(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((d) => [d, 'Bells']));
    await mcp('set_program', { program: { start: '2030-01-07', weeks: [
      { week: every, targets: { [f.swing.id]: { target_weight: 53, target_weight_unit: 'lb' } } }] } });
    const planned = (await f.call('POST', 'sessions', { date: '2030-01-08', workout_id: f.day.id })).body;
    const logged = await mcp('log_set', { exercise: 'ex_kb_swing', weight: 53, reps: 10, session_date: '2030-01-08' });
    expect(logged.session_id).toBe(planned.id);
    expect(logged.set).toMatchObject({ weight: 53, weight_unit: 'lb' });
    // Outside the block the slot's own kg applies.
    await f.call('POST', 'sessions', { date: '2030-01-20', workout_id: f.day.id });
    const plain = await mcp('log_set', { exercise: 'ex_kb_swing', weight: 24, reps: 10, session_date: '2030-01-20' });
    expect(plain.set).toMatchObject({ weight: 24, weight_unit: 'kg' });
    await mcp('set_program', { program: null });
  });
});
