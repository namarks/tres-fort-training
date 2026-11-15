/**
 * "Train for an event" (docs/plans/progressive-plans P3): fixed, explainable
 * rules that lay out a block of weeks from a start Monday to an event, so a
 * member plans a build-up without tapping every day and without AI.
 *
 * Pure: the caller supplies the repeating week and the plan's run slots, and
 * gets back a block in the shape `setProgram` takes plus a week-by-week
 * summary for the preview chart. Every week stays editable after saving.
 *
 * The rules, in order:
 * - The block runs from the start Monday through the week holding the event.
 * - The last `taper_weeks` weeks (race week included) taper; the week before
 *   them is the peak week.
 * - Every `easy_every`th week before the peak is an easier week: its long run
 *   is 75% of the week before it, and other runs shrink the same way.
 * - The other weeks build the long run evenly from the longest run lately to
 *   the peak, never adding more than 15% or one mile in a week; if that cap
 *   stops the build short, `reached_peak` is false.
 * - Taper weeks hold 70% down to 50% of the peak. In race week the event day
 *   is the long run when it falls on the long-run day, days after the event
 *   rest, and a long run before it is a short shakeout.
 * - The workout day's run changes with the phase: strides in base and
 *   easier weeks, a tempo that grows through the build, then peak sessions
 *   (goal-pace repeats for a half or longer with a goal time, a top tempo
 *   without one, 3-minute intervals for shorter races), shorter versions of
 *   them in the taper and a shakeout in race week.
 * - With a goal time, a half or marathon long run finishes with miles at goal
 *   pace (10% growing to 25% of it through the build, 30% at the peak, 20% in
 *   the first taper week), and race day aims at goal pace.
 * - Everything else (lifts, other activities) is the repeating week as it is.
 */

import { addDays, weekdayOf } from './calendarProjection';
import { parseRunSteps, RUN_STEP_LIMITS, type RunPlanItem, type RunStep, type RunStepTarget } from './runSteps';
import {
  MAX_PROGRAM_WEEKS,
  WEEKDAYS,
  type ScheduleExtras,
  type ScheduleWeek,
  type Weekday,
} from './types';

export const METERS_PER_MILE = 1609.344;

export type BuildUnit = 'mi' | 'km';
export type BuildPhase = 'base' | 'build' | 'peak' | 'easy' | 'taper' | 'race' | 'hold';

export const BUILD_PHASE_LABELS: Record<BuildPhase, string> = {
  base: 'Base',
  build: 'Build',
  peak: 'Peak',
  easy: 'Easier week',
  taper: 'Taper',
  race: 'Race week',
  hold: 'Holding',
};

export const BUILD_LIMITS = {
  easyEvery: { min: 2, max: 8 },
  taperWeeks: { min: 1, max: 4 },
  /** A long run the rules will plan, in meters (the step limit). */
  longRunMeters: { min: 1000, max: 100_000 },
  easyFactor: 0.75,
  stepShare: 0.15,
} as const;

export interface BuildRules {
  /** The block's first Monday. */
  start: string;
  race_date: string;
  race_distance_m: number;
  long_run_weekday: Weekday;
  /** The longest run lately: where the build starts. */
  long_run_now_m: number;
  peak_m: number;
  /** 0 = never; otherwise every Nth week before the peak is easier. */
  easy_every: number;
  /** Weeks that taper, race week included. */
  taper_weeks: number;
  shorten_other_runs: boolean;
  /** Long runs round to whole miles or whole kilometers. */
  unit: BuildUnit;
  /** The day of the week's harder run; null or absent for none. */
  workout_weekday?: Weekday | null;
  /** The goal finish time: with it the plan aims at goal pace. */
  goal_time_s?: number | null;
  /** "Keep building, no date": a block of `weeks` with no event. The long
   * run steps up as fast as the cap allows to `peak_m` (the ceiling) and then
   * holds there; `race_date` and `race_distance_m` are ignored. */
  open?: { weeks: number };
}

export type WorkoutType = 'strides' | 'tempo' | 'intervals' | 'goal_pace' | 'shakeout';

/** The workout day's session in a week: `reps` × `work_s` of the work that
 * matters (strides, tempo, intervals, goal-pace repeats). */
export interface WorkoutSummary {
  type: WorkoutType;
  reps: number;
  work_s: number;
}

/** An outdoor run slot of a live workout. */
export interface BuildRunSlot {
  id: string;
  workout_id: string;
  run_steps: string | null;
  target_duration_s: number | null;
}

export interface BuildWeekSummary {
  start: string;
  phase: BuildPhase;
  label: string;
  /** The long run this week, or null when there is none (it falls after the event). */
  long_run_m: number | null;
  /** How much of the long run is at goal pace, at its end; null for none. */
  long_run_goal_m: number | null;
  /** The workout day's session, or null when there is none this week. */
  workout: WorkoutSummary | null;
  /** What other runs are scaled by this week (1 = as in Your week). */
  factor: number;
}

export interface BuiltProgramWeek {
  label: string;
  week: Partial<Record<Weekday, string | null>>;
  extras: Partial<Record<Weekday, string[]>>;
  targets?: Record<string, Record<string, unknown>>;
}

export type BuildResult =
  | {
      ok: true;
      weeks: BuildWeekSummary[];
      reached_peak: boolean;
      long_run_slot: string;
      program: { name: string; start: string; repeat: false; weeks: BuiltProgramWeek[] };
    }
  | { error: 'invalid_start' | 'event_before_start' | 'too_many_weeks' | 'no_long_run' | 'no_workout_run'
      | 'goal_pace_out_of_range' }
  | { error: 'long_run_shared' | 'workout_shared'; weekday: Weekday };

/** A peak long run that suits the distance: 20 mi for a marathon or longer,
 * 12 for a half, 9 for 10K-ish, 7 below that. */
export function defaultPeakMeters(distanceM: number): number {
  if (distanceM >= 40_000) return Math.round(20 * METERS_PER_MILE);
  if (distanceM >= 20_000) return Math.round(12 * METERS_PER_MILE);
  if (distanceM >= 9_000) return Math.round(9 * METERS_PER_MILE);
  return Math.round(7 * METERS_PER_MILE);
}

/** Taper weeks, race week included: three for a marathon, two for a half,
 * otherwise just race week. */
export function defaultTaperWeeks(distanceM: number): number {
  if (distanceM >= 40_000) return 3;
  if (distanceM >= 20_000) return 2;
  return 1;
}

/** The Monday on or before a date. */
export function mondayOf(date: string): string {
  return addDays(date, -WEEKDAYS.indexOf(weekdayOf(date)));
}

/** The Monday on or after a date. */
export function mondayOnOrAfter(date: string): string {
  const back = mondayOf(date);
  return back === date ? date : addDays(back, 7);
}

function daysBetween(from: string, to: string): number {
  const a = Date.UTC(+from.slice(0, 4), +from.slice(5, 7) - 1, +from.slice(8, 10));
  const b = Date.UTC(+to.slice(0, 4), +to.slice(5, 7) - 1, +to.slice(8, 10));
  return Math.round((b - a) / 86_400_000);
}

/** Weeks from the start Monday through the week holding the event. */
export function weeksToEvent(start: string, raceDate: string): number {
  return Math.floor(daysBetween(start, raceDate) / 7) + 1;
}

const unitMeters = (unit: BuildUnit) => (unit === 'mi' ? METERS_PER_MILE : 1000);
/** Whole units, at least one. */
const toUnits = (meters: number, unit: BuildUnit) => Math.max(1, Math.round(meters / unitMeters(unit)));
const toMeters = (units: number, unit: BuildUnit) => Math.round(units * unitMeters(unit));

/** The long run of each week in whole units, with its phase and the factor
 * other runs follow. Race week's long run is decided by `buildEventProgram`. */
export function planLongRuns(rules: BuildRules, weekCount: number): {
  weeks: Array<{ phase: BuildPhase; units: number; factor: number }>;
  peak_units: number;
  reached_peak: boolean;
} {
  const n = weekCount;
  const open = rules.open != null;
  const taper = open ? 0 : Math.min(Math.max(1, rules.taper_weeks), Math.max(1, n - 1));
  // With a single week there is nothing to build: it is race week. Without
  // an event every week builds or holds.
  const peakWeek = open ? n : n === 1 ? 0 : n - taper;
  const peak = toUnits(rules.peak_m, rules.unit);
  const startUnits = toUnits(rules.long_run_now_m, rules.unit);
  const mile = rules.unit === 'mi' ? 1 : METERS_PER_MILE / 1000;
  const easy = new Set<number>();
  if (rules.easy_every >= BUILD_LIMITS.easyEvery.min) {
    for (let w = rules.easy_every; open ? w <= n : w < peakWeek; w += rules.easy_every) easy.add(w);
  }
  const build: number[] = [];
  for (let w = 1; w <= peakWeek; w += 1) if (!easy.has(w)) build.push(w);
  const units = new Map<number, number>();
  let previous = startUnits;
  build.forEach((w, i) => {
    let value: number;
    if (startUnits >= peak) value = peak;
    else {
      // Toward an event the build spreads evenly; without one it steps up
      // as fast as the cap allows, then holds at the ceiling.
      const even = open || build.length === 1 ? peak : startUnits + ((peak - startUnits) * i) / (build.length - 1);
      // The first week grows from the longest run lately like any other, so
      // a block too short to build never jumps straight to the peak.
      const limit = previous + Math.max(previous * BUILD_LIMITS.stepShare, mile);
      // Round to whole units, but never past the cap.
      value = Math.max(1, Math.min(Math.round(Math.min(even, limit)), Math.floor(limit + 1e-9)));
    }
    units.set(w, value);
    previous = value;
  });
  const reachedPeak = build.length === 0 ? false : units.get(build[build.length - 1]!) === peak;
  const top = build.length === 0 ? Math.min(peak, startUnits) : Math.max(...build.map((w) => units.get(w)!));
  const weeks: Array<{ phase: BuildPhase; units: number; factor: number }> = [];
  const baseWeeks = open ? Math.min(3, Math.floor(n / 4)) : peakWeek >= 4 ? Math.round(peakWeek * 0.3) : 0;
  for (let w = 1; w <= n; w += 1) {
    if (w <= peakWeek) {
      if (easy.has(w)) {
        weeks.push({ phase: 'easy', units: Math.max(1, Math.round((units.get(w - 1) ?? startUnits) * BUILD_LIMITS.easyFactor)),
          factor: BUILD_LIMITS.easyFactor });
        continue;
      }
      const phase: BuildPhase = open
        // The first weeks stay base (strides) even when the long run is
        // already at the ceiling, so the workout day eases in.
        ? (w <= baseWeeks ? 'base' : units.get(w)! >= peak ? 'hold' : 'build')
        : peakWeek >= 3 && w >= peakWeek - 1 ? 'peak' : w <= baseWeeks ? 'base' : 'build';
      weeks.push({ phase, units: units.get(w)!, factor: 1 });
    } else if (w < n) {
      const j = w - peakWeek; // 1..taper-1
      const span = taper - 1;
      const factor = span <= 1 ? 0.6 : 0.7 - (0.2 * (j - 1)) / (span - 1);
      weeks.push({ phase: 'taper', units: Math.max(1, Math.round(top * factor)), factor: Math.round(factor * 100) / 100 });
    } else {
      weeks.push({ phase: 'race', units: Math.max(1, Math.round(top * 0.3)), factor: 0.5 });
    }
  }
  return { weeks, peak_units: top, reached_peak: reachedPeak };
}

/** The pace or heart rate a run's first work step aims at, kept on the long run. */
function firstWorkTarget(items: RunPlanItem[]): RunStepTarget | undefined {
  for (const item of items) {
    const steps = 'repeat' in item ? item.steps : [item];
    for (const step of steps) if (step.kind === 'work' && step.target) return step.target;
  }
  return undefined;
}

/** A shorter time or distance: rounded to a tidy step (coarser for long
 * ones), never longer than the original and never below one unit of the
 * rounding, so short repeats shrink instead of growing. */
export function shorten(value: number, factor: number, fine: number, coarse: number, coarseFrom: number): number {
  const scaled = value * factor;
  const unit = scaled >= coarseFrom ? coarse : fine;
  return Math.min(value, Math.max(Math.min(fine, value), Math.round(scaled / unit) * unit));
}

function scaleStep(step: RunStep, factor: number): RunStep {
  if (step.duration_s !== undefined) {
    return { ...step, duration_s: shorten(step.duration_s, factor, 5, 30, 120) };
  }
  if (step.distance_m !== undefined) {
    return { ...step, distance_m: shorten(step.distance_m, factor, 10, 100, 1000) };
  }
  return step;
}

/** Another run made shorter for an easier or taper week: each step's time or
 * distance scales, repeats keep their count. Null when it has nothing to scale. */
export function scaleRun(slot: BuildRunSlot, factor: number): Record<string, unknown> | null {
  if (factor >= 1) return null;
  if (slot.run_steps) {
    const parsed = parseRunSteps(slot.run_steps);
    if (!parsed.ok) return null;
    const items = parsed.items.map((item) => ('repeat' in item
      ? { repeat: item.repeat, steps: item.steps.map((step) => scaleStep(step, factor)) }
      : scaleStep(item, factor)));
    return { run_steps: items };
  }
  if (slot.target_duration_s != null && slot.target_duration_s > 0) {
    return { target_duration_s: shorten(slot.target_duration_s, factor, 5, 60, 600) };
  }
  return null;
}

/** A half marathon or longer: peak sessions are goal-pace repeats or a long
 * tempo, and long runs can finish at goal pace. */
const LONG_RACE_M = 20_000;

/** A pace target a few seconds either side of `secondsPerKm`. */
export function paceTarget(secondsPerKm: number): RunStepTarget {
  const clamp = (v: number) => Math.min(1200, Math.max(120, Math.round(v)));
  return { type: 'pace', fastest_s_per_km: clamp(secondsPerKm - 5), slowest_s_per_km: clamp(secondsPerKm + 5) };
}

/** Goal pace in seconds per kilometer, or null without a goal time. */
export function goalPace(rules: Pick<BuildRules, 'goal_time_s' | 'race_distance_m'>): number | null {
  if (!rules.goal_time_s || rules.goal_time_s <= 0 || rules.race_distance_m <= 0) return null;
  return rules.goal_time_s / (rules.race_distance_m / 1000);
}

/** Tempo pace against goal pace: quicker than marathon pace, about half
 * marathon pace, slower than 10K and 5K pace. */
function tempoFactor(distanceM: number): number {
  if (distanceM >= 40_000) return 0.95;
  if (distanceM >= 20_000) return 0.99;
  if (distanceM >= 9_000) return 1.04;
  return 1.08;
}

/** Interval pace against goal pace: 5K pace for a 10K, goal pace below. */
function intervalFactor(distanceM: number): number {
  return distanceM >= 9_000 ? 0.97 : 1;
}

/**
 * The workout day's session for each week, by phase: strides in base and
 * easier weeks; a tempo growing evenly through the build (15 to 30 minutes
 * for a half or longer, 12 to 24 below); at the peak 2 × 15 then 2 × 20
 * minutes at goal pace (a half or longer with a goal time), the top tempo
 * (without one) or 5 then 6 × 3 minutes (shorter races); taper weeks keep
 * the last peak session at the week's factor; race week is a shakeout.
 */
export function planWorkouts(phases: BuildPhase[], factors: number[], raceDistanceM: number, goal: boolean): WorkoutSummary[] {
  const longRace = raceDistanceM >= LONG_RACE_M;
  const tempo = longRace ? { lo: 15, hi: 30 } : { lo: 12, hi: 24 };
  const buildWeeks = phases.flatMap((phase, i) => (phase === 'build' ? [i] : []));
  const peakSession = (k: number): WorkoutSummary => {
    const later = Math.min(k, 1);
    if (!longRace) return { type: 'intervals', reps: 5 + later, work_s: 180 };
    return goal ? { type: 'goal_pace', reps: 2, work_s: (15 + 5 * later) * 60 } : { type: 'tempo', reps: 1, work_s: tempo.hi * 60 };
  };
  let peaks = 0;
  let lastPeak: WorkoutSummary | null = null;
  return phases.map((phase, i): WorkoutSummary => {
    switch (phase) {
      case 'base':
      case 'easy':
        return { type: 'strides', reps: 6, work_s: 20 };
      case 'build': {
        const k = buildWeeks.indexOf(i);
        const progress = buildWeeks.length <= 1 ? 0.5 : k / (buildWeeks.length - 1);
        return { type: 'tempo', reps: 1, work_s: Math.round(tempo.lo + (tempo.hi - tempo.lo) * progress) * 60 };
      }
      case 'peak':
        lastPeak = peakSession(peaks);
        peaks += 1;
        return lastPeak;
      case 'taper': {
        const top = lastPeak ?? peakSession(1);
        const factor = factors[i] ?? 0.6;
        if (top.type === 'intervals') return { ...top, reps: Math.max(3, Math.round(top.reps * factor)) };
        const minutes = Math.round((top.work_s / 60) * factor);
        return { ...top, work_s: Math.max(top.type === 'tempo' ? 10 : 5, minutes) * 60 };
      }
      case 'race':
        return { type: 'shakeout', reps: 4, work_s: 20 };
      case 'hold':
        return { type: 'tempo', reps: 1, work_s: tempo.hi * 60 };
    }
  });
}

/** The steps of a workout day's session. Strides and shakeouts run by feel;
 * the work of the others aims at `target` when there is one. */
export function workoutSteps(session: WorkoutSummary, target: RunStepTarget | undefined): RunPlanItem[] {
  const aim = target ? { target } : {};
  const warmup: RunStep = { kind: 'warmup', duration_s: 600 };
  const cooldown: RunStep = { kind: 'cooldown', duration_s: 600 };
  switch (session.type) {
    case 'strides':
      return [warmup, { repeat: session.reps, steps: [{ kind: 'work', duration_s: session.work_s },
        { kind: 'recovery', duration_s: 60 }] }, { kind: 'cooldown', duration_s: 300 }];
    case 'tempo':
      return [warmup, { kind: 'work', duration_s: session.work_s * session.reps, ...aim }, cooldown];
    case 'intervals':
      return [warmup, { repeat: session.reps, steps: [{ kind: 'work', duration_s: session.work_s, ...aim },
        { kind: 'recovery', duration_s: 120 }] }, cooldown];
    case 'goal_pace':
      return [warmup, { repeat: session.reps, steps: [{ kind: 'work', duration_s: session.work_s, ...aim },
        { kind: 'recovery', duration_s: 180 }] }, cooldown];
    case 'shakeout':
      return [{ kind: 'work', duration_s: 900 }, { repeat: session.reps, steps: [{ kind: 'work', duration_s: session.work_s },
        { kind: 'recovery', duration_s: 60 }] }];
  }
}

function slotTarget(slot: BuildRunSlot): RunStepTarget | undefined {
  const parsed = slot.run_steps ? parseRunSteps(slot.run_steps) : null;
  return parsed?.ok ? firstWorkTarget(parsed.items) : undefined;
}

/** A long run of one distance, keeping the pace or heart rate its slot aims
 * at; with `goal`, its last `goal.meters` aim at goal pace. */
function longRunTargets(slot: BuildRunSlot, meters: number,
  goal?: { meters: number; target: RunStepTarget }): Record<string, unknown> {
  const target = slotTarget(slot);
  const distance = Math.min(BUILD_LIMITS.longRunMeters.max, Math.max(100, Math.round(meters)));
  const easy = goal ? distance - goal.meters : distance;
  const steps: RunStep[] = [];
  if (easy > 0) steps.push({ kind: 'work', distance_m: easy, ...(target ? { target } : {}) });
  if (goal && goal.meters > 0) steps.push({ kind: 'work', distance_m: goal.meters, target: goal.target });
  return {
    run_steps: steps,
    // A slot timed by minutes would otherwise also stop the run on the clock.
    ...(slot.target_duration_s != null ? { target_duration_s: null } : {}),
  };
}

const WORKOUT_DAY_PREFERENCE: Weekday[] = ['wed', 'tue', 'thu', 'mon', 'fri', 'sat', 'sun'];

/** The run a workout day would change: its first workout with an outdoor run
 * other than the long run's. */
function dayRunWorkout(wd: Weekday, week: ScheduleWeek, extras: ScheduleExtras | undefined,
  hasRun: (id: string) => boolean, exclude: string | undefined): string | undefined {
  return [week[wd], ...(extras?.[wd] ?? [])].find((id): id is string => !!id && id !== exclude && hasRun(id));
}

/** The workout day the builder suggests: a run day other than the long-run
 * day whose run workout is on no other day, midweek first and not next to
 * the long run if it can; null when there is none. */
export function defaultWorkoutWeekday(longDay: Weekday, week: ScheduleWeek, extras: ScheduleExtras | undefined,
  runSlots: BuildRunSlot[]): Weekday | null {
  const runWorkouts = new Set(runSlots.map((slot) => slot.workout_id));
  const dayWorkouts = (wd: Weekday) => [week[wd], ...(extras?.[wd] ?? [])].filter((id): id is string => !!id);
  const longWorkout = dayWorkouts(longDay).find((id) => runWorkouts.has(id));
  const longIndex = WEEKDAYS.indexOf(longDay);
  const adjacent = (wd: Weekday) => {
    const gap = Math.abs(WEEKDAYS.indexOf(wd) - longIndex);
    return gap === 1 || gap === 6;
  };
  const candidates = WORKOUT_DAY_PREFERENCE.filter((wd) => {
    if (wd === longDay) return false;
    const id = dayRunWorkout(wd, week, extras, (x) => runWorkouts.has(x), longWorkout);
    return id !== undefined && !WEEKDAYS.some((other) => other !== wd && dayWorkouts(other).includes(id));
  });
  return candidates.find((wd) => !adjacent(wd)) ?? candidates[0] ?? null;
}

/**
 * Lay out the block. `week` and `extras` are the repeating week (Your week);
 * `runSlots` are the outdoor run slots of live workouts, in order.
 */
export function buildEventProgram(
  rules: BuildRules,
  name: string,
  week: ScheduleWeek,
  extras: ScheduleExtras | undefined,
  runSlots: BuildRunSlot[],
): BuildResult {
  if (weekdayOf(rules.start) !== 'mon') return { error: 'invalid_start' };
  if (!rules.open && rules.race_date < rules.start) return { error: 'event_before_start' };
  const n = rules.open ? rules.open.weeks : weeksToEvent(rules.start, rules.race_date);
  if (n < 1) return { error: 'invalid_start' };
  if (n > MAX_PROGRAM_WEEKS) return { error: 'too_many_weeks' };

  // Every pace the plan would aim at must be one a run step can hold, so a
  // goal time is never quietly swapped for a different effort.
  const pace = rules.open ? null : goalPace(rules);
  // Sessions are sized by the event; without one, by the ceiling.
  const sizing = rules.open ? (rules.peak_m >= LONG_RACE_M ? LONG_RACE_M : 10_000) : rules.race_distance_m;
  if (pace != null) {
    const factors = [1, tempoFactor(rules.race_distance_m), intervalFactor(rules.race_distance_m)];
    const { min, max } = RUN_STEP_LIMITS.paceSecondsPerKm;
    if (Math.round(pace * Math.min(...factors)) - 5 < min || Math.round(pace * Math.max(...factors)) + 5 > max) {
      return { error: 'goal_pace_out_of_range' };
    }
  }
  const slotsByWorkout = new Map<string, BuildRunSlot[]>();
  for (const slot of runSlots) {
    const list = slotsByWorkout.get(slot.workout_id) ?? [];
    list.push(slot);
    slotsByWorkout.set(slot.workout_id, list);
  }
  const dayWorkouts = (wd: Weekday) => [week[wd], ...(extras?.[wd] ?? [])].filter((id): id is string => !!id);
  const longDay = rules.long_run_weekday;
  const longWorkout = dayWorkouts(longDay).find((id) => slotsByWorkout.has(id));
  if (!longWorkout) return { error: 'no_long_run' };
  // A week's targets belong to the slot, so a long run workout that also
  // runs on another day would make that day long too.
  const shared = WEEKDAYS.find((wd) => wd !== longDay && dayWorkouts(wd).includes(longWorkout));
  if (shared) return { error: 'long_run_shared', weekday: shared };
  const longSlot = slotsByWorkout.get(longWorkout)![0]!;
  let workoutSlot: BuildRunSlot | undefined;
  const workoutDay = rules.workout_weekday ?? null;
  if (workoutDay) {
    const id = workoutDay === longDay ? undefined
      : dayRunWorkout(workoutDay, week, extras, (x) => slotsByWorkout.has(x), longWorkout);
    if (!id) return { error: 'no_workout_run' };
    const sharedDay = WEEKDAYS.find((wd) => wd !== workoutDay && dayWorkouts(wd).includes(id));
    if (sharedDay) return { error: 'workout_shared', weekday: sharedDay };
    workoutSlot = slotsByWorkout.get(id)![0]!;
  }
  const scheduled = new Set(WEEKDAYS.flatMap(dayWorkouts));
  const otherRuns = runSlots.filter((slot) => slot.id !== longSlot.id && slot.id !== workoutSlot?.id
    && scheduled.has(slot.workout_id));

  const plan = planLongRuns(rules, n);
  const goalTarget = pace == null ? undefined : paceTarget(pace);
  const phases = plan.weeks.map((item) => item.phase);
  const sessions = planWorkouts(phases, plan.weeks.map((item) => item.factor), sizing, pace != null);
  const ownTarget = workoutSlot ? slotTarget(workoutSlot) : undefined;
  const sessionTarget = (session: WorkoutSummary): RunStepTarget | undefined => {
    if (session.type === 'goal_pace') return goalTarget ?? ownTarget;
    if (session.type === 'tempo') {
      return ownTarget ?? (pace == null ? undefined : paceTarget(pace * tempoFactor(rules.race_distance_m)));
    }
    if (session.type === 'intervals') {
      return ownTarget ?? (pace == null ? undefined : paceTarget(pace * intervalFactor(rules.race_distance_m)));
    }
    return undefined;
  };
  const buildWeeks = phases.flatMap((phase, i) => (phase === 'build' ? [i] : []));
  // The share of a half or marathon long run run at goal pace, by week.
  const goalShare = (index: number): number => {
    if (pace == null || rules.race_distance_m < LONG_RACE_M) return 0;
    const phase = phases[index];
    if (phase === 'build') {
      const k = buildWeeks.indexOf(index);
      return 0.1 + 0.15 * (buildWeeks.length <= 1 ? 1 : k / (buildWeeks.length - 1));
    }
    if (phase === 'peak') return 0.3;
    if (phase === 'taper' && phases[index - 1] !== 'taper') return 0.2;
    return 0;
  };
  const workoutIndex = workoutDay ? WEEKDAYS.indexOf(workoutDay) : -1;
  const raceWeekday = rules.open ? 'sun' : weekdayOf(rules.race_date);
  const raceIndex = WEEKDAYS.indexOf(raceWeekday);
  const longIndex = WEEKDAYS.indexOf(longDay);
  const summaries: BuildWeekSummary[] = [];
  const weeks: BuiltProgramWeek[] = [];
  plan.weeks.forEach((item, index) => {
    const weekStart = addDays(rules.start, index * 7);
    const pattern: Partial<Record<Weekday, string | null>> = {};
    const patternExtras: Partial<Record<Weekday, string[]>> = {};
    for (const wd of WEEKDAYS) {
      pattern[wd] = week[wd];
      if (extras?.[wd]?.length) patternExtras[wd] = [...extras[wd]!];
    }
    let longMeters: number | null = toMeters(item.units, rules.unit);
    let goalMeters: number | null = null;
    const share = goalShare(index);
    if (share > 0 && item.units > 1) goalMeters = toMeters(Math.min(item.units - 1, Math.max(1, Math.round(item.units * share))), rules.unit);
    let session: WorkoutSummary | null = workoutSlot ? sessions[index]! : null;
    if (item.phase === 'race') {
      // The event is the day's training: nothing else that day unless it is
      // the long run itself, and rest after it.
      for (const wd of WEEKDAYS.slice(raceIndex)) {
        if (wd === longDay && wd === raceWeekday) continue;
        pattern[wd] = null;
        delete patternExtras[wd];
      }
      if (longIndex === raceIndex) {
        longMeters = rules.race_distance_m;
        // The race itself aims at goal pace, all of it.
        if (pace != null) goalMeters = Math.round(longMeters);
      } else if (longIndex > raceIndex) longMeters = null;
      else if (raceIndex - longIndex < 3) longMeters = toMeters(Math.max(1, Math.round(plan.peak_units * 0.15)), rules.unit);
      if (workoutIndex >= raceIndex) session = null;
    }
    if (longMeters == null) goalMeters = null;
    const targets: Record<string, Record<string, unknown>> = {};
    if (longMeters != null && longMeters <= BUILD_LIMITS.longRunMeters.max) {
      targets[longSlot.id] = longRunTargets(longSlot, longMeters,
        goalMeters != null && goalTarget ? { meters: Math.min(goalMeters, Math.round(longMeters)), target: goalTarget } : undefined);
    }
    if (workoutSlot && session) {
      targets[workoutSlot.id] = {
        run_steps: workoutSteps(session, sessionTarget(session)),
        ...(workoutSlot.target_duration_s != null ? { target_duration_s: null } : {}),
      };
    }
    if (rules.shorten_other_runs) {
      for (const slot of otherRuns) {
        const scaled = scaleRun(slot, item.factor);
        if (scaled) targets[slot.id] = scaled;
      }
    }
    const label = BUILD_PHASE_LABELS[item.phase];
    summaries.push({ start: weekStart, phase: item.phase, label, long_run_m: longMeters,
      long_run_goal_m: goalMeters, workout: session, factor: item.factor });
    weeks.push({ label, week: pattern, extras: patternExtras,
      ...(Object.keys(targets).length > 0 ? { targets } : {}) });
  });
  return {
    ok: true,
    weeks: summaries,
    reached_peak: plan.reached_peak,
    long_run_slot: longSlot.id,
    program: { name, start: rules.start, repeat: false, weeks },
  };
}
