import { env, applyD1Migrations, SELF } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { getProjectedCalendar } from '../src/db';
import { parsePlanMeta } from '../src/types';

// Schedule extras: a weekday can hold activities (workouts with no exercises,
// such as morning stretching) besides its main workout. They live in
// plans.meta.schedule.extras and ride the same versioned set_schedule write.

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

const WEEK = { mon: 'Full Body', tue: null, wed: null, thu: 'Full Body', fri: null, sat: null, sun: null };

describe('schedule extras', () => {
  let jwt: string;
  let ids: Record<string, string>;

  beforeAll(async () => {
    jwt = await devJwt();
    const built = await call('update_plan', {
      name: 'Extras',
      workouts: [
        { day_label: 'A', name: 'Full Body', exercises: [{ exercise: 'squat', target_sets: 3, target_reps: 5 }] },
        { day_label: 'S', name: 'Morning stretching', exercises: [] },
        { day_label: 'C', name: 'Core before bed', exercises: [] },
        { day_label: 'Y', name: 'Yoga', exercises: [] },
        { day_label: 'W', name: 'Walk', exercises: [] },
        { day_label: 'M', name: 'Mobility', exercises: [] },
      ],
    });
    expect(built.conflict).toBe(false);
    ids = Object.fromEntries(built.plan.workouts.map((w: any) => [w.name, w.id]));
  });

  it('set_schedule stores extras by name and the coach reads them back by name', async () => {
    const r = await call('set_schedule', {
      week: WEEK,
      extras: { mon: ['Morning stretching', 'Core before bed'], wed: ['Core before bed'] },
    });
    expect(r.ok).toBe(true);
    expect(r.schedule.extras).toEqual({
      mon: [ids['Morning stretching'], ids['Core before bed']],
      wed: [ids['Core before bed']],
    });
    const plan = await call('get_current_plan', {});
    expect(plan.schedule_extras).toEqual({ mon: ['Morning stretching', 'Core before bed'], wed: ['Core before bed'] });
  });

  it('a plan without extras leaves the coach payload unchanged', async () => {
    await call('set_schedule', { week: WEEK });
    const plan = await call('get_current_plan', {});
    expect(plan).not.toHaveProperty('schedule_extras');
  });

  it('a week-only write keeps saved extras; an empty map clears them', async () => {
    await call('set_schedule', { week: WEEK, extras: { mon: ['Morning stretching'] } });
    const kept = await putSchedule(jwt, { week: { ...WEEK, mon: ids['Full Body'], thu: ids['Full Body'] } });
    expect(kept.status).toBe(200);
    expect(kept.body.schedule.extras).toEqual({ mon: [ids['Morning stretching']] });
    const cleared = await putSchedule(jwt, { week: { ...WEEK, mon: ids['Full Body'] }, extras: {} });
    expect(cleared.status).toBe(200);
    expect(cleared.body.schedule).not.toHaveProperty('extras');
    expect((await storedSchedule()).extras).toBeUndefined();
  });

  it('rejects too many extras and a bad shape, with no write', async () => {
    const before = (await call('get_current_plan', {})).version;
    expect(await call('set_schedule', {
      week: WEEK,
      extras: { tue: ['Morning stretching', 'Core before bed', 'Yoga', 'Walk', 'Mobility'] },
    })).toMatchObject({ error: 'too_many_extras', weekday: 'tue', max: 4 });
    expect(await call('set_schedule', { week: WEEK, extras: { tue: 'Yoga' } }))
      .toMatchObject({ error: 'invalid_extras' });
    const rest = await putSchedule(jwt, { week: WEEK, extras: { someday: ['Yoga'] } });
    expect(rest.status).toBe(400);
    expect(rest.body.fields).toContain('extras');
    expect((await call('get_current_plan', {})).version).toBe(before);
  });

  it("drops an extra that is already the day's main workout", async () => {
    const r = await call('set_schedule', {
      week: { ...WEEK, tue: 'Yoga' },
      extras: { tue: ['Yoga', 'Morning stretching', 'Morning stretching'] },
    });
    expect(r.ok).toBe(true);
    expect(r.schedule.extras).toEqual({ tue: [ids['Morning stretching']] });
  });

  it('deleting an extra clears it from every weekday', async () => {
    await call('set_schedule', { week: WEEK, extras: { mon: ['Yoga', 'Walk'], fri: ['Yoga'] } });
    const version = (await call('get_current_plan', {})).version;
    const deleted = await call('delete_workout', { workout_id: ids.Yoga, expected_version: version });
    expect(deleted.error).toBeUndefined();
    expect((await storedSchedule()).extras).toEqual({ mon: [ids.Walk] });
  });

  it('an update_plan rebuild carries extras over to the rebuilt workouts', async () => {
    await call('set_schedule', { week: WEEK, extras: { sat: ['Morning stretching'] } });
    const rebuilt = await call('update_plan', {
      name: 'Extras',
      workouts: [
        { day_label: 'A', name: 'Full Body', exercises: [{ exercise: 'squat', target_sets: 3, target_reps: 5 }] },
        { day_label: 'S', name: 'Morning stretching', exercises: [] },
      ],
    });
    expect(rebuilt.conflict).toBe(false);
    const stretch = rebuilt.plan.workouts.find((w: any) => w.name === 'Morning stretching').id;
    expect((await storedSchedule()).extras).toEqual({ sat: [stretch] });
  });

  it('the calendar projects extras on today and later dates', async () => {
    await call('set_schedule', {
      week: { mon: null, tue: null, wed: null, thu: null, fri: null, sat: null, sun: null },
      extras: { mon: ['Morning stretching'], tue: ['Morning stretching'], wed: ['Morning stretching'],
        thu: ['Morning stretching'], fri: ['Morning stretching'], sat: ['Morning stretching'], sun: ['Morning stretching'] },
    });
    const user = await env.DB.prepare(`SELECT user_id FROM plans WHERE status='active' LIMIT 1`).first<{ user_id: string }>();
    const cells = await getProjectedCalendar(env.DB, user!.user_id, '2099-01-05', '2099-01-06', '2099-01-05');
    expect(cells.map((cell) => cell.extras)).toEqual([[ids['Morning stretching']], [ids['Morning stretching']]]);
    expect(cells.map((cell) => cell.status)).toEqual(['rest', 'rest']);
  });

  it('an extra that gains exercises remains in coaching, projection and subsequent writes', async () => {
    await call('set_schedule', { week: WEEK, extras: { mon: ['Walk', 'Mobility'], tue: ['Walk'] } });
    const added = await call('add_exercise', { day: 'Walk', exercise: 'squat', target_sets: 3, target_reps: 5 });
    expect(added.error).toBeUndefined();
    expect((await call('get_current_plan', {})).schedule_extras).toEqual({ mon: ['Walk', 'Mobility'], tue: ['Walk'] });
    const user = await env.DB.prepare(`SELECT user_id FROM plans WHERE status='active' LIMIT 1`).first<{ user_id: string }>();
    const cells = await getProjectedCalendar(env.DB, user!.user_id, '2099-01-05', '2099-01-06', '2099-01-05');
    expect(cells.map((cell) => cell.extras)).toEqual([[ids.Walk, ids.Mobility], [ids.Walk]]);
    const kept = await call('set_schedule', { week: WEEK });
    expect(kept.schedule.extras).toEqual({ mon: [ids.Walk, ids.Mobility], tue: [ids.Walk] });
  });

  it('a rebuild preserves extras that gain exercises', async () => {
    await call('set_schedule', { week: WEEK, extras: { sat: ['Morning stretching', 'Core before bed'] } });
    const rebuilt = await call('update_plan', {
      name: 'Extras',
      workouts: [
        { day_label: 'A', name: 'Full Body', exercises: [{ exercise: 'squat', target_sets: 3, target_reps: 5 }] },
        { day_label: 'S', name: 'Morning stretching', exercises: [{ exercise: 'squat', target_sets: 1, target_reps: 5 }] },
        { day_label: 'C', name: 'Core before bed', exercises: [] },
      ],
    });
    expect(rebuilt.conflict).toBe(false);
    const core = rebuilt.plan.workouts.find((w: any) => w.name === 'Core before bed').id;
    const stretching = rebuilt.plan.workouts.find((w: any) => w.name === 'Morning stretching').id;
    expect((await storedSchedule()).extras).toEqual({ sat: [stretching, core] });
  });

  it('compare_plan_versions lists an extras change under the weekday', async () => {
    const from = (await call('set_schedule', { week: WEEK, extras: {} })).version;
    await call('set_schedule', { week: WEEK, extras: { mon: ['Walk'] } });
    const diff = await call('compare_plan_versions', { from_version: from });
    const change = diff.changes.find((c: any) => c.path === 'Weekly schedule · mon · also');
    expect(change).toBeDefined();
    expect(change.before).toEqual([]);
    expect(change.after).toEqual([expect.objectContaining({ day_name: 'Walk' })]);
    expect(diff.summary.schedule_days).toBe(1);
  });
});
