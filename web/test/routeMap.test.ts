import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, fetchActivityRoute, fetchMapToken, type StateResponse } from '../src/api';
import { MAPKIT_LIBRARIES, MAPKIT_SCRIPT, MapUnavailableError, routeMapOptions, startMapKit, type MapKitApi } from '../src/mapkit';
import { drawableSegments, metersBetween, recoveryText, replayAt, routableActivityIds, routeEnds, routeOutline, routeOutlineEnds, routeReplay } from '../src/routeMap';

/** The shape src/activityRoute.ts serves: two segments split by a pause. */
const ROUTE = {
  v: 1,
  start_ms: 1761962400000,
  dt: [0, 1000, 1000, 60000, 1000],
  dlat: [45519000, 27, 27, 500, 27],
  dlon: [-122679300, -11, -11, -300, -11],
  alt: [153, null, 154, 150, 150],
  breaks: [3],
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('a recorded route', () => {
  it('decodes into the lines a map draws', () => {
    const segments = drawableSegments(ROUTE);
    expect(segments.map((s) => s.length)).toEqual([3, 2]);
    expect(segments[0]![0]!.lat).toBeCloseTo(45.519, 9);
    expect(segments[0]![0]!.lon).toBeCloseTo(-122.6793, 9);
    expect(segments[1]![0]!.lat).toBeCloseTo(45.519554, 9);
    expect(segments[1]![0]!.lon).toBeCloseTo(-122.679622, 9);
  });

  it('draws no line for a lone point or a route that is not well formed', () => {
    expect(drawableSegments({ ...ROUTE, breaks: [2, 4] }).map((s) => s.length)).toEqual([2, 2]);
    expect(drawableSegments({ ...ROUTE, dlon: [-122679300] })).toEqual([]);
    expect(drawableSegments({ ...ROUTE, v: 2 })).toEqual([]);
    expect(drawableSegments(null)).toEqual([]);
    expect(drawableSegments({ ...ROUTE, dlat: [95000000, 0, 0, 0, 0] })).toEqual([]);
  });

  it('is looked for only on runs recorded in the app, from intervals.icu or from Apple Health', () => {
    const activity = (id: string, source: string, kind: string, deleted_at: number | null = null) =>
      ({ id, source, kind, deleted_at });
    const state = {
      external_activities: [
        activity('recording:activity:u:r1', 'recording', 'run'),
        activity('intervals:activity:i1', 'intervals', 'run'),
        activity('healthkit:h1', 'healthkit', 'run'),
        activity('intervals:activity:i2', 'intervals', 'ride'),
        activity('fit:activity:f1', 'fit', 'run'),
        activity('recording:activity:u:r2', 'recording', 'run', 5),
        // A swim's Apple Health route can sit behind the copy shown.
        { ...activity('fit:activity:s1', 'fit', 'swim'), distance_m: 1500 },
        activity('healthkit:s2', 'healthkit', 'swim'),
      ],
    } as unknown as StateResponse;
    expect([...routableActivityIds(state)])
      .toEqual(['recording:activity:u:r1', 'intervals:activity:i1', 'healthkit:h1', 'fit:activity:s1']);
  });
});

describe('the route without a map', () => {
  it('fits every point inside the margin without stretching the shape', () => {
    // About 1 km east and 1 km north at 45 degrees: a square, not a 1.4:1 box.
    const north = 1000 / 111_320;
    const east = 1000 / (111_320 * Math.cos((45 * Math.PI) / 180));
    const segments = [[{ lat: 45, lon: -122 }, { lat: 45, lon: -122 + east }, { lat: 45 + north, lon: -122 + east }]];
    const [path] = routeOutline(segments, 320, 200, 10);
    const points = path!.slice(1).split('L').map((pair) => pair.split(' ').map(Number) as [number, number]);
    for (const [x, y] of points) {
      expect(x).toBeGreaterThanOrEqual(10 - 0.05);
      expect(x).toBeLessThanOrEqual(310 + 0.05);
      expect(y).toBeGreaterThanOrEqual(10 - 0.05);
      expect(y).toBeLessThanOrEqual(190 + 0.05);
    }
    const width = points[1]![0] - points[0]![0];
    const height = points[1]![1] - points[2]![1];
    expect(width / height).toBeCloseTo(1, 1);
    // North is up.
    expect(points[2]![1]).toBeLessThan(points[1]![1]);
  });

  it('keeps each segment its own line and handles a route that never moved', () => {
    expect(routeOutline(drawableSegments(ROUTE), 320, 200)).toHaveLength(2);
    expect(routeOutline([], 320, 200)).toEqual([]);
    const still = routeOutline([[{ lat: 45, lon: -122 }, { lat: 45, lon: -122 }]], 320, 200);
    expect(still).toEqual(['M160.0 100.0L160.0 100.0']);
  });
});

describe('reading a route and the map token', () => {
  function stubFetch(status: number, body: unknown) {
    const fetch = vi.fn(async () => new Response(JSON.stringify(body), { status }));
    vi.stubGlobal('fetch', fetch);
    return fetch;
  }

  it('asks for the activity route with the page header and reads a not found as no route', async () => {
    const fetch = stubFetch(200, { activity_id: 'recording:activity:u:r1', recording_id: 'r1', route: ROUTE });
    const found = await fetchActivityRoute('intervals:activity:i1');
    expect(found?.recording_id).toBe('r1');
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/activities/intervals%3Aactivity%3Ai1/route');
    expect((init.headers as Record<string, string>)['x-tres-fort-web']).toBe('1');

    stubFetch(200, { activity_id: 'intervals:activity:u:i9', source: 'intervals', recording_id: null, route: ROUTE });
    const track = await fetchActivityRoute('intervals:activity:u:i9');
    expect(track?.recording_id).toBeNull();
    expect(drawableSegments(track?.route).length).toBeGreaterThan(0);

    stubFetch(404, { error: 'not_found' });
    expect(await fetchActivityRoute('a')).toBeNull();
    stubFetch(502, { error: 'intervals_unavailable' });
    await expect(fetchActivityRoute('a')).rejects.toBeInstanceOf(ApiError);
    stubFetch(500, {});
    await expect(fetchActivityRoute('a')).rejects.toBeInstanceOf(ApiError);
  });

  it('reads the map token, or none when maps are not set up', async () => {
    stubFetch(200, { token: 'mapkit-token' });
    expect(await fetchMapToken()).toBe('mapkit-token');
    stubFetch(404, { error: 'not_configured' });
    expect(await fetchMapToken()).toBeNull();
  });
});

describe('loading Apple Maps', () => {
  function fakeMapKit() {
    return {
      load: vi.fn(async () => undefined),
      addEventListener: vi.fn(),
    } as unknown as MapKitApi & { load: ReturnType<typeof vi.fn>; addEventListener: ReturnType<typeof vi.fn> };
  }

  it('never contacts Apple when the site has no token', async () => {
    const appendScript = vi.fn(async () => undefined);
    const onError = vi.fn();
    await expect(startMapKit({ fetchToken: async () => null, appendScript, current: () => undefined }, onError))
      .rejects.toBeInstanceOf(MapUnavailableError);
    expect(appendScript).not.toHaveBeenCalled();
  });

  it('loads MapKit JS with the token and only the map, overlay and annotation libraries', async () => {
    const mapkit = fakeMapKit();
    let loaded: MapKitApi | undefined;
    const appendScript = vi.fn(async () => {
      loaded = mapkit;
    });
    const onError = vi.fn();
    const result = await startMapKit({ fetchToken: async () => 'mapkit-token', appendScript, current: () => loaded }, onError);
    expect(result).toBe(mapkit);
    expect(appendScript).toHaveBeenCalledWith(expect.objectContaining({
      src: MAPKIT_SCRIPT,
      'data-token': 'mapkit-token',
      'data-libraries': 'map,overlays,annotations',
    }));
    expect(MAPKIT_SCRIPT.startsWith('https://cdn.apple-mapkit.com/')).toBe(true);
    expect(mapkit.load).toHaveBeenCalledWith(MAPKIT_LIBRARIES);
    // A token Apple refuses is reported later, as MapKit's error event.
    expect(mapkit.addEventListener).toHaveBeenCalledWith('error', onError);
  });

  it('fails when the script loads without MapKit', async () => {
    await expect(startMapKit({
      fetchToken: async () => 'mapkit-token', appendScript: async () => undefined, current: () => undefined,
    }, vi.fn())).rejects.toBeInstanceOf(MapUnavailableError);
  });
});

describe('heart rate recovery after a recorded run', () => {
  it('says how far heart rate fell one and two minutes after the stop', () => {
    expect(recoveryText({ at_stop: 165, after_60s: 137, after_120s: 121 })).toBe('28 bpm in 1 min · 44 in 2 min');
    expect(recoveryText({ at_stop: 165, after_60s: 137, after_120s: null })).toBe('28 bpm in 1 min');
    expect(recoveryText({ at_stop: 150, after_60s: null, after_120s: 130 })).toBe('20 bpm in 2 min');
    expect(recoveryText({ at_stop: 120, after_60s: 124, after_120s: null })).toBe('+4 bpm in 1 min');
  });

  it('says nothing without a reading after the stop', () => {
    expect(recoveryText(null)).toBeNull();
    expect(recoveryText(undefined)).toBeNull();
    expect(recoveryText({ at_stop: 150, after_60s: null, after_120s: null })).toBeNull();
  });
});

describe('a history card map', () => {
  it('is a muted, still picture so a click reaches the card', () => {
    const thumb = routeMapOptions('thumbnail');
    expect(thumb).toMatchObject({
      mapType: 'mutedStandard', isScrollEnabled: false, isZoomEnabled: false,
      showsZoomControl: false, showsScale: 'hidden', showsCompass: 'hidden', showsPointsOfInterest: false,
    });
  });

  it('leaves the day panel map as it was', () => {
    const detail = routeMapOptions('detail');
    expect(detail).toMatchObject({ showsScale: 'adaptive', showsPointsOfInterest: false });
    expect(detail).not.toHaveProperty('mapType');
    expect(detail).not.toHaveProperty('isScrollEnabled');
  });
});

describe('replaying a route', () => {
  const a = { lat: 45.5, lon: -122.6 };
  const b = { lat: 45.51, lon: -122.6 };
  const c = { lat: 45.52, lon: -122.6 };
  const d = { lat: 45.53, lon: -122.6 };

  it('starts at the first point and finishes at the last, across a pause', () => {
    expect(routeEnds([[a, b], [c, d]])).toEqual({ start: a, end: d });
    expect(routeEnds([])).toBeNull();
  });

  it('measures distance along the route, not across a pause', () => {
    const replay = routeReplay([[a, b], [c, d]]);
    const leg = metersBetween(a, b);
    expect(leg).toBeGreaterThan(1100);
    expect(leg).toBeLessThan(1120);
    expect(replay.total).toBeCloseTo(2 * leg, 3);
  });

  it('moves the runner at an even pace by distance', () => {
    const replay = routeReplay([[a, b, c]]);
    const half = replayAt(replay, 0.5);
    expect(half.at!.lat).toBeCloseTo(b.lat, 6);
    const quarter = replayAt(replay, 0.25);
    expect(quarter.at!.lat).toBeCloseTo(45.505, 6);
    expect(quarter.done).toEqual([[a, quarter.at]]);
  });

  it('lights finished segments and stops at the finish', () => {
    const replay = routeReplay([[a, b], [c, d]]);
    const three = replayAt(replay, 0.75);
    expect(three.done[0]).toEqual([a, b]);
    expect(three.done[1]![0]).toEqual(c);
    expect(replayAt(replay, 1)).toEqual({ done: replay.segments, at: d });
    expect(replayAt(replay, 0).at).toEqual(a);
  });

  it('keeps each segment’s ends when it thins a long route', () => {
    const long = Array.from({ length: 1001 }, (_, i) => ({ lat: 45.5 + i * 0.0001, lon: -122.6 }));
    const replay = routeReplay([long], 100);
    expect(replay.segments[0]!.length).toBeLessThanOrEqual(102);
    expect(replay.segments[0]![0]).toEqual(long[0]);
    expect(replay.segments[0]!.at(-1)).toEqual(long[1000]);
  });
});

describe('start and finish on the route without a map', () => {
  it('sit where the outline begins and ends', () => {
    const route = [[{ lat: 45.5, lon: -122.6 }, { lat: 45.51, lon: -122.6 }], [{ lat: 45.51, lon: -122.59 }, { lat: 45.5, lon: -122.59 }]];
    const paths = routeOutline(route, 320, 200);
    const ends = routeOutlineEnds(route, 320, 200)!;
    expect(paths[0]!.startsWith(`M${ends.start[0].toFixed(1)} ${ends.start[1].toFixed(1)}`)).toBe(true);
    expect(paths[1]!.endsWith(`L${ends.end[0].toFixed(1)} ${ends.end[1].toFixed(1)}`)).toBe(true);
    expect(routeOutlineEnds([], 320, 200)).toBeNull();
  });
});
