/**
 * A swim's detail (docs/plans/sport-activities P4): pool or open water, the
 * pool's length and the unit it is measured in, and the lengths and sets an
 * Apple Watch saves with a swim, each with its stroke and stroke count.
 *
 * The app reads it from Apple Health and sends it as `swim` on
 * `POST /api/activities/healthkit` (`HealthSwimDetail.swift`). It is kept as
 * canonical JSON text in `activity_swims` (migration 0072) and served with
 * a summary by `GET /api/activities/:id/swim`. Private to the member, like a
 * run's laps: group views and coach tools never read it.
 *
 * Nothing is estimated: a length the watch saved without a stroke count has
 * none, and a summary figure that can't be worked out from what was saved is
 * null.
 */

/** HKSwimmingStrokeStyle, by name. `kickboard` is a kick set. */
export const SWIM_STROKES = ['freestyle', 'backstroke', 'breaststroke', 'butterfly', 'mixed', 'kickboard', 'unknown'] as const;
export type SwimStroke = typeof SWIM_STROKES[number];

export const SWIM_LOCATIONS = ['pool', 'open_water'] as const;
export type SwimLocation = typeof SWIM_LOCATIONS[number];

export const SWIM_POOL_UNITS = ['m', 'yd'] as const;
export type SwimPoolUnit = typeof SWIM_POOL_UNITS[number];

/** One length of the pool. Seconds are from the workout's start. */
export interface SwimLength {
  start_s: number;
  duration_s: number;
  distance_m: number | null;
  strokes: number | null;
  stroke: SwimStroke;
}

/** A set: lengths swum between rests (Apple Watch's segment). */
export interface SwimSet {
  start_s: number;
  duration_s: number;
  distance_m: number | null;
  lengths: number;
  stroke: SwimStroke;
}

export interface SwimDetail {
  location: SwimLocation | null;
  pool_length_m: number | null;
  pool_unit: SwimPoolUnit | null;
  /** The whole swim's stroke count, when the watch counted strokes. */
  strokes: number | null;
  lengths: SwimLength[];
  sets: SwimSet[];
}

export const SWIM_LIMITS = {
  /** 10 km in a 25 yd pool is about 440 lengths. */
  lengths: 2_000,
  sets: 500,
  seconds: 24 * 60 * 60,
  /** One length or set; an open-water set can be long. */
  meters: 100_000,
  strokesPerLength: 1_000,
  strokes: 200_000,
  poolLengthM: { min: 10, max: 100 },
} as const;

const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const numberIn = (value: unknown, min: number, max: number): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
const integerIn = (value: unknown, min: number, max: number): value is number =>
  Number.isSafeInteger(value) && (value as number) >= min && (value as number) <= max;
/** Seconds and meters keep a tenth. */
const tenth = (value: number) => Math.round(value * 10) / 10;
const oneOf = <T extends string>(list: readonly T[], value: unknown): value is T =>
  typeof value === 'string' && (list as readonly string[]).includes(value);

function parseLength(value: unknown): SwimLength | undefined {
  if (!record(value)) return undefined;
  const { start_s, duration_s, distance_m, strokes, stroke } = value;
  if (!numberIn(start_s, 0, SWIM_LIMITS.seconds) || !numberIn(duration_s, 0, SWIM_LIMITS.seconds)) return undefined;
  if (distance_m !== null && distance_m !== undefined && !numberIn(distance_m, 0, SWIM_LIMITS.meters)) return undefined;
  if (strokes !== null && strokes !== undefined && !integerIn(strokes, 0, SWIM_LIMITS.strokesPerLength)) return undefined;
  if (!oneOf(SWIM_STROKES, stroke)) return undefined;
  return {
    start_s: tenth(start_s),
    duration_s: tenth(duration_s),
    distance_m: typeof distance_m === 'number' ? tenth(distance_m) : null,
    strokes: typeof strokes === 'number' ? strokes : null,
    stroke,
  };
}

function parseSet(value: unknown): SwimSet | undefined {
  if (!record(value)) return undefined;
  const { start_s, duration_s, distance_m, lengths, stroke } = value;
  if (!numberIn(start_s, 0, SWIM_LIMITS.seconds) || !numberIn(duration_s, 0, SWIM_LIMITS.seconds)) return undefined;
  if (distance_m !== null && distance_m !== undefined && !numberIn(distance_m, 0, SWIM_LIMITS.meters)) return undefined;
  if (!integerIn(lengths, 0, SWIM_LIMITS.lengths)) return undefined;
  if (!oneOf(SWIM_STROKES, stroke)) return undefined;
  return {
    start_s: tenth(start_s),
    duration_s: tenth(duration_s),
    distance_m: typeof distance_m === 'number' ? tenth(distance_m) : null,
    lengths,
    stroke,
  };
}

/**
 * A swim's detail as the app sends it, in canonical form: lengths and sets in
 * time order, figures rounded to a tenth. Null for a detail with nothing in it;
 * undefined for one that isn't valid.
 */
export function parseSwimDetail(value: unknown): SwimDetail | null | undefined {
  if (!record(value)) return undefined;
  const { location, pool_length_m, pool_unit, strokes, lengths, sets } = value;
  if (location !== null && location !== undefined && !oneOf(SWIM_LOCATIONS, location)) return undefined;
  if (pool_length_m !== null && pool_length_m !== undefined
      && !numberIn(pool_length_m, SWIM_LIMITS.poolLengthM.min, SWIM_LIMITS.poolLengthM.max)) return undefined;
  if (pool_unit !== null && pool_unit !== undefined && !oneOf(SWIM_POOL_UNITS, pool_unit)) return undefined;
  if (strokes !== null && strokes !== undefined && !integerIn(strokes, 0, SWIM_LIMITS.strokes)) return undefined;
  const rawLengths = lengths ?? [];
  const rawSets = sets ?? [];
  if (!Array.isArray(rawLengths) || rawLengths.length > SWIM_LIMITS.lengths) return undefined;
  if (!Array.isArray(rawSets) || rawSets.length > SWIM_LIMITS.sets) return undefined;
  const parsedLengths = rawLengths.map(parseLength);
  const parsedSets = rawSets.map(parseSet);
  if (parsedLengths.some((l) => l === undefined) || parsedSets.some((s) => s === undefined)) return undefined;
  const byStart = <T extends { start_s: number }>(a: T, b: T) => a.start_s - b.start_s;
  const detail: SwimDetail = {
    location: oneOf(SWIM_LOCATIONS, location) ? location : null,
    pool_length_m: typeof pool_length_m === 'number' ? Math.round(pool_length_m * 100) / 100 : null,
    pool_unit: typeof pool_length_m === 'number' && oneOf(SWIM_POOL_UNITS, pool_unit) ? pool_unit : null,
    strokes: typeof strokes === 'number' ? strokes : null,
    lengths: (parsedLengths as SwimLength[]).sort(byStart),
    sets: (parsedSets as SwimSet[]).sort(byStart),
  };
  const empty = detail.location === null && detail.pool_length_m === null && detail.strokes === null
    && detail.lengths.length === 0 && detail.sets.length === 0;
  return empty ? null : detail;
}

/** Stored text back to a detail; null when the text is not one. */
export function parseStoredSwimDetail(text: string): SwimDetail | null {
  try {
    return parseSwimDetail(JSON.parse(text)) ?? null;
  } catch {
    return null;
  }
}

export interface SwimStrokeShare {
  stroke: SwimStroke;
  lengths: number;
  distance_m: number | null;
}

export interface SwimSummary {
  length_count: number;
  /** Strokes in the lengths that counted them, else the swim's own total. */
  strokes: number | null;
  /** Mean strokes per length over the lengths with a count. */
  strokes_per_length: number | null;
  /** SWOLF: mean seconds plus strokes per length, over lengths with both. */
  swolf: number | null;
  /** Lengths by stroke, most lengths first. */
  stroke_breakdown: SwimStrokeShare[];
}

const mean = (values: number[]) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : null);
const oneDecimal = (value: number | null) => (value === null ? null : Math.round(value * 10) / 10);

/** What the day view shows above a swim's lengths. Pure, so it is tested. */
export function summarizeSwim(detail: SwimDetail): SwimSummary {
  const counted = detail.lengths.filter((l) => l.strokes !== null);
  const lengthStrokes = counted.reduce((sum, l) => sum + (l.strokes ?? 0), 0);
  const swolfs = counted.filter((l) => l.duration_s > 0).map((l) => l.duration_s + (l.strokes ?? 0));
  const shares = new Map<SwimStroke, SwimStrokeShare>();
  for (const length of detail.lengths) {
    const share = shares.get(length.stroke) ?? { stroke: length.stroke, lengths: 0, distance_m: 0 };
    share.lengths += 1;
    share.distance_m = share.distance_m === null || length.distance_m === null ? null : tenth(share.distance_m + length.distance_m);
    shares.set(length.stroke, share);
  }
  return {
    length_count: detail.lengths.length,
    strokes: counted.length ? lengthStrokes : detail.strokes,
    strokes_per_length: oneDecimal(mean(counted.map((l) => l.strokes ?? 0))),
    swolf: oneDecimal(mean(swolfs)),
    stroke_breakdown: [...shares.values()].sort(
      (a, b) => b.lengths - a.lengths || SWIM_STROKES.indexOf(a.stroke) - SWIM_STROKES.indexOf(b.stroke)),
  };
}
