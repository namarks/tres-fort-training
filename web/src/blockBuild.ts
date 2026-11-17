// How a block workout builds from week to week (docs/plans/web-app P2,
// guided block setup): one choice per workout fills every week, with an
// easier week every few weeks. A rule is a starting point: any week can
// still be changed by hand. Pure; a rule writes ordinary week targets, so
// nothing new is stored and the choice shown later is read back from them.
import { addDays } from '../../src/calendarProjection';
import { applySlotTargets } from '../../src/programTargets';
import { parseRunSteps, RUN_EXERCISE_ID, RUN_STEP_LIMITS, type RunPlanItem, type RunStep } from '../../src/runSteps';
import { MAX_PROGRAM_LABEL, MAX_PROGRAM_WEEKS, type ProgramWeek, type SlotTargets } from '../../src/types';
import {
  editableFields, mondayOnOrBefore, rampValues, roundFor, settingRunSteps, settingTarget, slotUnit, weekValue,
  type ProgramBody, type TargetField,
} from './blocks';
import type { Slot, Workout } from './model';

const METERS_PER_MILE = 1609.344;

/** What a rule adds to each week. */
export type BuildTarget = 'reps' | 'load' | 'sets' | 'time' | 'repeats' | 'run_time' | 'run_distance';

/** `same`: every week as the first. `add`: a fixed amount more each week
 * (seconds, meters, the slot's load unit, or a count). `manual`: the weeks
 * are the member's own and no rule touches them. */
export type BuildRule =
  | { kind: 'same' }
  | { kind: 'manual' }
  | { kind: 'add'; target: BuildTarget; amount: number };

/** Every Nth week of the block is easier; null for none. */
export type EasyEvery = 3 | 4 | 5 | null;
export const EASY_CHOICES: EasyEvery[] = [null, 3, 4, 5];
/** An easier week's share of the week before it, in percent. */
export const EASY_PERCENT = 80;
export const EASY_LABEL = 'Easier week';

/** One thing a workout can add each week, with how its amount is typed. */
export interface BuildOption {
  target: BuildTarget;
  /** "reps", "load", "minutes": what the choice is called. */
  name: string;
  /** The unit an amount is typed in: "rep", "lb", "min", "mi". */
  unit: string;
  /** Stored amount per one of `unit` (60 for minutes kept as seconds). */
  scale: number;
  /** The stored amount a new rule starts with. */
  amount: number;
  /** Whether `unit` takes an "s" for more than one ("2 reps"). */
  counted: boolean;
}

const FIELD_OF: Partial<Record<BuildTarget, TargetField>> = {
  reps: 'target_reps', load: 'target_weight', sets: 'target_sets', time: 'target_duration_s',
};

const isPlannedRunSlot = (slot: Slot | undefined): slot is Slot =>
  !!slot && slot.exercise_id === RUN_EXERCISE_ID && !!slot.run_steps;

/** The slots a workout's weeks count: everything but warm-ups, or all of
 * them when it holds nothing else. */
function workingSlots(workout: Workout): Slot[] {
  const slots = workout.exercises as Slot[];
  const working = slots.filter((slot) => !slot.is_warmup);
  return working.length > 0 ? working : slots;
}

/** The slot a workout's build is read from: its first working one. */
export function buildSlot(workout: Workout): Slot | undefined {
  return workingSlots(workout)[0];
}

function runItems(slot: Slot, targets: SlotTargets | undefined): RunPlanItem[] | null {
  const applied = applySlotTargets(slot, targets);
  const parsed = applied.run_steps ? parseRunSteps(applied.run_steps) : null;
  return parsed?.ok ? parsed.items : null;
}

/** The step a plain run grows: its first work step, else its first step. */
function mainStepIndex(items: readonly RunPlanItem[]): number {
  const plain = (item: RunPlanItem): item is RunStep => !('repeat' in item);
  const work = items.findIndex((item) => plain(item) && item.kind === 'work');
  return work >= 0 ? work : items.findIndex(plain);
}

const repeatIndex = (items: readonly RunPlanItem[]) => items.findIndex((item) => 'repeat' in item);

/** What this workout can add each week, the likeliest first. Empty for an
 * activity or a run with no length to grow. */
export function buildOptions(workout: Workout, miles: boolean): BuildOption[] {
  const slot = buildSlot(workout);
  if (!slot) return [];
  if (slot.exercise_id === RUN_EXERCISE_ID) {
    const items = isPlannedRunSlot(slot) ? runItems(slot, undefined) : null;
    if (!items) return [];
    if (repeatIndex(items) >= 0) return [{ target: 'repeats', name: 'repeats', unit: 'repeat', scale: 1, amount: 1, counted: true }];
    const main = items[mainStepIndex(items)] as RunStep | undefined;
    if (!main) return [];
    if (main.duration_s !== undefined) {
      return [{ target: 'run_time', name: 'minutes', unit: 'min', scale: 60, amount: main.duration_s >= 1800 ? 300 : 120, counted: false }];
    }
    const unit = miles ? METERS_PER_MILE : 1000;
    return [{ target: 'run_distance', name: 'distance', unit: miles ? 'mi' : 'km', scale: unit, amount: unit / 2, counted: false }];
  }
  const fields = editableFields(slot);
  const options: BuildOption[] = [];
  if (fields.includes('target_reps')) options.push({ target: 'reps', name: 'reps', unit: 'rep', scale: 1, amount: 1, counted: true });
  if (fields.includes('target_duration_s')) {
    const base = weekValue({ start: '', repeat: false, weeks: [] }, 0, slot, 'target_duration_s') ?? 0;
    options.push(base >= 120
      ? { target: 'time', name: 'minutes', unit: 'min', scale: 60, amount: 60, counted: false }
      : { target: 'time', name: 'seconds', unit: 'sec', scale: 1, amount: 5, counted: false });
  }
  if (fields.includes('target_weight') && slot.target_weight != null) {
    const unit = slotUnit(slot);
    options.push({ target: 'load', name: 'load', unit, scale: 1, amount: unit === 'kg' ? 2.5 : 5, counted: false });
  }
  options.push({ target: 'sets', name: 'sets', unit: 'set', scale: 1, amount: 1, counted: true });
  return options;
}

/** The rule a workout starts with in a new block: its first option, else
 * the same every week. */
export function defaultBuild(workout: Workout, miles: boolean): BuildRule {
  const first = buildOptions(workout, miles)[0];
  return first ? { kind: 'add', target: first.target, amount: first.amount } : { kind: 'same' };
}

/** The rule as a workout can take it: an `add` it has no option for (the
 * workout changed since) falls back to the same every week. */
export function usableBuild(workout: Workout, rule: BuildRule | undefined, miles: boolean): BuildRule {
  if (!rule) return defaultBuild(workout, miles);
  if (rule.kind !== 'add') return rule;
  const ok = buildOptions(workout, miles).some((option) => option.target === rule.target)
    && Number.isFinite(rule.amount) && rule.amount > 0;
  return ok ? rule : { kind: 'same' };
}

const trim = (value: number) => String(Math.round(value * 100) / 100);

/** "+ 1 rep a week", "+ 2 min a week", "The same every week". */
export function buildLabel(rule: BuildRule, options: readonly BuildOption[]): string {
  if (rule.kind === 'same') return 'The same every week';
  if (rule.kind === 'manual') return 'Set week by week';
  const option = options.find((entry) => entry.target === rule.target);
  if (!option) return 'Set week by week';
  const amount = rule.amount / option.scale;
  return `+ ${trim(amount)} ${option.unit}${option.counted && amount !== 1 ? 's' : ''} a week`;
}

// ---- writing a rule into the weeks -----------------------------------------

function withoutSlots(week: ProgramWeek, ids: ReadonlySet<string>): ProgramWeek {
  if (!week.targets) return week;
  const targets = Object.fromEntries(Object.entries(week.targets).filter(([id]) => !ids.has(id)));
  const next = { ...week };
  if (Object.keys(targets).length > 0) next.targets = targets;
  else delete next.targets;
  return next;
}

/** Every week after `from` given week `from`'s targets for this workout. */
function flattened<P extends ProgramBody>(program: P, workout: Workout, from: number): P {
  const ids = new Set(workout.exercises.map((slot) => slot.id));
  const source = Object.entries(program.weeks[from]?.targets ?? {}).filter(([id]) => ids.has(id));
  const weeks = program.weeks.map((week, index) => {
    if (index <= from) return week;
    const next = withoutSlots(week, ids);
    if (source.length === 0) return next;
    return { ...next, targets: { ...(next.targets ?? {}), ...structuredClone(Object.fromEntries(source)) } };
  });
  return { ...program, weeks };
}

const multipleOf = (value: number, grid: number) => Math.abs(value / grid - Math.round(value / grid)) < 1e-6;

/** Steps counted from the first week's value, so it keeps its own. */
const snapped = (value: number, start: number, grid: number) => start + Math.round((value - start) / grid) * grid;

/** Whole minutes when a long time grows by whole minutes, else the field's own steps. */
function roundTime(seconds: number, start: number, amount: number): number {
  if (start >= 600 && multipleOf(amount, 60)) return Math.max(60, Math.round(snapped(seconds, start, 60)));
  return roundFor('target_duration_s', seconds, 'lb', start);
}

/** Half a mile or kilometer when the run grows by halves, else tenths; a
 * distance under a kilometer in 50 m. */
function roundDistance(meters: number, start: number, amount: number, miles: boolean): number {
  const unit = miles ? METERS_PER_MILE : 1000;
  const grid = start < 1000 ? 50 : multipleOf(amount, unit / 2) ? unit / 2 : unit / 10;
  // Stored to a tenth of a meter, as a typed distance is.
  return Math.max(grid, Math.round(snapped(meters, start, grid) * 10) / 10);
}

function series(start: number, amount: number, from: number, weeks: number, easyEvery: EasyEvery, round: (value: number) => number): number[] {
  return rampValues({ fromWeek: from + 1, start, step: { kind: 'amount', value: amount }, easyEvery, easyPercent: EASY_PERCENT, ceiling: null },
    weeks, round);
}

/**
 * The block with one workout's weeks from `from` (0-based) filled by a rule:
 * each starts as week `from` reads, and an `add` rule then grows its target
 * by the amount each week, with every `easyEvery`th week of the block at
 * 80% of the week before. Weeks before `from` keep what they have, and
 * `manual` changes nothing.
 */
export function applyingBuild<P extends ProgramBody>(
  program: P, workout: Workout, rule: BuildRule, options: { easyEvery: EasyEvery; from?: number; miles: boolean },
): P {
  const from = Math.min(Math.max(options.from ?? 0, 0), Math.max(program.weeks.length - 1, 0));
  if (rule.kind === 'manual' || program.weeks.length === 0) return program;
  let next = flattened(program, workout, from);
  if (rule.kind === 'same') return next;
  const count = program.weeks.length;
  const field = FIELD_OF[rule.target];
  if (field) {
    for (const slot of workingSlots(workout)) {
      if (slot.exercise_id === RUN_EXERCISE_ID || !editableFields(slot).includes(field)) continue;
      const start = weekValue(next, from, slot, field);
      if (start == null || (field === 'target_weight' && slot.target_weight == null)) continue;
      const unit = slotUnit(slot);
      const values = series(start, rule.amount, from, count, options.easyEvery,
        (value) => field === 'target_duration_s' ? roundTime(value, start, rule.amount) : roundFor(field, value, unit, start));
      values.forEach((value, offset) => { next = settingTarget(next, from + offset, workout, slot, field, value); });
    }
    return next;
  }
  const slot = buildSlot(workout);
  if (!isPlannedRunSlot(slot)) return next;
  const items = runItems(slot, next.weeks[from]?.targets?.[slot.id]);
  if (!items) return next;
  const at = rule.target === 'repeats' ? repeatIndex(items) : mainStepIndex(items);
  const item = items[at];
  if (!item) return next;
  let values: number[];
  let change: (value: number) => RunPlanItem;
  if (rule.target === 'repeats' && 'repeat' in item) {
    // A run holds a limited number of steps once its repeats are counted
    // out, so the repeats stop where the rest of the run leaves room.
    const others = items.reduce((sum, other, index) => sum + (index === at ? 0 : 'repeat' in other ? other.repeat * other.steps.length : 1), 0);
    const most = Math.max(1, Math.min(RUN_STEP_LIMITS.repeat,
      Math.floor((RUN_STEP_LIMITS.expandedSteps - others) / Math.max(1, item.steps.length))));
    values = series(item.repeat, rule.amount, from, count, options.easyEvery,
      (value) => Math.min(most, Math.max(1, Math.round(value))));
    change = (value) => ({ ...item, repeat: value });
  } else if (rule.target === 'run_time' && !('repeat' in item) && item.duration_s !== undefined) {
    const start = item.duration_s;
    values = series(start, rule.amount, from, count, options.easyEvery,
      (value) => Math.min(RUN_STEP_LIMITS.durationSeconds, roundTime(value, start, rule.amount)));
    change = (value) => ({ ...item, duration_s: value });
  } else if (rule.target === 'run_distance' && !('repeat' in item) && item.distance_m !== undefined) {
    const start = item.distance_m;
    values = series(start, rule.amount, from, count, options.easyEvery,
      (value) => Math.min(RUN_STEP_LIMITS.distanceMeters, roundDistance(value, start, rule.amount, options.miles)));
    change = (value) => ({ ...item, distance_m: value });
  } else {
    return next;
  }
  values.forEach((value, offset) => {
    next = settingRunSteps(next, from + offset, slot, items.map((other, index) => (index === at ? change(value) : other)));
  });
  return next;
}

/** The block's weeks named for their easier ones: each `easyEvery`th week
 * is labeled, and that label is taken off the others. A week's own label
 * is never replaced. */
export function labelingEasyWeeks<P extends ProgramBody>(program: P, easyEvery: EasyEvery): P {
  const weeks = program.weeks.map((week, index) => {
    const easy = easyEvery != null && (index + 1) % easyEvery === 0 && index > 0;
    if (easy && !week.label?.trim()) return { ...week, label: EASY_LABEL.slice(0, MAX_PROGRAM_LABEL) };
    if (!easy && week.label === EASY_LABEL) {
      const next = { ...week };
      delete next.label;
      return next;
    }
    return week;
  });
  return { ...program, weeks };
}

// ---- reading a rule back from the weeks -------------------------------------

/** What one week asks of a workout, for telling two blocks apart. */
function weekSignature(program: ProgramBody, index: number, workout: Workout): string {
  const targets = program.weeks[index]?.targets;
  return JSON.stringify((workout.exercises as Slot[]).map((slot) => {
    const applied = applySlotTargets(slot, targets?.[slot.id]);
    const steps = applied.run_steps ? parseRunSteps(applied.run_steps) : null;
    return [applied.target_sets, applied.target_reps, applied.target_reps_max, applied.target_weight,
      applied.target_weight == null ? null : applied.target_weight_unit ?? 'lb', applied.target_duration_s,
      steps?.ok ? steps.items : applied.run_steps ?? null];
  }));
}

function sameWeeks(a: ProgramBody, b: ProgramBody, workout: Workout): boolean {
  return a.weeks.length === b.weeks.length
    && a.weeks.every((_, index) => weekSignature(a, index, workout) === weekSignature(b, index, workout));
}

/** One option's value in a week, in the rule's stored unit. */
function optionValue(program: ProgramBody, index: number, workout: Workout, target: BuildTarget): number | null {
  const slot = buildSlot(workout);
  if (!slot) return null;
  const field = FIELD_OF[target];
  if (field) return weekValue(program, index, slot, field);
  const items = runItems(slot, program.weeks[index]?.targets?.[slot.id]);
  if (!items) return null;
  if (target === 'repeats') {
    const item = items[repeatIndex(items)];
    return item && 'repeat' in item ? item.repeat : null;
  }
  const main = items[mainStepIndex(items)] as RunStep | undefined;
  return (target === 'run_time' ? main?.duration_s : main?.distance_m) ?? null;
}

/**
 * The rule the block's weeks follow for this workout, read back from them:
 * the same every week, a steady amount more each week (with which weeks are
 * easier), or the member's own. `from` is the week a rule was last applied
 * from in a running block; a rule from week 1 is tried first.
 */
export function detectedBuild(
  program: ProgramBody, workout: Workout, miles: boolean, from = 0,
): { rule: BuildRule; easyEvery: EasyEvery; from: number } {
  const starts = from > 0 && from < program.weeks.length - 1 ? [0, from] : [0];
  for (const start of starts) {
    if (sameWeeks(applyingBuild(program, workout, { kind: 'same' }, { easyEvery: null, from: start, miles }), program, workout)) {
      return { rule: { kind: 'same' }, easyEvery: null, from: start };
    }
  }
  for (const start of starts) {
    for (const option of buildOptions(workout, miles)) {
      const first = optionValue(program, start, workout, option.target);
      const second = optionValue(program, start + 1, workout, option.target);
      if (first == null || second == null || second <= first) continue;
      const raw = Math.round((second - first) * 1000) / 1000;
      // A distance is stored to a tenth of a meter, so the step between two
      // weeks is read back as the tenth of a mile or kilometer it was typed as.
      const tenth = (miles ? METERS_PER_MILE : 1000) / 10;
      const typed = option.target === 'run_distance' && Math.abs(raw / tenth - Math.round(raw / tenth)) < 0.01
        ? Math.round(raw / tenth) * tenth : raw;
      for (const amount of typed === raw ? [raw] : [typed, raw]) {
        const rule: BuildRule = { kind: 'add', target: option.target, amount };
        for (const easyEvery of EASY_CHOICES) {
          // A block too short to reach an easier week reads as having none.
          if (easyEvery != null && program.weeks.length < easyEvery) continue;
          if (sameWeeks(applyingBuild(program, workout, rule, { easyEvery, from: start, miles }), program, workout)) {
            return { rule, easyEvery, from: start };
          }
        }
      }
    }
  }
  return { rule: { kind: 'manual' }, easyEvery: null, from: 0 };
}

// ---- a block that ends at an event ------------------------------------------

/** Weeks from a start Monday so the event's week is the block's last; null
 * when the event is before the start or more than a year of weeks away. */
export function weeksToEvent(start: string, eventDate: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(eventDate) || !/^\d{4}-\d{2}-\d{2}$/.test(start)) return null;
  const last = mondayOnOrBefore(eventDate);
  if (last < start) return null;
  let weeks = 1;
  for (let monday = start; monday < last; monday = addDays(monday, 7)) {
    weeks += 1;
    if (weeks > MAX_PROGRAM_WEEKS) return null;
  }
  return weeks;
}
