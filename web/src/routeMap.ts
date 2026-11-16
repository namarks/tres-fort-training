// A run's route on the web (docs/plans/run-recorder P5 and P6). Pure: the
// map itself is drawn by RouteMapView.tsx.
import { asEncodedRoute, decodeRoute } from '../../src/activityRoute';
import type { StateResponse } from './api';
import type { RunLap } from './runLaps';

export interface LatLon {
  lat: number;
  lon: number;
}

/** `GET /api/activities/:id/route`. */
export interface ActivityRouteResponse {
  /** The activity that carries the route, which can differ from the
   * activity asked for when that is the intervals.icu copy of a recorded or
   * Apple Health run. */
  activity_id: string;
  /** A run recorded in the app, a track intervals.icu sent, or the route
   * Apple Health saved with another app's run. */
  source?: 'recording' | 'intervals' | 'healthkit';
  /** The run recorded in the app; null otherwise. */
  recording_id: string | null;
  /** Null for a run recorded without GPS fixes. */
  route: unknown;
  /** Heart rate at the stop of a run recorded in the app, and one and two
   * minutes later (run-recorder P7). Absent from an older API. */
  heart_rate_recovery?: HeartRateRecovery | null;
  /** A planned run's laps, one per step (planned-runs P9). Absent from an
   * older API. */
  laps?: RunLap[] | null;
}

export interface HeartRateRecovery {
  at_stop: number;
  after_60s: number | null;
  after_120s: number | null;
}

/**
 * How far heart rate fell after the run, the way the iPhone app says it:
 * "28 bpm in 1 min · 44 in 2 min". Null when nothing after the stop was
 * measured. A reading that rose says so with a plus sign.
 */
export function recoveryText(recovery: HeartRateRecovery | null | undefined): string | null {
  if (!recovery) return null;
  const drop = (after: number) => {
    const d = recovery.at_stop - after;
    return d >= 0 ? `${d}` : `+${-d}`;
  };
  const parts: string[] = [];
  if (recovery.after_60s !== null) parts.push(`${drop(recovery.after_60s)} bpm in 1 min`);
  if (recovery.after_120s !== null) {
    parts.push(parts.length > 0 ? `${drop(recovery.after_120s)} in 2 min` : `${drop(recovery.after_120s)} bpm in 2 min`);
  }
  return parts.length > 0 ? parts.join(' · ') : null;
}

/** Where a run's route can come from (docs/plans/run-recorder P5 and P6). */
const ROUTE_SOURCES = new Set(['recording', 'intervals', 'healthkit']);

/**
 * The activities whose card may show a route: runs recorded in the app,
 * either the recording itself or the intervals.icu copy it was matched to,
 * intervals.icu runs whose device kept a GPS track, and Apple Health runs
 * whose route the iPhone app sent. The same rule as the iPhone app
 * (`mayHaveRoute`).
 */
export function routableActivityIds(state: StateResponse): Set<string> {
  return new Set(state.external_activities
    .filter((a) => a.deleted_at === null && ((a.kind === 'run' && ROUTE_SOURCES.has(a.source))
      // An open-water swim's track (sport-activities P4): the Apple Health
      // route, also behind the copy it was matched to, or intervals.icu's.
      || (a.kind === 'swim' && (a.distance_m ?? 0) > 0)))
    .map((a) => a.id));
}

const isCoordinate = (p: LatLon) =>
  Number.isFinite(p.lat) && Number.isFinite(p.lon) && Math.abs(p.lat) <= 90 && Math.abs(p.lon) <= 180;

/** The lines a map draws: each segment's valid points, when it has two or
 * more. Nothing for a route that isn't well formed. */
export function drawableSegments(route: unknown): LatLon[][] {
  const encoded = asEncodedRoute(route);
  if (!encoded) return [];
  return decodeRoute(encoded)
    .map((segment) => segment.map(({ lat, lon }) => ({ lat, lon })).filter(isCoordinate))
    .filter((segment) => segment.length > 1);
}

/**
 * SVG path data for the route's shape, fitted into a `width` x `height` box
 * with `margin` on every side and centered. Longitude is scaled by the
 * cosine of the middle latitude so the shape isn't stretched. Used when no
 * map can be shown.
 */
export function routeOutline(segments: LatLon[][], width: number, height: number, margin = 12): string[] {
  const place = outlineFit(segments, width, height, margin);
  if (!place) return [];
  const at = (p: LatLon) => place(p).map((v) => v.toFixed(1)).join(' ');
  return segments
    .filter((segment) => segment.length > 1)
    .map((segment) => segment.map((p, i) => `${i === 0 ? 'M' : 'L'}${at(p)}`).join(''));
}

/** Where the start and finish fall on `routeOutline`'s drawing. */
export function routeOutlineEnds(segments: LatLon[][], width: number, height: number, margin = 12):
  { start: [number, number]; end: [number, number] } | null {
  const place = outlineFit(segments, width, height, margin);
  const ends = routeEnds(segments.filter((segment) => segment.length > 1));
  return place && ends ? { start: place(ends.start), end: place(ends.end) } : null;
}

/** Maps a point into the outline's box, or null for a route with no points. */
function outlineFit(segments: LatLon[][], width: number, height: number, margin: number): ((p: LatLon) => [number, number]) | null {
  const points = segments.flat();
  const first = points[0];
  if (!first) return null;
  let minLat = first.lat, maxLat = first.lat, minLon = first.lon, maxLon = first.lon;
  for (const p of points) {
    minLat = Math.min(minLat, p.lat);
    maxLat = Math.max(maxLat, p.lat);
    minLon = Math.min(minLon, p.lon);
    maxLon = Math.max(maxLon, p.lon);
  }
  const kx = Math.cos((((minLat + maxLat) / 2) * Math.PI) / 180);
  const spanX = (maxLon - minLon) * kx;
  const spanY = maxLat - minLat;
  const fit = (room: number, span: number) => (span > 0 ? Math.max(room, 0) / span : Infinity);
  let scale = Math.min(fit(width - 2 * margin, spanX), fit(height - 2 * margin, spanY));
  if (!Number.isFinite(scale)) scale = 0;
  const left = (width - spanX * scale) / 2;
  const top = (height - spanY * scale) / 2;
  return (p) => [left + (p.lon - minLon) * kx * scale, top + (maxLat - p.lat) * scale];
}

/** The route's first and last points: where the run started and finished.
 * Null for a route with no points. */
export function routeEnds(segments: LatLon[][]): { start: LatLon; end: LatLon } | null {
  const first = segments.find((s) => s.length > 0);
  const last = [...segments].reverse().find((s) => s.length > 0);
  if (!first || !last) return null;
  return { start: first[0]!, end: last[last.length - 1]! };
}

/** Meters between two points (haversine). */
export function metersBetween(a: LatLon, b: LatLon): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** A route ready to replay: at most `maxPoints` points per segment (always
 * keeping each segment's ends), with the distance covered at each point. */
export interface RouteReplay {
  segments: LatLon[][];
  /** Meters covered at each point, by segment; gaps between segments add nothing. */
  covered: number[][];
  total: number;
}

export function routeReplay(segments: LatLon[][], maxPoints = 400): RouteReplay {
  const count = segments.reduce((n, s) => n + s.length, 0);
  const step = Math.max(1, Math.ceil(count / maxPoints));
  const kept = segments.filter((s) => s.length > 0)
    .map((s) => s.filter((_, i) => i % step === 0 || i === s.length - 1));
  let total = 0;
  const covered = kept.map((s) => s.map((p, i) => {
    if (i > 0) total += metersBetween(s[i - 1]!, p);
    return total;
  }));
  return { segments: kept, covered, total };
}

/**
 * The part of the route covered once `fraction` (0 to 1) of its distance is
 * run: the finished segments, the current one up to the runner, and where
 * the runner is. A route with no distance is finished at once.
 */
export function replayAt(replay: RouteReplay, fraction: number): { done: LatLon[][]; at: LatLon | null } {
  const ends = routeEnds(replay.segments);
  if (!ends) return { done: [], at: null };
  if (replay.total <= 0 || fraction >= 1) return { done: replay.segments, at: ends.end };
  const target = Math.max(0, fraction) * replay.total;
  const done: LatLon[][] = [];
  for (let s = 0; s < replay.segments.length; s++) {
    const points = replay.segments[s]!;
    const meters = replay.covered[s]!;
    if (meters[meters.length - 1]! < target) { done.push(points); continue; }
    const i = meters.findIndex((m) => m >= target);
    if (i <= 0) {
      done.push([points[0]!]);
      return { done, at: points[0]! };
    }
    const a = points[i - 1]!, b = points[i]!;
    const span = meters[i]! - meters[i - 1]!;
    const t = span > 0 ? (target - meters[i - 1]!) / span : 1;
    const at = { lat: a.lat + (b.lat - a.lat) * t, lon: a.lon + (b.lon - a.lon) * t };
    done.push([...points.slice(0, i), at]);
    return { done, at };
  }
  return { done: replay.segments, at: ends.end };
}
