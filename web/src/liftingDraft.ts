import { RUN_EXERCISE_ID } from '../../src/runSteps';
import type { WorkoutPrescription, PrescribedSlot } from './api';
import { factsOfCatalog, fixedMeasure, isSlotDraft, newDraft, prescriptionFields, showsLoad, type CatalogExercise, type SlotDraft, type WeightUnit } from './editing';
import type { CreationAuthority, CreationReview } from './guidedWorkout';

export interface LiftingRow { exerciseId: string; targets: SlotDraft }
export interface LiftingDraft { name: string; rows: LiftingRow[] }
export interface RetainedLiftingDraft { draft: LiftingDraft; review: CreationReview }
export const initialLiftingDraft = (): LiftingDraft => ({ name: 'Lifting workout', rows: [] });
export const liftingExercise = (exercise: CatalogExercise): boolean => exercise.id !== RUN_EXERCISE_ID;
export function liftingTargetSummary(row: LiftingRow, exercise: CatalogExercise): string {
  const d = row.targets, measure = fixedMeasure(exercise.modality) ?? d.measure;
  const target = measure === 'reps' ? `${d.reps}${d.useRange ? `–${d.repsMax}` : ''} reps${exercise.laterality === 'unilateral' ? ' per side' : ''}`
    : measure === 'hold' ? `${d.holdSeconds}s` : `${d.minutes} min`;
  const parts = [`${d.sets} × ${target}`];
  if (showsLoad(exercise.modality)) {
    parts.push(d.weight.trim() ? `${d.weight} ${d.unit}${exercise.load_mode === 'per_hand' ? ' each hand' : ''}${Number(d.weight) < 0 ? ' assistance' : ''}` : 'No load target');
    if (d.rpe.trim()) parts.push(`RPE ${d.rpe}`);
  }
  parts.push(`Rest ${d.rest}s`);
  if (d.isWarmup) parts.unshift('Warm-up');
  return parts.join(' · ');
}
export function addLiftingExercise(draft: LiftingDraft, exercise: CatalogExercise, unit: WeightUnit): LiftingDraft {
  if (!liftingExercise(exercise) || draft.rows.length >= 50 || draft.rows.some(row => row.exerciseId === exercise.id)) return draft;
  return { ...draft, rows: [...draft.rows, { exerciseId: exercise.id, targets: newDraft(factsOfCatalog(exercise), { warmup: false, unit }) }] };
}
export function moveLiftingExercise(draft: LiftingDraft, index: number, direction: -1 | 1): LiftingDraft {
  const destination = index + direction;
  if (index < 0 || index >= draft.rows.length || destination < 0 || destination >= draft.rows.length) return draft;
  const rows = [...draft.rows];
  [rows[index], rows[destination]] = [rows[destination]!, rows[index]!];
  return { ...draft, rows };
}
export function liftingErrors(draft: LiftingDraft, catalog: CatalogExercise[]): string[] {
  const errors: string[] = [];
  if (!draft.name.trim() || draft.name.trim().length > 200) errors.push('Enter a workout name up to 200 characters.');
  if (!draft.rows.length) errors.push('Choose at least one exercise.');
  if (draft.rows.length > 50 || new Set(draft.rows.map(row => row.exerciseId)).size !== draft.rows.length) errors.push('Choose up to 50 different exercises.');
  for (const row of draft.rows) {
    const exercise = catalog.find(exercise => exercise.id === row.exerciseId);
    if (!exercise) { errors.push('A selected exercise is unavailable. Reload the catalog before saving.'); continue; }
    if (!liftingExercise(exercise)) { errors.push('Create Outdoor Run separately using the Run starting point.'); continue; }
    const result = prescriptionFields(row.targets, factsOfCatalog(exercise));
    if (!result.ok) errors.push(...result.errors.map(error => `${exercise.name}: ${error}`));
  }
  return errors;
}

/** Allocate request identities only after every movement has a valid reviewed target. */
export function buildLiftingPrescription(draft: LiftingDraft, catalog: CatalogExercise[], at: CreationAuthority,
  uuid: () => string = () => crypto.randomUUID()): WorkoutPrescription | null {
  if (liftingErrors(draft, catalog).length) return null;
  const slots: PrescribedSlot[] = draft.rows.map((row, index) => {
    const result = prescriptionFields(row.targets, factsOfCatalog(catalog.find(exercise => exercise.id === row.exerciseId)!));
    if (!result.ok) throw new Error('invalid_reviewed_prescription');
    const fields = result.fields;
    return { id: uuid(), exercise_id: row.exerciseId, order_index: index,
      target_sets: fields.target_sets as number, target_reps: fields.target_reps as number,
      target_reps_max: fields.target_reps_max as number | undefined ?? null,
      target_rpe: fields.target_rpe as number | undefined ?? null, rest_seconds: fields.rest_seconds as number,
      target_weight: fields.target_weight as number | undefined ?? null, target_weight_unit: row.targets.unit,
      target_duration_s: fields.target_duration_s as number | undefined ?? null,
      progression: null, cues: null, is_warmup: row.targets.isWarmup ? 1 : 0,
      group_id: null, group_rest_seconds: null, group_transition_seconds: null };
  });
  return { workout_id: uuid(), name: draft.name.trim(), expected_plan_id: at.planId, expected_version: at.version, slots };
}

/** The frozen wire request, not a shared home target, restores every pending row. */
export function liftingDraftFromPrescription(request: WorkoutPrescription): LiftingDraft {
  return { name: request.name, rows: request.slots.map(slot => ({ exerciseId: slot.exercise_id, targets: {
    isWarmup: slot.is_warmup === 1, measure: slot.target_duration_s == null ? 'reps' : 'hold',
    sets: String(slot.target_sets), reps: String(slot.target_reps), useRange: slot.target_reps_max != null,
    repsMax: String(slot.target_reps_max ?? 12), holdSeconds: String(slot.target_duration_s ?? 45),
    minutes: String((slot.target_duration_s ?? 300) / 60), rest: String(slot.rest_seconds),
    weight: slot.target_weight == null ? '' : String(slot.target_weight), unit: slot.target_weight_unit ?? 'lb',
    rpe: slot.target_rpe == null ? '' : String(slot.target_rpe),
    stored: slot.target_weight == null ? null : { value: slot.target_weight, unit: slot.target_weight_unit ?? 'lb' },
  } })) };
}

export function isRetainedLiftingDraft(value: unknown): value is RetainedLiftingDraft {
  if (!value || typeof value !== 'object') return false;
  const v = value as RetainedLiftingDraft;
  return !!v.draft && typeof v.draft.name === 'string' && Array.isArray(v.draft.rows) && v.draft.rows.length <= 50
    && v.draft.rows.every(row => !!row && typeof row.exerciseId === 'string' && isSlotDraft(row.targets))
    && !!v.review && ['none', 'needs_refresh', 'needs_review'].includes(v.review.recovery) && !!v.review.at
    && (v.review.at.planId === null || typeof v.review.at.planId === 'string')
    && Number.isSafeInteger(v.review.at.version) && v.review.at.version >= (v.review.at.planId === null ? 0 : 1);
}
