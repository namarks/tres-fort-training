// Power and cadence series Tres Fort keeps for a member's own rides
// (docs/plans/run-detail-charts P7, migration 0074): a ride imported from a
// .fit file or from Garmin, or pushed from Apple Health with a power meter's
// readings, so its power chart, best efforts and zones don't depend on
// intervals.icu. Pure: no D1. Like heart rate (src/heartRateSeries.ts),
// readings are kept one per whole second of moving time (pauses already
// taken out by the source), delta-coded in JSON text, so a long ride stays
// far below D1's 2 MB row limit.

import type { FitActivity } from './fitFile';
import type { Sample } from './trainingLoad';
import { MAX_CADENCE_RPM, MAX_POWER_W } from './ridePower';

/** One value a second: reading i is at `sum(dt[0..i])` seconds of moving
 * time, `v[i]` its whole watts or revolutions a minute. */
export interface EncodedValues {
  dt: number[];
  v: number[];
}

/**
 * The stored and exported form. `start_ms` is the epoch millisecond the
 * clock starts at (the workout's start), null when the source didn't say.
 * Either series may be null; at least one is not.
 */
export interface EncodedPowerSeries {
  v: 1;
  start_ms: number | null;
  power: EncodedValues | null;
  cadence: EncodedValues | null;
}

/** A day at one reading a second. */
export const MAX_POWER_POINTS = 86_400;

function encodeValues(samples: readonly Sample[], max: number): EncodedValues | null {
  const sums = new Map<number, { s: number; n: number }>();
  for (const { t, v } of samples) {
    if (!Number.isFinite(t) || t < 0 || !Number.isFinite(v) || v < 0 || v > max) continue;
    const second = Math.floor(t);
    if (second >= MAX_POWER_POINTS) continue;
    const bucket = sums.get(second);
    if (bucket) {
      bucket.s += v;
      bucket.n += 1;
    } else {
      sums.set(second, { s: v, n: 1 });
    }
  }
  if (sums.size === 0) return null;
  const out: EncodedValues = { dt: [], v: [] };
  let last = 0;
  for (const second of [...sums.keys()].sort((a, b) => a - b)) {
    const { s, n } = sums.get(second)!;
    out.dt.push(second - last);
    out.v.push(Math.round(s / n));
    last = second;
  }
  return out;
}

/**
 * Encode power and cadence readings on a moving-time clock (seconds from the
 * start, pauses taken out). Readings in the same whole second are averaged;
 * impossible ones are dropped. Power that never leaves zero is a meter that
 * paired but didn't measure, and is not kept. Null when nothing is left.
 */
export function encodePowerSeries(
  power: readonly Sample[],
  cadence: readonly Sample[],
  startMs: number | null,
): EncodedPowerSeries | null {
  let watts = encodeValues(power, MAX_POWER_W);
  if (watts && watts.v.every((w) => w === 0)) watts = null;
  let rpm = encodeValues(cadence, MAX_CADENCE_RPM);
  if (rpm && rpm.v.every((c) => c === 0)) rpm = null;
  if (!watts && !rpm) return null;
  return {
    v: 1,
    start_ms: startMs !== null && Number.isSafeInteger(startMs) ? startMs : null,
    power: watts,
    cadence: rpm,
  };
}

/** Readings in moving seconds from the start. */
export function decodeValues(values: EncodedValues | null): Sample[] {
  if (!values) return [];
  const out: Sample[] = [];
  let t = 0;
  for (let i = 0; i < values.dt.length; i++) {
    t += values.dt[i]!;
    out.push({ t, v: values.v[i]! });
  }
  return out;
}

/** Readings kept, for the row's point count. */
export function powerSeriesPoints(series: EncodedPowerSeries): number {
  return Math.max(series.power?.dt.length ?? 0, series.cadence?.dt.length ?? 0);
}

const isIntArray = (a: unknown, ok: (n: number) => boolean): a is number[] =>
  Array.isArray(a) && a.every((n) => Number.isSafeInteger(n) && ok(n as number));

function parseValues(value: unknown, max: number): EncodedValues | null | undefined {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'object') return undefined;
  const { dt, v } = value as Record<string, unknown>;
  if (!isIntArray(dt, (n) => n >= 0) || !isIntArray(v, (n) => n >= 0 && n <= max)) return undefined;
  if (dt.length === 0 || dt.length !== v.length) return undefined;
  return { dt, v };
}

/** A stored series, or null when the text isn't one. */
export function parseStoredPowerSeries(text: string): EncodedPowerSeries | null {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null) return null;
  const record = value as Record<string, unknown>;
  if (record.v !== 1) return null;
  const start = record.start_ms;
  if (start !== undefined && start !== null && !Number.isSafeInteger(start)) return null;
  const power = parseValues(record.power, MAX_POWER_W);
  const cadence = parseValues(record.cadence, MAX_CADENCE_RPM);
  if (power === undefined || cadence === undefined || (!power && !cadence)) return null;
  return { v: 1, start_ms: typeof start === 'number' ? start : null, power, cadence };
}

/** A .fit workout's power and cadence on its timer clock. Cadence is kept
 * only for a ride: a run's is in the device's own steps or strides. */
export function fitPowerSeries(fit: FitActivity): EncodedPowerSeries | null {
  return encodePowerSeries(fit.power, fit.kind === 'ride' ? fit.cadence : [], fit.start_utc_ms);
}
