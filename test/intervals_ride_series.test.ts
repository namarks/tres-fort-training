// A ride synced from intervals.icu keeps its heart rate, power, cadence,
// distance and elevation (docs/plans/run-detail-charts P8), so a Zwift
// ride's charts, best efforts and zones survive intervals.icu losing the
// ride or being unreachable. No real network: an injected fetcher for the
// sync, fetchMock for the chart read.
import { env, applyD1Migrations, fetchMock, SELF } from 'cloudflare:test';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { buildActivityStreams, samplesFromProvider, trackFromPowerSeries } from '../src/activityStreams';
import { issueAppJwt } from '../src/auth';
import { INTERVALS_RIDE_SERIES_PER_SYNC, syncExternalActivities } from '../src/db';
import { decodeHeartRate } from '../src/heartRateSeries';
import { rideSeriesFromIntervals } from '../src/intervalsRideSeries';
import { decodeValues, parseStoredPowerSeries } from '../src/powerSeries';
import type { Env } from '../src/types';

const BASE = 'https://tres-fort.test';
const START_MS = Date.parse('2026-11-19T02:00:00Z');
const TODAY = '2026-11-19';

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});

afterEach(() => {
  fetchMock.deactivate();
  fetchMock.enableNetConnect();
});

const range = (n: number, from = 0) => Array.from({ length: n }, (_, i) => from + i);

describe('rideSeriesFromIntervals', () => {
  it('takes a pause out of the clock and keeps distance and elevation in decimeters', () => {
    // Ten seconds, a 90-second stop, ten more seconds.
    const time = [...range(10), ...range(10, 100)];
    const { heartRate, power } = rideSeriesFromIntervals({
      time,
      distance: time.map((_, i) => i * 8),
      altitude: time.map((_, i) => -3 + i * 0.5),
      heartrate: time.map(() => 130),
      watts: time.map(() => 200),
      cadence: time.map(() => 85),
      lat: null,
      lon: null,
    }, START_MS);
    // The stop adds no time: the second stretch starts where the first ended,
    // as the charts count it when they read intervals.icu live.
    expect(decodeHeartRate(heartRate!).map((r) => r.t)).toEqual(range(19));
    expect(heartRate!.start_ms).toBe(START_MS);
    expect(decodeValues(power!.power).map((r) => r.v)).toEqual(range(19).map(() => 200));
    expect(decodeValues(power!.cadence!)[0]).toEqual({ t: 0, v: 85 });
    const distance = decodeValues(power!.distance!);
    expect(distance[0]).toEqual({ t: 0, v: 0 });
    // 19 readings 8 m apart, less the 8 m counted across the stop.
    expect(distance.at(-1)).toEqual({ t: 18, v: 1440 });
    expect(decodeValues(power!.altitude!)[0]).toEqual({ t: 0, v: -30 });
    expect(parseStoredPowerSeries(JSON.stringify(power))).toEqual(power);
  });

  it('keeps a trainer ride with no speed as power alone, and nothing from no streams', () => {
    const time = range(60);
    const { power } = rideSeriesFromIntervals({
      time, distance: time.map(() => 0), altitude: null, heartrate: null,
      watts: time.map(() => 180), cadence: null, lat: null, lon: null,
    }, null);
    expect(power).toMatchObject({ start_ms: null, cadence: null });
    expect(power!.distance).toBeUndefined();
    expect(rideSeriesFromIntervals({
      time, distance: null, altitude: null, heartrate: null, watts: null, cadence: null, lat: null, lon: null,
    }, null)).toEqual({ heartRate: null, power: null });
  });

  it('charts a kept series the way the same streams chart read live', () => {
    const time = range(600);
    const streams = {
      time,
      distance: time.map((t) => t * 10),
      altitude: time.map((t) => 100 + t * 0.1),
      heartrate: time.map(() => 140),
      watts: time.map((t) => (t < 300 ? 150 : 250)),
      cadence: time.map(() => 90),
      lat: null,
      lon: null,
    };
    const { heartRate, power } = rideSeriesFromIntervals(streams, START_MS);
    const track = trackFromPowerSeries(power!);
    expect(track[0]).toEqual({ t: 0, d: 0, alt: 100 });
    const s = buildActivityStreams(track, decodeHeartRate(heartRate!), {
      heartRateClock: 'moving', power: decodeValues(power!.power), powerClock: 'moving',
      cadence: decodeValues(power!.cadence),
    })!;
    const fresh = samplesFromProvider(streams);
    const live = buildActivityStreams(fresh.track, fresh.heartRate, { power: fresh.power, cadence: fresh.cadence })!;
    expect(s).toEqual(live);
    expect(s.moving_s).toBe(599);
    expect(s.total_distance_m).toBe(5990);
    expect(s.speed_mps!.some((v) => v !== null && Math.abs(v - 10) < 0.5)).toBe(true);
    expect(s.elevation_gain_m).toBeGreaterThan(50);
    expect(s.power).toMatchObject({ avg_w: 200, max_w: 250 });
    expect(s.heart_rate!.every((v) => v === null || v === 140)).toBe(true);
  });

  it('starts the kept clock at the first reading, as the live chart does', () => {
    // intervals.icu's first sample two minutes in.
    const time = range(600, 120);
    const streams = {
      time,
      distance: time.map((t) => (t - 120) * 10),
      altitude: null,
      heartrate: time.map(() => 135),
      watts: time.map((t) => (t < 420 ? 100 : 300)),
      cadence: null,
      lat: null,
      lon: null,
    };
    const { heartRate, power } = rideSeriesFromIntervals(streams, null);
    expect(decodeHeartRate(heartRate!)[0]!.t).toBe(0);
    const kept = buildActivityStreams(trackFromPowerSeries(power!), decodeHeartRate(heartRate!), {
      heartRateClock: 'moving', power: decodeValues(power!.power), powerClock: 'moving',
    })!;
    const fresh = samplesFromProvider(streams);
    const live = buildActivityStreams(fresh.track, fresh.heartRate, { power: fresh.power })!;
    expect(live.power).toMatchObject({ avg_w: 200 });
    expect(kept).toEqual(live);
  });

  it('drops the ground a pause counted, as the live chart does', () => {
    // 100 seconds, a stop over which the distance stream still advanced,
    // 100 more seconds.
    const time = [...range(100), ...range(100, 200)];
    const streams = {
      time,
      distance: time.map((t) => t * 8),
      altitude: null,
      heartrate: time.map(() => 130),
      watts: time.map(() => 200),
      cadence: null,
      lat: null,
      lon: null,
    };
    const { heartRate, power } = rideSeriesFromIntervals(streams, null);
    const kept = buildActivityStreams(trackFromPowerSeries(power!), decodeHeartRate(heartRate!), {
      heartRateClock: 'moving', power: decodeValues(power!.power), powerClock: 'moving',
    })!;
    const fresh = samplesFromProvider(streams);
    const live = buildActivityStreams(fresh.track, fresh.heartRate, { power: fresh.power })!;
    expect(live.total_distance_m).toBe(1584);
    expect(kept.total_distance_m).toBe(live.total_distance_m);
    expect(kept.moving_s).toBe(live.moving_s);
    expect(decodeValues(power!.distance!).at(-1)).toEqual({ t: 198, v: 15840 });
  });
});

/** A member with an intervals.icu connection of their own. */
async function rider(): Promise<{ id: string; jwt: string }> {
  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO users (id,apple_sub,email,display_name,created_at,intervals_api_key,intervals_athlete_id)
     VALUES (?1,?2,NULL,'Rider',?3,?4,?5)`,
  ).bind(id, `sub-${id}`, Date.now(), `key-${id}`, `athlete-${id}`).run();
  return { id, jwt: await issueAppJwt(id, 'test-secret') };
}

const STREAM_TYPES = ['time', 'watts', 'cadence', 'heartrate', 'distance', 'altitude', 'latlng'];

/** An activity as intervals.icu lists it. */
function listed(id: string, date: string, extra: Record<string, unknown> = {}) {
  return {
    id, type: 'VirtualRide', name: `Zwift - ${id}`, start_date_local: `${date}T18:00:00`,
    start_date: `${date}T18:00:00Z`, moving_time: 600, distance: 5990, icu_average_watts: 200,
    stream_types: STREAM_TYPES, ...extra,
  };
}

/** A ten-minute Zwift ride's streams. */
const ZWIFT_STREAMS = [
  { type: 'time', data: range(600) },
  { type: 'watts', data: range(600).map((t) => (t < 300 ? 150 : 250)) },
  { type: 'cadence', data: range(600).map(() => 90) },
  { type: 'heartrate', data: range(600).map(() => 140) },
  { type: 'distance', data: range(600).map((t) => t * 10) },
  { type: 'altitude', data: range(600).map((t) => 100 + t * 0.1) },
  { type: 'latlng', data: range(600).map(() => -11.6), data2: range(600).map(() => 166.9) },
];

type Reply = { status: number; body: unknown };

/** The sync's fetcher: the activity list, and each activity's streams by id. */
function provider(activities: unknown[], streams: Record<string, Reply | Reply[]>) {
  const calls: string[] = [];
  const fetcher = async (url: string) => {
    const match = /\/activity\/([^/]+)\/streams/.exec(url);
    let reply: Reply = { status: 200, body: activities };
    if (match) {
      calls.push(decodeURIComponent(match[1]!));
      const r = streams[decodeURIComponent(match[1]!)] ?? { status: 404, body: { error: 'Not found' } };
      reply = Array.isArray(r) ? r.shift()! : r;
    }
    return { ok: reply.status < 300, status: reply.status, json: async () => reply.body };
  };
  return { calls, fetcher };
}

const keptRows = async (activityId: string) => ({
  heart: (await env.DB.prepare('SELECT point_count FROM activity_heart_rates WHERE activity_id = ?1')
    .bind(activityId).first<{ point_count: number }>())?.point_count ?? null,
  power: (await env.DB.prepare('SELECT point_count FROM activity_power_series WHERE activity_id = ?1')
    .bind(activityId).first<{ point_count: number }>())?.point_count ?? null,
});

describe('an intervals.icu ride keeps its streams when it syncs', () => {
  it('keeps them once, charts them when intervals.icu is down, and forgets them when the ride leaves', async () => {
    const me = await rider();
    const activities: unknown[] = [
      listed('zwift', '2026-11-18'),
      // Only rides are kept, and only when intervals.icu has streams.
      listed('run', '2026-11-18', { type: 'Run', name: 'Run' }),
      listed('manual', '2026-11-17', { stream_types: [] }),
    ];
    const first = provider(activities, { zwift: { status: 200, body: ZWIFT_STREAMS } });
    const sync = (fetcher: typeof first.fetcher) =>
      syncExternalActivities(env.DB, env as unknown as Env, { userId: me.id, today: TODAY, fetcher });
    expect((await sync(first.fetcher)).status).toBe('ok');
    expect(first.calls).toEqual(['zwift']);
    const rideId = `intervals:activity:${me.id}:zwift`;
    expect(await keptRows(rideId)).toEqual({ heart: 600, power: 600 });
    expect(await keptRows(`intervals:activity:${me.id}:run`)).toEqual({ heart: null, power: null });

    // A later sync asks intervals.icu for nothing more.
    const again = provider(activities, {});
    await sync(again.fetcher);
    expect(again.calls).toEqual([]);

    // intervals.icu down: the chart comes from what was kept.
    fetchMock.activate();
    fetchMock.disableNetConnect();
    fetchMock.get('https://intervals.icu').intercept({ method: 'GET', path: () => true }).reply(503, {}).persist();
    const r = await SELF.fetch(`${BASE}/api/activities/${encodeURIComponent(rideId)}/streams`, {
      headers: { Authorization: `Bearer ${me.jwt}` },
    });
    expect(r.status).toBe(200);
    const body = await r.json<any>();
    expect(body).toMatchObject({ activity_id: rideId, source: 'intervals' });
    expect(body.streams).toMatchObject({ moving_s: 599, total_distance_m: 5990, lat: null });
    expect(body.streams.power).toMatchObject({ avg_w: 200, max_w: 250 });
    expect(body.streams.cadence).toEqual({ avg_rpm: 90, max_rpm: 90 });
    expect(body.streams.elevation_gain_m).toBeGreaterThan(50);
    expect(body.streams.heart_rate.some((v: number | null) => v === 140)).toBe(true);
    fetchMock.deactivate();

    // Deleted on intervals.icu: the next sync tombstones it and forgets them.
    await sync(provider(activities.slice(1), {}).fetcher);
    expect(await keptRows(rideId)).toEqual({ heart: null, power: null });
  });

  it('keeps a ride whose streams intervals.icu lists only on a later sync', async () => {
    const me = await rider();
    const sync = (activities: unknown[], streams: Record<string, Reply>) => {
      const p = provider(activities, streams);
      return syncExternalActivities(env.DB, env as unknown as Env, { userId: me.id, today: TODAY, fetcher: p.fetcher })
        .then(() => p.calls);
    };
    expect(await sync([listed('late', '2026-11-18', { stream_types: [] })], {})).toEqual([]);
    // Nothing else about the ride changed.
    expect(await sync([listed('late', '2026-11-18')], { late: { status: 200, body: ZWIFT_STREAMS } })).toEqual(['late']);
    expect(await keptRows(`intervals:activity:${me.id}:late`)).toEqual({ heart: 600, power: 600 });
  });

  it(`keeps at most ${INTERVALS_RIDE_SERIES_PER_SYNC} a sync, the newest first, and a ride that never yields can't hold the rest back`, async () => {
    const me = await rider();
    const activities = ['2026-11-12', '2026-11-13', '2026-11-14', '2026-11-15', '2026-11-16', '2026-11-17', '2026-11-18']
      .map((date, i) => listed(`r${i + 1}`, date));
    const ok: Reply = { status: 200, body: ZWIFT_STREAMS };
    const sync = (streams: Record<string, Reply | Reply[]>) => {
      const p = provider(activities, streams);
      return syncExternalActivities(env.DB, env as unknown as Env, { userId: me.id, today: TODAY, fetcher: p.fetcher })
        .then((result) => ({ result, calls: p.calls }));
    };
    const keptIds = async () => {
      const out: string[] = [];
      for (let i = 1; i <= 7; i++) {
        if ((await keptRows(`intervals:activity:${me.id}:r${i}`)).power !== null) out.push(`r${i}`);
      }
      return out;
    };

    // Rate limited on the newest: nothing more is asked, and the sync stands.
    const busy = await sync({ r7: { status: 429, body: {} } });
    expect(busy.result.status).toBe('ok');
    expect(busy.calls).toEqual(['r7']);
    expect(await keptIds()).toEqual([]);

    // r7 (newest) and r6 are refused every time and r5 never has a usable
    // reading; each sync still asks for three, the newest first, and the
    // others are reached in turn.
    const all = { r1: ok, r2: ok, r3: ok, r4: ok, r6: { status: 404, body: {} }, r7: { status: 403, body: {} } };
    const empty: Reply = { status: 200, body: [{ type: 'time', data: [0, 1] }, { type: 'heartrate', data: [0, 0] }] };
    for (let i = 0; i < 4; i++) {
      const run = await sync({ ...all, r5: empty });
      expect(run.calls.length).toBe(INTERVALS_RIDE_SERIES_PER_SYNC);
      expect(run.calls[0]).toBe('r7');
    }
    expect(await keptIds()).toEqual(['r1', 'r2', 'r3', 'r4']);
  });
});
