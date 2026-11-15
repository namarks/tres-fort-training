import { addDays } from '../../src/calendarProjection';
import type { StateResponse } from './api';
import { calendarInputs, plannedExtraWorkouts, projectRange, scheduleTimeOn } from './model';

// The public installation URL used by website/home.mjs, and the existing
// navigation-only Today link used by the iOS widget. Neither starts a session.
export const IPHONE_APP_URL = 'https://apps.apple.com/us/app/id6772375823';
export const OPEN_TODAY_URL = 'tresfort://today';

export interface UpcomingWorkout {
  id: string;
  name: string;
  time: string | null;
  started: boolean;
}

/** Read the same dated projection as Calendar, including blocks, date
 * overrides, trips and independently completed additional sessions. */
export function nextPlannedDay(state: StateResponse, today: string): { date: string; workouts: UpcomingWorkout[] } | null {
  const inputs = calendarInputs(state);
  if (!inputs || !state.plan) return null;
  const workouts = new Map(state.plan.workouts.map(workout => [workout.id, workout]));
  const cells = projectRange(inputs, today, addDays(today, 13), today);
  for (const [date, cell] of cells) {
    const entries: UpcomingWorkout[] = [];
    const add = (id: string | null, status: string) => {
      if (!id || entries.some(entry => entry.id === id)) return;
      const workout = workouts.get(id);
      if (!workout || workout.archived_at) return;
      entries.push({ id, name: workout.name, started: status === 'in_progress',
        time: status === 'in_progress' ? null : scheduleTimeOn(state.plan!.schedule, id, date) });
    };
    if (['projected', 'planned', 'in_progress', 'light'].includes(cell.status)) add(cell.workout_id, cell.status);
    for (const session of cell.sessions ?? []) {
      if (session.status === 'planned' || session.status === 'in_progress') add(session.workout_id, session.status);
    }
    for (const extra of plannedExtraWorkouts(cell, workouts)) add(extra.id, 'projected');
    if (entries.length) {
      entries.sort((a, b) => Number(b.started) - Number(a.started) || (a.time ?? '24:00').localeCompare(b.time ?? '24:00'));
      return { date, workouts: entries };
    }
  }
  return null;
}
