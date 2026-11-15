import type { OneDateWorkoutRequest, StateResponse } from './api';
import { calendarInputs, projectRange } from './model';
import { attemptOn, dateChangeBlocked } from './scheduling';

export interface DateWorkoutSelection { date: string; workoutId: string; primary: boolean }
export interface PendingDateEdit {
  request: OneDateWorkoutRequest;
  expectedAttempt: number;
  phase: 'copy' | 'place' | 'complete';
}
export type StoredDateEdit = PendingDateEdit | 'unreadable' | null;
type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
const key = (accountId: string) => `tresfort.pendingDateEdit.v1.${encodeURIComponent(accountId)}`;

export function dateEditProblem(selection: DateWorkoutSelection, state: StateResponse, today: string): string | null {
  if (!selection.primary) return 'This date only is available for the main workout. A separate workout can currently be edited only as a saved workout, which changes it on every date.';
  const inputs = calendarInputs(state);
  const cell = inputs ? projectRange(inputs, selection.date, selection.date, today).get(selection.date) : undefined;
  const blocked = dateChangeBlocked(selection.date, today, cell, state.sessions);
  if (blocked) return blocked;
  if (!state.plan || cell?.workout_id !== selection.workoutId) return 'The workout on this date changed. Close this choice and review the date again.';
  return null;
}

export function newDateEdit(selection: DateWorkoutSelection, state: StateResponse, today: string,
  uuid: () => string = () => crypto.randomUUID()): PendingDateEdit | null {
  if (dateEditProblem(selection, state, today)) return null;
  const plan = state.plan!;
  const workout = plan.workouts.find(workout => workout.id === selection.workoutId);
  if (!workout || workout.archived_at || workout.one_time_date) return null;
  return { request: { id: uuid(), name: workout.name, one_time_date: selection.date, copy_from: workout.id,
    expected_plan_id: plan.id, expected_version: plan.version }, expectedAttempt: attemptOn(state.sessions, selection.date), phase: 'copy' };
}

export function readDateEdit(storage: StorageLike, accountId: string): StoredDateEdit {
  try {
    const raw = storage.getItem(key(accountId));
    if (!raw) return null;
    const value = JSON.parse(raw) as PendingDateEdit, r = value?.request;
    return r && typeof r.id === 'string' && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(r.id)
      && typeof r.name === 'string' && r.name.trim() && typeof r.copy_from === 'string' && r.copy_from
      && typeof r.one_time_date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(r.one_time_date)
      && typeof r.expected_plan_id === 'string' && r.expected_plan_id
      && Number.isSafeInteger(r.expected_version) && r.expected_version > 0
      && Number.isSafeInteger(value.expectedAttempt) && value.expectedAttempt >= 0
      && ['copy', 'place', 'complete'].includes(value.phase) ? value : 'unreadable';
  } catch { return 'unreadable'; }
}

/** An unmounted request cannot clear another request or downgrade its ACK. */
export function retainDateEdit(storage: StorageLike, accountId: string, expectedId: string | null,
  next: PendingDateEdit | null): boolean {
  try {
    const current = readDateEdit(storage, accountId);
    if (current === 'unreadable' || (current?.request.id ?? null) !== expectedId) return false;
    const order = { copy: 0, place: 1, complete: 2 };
    if (current && next && order[next.phase] < order[current.phase]) return false;
    if (next) storage.setItem(key(accountId), JSON.stringify(next));
    else storage.removeItem(key(accountId));
    return true;
  } catch { return false; }
}

export function assignedDateCopy(pending: PendingDateEdit, state: StateResponse): boolean {
  return state.plan?.id === pending.request.expected_plan_id
    && state.plan.workouts.some(workout => workout.id === pending.request.id && workout.one_time_date === pending.request.one_time_date)
    && state.sessions.some(session => session.date === pending.request.one_time_date && (session.slot ?? 0) === 0
      && session.workout_id === pending.request.id && ['planned', 'in_progress', 'completed'].includes(session.status));
}
