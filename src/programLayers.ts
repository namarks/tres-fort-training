// A training block beside the repeating week (docs/plans/web-app P2, owner
// direction 2026-11-16). A block that lists its own workouts
// (`program.workout_ids`) is "layered": what the member does every week
// (`meta.schedule`) carries on during the block, and the block adds its own
// workouts to the same dates.
//
// Every client reads a block week as the whole day (`weekPatternOn`, mirrored
// in Swift and read directly by released iPhone builds), so a layered block's
// stored weeks hold both: the block's own entries first, then the repeating
// week's. `layerProgram` rewrites that stored form whenever the plan's meta
// is written, so a change to the repeating week reaches every block week
// without touching what the block owns. A block without `workout_ids` is
// left exactly as stored and replaces the repeating week, as before.
//
// Pure, with no runtime import from types.ts (which calls this when it
// serializes meta).
import type { ProgramWeek, ScheduleExtras, ScheduleWeek, TrainingProgram, Weekday, WeeklySchedule } from './types';

const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const satisfies readonly Weekday[];

/** Activities a weekday holds beside its main workout (types.ts re-exports
 * this as MAX_SCHEDULE_EXTRAS). */
export const MAX_DAY_EXTRAS = 4;

export type WeekPattern = Pick<WeeklySchedule, 'week' | 'extras'>;

/** A block that lists its own workouts, so the repeating week shows beside it. */
export function isLayered(program: TrainingProgram | null | undefined): program is TrainingProgram & { workout_ids: string[] } {
  return Array.isArray(program?.workout_ids);
}

/** What a weekday holds in a pattern: its main workout, then the rest. */
export function dayEntries(pattern: WeekPattern, day: Weekday): string[] {
  const main = pattern.week[day];
  return [...(main ? [main] : []), ...(pattern.extras?.[day] ?? [])];
}

/** Stored `workout_ids`: non-empty strings without repeats. Undefined unless
 * an array, so a block that never listed its workouts stays unlayered. */
export function normalizeWorkoutIds(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const ids: string[] = [];
  for (const id of value) {
    if (typeof id === 'string' && id.length > 0 && !ids.includes(id)) ids.push(id);
  }
  return ids;
}

/**
 * Whether an entry stored on a block day is the block's own. The block's
 * listed workouts always are. So is anything the repeating week doesn't hold
 * on that weekday: a client that doesn't know the list put it there, and it
 * is never dropped.
 */
function ownIn(blockIds: ReadonlySet<string>, repeating: readonly string[]): (id: string) => boolean {
  return (id) => blockIds.has(id) || !repeating.includes(id);
}

/** One stored day of a layered block, split into what the block owns and
 * what comes from the repeating week it was last written against. */
export function splitBlockDay(
  program: TrainingProgram, schedule: WeekPattern, index: number, day: Weekday,
): { own: string[]; standing: string[] } {
  const week = program.weeks[index];
  if (!week) return { own: [], standing: [] };
  const stored = dayEntries(week, day);
  if (!isLayered(program)) return { own: stored, standing: [] };
  const own = ownIn(new Set(program.workout_ids), dayEntries(schedule, day));
  return { own: stored.filter(own), standing: stored.filter((id) => !own(id)) };
}

/** What the repeating week adds to a layered block's day: everything it
 * holds that weekday except the block's own workouts, which the block places. */
export function standingOn(program: TrainingProgram, schedule: WeekPattern, day: Weekday): string[] {
  const blockIds = new Set(isLayered(program) ? program.workout_ids : []);
  return dayEntries(schedule, day).filter((id) => !blockIds.has(id));
}

/**
 * The block with every week rewritten for the repeating week `after`, given
 * the repeating week its stored days were written against (`before`). Each
 * day keeps the block's own entries and takes the rest from `after`:
 *
 *   main   = the block's own main workout, else the repeating week's
 *   extras = the block's own extras, then the repeating week's main (when
 *            the block has its own) and extras, without repeats, at most
 *            MAX_DAY_EXTRAS (the repeating week's are the ones cut)
 *
 * A block that doesn't list its workouts is returned unchanged.
 */
export function layerProgram(
  program: TrainingProgram, before: WeekPattern, after: WeekPattern,
): TrainingProgram {
  if (!isLayered(program)) return program;
  const blockIds = new Set(program.workout_ids);
  const weeks = program.weeks.map((stored): ProgramWeek => {
    const week = {} as ScheduleWeek;
    const extras: ScheduleExtras = {};
    for (const day of DAYS) {
      const own = ownIn(blockIds, dayEntries(before, day));
      const storedMain = stored.week[day] ?? null;
      const ownMain = storedMain && own(storedMain) ? storedMain : null;
      const afterMain = after.week[day] ?? null;
      const standingMain = afterMain && !blockIds.has(afterMain) ? afterMain : null;
      const main = ownMain ?? standingMain;
      week[day] = main;
      const rest: string[] = [];
      for (const id of [
        ...(stored.extras?.[day] ?? []).filter(own),
        ...(ownMain && standingMain ? [standingMain] : []),
        ...(after.extras?.[day] ?? []).filter((id) => !blockIds.has(id)),
      ]) {
        if (id !== main && !rest.includes(id) && rest.length < MAX_DAY_EXTRAS) rest.push(id);
      }
      if (rest.length > 0) extras[day] = rest;
    }
    return {
      ...(stored.label ? { label: stored.label } : {}),
      week,
      ...(Object.keys(extras).length > 0 ? { extras } : {}),
      ...(stored.targets ? { targets: stored.targets } : {}),
    };
  });
  return { ...program, weeks };
}

/** The listed workouts a block still places somewhere, in their saved order. */
export function placedWorkoutIds(workoutIds: readonly string[], weeks: readonly WeekPattern[]): string[] {
  const placed = new Set(weeks.flatMap((week) => DAYS.flatMap((day) => dayEntries(week, day))));
  return workoutIds.filter((id) => placed.has(id));
}

/** Each weekday's entries across every week of a block: what a reminder
 * time may belong to besides the repeating week's own. */
export function programHeld(program: TrainingProgram | null | undefined): Partial<Record<Weekday, Set<string>>> {
  const held: Partial<Record<Weekday, Set<string>>> = {};
  for (const week of program?.weeks ?? []) {
    for (const day of DAYS) {
      for (const id of dayEntries(week, day)) (held[day] ??= new Set()).add(id);
    }
  }
  return held;
}
