// Power and cadence Tres Fort keeps for a member's own rides
// (docs/plans/run-detail-charts P7, migration 0074): the encoding, and the
// .fit import and Apple Health push that fill it, so a ride's power chart,
// best efforts and zones work without intervals.icu. Garmin imports are
// covered in garmin.test.ts, account deletion in account_deletion.test.ts.
import { env, applyD1Migrations, SELF } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { buildActivityStreams } from '../src/activityStreams';
import { issueAppJwt } from '../src/auth';
import { parseFit } from '../src/fitFile';
import {
  decodeValues, encodePowerSeries, fitPowerSeries, parseStoredPowerSeries,
} from '../src/powerSeries';
import { activityFit } from './fitWriter';

const BASE = 'https://tres-fort.test';
const START_MS = Date.parse('2026-11-01T15:00:00Z');

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});

describe('power series encoding', () => {
  it('keeps one whole reading a second of each, delta-coded, and decodes it back', () => {
    const encoded = encodePowerSeries(
      [{ t: 0.2, v: 200 }, { t: 0.7, v: 210 }, { t: 3, v: 250.4 }, { t: 2, v: 0 }, { t: 4, v: 9000 }, { t: -1, v: 100 }],
      [{ t: 0, v: 90 }, { t: 1, v: 300 }, { t: 2, v: 85 }],
      START_MS,
    )!;
    expect(encoded).toEqual({
      v: 1, start_ms: START_MS, power: { dt: [0, 2, 1], v: [205, 0, 250] }, cadence: { dt: [0, 2], v: [90, 85] },
    });
    expect(decodeValues(encoded.power)).toEqual([{ t: 0, v: 205 }, { t: 2, v: 0 }, { t: 3, v: 250 }]);
    expect(parseStoredPowerSeries(JSON.stringify(encoded))).toEqual(encoded);
  });

  it('keeps nothing from a meter that read only zeros, and refuses a malformed row', () => {
    expect(encodePowerSeries([{ t: 0, v: 0 }, { t: 1, v: 0 }], [], null)).toBeNull();
    expect(encodePowerSeries([{ t: 0, v: 0 }], [{ t: 0, v: 80 }], null))
      .toEqual({ v: 1, start_ms: null, power: null, cadence: { dt: [0], v: [80] } });
    expect(parseStoredPowerSeries('{"v":1,"power":null,"cadence":null}')).toBeNull();
    expect(parseStoredPowerSeries('{"v":1,"power":{"dt":[0],"v":[9000]}}')).toBeNull();
    expect(parseStoredPowerSeries('not json')).toBeNull();
  });

  it('keeps a .fit ride\'s cadence but not a run\'s', () => {
    const ride = parseFit(activityFit({ start: '2026-10-25T03:00:00Z', seconds: 120, power: 200, cadence: 90 }));
    expect(fitPowerSeries(ride)?.cadence?.v[0]).toBe(90);
    const run = parseFit(activityFit({ start: '2026-10-25T03:00:00Z', seconds: 120, sport: 1, power: 280, cadence: 88 }));
    const series = fitPowerSeries(run)!;
    expect(series.power?.v[0]).toBe(280);
    expect(series.cadence).toBeNull();
  });

  it('charts power alone over its own moving time', () => {
    const power = Array.from({ length: 600 }, (_, t) => ({ t, v: t < 300 ? 150 : 250 }));
    const s = buildActivityStreams([], [], { power, powerClock: 'moving', ftpW: 250 })!;
    expect(s.moving_s).toBe(600);
    expect(s.power).toMatchObject({ max_w: 250, ftp_w: 250 });
    expect(s.power_w![0]).toBe(150);
    expect(s.heart_rate).toBeNull();
  });

  it('counts the last reading\'s second, so a full 20 minutes is a 20-minute effort', () => {
    const power = Array.from({ length: 1200 }, (_, t) => ({ t, v: 200 }));
    const s = buildActivityStreams([], [], { power, powerClock: 'moving' })!;
    expect(s.moving_s).toBe(1200);
    expect(s.power!.best.map((b) => b.s)).toContain(1200);
    expect(s.power!.best.find((b) => b.s === 1200)!.w).toBe(200);
  });
});

async function member(): Promise<{ id: string; jwt: string }> {
  const id = crypto.randomUUID();
  await env.DB.prepare('INSERT INTO users (id,apple_sub,created_at) VALUES (?1,?1,?2)').bind(id, Date.now()).run();
  return { id, jwt: await issueAppJwt(id, 'test-secret') };
}

async function streams(jwt: string, activityId: string) {
  const r = await SELF.fetch(`${BASE}/api/activities/${encodeURIComponent(activityId)}/streams`, {
    headers: { Authorization: `Bearer ${jwt}` },
  });
  return { status: r.status, body: await r.json<any>() };
}

const kept = (activityId: string) => env.DB
  .prepare('SELECT point_count FROM activity_power_series WHERE activity_id = ?1')
  .bind(activityId).first<{ point_count: number }>();

async function setFtp(userId: string, watts: number) {
  await env.DB.prepare(
    `INSERT INTO athlete_thresholds (id,user_id,sport,metric,value,effective_date,source,created_at)
     VALUES (?1,?2,'ride','ftp_w',?3,'2026-01-01','member',1)`,
  ).bind(crypto.randomUUID(), userId, watts).run();
}

describe('rides keep their power without intervals.icu', () => {
  it('keeps a .fit ride\'s power and cadence, charts them with zones, exports them and forgets them', async () => {
    const me = await member();
    await setFtp(me.id, 250);
    const clientId = crypto.randomUUID();
    const form = new FormData();
    form.set('id', clientId);
    form.set('file', new File([activityFit({
      start: '2026-10-25T03:00:00Z', seconds: 1200, hr: 140, cadence: 90, distanceM: 10000,
      powerAt: (t) => (t < 600 ? 150 : 250),
    })], 'ride.fit'));
    const r = await SELF.fetch(`${BASE}/api/activities/fit`, { method: 'POST', headers: { Authorization: `Bearer ${me.jwt}` }, body: form });
    expect(r.status).toBe(201);
    const activityId = (await r.json<any>()).activity.id as string;
    expect(await kept(activityId)).toEqual({ point_count: 1200 });

    const res = await streams(me.jwt, activityId);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ activity_id: activityId, source: 'fit' });
    const s = res.body.streams;
    expect(s.power).toMatchObject({ avg_w: 200, max_w: 250, ftp_w: 250 });
    // All 1,200 seconds are there, so the ride has a 20-minute effort.
    expect(s.power.best.map((b: { s: number }) => b.s)).toEqual([5, 30, 60, 300, 1200]);
    expect(s.power.best.at(-1)).toEqual({ s: 1200, w: 200 });
    const zone = (n: number) => s.power.zones.find((z: { zone: number }) => z.zone === n).seconds;
    expect(zone(2)).toBe(600);
    expect(zone(4)).toBe(600);
    expect(s.cadence).toEqual({ avg_rpm: 90, max_rpm: 90 });
    expect(s.power_w.length).toBe(s.t.length);
    expect(s.heart_rate.some((v: number | null) => v === 140)).toBe(true);

    const exported = await SELF.fetch(`${BASE}/api/me/export`, { headers: { Authorization: `Bearer ${me.jwt}` } });
    const rows = (await exported.json<any>()).training.activity_power_series;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ activity_id: activityId, point_count: 1200 });
    expect(rows[0].series.cadence.v[0]).toBe(90);

    const del = await SELF.fetch(`${BASE}/api/activities/fit/${clientId}`, {
      method: 'DELETE', headers: { Authorization: `Bearer ${me.jwt}` },
    });
    expect(del.status).toBeLessThan(300);
    expect(await kept(activityId)).toBeNull();
  });

  it('adds power to a .fit ride imported before it was kept, without replacing a kept one', async () => {
    const me = await member();
    const bytes = activityFit({ start: '2026-10-26T03:00:00Z', seconds: 300, power: 200 });
    const upload = async (clientId: string) => {
      const form = new FormData();
      form.set('id', clientId);
      form.set('file', new File([bytes], 'ride.fit'));
      const r = await SELF.fetch(`${BASE}/api/activities/fit`, { method: 'POST', headers: { Authorization: `Bearer ${me.jwt}` }, body: form });
      return (await r.json<any>()).activity.id as string;
    };
    const activityId = await upload(crypto.randomUUID());
    await env.DB.prepare('DELETE FROM activity_power_series WHERE activity_id = ?1').bind(activityId).run();
    expect(await upload(crypto.randomUUID())).toBe(activityId);
    expect(await kept(activityId)).toEqual({ point_count: 300 });
  });

  it('keeps an Apple Health ride\'s pushed power, replaces it, keeps it without streams and clears it', async () => {
    const me = await member();
    const healthId = crypto.randomUUID().toUpperCase();
    const push = async (extra: Record<string, unknown>) => {
      const r = await SELF.fetch(`${BASE}/api/activities/healthkit`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${me.jwt}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          id: healthId, date: '2026-11-01', kind: 'ride', name: 'Ride',
          start_date_local_ms: START_MS - 8 * 3_600_000, start_date_utc_ms: START_MS,
          source_timezone: 'America/Los_Angeles', moving_time_sec: 600, distance_m: 6000, ...extra,
        }),
      });
      expect(r.status).toBe(201);
      return (await r.json<any>()).id as string;
    };
    const watts = (w: number) => ({ t: Array.from({ length: 600 }, (_, i) => i), v: Array.from({ length: 600 }, () => w) });
    const activityId = await push({ streams: { power: watts(180) } });
    expect(await kept(activityId)).toEqual({ point_count: 600 });
    const first = await streams(me.jwt, activityId);
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ activity_id: activityId, source: 'healthkit' });
    expect(first.body.streams.power).toMatchObject({ avg_w: 180, zones: null });

    await push({ streams: { power: watts(220) } });
    expect((await streams(me.jwt, activityId)).body.streams.power.avg_w).toBe(220);
    await push({ name: 'Morning ride' });
    expect(await kept(activityId)).toEqual({ point_count: 600 });
    await push({ streams: { heart_rate: { t: [0, 1], v: [120, 121] } } });
    expect(await kept(activityId)).toBeNull();
  });

  it('keeps no power for an Apple Health workout that isn\'t a ride', async () => {
    const me = await member();
    const r = await SELF.fetch(`${BASE}/api/activities/healthkit`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${me.jwt}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        id: crypto.randomUUID().toUpperCase(), date: '2026-11-01', kind: 'run', name: 'Run',
        start_date_local_ms: START_MS - 8 * 3_600_000, start_date_utc_ms: START_MS,
        source_timezone: 'America/Los_Angeles', moving_time_sec: 300, distance_m: 900,
        streams: { power: { t: [0, 1, 2], v: [280, 281, 282] } },
      }),
    });
    expect(r.status).toBe(201);
    expect(await kept((await r.json<any>()).id)).toBeNull();
  });
});
