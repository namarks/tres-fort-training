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
  const moving = movingClock([...track.map((s) => s.t), ...heartRate.map((s) => s.t)]);
  const onMoving = (samples: readonly Sample[]) => samples.map(({ t, v }) => ({ t: moving(t), v }));
  const distance: Sample[] = [];
  const altitude: Sample[] = [];
  for (const s of track) {
    if (s.d !== null) distance.push({ t: moving(s.t), v: s.d });
    if (s.alt !== null) altitude.push({ t: moving(s.t), v: s.alt });
  }
  return {
    heartRate: encodeHeartRate(onMoving(heartRate), startMs),
    power: encodePowerSeries(onMoving(power), onMoving(cadence), startMs, { distance, altitude }),
  };
}

/** Elapsed seconds to moving seconds over every time any stream has a
 * reading: a gap longer than a pause is taken out. */
function movingClock(times: readonly number[]): (t: number) => number {
  const sorted = [...new Set(times.filter((t) => Number.isFinite(t) && t >= 0))].sort((a, b) => a - b);
  const at = new Map<number, number>();
  let movingT = 0;
  for (let i = 0; i < sorted.length; i++) {
    if (i > 0) {
      const gap = sorted[i]! - sorted[i - 1]!;
      if (gap <= PAUSE_GAP_S) movingT += gap;
    } else {
      movingT = sorted[0]!;
    }
    at.set(sorted[i]!, movingT);
  }
  return (t) => at.get(t) ?? -1;
}
