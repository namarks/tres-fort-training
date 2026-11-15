import { applyD1Migrations, env, SELF } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { moveCalendarWorkout } from '../src/db';
import { parsePlanSnapshot } from '../src/planSnapshots';

// One-time workouts (docs/plans/workout-library P3): a workout made for one
// date. A change for "just today" never touches the reusable workout, and a
// one-time workout stays out of the library, the week, blocks and rebuilds.

beforeAll(async () => applyD1Migrations(env.DB, env.TEST_MIGRATIONS));
const base = 'https://tres-fort.test';

async function tool(name: string, args: unknown = {}) {
  const response = await SELF.fetch(`${base}/mcp`, { method: 'POST',
    headers: { Authorization: 'Bearer test-mcp-token', 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }) });
  return JSON.parse((await response.json<any>()).result.content[0].text);
}

const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const weekdayOf = (date: string) => WEEKDAYS[new Date(`${date}T12:00:00Z`).getUTCDay()]!;
const mondayOf = (date: string) => {
  const day = new Date(`${date}T12:00:00Z`);
  day.setUTCDate(day.getUTCDate() - ((day.getUTCDay() + 6) % 7));
  return day.toISOString().slice(0, 10);
};

describe('one-time workouts', () => {
  let jwt: string;
  let today: string;
  let run: any;
  let bells: any;
  async function api(path: string, method = 'GET', body?: unknown) {
    const response = await SELF.fetch(`${base}/api/${path}`, { method,
      headers: { Authorization: `Bearer ${jwt}`, 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, body: await response.json<any>() };
  }
  const plan = async () => (await api('plan/active')).body;

  // Every test starts from this plan: a run scheduled today and a grouped
  // kettlebell workout, with a block week that lengthens the run today.
  beforeAll(async () => {
    const auth = await SELF.fetch(`${base}/auth/dev`, { method: 'POST',
      headers: { 'content-type': 'application/json' }, body: JSON.stringify({ secret: 'test-dev' }) });
    jwt = (await auth.json<{ jwt: string }>()).jwt;
    const built = await tool('update_plan', { workouts: [
      { name: 'Tempo run', exercises: [{ exercise: 'ex_outdoor_run', target_sets: 1, target_reps: 1,
        run_steps: [{ kind: 'work', distance_m: 5000 }] }] },
      { name: 'Bells', exercises: [
        { exercise: 'ex_kb_swing', target_sets: 4, target_reps: 10, target_weight: 24, target_weight_unit: 'kg' },
        { exercise: 'ex_plank', target_sets: 3, target_reps: 1, target_duration_s: 45 }] },
    ] });
    [run, bells] = built.plan.workouts;
    today = (await tool('get_today_workout')).date;
    let tree = await plan();
    expect((await api('plan/schedule', 'PUT', { week: { [weekdayOf(today)]: run.id },
      expected_plan_id: tree.id, expected_version: tree.version })).status).toBe(200);
    tree = await plan();
    const group = await api(`workouts/${bells.id}/groups`, 'PUT', { group_id: crypto.randomUUID(),
      exercises: bells.exercises.map((slot: any) => slot.id), round_rest: 60, target_sets: 3,
      expected_version: tree.version });
    expect(group.status).toBe(200);
    tree = await plan();
    const every = Object.fromEntries(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((d) => [d, null]));
    expect((await api('plan/program', 'PUT', { expected_version: tree.version, program: {
      start: mondayOf(today), repeat: true, weeks: [{ week: { ...every, [weekdayOf(today)]: run.id },
        targets: { [run.exercises[0].id]: { run_steps: [{ kind: 'work', distance_m: 8000 }] } } }] } })).status)
      .toBe(200);
  });

  it("copies today's workout for today only and puts it in place, leaving the run unchanged", async () => {
    const before = await plan();
    const made = await tool('add_one_time_workout', { date: today });
    expect(made).toMatchObject({ ok: true, placed: true, workout: { name: 'Tempo run', one_time_date: today } });
    // The copy starts from what today asks for: the block week's 8 km.
    const [slot] = made.workout.exercises;
    expect(JSON.parse(slot.run_steps)).toEqual([{ kind: 'work', distance_m: 8000 }]);
    expect(slot.id).not.toBe(run.exercises[0].id);
    expect(made.session).toMatchObject({ date: today, workout_id: made.workout.id, status: 'planned' });

    // Make it harder: only the copy changes.
    const harder = [{ kind: 'work', distance_m: 10000 }];
    expect(await tool('update_exercise', { template_exercise_id: slot.id, patch: { run_steps: harder } }))
      .not.toHaveProperty('error');
    const after = await plan();
    const saved = after.workouts.find((w: any) => w.id === run.id);
    expect(saved.exercises[0].run_steps).toBe(before.workouts.find((w: any) => w.id === run.id).exercises[0].run_steps);
    expect(JSON.parse(after.workouts.find((w: any) => w.id === made.workout.id).exercises[0].run_steps)).toEqual(harder);
    // The weekly schedule and block still name the reusable run.
    const meta = JSON.parse(after.meta);
    expect(meta.schedule.week[weekdayOf(today)]).toBe(run.id);

    // The coach reads it apart from the library.
    const current = await tool('get_current_plan');
    expect(current.workouts.map((w: any) => w.id)).not.toContain(made.workout.id);
    expect(current.one_time_workouts.map((w: any) => w.id)).toEqual([made.workout.id]);
    const day = await tool('get_today_workout');
    expect(day.session.workout_id).toBe(made.workout.id);
    expect(day.plan_workouts.map((w: any) => w.id)).not.toContain(made.workout.id);
    expect(day.one_time_workouts[0]).toMatchObject({ id: made.workout.id, one_time_date: today });
  });

  it('copies a grouped workout with new group ids and starts one from exercises', async () => {
    const tree = await plan();
    const copy = await api('workouts', 'POST', { name: 'Bells, lighter', one_time_date: today,
      id: crypto.randomUUID(), copy_from: bells.id, expected_plan_id: tree.id, expected_version: tree.version });
    expect(copy.status).toBe(201);
    expect(copy.body).toMatchObject({ one_time_date: today });
    // Released plan reads hide groups; the coach's read shows them.
    const coach = await tool('get_current_plan');
    const copied = coach.one_time_workouts.find((w: any) => w.id === copy.body.id);
    const source = coach.workouts.find((w: any) => w.id === bells.id);
    expect(copied.exercises.map((s: any) => [s.exercise_id, s.target_sets, s.target_weight, s.target_weight_unit,
      s.target_duration_s])).toEqual(source.exercises.map((s: any) => [s.exercise_id, s.target_sets, s.target_weight,
      s.target_weight_unit, s.target_duration_s]));
    const groups = new Set(copied.exercises.map((s: any) => s.group_id));
    expect(groups.size).toBe(1);
    expect(groups.has(null)).toBe(false);
    expect(groups.has(source.exercises[0].group_id)).toBe(false);

    const fresh = await tool('add_one_time_workout', { date: today, name: 'Hotel', exercises: ['ex_kb_swing'],
      place: 'none' });
    expect(fresh).toMatchObject({ ok: true, placed: false, workout: { name: 'Hotel', one_time_date: today } });
    expect(fresh.workout.exercises.map((s: any) => s.exercise_id)).toEqual(['ex_kb_swing']);
  });

  it('returns the same workout for a retried create and refuses a different one with that id', async () => {
    const tree = await plan();
    const request = { name: 'Short run', one_time_date: today, id: crypto.randomUUID(), copy_from: run.id,
      expected_plan_id: tree.id, expected_version: tree.version };
    const first = await api('workouts', 'POST', request);
    expect(first.status).toBe(201);
    const retry = await api('workouts', 'POST', request);
    expect(retry.status).toBe(201);
    expect(retry.body.id).toBe(first.body.id);
    expect((await plan()).workouts.filter((w: any) => w.name === 'Short run')).toHaveLength(1);
    const other = await api('workouts', 'POST', { ...request, name: 'Long run', expected_version: (await plan()).version });
    expect(other).toMatchObject({ status: 409, body: { error: 'one_time_workout_conflict' } });
    // A one-time request must carry its id and the reviewed plan version.
    expect((await api('workouts', 'POST', { name: 'Loose', one_time_date: today })).status).toBe(400);
    expect((await api('workouts', 'POST', { name: 'Loose', copy_from: run.id })).status).toBe(400);
  });

  it('keeps one-time workouts out of the week, blocks and whole-plan changes', async () => {
    const made = await tool('add_one_time_workout', { date: today, place: 'none' });
    const id = made.workout.id;
    let tree = await plan();
    const schedule = await api('plan/schedule', 'PUT', { week: { mon: id },
      expected_plan_id: tree.id, expected_version: tree.version });
    expect(schedule.status).toBe(400);
    expect(await tool('set_schedule', { week: { mon: id } })).toMatchObject({ error: 'unknown_day_ref' });
    expect(await tool('set_program', { program: { start: mondayOf(today), weeks: [{ week: { mon: id } }] } }))
      .toMatchObject({ error: 'unknown_day_ref' });

    // A reference by name reaches the reusable workout, not its copy.
    const swing = bells.exercises[0];
    const bellsCopy = await tool('add_one_time_workout', { date: today, copy_from: 'Bells', place: 'none' });
    expect(await tool('update_exercise', { day: 'Bells', exercise: 'ex_kb_swing', patch: { target_reps: 12 } }))
      .not.toHaveProperty('error');
    tree = await plan();
    expect(tree.workouts.find((w: any) => w.id === bells.id).exercises
      .find((s: any) => s.exercise_id === 'ex_kb_swing').target_reps).toBe(12);
    expect(tree.workouts.find((w: any) => w.id === bellsCopy.workout.id).exercises
      .find((s: any) => s.exercise_id === 'ex_kb_swing').target_reps).toBe(swing.target_reps);

    // A whole-plan reduction changes the library only.
    await tool('adjust_today', { intent: 'reduce_intensity', magnitude: 'light' });
    tree = await plan();
    expect(tree.workouts.find((w: any) => w.id === bellsCopy.workout.id).exercises
      .find((s: any) => s.exercise_id === 'ex_kb_swing').target_weight).toBe(24);
  });

  it('survives an update_plan rebuild with its slots and its date', async () => {
    const made = await tool('add_one_time_workout', { date: today });
    const current = await tool('get_current_plan');
    const rebuilt = await tool('update_plan', { expected_version: current.version, workouts: [
      ...current.workouts.map((w: any) => ({ name: w.name, exercises: w.exercises.map((s: any) => ({
        exercise: s.exercise_id, target_sets: s.target_sets, target_reps: s.target_reps,
        target_duration_s: s.target_duration_s, target_weight: s.target_weight,
        target_weight_unit: s.target_weight_unit })) })),
      { name: 'Mobility', exercises: [{ exercise: 'ex_plank', target_sets: 2, target_reps: 1, target_duration_s: 30 }] }] });
    expect(rebuilt).toMatchObject({ conflict: false });
    const tree = await plan();
    const kept = tree.workouts.find((w: any) => w.id === made.workout.id);
    expect(kept).toMatchObject({ one_time_date: today });
    expect(kept.exercises.map((s: any) => s.id)).toEqual(made.workout.exercises.map((s: any) => s.id));
    expect(tree.workouts.filter((w: any) => w.one_time_date == null).map((w: any) => w.name).sort())
      .toEqual(['Bells', 'Mobility', 'Tempo run']);
    expect((await tool('get_today_workout')).session.workout_id).toBe(made.workout.id);
  });

  it('records the date in plan snapshots', async () => {
    const made = await tool('add_one_time_workout', { date: today, place: 'none' });
    const tree = await plan();
    const row = await env.DB.prepare('SELECT document FROM plan_snapshots WHERE plan_id=?1 AND version=?2')
      .bind(tree.id, tree.version).first<{ document: string }>();
    const workout = parsePlanSnapshot(row!.document).workouts.find((w) => w.id === made.workout.id);
    expect(workout).toMatchObject({ one_time_date: today });
  });

  it('keeps a one-time workout on its own date and out of named adjustments', async () => {
    const shift = (date: string, days: number) => {
      const day = new Date(`${date}T12:00:00Z`);
      day.setUTCDate(day.getUTCDate() + days);
      return day.toISOString().slice(0, 10);
    };
    const later = shift(today, 2);
    const other = shift(today, 3);
    const made = await tool('add_one_time_workout', { date: later, copy_from: 'Bells' });
    expect(made).toMatchObject({ ok: true, placed: true, workout: { one_time_date: later } });
    const id = made.workout.id;

    // Not on another date: not assigned, added beside, started or moved there.
    expect(await tool('set_planned_session', { date: other, day: id, expected_attempt: 0 }))
      .toMatchObject({ error: 'unknown_day_ref' });
    expect(await tool('set_planned_session', { date: other, day: id, additional: true, id: crypto.randomUUID() }))
      .toMatchObject({ error: 'unknown_day_ref' });
    expect((await api('sessions', 'POST', { date: other, workout_id: id })).status).toBe(422);
    const tree = await plan();
    const owner = await env.DB.prepare('SELECT user_id FROM plans WHERE id=?1').bind(tree.id)
      .first<{ user_id: string }>();
    expect(await moveCalendarWorkout(env.DB, owner!.user_id, { id: crypto.randomUUID(), workout_id: id,
      from_date: later, to_date: other, today, expected_plan_id: tree.id, expected_version: tree.version,
      expected_from_attempt: made.session.attempt, expected_to_attempt: 0 }))
      .toEqual({ error: 'calendar_move_conflict' });
    expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM sessions WHERE date=?1').bind(other)
      .first<{ n: number }>()).toEqual({ n: 0 });

    // Naming the reusable workout never reaches its copy, which shares the name.
    const weight = (workoutID: string) => tree.workouts.find((w: any) => w.id === workoutID).exercises
      .find((s: any) => s.exercise_id === 'ex_kb_swing').target_weight;
    const copyBefore = weight(id);
    const sourceBefore = weight(bells.id);
    await tool('adjust_today', { intent: 'reduce_intensity', magnitude: 'heavy', day_label: 'Bells' });
    const after = await plan();
    const weightAfter = (workoutID: string) => after.workouts.find((w: any) => w.id === workoutID).exercises
      .find((s: any) => s.exercise_id === 'ex_kb_swing').target_weight;
    expect(weightAfter(id)).toBe(copyBefore);
    expect(weightAfter(bells.id)).toBeLessThan(sourceBefore);
  });

  it('will not replace a started workout and checks the date it is asked to change', async () => {
    const tree = await plan();
    const start = await api('sessions', 'POST', { date: today, workout_id: run.id });
    expect(start.status).toBeLessThan(300);
    await env.DB.prepare("UPDATE sessions SET status='in_progress', started_at=?2 WHERE id=?1")
      .bind(start.body.id ?? start.body.session?.id, Date.now()).run();
    const versionBefore = tree.version;
    expect(await tool('add_one_time_workout', { date: today })).toMatchObject({ error: 'session_already_started' });
    expect(await tool('add_one_time_workout', { date: '2026-02-30' })).toMatchObject({ error: 'invalid_date' });
    expect((await plan()).version).toBe(versionBefore);
  });
  it('reaches a one-time workout only by its id and returns it again for a retried caller id', async () => {
    const day = new Date(`${today}T12:00:00Z`);
    day.setUTCDate(day.getUTCDate() + 5);
    const date = day.toISOString().slice(0, 10);
    const id = crypto.randomUUID();
    const first = await tool('add_one_time_workout', { date, copy_from: 'Bells', id });
    expect(first).toMatchObject({ ok: true, placed: true, workout: { id, one_time_date: date } });
    const version = (await plan()).version;
    expect(await tool('add_one_time_workout', { date, copy_from: 'Bells', id }))
      .toMatchObject({ ok: true, placed: true, workout: { id }, session: { workout_id: id } });
    expect((await plan()).version).toBe(version);
    expect(await tool('add_one_time_workout', { date, id: 'not-a-uuid' }))
      .toMatchObject({ error: 'invalid_fields', fields: ['id'] });

    // Once the reusable Bells no longer has swings, its name still never
    // reaches the copy's swing slot; the copy's id does.
    expect(await tool('swap_exercise', { day: 'Bells', from_exercise: 'ex_kb_swing', to_exercise: 'ex_kb_deadlift' }))
      .not.toHaveProperty('error');
    expect(await tool('update_exercise', { day: 'Bells', exercise: 'ex_kb_swing', patch: { target_reps: 5 } }))
      .toMatchObject({ error: 'slot_not_found' });
    expect(await tool('update_exercise', { day: id, exercise: 'ex_kb_swing', patch: { target_reps: 6 } }))
      .not.toHaveProperty('error');
    expect(await tool('add_exercise', { day: id, exercise: 'ex_kb_clean', target_sets: 3, target_reps: 5 }))
      .not.toHaveProperty('error');
    const tree = await plan();
    const copy = tree.workouts.find((w: any) => w.id === id);
    expect(copy.exercises.find((s: any) => s.exercise_id === 'ex_kb_swing').target_reps).toBe(6);
    expect(copy.exercises.map((s: any) => s.exercise_id)).toContain('ex_kb_clean');
    expect(tree.workouts.find((w: any) => w.id === bells.id).exercises.map((s: any) => s.exercise_id))
      .not.toContain('ex_kb_clean');
  });
});
