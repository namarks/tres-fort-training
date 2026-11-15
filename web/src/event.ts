/**
 * The Analysis section's Event page: how training is heading toward the
 * member's goal event (plans.meta.race). Pure, so the page and the tests
 * share one set of rules.
 *
 * Nothing here is a coach's judgment: the countdown, block week and phase
 * come from the plan; distances, longest sessions and fitness from the same
 * history the Overview reads; and the finish estimate is a published formula
 * (Riegel 1981) applied to the member's own sessions, labeled as such.
 */
import { addDays, programWeekOn } from '../../src/calendarProjection';
import { parsePlanMeta, type PeriodizationPhase, type RaceGoal, type TrainingProgram } from '../../src/types';
import type { StateResponse } from './api';
import { mondayOf, type Entry } from './activity';
import { fitnessSeries, formLabel, type FitnessDay } from './analysis';
import { formatClock } from './model';

export type EventKind = 'run' | 'ride' | 'swim';

// ---- the event --------------------------------------------------------------

/** Event types offered in the editor; any other text the coach set is kept. */
export const DISCIPLINES: { id: string; label: string }[] = [
  { id: 'running', label: 'Running' },
  { id: 'cycling', label: 'Cycling' },
  { id: 'swimming', label: 'Swimming' },
  { id: 'triathlon', label: 'Triathlon' },
  { id: 'duathlon', label: 'Duathlon' },
];

/** The event as the plan holds it, or null. */
export function eventOf(state: StateResponse): RaceGoal | null {
  return state.plan?.race ?? null;
}

/** The plan's block of weeks and training phases, parsed the one shared way. */
export function planBlocks(state: StateResponse): { program: TrainingProgram | null; phases: PeriodizationPhase[] } {
  const meta = parsePlanMeta(state.plan?.meta ?? null);
  return { program: meta.program ?? null, phases: meta.periodization ?? [] };
}

/**
 * The kinds of session that train for the event: a run for running, all
 * three for a triathlon. Unknown types (biathlon, obstacle race) have none,
 * so the page shows what it can without guessing.
 */
export function eventKinds(discipline: string): EventKind[] {
  const d = discipline.trim().toLowerCase();
  if (/\btri(athlon)?\b/.test(d)) return ['swim', 'ride', 'run'];
  if (/duathlon/.test(d)) return ['run', 'ride'];
  if (/^(ride|riding|cycl|bike|biking|gravel|road cycling|mtb|gran fondo|century)/.test(d)) return ['ride'];
  if (/^(swim|open water)/.test(d)) return ['swim'];
  if (/^(run|running|road race|trail|track|cross country|xc)\b|marathon|\b\d+\s?k\b/.test(d)) return ['run'];
  return [];
}

/** The one kind a single-sport event is, else null. */
export function singleKind(race: RaceGoal): EventKind | null {
  const kinds = eventKinds(race.discipline);
  return kinds.length === 1 ? kinds[0]! : null;
}

export function disciplineLabel(discipline: string): string {
  const known = DISCIPLINES.find((d) => d.id === discipline.trim().toLowerCase());
  if (known) return known.label;
  const text = discipline.trim();
  return text.charAt(0).toUpperCase() + text.slice(1);
}

const MILE = 1609.344;

/** Common distances per kind for the editor. */
export const DISTANCE_PRESETS: Record<EventKind, { label: string; meters: number }[]> = {
  run: [
    { label: '1 mile', meters: MILE },
    { label: '5k', meters: 5000 },
    { label: '8k', meters: 8000 },
    { label: '10k', meters: 10000 },
    { label: '15k', meters: 15000 },
    { label: '10 miles', meters: 10 * MILE },
    { label: 'Half marathon', meters: 21097.5 },
    { label: 'Marathon', meters: 42195 },
    { label: '50k', meters: 50000 },
  ],
  ride: [
    { label: '40 km', meters: 40000 },
    { label: '100 km', meters: 100000 },
    { label: '100 miles', meters: 100 * MILE },
    { label: '200 km', meters: 200000 },
  ],
  swim: [
    { label: '500 yd', meters: 457.2 },
    { label: '750 m', meters: 750 },
    { label: '1500 m', meters: 1500 },
    { label: '1 mile', meters: MILE },
    { label: '2.4 miles', meters: 2.4 * MILE },
    { label: '5 km', meters: 5000 },
  ],
};

/** "18:00" or "1:45:30" to seconds; a bare number is minutes. Null when it isn't a time. */
export function parseGoalTime(text: string): number | null {
  const t = text.trim();
  if (!t) return null;
  if (/^\d+$/.test(t)) {
    const minutes = Number(t);
    return minutes > 0 ? minutes * 60 : null;
  }
  const m = /^(?:(\d+):)?(\d{1,2}):(\d{2})$/.exec(t);
  if (!m) return null;
  const hours = Number(m[1] ?? 0);
  const minutes = Number(m[2]);
  const seconds = Number(m[3]);
  if (seconds >= 60 || (m[1] !== undefined && minutes >= 60)) return null;
  const total = hours * 3600 + minutes * 60 + seconds;
  return total > 0 ? total : null;
}

/** "18:00", "1:45:30". */
export const goalTimeText = (seconds: number) => formatClock(Math.round(seconds));

/** Days from today to the event (negative once it has passed). */
export function daysUntil(today: string, date: string): number {
  return Math.round((civilMs(date) - civilMs(today)) / 86_400_000);
}

const civilMs = (date: string) => {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return Date.UTC(y, m - 1, d);
};

/** "Today", "Tomorrow", "5 days to go", "3 weeks, 2 days to go", "4 days ago". */
export function countdownText(days: number): string {
  if (days === 0) return 'Today';
  if (days === 1) return 'Tomorrow';
  if (days < 0) return days === -1 ? 'Yesterday' : `${-days} days ago`;
  const weeks = Math.floor(days / 7);
  const rest = days % 7;
  if (weeks === 0) return `${days} days to go`;
  const w = `${weeks} ${weeks === 1 ? 'week' : 'weeks'}`;
  return rest === 0 ? `${w} to go` : `${w}, ${rest} ${rest === 1 ? 'day' : 'days'} to go`;
}

// ---- where the plan is ------------------------------------------------------

export interface BlockStatus {
  name: string | null;
  /** 0-based week of the block today; null outside it. */
  weekToday: number | null;
  /** 0-based week of the block on the event date; null outside it. */
  weekOnEvent: number | null;
  weeks: number;
  repeat: boolean;
  start: string;
  /** The last day of a one-off block; null for a repeating one. */
  end: string | null;
  /** This week's label ("Build", "Deload"), when it has one. */
  label: string | null;
}

export function blockStatus(program: TrainingProgram | null, today: string, eventDate: string): BlockStatus | null {
  if (!program || program.weeks.length === 0) return null;
  const weekToday = programWeekOn(program, today);
  return {
    name: program.name ?? null,
    weekToday,
    weekOnEvent: programWeekOn(program, eventDate),
    weeks: program.weeks.length,
    repeat: program.repeat,
    start: program.start,
    end: program.repeat ? null : addDays(program.start, program.weeks.length * 7 - 1),
    label: weekToday === null ? null : program.weeks[weekToday]!.label ?? null,
  };
}

/** The training phase covering a date, when the plan has phases. */
export function phaseOn(phases: PeriodizationPhase[], date: string): PeriodizationPhase | null {
  return phases.find((p) => p.start <= date && date <= p.end) ?? null;
}

export const PHASE_LABELS: Record<PeriodizationPhase['phase'], string> = {
  base: 'Base', build: 'Build', peak: 'Peak', taper: 'Taper', race: 'Race', recovery: 'Recovery',
};

// ---- finish estimate --------------------------------------------------------

/** Riegel's fatigue exponent for runs and swims; a ride is held at its speed. */
export const RIEGEL_EXPONENT = 1.06;
/** Sessions from this many days back feed the current estimate. */
export const ESTIMATE_DAYS = 42;
/** The shortest run that can feed an estimate. */
export const SHORTEST_ESTIMATE_RUN = MILE;

/** How far a session may be from the event and still feed an estimate:
 * at least a quarter of the distance for runs and swims (and a mile for
 * runs), half for rides, whose speed changes most with distance. */
export function shortestEstimateDistance(kind: EventKind, target: number): number {
  if (kind === 'ride') return target / 2;
  if (kind === 'run') return Math.max(SHORTEST_ESTIMATE_RUN, target / 4);
  return Math.max(100, target / 4);
}

/** A session's time carried to the event distance. */
export function carriedTime(seconds: number, meters: number, target: number, kind: EventKind): number {
  const exponent = kind === 'ride' ? 1 : RIEGEL_EXPONENT;
  return seconds * (target / meters) ** exponent;
}

export interface Estimate {
  entry: Entry;
  /** Seconds at the event distance. */
  seconds: number;
}

function qualifies(entry: Entry, kind: EventKind, target: number): boolean {
  return entry.kind === 'activity' && entry.activityKind === kind && entry.meters !== null
    && entry.seconds > 0 && entry.meters >= shortestEstimateDistance(kind, target);
}

/** The best estimate from sessions between two dates, or null. */
export function bestEstimate(entries: Entry[], kind: EventKind, target: number, from: string, to: string): Estimate | null {
  let best: Estimate | null = null;
  for (const e of entries) {
    if (e.date < from || e.date > to || !qualifies(e, kind, target)) continue;
    const seconds = carriedTime(e.seconds, e.meters!, target, kind);
    if (!best || seconds < best.seconds) best = { entry: e, seconds };
  }
  return best;
}

// ---- weeks heading in -------------------------------------------------------

export const WEEKS_SHOWN = 12;

export interface EventWeek {
  /** A Monday. */
  start: string;
  /** Sunday, or today for this week. */
  end: string;
  /** Distance of the event's kinds that week. */
  meters: Partial<Record<EventKind, number>>;
  /** Time in each of the event's kinds that week. */
  seconds: Partial<Record<EventKind, number>>;
  /** The longest single session of the event's kind (single-sport events). */
  longest: number;
  /** Sessions of the event's kinds. */
  sessions: number;
  /** The week's best finish estimate, when the event has a distance. */
  estimate: number | null;
  current: boolean;
}

/** The last WEEKS_SHOWN weeks through this one. */
export function eventWeeks(entries: Entry[], race: RaceGoal, today: string): EventWeek[] {
  const kinds = eventKinds(race.discipline);
  const kind = singleKind(race);
  const target = race.distance_m ?? null;
  const thisMonday = mondayOf(today);
  const out: EventWeek[] = [];
  for (let i = WEEKS_SHOWN - 1; i >= 0; i -= 1) {
    const start = addDays(thisMonday, -7 * i);
    const sunday = addDays(start, 6);
    const end = sunday > today ? today : sunday;
    const meters: Partial<Record<EventKind, number>> = {};
    const seconds: Partial<Record<EventKind, number>> = {};
    let longest = 0;
    let sessions = 0;
    for (const e of entries) {
      if (e.date < start || e.date > end || e.kind !== 'activity' || !e.activityKind) continue;
      const k = e.activityKind as EventKind;
      if (!kinds.includes(k)) continue;
      sessions += 1;
      if (e.seconds > 0) seconds[k] = (seconds[k] ?? 0) + e.seconds;
      if (e.meters !== null && e.meters > 0) {
        meters[k] = (meters[k] ?? 0) + e.meters;
        if (k === kind && e.meters > longest) longest = e.meters;
      }
    }
    const estimate = kind && target ? bestEstimate(entries, kind, target, start, end)?.seconds ?? null : null;
    out.push({ start, end, meters, seconds, longest, sessions, estimate, current: end === today });
  }
  return out;
}

export interface Readiness {
  /** Fitness, fatigue and form today, from the shared model; null with no loads. */
  today: FitnessDay | null;
  /** Fitness four weeks ago, for the trend. */
  fitnessFourWeeksAgo: number | null;
  formLabel: string | null;
  /** The longest session of the event's kind in the last four weeks. */
  longestRecent: Entry | null;
  /** Sessions of the event's kinds per week, over the last four whole weeks and this one. */
  sessionsPerWeek: number;
}

export function readiness(entries: Entry[], race: RaceGoal, today: string, weeks: EventWeek[]): Readiness {
  const series = fitnessSeries(entries, today);
  const last = series.length && series[series.length - 1]!.date === today ? series[series.length - 1]! : null;
  const earlier = series.find((d) => d.date === addDays(today, -28)) ?? null;
  const kind = singleKind(race);
  let longestRecent: Entry | null = null;
  if (kind) {
    const from = addDays(today, -27);
    for (const e of entries) {
      if (e.date < from || e.date > today || e.kind !== 'activity' || e.activityKind !== kind || !e.meters) continue;
      if (!longestRecent || e.meters > longestRecent.meters!) longestRecent = e;
    }
  }
  const recent = weeks.slice(-5);
  const sessions = recent.reduce((sum, w) => sum + w.sessions, 0);
  return {
    today: last,
    fitnessFourWeeksAgo: earlier ? earlier.fitness : null,
    formLabel: last ? formLabel(last.form) : null,
    longestRecent,
    sessionsPerWeek: recent.length ? sessions / recent.length : 0,
  };
}

/** What was done on the event day: the longest session of its kinds, if any. */
export function eventDayResult(entries: Entry[], race: RaceGoal, today: string): Entry | null {
  if (race.date > today) return null;
  const kinds = eventKinds(race.discipline);
  let best: Entry | null = null;
  for (const e of entries) {
    if (e.date !== race.date || e.kind !== 'activity' || !kinds.includes(e.activityKind as EventKind)) continue;
    if (!best || (e.meters ?? 0) > (best.meters ?? 0)) best = e;
  }
  return best;
}

// ---- the editor -------------------------------------------------------------

export type DistanceUnit = 'km' | 'mi' | 'm' | 'yd';
const UNIT_METERS: Record<DistanceUnit, number> = { km: 1000, mi: MILE, m: 1, yd: 0.9144 };

export interface EventDraft {
  name: string;
  date: string;
  /** A DISCIPLINES id, or 'other' with the type typed in. */
  discipline: string;
  otherDiscipline: string;
  /** A preset's label, 'custom', 'text' (keep `distanceLabel`, a distance
   * saved without meters, such as one the coach set) or '' for none
   * (single-sport events). */
  distanceChoice: string;
  customAmount: string;
  customUnit: DistanceUnit;
  /** A free distance, such as "Sprint" or "70.3" (multisport and other types). */
  distanceLabel: string;
  goal: string;
}

const draftDiscipline = (draft: Pick<EventDraft, 'discipline' | 'otherDiscipline'>) =>
  draft.discipline === 'other' ? draft.otherDiscipline.trim() : draft.discipline;

/** The kind the draft's type is, when it is one sport. */
export function draftKind(draft: Pick<EventDraft, 'discipline' | 'otherDiscipline'>): EventKind | null {
  const kinds = eventKinds(draftDiscipline(draft));
  return kinds.length === 1 ? kinds[0]! : null;
}

export function eventDraft(race: RaceGoal | null, miles: boolean): EventDraft {
  const known = race ? DISCIPLINES.some((d) => d.id === race.discipline) : true;
  const draft: EventDraft = {
    name: race?.name ?? '',
    date: race?.date ?? '',
    discipline: race ? (known ? race.discipline : 'other') : 'running',
    otherDiscipline: race && !known ? race.discipline : '',
    distanceChoice: '',
    customAmount: '',
    customUnit: miles ? 'mi' : 'km',
    distanceLabel: race?.distance ?? '',
    goal: race?.goal_time_s ? goalTimeText(race.goal_time_s) : '',
  };
  const kind = draftKind(draft);
  if (race?.distance && !race.distance_m && kind) {
    // A distance saved as text only: a matching preset, else kept as it is.
    const preset = DISTANCE_PRESETS[kind].find((p) => p.label.toLowerCase() === race.distance!.trim().toLowerCase());
    draft.distanceChoice = preset ? preset.label : 'text';
  }
  if (race?.distance_m && kind) {
    const preset = DISTANCE_PRESETS[kind].find((p) => Math.abs(p.meters - race.distance_m!) < 1);
    if (preset) draft.distanceChoice = preset.label;
    else {
      const unit: DistanceUnit = kind === 'swim' ? (miles ? 'yd' : 'm') : miles ? 'mi' : 'km';
      draft.distanceChoice = 'custom';
      draft.customUnit = unit;
      draft.customAmount = String(Math.round((race.distance_m / UNIT_METERS[unit]) * 100) / 100);
    }
  }
  return draft;
}

/** The event to save, or what to fix. Priority and location the coach set are kept. */
export function eventFromDraft(draft: EventDraft, existing: RaceGoal | null): { race: RaceGoal } | { error: string } {
  const name = draft.name.trim();
  if (!name) return { error: 'Name the event.' };
  if (name.length > 100) return { error: 'Keep the name to 100 characters.' };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.date)) return { error: 'Pick the event’s date.' };
  const discipline = draftDiscipline(draft);
  if (!discipline) return { error: 'Say what kind of event it is.' };
  if (discipline.length > 40) return { error: 'Keep the event type to 40 characters.' };
  const race: RaceGoal = { name, date: draft.date, discipline };
  const kind = draftKind(draft);
  if (kind) {
    if (draft.distanceChoice === 'custom') {
      const amount = Number(draft.customAmount);
      if (!draft.customAmount.trim() || !Number.isFinite(amount) || amount <= 0) return { error: 'Enter the distance as a number.' };
      race.distance_m = Math.round(amount * UNIT_METERS[draft.customUnit] * 10) / 10;
      if (race.distance_m > 1_000_000) return { error: 'That distance is too long.' };
      race.distance = `${amount} ${draft.customUnit}`;
    } else if (draft.distanceChoice === 'text') {
      if (draft.distanceLabel.trim()) race.distance = draft.distanceLabel.trim();
    } else if (draft.distanceChoice) {
      const preset = DISTANCE_PRESETS[kind].find((p) => p.label === draft.distanceChoice);
      if (preset) { race.distance = preset.label; race.distance_m = preset.meters; }
    }
  } else if (draft.distanceLabel.trim()) {
    if (draft.distanceLabel.trim().length > 40) return { error: 'Keep the distance to 40 characters.' };
    race.distance = draft.distanceLabel.trim();
  }
  if (draft.goal.trim()) {
    const goal = parseGoalTime(draft.goal);
    if (goal === null || goal > 7 * 24 * 3600) return { error: 'Enter the goal time like 18:00 or 1:45:30.' };
    race.goal_time_s = goal;
  }
  if (existing?.priority) race.priority = existing.priority;
  if (existing?.location) race.location = existing.location;
  return { race };
}
