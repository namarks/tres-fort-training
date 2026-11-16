// A block beside the repeating week, as the Block tab edits it
// (docs/plans/web-app P2). The server stores each block week as the whole
// day; here a layered block is edited as only what it owns ("own form"),
// and the repeating week is laid back over it for anything shown as a
// calendar day. Pure; rules shared with the Worker in src/programLayers.ts.
import { dayEntries, isLayered, layerProgram, standingOn, type WeekPattern } from '../../src/programLayers';
import { applySlotTargets } from '../../src/programTargets';
import {
  MAX_PROGRAM_NAME,
  MAX_PROGRAM_WEEKS,
  MAX_SCHEDULE_EXTRAS,
  WEEKDAYS,
  type ProgramWeek,
  type ScheduleWeek,
  type TrainingProgram,
  type Weekday,
  type WeeklySchedule,
} from '../../src/types';
import { editableFields, liveWorkouts, programBody, workoutsInBlock, type ProgramBody } from './blocks';
import { parseRunSteps, RUN_EXERCISE_ID, type RunPlanItem, type RunStep } from '../../src/runSteps';
import { describeDistance, formatClock, WEEKDAY_LABELS, type Slot, type Workout } from './model';

export { isLayered };

const EMPTY: WeekPattern = { week: { mon: null, tue: null, wed: null, thu: null, fri: null, sat: null, sun: null } };

/** A week with one day's entries replaced: the first is the main workout. */
function withDay(week: ProgramWeek, day: Weekday, entries: readonly string[]): ProgramWeek {
  const extras = { ...(week.extras ?? {}) };
  const rest = entries.slice(1, 1 + MAX_SCHEDULE_EXTRAS);
  if (rest.length > 0) extras[day] = rest;
  else delete extras[day];
  const next: ProgramWeek = { ...week, week: { ...week.week, [day]: entries[0] ?? null } };
  if (Object.keys(extras).length > 0) next.extras = extras;
  else delete next.extras;
  return next;
}

/**
 * The saved block as only what it owns: each day without what the repeating
 * week put there. A block that doesn't list its workouts owns its whole
 * weeks and is returned as it is.
 */
export function ownForm(program: TrainingProgram | ProgramBody, schedule: WeekPattern): ProgramBody {
  const body = programBody(program);
  if (!Array.isArray(body.workout_ids)) return body;
  const blockIds = new Set(body.workout_ids);
  const weeks = body.weeks.map((week) => WEEKDAYS.reduce((next, day) => {
    const repeating = dayEntries(schedule, day);
    return withDay(next, day, dayEntries(week, day).filter((id) => blockIds.has(id) || !repeating.includes(id)));
  }, week));
  return programBody({ ...body, weeks });
}

/** A block in own form shown as whole days: the repeating week laid over it. */
export function wholeDays<P extends ProgramBody>(program: P, schedule: WeekPattern): P {
  if (!Array.isArray(program.workout_ids)) return program;
  return layerProgram({ ...program, id: 'draft' } as TrainingProgram, EMPTY, schedule) as unknown as P;
}

/** Ids the block places anywhere (own form), in the order they first appear. */
function placedIds(program: ProgramBody): string[] {
  const ids: string[] = [];
  for (const week of program.weeks) {
    for (const day of WEEKDAYS) {
      for (const id of dayEntries(week, day)) if (!ids.includes(id)) ids.push(id);
    }
  }
  return ids;
}

/** The block's own workouts for the Block tab's rows (own form): listed
 * ones first, in list order, then anything else a week holds. */
export function blockWorkouts(program: ProgramBody, workouts: readonly Workout[]): Workout[] {
  if (!Array.isArray(program.workout_ids)) return workoutsInBlock(program, workouts);
  const live = liveWorkouts(workouts);
  const placed = placedIds(program);
  const ids = [...program.workout_ids.filter((id) => placed.includes(id)), ...placed.filter((id) => !program.workout_ids!.includes(id))];
  return ids.flatMap((id) => live.get(id) ?? []);
}

/** The weekdays a workout is on in one week (own form). */
export function daysIn(program: ProgramBody, index: number, workoutId: string): Weekday[] {
  const week = program.weeks[index];
  return week ? WEEKDAYS.filter((day) => dayEntries(week, day).includes(workoutId)) : [];
}

/** The weekdays a workout is on across the block, and whether weeks differ. */
export function blockDays(program: ProgramBody, workoutId: string): { days: Weekday[]; varies: boolean } {
  const perWeek = program.weeks.map((_, index) => daysIn(program, index, workoutId));
  const shapes = new Set(perWeek.map((days) => days.join(',')));
  return { days: WEEKDAYS.filter((day) => perWeek.some((days) => days.includes(day))), varies: shapes.size > 1 };
}

export function daysLabel(days: readonly Weekday[]): string {
  if (days.length === 0) return 'No day';
  if (days.length === 7) return 'Every day';
  return days.map((day) => WEEKDAY_LABELS[day].slice(0, 3)).join(', ');
}

/** Whether a day in any week has no room for one more of the block's own. */
export function dayFull(program: ProgramBody, day: Weekday, workoutId: string): boolean {
  return program.weeks.some((week) => {
    const entries = dayEntries(week, day);
    return !entries.includes(workoutId) && entries.length > MAX_SCHEDULE_EXTRAS;
  });
}

/** The weekdays among `days` where some week has no room for the workout:
 * putting it on all of `days` in every week would drop it there. */
export function fullDays(program: ProgramBody, workoutId: string, days: readonly Weekday[]): Weekday[] {
  return WEEKDAYS.filter((day) => days.includes(day) && dayFull(program, day, workoutId));
}

/** A workout put on exactly these weekdays in every week (own form). The
 * rest of each day stays; a day's first workout is its main one. */
export function placingOn<P extends ProgramBody>(program: P, workoutId: string, days: readonly Weekday[]): P {
  const weeks = program.weeks.map((week) => WEEKDAYS.reduce((next, day) => {
    const entries = dayEntries(next, day);
    const has = entries.includes(workoutId);
    if (days.includes(day) === has) return next;
    return withDay(next, day, has ? entries.filter((id) => id !== workoutId) : [...entries, workoutId]);
  }, week));
  return { ...program, weeks };
}

/** One more workout in the block, on these weekdays in every week. */
export function addingToBlock<P extends ProgramBody>(program: P, workoutId: string, days: readonly Weekday[]): P {
  const listed = Array.isArray(program.workout_ids) && !program.workout_ids.includes(workoutId)
    ? { ...program, workout_ids: [...program.workout_ids, workoutId] } : program;
  return placingOn(listed, workoutId, days);
}

/** A workout taken out of the block: off every week and the list, with the
 * targets the weeks gave its exercises. */
export function removingFromBlock<P extends ProgramBody>(program: P, workout: Pick<Workout, 'id' | 'exercises'>): P {
  const slots = new Set(workout.exercises.map((slot) => slot.id));
  const cleared = placingOn(program, workout.id, []);
  const weeks = cleared.weeks.map((week) => {
    if (!week.targets) return week;
    const targets = Object.fromEntries(Object.entries(week.targets).filter(([id]) => !slots.has(id)));
    const next = { ...week };
    if (Object.keys(targets).length > 0) next.targets = targets;
    else delete next.targets;
    return next;
  });
  return { ...cleared, weeks,
    ...(Array.isArray(program.workout_ids) ? { workout_ids: program.workout_ids.filter((id) => id !== workout.id) } : {}) };
}

/** The repeating week without the block's own workouts, as `PUT
 * /api/plan/program` takes it beside the block; null when it holds none.
 * Times are left out: the server keeps each saved one that its weekday,
 * in the week or in a block week, still holds, so a block workout moved
 * to another day never sends a time for a day it has left. */
export function trimmedSchedule(
  schedule: WeeklySchedule, workoutIds: readonly string[] | undefined,
): Pick<WeeklySchedule, 'week' | 'extras'> | null {
  const blockIds = new Set(workoutIds ?? []);
  if (!WEEKDAYS.some((day) => dayEntries(schedule, day).some((id) => blockIds.has(id)))) return null;
  const week = {} as ScheduleWeek;
  const extras: NonNullable<WeeklySchedule['extras']> = {};
  for (const day of WEEKDAYS) {
    const main = schedule.week[day];
    week[day] = main && !blockIds.has(main) ? main : null;
    const kept = (schedule.extras?.[day] ?? []).filter((id) => !blockIds.has(id));
    if (kept.length > 0) extras[day] = kept;
  }
  return { week, extras };
}

/** What the member does every week beside the block: each workout the
 * repeating week holds that the block doesn't own, with its weekdays. */
export function besideBlock(
  program: ProgramBody, schedule: WeeklySchedule, workouts: readonly Workout[],
): { workout: Workout; days: Weekday[] }[] {
  const live = liveWorkouts(workouts);
  const asProgram = { ...program, id: 'draft' } as TrainingProgram;
  const byId = new Map<string, Weekday[]>();
  for (const day of WEEKDAYS) {
    for (const id of standingOn(asProgram, schedule, day)) byId.set(id, [...(byId.get(id) ?? []), day]);
  }
  return [...byId].flatMap(([id, days]) => {
    const workout = live.get(id);
    return workout ? [{ workout, days }] : [];
  });
}

/** Workouts ticked by default when a block starts: each weekday's main
 * workout that has exercises. Activities, and anything that sits beside
 * another workout on some day (nightly core), stay every week unless ticked. */
export function suggestedBlockWorkouts(schedule: WeekPattern, workouts: readonly Workout[]): string[] {
  const live = liveWorkouts(workouts);
  const beside = new Set(WEEKDAYS.flatMap((day) => schedule.extras?.[day] ?? []));
  const ids: string[] = [];
  for (const day of WEEKDAYS) {
    const main = schedule.week[day];
    if (main && !ids.includes(main) && !beside.has(main) && (live.get(main)?.exercises.length ?? 0) > 0) ids.push(main);
  }
  return ids;
}

/** For a block that doesn't list its workouts yet: the ones it clearly
 * trains (a week gives them targets, or puts them where the repeating week
 * doesn't), else the suggestion a new block gets. */
export function suggestedSorting(program: ProgramBody, schedule: WeekPattern, workouts: readonly Workout[]): string[] {
  const live = liveWorkouts(workouts);
  const targeted = new Set(program.weeks.flatMap((week) => Object.keys(week.targets ?? {})));
  const ids: string[] = [];
  for (const workout of workoutsInBlock(program, workouts)) {
    if (!live.has(workout.id)) continue;
    const hasTargets = workout.exercises.some((slot) => targeted.has(slot.id));
    const placedApart = program.weeks.some((week) => WEEKDAYS.some((day) =>
      dayEntries(week, day).includes(workout.id) && !dayEntries(schedule, day).includes(workout.id)));
    if (hasTargets || placedApart) ids.push(workout.id);
  }
  return ids.length > 0 ? ids : suggestedBlockWorkouts(schedule, workouts).filter((id) => placedIds(program).includes(id));
}

/** A block that lists `picked` as its own, from one that listed none: each
 * week keeps only those workouts, where it had them. A workout left out
 * follows the repeating week from then on, wherever the old block put it,
 * and keeps none of the targets the weeks gave it, as when it is removed
 * from a block: they would still apply, with nowhere to change them. */
export function sortingBlock(program: ProgramBody, picked: readonly string[], workouts: readonly Workout[]): ProgramBody {
  const left = new Set(workouts.filter((workout) => !picked.includes(workout.id)).flatMap((workout) => workout.exercises.map((slot) => slot.id)));
  const weeks = program.weeks.map((week) => {
    const next = WEEKDAYS.reduce((kept, day) => withDay(kept, day, dayEntries(week, day).filter((id) => picked.includes(id))), week);
    if (!next.targets) return next;
    const targets = Object.fromEntries(Object.entries(next.targets).filter(([id]) => !left.has(id)));
    if (Object.keys(targets).length > 0) next.targets = targets;
    else delete next.targets;
    return next;
  });
  return programBody({ ...program, weeks, workout_ids: [...picked] });
}

/** Most workouts one day holds: its main one and the ones beside it. */
export const MAX_DAY_WORKOUTS = 1 + MAX_SCHEDULE_EXTRAS;

/** A new block's own workouts on one weekday: the ticked ones the repeating
 * week holds there, in its order, then the ones added for the block. */
export function newBlockDay(
  schedule: WeekPattern, picked: readonly string[], added: readonly { id: string; day: Weekday }[], day: Weekday,
): string[] {
  const entries = dayEntries(schedule, day).filter((id) => picked.includes(id));
  for (const entry of added) if (entry.day === day && !entries.includes(entry.id)) entries.push(entry.id);
  return entries;
}

/** A new block of `weeks` equal weeks holding only its own workouts: the
 * ticked ones on the weekdays the repeating week has them, plus any added. */
export function newLayeredBlock(
  schedule: WeekPattern,
  workouts: readonly Workout[],
  options: { start: string; weeks: number; repeat: boolean; name?: string;
    picked: readonly string[]; added?: readonly { id: string; day: Weekday }[] },
): ProgramBody {
  const live = liveWorkouts(workouts);
  const picked = options.picked.filter((id) => live.has(id));
  const added = (options.added ?? []).filter((entry) => live.has(entry.id));
  let week: ProgramWeek = { week: { ...EMPTY.week } };
  for (const day of WEEKDAYS) {
    week = withDay(week, day, newBlockDay(schedule, picked, added, day));
  }
  const ids = [...picked, ...added.map((entry) => entry.id)].filter((id, index, all) => all.indexOf(id) === index);
  const count = Math.min(Math.max(Math.round(options.weeks), 1), MAX_PROGRAM_WEEKS);
  const name = options.name?.trim();
  return {
    ...(name ? { name: name.slice(0, MAX_PROGRAM_NAME) } : {}),
    start: options.start,
    repeat: options.repeat,
    weeks: Array.from({ length: count }, () => structuredClone(week)),
    workout_ids: ids.filter((id) => WEEKDAYS.some((day) => dayEntries(week, day).includes(id))),
  };
}

/** The exercise a workout's week-by-week line is read from: the first that
 * a week changes, else its first working exercise. */
export function headlineSlot(workout: Workout, program: ProgramBody): Slot | undefined {
  const slots = workout.exercises as Slot[];
  const changed = slots.find((slot) => program.weeks.some((week) => week.targets?.[slot.id] !== undefined));
  return changed ?? slots.find((slot) => !slot.is_warmup) ?? slots[0];
}

/** "25 min" for whole minutes, else a clock like "1:30". */
function shortTime(seconds: number): string {
  return seconds >= 60 && seconds % 60 === 0 ? `${seconds / 60} min` : formatClock(seconds);
}

function stepAmount(step: RunStep, miles: boolean): string {
  if (step.duration_s !== undefined) return shortTime(step.duration_s);
  return step.distance_m !== undefined ? describeDistance(step.distance_m, miles) : '';
}

/** A planned run in a few words: its repeats ("5 × 800 m"), else the
 * running it asks for ("25 min", "6.5 mi"), without warm-up or recovery. */
function runHeadline(items: readonly RunPlanItem[], miles: boolean): string {
  for (const item of items) {
    if (!('repeat' in item)) continue;
    const work = item.steps.find((step) => step.kind === 'work') ?? item.steps[0];
    if (work) return `${item.repeat} × ${stepAmount(work, miles)}`;
  }
  const steps = items.filter((item): item is RunStep => !('repeat' in item));
  const work = steps.filter((step) => step.kind === 'work');
  const counted = work.length > 0 ? work : steps;
  if (counted.length === 0) return '';
  if (counted.every((step) => step.duration_s !== undefined)) return shortTime(counted.reduce((sum, step) => sum + step.duration_s!, 0));
  if (counted.every((step) => step.distance_m !== undefined)) return describeDistance(counted.reduce((sum, step) => sum + step.distance_m!, 0), miles);
  return stepAmount(counted[0]!, miles) + (counted.length > 1 ? ` +${counted.length - 1}` : '');
}

/** What a workout asks for in one week of the block, in a few words: its
 * headline exercise with that week's targets ("3 × 8 @ 135 lb", "25 min").
 * Rest and effort stay in the workout. Empty for an activity. */
export function weekHeadline(workout: Workout, program: ProgramBody, index: number, miles: boolean): string {
  const slot = headlineSlot(workout, program);
  if (!slot) return '';
  const applied = applySlotTargets(slot, program.weeks[index]?.targets?.[slot.id]);
  const run = applied.run_steps ? parseRunSteps(applied.run_steps) : null;
  if (run?.ok) return runHeadline(run.items, miles);
  if (applied.target_duration_s) {
    const time = shortTime(applied.target_duration_s);
    return applied.target_sets > 1 ? `${applied.target_sets} × ${time}` : time;
  }
  const reps = applied.target_reps_max && applied.target_reps_max > applied.target_reps
    ? `${applied.target_reps}–${applied.target_reps_max}` : `${applied.target_reps}`;
  const load = applied.target_weight != null
    ? ` @ ${Math.round(applied.target_weight * 100) / 100} ${applied.target_weight_unit ?? 'lb'}` : '';
  return `${applied.target_sets} × ${reps}${load}`;
}

/** Which exercise the headline reads, for the table's small print. */
export function headlineName(workout: Workout, program: ProgramBody): string | null {
  const slot = headlineSlot(workout, program);
  return slot && workout.exercises.length > 1 ? slot.exercise_name : null;
}

/** A planned run, whose weeks change its steps. */
export function isPlannedRun(slot: Slot | undefined): slot is Slot {
  return !!slot && slot.exercise_id === RUN_EXERCISE_ID && !!slot.run_steps;
}

/** Whether the workout has anything a week can change on the web. */
export function hasWeekTargets(workout: Workout): boolean {
  return (workout.exercises as Slot[]).some((slot) => isPlannedRun(slot) || editableFields(slot).length > 0);
}
