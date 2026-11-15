import { env, applyD1Migrations, SELF } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';

// The goal event from the app or the web (docs/plans/coach-free-planning P1):
// the member sets, changes and clears plans.meta.race through the same
// versioned plan-meta writer the coach's set_race uses.

const BASE = 'https://tres-fort.test';

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});

async function devJwt(): Promise<string> {
  const r = await SELF.fetch(`${BASE}/auth/dev`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ secret: 'test-dev' }),
  });
  expect(r.status).toBe(200);
  return (await r.json<{ jwt: string }>()).jwt;
}

const auth = (jwt: string) => ({
  'content-type': 'application/json',
  Authorization: `Bearer ${jwt}`,
});

async function freshPlan(H: Record<string, string>): Promise<{ id: string; version: number }> {
  const created = await SELF.fetch(`${BASE}/api/plan`, {
    method: 'POST', headers: H, body: JSON.stringify({ name: 'Event Plan' }),
  });
  expect(created.status).toBeLessThan(300);
  return (await SELF.fetch(`${BASE}/api/plan/active`, { headers: H }))
    .json<{ id: string; version: number }>();
}

async function storedMeta(planId: string): Promise<Record<string, unknown>> {
  const row = await env.DB.prepare('SELECT meta FROM plans WHERE id=?1')
    .bind(planId).first<{ meta: string | null }>();
  return JSON.parse(row?.meta ?? '{}') as Record<string, unknown>;
}

const put = (H: Record<string, string>, body: Record<string, unknown>) => SELF.fetch(`${BASE}/api/plan/race`, {
  method: 'PUT', headers: H, body: JSON.stringify(body),
});

const RACE = {
  name: 'Turkey Trot', date: '2026-11-26', discipline: 'running', distance: '5k',
  distance_m: 5000, goal_time_s: 1080,
};

describe('goal event over REST', () => {
  it('sets, changes and clears the event with version checks and an ios audit row', async () => {
    const H = auth(await devJwt());
    const plan = await freshPlan(H);

    const set = await put(H, { race: RACE, expected_version: plan.version });
    expect(set.status).toBe(200);
    const setBody = await set.json<{ ok: true; version: number; race: unknown }>();
    expect(setBody.version).toBe(plan.version + 1);
    expect(setBody.race).toEqual(RACE);
    expect((await storedMeta(plan.id)).race).toEqual(RACE);

    // /api/state carries it parsed, with the goal fields.
    const state = await (await SELF.fetch(`${BASE}/api/state`, { headers: H }))
      .json<{ plan: { race: unknown } }>();
    expect(state.plan.race).toEqual(RACE);

    const stale = await put(H, { race: { ...RACE, goal_time_s: 1050 }, expected_version: plan.version });
    expect(stale.status).toBe(409);
    expect(await stale.json()).toEqual({ conflict: true, current_version: setBody.version });

    // A replace is whole: fields left out are gone.
    const changed = await put(H, {
      race: { name: '  Spring 10k ', date: '2027-04-11', discipline: 'running', distance_m: 10000, priority: 'A' },
      expected_version: setBody.version,
    });
    expect(changed.status).toBe(200);
    const changedBody = await changed.json<{ version: number; race: unknown }>();
    expect(changedBody.version).toBe(setBody.version + 1);
    expect(changedBody.race).toEqual({
      name: 'Spring 10k', date: '2027-04-11', discipline: 'running', distance_m: 10000, priority: 'A',
    });

    const cleared = await SELF.fetch(`${BASE}/api/plan/race?expected_version=${changedBody.version}`, {
      method: 'DELETE', headers: H,
    });
    expect(cleared.status).toBe(200);
    const clearBody = await cleared.json<{ version: number; race: null }>();
    expect(clearBody).toEqual({ ok: true, version: changedBody.version + 1, race: null });
    expect((await storedMeta(plan.id)).race).toBeUndefined();

    // Clearing again writes nothing.
    const again = await SELF.fetch(`${BASE}/api/plan/race?expected_version=${clearBody.version}`, {
      method: 'DELETE', headers: H,
    });
    expect(await again.json()).toEqual({ ok: true, version: clearBody.version, race: null });

    const audits = await env.DB.prepare(
      `SELECT tool FROM audit_log WHERE actor='ios' AND tool IN ('set_race','clear_race')
        AND created_at >= (SELECT created_at FROM plans WHERE id=?1)`,
    ).bind(plan.id).all<{ tool: string }>();
    expect(audits.results.map((row) => row.tool).sort()).toEqual(['clear_race', 'set_race', 'set_race']);
  });

  it('keeps the rest of plan meta when the event changes', async () => {
    const H = auth(await devJwt());
    const plan = await freshPlan(H);
    const trip = await SELF.fetch(`${BASE}/api/plan/trips`, {
      method: 'POST', headers: H,
      body: JSON.stringify({ start: '2026-12-20', end: '2026-12-27', expected_version: plan.version }),
    });
    const tripBody = await trip.json<{ version: number }>();
    const set = await put(H, { race: RACE, expected_version: tripBody.version });
    const setBody = await set.json<{ version: number }>();
    await SELF.fetch(`${BASE}/api/plan/race?expected_version=${setBody.version}`, { method: 'DELETE', headers: H });
    const meta = await storedMeta(plan.id);
    expect((meta.trips as unknown[]).length).toBe(1);
    expect(meta.schedule).toBeTruthy();
  });

  it('rejects bad input without a write', async () => {
    const H = auth(await devJwt());
    const plan = await freshPlan(H);

    const missingVersion = await put(H, { race: RACE });
    expect(missingVersion.status).toBe(400);
    expect(await missingVersion.json()).toEqual({ error: 'invalid_fields', fields: ['expected_version'] });

    const bad = await put(H, {
      race: {
        name: '   ', date: '2026-02-30', distance_m: -5, goal_time_s: 12.5, priority: 'Z', surprise: true,
      },
      extra: 1,
      expected_version: plan.version,
    });
    expect(bad.status).toBe(400);
    const badBody = await bad.json<{ fields: string[] }>();
    expect(badBody.fields.sort()).toEqual([
      'extra', 'race.date', 'race.discipline', 'race.distance_m', 'race.goal_time_s',
      'race.name', 'race.priority', 'race.surprise',
    ]);

    const notObject = await put(H, { race: [RACE], expected_version: plan.version });
    expect(await notObject.json()).toEqual({ error: 'invalid_fields', fields: ['race'] });

    const noVersion = await SELF.fetch(`${BASE}/api/plan/race`, { method: 'DELETE', headers: H });
    expect(noVersion.status).toBe(400);

    const after = await (await SELF.fetch(`${BASE}/api/plan/active`, { headers: H })).json<{ version: number }>();
    expect(after.version).toBe(plan.version);
    expect((await storedMeta(plan.id)).race).toBeUndefined();
  });
});
