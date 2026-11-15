/**
 * The Analysis section's Overview: everything the member trained over a
 * chosen range, beside the range before it. It reads the same history list
 * as the Activity page (`buildHistory`), so a session counts the same way on
 * both pages. Pure, so the page and the tests share one set of rules.
 *
 * Fitness, fatigue and form follow the usual training-stress model (the one
 * intervals.icu shows): fitness is an exponentially weighted average of daily
 * load with a 42-day time constant, fatigue the same with 7 days, and form is
 * fitness minus fatigue. Only shown loads count (`effective_load`); a session
 * without one, such as a lifting workout, adds nothing, and nothing is
 * estimated in its place.
 */
import { addDays } from '../../src/calendarProjection';
import { sportLabel } from '../../src/sports';
import type { SetLogRow } from '../../src/types';
import type { StateResponse } from './api';
import { FAMILIES, loggedLabel, mondayOf, totalSeconds, type Entry, type Family, type FamilySeconds } from './activity';

// ---- ranges ---------------------------------------------------------------

export type RangeKey = '4w' | '12w' | '6m' | '1y' | 'all';
export const RANGE_KEYS: RangeKey[] = ['4w', '12w', '6m', '1y', 'all'];
export const RANGE_LABELS: Record<RangeKey, string> = { '4w': '4W', '12w': '12W', '6m': '6M', '1y': '1Y', all: 'All' };
export const RANGE_NAMES: Record<RangeKey, string> = {
  '4w': '4 weeks', '12w': '12 weeks', '6m': '26 weeks', '1y': '52 weeks', all: 'all time',
};
const RANGE_WEEKS: Record<Exclude<RangeKey, 'all'>, number> = { '4w': 4, '12w': 12, '6m': 26, '1y': 52 };

export interface Range {
  key: RangeKey;
  /** A Monday. */
  from: string;
  /** Today. */
  to: string;
  /** The same number of days just before, ending on the same weekday a whole
   * number of weeks earlier; null for all time. */
  previous: { from: string; to: string } | null;
}

/**
 * Whole weeks ending with this one (up to today). The range before it is the
 * same length shifted back by the range's weeks, so both end on the same
 * weekday and a week in progress is compared with the same days earlier.
 * All time starts on the Monday of the first session, or this week.
 */
export function rangeFor(key: RangeKey, today: string, earliest: string | null): Range {
  const monday = mondayOf(today);
  if (key === 'all') {
    const first = earliest && earliest < monday ? mondayOf(earliest) : monday;
    return { key, from: first, to: today, previous: null };
  }
  const weeks = RANGE_WEEKS[key];
  const from = addDays(monday, -(weeks - 1) * 7);
  return {
    key, from, to: today,
    previous: { from: addDays(from, -weeks * 7), to: addDays(today, -weeks * 7) },
  };
}

/** The oldest date in the history, or null when it is empty. */
export function earliestDate(entries: Entry[]): string | null {
  let first: string | null = null;
  for (const e of entries) if (!first || e.date < first) first = e.date;
  return first;
}

const within = (entries: Entry[], from: string, to: string) => entries.filter((e) => e.date >= from && e.date <= to);

// ---- totals ---------------------------------------------------------------

export interface Totals {
  seconds: number;
  sessions: number;
  /** Distance by activity kind (run, ride, swim, walk, …), never added
   * across kinds, as yards and miles don't add up. */
  meters: Map<string, number>;
  /** Time by activity kind, for the kinds that have a distance. */
  secondsByKind: Map<string, number>;
  /** Known loads summed; null when nothing in the period has one. */
  load: number | null;
  /** Sessions with a known load. */
  scored: number;
  /** Of those, sessions whose load is an estimate from an effort rating. */
  estimated: number;
  /** Logged sets that are not warm-ups, in workouts the history counts. */
  workingSets: number;
}

export function totalsFor(entries: Entry[], sets: SetLogRow[] | undefined, from: string, to: string): Totals {
  const items = within(entries, from, to);
  const meters = new Map<string, number>();
  const secondsByKind = new Map<string, number>();
  let load = 0;
  let scored = 0;
  let estimated = 0;
  const workouts = new Set<string>();
  for (const e of items) {
    if (e.kind === 'workout') workouts.add(e.id);
    if (e.load !== null) {
      load += e.load;
      scored += 1;
      if (e.loadEstimated) estimated += 1;
    }
    if (e.activityKind && e.meters !== null) {
      meters.set(e.activityKind, (meters.get(e.activityKind) ?? 0) + e.meters);
      secondsByKind.set(e.activityKind, (secondsByKind.get(e.activityKind) ?? 0) + e.seconds);
    }
  }
  let workingSets = 0;
  for (const set of sets ?? []) {
    if (set.deleted_at === null && !set.is_warmup && workouts.has(set.session_id)) workingSets += 1;
  }
  return {
    seconds: items.reduce((sum, e) => sum + e.seconds, 0),
    sessions: items.length,
    meters,
    secondsByKind,
    load: scored > 0 ? load : null,
    scored,
    estimated,
    workingSets,
  };
}

/** The kind to show distance for: of runs, rides, swims, walks and hikes
 * with distance in either period, the one with the most time across both,
 * in that order on a tie; null when neither period has any distance. */
export function distanceKind(current: Totals, previous: Totals | null): string | null {
  const has = (kind: string) => (current.meters.get(kind) ?? 0) > 0 || (previous?.meters.get(kind) ?? 0) > 0;
  const time = (kind: string) => (current.secondsByKind.get(kind) ?? 0) + (previous?.secondsByKind.get(kind) ?? 0);
  let best: string | null = null;
  for (const kind of DISTANCE_KINDS) {
    if (has(kind) && (best === null || time(kind) > time(best))) best = kind;
  }
  return best;
}

const DISTANCE_KINDS = ['run', 'ride', 'swim', 'walk', 'hike'];

/** "+12%", "−4%", or null when there's nothing to compare with. */
export function percentChange(current: number, previous: number): string | null {
  if (previous <= 0) return null;
  const pct = Math.round(((current - previous) / previous) * 100);
  if (pct === 0) return 'same';
  return `${pct > 0 ? '+' : '−'}${Math.abs(pct)}%`;
}

// ---- time by week (or month) ----------------------------------------------

export interface Bucket {
  /** First date in the bucket (a Monday, or the 1st of a month). */
  start: string;
  /** Last date counted (Sunday, the month's end, or today). */
  end: string;
  seconds: FamilySeconds;
  sessions: number;
  current: boolean;
}

/** Longer ranges than this show months instead of weeks. */
export const MOST_WEEKLY_BARS = 60;

function monthEnd(date: string): string {
  const [y, m] = date.split('-').map(Number) as [number, number];
  const next = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;
  return addDays(next, -1);
}

export function buckets(entries: Entry[], range: Range): { unit: 'week' | 'month'; buckets: Bucket[] } {
  const items = within(entries, range.from, range.to);
  const weeks: string[] = [];
  for (let start = range.from; start <= range.to; start = addDays(start, 7)) weeks.push(start);
  const unit = weeks.length > MOST_WEEKLY_BARS ? 'month' : 'week';
  const starts = unit === 'week' ? weeks : (() => {
    const months: string[] = [];
    for (let start = `${range.from.slice(0, 7)}-01`; start <= range.to; start = addDays(monthEnd(start), 1)) months.push(start);
    return months;
  })();
  return {
    unit,
    buckets: starts.map((start) => {
      const last = unit === 'week' ? addDays(start, 6) : monthEnd(start);
      const end = last > range.to ? range.to : last;
      const inside = items.filter((e) => e.date >= start && e.date <= end);
      const seconds: FamilySeconds = {};
      for (const e of inside) if (e.seconds > 0) seconds[e.family] = (seconds[e.family] ?? 0) + e.seconds;
      return { start, end, seconds, sessions: inside.length, current: end === range.to };
    }),
  };
}

// ---- where the time went --------------------------------------------------

const KIND_GROUPS: Record<string, string> = {
  run: 'Running', ride: 'Riding', swim: 'Swimming', walk: 'Walking', hike: 'Hiking',
  row: 'Rowing', ski: 'Skiing', elliptical: 'Elliptical', lift: 'Lifting', strength: 'Lifting',
};

export interface Group {
  label: string;
  family: Family;
  seconds: number;
  sessions: number;
  previousSeconds: number;
}

/** Most groups listed; the rest are summed as "Everything else". */
export const MOST_GROUPS = 6;

/**
 * What the time went to: lifting workouts, then each activity's kind for runs,
 * rides and other endurance, and its sport (soccer, yoga) for everything else.
 */
export function groupOf(entry: Entry, sports: Map<string, string | null>, loggedTypes: Map<string, string>): string {
  if (entry.kind === 'workout') return entry.family === 'endurance' ? 'Running' : 'Lifting';
  if (entry.kind === 'logged') {
    const type = loggedTypes.get(entry.id) ?? 'other';
    return KIND_GROUPS[type] ?? loggedLabel(type);
  }
  const kind = entry.activityKind ?? 'other';
  if (KIND_GROUPS[kind]) return KIND_GROUPS[kind];
  const sport = sports.get(entry.id);
  if (sport && sport !== 'other') {
    if (KIND_GROUPS[sport]) return KIND_GROUPS[sport];
    return sportLabel(sport) ?? 'Other';
  }
  return 'Other';
}

export function groupsFor(entries: Entry[], state: StateResponse, range: Range): Group[] {
  const sports = new Map(state.external_activities.map((a) => [a.id, a.sport ?? null]));
  const loggedTypes = new Map((state.activities ?? []).map((a) => [a.id, a.type]));
  const out = new Map<string, Group>();
  const add = (e: Entry, previous: boolean) => {
    if (e.seconds <= 0 && previous) return;
    const label = groupOf(e, sports, loggedTypes);
    const group = out.get(label) ?? { label, family: e.family, seconds: 0, sessions: 0, previousSeconds: 0 };
    if (previous) group.previousSeconds += e.seconds;
    else { group.seconds += e.seconds; group.sessions += 1; }
    out.set(label, group);
  };
  for (const e of within(entries, range.from, range.to)) add(e, false);
  if (range.previous) for (const e of within(entries, range.previous.from, range.previous.to)) add(e, true);
  const sorted = [...out.values()]
    .filter((g) => g.sessions > 0)
    .sort((a, b) => b.seconds - a.seconds || b.sessions - a.sessions || (a.label < b.label ? -1 : 1));
  if (sorted.length <= MOST_GROUPS) return sorted;
  const kept = sorted.slice(0, MOST_GROUPS - 1);
  const rest = sorted.slice(MOST_GROUPS - 1);
  const keptLabels = new Set(kept.map((g) => g.label));
  const previousRest = [...out.values()].filter((g) => !keptLabels.has(g.label)).reduce((sum, g) => sum + g.previousSeconds, 0);
  kept.push({
    label: 'Everything else',
    family: 'sport',
    seconds: rest.reduce((sum, g) => sum + g.seconds, 0),
    sessions: rest.reduce((sum, g) => sum + g.sessions, 0),
    previousSeconds: previousRest,
  });
  return kept;
}

// ---- fitness, fatigue and form --------------------------------------------

export const FITNESS_DAYS = 42;
export const FATIGUE_DAYS = 7;

export interface FitnessDay {
  date: string;
  /** The day's summed known load (0 when none). */
  load: number;
  fitness: number;
  fatigue: number;
  /** Fitness minus fatigue. */
  form: number;
}

/**
 * One value per day from the first day with a load to today. Starting from
 * nothing, fitness takes about six weeks of history to mean much; the page
 * says so while the history is shorter than that.
 */
export function fitnessSeries(entries: Entry[], today: string): FitnessDay[] {
  const loads = new Map<string, number>();
  for (const e of entries) {
    if (e.load === null || e.load <= 0 || e.date > today) continue;
    loads.set(e.date, (loads.get(e.date) ?? 0) + e.load);
  }
  if (!loads.size) return [];
  const first = [...loads.keys()].reduce((a, b) => (a < b ? a : b));
  const fitnessDecay = Math.exp(-1 / FITNESS_DAYS);
  const fatigueDecay = Math.exp(-1 / FATIGUE_DAYS);
  const out: FitnessDay[] = [];
  let fitness = 0;
  let fatigue = 0;
  for (let date = first; date <= today; date = addDays(date, 1)) {
    const load = loads.get(date) ?? 0;
    fitness = fitness * fitnessDecay + load * (1 - fitnessDecay);
    fatigue = fatigue * fatigueDecay + load * (1 - fatigueDecay);
    out.push({ date, load, fitness, fatigue, form: fitness - fatigue });
  }
  return out;
}

/** The days of the series inside the range. */
export function seriesIn(series: FitnessDay[], range: Range): FitnessDay[] {
  return series.filter((d) => d.date >= range.from && d.date <= range.to);
}

/**
 * Where the loads behind the fitness lines up to the range's end came from
 * ("Garmin Forerunner 945", "Zwift"), most first. Fitness and fatigue carry
 * every earlier load forward, so sessions before the range count too.
 * Garmin's terms ask for this attribution wherever its data is shown.
 */
export function loadSources(entries: Entry[], range: Range): string[] {
  const counts = new Map<string, number>();
  for (const e of entries) {
    if (e.date > range.to || e.load === null || e.load <= 0 || !e.attribution) continue;
    counts.set(e.attribution, (counts.get(e.attribution) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).map(([name]) => name);
}

/**
 * Where the sessions counted in the totals and time charts came from, in
 * the range and, when comparing, the period before; most first. Every view
 * of Garmin data names the device, whether or not a session has a load.
 */
export function dataSources(entries: Entry[], range: Range, comparing: boolean): string[] {
  const counts = new Map<string, number>();
  const inside = (date: string) => (date >= range.from && date <= range.to)
    || (comparing && range.previous !== null && date >= range.previous.from && date <= range.previous.to);
  for (const e of entries) {
    if (!e.attribution || !inside(e.date)) continue;
    counts.set(e.attribution, (counts.get(e.attribution) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).map(([name]) => name);
}

/** How form reads, with bands near intervals.icu's form zones. */
export function formLabel(form: number): string {
  if (form > 5) return 'Fresh';
  if (form >= -10) return 'Steady';
  if (form >= -30) return 'Building';
  return 'Heavy load';
}

export { FAMILIES, totalSeconds };
