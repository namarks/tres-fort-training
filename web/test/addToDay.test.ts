import { describe, expect, it } from 'vitest';
import {
  activityCreation, ADD_KINDS, availableName, enduranceDraft, enduranceName, receiptIsOurs, resumable, runCreation, runDraft, runItems, runName,
  runStyled, sameSteps, versionAfterOwnWrites, type Unplaced,
} from '../src/addToDay';
import type { Slot, Workout } from '../src/model';

function slot(overrides: Partial<Slot>): Slot {
  return {
    id: 's1', workout_id: 'w1', exercise_id: 'ex_outdoor_run', order_index: 0,
    target_sets: 1, target_reps: 1, target_reps_max: null, target_rpe: null,
    rest_seconds: 0, target_weight: null, target_weight_unit: 'lb', target_duration_s: null,
    progression: null, run_steps: null, cues: null, is_warmup: 0, created_at: 0, updated_at: 0,
    exercise_name: 'Outdoor Run', exercise_unit: 'lb', exercise_muscle: 'legs', exercise_modality: 'cardio',
    exercise_laterality: 'bilateral', exercise_load_mode: 'total', exercise_demo_slug: null,
    ...overrides,
  };
}
function workout(id: string, name: string, exercises: Slot[] = [], extra: Partial<Workout> = {}): Workout {
  return { id, plan_id: 'p1', name, day_label: null, order_index: 0, notes: null, created_at: 0, updated_at: 0, archived_at: null, exercises, ...extra };
}
const at = { planId: 'p1', version: 7 };
const ids = () => { let n = 0; return () => `id-${++n}`; };

describe('adding to a day by type', () => {
  it('offers the iPhone composer’s types, with saved workouts last', () => {
    expect(ADD_KINDS.map((entry) => entry.label)).toEqual(['Run', 'Ride', 'Swim', 'Lift', 'At home', 'Other', 'Saved']);
  });

  it('shapes a run from its kind and how long or how far', () => {
    const easy = runDraft('easy', true);
    expect(runItems(easy, true)).toEqual({ ok: true, items: [{ kind: 'work', duration_s: 1800 }] });
    expect(runName(easy, [{ kind: 'work', duration_s: 1800 }], true)).toBe('Easy run · 30 min');
    const far = runItems({ ...easy, measure: 'distance', distance: '3' }, true);
    expect(far.ok && far.items).toMatchObject([{ kind: 'work', distance_m: expect.closeTo(4828, 0) }]);
    // A tempo run gets ten easy minutes either side, and keeps a heart-rate range on the tempo only.
    const tempo = runItems({ ...runStyled(easy, 'tempo'), target: 'heart_rate', low: '155', high: '165' }, true);
    expect(tempo).toEqual({ ok: true, items: [
      { kind: 'warmup', duration_s: 600 },
      { kind: 'work', duration_s: 1200, target: { type: 'heart_rate', min_bpm: 155, max_bpm: 165 } },
      { kind: 'cooldown', duration_s: 600 },
    ] });
    const intervals = runItems(runStyled(easy, 'intervals'), true);
    expect(intervals.ok && intervals.items[1]).toMatchObject({ repeat: expect.any(Number), steps: [{ kind: 'work' }, { kind: 'recovery' }] });
  });

  it('says what to fix instead of saving a run it can’t read', () => {
    expect(runItems({ ...runDraft('easy', true), time: '' }, true)).toEqual({ ok: false, error: 'Enter how long, in minutes.' });
    expect(runItems({ ...runDraft('easy', true), measure: 'distance', distance: 'far' }, true)).toEqual({ ok: false, error: 'Enter how far.' });
    expect(runItems({ ...runDraft('intervals', true), repeats: '0' }, true)).toEqual({ ok: false, error: 'Enter 1 to 50 repeats.' });
  });

  it('saves a new run as a workout with its steps, at the reviewed plan version', () => {
    const made = runCreation(runDraft('easy', true), '', [], true, at, ids());
    expect(made).toMatchObject({ ok: true, name: 'Easy run · 30 min' });
    if (!made.ok || made.creation.kind !== 'prescribed') throw new Error('expected a new workout');
    expect(made.creation.request).toMatchObject({ name: 'Easy run · 30 min', expected_plan_id: 'p1', expected_version: 7 });
    expect(made.creation.request.slots).toHaveLength(1);
    expect(made.creation.request.slots[0]).toMatchObject({ exercise_id: 'ex_outdoor_run', id: made.creation.steps!.slotId });
    expect(made.creation.steps!.items).toEqual([{ kind: 'work', duration_s: 1800 }]);
  });

  it('uses the saved run again instead of making a copy', () => {
    const saved = workout('easy', 'Easy run · 30 min', [slot({ id: 'easy-slot', run_steps: JSON.stringify([{ kind: 'work', duration_s: 1800 }]) })]);
    expect(runCreation(runDraft('easy', true), '', [saved], true, at, ids()))
      .toMatchObject({ ok: true, creation: { kind: 'existing', workoutId: 'easy' } });
    // The same name on a different run gets a number, and says so.
    const other = workout('easy', 'Easy run · 30 min', [slot({ id: 'easy-slot', run_steps: JSON.stringify([{ kind: 'work', duration_s: 2400 }]) })]);
    const second = runCreation(runDraft('easy', true), '', [other], true, at, ids());
    expect(second).toMatchObject({ ok: true, name: 'Easy run · 30 min 2', creation: { kind: 'prescribed' } });
    expect(second.ok && second.note).toContain('already a different workout');
    // A run saved without its steps (a save cut short) only gets its steps.
    const half = workout('easy', 'Easy run · 30 min', [slot({ id: 'easy-slot' })]);
    expect(runCreation(runDraft('easy', true), '', [half], true, at, ids()))
      .toMatchObject({ ok: true, creation: { kind: 'steps', workoutId: 'easy', slotId: 'easy-slot' } });
  });

  it('names a ride or swim so a synced one is known as the one planned', () => {
    expect(enduranceName('ride', enduranceDraft('ride', true), '', true)).toEqual({ ok: true, name: '60 min ride' });
    expect(enduranceName('swim', enduranceDraft('swim', true), '', true)).toEqual({ ok: true, name: '1000 yd swim' });
    expect(enduranceName('swim', enduranceDraft('swim', false), '', false)).toEqual({ ok: true, name: '1000 m swim' });
    expect(enduranceName('ride', { measure: 'distance', minutes: '', distance: '20' }, '', true)).toEqual({ ok: true, name: '20 mi ride' });
    expect(enduranceName('ride', enduranceDraft('ride', true), 'Zwift race', true)).toEqual({ ok: true, name: 'Zwift race ride' });
    expect(enduranceName('ride', enduranceDraft('ride', true), 'Sunday ride', true)).toEqual({ ok: true, name: 'Sunday ride' });
    expect(enduranceName('ride', { measure: 'time', minutes: 'x', distance: '' }, '', true)).toMatchObject({ ok: false });
  });

  it('makes an activity once and uses it again by name', () => {
    expect(activityCreation('Soccer', [])).toEqual({ ok: true, name: 'Soccer', creation: { kind: 'activity', name: 'Soccer' } });
    const soccer = workout('soccer', 'Soccer');
    expect(activityCreation(' soccer ', [soccer])).toMatchObject({ ok: true, creation: { kind: 'existing', workoutId: 'soccer' } });
    expect(activityCreation('', [])).toMatchObject({ ok: false });
    // Archived and one-date workouts never stand in for a new one.
    expect(activityCreation('Soccer', [workout('old', 'Soccer', [], { archived_at: 1 })])).toMatchObject({ creation: { kind: 'activity' } });
    expect(availableName('Soccer', [soccer, workout('s2', 'Soccer 2')])).toBe('Soccer 3');
  });

  it('names the version its own write left, never one read back', () => {
    // Nothing of this save is in yet: the page's version.
    expect(versionAfterOwnWrites(7, null)).toBe(7);
    // The workout saved at 7, so placing it names 8. A change made elsewhere
    // in between left the plan at 9, and the placement is refused.
    expect(versionAfterOwnWrites(7, 8)).toBe(8);
    // After a conflict the page reloads and shows a later version.
    expect(versionAfterOwnWrites(9, 8)).toBe(9);
  });

  it('builds on a repeated receipt only when nothing else moved the plan', () => {
    expect(receiptIsOurs(7, 8, 7)).toBe(true);
    // The same request again, after the page caught up.
    expect(receiptIsOurs(7, 8, 8)).toBe(true);
    // The request again while another device also wrote: the page is behind.
    expect(receiptIsOurs(7, 9, 7)).toBe(false);
    expect(receiptIsOurs(7, 9, 8)).toBe(false);
    // The page already shows that version, so nothing is written over.
    expect(receiptIsOurs(7, 9, 9)).toBe(true);
  });

  it('finishes a save that stopped before the workout was placed', () => {
    const held: Unplaced = { signature: 'lift', creation: { kind: 'activity', name: 'Yoga' }, workoutId: 'yoga', version: 8, stepsSaved: false };
    // The page has not reloaded since: the workout is not in its list yet.
    expect(resumable(held, 'lift', [], 7)).toBe(held);
    // After a reload it is there, and Add places that one.
    expect(resumable(held, 'lift', [workout('yoga', 'Yoga')], 9)).toBe(held);
    // Different choices are a different workout.
    expect(resumable(held, 'run', [workout('yoga', 'Yoga')], 9)).toBeNull();
    // Deleted or archived elsewhere since: start again.
    expect(resumable(held, 'lift', [], 9)).toBeNull();
    expect(resumable(held, 'lift', [workout('yoga', 'Yoga', [], { archived_at: 1 })], 9)).toBeNull();
    // Not acknowledged yet: the same request is sent again.
    expect(resumable({ ...held, workoutId: null, version: null }, 'lift', [], 9)).toMatchObject({ workoutId: null });
    expect(resumable(null, 'lift', [], 9)).toBeNull();
  });

  it('knows a run whose steps are already saved', () => {
    const items = [{ kind: 'work' as const, duration_s: 1800 }];
    expect(sameSteps(JSON.stringify(items), items)).toBe(true);
    expect(sameSteps(null, items)).toBe(false);
    expect(sameSteps(JSON.stringify([{ kind: 'work', duration_s: 2400 }]), items)).toBe(false);
  });
});
