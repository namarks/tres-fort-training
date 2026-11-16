import { newBlock, type ProgramBody } from './blocks';
import { isBlockDraft } from './blockDrafts';
import { newLayeredBlock, suggestedBlockWorkouts } from './blockLayers';
import { parseTags, tagsOf } from './editing';
import { WEEKDAYS, type Weekday, type WeeklySchedule } from '../../src/types';
import type { Workout } from './model';

export const NEW_BLOCK_DOCUMENT = 'creation:block';
export const detailsDocument = (workoutId: string) => `workout:${workoutId}:details`;
export interface NewBlockDraft {
  name: string; start: string; weeks: string; repeat: boolean;
  /** The reviewed usual week, frozen until the member explicitly reviews a newer plan. */
  source: ProgramBody;
  workoutNames: Record<string, string>;
  /** Workouts of the usual week the block takes as its own; the rest stay every week. */
  picked?: string[];
  /** Workouts the block adds that the usual week doesn't hold. */
  added?: { id: string; day: Weekday }[];
}
export function newBlockDraft(schedule: WeeklySchedule | null | undefined, workouts: Workout[], start: string): NewBlockDraft {
  const source = newBlock(schedule, workouts, { start, weeks: 1, repeat: false });
  return { name: '', start, weeks: '6', repeat: false, source,
    workoutNames: Object.fromEntries(workouts.map(workout => [workout.id, workout.name])),
    picked: suggestedBlockWorkouts(source.weeks[0]!, workouts), added: [] };
}
export function isNewBlockDraft(value: unknown): value is NewBlockDraft {
  if (!value || typeof value !== 'object') return false;
  const d = value as NewBlockDraft;
  return typeof d.name === 'string' && typeof d.start === 'string' && typeof d.weeks === 'string' && typeof d.repeat === 'boolean'
    && isBlockDraft({ programId: 'creation', saved: d.source, draft: d.source, identities: {} }) && d.source.weeks.length === 1
    && !!d.workoutNames && typeof d.workoutNames === 'object' && !Array.isArray(d.workoutNames)
    && Object.values(d.workoutNames).every(name => typeof name === 'string')
    && (d.picked === undefined || (Array.isArray(d.picked) && d.picked.every(id => typeof id === 'string')))
    && (d.added === undefined || (Array.isArray(d.added) && d.added.every(entry => !!entry && typeof entry === 'object'
      && typeof entry.id === 'string' && (WEEKDAYS as readonly string[]).includes(entry.day))));
}
/** Whether the draft's week count can be saved. */
export function validBlockWeeks(text: string): boolean {
  const weeks = Number(text);
  return /^\d+$/.test(text.trim()) && Number.isInteger(weeks) && weeks >= 1 && weeks <= 52;
}
/** The block to save: its own workouts only, so what the member does every
 * week carries on beside it. Null without a valid length or any workout.
 * `live` drops a workout archived or deleted since the draft was made. */
export function newBlockRequest(draft: NewBlockDraft, live?: readonly Workout[]): ProgramBody | null {
  if (!validBlockWeeks(draft.weeks)) return null;
  const known = live ?? Object.keys(draft.workoutNames).map(id => ({ id, exercises: [] }) as unknown as Workout);
  const body = newLayeredBlock(draft.source.weeks[0]!, known, { name: draft.name, start: draft.start,
    repeat: draft.repeat, weeks: Number(draft.weeks), picked: draft.picked ?? [], added: draft.added ?? [] });
  if (!body.workout_ids?.length) return null;
  return isBlockDraft({ programId: 'creation', saved: body, draft: body, identities: {} }) ? body : null;
}

export interface WorkoutDetails { name: string; tags: string; notes: string }
export interface WorkoutDetailsDraft { workoutId: string; saved: WorkoutDetails; draft: WorkoutDetails; archived: boolean }
export const workoutDetails = (workout: Workout): WorkoutDetails => ({ name: workout.name, tags: tagsOf(workout).join(', '), notes: workout.notes ?? '' });
export const newWorkoutDetailsDraft = (workout: Workout): WorkoutDetailsDraft => ({ workoutId: workout.id, saved: workoutDetails(workout), draft: workoutDetails(workout), archived: !!workout.archived_at });
function isDetails(value: unknown): value is WorkoutDetails {
  if (!value || typeof value !== 'object') return false;
  const d = value as WorkoutDetails;
  return typeof d.name === 'string' && typeof d.tags === 'string' && typeof d.notes === 'string';
}
export function isWorkoutDetailsDraft(value: unknown): value is WorkoutDetailsDraft {
  if (!value || typeof value !== 'object') return false;
  const d = value as WorkoutDetailsDraft;
  return typeof d.workoutId === 'string' && typeof d.archived === 'boolean' && isDetails(d.saved) && isDetails(d.draft);
}
export function workoutDetailsRequest(draft: WorkoutDetails): { fields: Record<string, unknown> } | { error: string } {
  const name = draft.name.trim();
  if (!name) return { error: 'Give the workout a name.' };
  if (name.length > 80) return { error: 'Use a name of up to 80 characters.' };
  const tags = parseTags(draft.tags);
  if (!tags.ok) return { error: tags.error };
  // Send the reviewed values together, including explicit clears. The captured
  // version prevents a newer value being overwritten without review.
  return { fields: { name, tags: tags.tags, notes: draft.notes.trim() || null } };
}
