import { env, applyD1Migrations, SELF } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { parsePlanMeta } from '../src/types';

// Schedule times: anything a weekday holds (its workout or an extra) can have
// an optional "HH:MM" time the app reminds the member at. They live in
// plans.meta.schedule.times and ride the same versioned set_schedule write.

const BASE = 'https://tres-fort.test';
const TOKEN = 'test-mcp-token';

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});

let rpcId = 0;
async function call(name: string, args: unknown) {
  const r = await SELF.fetch(`${BASE}/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', Authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method: 'tools/call', params: { name, arguments: args } }),
  });
  const body = await r.json<any>();
  const text = body.result.content[0].text as string;
  try {
    return JSON.parse(text);
  } catch {
    return { error: text };
  }
}

async function devJwt(): Promise<string> {
  const r = await SELF.fetch(`${BASE}/auth/dev`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ secret: 'test-dev' }),
  });
  expect(r.status).toBe(200);
  return (await r.json<{ jwt: string }>()).jwt;
}

async function putSchedule(jwt: string, body: unknown) {
  const r = await SELF.fetch(`${BASE}/api/plan/schedule`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json', Authorization: `Bearer ${jwt}` },
    body: JSON.stringify(body),
  });
  return { status: r.status, body: await r.json<any>() };
}

async function storedSchedule() {
  const row = await env.DB.prepare(`SELECT meta FROM plans WHERE status='active' LIMIT 1`).first<{ meta: string | null }>();
  return parsePlanMeta(row?.meta ?? null).schedule;
}

const WEEK = { mon: 'Easy run', tue: null, wed: null, thu: 'Easy run', fri: null, sat: null, sun: null };

describe('schedule times', () => {
  let jwt: string;
  let ids: Record<string, string>;
  const id = (name: string): string => ids[name]!;

  beforeAll(async () => {
    jwt = await devJwt();
    const built = await call('update_plan', {
      name: 'Times',
      workouts: [
        { day_label: 'R', name: 'Easy run', exercises: [{ exercise: 'squat', target_sets: 1, target_reps: 5 }] },
        { day_label: 'C', name: 'Core before bed', exercises: [] },
        { day_label: 'S', name: 'Morning stretching', exercises: [] },
      ],
    });
    expect(built.conflict).toBe(false);
    ids = Object.fromEntries(built.plan.workouts.map((w: any) => [w.name, w.id]));
  });

  it('set_schedule stores times by name and the coach reads them back by name', async () => {
    const r = await call('set_schedule', {
      week: WEEK,
      extras: { mon: ['Core before bed'] },
      times: { mon: { 'Easy run': '07:00', 'Core before bed': '21:00' } },
    });
    expect(r.ok).toBe(true);
    expect(r.schedule.times).toEqual({ mon: { [id('Easy run')]: '07:00', [id('Core before bed')]: '21:00' } });
    const plan = await call('get_current_plan', {});
    expect(plan.schedule_times).toEqual({ mon: { 'Easy run': '07:00', 'Core before bed': '21:00' } });
  });

  it('a write without times keeps those still on their day; an empty map clears them', async () => {
    await call('set_schedule', {
      week: WEEK,
      extras: { mon: ['Core before bed'] },
      times: { mon: { 'Core before bed': '21:00' }, thu: { 'Easy run': '06:30' } },
    });
    // An older app writes only the week and extras: Thursday's run moves off.
    const kept = await putSchedule(jwt, {
      week: { ...WEEK, mon: ids['Easy run'], thu: null },
      extras: { mon: [id('Core before bed')] },
    });
    expect(kept.status).toBe(200);
    expect(kept.body.schedule.times).toEqual({ mon: { [id('Core before bed')]: '21:00' } });
    const cleared = await putSchedule(jwt, { week: { ...WEEK, mon: ids['Easy run'] }, times: {} });
    expect(cleared.status).toBe(200);
    expect(cleared.body.schedule).not.toHaveProperty('times');
    expect((await storedSchedule()).times).toBeUndefined();
    expect(await call('get_current_plan', {})).not.toHaveProperty('schedule_times');
  });

  it('rejects a time for something not on that day and a bad time, with no write', async () => {
    const before = (await call('get_current_plan', {})).version;
    expect(await call('set_schedule', { week: WEEK, times: { tue: { 'Easy run': '07:00' } } }))
      .toMatchObject({ error: 'time_not_on_day', weekday: 'tue', ref: 'Easy run' });
    expect(await call('set_schedule', { week: WEEK, times: { mon: { 'Easy run': '7am' } } }))
      .toMatchObject({ error: 'invalid_times' });
    const rest = await putSchedule(jwt, { week: WEEK, times: { mon: { [id('Easy run')]: '24:00' } } });
    expect(rest.status).toBe(400);
    expect(rest.body.fields).toContain('times');
    expect((await call('get_current_plan', {})).version).toBe(before);
  });

  it('deleting a workout drops its times', async () => {
    await call('set_schedule', {
      week: WEEK,
      extras: { mon: ['Morning stretching'] },
      times: { mon: { 'Morning stretching': '06:00', 'Easy run': '07:00' } },
    });
    const version = (await call('get_current_plan', {})).version;
    const deleted = await call('delete_workout', { workout_id: ids['Morning stretching'], expected_version: version });
    expect(deleted.error).toBeUndefined();
    expect((await storedSchedule()).times).toEqual({ mon: { [id('Easy run')]: '07:00' } });
  });

  it('an update_plan rebuild carries times over to the rebuilt workouts', async () => {
    await call('set_schedule', {
      week: WEEK,
      extras: { thu: ['Core before bed'] },
      times: { thu: { 'Core before bed': '21:15' } },
    });
    const rebuilt = await call('update_plan', {
      name: 'Times',
      workouts: [
        { day_label: 'R', name: 'Easy run', exercises: [{ exercise: 'squat', target_sets: 1, target_reps: 5 }] },
        { day_label: 'C', name: 'Core before bed', exercises: [] },
      ],
    });
    expect(rebuilt.conflict).toBe(false);
    const core = rebuilt.plan.workouts.find((w: any) => w.name === 'Core before bed').id;
    expect((await storedSchedule()).times).toEqual({ thu: { [core]: '21:15' } });
  });

  it('compare_plan_versions lists a time change under the weekday', async () => {
    const from = (await call('set_schedule', { week: WEEK, times: { mon: { 'Easy run': '07:00' } } })).version;
    await call('set_schedule', { week: WEEK, times: { mon: { 'Easy run': '21:00' } } });
    const diff = await call('compare_plan_versions', { from_version: from });
    const change = diff.changes.find((c: any) => c.path === 'Weekly schedule · mon · times');
    expect(change).toEqual(expect.objectContaining({ before: { 'Easy run': '07:00' }, after: { 'Easy run': '21:00' } }));
    expect(diff.summary.schedule_days).toBe(1);
  });
});
