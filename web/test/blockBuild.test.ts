import { describe, expect, it } from 'vitest';
import {
  applyingBuild, buildLabel, buildOptions, defaultBuild, detectedBuild, EASY_LABEL, labelingEasyWeeks, usableBuild, weeksToEvent,
  type BuildRule,
} from '../src/blockBuild';
import { weekHeadline } from '../src/blockLayers';
import type { ProgramBody } from '../src/blocks';
import type { Slot, Workout } from '../src/model';

function slot(overrides: Partial<Slot>): Slot {
  return {
    id: 's1', workout_id: 'w1', exercise_id: 'ex_squat', order_index: 0,
    target_sets: 3, target_reps: 8, target_reps_max: null, target_rpe: null,
    rest_seconds: 120, target_weight: 53, target_weight_unit: 'lb', target_duration_s: null,
    progression: null, run_steps: null, cues: null, is_warmup: 0, created_at: 0, updated_at: 0,
    exercise_name: 'Kettlebell Swing', exercise_unit: 'lb', exercise_muscle: 'legs', exercise_modality: 'kettlebell',
    exercise_laterality: 'bilateral', exercise_load_mode: 'total', exercise_demo_slug: null,
    ...overrides,
  };
}
function workout(id: string, name: string, exercises: Slot[] = []): Workout {
  return { id, plan_id: 'p1', name, day_label: null, order_index: 0, notes: null, created_at: 0, updated_at: 0, archived_at: null, exercises };
}
const run = (id: string, steps: unknown) => slot({
  id, exercise_id: 'ex_outdoor_run', exercise_name: 'Outdoor Run', exercise_modality: 'cardio',
  target_sets: 1, target_reps: 1, target_weight: null, run_steps: JSON.stringify(steps),
});
const MILE = 1609.344;
const lift = workout('lift', 'KB Strength A', [slot({ id: 'swing' }), slot({ id: 'deadlift', order_index: 1, target_weight: 70 })]);
const intervals = workout('intervals', 'Run Intervals', [run('int', [
  { kind: 'warmup', duration_s: 600 }, { repeat: 4, steps: [{ kind: 'work', distance_m: 800 }, { kind: 'recovery', duration_s: 120 }] }, { kind: 'cooldown', duration_s: 600 },
])]);
const tempo = workout('tempo', 'Tempo Run', [run('tempo-slot', [{ kind: 'warmup', duration_s: 600 }, { kind: 'work', duration_s: 1200 }, { kind: 'cooldown', duration_s: 300 }])]);
const long = workout('long', 'Easy Longer Run', [run('long-slot', [{ kind: 'work', distance_m: Math.round(6 * MILE * 10) / 10 }])]);
const soccer = workout('soccer', 'Soccer');
const none = { mon: null, tue: null, wed: null, thu: null, fri: null, sat: null, sun: null };
const block = (weeks: number): ProgramBody => ({
  start: '2026-11-16', repeat: false, workout_ids: ['lift', 'intervals', 'tempo', 'long'],
  weeks: Array.from({ length: weeks }, () => ({ week: { ...none, tue: 'lift', wed: 'intervals', fri: 'tempo', sun: 'long' } })),
});
const headlines = (program: ProgramBody, entry: Workout) => program.weeks.map((_, index) => weekHeadline(entry, program, index, true));
const add = (target: Extract<BuildRule, { kind: 'add' }>['target'], amount: number): BuildRule => ({ kind: 'add', target, amount });

describe('how a block workout builds', () => {
  it('offers what each kind of workout can add, the likeliest first', () => {
    expect(buildOptions(lift, true).map((option) => option.target)).toEqual(['reps', 'load', 'sets']);
    expect(buildOptions(intervals, true).map((option) => option.target)).toEqual(['repeats']);
    expect(buildOptions(tempo, true)).toMatchObject([{ target: 'run_time', amount: 120 }]);
    expect(buildOptions(long, true)).toMatchObject([{ target: 'run_distance', unit: 'mi', amount: MILE / 2 }]);
    expect(buildOptions(long, false)).toMatchObject([{ target: 'run_distance', unit: 'km', amount: 500 }]);
    expect(buildOptions(soccer, true)).toEqual([]);
    expect(defaultBuild(lift, true)).toEqual(add('reps', 1));
    expect(defaultBuild(soccer, true)).toEqual({ kind: 'same' });
    expect(buildLabel(add('reps', 2), buildOptions(lift, true))).toBe('+ 2 reps a week');
    expect(buildLabel(add('run_time', 120), buildOptions(tempo, true))).toBe('+ 2 min a week');
  });

  it('falls back to the same every week when a rule no longer fits the workout', () => {
    expect(usableBuild(lift, add('run_time', 120), true)).toEqual({ kind: 'same' });
    expect(usableBuild(lift, add('reps', 0), true)).toEqual({ kind: 'same' });
    expect(usableBuild(lift, { kind: 'manual' }, true)).toEqual({ kind: 'manual' });
    expect(usableBuild(tempo, undefined, true)).toEqual(add('run_time', 120));
  });

  it('fills every week from the first, with every 4th week easier', () => {
    const options = { easyEvery: 4 as const, miles: true };
    let program = applyingBuild(block(6), lift, add('reps', 1), options);
    program = applyingBuild(program, intervals, add('repeats', 1), options);
    program = applyingBuild(program, tempo, add('run_time', 120), options);
    program = applyingBuild(program, long, add('run_distance', MILE / 2), options);
    expect(headlines(program, lift)).toEqual(['3 × 8 @ 53 lb', '3 × 9 @ 53 lb', '3 × 10 @ 53 lb', '3 × 8 @ 53 lb', '3 × 11 @ 53 lb', '3 × 12 @ 53 lb']);
    expect(headlines(program, intervals)).toEqual(['4 × 800 m', '5 × 800 m', '6 × 800 m', '5 × 800 m', '7 × 800 m', '8 × 800 m']);
    expect(headlines(program, tempo)).toEqual(['20 min', '22 min', '24 min', '19 min', '26 min', '28 min']);
    expect(headlines(program, long)).toEqual(['6 mi', '6.5 mi', '7 mi', '5.5 mi', '7.5 mi', '8 mi']);
    // Every exercise of the lift grows, and the first week keeps the workout's own targets.
    expect(program.weeks[0]!.targets).toBeUndefined();
    expect(program.weeks[1]!.targets).toMatchObject({ swing: { target_reps: 9 }, deadlift: { target_reps: 9 } });
    // The run keeps its warm-up and cool-down around the part that grows.
    const steps = program.weeks[2]!.targets!['tempo-slot']!.run_steps!;
    expect(typeof steps === 'string' ? JSON.parse(steps) : steps).toEqual([{ kind: 'warmup', duration_s: 600 }, { kind: 'work', duration_s: 1440 }, { kind: 'cooldown', duration_s: 300 }]);
  });

  it('reads each rule back from the weeks it wrote', () => {
    const options = { easyEvery: 4 as const, miles: true };
    const rules: Array<[Workout, BuildRule]> = [
      [lift, add('reps', 1)], [intervals, add('repeats', 1)], [tempo, add('run_time', 120)], [long, add('run_distance', MILE / 2)],
    ];
    let program = block(6);
    for (const [entry, rule] of rules) program = applyingBuild(program, entry, rule, options);
    for (const [entry, rule] of rules) {
      const detected = detectedBuild(program, entry, true);
      expect(detected.easyEvery).toBe(4);
      expect(detected.rule.kind).toBe('add');
      if (detected.rule.kind === 'add' && rule.kind === 'add') {
        expect(detected.rule.target).toBe(rule.target);
        expect(detected.rule.amount).toBeCloseTo(rule.amount, 6);
      }
    }
    expect(detectedBuild(block(6), lift, true).rule).toEqual({ kind: 'same' });
    // A block too short for an easier week reads as having none.
    expect(detectedBuild(applyingBuild(block(3), lift, add('load', 5), { easyEvery: 4, miles: true }), lift, true))
      .toMatchObject({ rule: add('load', 5), easyEvery: null });
  });

  it('calls weeks set by hand the member’s own', () => {
    const byHand = applyingBuild(block(6), lift, add('reps', 1), { easyEvery: null, miles: true });
    byHand.weeks[4] = { ...byHand.weeks[4]!, targets: { ...byHand.weeks[4]!.targets, swing: { target_reps: 20 } } };
    expect(detectedBuild(byHand, lift, true).rule).toEqual({ kind: 'manual' });
  });

  it('changes a running block from this week on and leaves earlier weeks alone', () => {
    const started = applyingBuild(block(6), lift, add('reps', 1), { easyEvery: null, miles: true });
    const changed = applyingBuild(started, lift, add('reps', 2), { easyEvery: null, from: 2, miles: true });
    expect(headlines(changed, lift)).toEqual(['3 × 8 @ 53 lb', '3 × 9 @ 53 lb', '3 × 10 @ 53 lb', '3 × 12 @ 53 lb', '3 × 14 @ 53 lb', '3 × 16 @ 53 lb']);
    expect(detectedBuild(changed, lift, true, 2)).toMatchObject({ rule: add('reps', 2), from: 2 });
    const flat = applyingBuild(started, lift, { kind: 'same' }, { easyEvery: null, from: 2, miles: true });
    expect(headlines(flat, lift).slice(2)).toEqual(Array(4).fill('3 × 10 @ 53 lb'));
    expect(applyingBuild(started, lift, { kind: 'manual' }, { easyEvery: 4, miles: true })).toBe(started);
  });

  it('labels the easier weeks and never replaces a week’s own label', () => {
    const named = block(8);
    named.weeks[3] = { ...named.weeks[3]!, label: 'Race prep' };
    const labeled = labelingEasyWeeks(named, 4);
    expect(labeled.weeks.map((week) => week.label ?? null)).toEqual([null, null, null, 'Race prep', null, null, null, EASY_LABEL]);
    expect(labelingEasyWeeks(labeled, null).weeks.map((week) => week.label ?? null)).toEqual([null, null, null, 'Race prep', null, null, null, null]);
  });

  it('counts the weeks to an event so its week is the last', () => {
    expect(weeksToEvent('2026-11-16', '2026-11-18')).toBe(1);
    expect(weeksToEvent('2026-11-16', '2026-12-26')).toBe(6);
    expect(weeksToEvent('2026-11-16', '2026-12-28')).toBe(7);
    expect(weeksToEvent('2026-11-16', '2026-11-15')).toBeNull();
    expect(weeksToEvent('2026-11-16', '2028-01-01')).toBeNull();
    expect(weeksToEvent('2026-11-16', '')).toBeNull();
  });

  it('stops adding repeats where the run has no room for more steps', () => {
    // 18 repeats of ten steps with a warm-up and cool-down: 182 of 200 steps.
    const steps = Array.from({ length: 10 }, (_, index) => ({ kind: index % 2 ? 'recovery' : 'work', duration_s: 60 }));
    const big = workout('big', 'Long intervals', [run('big-slot', [{ kind: 'warmup', duration_s: 600 }, { repeat: 18, steps }, { kind: 'cooldown', duration_s: 600 }])]);
    const program = applyingBuild({ ...block(4), workout_ids: ['big'] }, big, add('repeats', 1), { easyEvery: null, miles: true });
    const repeats = program.weeks.map((week) => {
      const raw = week.targets?.['big-slot']?.run_steps;
      const items = raw ? JSON.parse(raw as string) as Array<{ repeat?: number }> : null;
      return items ? items[1]!.repeat : 18;
    });
    // 19 repeats is 192 steps; 20 would be 202, over what a run can hold.
    expect(repeats).toEqual([18, 19, 19, 19]);
  });

  it('keeps assistance when a bodyweight load builds', () => {
    // 40 lb of assistance is a load of -40: less of it each week, more in an easier week.
    const pull = workout('pull', 'Pull-ups', [slot({ id: 'pull-slot', exercise_id: 'ex_pullup', exercise_name: 'Pull-Up', exercise_modality: 'bw', target_weight: -40 })]);
    const program = applyingBuild({ ...block(6), workout_ids: ['pull'] }, pull, add('load', 5), { easyEvery: 4, miles: true });
    expect(program.weeks.map((week) => week.targets?.['pull-slot']?.target_weight ?? -40)).toEqual([-40, -35, -30, -35, -25, -20]);
    expect(detectedBuild(program, pull, true)).toMatchObject({ rule: add('load', 5), easyEvery: 4 });
    // Past bodyweight it becomes added load.
    const far = applyingBuild({ ...block(4), workout_ids: ['pull'] }, { ...pull, exercises: [{ ...pull.exercises[0]!, target_weight: -5 }] }, add('load', 5), { easyEvery: null, miles: true });
    expect(far.weeks.map((week) => week.targets?.['pull-slot']?.target_weight ?? -5)).toEqual([-5, 0, 5, 10]);
  });

  it('adds the same weight to exercises in pounds and in kilograms', () => {
    const mixed = workout('mixed', 'Mixed units', [
      slot({ id: 'press', target_weight: 100 }),
      slot({ id: 'squat', order_index: 1, target_weight: 50, target_weight_unit: 'kg' }),
    ]);
    expect(buildOptions(mixed, true).find((option) => option.target === 'load')).toMatchObject({ unit: 'lb', amount: 5 });
    const program = applyingBuild({ ...block(4), workout_ids: ['mixed'] }, mixed, add('load', 5), { easyEvery: null, miles: true });
    const loads = (id: string, own: number) => program.weeks.map((week) => week.targets?.[id]?.target_weight ?? own);
    expect(loads('press', 100)).toEqual([100, 105, 110, 115]);
    // 5 lb is about 2.3 kg, on the 2.5 kg steps a kilogram load moves in: never 5 kg a week.
    expect(loads('squat', 50)).toEqual([50, 52.5, 55, 57.5]);
    expect(program.weeks.every((week) => week.targets?.squat?.target_weight_unit === undefined)).toBe(true);
    expect(detectedBuild(program, mixed, true)).toMatchObject({ rule: add('load', 5) });
  });
});
