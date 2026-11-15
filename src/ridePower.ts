// Power and cadence figures of one activity for its detail view
// (docs/plans/run-detail-charts P6): average, normalized and maximum power,
// work, best efforts, time in each power zone and cadence. Pure: no D1, no
// network. The input is per-second readings already on moving time, so a
// pause neither lowers the average nor splits a best effort.

import { normalizedPower } from './trainingLoad';

/** A reading of a value at a moving second. */
export interface MovingReading {
  t: number;
  v: number;
}

export interface PowerZone {
  /** 1 to 7. */
  zone: number;
  name: string;
  /** Lower bound in percent of FTP, inclusive. */
  min_pct: number;
  /** Upper bound in percent of FTP, exclusive; null for the top zone. */
  max_pct: number | null;
  seconds: number;
}

export interface PowerBest {
  /** Length of the effort in seconds. */
  s: number;
  /** Best average watts held for that long. */
  w: number;
}

export interface PowerSummary {
  /** Mean over the seconds with power, coasting (0 W) included. */
  avg_w: number;
  max_w: number;
  /** Normalized power from the same readings; null under 30 s of power. */
  normalized_w: number | null;
  /** Kilojoules of work. */
  work_kj: number;
  /** Best average power for each length the activity is long enough for. */
  best: PowerBest[];
  /** The member's cycling FTP on the activity's date, when set; zones and
   * intensity need it. */
  ftp_w: number | null;
  /** Normalized power over FTP, two places; null without both. */
  intensity: number | null;
  /** Seconds in each of seven zones of FTP; null without an FTP. */
  zones: PowerZone[] | null;
}

export interface CadenceSummary {
  /** Mean while pedalling (or stepping): zeros are coasting, left out. */
  avg_rpm: number;
  max_rpm: number;
}

/** Lengths of the best efforts served, in seconds. */
export const BEST_EFFORT_SECONDS = [5, 30, 60, 300, 1200, 3600] as const;

/** Coggan's seven power zones, as intervals.icu and most head units use. */
export const POWER_ZONES: readonly { zone: number; name: string; min_pct: number; max_pct: number | null }[] = [
  { zone: 1, name: 'Recovery', min_pct: 0, max_pct: 55 },
  { zone: 2, name: 'Endurance', min_pct: 55, max_pct: 76 },
  { zone: 3, name: 'Tempo', min_pct: 76, max_pct: 91 },
  { zone: 4, name: 'Threshold', min_pct: 91, max_pct: 106 },
  { zone: 5, name: 'VO2 max', min_pct: 106, max_pct: 121 },
  { zone: 6, name: 'Anaerobic', min_pct: 121, max_pct: 151 },
  { zone: 7, name: 'Neuromuscular', min_pct: 151, max_pct: null },
];

/** A reading above this is a glitch, not a rider. */
export const MAX_POWER_W = 2500;
export const MAX_CADENCE_RPM = 250;
/** A reading holds across a gap up to this long; a longer gap has no power. */
const HOLD_S = 10;
/** Power must cover this share of moving time to be summarized. */
const MIN_COVERAGE = 0.5;

/** One value a second over `[0, total)`: each second's mean reading, a
 * reading held across a short gap, null where there is none. */
function perSecond(readings: readonly MovingReading[], total: number, valid: (v: number) => boolean): (number | null)[] {
  const n = Math.max(0, Math.floor(total));
  const sum = new Array<number>(n).fill(0);
  const count = new Array<number>(n).fill(0);
  for (const r of readings) {
    if (!Number.isFinite(r.t) || !Number.isFinite(r.v) || !valid(r.v)) continue;
    const i = Math.floor(r.t);
    if (i < 0 || i >= n) continue;
    sum[i] = sum[i]! + r.v;
    count[i] = count[i]! + 1;
  }
  const out: (number | null)[] = new Array(n).fill(null);
  let held: { v: number; at: number } | null = null;
  for (let i = 0; i < n; i++) {
    if (count[i]! > 0) {
      out[i] = sum[i]! / count[i]!;
      held = { v: out[i]!, at: i };
    } else if (held && i - held.at <= HOLD_S) {
      out[i] = held.v;
    }
  }
  return out;
}

/** The best mean of any `length` consecutive seconds that all have power. */
function bestMean(watts: readonly (number | null)[], length: number): number | null {
  let best: number | null = null;
  let sum = 0;
  let run = 0;
  for (let i = 0; i < watts.length; i++) {
    const v = watts[i];
    if (v === null || v === undefined) {
      sum = 0;
      run = 0;
      continue;
    }
    sum += v;
    run += 1;
    if (run > length) {
      sum -= watts[i - length]!;
      run = length;
    }
    if (run === length && (best === null || sum / length > best)) best = sum / length;
  }
  return best;
}

/**
 * Power figures from readings on moving time over `movingSeconds`. Null when
 * power covers under half the moving time, or every reading is zero (a meter
 * paired but not measuring, as the load rules treat it). Zones and intensity
 * need `ftpW`.
 */
export function summarizePower(
  readings: readonly MovingReading[],
  movingSeconds: number,
  ftpW: number | null = null,
): PowerSummary | null {
  const watts = perSecond(readings, movingSeconds, (v) => v >= 0 && v <= MAX_POWER_W);
  const known = watts.filter((v): v is number => v !== null);
  if (known.length === 0 || known.length < MIN_COVERAGE * watts.length) return null;
  const max = known.reduce((m, v) => Math.max(m, v), 0);
  if (max <= 0) return null;
  const total = known.reduce((a, b) => a + b, 0);
  const np = normalizedPower(watts.flatMap((v, t) => (v === null ? [] : [{ t, v }])), 1);
  const ftp = ftpW !== null && Number.isFinite(ftpW) && ftpW > 0 ? ftpW : null;
  const best: PowerBest[] = [];
  for (const s of BEST_EFFORT_SECONDS) {
    if (s > watts.length) break;
    const w = bestMean(watts, s);
    if (w !== null) best.push({ s, w: Math.round(w) });
  }
  let zones: PowerZone[] | null = null;
  if (ftp !== null) {
    zones = POWER_ZONES.map((z) => ({ ...z, seconds: 0 }));
    for (const v of known) {
      const pct = (v / ftp) * 100;
      const zone = zones.find((z) => pct >= z.min_pct && (z.max_pct === null || pct < z.max_pct)) ?? zones[0]!;
      zone.seconds += 1;
    }
  }
  return {
    avg_w: Math.round(total / known.length),
    max_w: Math.round(max),
    normalized_w: np === null ? null : Math.round(np),
    work_kj: Math.round(total / 1000),
    best,
    ftp_w: ftp,
    intensity: ftp !== null && np !== null ? Math.round((np / ftp) * 100) / 100 : null,
    zones,
  };
}

/** Cadence figures from readings on moving time, or null with no pedalling. */
export function summarizeCadence(readings: readonly MovingReading[], movingSeconds: number): CadenceSummary | null {
  const rpm = perSecond(readings, movingSeconds, (v) => v >= 0 && v <= MAX_CADENCE_RPM)
    .filter((v): v is number => v !== null && v > 0);
  if (rpm.length === 0) return null;
  return {
    avg_rpm: Math.round(rpm.reduce((a, b) => a + b, 0) / rpm.length),
    max_rpm: Math.round(rpm.reduce((m, v) => Math.max(m, v), 0)),
  };
}
