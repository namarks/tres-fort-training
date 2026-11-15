import { addDays, programWeekOn, weekPatternOn } from './calendarProjection';
import { parsePlanMeta, WEEKDAYS } from './types';
import type { PlanTree, SlotTargets, Weekday } from './types';

/**
 * Resolve the recurring weekly schedule to human-readable weekday → workout
 * name (null = rest), for coaching context.
 *
 * Pure projection of a plan tree the caller already holds: the schedule lives
 * in `plans.meta` and the names are on `tree.workouts`, so this needs no D1
 * read of its own. With a date, a block of weeks covering it wins (spec.md).
 */
export function resolvedScheduleNames(tree: PlanTree, date?: string): Record<Weekday, string | null> {
  const meta = parsePlanMeta(tree.meta);
  const week = date ? weekPatternOn(meta.schedule, meta.program, date).week : meta.schedule.week;
  const nameById = new Map(tree.workouts.filter(workout => workout.archived_at == null).map((workout) => [workout.id, workout.name]));
  const out = {} as Record<Weekday, string | null>;
  for (const weekday of WEEKDAYS) {
    const id = week[weekday];
    out[weekday] = id ? nameById.get(id) ?? null : null;
  }
  return out;
}

/**
 * Resolve each weekday's extras (activities done alongside the main workout,
 * such as morning stretching) to their names. Weekdays without live extras
 * are left out, so a plan that never used extras yields `{}`.
 */
export function resolvedScheduleExtras(tree: PlanTree, date?: string): Partial<Record<Weekday, string[]>> {
  const meta = parsePlanMeta(tree.meta);
  const extras = (date ? weekPatternOn(meta.schedule, meta.program, date).extras : meta.schedule.extras) ?? {};
  // Only activities count as extras; one that gained exercises is left out.
  const nameById = new Map(tree.workouts
    .filter(workout => workout.archived_at == null)
    .map((workout) => [workout.id, workout.name]));
  const out: Partial<Record<Weekday, string[]>> = {};
  for (const weekday of WEEKDAYS) {
    const names = (extras[weekday] ?? []).flatMap(id => {
      const name = nameById.get(id);
      return name ? [name] : [];
    });
    if (names.length) out[weekday] = names;
  }
  return out;
}

/**
 * Each weekday's set times by workout name ("Core before bed" → "21:00").
 * Weekdays and items without a time are left out, so a plan without times
 * yields `{}`.
 */
export function resolvedScheduleTimes(tree: PlanTree): Partial<Record<Weekday, Record<string, string>>> {
  const times = parsePlanMeta(tree.meta).schedule.times ?? {};
  const nameById = new Map(tree.workouts
    .filter(workout => workout.archived_at == null)
    .map((workout) => [workout.id, workout.name]));
  const out: Partial<Record<Weekday, Record<string, string>>> = {};
  for (const weekday of WEEKDAYS) {
    const named: Record<string, string> = {};
    for (const [id, time] of Object.entries(times[weekday] ?? {})) {
      const name = nameById.get(id);
      if (name) named[name] = time;
    }
    if (Object.keys(named).length) out[weekday] = named;
  }
  return out;
}

/** Where a date falls in the plan's block of weeks, for coaching context:
 * "Week 6 of 16 · Build". Null when no block covers the date. */
export function programWeekSummary(tree: PlanTree, date: string): {
  name?: string; week: number; of: number; label?: string; repeat: boolean;
  targets?: Array<{ slot_id: string; workout: string; exercise: string } & SlotTargets>;
} | null {
  const program = parsePlanMeta(tree.meta).program;
  const index = programWeekOn(program ?? null, date);
  if (!program || index == null) return null;
  const { label, targets } = program.weeks[index]!;
  // This week's targets by name, for slots still in a live workout.
  const changed = Object.entries(targets ?? {}).flatMap(([slotId, fields]) => {
    for (const workout of tree.workouts) {
      if (workout.archived_at != null) continue;
      const slot = workout.exercises.find((exercise) => exercise.id === slotId);
      if (slot) return [{ slot_id: slotId, workout: workout.name, exercise: slot.exercise_name, ...fields }];
    }
    return [];
  });
  return { ...(program.name ? { name: program.name } : {}), week: index + 1, of: program.weeks.length,
    ...(label ? { label } : {}), repeat: program.repeat, ...(changed.length ? { targets: changed } : {}) };
}

/** Days back a coach view still lists a one-time workout, so the coach can
 * read one the member did yesterday; older ones stay in history only. */
const ONE_TIME_LOOKBACK_DAYS = 7;

/**
 * Split workouts into the library and one-time workouts (workout-library
 * P3) for coaching views. A one-time workout is made for one date; the coach
 * must not copy it into `update_plan` or the schedule, so it is listed
 * separately: live ones dated from a week before `today` on, by date.
 */
export function splitOneTimeWorkouts<T extends { one_time_date?: string | null; archived_at?: number | null }>(
  workouts: T[], today: string,
): { library: T[]; oneTime: T[] } {
  const from = addDays(today, -ONE_TIME_LOOKBACK_DAYS);
  return {
    library: workouts.filter((workout) => workout.one_time_date == null),
    oneTime: workouts
      .filter((workout) => workout.one_time_date != null && workout.archived_at == null
        && workout.one_time_date >= from)
      .sort((a, b) => a.one_time_date!.localeCompare(b.one_time_date!)),
  };
}
