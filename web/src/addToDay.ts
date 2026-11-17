// Adding something to a day on the web (docs/plans/web-app P2): pick what it
// is first (a run, a ride, a lift), shape it, and it is saved as a workout
// and placed in one go. The types and names follow the iPhone composer
// (ios/TresFort/PlanComposerView.swift), so a plan made on either reads the
// same on both. Pure; the Worker checks every write again.
import { parseRunSteps, RUN_EXERCISE_ID, type RunPlanItem, type RunStep } from '../../src/runSteps';
import type { PrescribedSlot, WorkoutPrescription } from './api';
import { runHeadline } from './blockLayers';
import { isRunOnlyWorkout, type Workout } from './model';
import { parseDuration, stepFromDraft, type StepDraft, type TargetChoice } from './runPlan';

export type AddKind = 'run' | 'ride' | 'swim' | 'lift' | 'home' | 'other' | 'saved';

/** The types in the iPhone composer's order, saved workouts last. */
export const ADD_KINDS: { kind: AddKind; label: string }[] = [
  { kind: 'run', label: 'Run' },
  { kind: 'ride', label: 'Ride' },
  { kind: 'swim', label: 'Swim' },
  { kind: 'lift', label: 'Lift' },
  { kind: 'home', label: 'At home' },
  { kind: 'other', label: 'Other' },
  { kind: 'saved', label: 'Saved' },
];

/** Ideas for an activity; any name works (PlannedActivity.suggestions). */
export const OTHER_SUGGESTIONS = ['Soccer', 'Basketball', 'Tennis', 'Pickleball', 'Climbing', 'Yoga', 'Pilates', 'Hike', 'Walk'];

const normalized = (name: string) => name.trim().toLowerCase();

/** Workouts a new one's name is checked against: saved, not archived, not
 * made for one date. */
const library = (workouts: readonly Workout[]) => workouts.filter((workout) => !workout.archived_at && !workout.one_time_date);

/** A saved workout already called this, so a second isn't made. */
export function existingNamed(workouts: readonly Workout[], name: string): Workout | undefined {
  const key = normalized(name);
  return key ? library(workouts).find((workout) => normalized(workout.name) === key) : undefined;
}

/** A name no saved workout has: the name, else "Core routine 2" and so on. */
export function availableName(base: string, workouts: readonly Workout[]): string {
  if (!existingNamed(workouts, base)) return base;
  let number = 2;
  while (existingNamed(workouts, `${base} ${number}`)) number += 1;
  return `${base} ${number}`;
}

// ---- runs --------------------------------------------------------------------

export type RunStyle = 'easy' | 'tempo' | 'intervals' | 'long';
export const RUN_STYLES: { style: RunStyle; label: string; name: string }[] = [
  { style: 'easy', label: 'Easy', name: 'Easy run' },
  { style: 'tempo', label: 'Tempo', name: 'Tempo run' },
  { style: 'intervals', label: 'Intervals', name: 'Intervals' },
  { style: 'long', label: 'Long', name: 'Long run' },
];

/** A run as the Add box asks for it: a kind, how long or how far, and an
 * optional range to keep it in. */
export interface RunDraft {
  style: RunStyle;
  measure: 'time' | 'distance';
  /** Whole minutes ("30") or a clock ("1:05:00"). */
  time: string;
  /** In miles or kilometers, as the member reads distances. */
  distance: string;
  /** Intervals: how many, how far each (meters) and the jog between. */
  repeats: string;
  repMeters: string;
  recovery: string;
  target: TargetChoice;
  low: string;
  high: string;
  fastest: string;
  slowest: string;
  /** Steps from the full step editor; they replace the fields above. */
  custom: RunPlanItem[] | null;
}

const RUN_TIMES: Record<RunStyle, string> = { easy: '30', tempo: '20', intervals: '30', long: '60' };

export function runDraft(style: RunStyle, miles: boolean): RunDraft {
  return {
    style, measure: 'time', time: RUN_TIMES[style], distance: style === 'long' ? (miles ? '6' : '10') : (miles ? '3' : '5'),
    repeats: '6', repMeters: '400', recovery: '1:30',
    target: 'none', low: '130', high: '150', fastest: '', slowest: '', custom: null,
  };
}

/** Another kind of run keeps what was typed, with that kind's usual time
 * when the time was still the old kind's. */
export function runStyled(draft: RunDraft, style: RunStyle): RunDraft {
  const time = draft.time === RUN_TIMES[draft.style] ? RUN_TIMES[style] : draft.time;
  return { ...draft, style, time, custom: null };
}

const EASY_JOG = 600;

function stepOf(draft: RunDraft, miles: boolean, ends: 'time' | 'distance', time: string, distance: string, unit: StepDraft['unit']) {
  return stepFromDraft({
    id: 'add', kind: 'work', ends, time, distance, unit,
    target: draft.target, low: draft.low, high: draft.high, fastest: draft.fastest, slowest: draft.slowest,
  }, miles);
}

/** The steps the draft asks for, or what to fix. A tempo run and intervals
 * get ten easy minutes before and after, as shown before saving. */
export function runItems(draft: RunDraft, miles: boolean): { ok: true; items: RunPlanItem[] } | { ok: false; error: string } {
  if (draft.custom) return { ok: true, items: draft.custom };
  const warmup: RunStep = { kind: 'warmup', duration_s: EASY_JOG };
  const cooldown: RunStep = { kind: 'cooldown', duration_s: EASY_JOG };
  let items: RunPlanItem[];
  if (draft.style === 'intervals') {
    const repeats = Number(draft.repeats.trim());
    if (!/^\d+$/.test(draft.repeats.trim()) || repeats < 1 || repeats > 50) return { ok: false, error: 'Enter 1 to 50 repeats.' };
    const work = stepOf(draft, miles, 'distance', '', draft.repMeters, 'm');
    if (!work.ok) return { ok: false, error: work.error === 'Enter a distance, such as 800 m or 1.5 km.' ? 'Enter how far each repeat is, in meters.' : work.error };
    const recovery = parseDuration(draft.recovery);
    if (recovery === null || recovery < 1 || recovery > 3600) return { ok: false, error: 'Enter the jog between repeats, such as 1:30.' };
    items = [warmup, { repeat: repeats, steps: [work.step, { kind: 'recovery', duration_s: recovery }] }, cooldown];
  } else {
    const main = draft.measure === 'time'
      ? stepOf(draft, miles, 'time', draft.time, '', 'm')
      : stepOf(draft, miles, 'distance', '', draft.distance, miles ? 'mi' : 'km');
    if (!main.ok) {
      return { ok: false, error: draft.measure === 'time' && main.error.startsWith('Enter a time') ? 'Enter how long, in minutes.'
        : draft.measure === 'distance' && main.error.startsWith('Enter a distance') ? 'Enter how far.' : main.error };
    }
    items = draft.style === 'tempo' ? [warmup, main.step, cooldown] : [main.step];
  }
  const checked = parseRunSteps(items);
  return checked.ok ? { ok: true, items: checked.items } : { ok: false, error: 'This run can’t be saved as it is. Check its numbers.' };
}

/** "Easy run · 30 min", "Intervals · 6 × 400 m": the name a new run gets
 * unless the member types one. */
export function runName(draft: RunDraft, items: readonly RunPlanItem[], miles: boolean): string {
  const style = RUN_STYLES.find((entry) => entry.style === draft.style)!.name;
  const amount = runHeadline(items, miles);
  return amount ? `${style} · ${amount}` : style;
}

function sameSteps(raw: string | null | undefined, items: readonly RunPlanItem[]): boolean {
  if (!raw) return false;
  const stored = parseRunSteps(raw);
  return stored.ok && JSON.stringify(stored.items) === JSON.stringify(items);
}

// ---- rides, swims and other activities ----------------------------------------

export interface EnduranceDraft { measure: 'time' | 'distance'; minutes: string; distance: string }

/** A ride is planned by time and a swim by distance to start with, as on
 * the iPhone. */
export function enduranceDraft(kind: 'ride' | 'swim', miles: boolean): EnduranceDraft {
  return kind === 'ride'
    ? { measure: 'time', minutes: '60', distance: miles ? '20' : '30' }
    : { measure: 'distance', minutes: '30', distance: '1000' };
}

/** A ride in miles or kilometers; a swim in yards for a member on miles. */
export function enduranceUnit(kind: 'ride' | 'swim', miles: boolean): string {
  return kind === 'swim' ? (miles ? 'yd' : 'm') : miles ? 'mi' : 'km';
}

const positive = (text: string, max: number): number | null => {
  const trimmed = text.trim().replace(',', '.');
  if (!/^(\d+\.?\d*|\.\d+)$/.test(trimmed)) return null;
  const value = Number(trimmed);
  return value > 0 && value <= max ? value : null;
};

/** "60 min ride", "20 mi ride", "1000 yd swim": the name ends in the sport,
 * so a ride or swim synced that day is known as the one planned. A typed
 * name gets the sport added when it doesn't end in it. */
export function enduranceName(kind: 'ride' | 'swim', draft: EnduranceDraft, typed: string, miles: boolean):
  { ok: true; name: string } | { ok: false; error: string } {
  const clean = typed.trim();
  if (clean) {
    if (clean.length > 70) return { ok: false, error: 'Use a shorter name.' };
    const words = clean.toLowerCase().split(/\s+/);
    return { ok: true, name: words[words.length - 1] === kind ? clean : `${clean} ${kind}` };
  }
  if (draft.measure === 'time') {
    const minutes = positive(draft.minutes, 600);
    if (minutes === null || !Number.isInteger(minutes)) return { ok: false, error: 'Enter how long, in whole minutes.' };
    return { ok: true, name: `${minutes} min ${kind}` };
  }
  const distance = positive(draft.distance, kind === 'swim' ? 20_000 : 500);
  if (distance === null) return { ok: false, error: 'Enter how far.' };
  return { ok: true, name: `${Math.round(distance * 100) / 100} ${enduranceUnit(kind, miles)} ${kind}` };
}

// ---- what a choice saves ------------------------------------------------------

/** What choosing Add does before the workout is placed. */
export type Creation =
  /** A saved workout is used as it is. */
  | { kind: 'existing'; workoutId: string; name: string }
  /** An activity: a workout with a name and no exercises. */
  | { kind: 'activity'; name: string }
  /** A workout with its exercises, and a run's steps saved right after. */
  | { kind: 'prescribed'; request: WorkoutPrescription; steps?: { slotId: string; items: RunPlanItem[] } }
  /** A run saved earlier without its steps (the second half of a save that
   * was cut short): only the steps are added. */
  | { kind: 'steps'; workoutId: string; name: string; slotId: string; items: RunPlanItem[] };

export type CreationResult = { ok: true; creation: Creation; name: string; note?: string } | { ok: false; error: string };

const checkName = (name: string): string | null =>
  !name.trim() ? 'Give it a name.' : name.trim().length > 80 ? 'Use a name of up to 80 characters.' : null;

function runSlot(id: string): PrescribedSlot {
  return {
    id, exercise_id: RUN_EXERCISE_ID, order_index: 0, target_sets: 1, target_reps: 1, target_reps_max: null,
    target_rpe: null, rest_seconds: 0, target_weight: null, target_weight_unit: 'lb', target_duration_s: null,
    progression: null, cues: null, is_warmup: 0, group_id: null, group_rest_seconds: null, group_transition_seconds: null,
  };
}

/**
 * The run to save. A saved run with the same name and steps is used instead
 * of a copy, so the same easy run added on three days stays one workout; a
 * different workout under the name gets a number added.
 */
export function runCreation(
  draft: RunDraft, typed: string, workouts: readonly Workout[], miles: boolean,
  at: { planId: string; version: number }, uuid: () => string = () => crypto.randomUUID(),
): CreationResult {
  const result = runItems(draft, miles);
  if (!result.ok) return result;
  const wanted = typed.trim() || runName(draft, result.items, miles);
  const problem = checkName(wanted);
  if (problem) return { ok: false, error: problem };
  const existing = existingNamed(workouts, wanted);
  if (existing && isRunOnlyWorkout(existing) && existing.exercises.length === 1) {
    const slot = existing.exercises[0]!;
    if (sameSteps(slot.run_steps, result.items)) {
      return { ok: true, name: existing.name, note: `You already have ${existing.name}, so this uses it.`,
        creation: { kind: 'existing', workoutId: existing.id, name: existing.name } };
    }
    if (!slot.run_steps) {
      return { ok: true, name: existing.name,
        creation: { kind: 'steps', workoutId: existing.id, name: existing.name, slotId: slot.id, items: result.items } };
    }
  }
  const name = availableName(wanted, workouts);
  const slotId = uuid();
  return { ok: true, name, ...(name !== wanted ? { note: `${wanted} is already a different workout, so this is saved as ${name}.` } : {}),
    creation: { kind: 'prescribed', steps: { slotId, items: result.items },
      request: { workout_id: uuid(), name, expected_plan_id: at.planId, expected_version: at.version, slots: [runSlot(slotId)] } } };
}

/** An activity by name: the saved one when a workout is already called
 * that, else a new one. */
export function activityCreation(name: string, workouts: readonly Workout[]): CreationResult {
  const problem = checkName(name);
  if (problem) return { ok: false, error: problem };
  const existing = existingNamed(workouts, name);
  if (existing) {
    return { ok: true, name: existing.name, note: `You already have ${existing.name}, so this uses it instead of making another.`,
      creation: { kind: 'existing', workoutId: existing.id, name: existing.name } };
  }
  return { ok: true, name: name.trim(), creation: { kind: 'activity', name: name.trim() } };
}
