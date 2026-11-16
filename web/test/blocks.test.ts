import { describe, expect, it } from 'vitest';
import type { WeeklySchedule } from '../../src/types';
import {
  addingWeek,
  applyingRamp,
  copyingDown,
  editableFields,
  newBlock,
  parseSeconds,
  programBody,
  rampValues,
  relabeling,
  removingLastWeek,
  roundFor,
  settingTarget,
  shortDate,
  startChoices,
  weekChanges,
  weekValue,
  workoutsInBlock,
  type ProgramBody,
} from '../src/blocks';
import type { Slot, Workout } from '../src/model';

function slot(overrides: Partial<Slot>): Slot {
  return {
    id: 's1', workout_id: 'w1', exercise_id: 'ex_squat', order_index: 0,
    target_sets: 3, target_reps: 5, target_reps_max: null, target_rpe: null,
    rest_seconds: 120, target_weight: 225, target_weight_unit: 'lb', target_duration_s: null,
    progression: null, run_steps: null, cues: null, is_warmup: 0, created_at: 0, updated_at: 0,
    exercise_name: 'Back Squat', exercise_unit: 'lb', exercise_muscle: 'legs', exercise_modality: 'barbell',
    exercise_laterality: 'bilateral', exercise_load_mode: 'total', exercise_demo_slug: null,
    ...overrides,
  };
}

function workout(id: string, name: string, exercises: Slot[] = [], archived = false): Workout {
  return { id, plan_id: 'p1', name, day_label: null, order_index: 0, notes: null, created_at: 0, updated_at: 0,
    archived_at: archived ? 1 : null, exercises };
}

const squat = slot({ id: 'squat' });
const swim = slot({ id: 'swim', workout_id: 'sw', exercise_id: 'ex_swim', exercise_name: 'Swim', exercise_modality: 'cardio',
  target_sets: 1, target_reps: 1, target_weight: null, target_duration_s: 1800 });
const lift = workout('lift', 'Lift A', [squat]);
const swimming = workout('sw', 'Pool swim', [swim]);
const run = workout('run', 'Easy run');
const yoga = workout('yoga', 'Yoga');
const old = workout('old', 'Old plan', [], true);
const all = [lift, swimming, run, yoga, old];

const schedule: WeeklySchedule = {
  version: 1,
  week: { mon: 'lift', tue: 'sw', wed: 'run', thu: 'old', fri: null, sat: 'run', sun: null },
  extras: { mon: ['yoga', 'old'], wed: ['sw'] },
};

const block = (): ProgramBody => newBlock(schedule, all, { start: '2026-11-16', weeks: 4, repeat: false, name: ' Spring ' });

describe('a new block', () => {
  it('copies the weekly routine, any mix of workouts, without archived ones', () => {
    const program = block();
    expect(program.name).toBe('Spring');
    expect(program.weeks).toHaveLength(4);
    expect(program.weeks[0]!.week).toEqual({ mon: 'lift', tue: 'sw', wed: 'run', thu: null, fri: null, sat: 'run', sun: null });
    expect(program.weeks[0]!.extras).toEqual({ mon: ['yoga'], wed: ['sw'] });
    // Weeks are copies, not one shared object.
    expect(program.weeks[0]).not.toBe(program.weeks[1]);
  });

  it('keeps 1 to 52 weeks and starts on a Monday', () => {
    expect(newBlock(schedule, all, { start: '2026-11-16', weeks: 0, repeat: true }).weeks).toHaveLength(1);
    expect(newBlock(schedule, all, { start: '2026-11-16', weeks: 80, repeat: true }).weeks).toHaveLength(52);
    expect(startChoices('2026-11-12', 3)).toEqual(['2026-11-09', '2026-11-16', '2026-11-23']);
    expect(startChoices('2026-11-16', 1)).toEqual(['2026-11-16']);
    expect(shortDate('2026-11-16')).toBe('Mon, Nov 16');
  });

  it('sends the body the API takes: no id, no empty extras, targets or labels', () => {
    const program = relabeling(newBlock({ version: 1, week: { mon: 'lift', tue: null, wed: null, thu: null, fri: null, sat: null, sun: null } },
      all, { start: '2026-11-16', weeks: 1, repeat: false }), 0, '  ');
    expect(programBody({ ...program, id: 'x' } as never)).toEqual({
      start: '2026-11-16', repeat: false,
      weeks: [{ week: { mon: 'lift', tue: null, wed: null, thu: null, fri: null, sat: null, sun: null } }],
    });
  });
});

describe('changing days and weeks', () => {
  it('copies a week down to the next or every later week, keeping their labels', () => {
    let program = relabeling(block(), 2, 'Easy');
    program = { ...program, weeks: program.weeks.map((w, i) => i === 0 ? { ...w, week: { ...w.week, sun: 'yoga' } } : w) };
    const next = copyingDown(program, 0, 'next');
    expect(next.weeks[1]!.week.sun).toBe('yoga');
    expect(next.weeks[2]!.week.sun).toBeNull();
    const later = copyingDown(program, 0, 'all');
    expect(later.weeks.map((w) => w.week.sun)).toEqual(['yoga', 'yoga', 'yoga', 'yoga']);
    expect(later.weeks[2]!.label).toBe('Easy');
  });

  it('adds a copy of the last week and removes the last week, within limits', () => {
    const program = relabeling(block(), 3, 'Test');
    const added = addingWeek(program)!;
    expect(added.weeks).toHaveLength(5);
    expect(added.weeks[4]!.label).toBeUndefined();
    expect(added.weeks[4]!.week).toEqual(program.weeks[3]!.week);
    expect(removingLastWeek(program)!.weeks).toHaveLength(3);
    expect(removingLastWeek({ ...program, weeks: [program.weeks[0]!] })).toBeNull();
    expect(addingWeek({ ...program, weeks: Array.from({ length: 52 }, () => program.weeks[0]!) })).toBeNull();
  });

  it('lists the workouts the block uses', () => {
    expect(workoutsInBlock(block(), all).map((w) => w.id)).toEqual(['lift', 'sw', 'run', 'yoga']);
  });
});

describe('targets by week', () => {
  it('offers sets, reps and load for a lift, sets and time for a swim, nothing for a run with steps', () => {
    expect(editableFields(squat)).toEqual(['target_sets', 'target_reps', 'target_weight']);
    expect(editableFields(swim)).toEqual(['target_sets', 'target_duration_s']);
    expect(editableFields(slot({ exercise_id: 'ex_outdoor_run', exercise_modality: 'cardio', run_steps: '[]' }))).toEqual([]);
    expect(editableFields(slot({ exercise_modality: 'timed', target_reps: 45 }))).toEqual(['target_sets', 'target_duration_s', 'target_weight']);
  });

  it('sets a week’s own value, and the slot’s own value clears it', () => {
    let program = settingTarget(block(), 1, lift, squat, 'target_weight', 235);
    expect(program.weeks[1]!.targets).toEqual({ squat: { target_weight: 235 } });
    expect(weekValue(program, 1, squat, 'target_weight')).toBe(235);
    expect(weekValue(program, 0, squat, 'target_weight')).toBe(225);
    program = settingTarget(program, 1, lift, squat, 'target_weight', 225);
    expect(program.weeks[1]!.targets).toBeUndefined();
  });

  it('reads a week’s load saved in the other unit in the slot’s unit, and saves edits in the slot’s unit', () => {
    let program = { ...block(), weeks: block().weeks.map((w, i) => i === 1 ? { ...w, targets: { squat: { target_weight: 100, target_weight_unit: 'kg' as const } } } : w) };
    expect(weekValue(program, 1, squat, 'target_weight')).toBe(220.5);
    expect(weekChanges(program, 1, squat, 'target_weight')).toBe(true);
    program = settingTarget(program, 1, lift, squat, 'target_weight', 230);
    expect(program.weeks[1]!.targets).toEqual({ squat: { target_weight: 230 } });
    program = settingTarget({ ...program, weeks: program.weeks.map((w, i) => i === 1 ? { ...w, targets: { squat: { target_weight: 100, target_weight_unit: 'kg' as const } } } : w) },
      1, lift, squat, 'target_weight', 225);
    expect(program.weeks[1]!.targets).toBeUndefined();
  });

  it('reads an older hold kept in reps as the week’s time, and a time replaces it', () => {
    const plank = slot({ id: 'pl', exercise_modality: 'timed', target_reps: 45, target_duration_s: null, target_weight: null });
    const core = workout('core', 'Core', [plank]);
    let program = { ...block(), weeks: block().weeks.map((w, i) => i === 0 ? { ...w, targets: { pl: { target_reps: 60 } } } : w) };
    expect(weekValue(program, 0, plank, 'target_duration_s')).toBe(60);
    expect(weekChanges(program, 0, plank, 'target_duration_s')).toBe(true);
    expect(weekValue(program, 1, plank, 'target_duration_s')).toBe(45);
    program = settingTarget(program, 0, core, plank, 'target_duration_s', 45);
    expect(program.weeks[0]!.targets).toBeUndefined();
    program = settingTarget(program, 0, core, plank, 'target_duration_s', 75);
    expect(program.weeks[0]!.targets).toEqual({ pl: { target_duration_s: 75 } });
  });

  it('drops a rep range a higher rep count would turn upside down, and brings it back', () => {
    const ranged = slot({ id: 'r', target_reps: 8, target_reps_max: 10 });
    const w = workout('lift', 'Lift A', [ranged]);
    let program = settingTarget(block(), 0, w, ranged, 'target_reps', 12);
    expect(program.weeks[0]!.targets).toEqual({ r: { target_reps: 12, target_reps_max: null } });
    program = settingTarget(program, 0, w, ranged, 'target_reps', null);
    expect(program.weeks[0]!.targets).toBeUndefined();
  });

  it('changes sets for every exercise of a superset together', () => {
    const a = slot({ id: 'a', group_id: 'g' });
    const b = slot({ id: 'b', group_id: 'g' });
    const c = slot({ id: 'c' });
    const w = workout('lift', 'Lift A', [a, b, c]);
    let program = settingTarget(block(), 0, w, a, 'target_sets', 4);
    expect(program.weeks[0]!.targets).toEqual({ a: { target_sets: 4 }, b: { target_sets: 4 } });
    program = settingTarget(program, 0, w, b, 'target_sets', 3);
    expect(program.weeks[0]!.targets).toBeUndefined();
  });
});

describe('the ramp', () => {
  it('grows by a percent, with every 4th week easier and no growth counted for it', () => {
    const values = rampValues({ fromWeek: 1, start: 1800, step: { kind: 'percent', value: 10 }, easyEvery: 4, easyPercent: 80, ceiling: null },
      8, (v) => roundFor('target_duration_s', v));
    // 30:00, 33:00, 36:15, 29:00 (80% of 36:18), 40:00, 44:00, 48:15, 38:45
    expect(values).toEqual([1800, 1980, 2175, 1740, 2400, 2640, 2895, 2325]);
  });

  it('grows by an amount up to a ceiling', () => {
    expect(rampValues({ fromWeek: 2, start: 100, step: { kind: 'amount', value: 10 }, easyEvery: null, easyPercent: 80, ceiling: 125 },
      6, (v) => roundFor('target_weight', v))).toEqual([100, 110, 120, 125, 125]);
  });

  it('never rounds a week past the ceiling', () => {
    expect(rampValues({ fromWeek: 1, start: 100, step: { kind: 'amount', value: 10 }, easyEvery: null, easyPercent: 80, ceiling: 108 },
      3, (v) => roundFor('target_weight', v, 'lb', 100))).toEqual([100, 108, 108]);
  });

  it('rounds to what the field takes', () => {
    expect(roundFor('target_reps', 0.2)).toBe(1);
    expect(roundFor('target_weight', 47)).toBe(45);
    expect(roundFor('target_weight', 47, 'kg')).toBe(47.5);
    expect(roundFor('target_weight', 7.4)).toBe(7);
    expect(roundFor('target_duration_s', 52)).toBe(50);
    expect(roundFor('target_duration_s', 1806)).toBe(1800);
    // Steps count from the ramp's start: a 53 lb kettlebell stays 53.
    expect(roundFor('target_weight', 53, 'lb', 53)).toBe(53);
    expect(roundFor('target_weight', 55, 'lb', 53)).toBe(53);
    expect(roundFor('target_weight', 56, 'lb', 53)).toBe(58);
  });

  it('writes a ramp into the weeks it reaches and leaves the slot’s own value implicit', () => {
    const program = applyingRamp(block(), swimming, swim, 'target_duration_s',
      { fromWeek: 1, start: 1800, step: { kind: 'amount', value: 300 }, easyEvery: 4, easyPercent: 50, ceiling: null });
    expect(program.weeks.map((w) => w.targets?.swim?.target_duration_s)).toEqual([undefined, 2100, 2400, 1200]);
  });
});

describe('typed times', () => {
  it('reads minutes, m:ss, h:mm:ss and seconds', () => {
    expect(parseSeconds('45')).toBe(2700);
    expect(parseSeconds('1:30')).toBe(90);
    expect(parseSeconds('1:05:00')).toBe(3900);
    expect(parseSeconds('90s')).toBe(90);
    expect(parseSeconds('abc')).toBeNull();
    expect(parseSeconds('0')).toBeNull();
  });
});
