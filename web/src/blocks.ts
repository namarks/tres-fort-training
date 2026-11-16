// The web block designer (docs/plans/progressive-plans P4): a block of weeks
// laid out as a grid, any mix of workouts, with targets changed week by week
// and a ramp that grows any target. Pure; every edit returns a whole program
// for one PUT /api/plan/program at the version on screen. The run builders
// stay in the app; nothing here needs AI.
import { addDays, programWeekOn, weekdayOf } from '../../src/calendarProjection';
import { parseRunSteps, RUN_EXERCISE_ID, type RunPlanItem } from '../../src/runSteps';
import {
  MAX_PROGRAM_LABEL,
  MAX_PROGRAM_NAME,
  MAX_PROGRAM_WEEKS,
  MAX_SCHEDULE_EXTRAS,
  WEEKDAYS,
  type ProgramWeek,
  type ScheduleExtras,
  type ScheduleWeek,
  type SlotTargets,
  type TrainingProgram,
  type Weekday,
  type WeeklySchedule,
} from '../../src/types';
import { convertWeight, type WeightUnit } from './editing';
import type { Slot, Workout } from './model';

export { MAX_PROGRAM_WEEKS };

/** The body `PUT /api/plan/program` takes: the program without its id. */
export type ProgramBody = Omit<TrainingProgram, 'id'>;

export function programBody(program: TrainingProgram | ProgramBody): ProgramBody {
  const name = program.name?.trim();
  return {
    ...(name ? { name: name.slice(0, MAX_PROGRAM_NAME) } : {}),
    start: program.start,
    repeat: program.repeat,
    weeks: program.weeks.map((week) => ({
      ...(week.label?.trim() ? { label: week.label.trim().slice(0, MAX_PROGRAM_LABEL) } : {}),
      week: week.week,
      ...(week.extras && Object.keys(week.extras).length > 0 ? { extras: week.extras } : {}),
      ...(week.targets && Object.keys(week.targets).length > 0 ? { targets: week.targets } : {}),
    })),
    // The block's own workouts; present, the repeating week carries on beside it.
    ...(Array.isArray(program.workout_ids) ? { workout_ids: [...program.workout_ids] } : {}),
  };
}

// ---- dates -----------------------------------------------------------------

/** The Monday on or before a date. */
export function mondayOnOrBefore(date: string): string {
  return addDays(date, -WEEKDAYS.indexOf(weekdayOf(date)));
}

/** Mondays a new block can start on: this week's and the next few. */
export function startChoices(today: string, count = 8): string[] {
  const first = mondayOnOrBefore(today);
  return Array.from({ length: count }, (_, index) => addDays(first, index * 7));
}

/** The Monday that starts week `index` of the block's first run. */
export function weekStart(program: Pick<TrainingProgram, 'start'>, index: number): string {
  return addDays(program.start, index * 7);
}

/** Week index today falls in, or null outside the block. */
export function currentWeek(program: TrainingProgram, today: string): number | null {
  return programWeekOn(program, today);
}

// ---- days ------------------------------------------------------------------

/** Live saved workouts (not archived, not made for one date), by id. */
export function liveWorkouts(workouts: readonly Workout[]): Map<string, Workout> {
  return new Map(workouts.filter((w) => !w.archived_at && !w.one_time_date).map((w) => [w.id, w]));
}

/** A new block of `weeks` copies of the repeating week, live workouts only. */
export function newBlock(
  schedule: WeeklySchedule | null | undefined,
  workouts: readonly Workout[],
  options: { start: string; weeks: number; repeat: boolean; name?: string },
): ProgramBody {
  const live = liveWorkouts(workouts);
  const week = {} as ScheduleWeek;
  for (const day of WEEKDAYS) {
    const id = schedule?.week[day] ?? null;
    week[day] = id && live.has(id) ? id : null;
  }
  const extras: ScheduleExtras = {};
  for (const day of WEEKDAYS) {
    const ids = (schedule?.extras?.[day] ?? []).filter((id) => live.has(id) && id !== week[day]);
    if (ids.length > 0) extras[day] = ids.slice(0, MAX_SCHEDULE_EXTRAS);
  }
  const count = Math.min(Math.max(Math.round(options.weeks), 1), MAX_PROGRAM_WEEKS);
  const copy: ProgramWeek = { week, ...(Object.keys(extras).length > 0 ? { extras } : {}) };
  const name = options.name?.trim();
  return {
    ...(name ? { name: name.slice(0, MAX_PROGRAM_NAME) } : {}),
    start: options.start,
    repeat: options.repeat,
    weeks: Array.from({ length: count }, () => structuredClone(copy)),
  };
}

function withWeeks<P extends ProgramBody>(program: P, weeks: ProgramWeek[]): P {
  return { ...program, weeks };
}

export function relabeling<P extends ProgramBody>(program: P, index: number, label: string): P {
  const weeks = program.weeks.map((w, i) => {
    if (i !== index) return w;
    const next = { ...w };
    const trimmed = label.slice(0, MAX_PROGRAM_LABEL);
    if (trimmed.trim()) next.label = trimmed;
    else delete next.label;
    return next;
  });
  return withWeeks(program, weeks);
}

/** Week `index`'s days, extras and targets copied over the next week, or
 * every later week; each keeps its own label. */
export function copyingDown<P extends ProgramBody>(program: P, index: number, reach: 'next' | 'all'): P {
  const source = program.weeks[index];
  if (!source) return program;
  const weeks = program.weeks.map((w, i) => {
    if (i <= index || (reach === 'next' && i !== index + 1)) return w;
    const copy: ProgramWeek = { week: structuredClone(source.week) };
    if (w.label) copy.label = w.label;
    if (source.extras) copy.extras = structuredClone(source.extras);
    if (source.targets) copy.targets = structuredClone(source.targets);
    return copy;
  });
  return withWeeks(program, weeks);
}

/** A copy of the last week added after it; null at the limit. */
export function addingWeek<P extends ProgramBody>(program: P): P | null {
  const last = program.weeks[program.weeks.length - 1];
  if (!last || program.weeks.length >= MAX_PROGRAM_WEEKS) return null;
  const copy: ProgramWeek = structuredClone(last);
  delete copy.label;
  return withWeeks(program, [...program.weeks, copy]);
}

export function removingLastWeek<P extends ProgramBody>(program: P): P | null {
  return program.weeks.length > 1 ? withWeeks(program, program.weeks.slice(0, -1)) : null;
}

/** Workouts the block uses anywhere, in plan order. */
export function workoutsInBlock(program: ProgramBody, workouts: readonly Workout[]): Workout[] {
  const used = new Set<string>();
  for (const week of program.weeks) {
    for (const day of WEEKDAYS) {
      const main = week.week[day];
      if (main) used.add(main);
      for (const id of week.extras?.[day] ?? []) used.add(id);
    }
  }
  return workouts.filter((w) => !w.archived_at && used.has(w.id));
}

// ---- targets ---------------------------------------------------------------

/** A target the designer edits week by week. */
export type TargetField = 'target_sets' | 'target_reps' | 'target_weight' | 'target_duration_s';

export const FIELD_LABELS: Record<TargetField, string> = {
  target_sets: 'Sets',
  target_reps: 'Reps',
  target_weight: 'Load',
  target_duration_s: 'Time',
};

const isTimed = (slot: Slot) =>
  slot.exercise_modality === 'timed' || slot.exercise_modality === 'cardio' || slot.target_duration_s != null;

/** The targets a slot can change by week. A run's distance and pace live in
 * its steps, which the iPhone app edits week by week. */
export function editableFields(slot: Slot): TargetField[] {
  if (slot.exercise_id === RUN_EXERCISE_ID && slot.run_steps) return [];
  const fields: TargetField[] = ['target_sets'];
  fields.push(isTimed(slot) ? 'target_duration_s' : 'target_reps');
  if (slot.exercise_modality !== 'cardio' && slot.exercise_id !== RUN_EXERCISE_ID) fields.push('target_weight');
  return fields;
}

/** The slot's own value of a field. A hold stored in reps (older slots)
 * reads as seconds. */
export function slotValue(slot: Slot, field: TargetField): number | null {
  switch (field) {
    case 'target_sets': return slot.target_sets;
    case 'target_reps': return slot.target_reps;
    case 'target_weight': return slot.target_weight;
    case 'target_duration_s': return slot.target_duration_s ?? (isTimed(slot) ? slot.target_reps : null);
  }
}

/** The slot's load unit; a week's load is shown and saved in it. */
export const slotUnit = (slot: Slot): WeightUnit => slot.target_weight_unit === 'kg' ? 'kg' : 'lb';

/** A field's value in week `index`: that week's own, else the slot's. A
 * week's load saved in the other unit reads in the slot's unit, so the same
 * physical load shows under the slot's heading. */
export function weekValue(program: ProgramBody, index: number, slot: Slot, field: TargetField): number | null {
  const entry = program.weeks[index]?.targets?.[slot.id];
  const own = entry?.[field];
  if (field === 'target_weight') {
    const unit = entry?.target_weight_unit ?? slotUnit(slot);
    const weight = own !== undefined ? own : slot.target_weight;
    if (weight == null || unit === slotUnit(slot)) return weight;
    return Math.round(convertWeight(weight, unit, slotUnit(slot)) * 10) / 10;
  }
  if (field === 'target_duration_s') {
    // As the runner reads a hold: its seconds, else (older slots) its reps.
    const seconds = own !== undefined ? own : slot.target_duration_s;
    if (seconds != null) return seconds;
    return isTimed(slot) ? entry?.target_reps ?? slot.target_reps : null;
  }
  return own !== undefined ? own : slotValue(slot, field);
}

/** Whether week `index` changes this field from the slot's own (a load
 * also when only its unit differs). */
export function weekChanges(program: ProgramBody, index: number, slot: Slot, field: TargetField): boolean {
  const entry = program.weeks[index]?.targets?.[slot.id];
  if (field === 'target_weight' && entry?.target_weight_unit !== undefined && entry.target_weight_unit !== slotUnit(slot)) return true;
  if (field === 'target_duration_s' && isTimed(slot) && entry?.target_reps !== undefined) return true;
  return entry?.[field] !== undefined;
}

/** Members of the slot's superset or circuit, itself included. */
function groupOf(slot: Slot, workout: Workout): Slot[] {
  if (!slot.group_id) return [slot];
  return (workout.exercises as Slot[]).filter((s) => s.group_id === slot.group_id);
}

/** A week's own steps for a planned run, or back to the workout's own
 * (`null`, or the same steps). Canonical text, as the slot keeps it. */
export function settingRunSteps<P extends ProgramBody>(program: P, index: number, slot: Slot, steps: RunPlanItem[] | null): P {
  const week = program.weeks[index];
  if (!week) return program;
  const targets: Record<string, SlotTargets> = structuredClone(week.targets ?? {});
  const entry: SlotTargets = { ...(targets[slot.id] ?? {}) };
  const own = slot.run_steps ? parseRunSteps(slot.run_steps) : null;
  if (steps === null || (own?.ok && JSON.stringify(own.items) === JSON.stringify(steps))) delete entry.run_steps;
  else entry.run_steps = JSON.stringify(steps);
  if (Object.keys(entry).length > 0) targets[slot.id] = entry;
  else delete targets[slot.id];
  const next = { ...week };
  if (Object.keys(targets).length > 0) next.targets = targets;
  else delete next.targets;
  return { ...program, weeks: program.weeks.map((other, at) => (at === index ? next : other)) };
}

/** Week `index` with one field of a slot set (null = back to the slot's own).
 * A superset or circuit shares its rounds, so sets change for every member;
 * reps above the slot's range drop the range. */
export function settingTarget<P extends ProgramBody>(
  program: P, index: number, workout: Workout, slot: Slot, field: TargetField, value: number | null,
): P {
  const week = program.weeks[index];
  if (!week) return program;
  const targets: Record<string, SlotTargets> = structuredClone(week.targets ?? {});
  const members = field === 'target_sets' ? groupOf(slot, workout) : [slot];
  // Back to the slot's own: no entry, so the week follows later slot edits.
  const back = value == null || members.every((m) => slotValue(m, field) === value);
  for (const member of members) {
    const entry: SlotTargets = { ...(targets[member.id] ?? {}) };
    if (back) delete entry[field];
    else entry[field] = value;
    // A load is edited in the slot's unit, so a week's other unit goes with it.
    if (field === 'target_weight') delete entry.target_weight_unit;
    // A time replaces an older hold kept in reps, which the editor never shows.
    if (field === 'target_duration_s' && isTimed(member)) delete entry.target_reps;
    if (field === 'target_reps') {
      const reps = entry.target_reps ?? member.target_reps;
      const max = entry.target_reps_max !== undefined ? entry.target_reps_max : member.target_reps_max;
      if (max != null && max < reps) entry.target_reps_max = null;
      else if (entry.target_reps_max === null && member.target_reps_max != null && member.target_reps_max >= reps) {
        delete entry.target_reps_max;
      }
    }
    if (Object.keys(entry).length > 0) targets[member.id] = entry;
    else delete targets[member.id];
  }
  const weeks = program.weeks.map((w, i) => {
    if (i !== index) return w;
    const next = { ...w };
    if (Object.keys(targets).length > 0) next.targets = targets;
    else delete next.targets;
    return next;
  });
  return withWeeks(program, weeks);
}

// ---- the ramp --------------------------------------------------------------

export interface Ramp {
  /** Week 1-based to start from; earlier weeks keep what they have. */
  fromWeek: number;
  /** The value in that week. */
  start: number;
  /** Growth each harder week: a percent, or an amount in the field's unit. */
  step: { kind: 'percent' | 'amount'; value: number };
  /** Every Nth week of the block is easier (null for none). */
  easyEvery: number | null;
  /** An easier week's share of the week before, in percent. */
  easyPercent: number;
  /** Stop growing here (null for no ceiling). */
  ceiling: number | null;
}

/** A value as the field takes it: whole sets and reps, loads in 5 lb or 2.5
 * kg steps (1 below 10), times in 15 seconds (5 below two minutes). Steps
 * count from `anchor`, so a ramp's first week keeps its own value (a 53 lb
 * kettlebell stays 53). */
export function roundFor(field: TargetField, value: number, unit: WeightUnit = 'lb', anchor = 0): number {
  if (field === 'target_sets' || field === 'target_reps') return Math.max(1, Math.round(value));
  const snap = (step: number) => anchor + Math.round((value - anchor) / step) * step;
  if (field === 'target_weight') return Math.max(0, snap(Math.abs(value) < 10 ? 1 : unit === 'kg' ? 2.5 : 5));
  return Math.max(5, Math.round(snap(value < 120 ? 5 : 15)));
}

/** Each week's value from `fromWeek` to the block's end: harder weeks grow
 * from the start, an easier week takes a share of the week before and
 * doesn't count as growth, and nothing passes the ceiling. Unrounded growth
 * compounds, so small steps still add up. */
export function rampValues(ramp: Ramp, weeks: number, round: (value: number) => number): number[] {
  const out: number[] = [];
  let grown = 0;
  let last = ramp.start;
  for (let week = ramp.fromWeek; week <= weeks; week += 1) {
    const easy = ramp.easyEvery != null && ramp.easyEvery >= 2 && week % ramp.easyEvery === 0 && week !== ramp.fromWeek;
    let value: number;
    if (easy) {
      value = last * ramp.easyPercent / 100;
    } else {
      value = ramp.step.kind === 'percent'
        ? ramp.start * (1 + ramp.step.value / 100) ** grown
        : ramp.start + ramp.step.value * grown;
      if (ramp.ceiling != null) value = Math.min(value, ramp.ceiling);
      last = value;
      grown += 1;
    }
    // Rounding never lifts a week past the ceiling.
    const rounded = round(value);
    out.push(ramp.ceiling != null ? Math.min(rounded, ramp.ceiling) : rounded);
  }
  return out;
}

/** The program with a ramp written into one field of a slot. */
export function applyingRamp<P extends ProgramBody>(
  program: P, workout: Workout, slot: Slot, field: TargetField, ramp: Ramp,
): P {
  const unit = slotUnit(slot);
  const values = rampValues(ramp, program.weeks.length, (v) => roundFor(field, v, unit, ramp.start));
  let next = program;
  values.forEach((value, offset) => {
    next = settingTarget(next, ramp.fromWeek - 1 + offset, workout, slot, field, value);
  });
  return next;
}

// ---- text ------------------------------------------------------------------

export function formatSeconds(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** "45", "1:30", "1:05:00" or "90s" → seconds; null when unreadable. */
export function parseSeconds(text: string): number | null {
  const trimmed = text.trim().replace(/s$/i, '');
  if (!trimmed) return null;
  const parts = trimmed.split(':');
  if (parts.length > 3 || parts.some((p) => !/^\d+$/.test(p))) return null;
  const numbers = parts.map(Number);
  const seconds = parts.length === 1 ? numbers[0]! * (text.trim().endsWith('s') ? 1 : 60)
    : numbers.reduce((total, n) => total * 60 + n, 0);
  return seconds > 0 ? seconds : null;
}

export function formatValue(field: TargetField, value: number | null, unit?: string): string {
  if (value == null) return '–';
  if (field === 'target_duration_s') return formatSeconds(value);
  if (field === 'target_weight') return `${Number.isInteger(value) ? value : value.toFixed(1)} ${unit ?? 'lb'}`;
  return String(value);
}

/** "Mon, Nov 16" for a civil date, without time zones. */
export function shortDate(ymd: string): string {
  const [, m, d] = ymd.split('-').map(Number);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const names: Record<Weekday, string> = { mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat', sun: 'Sun' };
  return `${names[weekdayOf(ymd)]}, ${months[(m ?? 1) - 1]} ${d}`;
}
