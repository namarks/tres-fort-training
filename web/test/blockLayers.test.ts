import { describe, expect, it } from 'vitest';
import { layerProgram } from '../../src/programLayers';
import type { TrainingProgram, WeeklySchedule } from '../../src/types';
import {
  addingToBlock,
  besideBlock,
  blockDays,
  blockWorkouts,
  dayFull,
  fullDays,
  daysLabel,
  hasWeekTargets,
  headlineName,
  MAX_DAY_WORKOUTS,
  newBlockDay,
  newLayeredBlock,
  ownForm,
  placingOn,
  removingFromBlock,
  sortingBlock,
  suggestedBlockWorkouts,
  suggestedSorting,
  trimmedSchedule,
  weekHeadline,
  wholeDays,
} from '../src/blockLayers';
import type { ProgramBody } from '../src/blocks';
import type { Slot, Workout } from '../src/model';

function slot(overrides: Partial<Slot>): Slot {
  return {
    id: 's1', workout_id: 'w1', exercise_id: 'ex_squat', order_index: 0,
    target_sets: 3, target_reps: 5, target_reps_max: null, target_rpe: null,
    rest_seconds: 120, target_weight: null, target_weight_unit: 'lb', target_duration_s: null,
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
const none = { mon: null, tue: null, wed: null, thu: null, fri: null, sat: null, sun: null };
const squat = slot({ id: 'squat', workout_id: 'lift' });
const press = slot({ id: 'press', workout_id: 'lift', exercise_name: 'Press', order_index: 1 });
const lift = workout('lift', 'Strength A', [squat, press]);
const tempo = workout('tempo', 'Tempo run', [slot({ id: 'tempo-slot', workout_id: 'tempo', exercise_name: 'Run', target_sets: 1, target_reps: 1, target_duration_s: 1200 })]);
const core = workout('core', 'Core', [slot({ id: 'core-slot', workout_id: 'core', exercise_name: 'Plank' })]);
const soccer = workout('soccer', 'Soccer');
const all = [lift, tempo, core, soccer];
// Soccer on Mondays and core every night, with the lift and the run on their days.
const usual: WeeklySchedule = {
  version: 1,
  week: { ...none, mon: 'soccer', tue: 'lift', wed: 'core', thu: 'core', fri: 'tempo', sat: 'core', sun: 'core' },
  extras: { mon: ['core'], tue: ['core'], fri: ['core'] },
  times: { mon: { soccer: '19:00' }, tue: { lift: '06:30', core: '21:00' } },
};

describe('a block beside the repeating week', () => {
  it('suggests each day’s main workout that has exercises, and starts the block with only those', () => {
    // Core is some days' only workout, but it sits beside others too, so it stays every week.
    expect(suggestedBlockWorkouts(usual, all)).toEqual(['lift', 'tempo']);
    const block = newLayeredBlock(usual, all, { start: '2026-11-16', weeks: 3, repeat: false, name: ' Fast 3 mile ',
      picked: ['lift', 'tempo'], added: [{ id: 'core', day: 'sat' }, { id: 'gone', day: 'mon' }] });
    expect(block.name).toBe('Fast 3 mile');
    expect(block.weeks).toHaveLength(3);
    expect(block.weeks[0]).toEqual({ week: { ...none, tue: 'lift', fri: 'tempo', sat: 'core' } });
    expect(block.workout_ids).toEqual(['lift', 'tempo', 'core']);
    expect(block.weeks[0]).not.toBe(block.weeks[1]);
  });

  it('counts a new block’s workouts on a day, so a sixth is never offered', () => {
    const added = ['a', 'b', 'c', 'd'].map(id => ({ id, day: 'tue' as const }));
    // The ticked lift first, then the ones added for the block; core stays every week.
    expect(newBlockDay(usual, ['lift', 'tempo'], added, 'tue')).toEqual(['lift', 'a', 'b', 'c', 'd']);
    expect(newBlockDay(usual, ['lift', 'tempo'], added, 'tue')).toHaveLength(MAX_DAY_WORKOUTS);
    expect(newBlockDay(usual, ['lift', 'tempo'], [...added, { id: 'lift', day: 'tue' }], 'tue')).toHaveLength(5);
    expect(newBlockDay(usual, ['lift', 'tempo'], added, 'wed')).toEqual([]);
  });

  it('takes the block’s workouts out of the repeating week and keeps the rest', () => {
    expect(trimmedSchedule(usual, ['lift', 'tempo'])).toEqual({
      week: { ...none, mon: 'soccer', wed: 'core', thu: 'core', sat: 'core', sun: 'core' },
      extras: { mon: ['core'], tue: ['core'], fri: ['core'] },
    });
    // No times: the server keeps the saved ones still on their day.
    expect(trimmedSchedule(usual, ['lift', 'tempo'])).not.toHaveProperty('times');
    expect(trimmedSchedule(usual, ['nothing-here'])).toBeNull();
    expect(trimmedSchedule(usual, undefined)).toBeNull();
  });

  it('reads the stored whole days back as what the block owns, and lays the week over it again', () => {
    const own: ProgramBody = { start: '2026-11-16', repeat: false, workout_ids: ['lift', 'tempo'],
      weeks: [{ week: { ...none, tue: 'lift', fri: 'tempo' }, targets: { squat: { target_reps: 8 } } }] };
    const trimmed: WeeklySchedule = { ...usual, ...trimmedSchedule(usual, ['lift', 'tempo'])! };
    const stored = layerProgram({ ...own, id: 'b1' } as TrainingProgram, trimmed, trimmed);
    expect(stored.weeks[0]!.week).toEqual({ ...none, mon: 'soccer', tue: 'lift', wed: 'core', thu: 'core', fri: 'tempo', sat: 'core', sun: 'core' });
    expect(stored.weeks[0]!.extras).toEqual({ mon: ['core'], tue: ['core'], fri: ['core'] });
    expect(ownForm(stored, trimmed)).toEqual(own);
    expect(wholeDays(own, trimmed).weeks[0]!.week.mon).toBe('soccer');
    // A block that lists nothing owns its whole weeks.
    const legacy: ProgramBody = { start: '2026-11-16', repeat: false, weeks: [{ week: { ...none, mon: 'soccer' } }] };
    expect(ownForm(legacy, usual)).toEqual(legacy);
    expect(wholeDays(legacy, usual)).toBe(legacy);
  });

  it('lists what carries on beside the block with its days', () => {
    const own: ProgramBody = { start: '2026-11-16', repeat: false, workout_ids: ['lift', 'tempo'], weeks: [{ week: { ...none, tue: 'lift', fri: 'tempo' } }] };
    expect(besideBlock(own, usual, all).map(({ workout, days }) => [workout.id, daysLabel(days)])).toEqual([
      ['soccer', 'Mon'], ['core', 'Every day'],
    ]);
  });

  it('moves, adds and removes a block workout in every week without touching the others', () => {
    const start: ProgramBody = { start: '2026-11-16', repeat: false, workout_ids: ['lift', 'tempo'],
      weeks: [
        { week: { ...none, tue: 'lift', fri: 'tempo' }, targets: { squat: { reps: 8 }, 'tempo-slot': { target_duration_s: 1320 } } },
        { week: { ...none, tue: 'lift', fri: 'tempo' } },
      ] };
    const moved = placingOn(start, 'lift', ['mon', 'thu']);
    expect(moved.weeks.map((week) => week.week)).toEqual([
      { ...none, mon: 'lift', thu: 'lift', fri: 'tempo' }, { ...none, mon: 'lift', thu: 'lift', fri: 'tempo' },
    ]);
    expect(blockDays(moved, 'lift')).toEqual({ days: ['mon', 'thu'], varies: false });
    expect(moved.weeks[0]!.targets).toEqual(start.weeks[0]!.targets);

    const added = addingToBlock(start, 'core', ['fri']);
    expect(added.workout_ids).toEqual(['lift', 'tempo', 'core']);
    expect(added.weeks[0]).toMatchObject({ week: { fri: 'tempo' }, extras: { fri: ['core'] } });
    expect(blockWorkouts(added, all).map((item) => item.id)).toEqual(['lift', 'tempo', 'core']);

    const removed = removingFromBlock(added, lift);
    expect(removed.workout_ids).toEqual(['tempo', 'core']);
    expect(removed.weeks[0]!.week.tue).toBeNull();
    expect(removed.weeks[0]!.targets).toEqual({ 'tempo-slot': { target_duration_s: 1320 } });
    expect(blockWorkouts(removed, all).map((item) => item.id)).toEqual(['tempo', 'core']);

    const uneven: ProgramBody = { ...start, weeks: [start.weeks[0]!, { week: { ...none, wed: 'lift', fri: 'tempo' } }] };
    expect(blockDays(uneven, 'lift')).toEqual({ days: ['tue', 'wed'], varies: true });
  });

  it('knows when a day has no room for one more block workout', () => {
    const crowded: ProgramBody = { start: '2026-11-16', repeat: false, workout_ids: ['a', 'b', 'c', 'd', 'e'],
      weeks: [{ week: { ...none, mon: 'a' }, extras: { mon: ['b', 'c', 'd', 'e'] } }] };
    expect(dayFull(crowded, 'mon', 'lift')).toBe(true);
    expect(dayFull(crowded, 'mon', 'a')).toBe(false);
    expect(dayFull(crowded, 'tue', 'lift')).toBe(false);
    // Lift's days differ by week; one change puts it on all of them in every week, and week 1's Monday is full.
    const uneven: ProgramBody = { ...crowded, workout_ids: [...crowded.workout_ids!, 'lift'],
      weeks: [{ ...crowded.weeks[0]!, week: { ...crowded.weeks[0]!.week, tue: 'lift' } }, { week: { ...none, mon: 'lift' } }] };
    expect(fullDays(uneven, 'lift', ['mon', 'tue', 'wed'])).toEqual(['mon']);
    expect(fullDays(uneven, 'lift', ['tue', 'wed'])).toEqual([]);
  });

  it('sorts a block that listed nothing into its own workouts and what stays every week', () => {
    const legacy: ProgramBody = { start: '2026-11-16', repeat: false,
      weeks: [{ week: { ...none, mon: 'soccer', tue: 'lift', fri: 'tempo' }, extras: { mon: ['core'], tue: ['core'] }, targets: { squat: { target_reps: 8 } } }] };
    expect(suggestedSorting(legacy, usual, all)).toEqual(['lift']);
    const sorted = sortingBlock(legacy, ['lift', 'tempo'], all);
    expect(sorted.workout_ids).toEqual(['lift', 'tempo']);
    expect(sorted.weeks[0]).toEqual({ week: { ...none, tue: 'lift', fri: 'tempo' }, targets: { squat: { target_reps: 8 } } });
    // A workout left every week keeps none of the block's targets, which would still apply unseen.
    const withCore: ProgramBody = { ...legacy, weeks: legacy.weeks.map(week => ({ ...week, targets: { ...week.targets, 'core-slot': { target_sets: 5 } } })) };
    expect(sortingBlock(withCore, ['lift', 'tempo'], all).weeks[0]!.targets).toEqual({ squat: { target_reps: 8 } });
    expect(sortingBlock(withCore, ['tempo'], all).weeks[0]!.targets).toBeUndefined();
    // Nor a placement the old block gave it on a day the repeating week doesn't: it follows the repeating week.
    const apart: ProgramBody = { start: '2026-11-16', repeat: false, weeks: [{ week: { ...none, tue: 'lift', wed: 'soccer' }, extras: { thu: ['tempo', 'core'] } }] };
    expect(sortingBlock(apart, ['lift', 'tempo'], all).weeks[0]).toEqual({ week: { ...none, tue: 'lift', thu: 'tempo' } });
  });

  it('says what a workout asks for in each week', () => {
    const block: ProgramBody = { start: '2026-11-16', repeat: false, workout_ids: ['lift', 'tempo'],
      weeks: [{ week: { ...none, tue: 'lift', fri: 'tempo' } }, { week: { ...none, tue: 'lift', fri: 'tempo' }, targets: { press: { target_sets: 4, target_reps: 6 } } }] };
    // The exercise a week changes is the one the line reads.
    expect(headlineName(lift, block)).toBe('Press');
    expect(weekHeadline(lift, block, 0, true)).toBe('3 × 5');
    expect(weekHeadline(lift, block, 1, true)).toBe('4 × 6');
    expect(headlineName(tempo, block)).toBeNull();
    expect(weekHeadline(tempo, block, 0, true)).toBe('20 min');
    expect(weekHeadline(soccer, block, 0, true)).toBe('');
    const loaded = workout('kb', 'Swings', [slot({ id: 'kb-slot', target_reps: 8, target_reps_max: 10, target_weight: 52.5, target_weight_unit: 'kg', rest_seconds: 90 })]);
    expect(weekHeadline(loaded, block, 0, true)).toBe('3 × 8–10 @ 52.5 kg');
    const planks = workout('planks', 'Planks', [slot({ id: 'plank-slot', target_duration_s: 45 })]);
    expect(weekHeadline(planks, block, 0, true)).toBe('3 × 0:45');
  });

  it('reads a planned run as its repeats or the running it asks for', () => {
    const run = (id: string, steps: unknown) => workout(id, id, [slot({ id: `${id}-slot`, workout_id: id, exercise_id: 'ex_outdoor_run',
      exercise_name: 'Outdoor Run', exercise_modality: 'cardio', target_sets: 1, target_reps: 1, run_steps: JSON.stringify(steps) })]);
    const intervals = run('intervals', [{ kind: 'warmup', duration_s: 600 },
      { repeat: 5, steps: [{ kind: 'work', distance_m: 800 }, { kind: 'recovery', duration_s: 120 }] }, { kind: 'cooldown', duration_s: 600 }]);
    const tempoRun = run('tempo-run', [{ kind: 'warmup', duration_s: 600 }, { kind: 'work', duration_s: 1500 }, { kind: 'cooldown', duration_s: 300 }]);
    const long = run('long', [{ kind: 'work', distance_m: 10460.7 }]);
    const block: ProgramBody = { start: '2026-11-16', repeat: false, workout_ids: ['intervals', 'tempo-run', 'long'],
      weeks: [{ week: { ...none, wed: 'intervals', fri: 'tempo-run', sun: 'long' } },
        { week: { ...none, wed: 'intervals', fri: 'tempo-run', sun: 'long' },
          targets: { 'intervals-slot': { run_steps: JSON.stringify([{ repeat: 6, steps: [{ kind: 'work', distance_m: 800 }, { kind: 'recovery', duration_s: 120 }] }]) } } }] };
    expect(weekHeadline(intervals, block, 0, true)).toBe('5 × 800 m');
    expect(weekHeadline(intervals, block, 1, true)).toBe('6 × 800 m');
    expect(weekHeadline(tempoRun, block, 0, true)).toBe('25 min');
    expect(weekHeadline(long, block, 0, true)).toBe('6.5 mi');
    expect(weekHeadline(long, block, 0, false)).toBe('10.46 km');
    expect(hasWeekTargets(lift)).toBe(true);
    expect(hasWeekTargets(soccer)).toBe(false);
  });
});
