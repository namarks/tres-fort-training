// The series Tres Fort keeps for a ride synced from intervals.icu
// (docs/plans/run-detail-charts P8): heart rate, power, cadence, distance
// and elevation, so a Zwift ride's charts, best efforts and time in zones
// don't depend on intervals.icu still having the ride. Pure: no D1, no
// network. The sync reads the ride's streams once and keeps what this
// returns in activity_heart_rates and activity_power_series, the tables a
// .fit or Apple Health ride already uses. GPS positions are not kept: an
// outdoor ride's map still comes from intervals.icu.

import { PAUSE_GAP_S, samplesFromProvider, type ProviderStreams } from './activityStreams';
import { encodeHeartRate, type EncodedHeartRate } from './heartRateSeries';
import { encodePowerSeries, type EncodedPowerSeries } from './powerSeries';
import type { Sample } from './trainingLoad';

export interface IntervalsRideSeries {
  heartRate: EncodedHeartRate | null;
  power: EncodedPowerSeries | null;
}

/**
 * A ride's streams as kept series. intervals.icu's clock is elapsed seconds
 * from the start; the kept series are on moving time, so a recording gap
 * longer than a pause adds no time, the same rule the charts use when they
 * read intervals.icu live. `startMs` is the ride's start (epoch ms), or null.
 */
export function rideSeriesFromIntervals(streams: ProviderStreams, startMs: number | null): IntervalsRideSeries {
  const { track, heartRate, power, cadence } = samplesFromProvider(streams);
  const clock = movingClock(track.map((s) => s.t));
  const onMoving = (samples: readonly Sample[]) => samples.map(({ t, v }) => ({ t: clock.moving(t), v }));
  const distance: Sample[] = [];
  const altitude: Sample[] = [];
  // Ground a provider's distance counted across a pause is dropped, as the
  // clock drops the time and the live charts do: the first reading after a
  // pause continues from the last one before it.
  let last: { d: number; stretch: number } | null = null;
  let offset = 0;
  for (const s of track) {
    const t = clock.moving(s.t);
    if (s.d !== null) {
      const stretch = clock.stretch(s.t);
      if (last && stretch !== last.stretch) offset = s.d - last.d;
      const d = s.d - offset;
      distance.push({ t, v: d });
      last = { d, stretch };
    }
    if (s.alt !== null) altitude.push({ t, v: s.alt });
  }
  return {
    heartRate: encodeHeartRate(onMoving(heartRate), startMs),
    power: encodePowerSeries(onMoving(power), onMoving(cadence), startMs, { distance, altitude }),
  };
}

/** Elapsed seconds to moving seconds over the timeline's samples (every
 * reading of every stream is at one): a gap longer than a pause is taken
 * out and starts a new stretch. Unknown times map to -1, which no encoder
 * keeps. */
function movingClock(times: readonly number[]): { moving(t: number): number; stretch(t: number): number } {
  const sorted = [...new Set(times.filter((t) => Number.isFinite(t) && t >= 0))].sort((a, b) => a - b);
  const at = new Map<number, { m: number; stretch: number }>();
  let movingT = 0;
  let stretch = 0;
  for (let i = 0; i < sorted.length; i++) {
    if (i > 0) {
      const gap = sorted[i]! - sorted[i - 1]!;
      if (gap <= PAUSE_GAP_S) movingT += gap;
      else stretch += 1;
    } else {
      movingT = sorted[0]!;
    }
    at.set(sorted[i]!, { m: movingT, stretch });
  }
  return {
    moving: (t) => at.get(t)?.m ?? -1,
    stretch: (t) => at.get(t)?.stretch ?? -1,
  };
}
