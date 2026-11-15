/**
 * The event and the "Train for an event" request as a client sends them
 * (docs/plans/progressive-plans P3), checked the same way for the app's REST
 * route and the coach's `build_program` tool.
 */

import { BUILD_LIMITS } from './programBuilder';
import { isCivilDate } from './services/athleteThresholds';
import { WEEKDAYS, type RaceGoal } from './types';
import { hasField as hasOwn, isPositiveInteger, type FieldRule } from './validation';
import type { EventBuildInput } from './db';

const trimmedText = (max: number): FieldRule => (v) =>
  typeof v === 'string' && v.trim().length > 0 && v.length <= max;
const RACE_FIELDS: Record<string, FieldRule> = {
  name: trimmedText(100),
  date: isCivilDate,
  discipline: trimmedText(40),
  distance: trimmedText(40),
  distance_m: (v) => typeof v === 'number' && Number.isFinite(v) && v > 0 && v <= 1_000_000,
  goal_time_s: (v) => typeof v === 'number' && Number.isInteger(v) && v > 0 && v <= 7 * 24 * 3600,
  priority: (v) => v === 'A' || v === 'B' || v === 'C',
  location: trimmedText(100),
};
const RACE_REQUIRED = ['name', 'date', 'discipline'];

/** A race as sent (PUT /plan/race, the event builder): every field checked,
 * text trimmed. */
export function parseRaceInput(value: unknown, required: readonly string[] = RACE_REQUIRED):
  { race: RaceGoal } | { invalid: string[] } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { invalid: ['race'] };
  const input = value as Record<string, unknown>;
  const invalid: string[] = [];
  for (const key of Object.keys(input)) {
    const rule = RACE_FIELDS[key];
    if (!rule || !rule(input[key])) invalid.push(`race.${key}`);
  }
  for (const key of required) if (!hasOwn(input, key)) invalid.push(`race.${key}`);
  if (invalid.length > 0) return { invalid };
  const race: RaceGoal = {
    name: (input.name as string).trim(),
    date: input.date as string,
    discipline: (input.discipline as string).trim(),
  };
  if (typeof input.distance === 'string') race.distance = input.distance.trim();
  if (typeof input.distance_m === 'number') race.distance_m = input.distance_m;
  if (typeof input.goal_time_s === 'number') race.goal_time_s = input.goal_time_s;
  if (input.priority === 'A' || input.priority === 'B' || input.priority === 'C') race.priority = input.priority;
  if (typeof input.location === 'string') race.location = input.location.trim();
  return { race };
}

/** "Keep building, no date": how long a block with no event runs. */
export const OPEN_WEEKS = { min: 4, max: 52 } as const;

const BUILD_KEYS = new Set(['race', 'open', 'today', 'start', 'long_run_weekday', 'long_run_now_m', 'peak_m',
  'easy_every', 'taper_weeks', 'shorten_other_runs', 'unit', 'workout_weekday', 'save', 'expected_version']);
const isWeekday = (v: unknown) => typeof v === 'string' && (WEEKDAYS as readonly string[]).includes(v);
const buildDistance = (v: unknown) => typeof v === 'number' && Number.isFinite(v)
  && v >= BUILD_LIMITS.longRunMeters.min && v <= BUILD_LIMITS.longRunMeters.max;
const BUILD_FIELDS: Record<string, FieldRule> = {
  today: isCivilDate,
  start: isCivilDate,
  long_run_weekday: isWeekday,
  long_run_now_m: buildDistance,
  peak_m: buildDistance,
  easy_every: (v) => v === 0 || (Number.isInteger(v) && (v as number) >= BUILD_LIMITS.easyEvery.min
    && (v as number) <= BUILD_LIMITS.easyEvery.max),
  taper_weeks: (v) => Number.isInteger(v) && (v as number) >= BUILD_LIMITS.taperWeeks.min
    && (v as number) <= BUILD_LIMITS.taperWeeks.max,
  shorten_other_runs: (v) => typeof v === 'boolean',
  unit: (v) => v === 'mi' || v === 'km',
  workout_weekday: (v) => v === null || isWeekday(v),
  open: (v) => !!v && typeof v === 'object' && !Array.isArray(v)
    && Object.keys(v).every((key) => key === 'weeks')
    && Number.isInteger((v as { weeks?: unknown }).weeks)
    && (v as { weeks: number }).weeks >= OPEN_WEEKS.min && (v as { weeks: number }).weeks <= OPEN_WEEKS.max,
  save: (v) => typeof v === 'boolean',
  expected_version: isPositiveInteger,
};

/**
 * A build request: the input, and the version to save against when `save`
 * is true (null previews). `required` names fields the caller must send
 * (the app sends its own today; the coach's may come from the server).
 */
export function parseEventBuildBody(b: Record<string, unknown>, required: readonly string[] = ['today', 'long_run_weekday']):
  { input: EventBuildInput; expectedVersion: number | null } | { invalid: string[] } {
  const invalid = Object.keys(b).filter((key) => !BUILD_KEYS.has(key));
  for (const [key, rule] of Object.entries(BUILD_FIELDS)) {
    if (b[key] !== undefined && !rule(b[key])) invalid.push(key);
  }
  for (const key of required) if (b[key] === undefined) invalid.push(key);
  if (b.save === true && b.expected_version === undefined) invalid.push('expected_version');
  // An event, or "Keep building" with no date: one or the other.
  let race: EventBuildInput['race'];
  if (b.open !== undefined) {
    if (b.race !== undefined) invalid.push('race');
  } else {
    const parsedRace = parseRaceInput(b.race, [...RACE_REQUIRED, 'distance_m']);
    if ('invalid' in parsedRace) invalid.push(...parsedRace.invalid);
    else race = parsedRace.race as EventBuildInput['race'];
  }
  if (invalid.length > 0) return { invalid: [...new Set(invalid)] };
  const input: EventBuildInput = {
    ...(race ? { race } : { open: { weeks: (b.open as { weeks: number }).weeks } }),
    today: b.today as string,
    long_run_weekday: b.long_run_weekday as EventBuildInput['long_run_weekday'],
  };
  if (typeof b.start === 'string') input.start = b.start;
  if (typeof b.long_run_now_m === 'number') input.long_run_now_m = b.long_run_now_m;
  if (typeof b.peak_m === 'number') input.peak_m = b.peak_m;
  if (typeof b.easy_every === 'number') input.easy_every = b.easy_every;
  if (typeof b.taper_weeks === 'number') input.taper_weeks = b.taper_weeks;
  if (typeof b.shorten_other_runs === 'boolean') input.shorten_other_runs = b.shorten_other_runs;
  if (b.unit === 'mi' || b.unit === 'km') input.unit = b.unit;
  if (b.workout_weekday !== undefined) input.workout_weekday = b.workout_weekday as EventBuildInput['workout_weekday'];
  return { input, expectedVersion: b.save === true ? b.expected_version as number : null };
}
