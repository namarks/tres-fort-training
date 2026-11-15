// A swim's detail from Apple Health (docs/plans/sport-activities P4): the app
// sends `swim` with the workout, the Worker keeps it in activity_swims and
// GET /api/activities/:id/swim serves it with a summary to its member only.
// Apple Watch's effort score (P5) scores a swim with no measured load, and an
// open-water swim keeps its route.
import { env, applyD1Migrations, SELF } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { issueAppJwt } from '../src/auth';
import { encodeRoute, type RoutePoint } from '../src/activityRoute';
import { parseSwimDetail, summarizeSwim, type SwimDetail } from '../src/swimDetail';

const BASE = 'https://tres-fort.test';
const START_MS = Date.parse('2026-11-08T15:00:00Z');

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});

async function member(): Promise<{ id: string; jwt: string }> {
  const id = crypto.randomUUID();
  await env.DB.prepare('INSERT INTO users (id,apple_sub,created_at) VALUES (?1,?1,?2)').bind(id, Date.now()).run();
  return { id, jwt: await issueAppJwt(id, 'test-secret') };
}

const headers = (jwt: string) => ({ Authorization: `Bearer ${jwt}`, 'content-type': 'application/json' });

/** Four lengths of a 25 yd pool in two sets, as Apple Watch saves them. */
function poolSwim(): Record<string, unknown> {
  const yd = 22.86;
  return {
    location: 'pool',
    pool_length_m: yd,
    pool_unit: 'yd',
    strokes: 64,
    lengths: [
      { start_s: 60, duration_s: 20, distance_m: yd, strokes: 15, stroke: 'freestyle' },
      { start_s: 0, duration_s: 21, distance_m: yd, strokes: 16, stroke: 'freestyle' },
      { start_s: 120, duration_s: 30, distance_m: yd, strokes: 18, stroke: 'breaststroke' },
      { start_s: 25, duration_s: 22.04, distance_m: yd, strokes: 15, stroke: 'freestyle' },
    ],
    sets: [
      { start_s: 0, duration_s: 47, distance_m: yd * 2, lengths: 2, stroke: 'freestyle' },
      { start_s: 60, duration_s: 90, distance_m: yd * 2, lengths: 2, stroke: 'mixed' },
    ],
  };
}

async function push(jwt: string, over: Record<string, unknown> = {}, id = crypto.randomUUID().toUpperCase()) {
  const r = await SELF.fetch(`${BASE}/api/activities/healthkit`, {
    method: 'POST',
    headers: headers(jwt),
    body: JSON.stringify({
      id, date: '2026-11-08', kind: 'swim', name: 'Swim',
      start_date_local_ms: START_MS - 8 * 3_600_000, start_date_utc_ms: START_MS,
      source_timezone: 'America/Los_Angeles', moving_time_sec: 1800, elapsed_time_sec: 2100, distance_m: 1371.6,
      raw: JSON.stringify({ hk_activity_type: 46, source: 'Apple Watch' }),
      ...over,
    }),
  });
  return { status: r.status, body: await r.json<any>(), healthId: id };
}

async function getSwim(jwt: string, activityId: string) {
  const r = await SELF.fetch(`${BASE}/api/activities/${encodeURIComponent(activityId)}/swim`, { headers: headers(jwt) });
  return { status: r.status, body: await r.json<any>() };
}

describe('swim detail format', () => {
  it('keeps lengths and sets in time order, rounded to a tenth', () => {
    const detail = parseSwimDetail(poolSwim()) as SwimDetail;
    expect(detail.lengths.map((l) => l.start_s)).toEqual([0, 25, 60, 120]);
    expect(detail.lengths[1]).toEqual({ start_s: 25, duration_s: 22, distance_m: 22.9, strokes: 15, stroke: 'freestyle' });
    expect(detail.pool_length_m).toBe(22.86);
    expect(detail.pool_unit).toBe('yd');
  });

  it('rejects what is not a swim detail, and treats an empty one as none', () => {
    expect(parseSwimDetail({ ...poolSwim(), location: 'lake' })).toBeUndefined();
    expect(parseSwimDetail({ ...poolSwim(), pool_length_m: 5 })).toBeUndefined();
    expect(parseSwimDetail({ ...poolSwim(), lengths: [{ start_s: 0, duration_s: 20, stroke: 'doggy' }] })).toBeUndefined();
    expect(parseSwimDetail({ ...poolSwim(), lengths: [{ start_s: 0, duration_s: 20, strokes: 1.5, stroke: 'freestyle' }] })).toBeUndefined();
    expect(parseSwimDetail([])).toBeUndefined();
    expect(parseSwimDetail({})).toBeNull();
    // A unit means nothing without a pool length.
    expect(parseSwimDetail({ location: 'open_water', pool_unit: 'yd' })).toMatchObject({ pool_length_m: null, pool_unit: null });
  });

  it('sums strokes, SWOLF and lengths by stroke from the lengths, never estimating', () => {
    const summary = summarizeSwim(parseSwimDetail(poolSwim()) as SwimDetail);
    expect(summary).toEqual({
      length_count: 4,
      strokes: 64,
      strokes_per_length: 16,
      // (21+16 + 22+15 + 20+15 + 30+18) / 4
      swolf: 39.3,
      stroke_breakdown: [
        { stroke: 'freestyle', lengths: 3, distance_m: 68.7 },
        { stroke: 'breaststroke', lengths: 1, distance_m: 22.9 },
      ],
    });
    // Lengths without stroke counts give no strokes per length and no SWOLF.
    const uncounted = summarizeSwim(parseSwimDetail({
      location: 'pool', strokes: null,
      lengths: [{ start_s: 0, duration_s: 20, distance_m: 25, strokes: null, stroke: 'unknown' }],
    }) as SwimDetail);
    expect(uncounted).toMatchObject({ length_count: 1, strokes: null, strokes_per_length: null, swolf: null });
  });
});

describe('Apple Health swims', () => {
  it('keeps a swim\'s detail and serves it with a summary to its member only', async () => {
    const me = await member();
    const other = await member();
    const pushed = await push(me.jwt, { swim: poolSwim() });
    expect(pushed.status).toBe(201);
    const id = pushed.body.id as string;

    const served = await getSwim(me.jwt, id);
    expect(served.status).toBe(200);
    expect(served.body.activity_id).toBe(id);
    expect(served.body.swim).toMatchObject({ location: 'pool', pool_unit: 'yd', strokes: 64 });
    expect(served.body.swim.lengths).toHaveLength(4);
    expect(served.body.summary).toMatchObject({ length_count: 4, strokes_per_length: 16, swolf: 39.3 });
    expect((await getSwim(other.jwt, id)).status).toBe(404);

    const row = await env.DB.prepare('SELECT location,pool_length_m,pool_unit,length_count FROM activity_swims WHERE activity_id=?1')
      .bind(id).first();
    expect(row).toEqual({ location: 'pool', pool_length_m: 22.86, pool_unit: 'yd', length_count: 4 });
  });

  it('keeps the detail when a push leaves it out, and clears it with null', async () => {
    const me = await member();
    const first = await push(me.jwt, { swim: poolSwim() });
    const id = first.body.id as string;
    await push(me.jwt, { moving_time_sec: 1805 }, first.healthId);
    expect((await getSwim(me.jwt, id)).status).toBe(200);
    await push(me.jwt, { swim: null }, first.healthId);
    expect((await getSwim(me.jwt, id)).status).toBe(404);
  });

  it('refuses a detail that is not valid, or on a workout that is not a swim', async () => {
    const me = await member();
    expect((await push(me.jwt, { swim: { ...poolSwim(), pool_unit: 'ft' } })).body).toEqual({ error: 'invalid_swim' });
    expect((await push(me.jwt, { kind: 'run', swim: poolSwim() })).body).toEqual({ error: 'invalid_swim' });
  });

  it('includes swim detail in the account export', async () => {
    const me = await member();
    const pushed = await push(me.jwt, { swim: poolSwim() });
    const exported = await SELF.fetch(`${BASE}/api/me/export`, { headers: headers(me.jwt) });
    expect(exported.status).toBe(200);
    const swims = (await exported.json<any>()).training.activity_swims;
    expect(swims[0]).toMatchObject({ activity_id: pushed.body.id, location: 'pool', length_count: 4 });
    expect(swims[0].detail.lengths).toHaveLength(4);
  });
});

describe('Apple Watch effort score', () => {
  it('scores a swim with no measured load, and the member\'s own rating wins', async () => {
    const me = await member();
    const pushed = await push(me.jwt, { provider_effort: 7 });
    expect(pushed.status).toBe(201);
    // 30 moving minutes at 7: half of the 100 an hour at 7 scores.
    expect(pushed.body).toMatchObject({ provider_effort: 7, effort: null, effective_load: 50, load_method: 'effort' });

    const rated = await SELF.fetch(`${BASE}/api/activities/${encodeURIComponent(pushed.body.id)}/effort`, {
      method: 'PUT', headers: headers(me.jwt), body: JSON.stringify({ effort: 4 }),
    });
    expect((await rated.json<any>()).activity).toMatchObject({ effort: 4, provider_effort: 7, effective_load: 29 });

    // A later push without the score keeps it; null clears it.
    const kept = await push(me.jwt, {}, pushed.healthId);
    expect(kept.body).toMatchObject({ provider_effort: 7 });
    const cleared = await push(me.jwt, { provider_effort: null }, pushed.healthId);
    expect(cleared.body).toMatchObject({ provider_effort: null, effort: 4, effective_load: 29 });
  });

  it('scores a score that keeps a tenth', async () => {
    const me = await member();
    const pushed = await push(me.jwt, { provider_effort: 7.3 });
    // 30 moving minutes at 7.3: 0.5 × 7.3/7 × 100.
    expect(pushed.body).toMatchObject({ provider_effort: 7.3, effective_load: 52, load_method: 'effort' });
  });

  it('refuses a score outside 1 to 10', async () => {
    const me = await member();
    expect((await push(me.jwt, { provider_effort: 11 })).body).toEqual({ error: 'invalid_provider_effort' });
    expect((await push(me.jwt, { provider_effort: 'hard' })).body).toEqual({ error: 'invalid_provider_effort' });
  });
});

describe('open-water swim routes', () => {
  it('keeps the route Apple Health saved with a swim', async () => {
    const me = await member();
    const pushed = await push(me.jwt, { swim: { location: 'open_water' } });
    const point = (i: number): RoutePoint => ({ t: START_MS + i * 10_000, lat: 45.5 + i * 0.0001, lon: -122.7, alt: 0 });
    const r = await SELF.fetch(`${BASE}/api/activities/healthkit/${pushed.healthId}/route`, {
      method: 'PUT', headers: headers(me.jwt),
      body: JSON.stringify({ route: encodeRoute([[point(0), point(1), point(2)]]) }),
    });
    expect(r.status).toBe(200);
    const served = await SELF.fetch(`${BASE}/api/activities/${encodeURIComponent(pushed.body.id)}/route`, { headers: headers(me.jwt) });
    expect(served.status).toBe(200);
    expect(await served.json<any>()).toMatchObject({ activity_id: pushed.body.id, source: 'healthkit' });
  });
});
