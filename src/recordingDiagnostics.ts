/**
 * What the run recorder saw while recording (docs/plans/run-recorder P5(e)),
 * kept so a run can be diagnosed after the phone has uploaded and deleted
 * it: every pause with whether the member tapped it or auto-pause started
 * it, whether "Pause when I stop" was on, and each GPS fix's speed reading
 * and horizontal accuracy, running or paused, with how much the phone was
 * moving then by its accelerometer, which is what auto-pause decides from. The app sends it with `POST /api/activities/recordings`
 * (multipart field `diagnostics`, JSON in the stored shape below).
 *
 * Kept as canonical JSON text in `recording_diagnostics` (migration 0076).
 * Private to the member, like routes: never in group views, coach tools or
 * intervals.icu. Read only by the owner diagnostics lookups
 * (docs/DIAGNOSTICS.md) and the account export. Pure: no D1.
 */

export interface RecordingPause {
  /** Epoch milliseconds. */
  start_ms: number;
  /** Null only for a pause still open when the run was sent. */
  end_ms: number | null;
  /** True when auto-pause started it, false when the member tapped Pause. */
  automatic: boolean;
}

/**
 * GPS speed readings, one per fix, delta-coded. Fix i is at `start_ms` plus
 * the sum of `dt_ms[0..i]` (so `dt_ms[0]` is 0). `speed_cms[i]` is the
 * phone's speed reading in centimeters a second, or null when the fix
 * carried none; `accuracy_dm[i]` is its horizontal accuracy in decimeters.
 * `motion_mg[i]`, when the app sent it, is the phone's motion level around
 * the fix (the accelerometer's RMS acceleration, gravity removed, over the
 * two seconds before it) in thousandths of g, or null without a reading.
 */
export interface EncodedSpeeds {
  start_ms: number;
  dt_ms: number[];
  speed_cms: (number | null)[];
  accuracy_dm: number[];
  motion_mg?: (number | null)[];
}

export interface RecordingDiagnostics {
  v: 1;
  /** "Pause when I stop" was on for this run; null when the app didn't say. */
  auto_pause: boolean | null;
  pauses: RecordingPause[];
  speeds: EncodedSpeeds | null;
}

/** One fix decoded for reading. */
export interface SpeedReading {
  t_ms: number;
  speed_mps: number | null;
  accuracy_m: number;
  /** In g; present only on runs that sent motion levels. */
  motion_g?: number | null;
}

export const RECORDING_DIAGNOSTICS_LIMITS = {
  pauses: 2_000,
  /** A day of fixes at one a second. */
  speeds: 86_400,
  /** 50 m/s: far faster than anyone runs. */
  speedCms: 5_000,
  /** 10 km: any accuracy the phone could report. */
  accuracyDm: 100_000,
  /** 20 g: far more than a runner's phone feels. */
  motionMg: 20_000,
  /** One gap between fixes, and the whole span: a day. */
  spanMs: 24 * 60 * 60 * 1000,
  /** Room for a day of fixes in the multipart field. */
  chars: 2 * 1024 * 1024,
} as const;

const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const integerIn = (value: unknown, min: number, max: number): value is number =>
  Number.isSafeInteger(value) && (value as number) >= min && (value as number) <= max;
const onlyKeys = (value: Record<string, unknown>, keys: readonly string[]) =>
  Object.keys(value).every((key) => keys.includes(key));

/** Epoch milliseconds from 2001 (before the recorder existed) to 2100. */
const isEpochMs = (value: unknown): value is number =>
  integerIn(value, 978_307_200_000, 4_102_444_800_000);

function parsePauses(value: unknown): RecordingPause[] | null {
  if (!Array.isArray(value) || value.length > RECORDING_DIAGNOSTICS_LIMITS.pauses) return null;
  const pauses: RecordingPause[] = [];
  for (const [index, item] of value.entries()) {
    if (!record(item) || !onlyKeys(item, ['start_ms', 'end_ms', 'automatic'])) return null;
    const { start_ms: start, end_ms: end, automatic } = item;
    if (!isEpochMs(start) || typeof automatic !== 'boolean') return null;
    if (end === null || end === undefined) {
      // Only the last pause can still be open.
      if (index !== value.length - 1) return null;
    } else if (!isEpochMs(end) || end < start) {
      return null;
    }
    const previous = pauses[pauses.length - 1];
    if (previous && (previous.end_ms === null || start < previous.end_ms)) return null;
    pauses.push({ start_ms: start, end_ms: end ?? null, automatic });
  }
  return pauses;
}

function parseSpeeds(value: unknown): EncodedSpeeds | null | undefined {
  if (value === null || value === undefined) return null;
  if (!record(value) || !onlyKeys(value, ['start_ms', 'dt_ms', 'speed_cms', 'accuracy_dm', 'motion_mg'])) {
    return undefined;
  }
  const { start_ms: start, dt_ms: dt, speed_cms: speed, accuracy_dm: accuracy, motion_mg: motion } = value;
  const limits = RECORDING_DIAGNOSTICS_LIMITS;
  if (!isEpochMs(start) || !Array.isArray(dt) || !Array.isArray(speed) || !Array.isArray(accuracy)) return undefined;
  if (dt.length === 0 || dt.length > limits.speeds || speed.length !== dt.length || accuracy.length !== dt.length) {
    return undefined;
  }
  if (dt[0] !== 0) return undefined;
  if (motion !== undefined && (!Array.isArray(motion) || motion.length !== dt.length)) return undefined;
  let span = 0;
  for (let i = 0; i < dt.length; i++) {
    if (!integerIn(dt[i], 0, limits.spanMs)) return undefined;
    span += dt[i] as number;
    if (span > limits.spanMs) return undefined;
    if (speed[i] !== null && !integerIn(speed[i], 0, limits.speedCms)) return undefined;
    if (!integerIn(accuracy[i], 0, limits.accuracyDm)) return undefined;
    if (motion && motion[i] !== null && !integerIn(motion[i], 0, limits.motionMg)) return undefined;
  }
  return {
    start_ms: start,
    dt_ms: dt as number[],
    speed_cms: speed as (number | null)[],
    accuracy_dm: accuracy as number[],
    ...(motion ? { motion_mg: motion as (number | null)[] } : {}),
  };
}

/** Diagnostics from the recorder's `diagnostics` field (JSON text) or from
 * storage. Null when they aren't well formed: pauses in order and not
 * overlapping, fixes in time order with their arrays the same length. */
export function parseRecordingDiagnostics(raw: unknown): RecordingDiagnostics | null {
  let value = raw;
  if (typeof raw === 'string') {
    if (raw.length > RECORDING_DIAGNOSTICS_LIMITS.chars) return null;
    try { value = JSON.parse(raw); } catch { return null; }
  }
  if (!record(value) || !onlyKeys(value, ['v', 'auto_pause', 'pauses', 'speeds']) || value.v !== 1) return null;
  const autoPause = value.auto_pause;
  if (autoPause !== null && autoPause !== undefined && typeof autoPause !== 'boolean') return null;
  const pauses = parsePauses(value.pauses ?? []);
  const speeds = parseSpeeds(value.speeds);
  if (!pauses || speeds === undefined) return null;
  // Nothing to keep.
  if (pauses.length === 0 && speeds === null && (autoPause === null || autoPause === undefined)) return null;
  return { v: 1, auto_pause: autoPause ?? null, pauses, speeds };
}

/** Canonical stored text for well-formed diagnostics. */
export function serializeRecordingDiagnostics(diagnostics: RecordingDiagnostics): string {
  return JSON.stringify({
    v: 1,
    auto_pause: diagnostics.auto_pause,
    pauses: diagnostics.pauses.map((p) => ({ start_ms: p.start_ms, end_ms: p.end_ms, automatic: p.automatic })),
    speeds: diagnostics.speeds && {
      start_ms: diagnostics.speeds.start_ms,
      dt_ms: diagnostics.speeds.dt_ms,
      speed_cms: diagnostics.speeds.speed_cms,
      accuracy_dm: diagnostics.speeds.accuracy_dm,
      ...(diagnostics.speeds.motion_mg ? { motion_mg: diagnostics.speeds.motion_mg } : {}),
    },
  });
}

/** The fixes back, one object each, in meters and meters a second. */
export function decodeSpeeds(speeds: EncodedSpeeds): SpeedReading[] {
  const out: SpeedReading[] = [];
  let t = speeds.start_ms;
  for (let i = 0; i < speeds.dt_ms.length; i++) {
    t += speeds.dt_ms[i]!;
    const cms = speeds.speed_cms[i];
    const mg = speeds.motion_mg?.[i];
    out.push({
      t_ms: t,
      speed_mps: cms === null || cms === undefined ? null : cms / 100,
      accuracy_m: speeds.accuracy_dm[i]! / 10,
      ...(speeds.motion_mg ? { motion_g: mg === null || mg === undefined ? null : mg / 1000 } : {}),
    });
  }
  return out;
}
