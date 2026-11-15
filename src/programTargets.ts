// Targets that change from week to week (docs/plans/progressive-plans P1,
// spec.md). A week of a block can give a slot its own sets, reps, load,
// duration or run steps; on a date that week covers, the slot reads those.
// Pure and mirrored in Swift (`PlanTree.workout(_:on:)`); the shared fixture
// ios/TresFortTests/Fixtures/ProgramTargets.json is the contract.
import { programWeekOn } from './calendarProjection';
import { RUN_EXERCISE_ID } from './runSteps';
import type { SlotTargets, TrainingProgram } from './types';

/** Slot id → targets for the week of the block that covers `date`; empty
 * outside a block or in a week that changes nothing. */
export function weekTargetsOn(program: TrainingProgram | null | undefined, date: string): Record<string, SlotTargets> {
  const index = programWeekOn(program ?? null, date);
  return index == null ? {} : program!.weeks[index]!.targets ?? {};
}

export interface TargetSlot {
  id: string;
  exercise_id: string;
  target_sets: number;
  target_reps: number;
  target_reps_max: number | null;
  target_rpe: number | null;
  target_weight: number | null;
  target_weight_unit?: 'lb' | 'kg';
  target_duration_s: number | null;
  run_steps?: string | null;
}

/** The slot with one week's targets laid over it. An absent field keeps the
 * slot's value; steps apply only while the slot is still the outdoor run. */
export function applySlotTargets<T extends TargetSlot>(slot: T, targets: SlotTargets | undefined): T {
  if (!targets) return slot;
  const out = { ...slot };
  if (targets.target_sets !== undefined) out.target_sets = targets.target_sets;
  if (targets.target_reps !== undefined) out.target_reps = targets.target_reps;
  if (targets.target_reps_max !== undefined) out.target_reps_max = targets.target_reps_max;
  if (targets.target_rpe !== undefined) out.target_rpe = targets.target_rpe;
  if (targets.target_weight !== undefined) out.target_weight = targets.target_weight;
  if (targets.target_weight_unit !== undefined) out.target_weight_unit = targets.target_weight_unit;
  if (targets.target_duration_s !== undefined) out.target_duration_s = targets.target_duration_s;
  if (targets.run_steps !== undefined && slot.exercise_id === RUN_EXERCISE_ID) out.run_steps = targets.run_steps;
  // A raised minimum never leaves the range upside down.
  if (out.target_reps_max != null && out.target_reps_max < out.target_reps) out.target_reps_max = null;
  return out;
}

/** Every slot of a workout as it reads on `date`. */
export function applyWeekTargets<W extends { exercises: TargetSlot[] }>(
  workout: W, program: TrainingProgram | null | undefined, date: string,
): W {
  const targets = weekTargetsOn(program, date);
  if (Object.keys(targets).length === 0) return workout;
  return { ...workout, exercises: workout.exercises.map((slot) => applySlotTargets(slot, targets[slot.id])) };
}
