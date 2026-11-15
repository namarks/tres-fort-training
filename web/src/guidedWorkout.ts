/** Reviewed home routines mirror HomeRoutineDraft.swift and ExerciseSearchPolicy. */
import { isPartnerWorkoutInput } from '../../src/partnerTraining';
import { RUN_EXERCISE_ID } from '../../src/runSteps';
import { ApiError, isVersionConflict, type WorkoutPrescription, type PrescribedSlot } from './api';
import type { CatalogExercise } from './editing';

export const HOME_STARTS = {
  core: { title: 'Core', name: 'Core routine', ids: ['ex_plank', 'ex_dead_bug', 'ex_side_plank', 'ex_bird_dog', 'ex_hollow'] },
  stretching: { title: 'Stretching', name: 'Stretch routine', ids: ['ex_cat_cow', 'ex_thoracic_rotation', 'ex_90_90_hip', 'ex_pigeon_pose', 'ex_couch_stretch'] },
  bodyweight: { title: 'Bodyweight circuit', name: 'Bodyweight circuit', ids: ['ex_pushup', 'ex_bw_squat', 'ex_bw_reverse_lunge', 'ex_glute_bridge_march', 'ex_plank'] },
} as const;
export type HomeStart = keyof typeof HOME_STARTS;
const EQUIPMENT_IDS = new Set(['ex_ab_wheel', 'ex_back_extension', 'ex_back_lever', 'ex_box_jump', 'ex_dead_hang',
  'ex_dips', 'ex_dragon_flag', 'ex_front_lever', 'ex_hanging_leg_raise', 'ex_inverted_row', 'ex_nordic_curl',
  'ex_reverse_hyper', 'ex_skin_the_cat', 'ex_tuck_front_lever']);
const EQUIPMENT_WORDS = ['pull-up', 'pullup', 'chin-up', 'chinup', 'muscle-up', 'hang', 'lever'];
export function isEquipmentFree(exercise: CatalogExercise): boolean {
  const name = exercise.name.toLowerCase();
  return ['bw', 'timed'].includes(exercise.modality) && !EQUIPMENT_IDS.has(exercise.id)
    && !name.split(/[^\p{L}]+/u).includes('ring') && !EQUIPMENT_WORDS.some(word => name.includes(word));
}
export interface GuidedDraft {
  kind: 'run' | 'home'; name: string; exerciseIds: string[];
  sets: string; reps: string; seconds: string; rest: string;
  circuit: boolean; timeEveryExercise: boolean; transitionRest: string; roundRest: string;
}
export function initialGuidedDraft(start: HomeStart | 'run'): GuidedDraft {
  return { kind: start === 'run' ? 'run' : 'home', name: start === 'run' ? 'Run' : HOME_STARTS[start].name,
    exerciseIds: start === 'run' ? [RUN_EXERCISE_ID] : [...HOME_STARTS[start].ids],
    sets: '3', reps: '8', seconds: '45', rest: '120', circuit: start === 'bodyweight',
    timeEveryExercise: false, transitionRest: '20', roundRest: '60' };
}
export const isTimed = (draft: GuidedDraft, exercise: CatalogExercise): boolean => draft.timeEveryExercise || exercise.modality === 'timed';
function integer(text: string, min: number, max: number): number | null {
  const clean = text.trim(), number = Number(clean);
  return /^\d+$/.test(clean) && Number.isSafeInteger(number) && number >= min && number <= max ? number : null;
}
export function guidedErrors(draft: GuidedDraft, catalog: CatalogExercise[]): string[] {
  const errors: string[] = [];
  if (!draft.name.trim() || draft.name.trim().length > 200) errors.push('Enter a workout name up to 200 characters.');
  const exercises = draft.exerciseIds.map(id => catalog.find(exercise => exercise.id === id));
  if (exercises.some(exercise => !exercise)) errors.push('Some selected exercises are unavailable. Reload the catalog before saving.');
  if (draft.kind === 'run') {
    if (draft.exerciseIds.length !== 1 || draft.exerciseIds[0] !== RUN_EXERCISE_ID) errors.push('Choose Outdoor Run from the catalog.');
    return errors;
  }
  if (!exercises.length) errors.push('Choose at least one exercise.');
  if (exercises.length > 50 || new Set(draft.exerciseIds).size !== exercises.length
      || exercises.some(exercise => exercise && !isEquipmentFree(exercise))) errors.push('Choose up to 50 different exercises that need no equipment.');
  if (integer(draft.sets, 1, 100) === null) errors.push('Enter 1 to 100 sets or rounds.');
  if (exercises.some(exercise => exercise && isTimed(draft, exercise)) && integer(draft.seconds, 1, 7200) === null) errors.push('Enter a hold or work time from 1 to 7,200 seconds.');
  if (exercises.some(exercise => exercise && !isTimed(draft, exercise)) && integer(draft.reps, 1, 1000) === null) errors.push('Enter 1 to 1,000 reps.');
  if (draft.circuit) {
    if (exercises.length < 2) errors.push('A circuit needs at least two exercises.');
    if (integer(draft.transitionRest, 0, 3600) === null || integer(draft.roundRest, 0, 3600) === null) errors.push('Enter transition and round rests from 0 to 3,600 seconds.');
  } else if (integer(draft.rest, 0, 3600) === null) errors.push('Enter a rest from 0 to 3,600 seconds.');
  return errors;
}
export function guidedTarget(draft: GuidedDraft, exercise: CatalogExercise): string {
  if (draft.kind === 'run') return 'Open run';
  return `${draft.sets} × ${isTimed(draft, exercise) ? `${draft.seconds}s` : `${draft.reps} reps`}${!isTimed(draft, exercise) && exercise.laterality === 'unilateral' ? ' each side' : ''}`;
}
export function buildPrescription(draft: GuidedDraft, catalog: CatalogExercise[], at: { planId: string | null; version: number },
  uuid: () => string = () => crypto.randomUUID()): WorkoutPrescription | null {
  if (guidedErrors(draft, catalog).length) return null;
  const run = draft.kind === 'run', group = !run && draft.circuit ? uuid() : null;
  const slots: PrescribedSlot[] = draft.exerciseIds.map((exerciseId, index) => {
    const exercise = catalog.find(row => row.id === exerciseId)!;
    const duration = !run && isTimed(draft, exercise) ? Number(draft.seconds.trim()) : null;
    return { id: uuid(), exercise_id: exerciseId, order_index: index, target_sets: run ? 1 : Number(draft.sets.trim()),
      target_reps: run ? 1 : duration ?? Number(draft.reps.trim()), target_reps_max: null, target_rpe: null,
      rest_seconds: run ? 0 : Number((draft.circuit ? draft.roundRest : draft.rest).trim()), target_weight: null,
      target_weight_unit: 'lb', target_duration_s: duration, progression: null, cues: null, is_warmup: 0,
      group_id: group, group_rest_seconds: group ? Number(draft.roundRest.trim()) : null,
      group_transition_seconds: group ? Number(draft.transitionRest.trim()) : null };
  });
  return { workout_id: uuid(), name: draft.name.trim(), expected_plan_id: at.planId, expected_version: at.version, slots };
}
/** A restored unresolved request is displayed as its original reviewed values. */
export function draftFromPrescription(request: WorkoutPrescription): GuidedDraft {
  const first = request.slots[0]!;
  const run = request.slots.length === 1 && first.exercise_id === RUN_EXERCISE_ID;
  const timed = request.slots.find(slot => slot.target_duration_s !== null);
  const reps = request.slots.find(slot => slot.target_duration_s === null);
  return { ...initialGuidedDraft(run ? 'run' : 'core'), name: request.name, exerciseIds: request.slots.map(slot => slot.exercise_id),
    sets: String(first.target_sets), reps: String(reps?.target_reps ?? 8), seconds: String(timed?.target_duration_s ?? 45),
    rest: String(first.rest_seconds), circuit: !!first.group_id,
    timeEveryExercise: request.slots.every(slot => slot.target_duration_s !== null),
    transitionRest: String(first.group_transition_seconds ?? 20), roundRest: String(first.group_rest_seconds ?? 60) };
}
export type CreationFailure = 'review' | 'blocked' | 'uncertain';
/** Only a definite refusal releases an identity for a newly reviewed request. */
export function creationFailure(error: unknown): CreationFailure {
  if (isVersionConflict(error) || (error instanceof ApiError && (error.status === 400 || error.status === 422))) return 'review';
  if (error instanceof ApiError && error.status === 409) return 'blocked';
  return 'uncertain';
}

export interface CreationAuthority { planId: string | null; version: number }
export interface CreationReview {
  at: CreationAuthority;
  recovery: 'none' | 'needs_refresh' | 'needs_review';
}
type ReviewEvent = { kind: 'refused' | 'refresh_failed' | 'refreshed' }
  | { kind: 'new_draft' | 'review'; at: CreationAuthority };
/** A refused request must refresh, then be reviewed explicitly before new UUIDs are allocated. */
export function creationReview(state: CreationReview, event: ReviewEvent): CreationReview {
  if (event.kind === 'refused' || event.kind === 'refresh_failed') return { ...state, recovery: 'needs_refresh' };
  if (event.kind === 'refreshed') return { ...state, recovery: 'needs_review' };
  if (event.kind === 'review' && state.recovery !== 'needs_refresh') return { at: event.at, recovery: 'none' };
  if (event.kind === 'new_draft' && state.recovery === 'none') return { at: event.at, recovery: 'none' };
  return state;
}
export function prescriptionAuthority(review: CreationReview, current: CreationAuthority): CreationAuthority | null {
  return review.recovery === 'none' && review.at.planId === current.planId && review.at.version === current.version ? review.at : null;
}
export interface PendingCreation { request: WorkoutPrescription; status: 'pending' | 'saved' | 'blocked'; kind?: 'lifting' }
export type StoredCreation = PendingCreation | 'unreadable' | null;
type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
const storageKey = (accountId: string) => `tresfort.pendingWorkout.v1.${encodeURIComponent(accountId)}`;
export function readPendingCreation(storage: StorageLike, accountId: string): StoredCreation {
  try {
    const raw = storage.getItem(storageKey(accountId));
    if (!raw) return null;
    const value = JSON.parse(raw) as PendingCreation;
    return value && ['pending', 'saved', 'blocked'].includes(value.status) && (value.kind === undefined || value.kind === 'lifting') && isPartnerWorkoutInput(value.request)
      ? value : 'unreadable';
  } catch { return 'unreadable'; }
}
export function savePendingCreation(storage: StorageLike, accountId: string, pending: PendingCreation | null): boolean {
  try {
    if (pending) storage.setItem(storageKey(accountId), JSON.stringify(pending));
    else storage.removeItem(storageKey(accountId));
    return true;
  } catch { return false; }
}

/** Late responses from an unmounted editor cannot replace a newer request. */
export function transitionPendingCreation(storage: StorageLike, accountId: string, expectedId: string | null,
  next: PendingCreation | null): 'saved' | 'stale' | 'unavailable' {
  const current = readPendingCreation(storage, accountId);
  if (current === 'unreadable') return 'unavailable';
  if ((current?.request.workout_id ?? null) !== expectedId) return 'stale';
  // A delayed rejection/retry must not erase an acknowledgement.
  if (current?.status === 'saved' && next?.status !== 'saved') return 'stale';
  return savePendingCreation(storage, accountId, next) ? 'saved' : 'unavailable';
}
