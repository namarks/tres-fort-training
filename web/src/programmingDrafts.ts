import { newBlock, type ProgramBody } from './blocks';
import { isBlockDraft } from './blockDrafts';
import { applyingBuild, EASY_CHOICES, labelingEasyWeeks, usableBuild, weeksToEvent, type BuildRule, type EasyEvery } from './blockBuild';
import { newLayeredBlock, suggestedBlockWorkouts } from './blockLayers';
import type { EventDraft } from './event';
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
  /** The guided setup (docs/plans/web-app P2): which of its three steps is open. */
  step?: 1 | 2 | 3;
  /** An event's date sets the block's length, or the member types the weeks. */
  purpose?: 'event' | 'weeks';
  /** The event as typed; saved with the block when the purpose is an event. */
  event?: EventDraft;
  /** Workout id → how it builds; a workout without one gets its default. */
  builds?: Record<string, BuildRule>;
  /** Every Nth week easier, null for none; left out, the block's default. */
  easy?: EasyEvery;
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
      && typeof entry.id === 'string' && (WEEKDAYS as readonly string[]).includes(entry.day))))
    && (d.step === undefined || d.step === 1 || d.step === 2 || d.step === 3)
    && (d.purpose === undefined || d.purpose === 'event' || d.purpose === 'weeks')
    && (d.event === undefined || isEventDraft(d.event))
    && (d.builds === undefined || (!!d.builds && typeof d.builds === 'object' && !Array.isArray(d.builds)
      && Object.values(d.builds).every(isBuildRule)))
    && (d.easy === undefined || (EASY_CHOICES as readonly unknown[]).includes(d.easy));
}
const EVENT_FIELDS = ['name', 'date', 'discipline', 'otherDiscipline', 'distanceChoice', 'customAmount', 'customUnit', 'distanceLabel', 'goal'] as const;
function isEventDraft(value: unknown): value is EventDraft {
  return !!value && typeof value === 'object' && EVENT_FIELDS.every(field => typeof (value as Record<string, unknown>)[field] === 'string');
}
const BUILD_TARGETS = ['reps', 'load', 'sets', 'time', 'repeats', 'run_time', 'run_distance'];
function isBuildRule(value: unknown): value is BuildRule {
  if (!value || typeof value !== 'object') return false;
  const rule = value as { kind?: unknown; target?: unknown; amount?: unknown };
  if (rule.kind === 'same' || rule.kind === 'manual') return true;
  return rule.kind === 'add' && BUILD_TARGETS.includes(rule.target as string)
    && typeof rule.amount === 'number' && Number.isFinite(rule.amount) && rule.amount > 0;
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

/** How many weeks the setup asks for: up to the event's week, or as typed.
 * Null while the event has no usable date or the count isn't 1 to 52. */
export function setupWeeks(draft: NewBlockDraft): number | null {
  if (draft.purpose === 'event') return draft.event ? weeksToEvent(draft.start, draft.event.date) : null;
  return validBlockWeeks(draft.weeks) ? Number(draft.weeks) : null;
}
/** Which weeks are easier: the member's choice, else every 4th in a block
 * long enough to have one. */
export function setupEasy(draft: NewBlockDraft, weeks: number): EasyEvery {
  const chosen = draft.easy === undefined ? 4 : draft.easy;
  return chosen != null && weeks >= chosen ? chosen : null;
}
/** The block the guided setup saves: its own workouts on their days for the
 * weeks asked for, each week filled by the workout's build. Null while a
 * step is unfinished. */
export function setupBlockRequest(draft: NewBlockDraft, live: readonly Workout[], miles: boolean): ProgramBody | null {
  const weeks = setupWeeks(draft);
  if (weeks == null) return null;
  const name = draft.name.trim() || (draft.purpose === 'event' ? draft.event?.name.trim() ?? '' : '');
  const base = newBlockRequest({ ...draft, name, weeks: String(weeks) }, live);
  if (!base) return null;
  const easyEvery = setupEasy(draft, weeks);
  let body = base, builds = false;
  for (const id of base.workout_ids ?? []) {
    const workout = live.find(entry => entry.id === id);
    if (!workout) continue;
    const rule = usableBuild(workout, draft.builds?.[id], miles);
    builds ||= rule.kind === 'add';
    body = applyingBuild(body, workout, rule, { easyEvery, miles });
  }
  body = labelingEasyWeeks(body, builds ? easyEvery : null);
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
