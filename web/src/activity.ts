/**
 * The Activity page, as the iPhone app's Activity tab reads it
 * (ios/TresFort/ActivityHistory.swift and ActivitySummary.swift): one list of
 * everything the member has done (workouts finished in Très Fort, runs, rides
 * and other activities from any source, and activities logged by hand), and
 * this week's summary, the highlights and the last weeks' training time from
 * that same list, so the numbers never disagree with it. Pure, so the page
 * and the tests share one set of rules.
 */
import { addDays, weekdayOf } from '../../src/calendarProjection';
import { sportLabel } from '../../src/sports';
import { WEEKDAYS, type ActivityRow, type SetLogRow } from '../../src/types';
import { sameLoad } from '../../src/workoutSummary';
import type { StateActivity, StateResponse } from './api';
import {
  activityLoad,
  isEffortLoad,
  calendarInputs,
  formatClock,
  isRunOnlyWorkout,
  matchingRun,
  projectRange,
  type Workout,
} from './model';

export type Family = 'strength' | 'endurance' | 'sport';
export const FAMILIES: Family[] = ['strength', 'endurance', 'sport'];
export const FAMILY_LABELS: Record<Family, string> = {
  strength: 'Strength', endurance: 'Endurance', sport: 'Sports',
};

export type Category = 'workouts' | 'runs' | 'rides' | 'swims' | 'walks' | 'other';
export const CATEGORIES: Category[] = ['workouts', 'runs', 'rides', 'swims', 'walks', 'other'];
export const CATEGORY_LABELS: Record<Category, string> = {
  workouts: 'Workouts', runs: 'Runs', rides: 'Rides', swims: 'Swims', walks: 'Walks', other: 'Other',
};

/** Kinds that count as endurance (iOS EnduranceProgress.enduranceKinds). */
const ENDURANCE_KINDS = new Set(['run', 'ride', 'swim', 'walk', 'hike', 'row', 'ski', 'elliptical']);

/** A run, ride, swim or walk kind from any source; a logged lift is a workout. */
export function categoryOf(kind: string): Category {
  switch (kind) {
    case 'run': return 'runs';
    case 'ride': return 'rides';
    case 'swim': return 'swims';
    case 'walk': case 'hike': return 'walks';
    case 'lift': case 'strength': return 'workouts';
    default: return 'other';
  }
}

/** Strength workouts from other apps count as strength, never endurance. */
export function familyOf(kind: string): Family {
  if (ENDURANCE_KINDS.has(kind)) return 'endurance';
  if (kind === 'lift' || kind === 'strength') return 'strength';
  return 'sport';
}

export interface Entry {
  /** `workout:<session>`, `activity:<id>` or `logged:<id>`. */
  key: string;
  /** The session, activity or logged row id. */
  id: string;
  kind: 'workout' | 'activity' | 'logged';
  date: string;
  category: Category;
  family: Family;
  title: string;
  /** Facts after the date, such as "3.3 mi", "25m", "7:47 /mi". */
  details: string[];
  attribution: string | null;
  inProgress: boolean;
  /** Moving time, or a workout's start to finish; 0 when unknown. */
  seconds: number;
  meters: number | null;
  /** The shown load; null when unknown, never a guess. */
  load: number | null;
  /** True when that load is an estimate from the member's effort rating,
   * which every view must label as one. */
  loadEstimated?: boolean;
  /** The provider kind of an activity; null for workouts and logged rows. */
  activityKind: string | null;
  /** An activity's local start (epoch-ms), to order same-day records; absent when unknown. */
  startedAt?: number | null;
}

/** A workout record longer than this was most likely left open. */
export const LONGEST_WORKOUT_SECONDS = 4 * 3600;

const METERS_PER_MILE = 1609.344;

/** "2h 15m", "45m" or "0m". */
export function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return m > 0 ? `${h}h ${m}m` : `${h}h`;
  return `${m}m`;
}

/** Swims in yards or meters to match the member's units; else mi or km. */
export function formatActivityDistance(meters: number | null | undefined, kind: string, miles: boolean): string | null {
  if (meters === null || meters === undefined || !Number.isFinite(meters) || meters <= 0) return null;
  if (kind === 'swim') {
    const value = miles ? meters / 0.9144 : meters;
    return `${Math.round(value).toLocaleString('en-US')} ${miles ? 'yd' : 'm'}`;
  }
  return `${(meters / (miles ? METERS_PER_MILE : 1000)).toFixed(1)} ${miles ? 'mi' : 'km'}`;
}

/** Moving time, else elapsed time. */
export function activitySeconds(activity: StateActivity): number {
  return Math.max(0, activity.moving_time_sec ?? activity.elapsed_time_sec ?? 0);
}

/** Pace for runs and walks ("7:47 /mi"), speed for rides ("18.6 mph"), pace
 * per 100 for swims ("1:52 /100yd", in yards with miles; iOS
 * EnduranceProgress.pace). */
export function formatPace(activity: Pick<StateActivity, 'kind' | 'distance_m'> & { seconds: number }, miles: boolean): string | null {
  const meters = activity.distance_m;
  const seconds = activity.seconds;
  if (!meters || meters <= 0 || seconds <= 0) return null;
  const unit = miles ? METERS_PER_MILE : 1000;
  if (activity.kind === 'ride') {
    return `${((meters / unit) / (seconds / 3600)).toFixed(1)} ${miles ? 'mph' : 'km/h'}`;
  }
  if (activity.kind === 'run' || activity.kind === 'walk' || activity.kind === 'hike') {
    const pace = seconds / (meters / unit);
    if (pace >= 3600) return null;
    return `${formatClock(Math.round(pace))} /${miles ? 'mi' : 'km'}`;
  }
  if (activity.kind === 'swim') {
    const pace = Math.round(seconds / (meters / (miles ? 91.44 : 100)));
    if (pace < 1 || pace > 7 * 24 * 3600) return null;
    return `${formatClock(pace)} /100${miles ? 'yd' : 'm'}`;
  }
  return null;
}

/** Its own name, else its sport, else the kind (iOS Sports.title). */
export function activityTitle(activity: Pick<StateActivity, 'name' | 'kind'> & { sport?: string | null }): string {
  const sport = activity.sport && activity.sport !== 'other' ? sportLabel(activity.sport) : null;
  const name = activity.name;
  if (name && !(name === 'Workout' && sport)) return name;
  return sport ?? capitalize(activity.kind);
}

/** What a hand-logged kind is called (iOS PendingActivity.label). */
export function loggedLabel(type: string): string {
  switch (type) {
    case 'lift': return 'Lift (other)';
    case 'other': return 'Other';
    case 'pilates': case 'cardio': case 'yoga': case 'walk': case 'hike': case 'run': case 'ride': case 'swim':
      return capitalize(type);
    default: return sportLabel(type) ?? capitalize(type);
  }
}

function capitalize(text: string): string {
  return text.replace(/(^|[\s_])(\w)/g, (_, gap: string, c: string) => `${gap === '_' ? ' ' : gap}${c.toUpperCase()}`);
}

/** Live (not removed) sets per session. */
export function setCounts(sets: SetLogRow[] | undefined): Map<string, number> {
  const out = new Map<string, number>();
  for (const set of sets ?? []) {
    if (set.deleted_at !== null) continue;
    out.set(set.session_id, (out.get(set.session_id) ?? 0) + 1);
  }
  return out;
}

/**
 * Everything the member has done up to today, newest first; on one date the
 * workout, then activities, then logged ones. A finished run workout is its
 * run, so the run is listed once, with its distance and pace. Today on a trip
 * without training hides what a provider still reports, as the calendar does.
 */
export function buildHistory(state: StateResponse, today: string, miles: boolean): Entry[] {
  const workouts = new Map<string, Workout>((state.plan?.workouts ?? []).map((w) => [w.id, w]));
  const inputs = calendarInputs(state);
  const todayCell = inputs ? projectRange(inputs, today, today, today).get(today) : undefined;
  const hidden = (date: string) => date === today && todayCell?.suppresses_schedule_and_endurance === true;

  const activities = state.external_activities.filter((a) => a.deleted_at === null && a.date <= today && !hidden(a.date));
  const activitiesByDate = new Map<string, StateActivity[]>();
  for (const a of activities) activitiesByDate.set(a.date, [...(activitiesByDate.get(a.date) ?? []), a]);
  const counts = setCounts(state.sets);
  const out: { entry: Entry; order: number }[] = [];

  // A retry or correction must not list a session twice.
  const current = new Map<string, StateResponse['sessions'][number]>();
  for (const s of state.sessions) {
    const seen = current.get(s.id);
    if (!seen || (s.updated_at ?? 0) > (seen.updated_at ?? 0)) current.set(s.id, s);
  }
  for (const session of current.values()) {
    if (session.date > today) continue;
    const count = counts.get(session.id) ?? 0;
    const inProgress = session.status === 'in_progress';
    if (!(session.status === 'completed' || (inProgress && count > 0))) continue;
    const workout = session.workout_id ? workouts.get(session.workout_id) : undefined;
    const runOnly = workout ? isRunOnlyWorkout(workout) : false;
    if (!inProgress && runOnly && matchingRun(workout?.name, activitiesByDate.get(session.date) ?? [])) continue;
    const title = workout?.name ?? (session.kind === 'freestyle' ? 'Freestyle workout' : 'Workout');
    const details = [`${count} ${count === 1 ? 'set' : 'sets'}`];
    let seconds = 0;
    const start = session.started_at;
    const end = session.completed_at;
    if (!inProgress && start && end && start > 0 && end > start) {
      const elapsed = Math.floor((end - start) / 1000);
      details.push(formatDuration(elapsed));
      if (elapsed <= LONGEST_WORKOUT_SECONDS) seconds = elapsed;
    }
    out.push({
      order: 0,
      entry: {
        key: `workout:${session.id}`, id: session.id, kind: 'workout', date: session.date,
        category: 'workouts', family: runOnly ? 'endurance' : 'strength', title, details,
        attribution: null, inProgress, seconds, meters: null, load: null, activityKind: null,
      },
    });
  }

  for (const activity of activities) {
    const seconds = activitySeconds(activity);
    const details: string[] = [];
    const distance = formatActivityDistance(activity.distance_m, activity.kind, miles);
    if (distance) details.push(distance);
    if (seconds > 0) details.push(formatDuration(seconds));
    const pace = formatPace({ ...activity, seconds }, miles);
    if (pace) details.push(pace);
    const shown = activityLoad(activity);
    const meters = activity.distance_m;
    out.push({
      order: 1,
      entry: {
        key: `activity:${activity.id}`, id: activity.id, kind: 'activity', date: activity.date,
        category: categoryOf(activity.kind), family: familyOf(activity.kind), title: activityTitle(activity),
        details, attribution: activity.source_attribution ?? null, inProgress: false, seconds,
        meters: meters !== null && meters !== undefined && Number.isFinite(meters) && meters > 0 ? meters : null,
        load: shown ? Math.round(shown.load) : null, loadEstimated: isEffortLoad(shown), activityKind: activity.kind,
        startedAt: activity.start_date_local_ms ?? activity.start_date_utc_ms ?? null,
      },
    });
  }

  for (const row of state.activities ?? []) {
    if (row.deleted_at !== null || row.date > today || hidden(row.date)) continue;
    const label = loggedLabel(row.type);
    const title = row.title?.trim();
    const details: string[] = [];
    const minutes = row.duration_minutes ?? 0;
    if (minutes > 0) details.push(formatDuration(minutes * 60));
    if (title && title !== label) details.push(label);
    out.push({
      order: 2,
      entry: {
        key: `logged:${row.id}`, id: row.id, kind: 'logged', date: row.date,
        category: categoryOf(row.type), family: familyOf(row.type), title: title || label, details,
        attribution: null, inProgress: false, seconds: Math.max(0, minutes) * 60,
        meters: null, load: null, activityKind: null,
      },
    });
  }

  return out.sort((a, b) => {
    if (a.entry.date !== b.entry.date) return a.entry.date > b.entry.date ? -1 : 1;
    if (a.order !== b.order) return a.order - b.order;
    if (a.entry.title !== b.entry.title) return a.entry.title < b.entry.title ? -1 : 1;
    return a.entry.key < b.entry.key ? -1 : a.entry.key > b.entry.key ? 1 : 0;
  }).map((x) => x.entry);
}

/** Kinds present in the history, in a fixed order. */
export function presentCategories(entries: Entry[]): Category[] {
  const present = new Set(entries.map((e) => e.category));
  return CATEGORIES.filter((c) => present.has(c));
}

export interface Month {
  /** `YYYY-MM`. */
  id: string;
  entries: Entry[];
}

/** Entries in one category (all for null), by month, newest first. */
export function byMonth(entries: Entry[], category: Category | null = null): Month[] {
  const months: Month[] = [];
  for (const entry of entries) {
    if (category && entry.category !== category) continue;
    const id = entry.date.slice(0, 7);
    const last = months[months.length - 1];
    if (last?.id === id) last.entries.push(entry);
    else months.push({ id, entries: [entry] });
  }
  return months;
}

// ---- summary --------------------------------------------------------------

export type FamilySeconds = Partial<Record<Family, number>>;

export interface SummaryDay {
  date: string;
  seconds: FamilySeconds;
  sessions: number;
  isToday: boolean;
  isFuture: boolean;
}

export interface SummaryWeek {
  /** Monday. */
  start: string;
  /** Sunday, or today for the current week. */
  end: string;
  seconds: FamilySeconds;
  sessions: number;
  isCurrent: boolean;
}

export interface Summary {
  /** Monday to Sunday of this week. */
  days: SummaryDay[];
  /** Oldest first, ending with this week. */
  weeks: SummaryWeek[];
  /** Consecutive weeks with any training, ending this week (or last week
   * while this one is still empty). */
  streak: number;
  /** This week's time minus last week's up to the same weekday. */
  changeSeconds: number;
  /** The kind with the most time this week (swims included), then the most
   * distance, run before ride on a tie (iOS ActivitySummary.distance). */
  distance: { meters: number; kind: string } | null;
  /** Known loads summed; null when nothing this week has one. */
  load: number | null;
}

export const totalSeconds = (seconds: FamilySeconds) => FAMILIES.reduce((sum, f) => sum + (seconds[f] ?? 0), 0);

export function mondayOf(date: string): string {
  return addDays(date, -WEEKDAYS.indexOf(weekdayOf(date)));
}

function familySeconds(entries: Entry[]): FamilySeconds {
  const out: FamilySeconds = {};
  for (const e of entries) if (e.seconds > 0) out[e.family] = (out[e.family] ?? 0) + e.seconds;
  return out;
}

export function summarize(entries: Entry[], today: string, weekCount = 8): Summary {
  const monday = mondayOf(today);
  const counted = entries.filter((e) => e.date <= today);
  const between = (from: string, to: string) => counted.filter((e) => e.date >= from && e.date <= to);

  const days = Array.from({ length: 7 }, (_, i) => {
    const date = addDays(monday, i);
    const items = between(date, date);
    return { date, seconds: familySeconds(items), sessions: items.length, isToday: date === today, isFuture: date > today };
  });

  const weeks = Array.from({ length: weekCount }, (_, i) => {
    const offset = weekCount - 1 - i;
    const start = addDays(monday, -offset * 7);
    const end = offset === 0 ? today : addDays(start, 6);
    const items = between(start, end);
    return { start, end, seconds: familySeconds(items), sessions: items.length, isCurrent: offset === 0 };
  });

  const thisWeek = between(monday, today);
  const lastWeekSoFar = between(addDays(monday, -7), addDays(today, -7));
  const sum = (items: Entry[]) => items.reduce((total, e) => total + e.seconds, 0);
  const changeSeconds = sum(thisWeek) - sum(lastWeekSoFar);

  // Swims count too: a swimmer's yards are their distance. Kinds are compared
  // by time, since yards and miles don't compare.
  const metersByKind = new Map<string, number>();
  const secondsByKind = new Map<string, number>();
  for (const e of thisWeek) {
    if (!e.activityKind || e.meters === null) continue;
    metersByKind.set(e.activityKind, (metersByKind.get(e.activityKind) ?? 0) + e.meters);
    secondsByKind.set(e.activityKind, (secondsByKind.get(e.activityKind) ?? 0) + e.seconds);
  }
  const rank = (kind: string) => ({ run: 0, ride: 1 } as Record<string, number>)[kind] ?? 9;
  let distance: Summary['distance'] = null;
  let distanceSeconds = 0;
  for (const [kind, meters] of metersByKind) {
    if (meters <= 0) continue;
    const seconds = secondsByKind.get(kind) ?? 0;
    if (!distance || seconds > distanceSeconds
      || (seconds === distanceSeconds && (meters > distance.meters
        || (meters === distance.meters && (rank(kind) < rank(distance.kind) || (rank(kind) === rank(distance.kind) && kind < distance.kind)))))) {
      distance = { meters, kind };
      distanceSeconds = seconds;
    }
  }

  const loads = thisWeek.flatMap((e) => (e.load === null ? [] : [e.load]));
  const load = loads.length ? loads.reduce((a, b) => a + b, 0) : null;

  const activeWeeks = new Set(counted.map((e) => mondayOf(e.date)));
  let cursor = activeWeeks.has(monday) ? monday : addDays(monday, -7);
  let streak = 0;
  while (activeWeeks.has(cursor)) {
    streak += 1;
    cursor = addDays(cursor, -7);
  }

  return { days, weeks, streak, changeSeconds, distance, load };
}

/** Mean time over the finished weeks; the current week is still running. */
export function averageWeekSeconds(summary: Summary): number {
  const finished = summary.weeks.slice(0, -1);
  if (!finished.length) return 0;
  return Math.floor(finished.reduce((sum, w) => sum + totalSeconds(w.seconds), 0) / finished.length);
}

/** "1h 22m more than this time last week", "20m less …", or "Same as …". */
export function changeText(seconds: number): string {
  if (Math.abs(seconds) < 60) return 'Same as this time last week';
  return `${formatDuration(Math.abs(seconds))} ${seconds > 0 ? 'more' : 'less'} than this time last week`;
}

// ---- highlights -----------------------------------------------------------

export const HIGHLIGHT_WINDOW_DAYS = 30;
/** Shorter runs don't count for pace, so a sprint or GPS blip can't win. */
export const SHORTEST_PACE_RUN_METERS = 1600;

export interface RunHighlight {
  entry: Entry;
  meters: number;
  seconds: number;
}

/** A working set heavier than any earlier set of that exercise. */
export interface LiftHighlight {
  exerciseId: string;
  sessionId: string;
  date: string;
  weight: number;
  reps: number;
  unit: 'lb' | 'kg';
  previousWeight: number;
  previousUnit: 'lb' | 'kg';
}

export interface Highlights {
  fastestRun: RunHighlight | null;
  longestRun: RunHighlight | null;
  newBest: LiftHighlight | null;
}

const KG_IN_LB = 2.20462;
const pounds = (weight: number, unit: 'lb' | 'kg') => (unit === 'kg' ? weight * KG_IN_LB : weight);

/** True when set `a` is a heavier physical load than `b`; a 24 kg bell logged
 * as 53 lb is the same load, not a heavier one (`sameLoad`). */
function heavier(a: SetLogRow, b: SetLogRow): boolean {
  const au = a.weight_unit ?? 'lb';
  const bu = b.weight_unit ?? 'lb';
  return pounds(a.weight, au) > pounds(b.weight, bu) + 0.01 && !sameLoad({ weight: a.weight, unit: au }, { weight: b.weight, unit: bu });
}

export function findHighlights(
  entries: Entry[],
  sets: SetLogRow[],
  sessionDates: Map<string, string>,
  today: string,
  countsAsLoaded: (exerciseId: string) => boolean = () => true,
): Highlights {
  const since = addDays(today, -(HIGHLIGHT_WINDOW_DAYS - 1));
  const runs: RunHighlight[] = entries
    .filter((e) => e.kind === 'activity' && e.activityKind === 'run' && e.date >= since && e.date <= today && (e.meters ?? 0) > 0)
    .map((entry) => ({ entry, meters: entry.meters!, seconds: entry.seconds }));
  const later = (a: RunHighlight, b: RunHighlight) =>
    a.entry.date !== b.entry.date ? a.entry.date > b.entry.date : a.entry.key > b.entry.key;
  let fastestRun: RunHighlight | null = null;
  for (const run of runs) {
    if (run.seconds <= 0 || run.meters < SHORTEST_PACE_RUN_METERS) continue;
    if (!fastestRun) { fastestRun = run; continue; }
    const pace = run.seconds / run.meters;
    const best = fastestRun.seconds / fastestRun.meters;
    if (pace < best || (pace === best && later(run, fastestRun))) fastestRun = run;
  }
  let longestRun: RunHighlight | null = null;
  for (const run of runs) {
    if (!longestRun || run.meters > longestRun.meters || (run.meters === longestRun.meters && later(run, longestRun))) longestRun = run;
  }
  return { fastestRun, longestRun, newBest: newBest(sets, sessionDates, since, today, countsAsLoaded) };
}

/**
 * The most recent working set in the window that was heavier, as a physical
 * load, than every earlier set of its exercise. A first-ever set has nothing
 * to beat yet.
 */
export function newBest(
  sets: SetLogRow[],
  sessionDates: Map<string, string>,
  since: string,
  today: string,
  countsAsLoaded: (exerciseId: string) => boolean,
): LiftHighlight | null {
  const byExercise = new Map<string, { row: SetLogRow; date: string }[]>();
  for (const row of sets) {
    if (row.deleted_at !== null || row.is_warmup !== 0 || row.is_timed === 1) continue;
    if (!(row.weight > 0 && row.reps > 0) || !countsAsLoaded(row.exercise_id)) continue;
    const date = sessionDates.get(row.session_id);
    if (!date || date > today) continue;
    byExercise.set(row.exercise_id, [...(byExercise.get(row.exercise_id) ?? []), { row, date }]);
  }
  let best: LiftHighlight | null = null;
  let bestKey: [string, number] | null = null;
  for (const [exerciseId, rows] of byExercise) {
    rows.sort((a, b) => (a.date !== b.date ? (a.date < b.date ? -1 : 1) : a.row.logged_at - b.row.logged_at));
    let heaviest: SetLogRow | null = null;
    for (const { row, date } of rows) {
      const unit = row.weight_unit ?? 'lb';
      if (!heaviest) { heaviest = row; continue; }
      const previousUnit = heaviest.weight_unit ?? 'lb';
      if (heavier(row, heaviest)) {
        const isLatest = !bestKey || (date !== bestKey[0] ? date > bestKey[0] : row.logged_at > bestKey[1]);
        if (date >= since && isLatest) {
          best = {
            exerciseId, sessionId: row.session_id, date, weight: row.weight, reps: row.reps, unit,
            previousWeight: heaviest.weight, previousUnit,
          };
          bestKey = [date, row.logged_at];
        }
        heaviest = row;
      }
    }
  }
  return best;
}

/** The pace of a highlighted run, "7:12 /mi". */
export function runPace(run: RunHighlight, miles: boolean): string {
  const pace = run.seconds / (run.meters / (miles ? METERS_PER_MILE : 1000));
  return `${formatClock(Math.round(pace))} /${miles ? 'mi' : 'km'}`;
}

// ---- one entry's record ------------------------------------------------------

export interface SetLine {
  id: string;
  text: string;
  warmup: boolean;
}

export interface ExerciseSets {
  exerciseId: string;
  sets: SetLine[];
}

/** "225 lb × 5", "45 lb × 8 · RPE 8", or a timed hold "0:45". */
export function describeSet(set: SetLogRow): string {
  let text: string;
  if (set.is_timed === 1 && set.duration_s) {
    text = formatClock(set.duration_s);
    if (set.weight > 0) text += ` @ ${trim(set.weight)} ${set.weight_unit ?? 'lb'}`;
  } else if (set.weight > 0) {
    text = `${trim(set.weight)} ${set.weight_unit ?? 'lb'} × ${set.reps}`;
  } else {
    text = `${set.reps} ${set.reps === 1 ? 'rep' : 'reps'}`;
  }
  if (set.rpe !== null) text += ` · RPE ${trim(set.rpe)}`;
  return text;
}

function trim(value: number): string {
  return String(Math.round(value * 100) / 100);
}

/** A session's live sets, by exercise in the order they were first logged. */
export function sessionSets(sets: SetLogRow[] | undefined, sessionId: string): ExerciseSets[] {
  const rows = (sets ?? [])
    .filter((s) => s.session_id === sessionId && s.deleted_at === null)
    .sort((a, b) => a.logged_at - b.logged_at || a.set_index - b.set_index);
  const groups = new Map<string, ExerciseSets>();
  for (const row of rows) {
    const group = groups.get(row.exercise_id) ?? { exerciseId: row.exercise_id, sets: [] };
    group.sets.push({ id: row.id, text: describeSet(row), warmup: row.is_warmup === 1 });
    groups.set(row.exercise_id, group);
  }
  return [...groups.values()];
}

/** A logged activity's own facts, for its record. */
export function loggedFacts(row: ActivityRow): { label: string; value: string }[] {
  const facts: { label: string; value: string }[] = [];
  const seconds = row.duration_s ?? (row.duration_minutes ? row.duration_minutes * 60 : 0);
  if (seconds > 0) facts.push({ label: 'Time', value: formatDuration(seconds) });
  if (row.avg_hr) facts.push({ label: 'Avg heart rate', value: `${Math.round(row.avg_hr)} bpm` });
  if (row.calories) facts.push({ label: 'Calories', value: `${Math.round(row.calories)} kcal` });
  return facts;
}

/** "Today", "Yesterday" or "Thu, Nov 5". */
export function whenText(date: string, today: string): string {
  if (date === today) return 'Today';
  if (date === addDays(today, -1)) return 'Yesterday';
  return dayTitle(date);
}

export function dayTitle(date: string): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

/** "Nov 2 – 8". */
export function weekRange(start: string, end: string): string {
  const toDate = (s: string) => {
    const [y, m, d] = s.split('-').map(Number) as [number, number, number];
    return new Date(y, m - 1, d);
  };
  const format = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });
  return format.formatRange ? format.formatRange(toDate(start), toDate(end)) : `${format.format(toDate(start))} – ${format.format(toDate(end))}`;
}

// ---- history cards ------------------------------------------------------------

/** What an entry is, in a word, above its title on a history card. */
export function kindLabel(entry: Entry): string {
  switch (entry.category) {
    case 'workouts': return 'Workout';
    case 'runs': return 'Run';
    case 'rides': return 'Ride';
    case 'swims': return 'Swim';
    case 'walks': return 'Walk';
    default: return entry.family === 'sport' ? 'Sport' : 'Activity';
  }
}

export interface CardStat {
  label: string;
  value: string;
}

/** An activity's headline numbers for its history card. */
export function activityCardStats(activity: StateActivity, miles: boolean): CardStat[] {
  const stats: CardStat[] = [];
  const seconds = activitySeconds(activity);
  const distance = formatActivityDistance(activity.distance_m, activity.kind, miles);
  if (distance) stats.push({ label: 'Distance', value: distance });
  if (seconds > 0) stats.push({ label: 'Time', value: formatDuration(seconds) });
  const pace = formatPace({ ...activity, seconds }, miles);
  if (pace) stats.push({ label: activity.kind === 'ride' ? 'Speed' : 'Pace', value: pace });
  if (activity.average_hr) stats.push({ label: 'Avg HR', value: `${Math.round(activity.average_hr)} bpm` });
  const load = activityLoad(activity);
  // An effort rating's load is an estimate, never shown as a measured one.
  if (load) stats.push({ label: isEffortLoad(load) ? 'Est. load' : 'Load', value: String(Math.round(load.load)) });
  return stats;
}

/** One exercise of a workout card: "Goblet Squat", "3 sets · best 62 lb × 10". */
export interface ExerciseLine {
  exerciseId: string;
  text: string;
}

/**
 * Each exercise's working sets and heaviest set (as a physical load), in the
 * order they were logged. Warm-ups don't count; a timed hold shows its
 * longest time.
 */
export function exerciseLines(sets: SetLogRow[] | undefined, sessionId: string): ExerciseLine[] {
  const rows = (sets ?? [])
    .filter((s) => s.session_id === sessionId && s.deleted_at === null)
    .sort((a, b) => a.logged_at - b.logged_at || a.set_index - b.set_index);
  const order: string[] = [];
  const byExercise = new Map<string, SetLogRow[]>();
  for (const row of rows) {
    if (!byExercise.has(row.exercise_id)) { order.push(row.exercise_id); byExercise.set(row.exercise_id, []); }
    byExercise.get(row.exercise_id)!.push(row);
  }
  return order.map((exerciseId) => {
    const all = byExercise.get(exerciseId)!;
    const working = all.filter((s) => s.is_warmup === 0);
    const counted = working.length ? working : all;
    const sets = `${counted.length} ${counted.length === 1 ? 'set' : 'sets'}`;
    const timed = counted.filter((s) => s.is_timed === 1 && s.duration_s);
    if (timed.length) {
      return { exerciseId, text: `${sets} · up to ${formatClock(Math.max(...timed.map((s) => s.duration_s!)))}` };
    }
    const loaded = counted.filter((s) => s.weight > 0);
    if (loaded.length) {
      const best = loaded.reduce((a, b) => {
        const pa = pounds(a.weight, a.weight_unit ?? 'lb');
        const pb = pounds(b.weight, b.weight_unit ?? 'lb');
        return pb > pa || (pb === pa && b.reps > a.reps) ? b : a;
      });
      return { exerciseId, text: `${sets} · best ${trim(best.weight)} ${best.weight_unit ?? 'lb'} × ${best.reps}` };
    }
    const reps = counted.reduce((sum, s) => sum + s.reps, 0);
    return { exerciseId, text: `${sets} · ${reps} ${reps === 1 ? 'rep' : 'reps'}` };
  });
}

/** Activities whose route may be drawn on their card (iOS ActivityRecentCard). */
const CARD_ROUTE_KINDS = new Set(['run', 'ride', 'walk', 'hike']);
const CARD_ROUTE_SOURCES = new Set(['recording', 'intervals', 'healthkit']);
export function mayHaveRoute(activity: StateActivity): boolean {
  return activity.deleted_at === null && (activity.distance_m ?? 0) > 0
    && ((CARD_ROUTE_KINDS.has(activity.kind) && CARD_ROUTE_SOURCES.has(activity.source))
      // An open-water swim's track (sport-activities P4): the Apple Health
      // route, also behind the copy it was matched to, or intervals.icu's.
      || activity.kind === 'swim');
}

// ---- orientation while scrolling ---------------------------------------------

export interface Totals {
  sessions: number;
  seconds: number;
  /** Run distance; null without any. */
  runMeters: number | null;
}

/** Sessions, known training time and run distance of some entries. */
export function totalsOf(entries: Entry[]): Totals {
  let seconds = 0;
  let runMeters: number | null = null;
  for (const e of entries) {
    seconds += e.seconds;
    if (e.activityKind === 'run' && e.meters !== null) runMeters = (runMeters ?? 0) + e.meters;
  }
  return { sessions: entries.length, seconds, runMeters };
}

/** "7 sessions · 5h 40m · 12.4 mi run". */
export function totalsText(totals: Totals, miles: boolean): string {
  const parts = [`${totals.sessions} ${totals.sessions === 1 ? 'session' : 'sessions'}`];
  if (totals.seconds >= 60) parts.push(formatDuration(totals.seconds));
  const run = totals.runMeters === null ? null : formatActivityDistance(totals.runMeters, 'run', miles);
  if (run) parts.push(`${run} run`);
  return parts.join(' · ');
}

export interface WeekGroup {
  /** Monday. */
  start: string;
  entries: Entry[];
}

/** A month's entries split by Monday-to-Sunday week, newest first. */
export function byWeek(entries: Entry[]): WeekGroup[] {
  const weeks: WeekGroup[] = [];
  for (const entry of entries) {
    const start = mondayOf(entry.date);
    const last = weeks[weeks.length - 1];
    if (last?.start === start) last.entries.push(entry);
    else weeks.push({ start, entries: [entry] });
  }
  return weeks;
}

// ---- records ---------------------------------------------------------------

/** A record an entry set when it happened: all-time, or the best in a while. */
export interface Badge {
  label: string;
  /** `all`: better than everything before it; `recent`: the best in RECENT_RECORD_DAYS. */
  tier: 'all' | 'recent';
}

export const RECENT_RECORD_DAYS = 90;
/** A best-in-a-while needs this many earlier sessions of its kind in the window. */
export const RECENT_RECORD_MIN_EARLIER = 3;

const DISTANCE_NOUNS: Record<string, string> = { run: 'run', ride: 'ride', walk: 'walk', hike: 'hike', swim: 'swim' };

/**
 * The records each entry set as of its own date, so an old run that was the
 * longest at the time keeps its badge: the longest run, ride, walk, hike or
 * swim, the fastest run pace (a mile or more), and a lift's heaviest working
 * set (a PR). A first-ever session has nothing to beat, so it sets none.
 */
export function findRecords(
  entries: Entry[],
  sets: SetLogRow[] | undefined,
  sessionDates: Map<string, string>,
  countsAsLoaded: (exerciseId: string) => boolean,
  exerciseName: (exerciseId: string) => string,
): Map<string, Badge[]> {
  const out = new Map<string, Badge[]>();
  const add = (key: string, badge: Badge) => out.set(key, [...(out.get(key) ?? []), badge]);
  const ascending = [...entries].sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    const at = a.startedAt ?? null;
    const bt = b.startedAt ?? null;
    if (at !== null && bt !== null && at !== bt) return at - bt;
    return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
  });

  const best = (kind: string, value: (e: Entry) => number | null, all: string, recent: string) => {
    const seen: { date: string; value: number }[] = [];
    for (const e of ascending) {
      if (e.kind !== 'activity' || e.activityKind !== kind) continue;
      const v = value(e);
      if (v === null) continue;
      if (seen.length > 0 && seen.every((s) => v > s.value)) {
        add(e.key, { label: all, tier: 'all' });
      } else {
        const since = addDays(e.date, -RECENT_RECORD_DAYS);
        const window = seen.filter((s) => s.date >= since);
        if (window.length >= RECENT_RECORD_MIN_EARLIER && window.every((s) => v > s.value)) add(e.key, { label: recent, tier: 'recent' });
      }
      seen.push({ date: e.date, value: v });
    }
  };
  for (const [kind, noun] of Object.entries(DISTANCE_NOUNS)) {
    best(kind, (e) => e.meters, `Longest ${noun} yet`, `Longest ${noun} in ${RECENT_RECORD_DAYS} days`);
  }
  // Pace as speed, so "more is better" holds; shorter runs can't win.
  best('run', (e) => (e.meters !== null && e.meters >= SHORTEST_PACE_RUN_METERS && e.seconds > 0 ? e.meters / e.seconds : null),
    'Fastest run yet', `Fastest run in ${RECENT_RECORD_DAYS} days`);

  // Lift PRs: a working set heavier, as a physical load, than any earlier set of its exercise.
  const workoutKeys = new Set(entries.filter((e) => e.kind === 'workout').map((e) => e.key));
  const rows = (sets ?? [])
    .filter((s) => s.deleted_at === null && s.is_warmup === 0 && s.is_timed !== 1 && s.weight > 0 && s.reps > 0 && countsAsLoaded(s.exercise_id))
    .flatMap((row) => {
      const date = sessionDates.get(row.session_id);
      return date ? [{ row, date }] : [];
    })
    .sort((a, b) => (a.date !== b.date ? (a.date < b.date ? -1 : 1) : a.row.logged_at - b.row.logged_at));
  // Each session's heaviest set per exercise, sessions in the order they were done.
  const sessionBests = new Map<string, Map<string, SetLogRow>>();
  for (const { row } of rows) {
    const bests = sessionBests.get(row.session_id) ?? new Map<string, SetLogRow>();
    const current = bests.get(row.exercise_id);
    if (!current || heavier(row, current)) bests.set(row.exercise_id, row);
    sessionBests.set(row.session_id, bests);
  }
  // Only earlier sessions count as the bar to beat, so a first session's own
  // climbing sets never earn a PR.
  const heaviest = new Map<string, SetLogRow>();
  const prs = new Map<string, Map<string, SetLogRow>>(); // session -> exercise -> its heaviest new set
  for (const [sessionId, bests] of sessionBests) {
    for (const [exerciseId, row] of bests) {
      const previous = heaviest.get(exerciseId);
      if (previous && heavier(row, previous)) {
        const session = prs.get(sessionId) ?? new Map<string, SetLogRow>();
        session.set(exerciseId, row);
        prs.set(sessionId, session);
      }
      if (!previous || heavier(row, previous)) heaviest.set(exerciseId, row);
    }
  }
  for (const [sessionId, exercises] of prs) {
    const key = `workout:${sessionId}`;
    if (!workoutKeys.has(key)) continue;
    for (const [exerciseId, row] of exercises) {
      add(key, { label: `PR · ${exerciseName(exerciseId)} ${trim(row.weight)} ${row.weight_unit ?? 'lb'} × ${row.reps}`, tier: 'all' });
    }
  }
  return out;
}
