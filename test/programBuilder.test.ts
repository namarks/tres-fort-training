import { applyD1Migrations, env, SELF } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { weekdayOf } from '../src/calendarProjection';
import {
  buildEventProgram,
  defaultPeakMeters,
  defaultTaperWeeks,
  defaultWorkoutWeekday,
  METERS_PER_MILE,
  mondayOf,
  mondayOnOrAfter,
  scaleRun,
  weeksToEvent,
  type BuildRules,
  type BuildRunSlot,
} from '../src/programBuilder';
import { parsePlanMeta, type ScheduleWeek } from '../src/types';
import { addDays, todayForUser } from '../src/db';

// "Train for an event" (docs/plans/progressive-plans P3): fixed rules lay
// out a block of weeks to an event.

const mi = (n: number) => Math.round(n * METERS_PER_MILE);
const week = (days: Partial<ScheduleWeek>): ScheduleWeek =>
  ({ mon: null, tue: null, wed: null, thu: null, fri: null, sat: null, sun: null, ...days });
const yourWeek = week({ mon: 'kb', tue: 'intervals', thu: 'kb_b', sat: 'tempo', sun: 'long' });
const slots: BuildRunSlot[] = [
  { id: 'long_slot', workout_id: 'long', target_duration_s: null,
    run_steps: JSON.stringify([{ kind: 'work', distance_m: 9656, target: { type: 'heart_rate', min_bpm: 130, max_bpm: 145 } }]) },
  { id: 'intervals_slot', workout_id: 'intervals', target_duration_s: null,
    run_steps: JSON.stringify([{ kind: 'warmup', duration_s: 600 },
      { repeat: 6, steps: [{ kind: 'work', distance_m: 400 }, { kind: 'recovery', duration_s: 90 }] },
      { kind: 'cooldown', duration_s: 600 }]) },
  { id: 'tempo_slot', workout_id: 'tempo', target_duration_s: 2400, run_steps: null },
];
// 17 weeks from Mon 2031-02-03 to a Sunday marathon on 2031-06-01.
const marathon: BuildRules = {
  start: '2031-02-03', race_date: '2031-06-01', race_distance_m: 42195, long_run_weekday: 'sun',
  long_run_now_m: mi(8), peak_m: mi(20), easy_every: 4, taper_weeks: 3, shorten_other_runs: true, unit: 'mi',
};

describe('event builder rules', () => {
  it('builds a marathon from the longest run lately to the peak, with easier weeks and a taper', () => {
    expect(weekdayOf(marathon.start)).toBe('mon');
    expect(weeksToEvent(marathon.start, marathon.race_date)).toBe(17);
    const built = buildEventProgram(marathon, 'Spring Marathon', yourWeek, undefined, slots);
    if (!('ok' in built)) throw new Error(JSON.stringify(built));
    const miles = built.weeks.map((w) => (w.long_run_m == null ? null : Math.round(w.long_run_m / METERS_PER_MILE * 10) / 10));
    // Never more than 15% or a mile a week, even after rounding.
    expect(miles).toEqual([8, 9, 10, 8, 11, 12, 13, 10, 14, 16, 18, 14, 19, 20, 14, 10, 26.2]);
    const build = miles.filter((_, i) => built.weeks[i]!.phase !== 'easy' && i < 14) as number[];
    build.slice(1).forEach((value, i) => expect(value - build[i]!).toBeLessThanOrEqual(Math.max(1, build[i]! * 0.15)));
    expect(built.weeks.map((w) => w.phase)).toEqual(['base', 'base', 'base', 'easy', 'build', 'build', 'build',
      'easy', 'build', 'build', 'build', 'easy', 'peak', 'peak', 'taper', 'taper', 'race']);
    expect(built.reached_peak).toBe(true);
    expect(built.program).toMatchObject({ name: 'Spring Marathon', start: '2031-02-03', repeat: false });
    expect(built.program.weeks).toHaveLength(17);
    // The long run keeps the heart rate its slot aims at.
    expect(built.program.weeks[0]!.targets!.long_slot).toEqual({ run_steps: [{ kind: 'work', distance_m: mi(8),
      target: { type: 'heart_rate', min_bpm: 130, max_bpm: 145 } }] });
    // Race day is the long run day, so the long run is the race.
    expect(built.program.weeks[16]!.targets!.long_slot!.run_steps).toEqual([{ kind: 'work', distance_m: 42195,
      target: { type: 'heart_rate', min_bpm: 130, max_bpm: 145 } }]);
    // Lifts and the rest of the week are Your week.
    expect(built.program.weeks[5]!.week).toEqual(yourWeek);
    expect(built.program.weeks[5]!.label).toBe('Build');
  });

  it('shortens other runs in easier and taper weeks and leaves full weeks alone', () => {
    const built = buildEventProgram(marathon, 'M', yourWeek, undefined, slots);
    if (!('ok' in built)) throw new Error(JSON.stringify(built));
    expect(built.program.weeks[0]!.targets!.intervals_slot).toBeUndefined();
    const easy = built.program.weeks[3]!.targets!;
    expect(easy.tempo_slot).toEqual({ target_duration_s: 1800 });
    expect(easy.intervals_slot).toEqual({ run_steps: [{ kind: 'warmup', duration_s: 450 },
      { repeat: 6, steps: [{ kind: 'work', distance_m: 300 }, { kind: 'recovery', duration_s: 70 }] },
      { kind: 'cooldown', duration_s: 450 }] });
    const keepOthers = buildEventProgram({ ...marathon, shorten_other_runs: false }, 'M', yourWeek, undefined, slots);
    if (!('ok' in keepOthers)) throw new Error('expected a block');
    expect(Object.keys(keepOthers.program.weeks[3]!.targets!)).toEqual(['long_slot']);
  });

  it('never adds more than 15% or a mile a week, and says when that stops short of the peak', () => {
    const built = buildEventProgram({ ...marathon, start: '2031-04-14', long_run_now_m: mi(3), easy_every: 0 },
      'M', yourWeek, undefined, slots);
    if (!('ok' in built)) throw new Error(JSON.stringify(built));
    const miles = built.weeks.slice(0, -3).map((w) => Math.round(w.long_run_m! / METERS_PER_MILE));
    expect(miles).toEqual([3, 4, 5, 6]);
    expect(built.reached_peak).toBe(false);
  });

  it('caps the first week too, so a block too short to build never jumps to the peak', () => {
    // Four weeks with a three-week taper leave one build week.
    const built = buildEventProgram({ ...marathon, start: '2031-05-05', long_run_now_m: mi(3) },
      'M', yourWeek, undefined, slots);
    if (!('ok' in built)) throw new Error(JSON.stringify(built));
    expect(Math.round(built.weeks[0]!.long_run_m! / METERS_PER_MILE)).toBe(4);
    expect(built.reached_peak).toBe(false);
  });

  it('shortens short repeats instead of stretching them to a minimum', () => {
    const short: BuildRunSlot = { id: 'strides', workout_id: 'intervals', target_duration_s: null,
      run_steps: JSON.stringify([{ repeat: 10, steps: [{ kind: 'work', duration_s: 30 }, { kind: 'recovery', duration_s: 30 },
        { kind: 'work', distance_m: 60 }]}]) };
    expect(scaleRun(short, 0.5)).toEqual({ run_steps: [{ repeat: 10, steps: [{ kind: 'work', duration_s: 15 },
      { kind: 'recovery', duration_s: 15 }, { kind: 'work', distance_m: 30 }] }] });
    // Nothing ever grows, even a step already at the smallest unit.
    expect(scaleRun({ ...short, run_steps: JSON.stringify([{ kind: 'work', duration_s: 3 }]) }, 0.5))
      .toEqual({ run_steps: [{ kind: 'work', duration_s: 3 }] });
    expect(scaleRun({ ...short, run_steps: null, target_duration_s: 40 }, 0.75)).toEqual({ target_duration_s: 30 });
  });

  it('rests after a Saturday race and leaves no long run that week', () => {
    const built = buildEventProgram({ ...marathon, race_date: '2031-05-31' }, 'M', yourWeek, undefined, slots);
    if (!('ok' in built)) throw new Error(JSON.stringify(built));
    const last = built.program.weeks.at(-1)!;
    expect(last.week).toMatchObject({ mon: 'kb', tue: 'intervals', sat: null, sun: null });
    expect(last.targets?.long_slot).toBeUndefined();
    expect(built.weeks.at(-1)!.long_run_m).toBeNull();
  });

  it('plans in kilometers and has defaults that suit the distance', () => {
    expect(defaultPeakMeters(42195)).toBe(mi(20));
    expect(defaultPeakMeters(21097)).toBe(mi(12));
    expect(defaultPeakMeters(10000)).toBe(mi(9));
    expect(defaultPeakMeters(5000)).toBe(mi(7));
    expect([42195, 21097, 10000].map(defaultTaperWeeks)).toEqual([3, 2, 1]);
    const built = buildEventProgram({ ...marathon, unit: 'km', long_run_now_m: 12_300 }, 'M', yourWeek, undefined, slots);
    if (!('ok' in built)) throw new Error(JSON.stringify(built));
    expect(built.weeks[0]!.long_run_m).toBe(12_000);
    expect(mondayOnOrAfter('2031-02-01')).toBe('2031-02-03');
    expect(mondayOnOrAfter('2031-02-03')).toBe('2031-02-03');
  });

  it('needs a run on the long run day that no other day shares', () => {
    expect(buildEventProgram(marathon, 'M', week({ mon: 'kb' }), undefined, slots)).toEqual({ error: 'no_long_run' });
    expect(buildEventProgram(marathon, 'M', week({ wed: 'long', sun: 'long' }), undefined, slots))
      .toEqual({ error: 'long_run_shared', weekday: 'wed' });
    // A run among the day's extras counts.
    const extra = buildEventProgram(marathon, 'M', week({ sun: 'kb' }), { sun: ['long'] }, slots);
    expect('ok' in extra && extra.long_run_slot).toBe('long_slot');
    expect(buildEventProgram({ ...marathon, race_date: '2033-01-01' }, 'M', yourWeek, undefined, slots))
      .toEqual({ error: 'too_many_weeks' });
    expect(buildEventProgram({ ...marathon, race_date: '2031-01-01' }, 'M', yourWeek, undefined, slots))
      .toEqual({ error: 'event_before_start' });
  });

  it('makes race week the whole block when the event is this week', () => {
    const built = buildEventProgram({ ...marathon, start: '2031-05-26' }, 'M', yourWeek, undefined, slots);
    if (!('ok' in built)) throw new Error(JSON.stringify(built));
    expect(built.weeks.map((w) => w.phase)).toEqual(['race']);
  });
});

describe('plan styles', () => {
  const steps = (targets: Record<string, unknown> | undefined) => targets?.run_steps as Array<Record<string, any>>;

  it('suggests a midweek workout day whose run is on no other day, away from the long run', () => {
    expect(defaultWorkoutWeekday('sun', yourWeek, undefined, slots)).toBe('tue');
    // Saturday is next to the long run, so only without another choice.
    expect(defaultWorkoutWeekday('sun', week({ sat: 'tempo', sun: 'long' }), undefined, slots)).toBe('sat');
    expect(defaultWorkoutWeekday('sun', week({ tue: 'tempo', thu: 'tempo', sun: 'long' }), undefined, slots)).toBeNull();
    expect(defaultWorkoutWeekday('sun', week({ mon: 'kb', sun: 'long' }), undefined, slots)).toBeNull();
  });

  it('moves the workout day from strides to tempo to peak sessions and tapers them', () => {
    const built = buildEventProgram({ ...marathon, workout_weekday: 'tue' }, 'M', yourWeek, undefined, slots);
    if (!('ok' in built)) throw new Error(JSON.stringify(built));
    const sessions = built.weeks.map((w) => w.workout && `${w.workout.type} ${w.workout.reps}x${w.workout.work_s}`);
    expect(sessions).toEqual([
      'strides 6x20', 'strides 6x20', 'strides 6x20', 'strides 6x20',
      'tempo 1x900', 'tempo 1x1080', 'tempo 1x1260', 'strides 6x20', 'tempo 1x1440', 'tempo 1x1620', 'tempo 1x1800',
      'strides 6x20', 'tempo 1x1800', 'tempo 1x1800', 'tempo 1x1260', 'tempo 1x900', 'shakeout 4x20']);
    // The workout replaces the intervals slot's own steps; other runs still shrink.
    expect(steps(built.program.weeks[4]!.targets!.intervals_slot)).toEqual([{ kind: 'warmup', duration_s: 600 },
      { kind: 'work', duration_s: 900 }, { kind: 'cooldown', duration_s: 600 }]);
    expect(built.program.weeks[3]!.targets!.tempo_slot).toEqual({ target_duration_s: 1800 });
    // No goal time: the long run is all easy.
    expect(built.weeks.every((w) => w.long_run_goal_m == null)).toBe(true);
  });

  it('aims a goal-time marathon at goal pace: repeats at the peak and a goal-pace finish to the long run', () => {
    // 3:30 is 4:58.6 a kilometer.
    const built = buildEventProgram({ ...marathon, workout_weekday: 'tue', goal_time_s: 12_600 }, 'M', yourWeek, undefined, slots);
    if (!('ok' in built)) throw new Error(JSON.stringify(built));
    const goal = { type: 'pace', fastest_s_per_km: 294, slowest_s_per_km: 304 };
    expect(built.weeks[12]!.workout).toEqual({ type: 'goal_pace', reps: 2, work_s: 900 });
    expect(built.weeks[13]!.workout).toEqual({ type: 'goal_pace', reps: 2, work_s: 1200 });
    expect(built.weeks[14]!.workout).toEqual({ type: 'goal_pace', reps: 2, work_s: 840 });
    expect(steps(built.program.weeks[13]!.targets!.intervals_slot)[1]).toEqual({ repeat: 2,
      steps: [{ kind: 'work', duration_s: 1200, target: goal }, { kind: 'recovery', duration_s: 180 }] });
    // Tempo is quicker than marathon pace when the slot has no target of its own.
    expect(steps(built.program.weeks[4]!.targets!.intervals_slot)[1]!.target)
      .toEqual({ type: 'pace', fastest_s_per_km: 279, slowest_s_per_km: 289 });
    const goalMiles = built.weeks.map((w) => (w.long_run_goal_m == null ? 0 : Math.round(w.long_run_goal_m / METERS_PER_MILE)));
    expect(goalMiles).toEqual([0, 0, 0, 0, 1, 2, 2, 0, 3, 4, 5, 0, 6, 6, 3, 0, 26]);
    // The long run keeps its heart rate, then finishes at goal pace.
    expect(steps(built.program.weeks[13]!.targets!.long_slot)).toEqual([
      { kind: 'work', distance_m: mi(20) - mi(6), target: { type: 'heart_rate', min_bpm: 130, max_bpm: 145 } },
      { kind: 'work', distance_m: mi(6), target: goal }]);
    // Race day aims at goal pace, all of it.
    expect(built.weeks[16]!.long_run_goal_m).toBe(42195);
    expect(steps(built.program.weeks[16]!.targets!.long_slot)).toEqual([{ kind: 'work', distance_m: 42195, target: goal }]);
  });

  it("keeps the workout run's own heart rate for tempo", () => {
    const hrSlots = slots.map((slot) => (slot.id !== 'intervals_slot' ? slot : { ...slot,
      run_steps: JSON.stringify([{ kind: 'work', duration_s: 1200, target: { type: 'heart_rate', min_bpm: 150, max_bpm: 160 } }]) }));
    const built = buildEventProgram({ ...marathon, workout_weekday: 'tue', goal_time_s: 12_600 }, 'M', yourWeek, undefined, hrSlots);
    if (!('ok' in built)) throw new Error(JSON.stringify(built));
    expect(steps(built.program.weeks[4]!.targets!.intervals_slot)[1]!.target)
      .toEqual({ type: 'heart_rate', min_bpm: 150, max_bpm: 160 });
  });

  it('gives shorter races 3-minute intervals at the peak and rests a workout day after the race', () => {
    const tenK: BuildRules = { ...marathon, race_date: '2031-04-26', race_distance_m: 10_000, peak_m: mi(9),
      taper_weeks: 1, workout_weekday: 'thu', goal_time_s: 2700 };
    const built = buildEventProgram(tenK, '10K', week({ thu: 'intervals', sat: 'tempo', sun: 'long' }), undefined, slots);
    if (!('ok' in built)) throw new Error(JSON.stringify(built));
    const peaks = built.weeks.filter((w) => w.phase === 'peak').map((w) => w.workout);
    expect(peaks).toEqual([{ type: 'intervals', reps: 5, work_s: 180 }, { type: 'intervals', reps: 6, work_s: 180 }]);
    // No goal-pace finish to a 10K long run, but race day aims at goal pace.
    expect(built.weeks.slice(0, -1).every((w) => w.long_run_goal_m == null)).toBe(true);
    expect(built.weeks.at(-1)!.workout).toEqual({ type: 'shakeout', reps: 4, work_s: 20 });
    const saturday = buildEventProgram({ ...tenK, race_date: '2031-04-23' }, '10K',
      week({ thu: 'intervals', sat: 'tempo', sun: 'long' }), undefined, slots);
    if (!('ok' in saturday)) throw new Error(JSON.stringify(saturday));
    expect(saturday.weeks.at(-1)!.workout).toBeNull();
  });

  it('refuses a goal time whose paces a run step cannot hold', () => {
    // 4:30 kept after switching to a 5K is 54 minutes a kilometer.
    expect(buildEventProgram({ ...marathon, race_distance_m: 5000, goal_time_s: 16_200 }, '5K', yourWeek, undefined, slots))
      .toEqual({ error: 'goal_pace_out_of_range' });
    // A 2:00 marathon is under 3 minutes a kilometer: fine. Its tempo at 0.95 still fits.
    expect('ok' in buildEventProgram({ ...marathon, goal_time_s: 7200 }, 'M', yourWeek, undefined, slots)).toBe(true);
    // 1:20 is not.
    expect(buildEventProgram({ ...marathon, goal_time_s: 4800 }, 'M', yourWeek, undefined, slots))
      .toEqual({ error: 'goal_pace_out_of_range' });
  });

  it('needs its own run on the workout day', () => {
    expect(buildEventProgram({ ...marathon, workout_weekday: 'mon' }, 'M', yourWeek, undefined, slots))
      .toEqual({ error: 'no_workout_run' });
    expect(buildEventProgram({ ...marathon, workout_weekday: 'sun' }, 'M', yourWeek, undefined, slots))
      .toEqual({ error: 'no_workout_run' });
    expect(buildEventProgram({ ...marathon, workout_weekday: 'tue' }, 'M', week({ tue: 'tempo', sat: 'tempo', sun: 'long' }),
      undefined, slots)).toEqual({ error: 'workout_shared', weekday: 'sat' });
  });
});

describe('keep building, no date', () => {
  const open: BuildRules = { ...marathon, race_date: '', race_distance_m: 0, long_run_now_m: mi(6), peak_m: mi(10),
    open: { weeks: 12 }, workout_weekday: 'tue' };

  it('steps the long run up to the ceiling with an easier week every fourth, then holds there', () => {
    const built = buildEventProgram(open, 'Keep building', yourWeek, undefined, slots);
    if (!('ok' in built)) throw new Error(JSON.stringify(built));
    const miles = built.weeks.map((w) => Math.round(w.long_run_m! / METERS_PER_MILE));
    expect(miles).toEqual([7, 8, 9, 7, 10, 10, 10, 8, 10, 10, 10, 8]);
    expect(built.weeks.map((w) => w.phase)).toEqual(['base', 'base', 'base', 'easy', 'hold', 'hold', 'hold', 'easy',
      'hold', 'hold', 'hold', 'easy']);
    expect(built.reached_peak).toBe(true);
    expect(built.program).toMatchObject({ name: 'Keep building', repeat: false });
    expect(built.program.weeks.at(-1)!.week).toEqual(yourWeek);
    // Holding weeks keep a steady tempo; nothing tapers or races.
    expect(built.weeks[5]!.workout).toEqual({ type: 'tempo', reps: 1, work_s: 1440 });
    expect(built.weeks.every((w) => w.long_run_goal_m == null)).toBe(true);
  });

  it('eases the workout day in with strides even when the long run is already at the ceiling', () => {
    const built = buildEventProgram({ ...open, long_run_now_m: mi(10) }, 'Keep building', yourWeek, undefined, slots);
    if (!('ok' in built)) throw new Error(JSON.stringify(built));
    expect(built.weeks.slice(0, 5).map((w) => w.phase)).toEqual(['base', 'base', 'base', 'easy', 'hold']);
    expect(built.weeks.slice(0, 3).map((w) => w.workout?.type)).toEqual(['strides', 'strides', 'strides']);
    expect(built.weeks[4]!.workout?.type).toBe('tempo');
  });

  it('builds over cycles when the ceiling is far, never more than the cap', () => {
    const built = buildEventProgram({ ...open, long_run_now_m: mi(4), peak_m: mi(14), open: { weeks: 16 } },
      'Keep building', yourWeek, undefined, slots);
    if (!('ok' in built)) throw new Error(JSON.stringify(built));
    const miles = built.weeks.map((w) => Math.round(w.long_run_m! / METERS_PER_MILE));
    expect(miles).toEqual([5, 6, 7, 5, 8, 9, 10, 8, 11, 12, 13, 10, 14, 14, 14, 11]);
    expect(built.weeks.slice(4, 7).map((w) => w.phase)).toEqual(['build', 'build', 'build']);
    expect(built.weeks.at(-2)!.phase).toBe('hold');
  });
});

const BASE = 'https://tres-fort.test';

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
  const plan = (await call('POST', 'plan', { name: 'Event' })).body;
  const owner = (await env.DB.prepare('SELECT user_id FROM plans WHERE id=?1').bind(plan.id)
    .first<{ user_id: string }>())!.user_id;
  const kb = (await call('POST', 'workouts', { name: 'Kettlebell A' })).body.id as string;
  await call('POST', `workouts/${kb}/exercises`, { exercise: 'ex_goblet_squat', target_sets: 3, target_reps: 8 });
  const long = (await call('POST', 'workouts', { name: 'Long run' })).body.id as string;
  const longSlot = (await call('POST', `workouts/${long}/exercises`, { exercise: 'ex_outdoor_run',
    target_sets: 1, target_reps: 1, run_steps: [{ kind: 'work', distance_m: 8000 }] })).body;
  const version = async () => (await env.DB.prepare('SELECT version, meta FROM plans WHERE id=?1')
    .bind(plan.id).first<{ version: number; meta: string }>())!;
  expect((await call('PUT', 'plan/schedule', { week: { mon: kb, sun: long },
    expected_version: (await version()).version })).status).toBe(200);
  return { call, kb, long, longSlot, version, owner };
}

const event = { name: 'Spring Marathon', date: '2031-06-01', discipline: 'running', distance: 'Marathon', distance_m: 42195 };

describe('POST /api/plan/program/build', () => {
  it('previews from the longest run lately without writing, then saves the event and block together', async () => {
    const f = await setup();
    // Runs in the four weeks before today; an older, longer one does not count.
    for (const [id, date, meters] of [['a', '2031-01-25', 12_875], ['b', '2031-01-10', 11_000], ['c', '2030-12-01', 30_000]] as const) {
      await env.DB.prepare(`INSERT INTO external_activities (id,user_id,source,external_id,date,kind,distance_m,synced_at)
        VALUES (?1,?2,'intervals',?3,?4,'run',?5,1)`).bind(`intervals:activity:${f.owner}:${id}`, f.owner, id, date, meters).run();
    }
    const before = await f.version();
    const preview = await f.call('POST', 'plan/program/build', { race: event, today: '2031-02-01', long_run_weekday: 'sun' });
    expect(preview.status).toBe(200);
    expect(preview.body.preview).toMatchObject({ start: '2031-02-03', reached_peak: true, replaces_block: false,
      rules: { long_run_now_m: 12_875, longest_recent_m: 12_875, peak_m: mi(20), easy_every: 4, taper_weeks: 3, unit: 'mi' } });
    expect(preview.body.preview.weeks).toHaveLength(17);
    expect(preview.body.preview.plan_version).toBe(before.version);
    expect(preview.body.preview.weeks[0]).toMatchObject({ start: '2031-02-03', phase: 'base', long_run_m: mi(8) });
    expect(preview.body.version).toBeUndefined();
    expect((await f.version()).version).toBe(before.version);

    const saved = await f.call('POST', 'plan/program/build', { race: event, today: '2031-02-01', long_run_weekday: 'sun',
      peak_m: mi(18), save: true, expected_version: before.version });
    expect(saved.status).toBe(200);
    expect(saved.body.version).toBe(before.version + 1);
    const meta = parsePlanMeta((await f.version()).meta);
    expect(meta.race).toEqual(event);
    expect(meta.program).toMatchObject({ name: 'Spring Marathon', start: '2031-02-03', repeat: false });
    expect(meta.program!.weeks).toHaveLength(17);
    expect(meta.program!.weeks[0]!.week).toMatchObject({ mon: f.kb, sun: f.long });
    expect(JSON.parse(meta.program!.weeks[13]!.targets![f.longSlot.id]!.run_steps!))
      .toEqual([{ kind: 'work', distance_m: mi(18) }]);
    // A second preview knows saving now replaces that block, and a stale save conflicts.
    const again = await f.call('POST', 'plan/program/build', { race: event, today: '2031-02-01', long_run_weekday: 'sun' });
    expect(again.body.preview.replaces_block).toBe(true);
    const stale = await f.call('POST', 'plan/program/build', { race: event, today: '2031-02-01', long_run_weekday: 'sun',
      save: true, expected_version: before.version });
    expect(stale.status).toBe(409);
    expect(stale.body).toEqual({ conflict: true, current_version: before.version + 1 });
  });

  it('starts from 5 km with no recent runs and checks what it is sent', async () => {
    const f = await setup();
    const preview = await f.call('POST', 'plan/program/build', { race: { ...event, date: '2031-04-27', distance_m: 10_000, distance: '10K' },
      today: '2031-02-01', long_run_weekday: 'sun', unit: 'km' });
    expect(preview.status).toBe(200);
    expect(preview.body.preview.rules).toMatchObject({ long_run_now_m: 5000, longest_recent_m: null, taper_weeks: 1, unit: 'km',
      workout_weekday: null, style: 'finish', goal_pace_s_per_km: null });
    expect(preview.body.preview.weeks[0].long_run_m).toBe(5000);

    // Saving with every rule the preview resolved lays out the same weeks.
    const rules = preview.body.preview.rules;
    const resaved = await f.call('POST', 'plan/program/build', { race: { ...event, date: '2031-04-27', distance_m: 10_000,
      distance: '10K' }, today: '2031-02-01', start: preview.body.preview.start, long_run_weekday: 'sun', unit: 'km',
      long_run_now_m: rules.long_run_now_m, peak_m: rules.peak_m, easy_every: rules.easy_every,
      taper_weeks: rules.taper_weeks, shorten_other_runs: rules.shorten_other_runs,
      save: true, expected_version: preview.body.preview.plan_version });
    expect(resaved.status).toBe(200);
    expect(resaved.body.preview.weeks).toEqual(preview.body.preview.weeks);

    const bad = await f.call('POST', 'plan/program/build', { race: { name: 'X', date: '2031-06-01', discipline: 'running' },
      today: '2031-02-01', long_run_weekday: 'someday', easy_every: 1, taper_weeks: 9, save: true, extra: 1 });
    expect(bad.status).toBe(400);
    expect(bad.body.fields).toEqual(expect.arrayContaining(['race.distance_m', 'long_run_weekday', 'easy_every',
      'taper_weeks', 'expected_version', 'extra']));

    expect((await f.call('POST', 'plan/program/build', { race: { ...event, date: '2031-01-01' }, today: '2031-02-01',
      long_run_weekday: 'sun' })).body).toEqual({ error: 'event_in_past' });
    expect((await f.call('POST', 'plan/program/build', { race: event, today: '2031-02-01', long_run_weekday: 'sat' })).body)
      .toEqual({ error: 'no_long_run' });
  });

  it('suggests a workout day, aims at a goal time and lets the member turn the workout off', async () => {
    const f = await setup();
    const tempo = (await f.call('POST', 'workouts', { name: 'Tempo' })).body.id as string;
    const tempoSlot = (await f.call('POST', `workouts/${tempo}/exercises`, { exercise: 'ex_outdoor_run',
      target_sets: 1, target_reps: 1, run_steps: [{ kind: 'work', duration_s: 1500 }] })).body;
    expect((await f.call('PUT', 'plan/schedule', { week: { mon: f.kb, wed: tempo, sun: f.long },
      expected_version: (await f.version()).version })).status).toBe(200);
    const goalRace = { ...event, goal_time_s: 12_600 };
    const preview = await f.call('POST', 'plan/program/build', { race: goalRace, today: '2031-02-01', long_run_weekday: 'sun' });
    expect(preview.status).toBe(200);
    expect(preview.body.preview.rules).toMatchObject({ workout_weekday: 'wed', style: 'goal', goal_pace_s_per_km: 299 });
    expect(preview.body.preview.weeks[0].workout).toEqual({ type: 'strides', reps: 6, work_s: 20 });

    const saved = await f.call('POST', 'plan/program/build', { race: goalRace, today: '2031-02-01', long_run_weekday: 'sun',
      save: true, expected_version: preview.body.preview.plan_version });
    expect(saved.status).toBe(200);
    const meta = parsePlanMeta((await f.version()).meta);
    expect(meta.race?.goal_time_s).toBe(12_600);
    const peak = JSON.parse(meta.program!.weeks[13]!.targets![tempoSlot.id]!.run_steps!);
    expect(peak[1]).toMatchObject({ repeat: 2, steps: [{ kind: 'work', duration_s: 1200 }, { kind: 'recovery' }] });

    const none = await f.call('POST', 'plan/program/build', { race: goalRace, today: '2031-02-01', long_run_weekday: 'sun',
      workout_weekday: null });
    expect(none.body.preview.rules.workout_weekday).toBeNull();
    expect(none.body.preview.weeks.every((w: { workout: unknown }) => w.workout === null)).toBe(true);
    expect((await f.call('POST', 'plan/program/build', { race: goalRace, today: '2031-02-01', long_run_weekday: 'sun',
      workout_weekday: 'mon' })).body).toEqual({ error: 'no_workout_run' });
    expect((await f.call('POST', 'plan/program/build', { race: goalRace, today: '2031-02-01', long_run_weekday: 'sun',
      workout_weekday: 'someday' })).body.fields).toEqual(['workout_weekday']);
  });
});

describe('build_program for the coach', () => {
  async function mcp(name: string, args: unknown) {
    const response = await SELF.fetch(`${BASE}/mcp`, { method: 'POST',
      headers: { 'content-type': 'application/json', Authorization: 'Bearer test-mcp-token' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }) });
    const text = (await response.json<any>()).result.content[0].text as string;
    return name === 'get_coach_brief' ? JSON.parse(text).brief as string : JSON.parse(text);
  }

  it('previews without Garmin or WHOOP runs, saves with an audit and a note, and the brief shows the week', async () => {
    const f = await setup();
    for (const [id, source, meters] of [['g', 'garmin', 20_000], ['w', 'whoop', 18_000], ['i', 'intervals', 9_000]] as const) {
      await env.DB.prepare(`INSERT INTO external_activities (id,user_id,source,external_id,date,kind,distance_m,synced_at)
        VALUES (?1,?2,?3,?4,'2031-01-25','run',?5,1)`).bind(`${source}:activity:${f.owner}:${id}`, f.owner, source, id, meters).run();
    }
    const preview = await mcp('build_program', { race: event, long_run_weekday: 'sun', today: '2031-02-01' });
    expect(preview.preview.rules).toMatchObject({ long_run_now_m: 9000, longest_recent_m: 9000, workout_weekday: null });
    expect((await f.version()).version).toBe(preview.preview.plan_version);
    expect(await mcp('build_program', { race: event, long_run_weekday: 'sun', today: '2031-02-01', save: true }))
      .toEqual({ error: 'invalid_fields', fields: ['expected_version'] });

    const today = await todayForUser(env.DB, f.owner);
    const race = { ...event, date: addDays(today, 8 * 7) };
    const saved = await mcp('build_program', { race, long_run_weekday: 'sun', start: mondayOf(today), save: true,
      expected_version: preview.preview.plan_version });
    expect(saved).toMatchObject({ ok: true, version: preview.preview.plan_version + 1 });
    const audit = await env.DB.prepare("SELECT actor FROM audit_log WHERE tool='build_program' ORDER BY created_at DESC LIMIT 1")
      .first<{ actor: string }>();
    expect(audit?.actor).toBe('mcp');
    const note = await env.DB.prepare("SELECT body FROM notes ORDER BY created_at DESC LIMIT 1").first<{ body: string }>();
    expect(note?.body).toMatch(/Spring Marathon block/);
    // The brief says which week of the block today is.
    const brief = await mcp('get_coach_brief', {});
    const state = JSON.parse(brief.slice(brief.indexOf('{'), brief.lastIndexOf('}') + 1));
    expect(state.active_plan.program_week).toMatchObject({ week: 1, of: 9, name: 'Spring Marathon', label: 'Base' });
  });
});

describe('POST /api/plan/program/build without an event', () => {
  it('previews and saves a block with no event, leaving the saved event alone', async () => {
    const f = await setup();
    const preview = await f.call('POST', 'plan/program/build', { open: { weeks: 8 }, today: '2031-02-01', long_run_weekday: 'sun' });
    expect(preview.status).toBe(200);
    expect(preview.body.preview.weeks).toHaveLength(8);
    expect(preview.body.preview.rules).toMatchObject({ long_run_now_m: 5000, peak_m: 16_093 });
    expect(preview.body.preview.weeks.at(-1).phase).toBe('easy');
    const saved = await f.call('POST', 'plan/program/build', { open: { weeks: 8 }, today: '2031-02-01', long_run_weekday: 'sun',
      save: true, expected_version: preview.body.preview.plan_version });
    expect(saved.status).toBe(200);
    expect(saved.body.race).toBeNull();
    const meta = parsePlanMeta((await f.version()).meta);
    expect(meta.program).toMatchObject({ name: 'Keep building', start: '2031-02-03' });
    expect(meta.race).toBeUndefined();

    const bad = await f.call('POST', 'plan/program/build', { open: { weeks: 2 }, race: event, today: '2031-02-01',
      long_run_weekday: 'sun' });
    expect(bad.status).toBe(400);
    expect(bad.body.fields).toEqual(expect.arrayContaining(['open', 'race']));
  });
});
