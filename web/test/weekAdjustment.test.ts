import { describe, expect, it } from 'vitest';
import { lighterWeek, liftingWorkoutsInWeek, weekScopeLabel } from '../src/weekAdjustment';
import type { ProgramBody } from '../src/blocks';
import type { Slot, Workout } from '../src/model';

const slot = (id: string, extra: Partial<Slot> = {}): Slot => ({ id, workout_id: 'lift', exercise_id: id, order_index: 0,
  target_sets: 4, target_reps: 8, target_reps_max: null, target_rpe: null, rest_seconds: 90,
  target_weight: 100, target_weight_unit: 'lb', target_duration_s: null, is_warmup: 0,
  progression: null, run_steps: null, cues: null, created_at: 0, updated_at: 0,
  exercise_name: id, exercise_unit: 'lb', exercise_muscle: 'legs', exercise_modality: 'barbell',
  exercise_laterality: 'bilateral', exercise_load_mode: 'total', exercise_demo_slug: null, ...extra });
const workout = (id: string, exercises: Slot[]): Workout => ({ id, plan_id: 'plan', name: id, day_label: null, order_index: 0,
  notes: null, created_at: 0, updated_at: 0, exercises });
const program = (): ProgramBody => ({ start: '2026-11-16', repeat: false, weeks: Array.from({ length: 3 }, () => ({
  week: { mon: 'lift', tue: null, wed: 'lift', thu: null, fri: null, sat: null, sun: null }, extras: { mon: ['core'] },
})) });

describe('reviewed lighter block week', () => {
  it('uses effective selected-week targets once per workout and preserves unrelated weeks/templates', () => {
    const p = program(); p.weeks[1]!.targets = { squat: { target_sets: 5, target_weight: 120 }, other: { target_reps: 7 } };
    const lift = workout('lift', [slot('squat')]); const core = workout('core', [slot('plank', { target_weight: null })]);
    const original = structuredClone({ p, lift, core });
    const result = lighterWeek(p, 1, [lift, core], { setsPercent: 20, loadPercent: 10 });
    expect(result.program.weeks[1]!.targets?.squat).toEqual({ target_sets: 4, target_weight: 108 });
    expect(result.program.weeks[1]!.targets?.plank).toEqual({ target_sets: 3 });
    expect(result.program.weeks[1]!.targets?.other).toEqual({ target_reps: 7 });
    expect(result.program.weeks[0]).toEqual(p.weeks[0]); expect(result.program.weeks[2]).toEqual(p.weeks[2]);
    expect({ p, lift, core }).toEqual(original);
    expect(result.rows.filter(r => r.key === 'squat:load')).toHaveLength(1);
  });
  it('keeps units, increases assistance, and never fabricates unknown/zero loads', () => {
    const p = program(); p.weeks[0]!.targets = { kg: { target_weight: 100, target_weight_unit: 'lb' } };
    const w = workout('lift', [slot('assist', { target_weight: -20, exercise_modality: 'bw' }),
      slot('kg', { target_weight: 50, target_weight_unit: 'kg' }), slot('unknown', { target_weight: null }), slot('zero', { target_weight: 0 })]);
    const result = lighterWeek(p, 0, [w], { setsPercent: 0, loadPercent: 10 });
    expect(result.program.weeks[0]!.targets?.assist?.target_weight).toBe(-22);
    expect(result.program.weeks[0]!.targets?.kg).toEqual({ target_weight: 90, target_weight_unit: 'lb' });
    expect(result.program.weeks[0]!.targets?.unknown).toBeUndefined(); expect(result.program.weeks[0]!.targets?.zero).toBeUndefined();
  });
  it('changes group rounds atomically, skips warmups/cardio and keeps mixed groups intact', () => {
    const w = workout('lift', [slot('a', { group_id: 'g' }), slot('b', { group_id: 'g' }),
      slot('warm', { is_warmup: 1 }), slot('cardio', { exercise_modality: 'cardio' }),
      slot('mixedLift', { group_id: 'mixed' }), slot('mixedCardio', { group_id: 'mixed', exercise_modality: 'cardio' })]);
    const result = lighterWeek(program(), 0, [w], { setsPercent: 50, loadPercent: 0 });
    expect(result.program.weeks[0]!.targets).toEqual({ a: { target_sets: 2 }, b: { target_sets: 2 } });
    expect(result.rows).toHaveLength(1); expect(result.rows[0]!.field).toBe('Rounds');
  });
  it('limits selected workout, bounds percentages, and labels repeating indexed weeks', () => {
    const p = program(); p.repeat = true;
    const ws = [workout('lift', [slot('a', { target_sets: 1 })]), workout('core', [slot('b')]), workout('unused', [slot('c')])];
    expect(liftingWorkoutsInWeek(p, 0, ws).map(w => w.id)).toEqual(['lift', 'core']);
    expect(lighterWeek(p, 0, ws, { workoutId: 'lift', setsPercent: 90, loadPercent: 0 }).rows).toEqual([]);
    expect(lighterWeek(p, 0, ws, { setsPercent: NaN, loadPercent: 20 }).program).toBe(p);
    expect(weekScopeLabel(p, 1)).toBe('Week 2 of this block, each time the block repeats');
  });
});
