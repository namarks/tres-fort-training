// Apple Maps on the web (MapKit JS), loaded only when a route is shown.
// docs/plans/run-recorder P5: the owner chose Apple Maps for the web, as in
// the app. Nothing is requested from Apple until a member opens a day with
// a recorded route, and never when the site has no MapKit JS token.
import { fetchMapToken } from './api';
import { replayAt, routeEnds, routeReplay, type LatLon } from './routeMap';

/** The parts of the MapKit JS namespace the route map uses. */
export interface MapKitApi {
  load(libraries: string[]): Promise<unknown>;
  addEventListener(type: 'error', listener: (event: unknown) => void): void;
  Map: new (parent: HTMLElement, options?: Record<string, unknown>) => MapKitMap;
  Coordinate: new (latitude: number, longitude: number) => unknown;
  PolylineOverlay: new (points: unknown[], options?: { style?: MapKitStyle }) => MapKitPolyline;
  Annotation: new (coordinate: unknown, factory: () => HTMLElement, options?: Record<string, unknown>) => MapKitAnnotation;
  Style: new (options?: Record<string, unknown>) => MapKitStyle;
  Padding: new (top: number, right: number, bottom: number, left: number) => unknown;
}

export interface MapKitPolyline {
  points: unknown[];
  style: MapKitStyle;
}

export interface MapKitAnnotation {
  coordinate: unknown;
}

export interface MapKitMap {
  addOverlays(overlays: unknown[]): unknown;
  addAnnotations(annotations: unknown[]): unknown;
  removeAnnotation(annotation: unknown): unknown;
  showItems(items: unknown[], options?: Record<string, unknown>): unknown;
  destroy(): void;
}

export interface MapKitStyle {
  strokeColor: string;
  strokeOpacity?: number;
}

declare global {
  interface Window {
    mapkit?: MapKitApi;
  }
}

/** MapKit JS 6, the current major version, as Apple's own loader picks it. */
export const MAPKIT_SCRIPT = 'https://cdn.apple-mapkit.com/mk/6/mapkit.core.js';
/** A basic map, its route overlays and the start, finish and runner
 * markers; no search or user location. */
export const MAPKIT_LIBRARIES = ['map', 'overlays', 'annotations'];
const READY_CALLBACK = 'tresFortMapKitReady';

export class MapUnavailableError extends Error {}

export interface MapKitLoaderDeps {
  fetchToken(): Promise<string | null>;
  /** Adds the script element and settles when it has loaded or failed. */
  appendScript(attributes: Record<string, string>): Promise<void>;
  current(): MapKitApi | undefined;
}

/**
 * Loads MapKit JS with the site's token, the way Apple's mapkit-loader does:
 * a script element carrying the token and libraries, then `mapkit.load`.
 * Rejects without contacting Apple when the site has no token.
 */
export async function startMapKit(deps: MapKitLoaderDeps, onError: () => void): Promise<MapKitApi> {
  const token = await deps.fetchToken();
  if (!token) throw new MapUnavailableError('not_configured');
  let mapkit = deps.current();
  if (!mapkit) {
    await deps.appendScript({
      src: MAPKIT_SCRIPT,
      'data-callback': READY_CALLBACK,
      'data-libraries': MAPKIT_LIBRARIES.join(','),
      'data-token': token,
    });
    mapkit = deps.current();
  }
  if (!mapkit || typeof mapkit.load !== 'function') throw new MapUnavailableError('not_loaded');
  // MapKit checks the token after the script runs; a refused token (wrong
  // domain, revoked, expired) arrives later as this event.
  mapkit.addEventListener('error', onError);
  await mapkit.load(MAPKIT_LIBRARIES);
  return mapkit;
}

const browserDeps: MapKitLoaderDeps = {
  fetchToken: fetchMapToken,
  appendScript(attributes) {
    return new Promise((resolve, reject) => {
      const callbacks = window as unknown as Record<string, unknown>;
      callbacks[READY_CALLBACK] ??= () => {};
      const script = document.createElement('script');
      script.async = true;
      script.crossOrigin = 'anonymous';
      for (const [name, value] of Object.entries(attributes)) script.setAttribute(name, value);
      script.addEventListener('load', () => resolve(), { once: true });
      script.addEventListener('error', () => reject(new MapUnavailableError('script_failed')), { once: true });
      document.head.appendChild(script);
    });
  },
  current: () => window.mapkit,
};

let loading: Promise<MapKitApi> | null = null;
let failed = false;
const failureListeners = new Set<() => void>();

function markFailed() {
  failed = true;
  for (const listener of failureListeners) listener();
}

/** MapKit JS, loaded once per page. A failure lasts until the page reloads. */
export function loadMapKit(): Promise<MapKitApi> {
  loading ??= startMapKit(browserDeps, markFailed).catch((error: unknown) => {
    markFailed();
    throw error;
  });
  return loading;
}

/** Calls `listener` when MapKit fails, now or later; returns an unsubscribe. */
export function onMapKitFailure(listener: () => void): () => void {
  if (failed) {
    queueMicrotask(listener);
    return () => {};
  }
  failureListeners.add(listener);
  return () => failureListeners.delete(listener);
}

/** The route color (the brand orange), read from the page so the line matches the theme. */
export function accentColor(element: Element): string {
  return getComputedStyle(element).getPropertyValue('--signal').trim() || '#c22d0c';
}

/** How a route map looks: the day panel's map, or a history card's still preview. */
export type RouteMapLook = 'detail' | 'thumbnail';

/** MapKit JS options for each look. A thumbnail is a muted, still picture
 * of the route, like the iPhone app's card snapshots: no controls, no
 * panning or zooming, so a click falls through to the card. */
export function routeMapOptions(look: RouteMapLook): Record<string, unknown> {
  const shared = {
    colorScheme: 'adaptive',
    showsPointsOfInterest: false,
    showsMapTypeControl: false,
    isRotationEnabled: false,
    showsCompass: 'hidden',
  };
  if (look === 'detail') return { ...shared, showsScale: 'adaptive' };
  return {
    ...shared,
    mapType: 'mutedStandard',
    showsScale: 'hidden',
    showsZoomControl: false,
    showsUserLocationControl: false,
    isScrollEnabled: false,
    isZoomEnabled: false,
  };
}

/** Draws each segment as its own line and frames the whole route. The day
 * panel's map also marks where the run started and finished. */
export function drawRoute(mapkit: MapKitApi, element: HTMLElement, segments: LatLon[][], look: RouteMapLook = 'detail') {
  const map = new mapkit.Map(element, routeMapOptions(look));
  const color = accentColor(element);
  const width = look === 'detail' ? 4 : 3;
  const inset = look === 'detail' ? 24 : 14;
  const styles = segments.map(() => new mapkit.Style({ lineWidth: width, lineJoin: 'round', lineCap: 'round', strokeColor: color }));
  const lines = segments.map((segment, i) =>
    new mapkit.PolylineOverlay(segment.map((p) => new mapkit.Coordinate(p.lat, p.lon)), { style: styles[i] }));
  map.addOverlays(lines);
  map.showItems(lines, { animate: false, padding: new mapkit.Padding(inset, inset, inset, inset) });
  if (look === 'detail') {
    const ends = routeEnds(segments);
    if (ends) {
      map.addAnnotations([
        marker(mapkit, ends.end, 'finish', 'Finish'),
        marker(mapkit, ends.start, 'start', 'Start'),
      ]);
    }
  }
  return { map, styles, lines };
}

/** How long a route takes to replay, whatever its length. */
export const REPLAY_MS = 3200;

/** A dot on the map: the start, the finish, or the runner during a replay. */
export function marker(mapkit: MapKitApi, at: LatLon, kind: 'start' | 'finish' | 'runner', label: string) {
  const size = kind === 'runner' ? 16 : 14;
  return new mapkit.Annotation(new mapkit.Coordinate(at.lat, at.lon), () => {
    const dot = document.createElement('div');
    dot.className = `route-marker ${kind}`;
    dot.setAttribute('role', 'img');
    dot.setAttribute('aria-label', label);
    return dot;
  }, {
    anchorOffset: new DOMPoint(0, size / 2),
    enabled: false,
    animates: false,
    calloutEnabled: false,
    displayPriority: 1000,
    title: label,
  });
}

/**
 * Replays the run once: the route dims, then a runner travels it from start
 * to finish, lighting the line behind them, at an even pace by distance.
 * Returns a function that stops the replay and leaves the finished route.
 */
export function replayRoute(mapkit: MapKitApi, drawn: ReturnType<typeof drawRoute>, segments: LatLon[][]): () => void {
  const replay = routeReplay(segments);
  const start = routeEnds(replay.segments)?.start;
  if (!start || replay.total <= 0) return () => {};
  const { map, styles } = drawn;
  for (const style of styles) style.strokeOpacity = 0.3;
  const color = styles[0]?.strokeColor ?? '#c22d0c';
  const trailStyle = new mapkit.Style({ lineWidth: 4, lineJoin: 'round', lineCap: 'round', strokeColor: color });
  const coordinate = (p: LatLon) => new mapkit.Coordinate(p.lat, p.lon);
  const trails: MapKitPolyline[] = [];
  const runner = marker(mapkit, start, 'runner', 'Runner');
  map.addAnnotations([runner]);
  let frame = 0;
  let began: number | null = null;
  let stopped = false;
  const finish = () => {
    if (stopped) return;
    stopped = true;
    cancelAnimationFrame(frame);
    for (const style of styles) style.strokeOpacity = 1;
    try { map.removeAnnotation(runner); } catch { /* the map was destroyed */ }
    trails.forEach((t) => { t.points = []; });
  };
  const tick = (now: number) => {
    if (stopped) return;
    began ??= now;
    const t = Math.min(1, (now - began) / REPLAY_MS);
    const eased = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
    const { done, at } = replayAt(replay, eased);
    done.forEach((points, i) => {
      if (!trails[i]) {
        trails[i] = new mapkit.PolylineOverlay([], { style: trailStyle });
        map.addOverlays([trails[i]]);
      }
      trails[i]!.points = points.map(coordinate);
    });
    if (at) runner.coordinate = coordinate(at);
    if (t < 1) frame = requestAnimationFrame(tick);
    else finish();
  };
  frame = requestAnimationFrame(tick);
  return finish;
}

/** True when the member asked their system for less motion. */
export function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
