/**
 * Pure rules for changing the weekly routine, single dates and away dates on
 * the web. They follow the app (SyncModel.calendarAssignmentUnavailableReason,
 * calendarMoveUnavailableReason and AwayDatesView.swift); the Worker checks
 * every write again.
 */
import { MAX_SCHEDULE_EXTRAS, SCHEDULE_TIME, WEEKDAYS, type Trip, type Weekday, type WeeklySchedule } from '../../src/types';
import type { CalendarCell, Workout } from './model';
import type { StateResponse } from './api';

type Session = StateResponse['sessions'][number];
export type Week = Record<Weekday, string | null>;

/**
 * The whole week with one day changed. The Worker replaces the whole week on
 * every write, so a day left out would become rest.
 */
export function weekWith(week: Partial<Week>, day: Weekday, workoutId: string | null): Week {
  const full = Object.fromEntries(WEEKDAYS.map((d) => [d, week[d] ?? null])) as Week;
  return { ...full, [day]: workoutId };
}

export type RoutineSchedule = Pick<WeeklySchedule, 'week' | 'extras' | 'times'>;
export interface RoutineDayDraft {
  primary: string | null;
  extras: string[];
  times: Record<string, string>;
}
export type RoutineResult = { ok: true; schedule: RoutineSchedule } | { ok: false; error: string };

/** Copy the reviewed day; editing it never mutates the synced plan. */
export function routineDay(schedule: RoutineSchedule, day: Weekday): RoutineDayDraft {
  return {
    primary: schedule.week[day] ?? null,
    extras: [...(schedule.extras?.[day] ?? [])],
    times: { ...(schedule.times?.[day] ?? {}) },
  };
}

function keptDayTimes(draft: RoutineDayDraft): Record<string, string> {
  const held = new Set([draft.primary, ...draft.extras].filter(Boolean));
  return Object.fromEntries(Object.entries(draft.times).filter(([id, time]) => held.has(id) && time !== ''));
}

/** Promoting an extra keeps its own time and removes its duplicate entry. */
export function routinePrimary(draft: RoutineDayDraft, primary: string | null): RoutineDayDraft {
  const changed = { ...draft, primary, extras: draft.extras.filter((id) => id !== primary) };
  return { ...changed, times: keptDayTimes(changed) };
}

/** Replacing or removing an extra clears only that workout's time. */
export function routineExtra(draft: RoutineDayDraft, index: number, workoutId: string | null): RoutineDayDraft {
  const extras = [...draft.extras];
  if (workoutId === null) extras.splice(index, 1);
  else extras[index] = workoutId;
  const changed = { ...draft, extras };
  return { ...changed, times: keptDayTimes(changed) };
}

export function routineDayProblem(draft: RoutineDayDraft, workouts: readonly Workout[]): string | null {
  if (draft.extras.length > MAX_SCHEDULE_EXTRAS) return `Choose up to ${MAX_SCHEDULE_EXTRAS} separate workouts.`;
  const ids = [...(draft.primary ? [draft.primary] : []), ...draft.extras];
  const live = new Set(choosableWorkouts(workouts).map((workout) => workout.id));
  if (ids.some((id) => !id || !live.has(id))) return 'Choose a saved workout for each entry.';
  if (new Set(ids).size !== ids.length) return 'Each workout can appear only once on a day.';
  if (ids.some((id) => draft.times[id] && !SCHEDULE_TIME.test(draft.times[id]))) {
    return 'Use a time between 00:00 and 23:59, or leave it blank.';
  }
  return null;
}

/** Replace only this day, retaining siblings and every unrelated time.
 * Explicit empty extras/times maps are required to clear their final entry. */
export function routineWithDay(schedule: RoutineSchedule, day: Weekday, draft: RoutineDayDraft,
  workouts: readonly Workout[]): RoutineResult {
  const error = routineDayProblem(draft, workouts);
  if (error) return { ok: false, error };
  const extras = Object.fromEntries(Object.entries(schedule.extras ?? {}).map(([key, ids]) => [key, [...ids!]]));
  const times = Object.fromEntries(Object.entries(schedule.times ?? {}).map(([key, values]) => [key, { ...values }]));
  if (draft.extras.length) extras[day] = [...draft.extras];
  else delete extras[day];
  const dayTimes = keptDayTimes(draft);
  if (Object.keys(dayTimes).length) times[day] = dayTimes;
  else delete times[day];
  return { ok: true, schedule: { week: weekWith(schedule.week, day, draft.primary), extras, times } };
}

/** A new workout becomes the main workout only when that position is empty.
 * Otherwise it goes alongside; a full or already-held day is not rewritten. */
export function routineAddProblem(schedule: RoutineSchedule, day: Weekday, workoutId: string): string | null {
  const draft = routineDay(schedule, day);
  if (draft.primary === workoutId || draft.extras.includes(workoutId)) return 'Already on this day';
  if (draft.primary && draft.extras.length >= MAX_SCHEDULE_EXTRAS) return 'This day already has four separate workouts';
  return null;
}

export function routineAddingWorkout(schedule: RoutineSchedule, days: readonly Weekday[], workoutId: string,
  time: string, workouts: readonly Workout[]): RoutineResult {
  if (!days.length) return { ok: false, error: 'Choose at least one day.' };
  let next = schedule;
  for (const day of new Set(days)) {
    const problem = routineAddProblem(next, day, workoutId);
    if (problem) return { ok: false, error: problem };
    const draft = routineDay(next, day);
    if (draft.primary) draft.extras.push(workoutId);
    else draft.primary = workoutId;
    if (time) draft.times[workoutId] = time;
    const result = routineWithDay(next, day, draft, workouts);
    if (!result.ok) return result;
    next = result.schedule;
  }
  return { ok: true, schedule: next };
}

/**
 * The primary session a date assignment is checked against (slot 0). Its attempt is the token a write sends; 0 means
 * no row was seen.
 */
export function dateSession(sessions: readonly Session[], date: string): Session | undefined {
  return sessions
    .filter((session) => session.date === date && (session.slot ?? 0) === 0)
    .sort((a, b) => a.created_at - b.created_at || a.id.localeCompare(b.id))[0];
}

export const attemptOn = (sessions: readonly Session[], date: string): number => dateSession(sessions, date)?.attempt ?? 0;

/** Why this date can't take another workout or rest, or null when it can. */
export function dateChangeBlocked(date: string, today: string, cell: CalendarCell | undefined, sessions: readonly Session[]): string | null {
  if (date < today) return 'Past dates keep what happened.';
  const started = sessions.some((session) => session.date === date && (session.slot ?? 0) === 0
    && (session.status === 'in_progress' || session.status === 'completed'));
  if (started) return 'A workout was started on this date, so it can’t be changed or moved.';
  if (cell?.status === 'unavailable') return 'You’re away with no training on this date. Change your away dates to plan it.';
  return null;
}

/** Why a workout can't move from one date to another, or null. */
export function moveBlocked(args: {
  from: string;
  to: string;
  today: string;
  fromCell: CalendarCell | undefined;
  toCell: CalendarCell | undefined;
  sessions: readonly Session[];
}): string | null {
  const { from, to, today, fromCell, toCell, sessions } = args;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(to)) return 'Choose a date.';
  if (from === to) return 'Choose a different date.';
  const fromProblem = dateChangeBlocked(from, today, fromCell, sessions);
  if (fromProblem) return fromProblem;
  if (to < today) return 'Choose today or a later date.';
  const toProblem = dateChangeBlocked(to, today, toCell, sessions);
  if (toProblem) return toProblem;
  if (hasWorkout(toCell)) return 'That date already has a workout. Choose an empty date.';
  return null;
}

/** A date shows a strength workout (planned, from the routine, or under light travel). */
export function hasWorkout(cell: CalendarCell | undefined): boolean {
  return !!cell?.workout_id && cell.status !== 'rest' && cell.status !== 'unavailable' && cell.status !== 'skipped';
}

/** Workouts that can go on a weekday or a date: saved ones, not archived and
 * not made for one date only, in the plan's order. */
export function choosableWorkouts(workouts: readonly Workout[]): Workout[] {
  return workouts.filter((workout) => !workout.archived_at && !workout.one_time_date)
    .sort((a, b) => a.order_index - b.order_index);
}

// ---- away dates --------------------------------------------------------------

export const AWAY_KINDS = [
  { type: 'travel', label: 'Travel' },
  { type: 'rest', label: 'Rest' },
  { type: 'injury', label: 'Injury' },
  { type: 'other', label: 'Other' },
] as const;

export interface AwayDraft {
  start: string;
  end: string;
  type: Trip['type'];
  canTrain: boolean;
  note: string;
}

export const NOTE_LIMIT = 500;

export function awayDraft(trip: Trip | null, today: string): AwayDraft {
  if (!trip) return { start: today, end: today, type: 'travel', canTrain: true, note: '' };
  return {
    start: trip.start, end: trip.end < trip.start ? trip.start : trip.end,
    type: trip.type ?? 'other', canTrain: trip.can_train_light ?? true, note: trip.note ?? '',
  };
}

/**
 * The request fields: all of them for new away dates, only what changed for
 * an edit, so a coach's change to another field isn't overwritten.
 */
export function awayFields(draft: AwayDraft, original: Trip | null): { ok: true; fields: Record<string, unknown> } | { ok: false; error: string } {
  const valid = (date: string) => /^\d{4}-\d{2}-\d{2}$/.test(date);
  if (!valid(draft.start) || !valid(draft.end)) return { ok: false, error: 'Choose a first and last day.' };
  if (draft.end < draft.start) return { ok: false, error: 'The last day can’t be before the first day.' };
  const note = draft.note.trim();
  if (note.length > NOTE_LIMIT) return { ok: false, error: `Keep the note under ${NOTE_LIMIT} characters.` };
  if (!original) {
    return {
      ok: true,
      fields: { start: draft.start, end: draft.end, type: draft.type, can_train_light: draft.canTrain, ...(note ? { note } : {}) },
    };
  }
  const fields: Record<string, unknown> = {};
  if (draft.start !== original.start) fields.start = draft.start;
  if (draft.end !== original.end) fields.end = draft.end;
  if (draft.type !== (original.type ?? 'other')) fields.type = draft.type;
  if (draft.canTrain !== (original.can_train_light ?? true)) fields.can_train_light = draft.canTrain;
  if (note !== (original.note ?? '')) fields.note = note;
  return { ok: true, fields };
}

/** The weekdays a workout is on in the repeating week, as "Tue, Thu". Empty when it is on none. */
export function workoutWeekdays(schedule: WeeklySchedule | null | undefined, workoutId: string): string {
  if (!schedule) return '';
  const days = WEEKDAYS.filter((day) => schedule.week[day] === workoutId || (schedule.extras?.[day] ?? []).includes(workoutId));
  if (days.length === WEEKDAYS.length) return 'Every day';
  return days.map((day) => day[0]!.toUpperCase() + day.slice(1)).join(', ');
}

/** Away dates that haven't ended, soonest first, then the past ones, latest first. */
export function splitTrips(trips: readonly Trip[], today: string): { upcoming: Trip[]; past: Trip[] } {
  const sorted = [...trips].sort((a, b) => a.start.localeCompare(b.start) || a.end.localeCompare(b.end));
  return {
    upcoming: sorted.filter((trip) => trip.end >= today),
    past: sorted.filter((trip) => trip.end < today).reverse(),
  };
}

export function awayKindLabel(trip: Trip): string {
  const kind = AWAY_KINDS.find((entry) => entry.type === trip.type)?.label ?? 'Other';
  return (trip.can_train_light ?? true) ? kind : `${kind} · no training`;
}
