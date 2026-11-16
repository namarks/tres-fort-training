import { applyD1Migrations, env, SELF } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { getProjectedCalendar } from '../src/db';
import { dayEntries, isLayered, layerProgram, MAX_DAY_EXTRAS, normalizeWorkoutIds, programHeld, splitBlockDay, standingOn } from '../src/programLayers';
import { MAX_SCHEDULE_EXTRAS, normalizeProgram, parsePlanMeta, serializePlanMeta, WEEKDAYS, type ScheduleWeek, type TrainingProgram, type WeeklySchedule } from '../src/types';

// A block beside the repeating week (docs/plans/web-app P2): a block that
// lists its own workouts keeps them, and takes the rest of each day from
// the repeating week whenever the plan's meta is written.

const rest = (): ScheduleWeek => ({ mon: null, tue: null, wed: null, thu: null, fri: null, sat: null, sun: null });
const week = (days: Partial<ScheduleWeek>): ScheduleWeek => ({ ...rest(), ...days });
const schedule = (days: Partial<ScheduleWeek>, extras?: WeeklySchedule['extras']): WeeklySchedule =>
  ({ version: 1, week: week(days), ...(extras ? { extras } : {}) });
const program = (weeks: TrainingProgram['weeks'], workoutIds?: string[]): TrainingProgram =>
  ({ id: 'p', start: '2030-01-07', repeat: false, weeks, ...(workoutIds ? { workout_ids: workoutIds } : {}) });

describe('laying a block over the repeating week', () => {
  const every = schedule({ mon: 'soccer' }, { mon: ['core'], tue: ['core'], fri: ['core'] });

  it('shares its day limit and weekdays with the schedule', () => {
    expect(MAX_DAY_EXTRAS).toBe(MAX_SCHEDULE_EXTRAS);
    expect(Object.keys(programHeld(program([{ week: week(Object.fromEntries(WEEKDAYS.map((d) => [d, 'x']))) }]))))
      .toEqual([...WEEKDAYS]);
  });

  it('leaves a block that lists no workouts exactly as stored', () => {
    const plain = program([{ week: week({ tue: 'kb' }) }]);
    expect(isLayered(plain)).toBe(false);
    expect(layerProgram(plain, every, schedule({ sun: 'long' }))).toBe(plain);
    expect(splitBlockDay(plain, every, 0, 'tue')).toEqual({ own: ['kb'], standing: [] });
  });

  it('puts the block’s workouts first and the repeating week beside them', () => {
    const block = program([{ label: 'Base', week: week({ mon: 'kb', tue: 'kb', fri: 'tempo' }), targets: { slot: { target_sets: 4 } } }],
      ['kb', 'tempo']);
    const layered = layerProgram(block, every, every);
    expect(layered.weeks[0]).toEqual({
      label: 'Base',
      week: week({ mon: 'kb', tue: 'kb', fri: 'tempo' }),
      extras: { mon: ['soccer', 'core'], tue: ['core'], fri: ['core'] },
      targets: { slot: { target_sets: 4 } },
    });
    // A day the block leaves alone is the repeating week's, shape and all.
    const idle = layerProgram(program([{ week: rest() }], []), every, every);
    expect(idle.weeks[0]).toEqual({ week: every.week, extras: every.extras });
    // Writing it again changes nothing.
    expect(layerProgram(layered, every, every)).toEqual(layered);
    expect(splitBlockDay(layered, every, 0, 'mon')).toEqual({ own: ['kb'], standing: ['soccer', 'core'] });
    expect(standingOn(layered, every, 'fri')).toEqual(['core']);
  });

  it('follows a change to the repeating week without touching what the block owns', () => {
    const block = layerProgram(program([{ week: week({ tue: 'kb', fri: 'tempo' }) }, { week: week({ tue: 'kb' }) }],
      ['kb', 'tempo']), every, every);
    // Core every night, soccer moved to Wednesday.
    const next = schedule({ wed: 'soccer' }, Object.fromEntries(WEEKDAYS.map((d) => [d, ['core']])));
    const after = layerProgram(block, every, next);
    expect(after.weeks.map((w) => dayEntries(w, 'mon'))).toEqual([['core'], ['core']]);
    expect(after.weeks.map((w) => dayEntries(w, 'tue'))).toEqual([['kb', 'core'], ['kb', 'core']]);
    expect(after.weeks.map((w) => dayEntries(w, 'wed'))).toEqual([['soccer', 'core'], ['soccer', 'core']]);
    expect(after.weeks.map((w) => dayEntries(w, 'fri'))).toEqual([['tempo', 'core'], ['core']]);
    // Emptied, the repeating week leaves only the block's own.
    const emptied = layerProgram(after, next, schedule({}));
    expect(emptied.weeks[0]).toEqual({ week: week({ tue: 'kb', fri: 'tempo' }) });
    expect(emptied.weeks[1]).toEqual({ week: week({ tue: 'kb' }) });
  });

  it('never drops an entry it cannot place, and keeps the block’s workouts out of the repeating side', () => {
    // A client that doesn't know the list put a long run on Sunday.
    const block = program([{ week: week({ tue: 'kb', sun: 'long' }), extras: { tue: ['core'] } }], ['kb']);
    const after = layerProgram(block, every, schedule({ sun: 'kb', tue: 'kb' }, { tue: ['core', 'stretch'] }));
    // The block decides where its own workout goes; the repeating week's
    // copies of it apply only outside the block.
    expect(dayEntries(after.weeks[0]!, 'sun')).toEqual(['long']);
    expect(dayEntries(after.weeks[0]!, 'tue')).toEqual(['kb', 'core', 'stretch']);
  });

  it('cuts the repeating week’s entries, not the block’s, when a day is full', () => {
    const block = program([{ week: week({ mon: 'a' }), extras: { mon: ['b', 'c'] } }], ['a', 'b', 'c']);
    const busy = schedule({ mon: 'soccer' }, { mon: ['core', 'stretch', 'walk'] });
    expect(dayEntries(layerProgram(block, schedule({}), busy).weeks[0]!, 'mon'))
      .toEqual(['a', 'b', 'c', 'soccer', 'core']);
  });

  it('keeps the list through a stored round trip and layers on serialize', () => {
    expect(normalizeWorkoutIds(['kb', 'kb', '', 3, 'tempo'])).toEqual(['kb', 'tempo']);
    expect(normalizeWorkoutIds('kb')).toBeUndefined();
    const stored = normalizeProgram({ ...program([{ week: week({ tue: 'kb' }) }]), workout_ids: [] })!;
    expect(isLayered(stored)).toBe(true);
    const meta = parsePlanMeta(JSON.stringify({ schedule: every, program: program([{ week: week({ tue: 'kb' }) }], ['kb']) }));
    const saved = parsePlanMeta(serializePlanMeta(meta, schedule({ sat: 'soccer' })));
    expect(saved.program?.workout_ids).toEqual(['kb']);
    expect(saved.program?.weeks[0]).toEqual({ week: week({ tue: 'kb', sat: 'soccer' }) });
  });

  it('keeps a time for what a block week holds on its weekday', () => {
    const meta = parsePlanMeta(JSON.stringify({
      schedule: { ...every, times: { mon: { soccer: '19:00' }, fri: { tempo: '06:30', kb: '07:00' } } },
      program: program([{ week: week({ fri: 'tempo' }) }], ['tempo']),
    }));
    expect(meta.schedule.times).toEqual({ mon: { soccer: '19:00' }, fri: { tempo: '06:30' } });
  });
});

const BASE = 'https://tres-fort.test';

beforeAll(async () => { await applyD1Migrations(env.DB, env.TEST_MIGRATIONS); });

async function setup() {
  const auth = await SELF.fetch(`${BASE}/auth/dev`, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ secret: 'test-dev' }) });
  const { jwt } = await auth.json<{ jwt: string }>();
  const headers = { 'content-type': 'application/json', Authorization: `Bearer ${jwt}` };
  const call = async (method: string, path: string, body?: object) => {
    const response = await SELF.fetch(`${BASE}/api/${path}`, { method, headers, body: body && JSON.stringify(body) });
    return { status: response.status, body: await response.json<any>() };
  };
  const plan = (await call('POST', 'plan', { name: 'Layers' })).body;
  const slots: Record<string, string> = {};
  const workout = async (name: string, lift = true) => {
    const day = (await call('POST', 'workouts', { name })).body;
    if (lift) {
      const slot = await call('POST', `workouts/${day.id}/exercises`, { exercise: 'ex_goblet_squat', target_sets: 3, target_reps: 8 });
      slots[name] = slot.body.id;
    }
    return day.id as string;
  };
  const ids = {
    kb: await workout('Kettlebell A'),
    tempo: await workout('Tempo run'),
    core: await workout('Core'),
    soccer: await workout('Soccer', false),
  };
  const read = async () => {
    const row = (await env.DB.prepare('SELECT version, meta FROM plans WHERE id=?1')
      .bind(plan.id).first<{ version: number; meta: string }>())!;
    return { version: row.version, meta: parsePlanMeta(row.meta) };
  };
  const owner = await env.DB.prepare('SELECT user_id FROM plans WHERE id=?1').bind(plan.id).first<{ user_id: string }>();
  // The member's week before any block: soccer Monday, the two main
  // workouts, and core most nights.
  const routine = await call('PUT', 'plan/schedule', {
    week: { mon: ids.soccer, tue: ids.kb, fri: ids.tempo },
    extras: { mon: [ids.core], tue: [ids.core], fri: [ids.core] },
    times: { mon: { [ids.soccer]: '19:00' }, tue: { [ids.kb]: '06:30' }, fri: { [ids.tempo]: '06:30', [ids.core]: '21:00' } },
    expected_version: (await read()).version,
  });
  expect(routine.status).toBe(200);
  // Starting a block: its workouts leave the repeating week in the same write.
  const start = async () => {
    const before = await read();
    const put = await call('PUT', 'plan/program', {
      program: {
        name: 'Fast 3 mile', start: '2030-01-07', repeat: false, workout_ids: [ids.kb, ids.tempo],
        weeks: [
          { week: { tue: ids.kb, fri: ids.tempo }, targets: { [slots['Kettlebell A']!]: { target_reps: 9 } } },
          { week: { tue: ids.kb, fri: ids.tempo }, targets: { [slots['Kettlebell A']!]: { target_sets: 4, target_reps: 10 } } },
        ],
      },
      schedule: {
        week: { mon: ids.soccer },
        extras: { mon: [ids.core], tue: [ids.core], fri: [ids.core] },
        times: { mon: { [ids.soccer]: '19:00' }, tue: { [ids.kb]: '06:30' }, fri: { [ids.tempo]: '06:30', [ids.core]: '21:00' } },
      },
      expected_version: before.version,
    });
    return { before, put };
  };
  return { call, ids, slots, read, plan, start, userId: owner!.user_id };
}

describe('a block beside the repeating week over REST', () => {
  let f: Awaited<ReturnType<typeof setup>>;
  beforeAll(async () => { f = await setup(); });

  it('starts a block and trims the repeating week in one plan version', async () => {
    const { before, put } = await f.start();
    expect(put.status).toBe(200);
    expect(put.body.version).toBe(before.version + 1);
    expect(put.body.schedule.week).toMatchObject({ mon: f.ids.soccer, tue: null, fri: null });
    const { meta } = await f.read();
    expect(meta.schedule.week).toMatchObject({ mon: f.ids.soccer, tue: null, fri: null });
    expect(meta.program?.workout_ids).toEqual([f.ids.kb, f.ids.tempo]);
    // Every stored week is the whole day, so any client shows both.
    for (const stored of meta.program!.weeks) {
      expect(dayEntries(stored, 'mon')).toEqual([f.ids.soccer, f.ids.core]);
      expect(dayEntries(stored, 'tue')).toEqual([f.ids.kb, f.ids.core]);
      expect(dayEntries(stored, 'fri')).toEqual([f.ids.tempo, f.ids.core]);
    }
    expect(put.body.program).toEqual(meta.program);
    // The block's workouts keep their times though the week no longer holds them.
    expect(meta.schedule.times).toEqual({ mon: { [f.ids.soccer]: '19:00' }, tue: { [f.ids.kb]: '06:30' },
      fri: { [f.ids.tempo]: '06:30', [f.ids.core]: '21:00' } });

    const cal = await getProjectedCalendar(env.DB, f.userId, '2030-01-07', '2030-01-25', '2030-01-01');
    const on = (date: string) => cal.find((cell) => cell.date === date);
    expect(on('2030-01-08')).toMatchObject({ workout_id: f.ids.kb, extras: [f.ids.core] });
    expect(on('2030-01-12')?.workout_id ?? null).toBeNull();
    // After the block only the repeating week is left.
    expect(on('2030-01-22')?.workout_id ?? null).toBeNull();
    expect(on('2030-01-22')?.extras).toEqual([f.ids.core]);
    expect(on('2030-01-19')?.extras ?? []).toEqual([]);
  });

  it('rejects a bad list or week before writing', async () => {
    const { version } = await f.read();
    const program = { start: '2030-01-07', weeks: [{ week: { tue: f.ids.kb } }] };
    const put = (body: object) => f.call('PUT', 'plan/program', { expected_version: version, ...body });
    expect((await put({ program: { ...program, workout_ids: 'kb' } })).body).toMatchObject({ error: 'invalid_fields', fields: ['program.workout_ids'] });
    expect((await put({ program: { ...program, workout_ids: ['Nothing'] } })).body).toEqual({ error: 'unknown_block_workout', ref: 'Nothing' });
    expect((await put({ program, schedule: { week: { mon: 'Nothing' } } })).body)
      .toEqual({ error: 'schedule', schedule: { error: 'unknown_day_ref', ref: 'Nothing' } });
    expect((await put({ program, schedule: { week: { funday: f.ids.kb } } })).body).toMatchObject({ error: 'invalid_fields', fields: ['schedule.week'] });
    expect((await put({ program, schedule: { week: {}, weeks: 1 } })).body).toMatchObject({ error: 'invalid_fields', fields: ['schedule.weeks'] });
    expect((await f.read()).version).toBe(version);
  });

  it('carries a change to the repeating week into every block week', async () => {
    const { put } = await f.start();
    const saved = await f.call('PUT', 'plan/schedule', {
      week: { wed: f.ids.soccer },
      extras: Object.fromEntries(WEEKDAYS.map((d) => [d, [f.ids.core]])),
      expected_version: put.body.version,
    });
    expect(saved.status).toBe(200);
    const { meta, version } = await f.read();
    expect(version).toBe(put.body.version + 1);
    for (const stored of meta.program!.weeks) {
      expect(dayEntries(stored, 'mon')).toEqual([f.ids.core]);
      expect(dayEntries(stored, 'tue')).toEqual([f.ids.kb, f.ids.core]);
      expect(dayEntries(stored, 'wed')).toEqual([f.ids.soccer, f.ids.core]);
      expect(dayEntries(stored, 'fri')).toEqual([f.ids.tempo, f.ids.core]);
    }
    // The week's targets are the block's and stay.
    expect(meta.program!.weeks[1]!.targets).toEqual({ [f.slots['Kettlebell A']!]: { target_sets: 4, target_reps: 10 } });
    // A block workout put in the repeating week shows only outside the block.
    const both = await f.call('PUT', 'plan/schedule', { week: { sat: f.ids.kb }, extras: {}, expected_version: version });
    expect(both.status).toBe(200);
    const after = (await f.read()).meta;
    expect(dayEntries(after.program!.weeks[0]!, 'sat')).toEqual([]);
    expect(dayEntries(after.program!.weeks[0]!, 'tue')).toEqual([f.ids.kb]);
  });

  it('keeps the list when a client that doesn’t know it edits the block', async () => {
    const { put } = await f.start();
    const stored = put.body.program as TrainingProgram;
    // The iPhone app sends back the weeks it read, with Friday's tempo moved
    // to Thursday in week 2 and a note of nothing else.
    const weeks = stored.weeks.map((w, index) => index === 1
      ? { ...w, week: { ...w.week, thu: f.ids.tempo, fri: null }, extras: { ...w.extras, fri: [] } } : w);
    const edit = await f.call('PUT', 'plan/program', {
      program: { name: stored.name, start: stored.start, repeat: false, weeks }, expected_version: put.body.version });
    expect(edit.status).toBe(200);
    expect(edit.body.program.workout_ids).toEqual([f.ids.kb, f.ids.tempo]);
    expect(dayEntries(edit.body.program.weeks[1], 'thu')).toEqual([f.ids.tempo]);
    // Core is the repeating week's on Friday, so it comes back.
    expect(dayEntries(edit.body.program.weeks[1], 'fri')).toEqual([f.ids.core]);

    // Taking a workout out of every week takes it off the list.
    const without = await f.call('PUT', 'plan/program', { program: { start: stored.start,
      weeks: stored.weeks.map(() => ({ week: { tue: f.ids.kb } })) }, expected_version: edit.body.version });
    expect(without.body.program.workout_ids).toEqual([f.ids.kb]);
    // Null makes the block's weeks stand in for the repeating week again.
    const plain = await f.call('PUT', 'plan/program', { program: { start: stored.start, workout_ids: null,
      weeks: [{ week: { tue: f.ids.kb } }] }, expected_version: without.body.version });
    expect(plain.body.program.workout_ids).toBeUndefined();
    expect(plain.body.program.weeks[0].week).toMatchObject({ mon: null, tue: f.ids.kb });
    expect(plain.body.program.weeks[0].extras).toBeUndefined();
  });

  it('keeps a block workout’s time unless a write names it', async () => {
    const { put } = await f.start();
    const week = { mon: f.ids.soccer };
    const extras = { mon: [f.ids.core], tue: [f.ids.core], fri: [f.ids.core] };
    // A client that knows only the repeating week sends its times.
    const old = await f.call('PUT', 'plan/schedule', { week, extras,
      times: { mon: { [f.ids.soccer]: '18:30' } }, expected_version: put.body.version });
    expect(old.status).toBe(200);
    expect(old.body.schedule.times).toEqual({ mon: { [f.ids.soccer]: '18:30' }, tue: { [f.ids.kb]: '06:30' },
      fri: { [f.ids.tempo]: '06:30' } });
    // Naming it changes or clears it.
    const named = await f.call('PUT', 'plan/schedule', { week, extras,
      times: { tue: { [f.ids.kb]: '07:15' }, fri: { [f.ids.tempo]: null } }, expected_version: old.body.version });
    expect(named.status).toBe(200);
    expect(named.body.schedule.times).toEqual({ tue: { [f.ids.kb]: '07:15' } });
    const wrong = await f.call('PUT', 'plan/schedule', { week, extras,
      times: { wed: { [f.ids.kb]: '07:15' } }, expected_version: named.body.version });
    expect(wrong.body).toEqual({ error: 'time_not_on_day', weekday: 'wed', ref: f.ids.kb });
  });

  it('drops a block workout’s time from a day it has left when the week is sent without times', async () => {
    const { put } = await f.start();
    const stored = (await f.read()).meta;
    expect(stored.schedule.times?.tue).toEqual({ [f.ids.kb]: '06:30' });
    // The block moves its workout to Wednesday and sends the week it sits beside, as the web does.
    const moved = await f.call('PUT', 'plan/program', {
      program: { name: 'Fast 3 mile', start: '2030-01-07', repeat: false, workout_ids: [f.ids.kb, f.ids.tempo],
        weeks: [{ week: { wed: f.ids.kb, fri: f.ids.tempo } }, { week: { wed: f.ids.kb, fri: f.ids.tempo } }] },
      schedule: { week: { mon: f.ids.soccer }, extras: { mon: [f.ids.core], tue: [f.ids.core], fri: [f.ids.core] } },
      expected_version: put.body.version,
    });
    expect(moved.status).toBe(200);
    expect(moved.body.schedule.times).toEqual({ mon: { [f.ids.soccer]: '19:00' }, fri: { [f.ids.tempo]: '06:30', [f.ids.core]: '21:00' } });
    // Naming the time on the day it left is still refused.
    const named = await f.call('PUT', 'plan/program', {
      program: { name: 'Fast 3 mile', start: '2030-01-07', repeat: false, workout_ids: [f.ids.kb, f.ids.tempo],
        weeks: [{ week: { thu: f.ids.kb, fri: f.ids.tempo } }] },
      schedule: { week: { mon: f.ids.soccer }, extras: {}, times: { wed: { [f.ids.kb]: '06:30' } } },
      expected_version: moved.body.version,
    });
    expect(named.body).toMatchObject({ error: 'schedule', schedule: { error: 'time_not_on_day', weekday: 'wed' } });
  });

  it('ends the block keeping one week going, targets included', async () => {
    const { put } = await f.start();
    const bad = await f.call('DELETE', `plan/program?expected_version=${put.body.version}&keep_week=7`);
    expect(bad.body).toEqual({ error: 'invalid_keep_week' });
    const kept = await f.call('DELETE', `plan/program?expected_version=${put.body.version}&keep_week=1`);
    expect(kept.status).toBe(200);
    expect(kept.body).toMatchObject({ ok: true, version: put.body.version + 1, program: null });
    const { meta } = await f.read();
    expect(meta.program).toBeUndefined();
    expect(meta.schedule.week).toMatchObject({ mon: f.ids.soccer, tue: f.ids.kb, fri: f.ids.tempo });
    expect(meta.schedule.extras).toEqual({ mon: [f.ids.core], tue: [f.ids.core], fri: [f.ids.core] });
    expect(meta.schedule.times).toEqual({ mon: { [f.ids.soccer]: '19:00' }, tue: { [f.ids.kb]: '06:30' },
      fri: { [f.ids.tempo]: '06:30', [f.ids.core]: '21:00' } });
    const slot = await env.DB.prepare('SELECT target_sets, target_reps FROM template_exercises WHERE id=?1')
      .bind(f.slots['Kettlebell A']).first<{ target_sets: number; target_reps: number }>();
    expect(slot).toEqual({ target_sets: 4, target_reps: 10 });
    const untouched = await env.DB.prepare('SELECT target_sets, target_reps FROM template_exercises WHERE id=?1')
      .bind(f.slots['Tempo run']).first<{ target_sets: number; target_reps: number }>();
    expect(untouched).toEqual({ target_sets: 3, target_reps: 8 });
    // The kept version is a plan version like any other: it can be compared and restored.
    const snapshot = await env.DB.prepare('SELECT COUNT(*) AS n FROM plan_snapshots WHERE plan_id=?1 AND version=?2')
      .bind(f.plan.id, kept.body.version).first<{ n: number }>();
    expect(snapshot?.n).toBe(1);
  });

  it('takes an archived workout off the block’s list', async () => {
    const { put } = await f.start();
    const archived = await f.call('PATCH', `workouts/${f.ids.tempo}`, { archived_at: Date.now(), expected_version: put.body.version });
    expect(archived.status).toBe(200);
    const { meta } = await f.read();
    expect(meta.program?.workout_ids).toEqual([f.ids.kb]);
    expect(dayEntries(meta.program!.weeks[0]!, 'fri')).toEqual([f.ids.core]);
    expect(meta.schedule.times?.fri).toEqual({ [f.ids.core]: '21:00' });
  });

  it('keeps a week while a workout is in progress only when what it asks for stays the same', async () => {
    // Its own plan, so the workouts left in progress here reach no other test.
    const g = await setup();
    const { put } = await g.start();
    const begin = async (date: string) => {
      const session = (await g.call('POST', 'sessions', { date, workout_id: g.ids.kb })).body;
      const started = await g.call('PATCH', `sessions/${session.id}?expected_attempt=${session.attempt}`, { status: 'in_progress' });
      expect(started.status).toBe(200);
      return { id: session.id as string, attempt: (started.body.attempt ?? session.attempt) as number };
    };
    const slot = () => env.DB.prepare('SELECT target_sets, target_reps FROM template_exercises WHERE id=?1')
      .bind(g.slots['Kettlebell A']).first<{ target_sets: number; target_reps: number }>();
    // In progress in week 2, which asks for 4 × 10. Keeping week 1 (3 × 9) would change it.
    const inBlock = await begin('2030-01-15');
    const other = await g.call('DELETE', `plan/program?expected_version=${put.body.version}&keep_week=0`);
    expect(other.body).toEqual({ error: 'active_workout_targets_changed' });
    // In progress before the block, on the workout's own 3 × 8. Keeping week 2 would save 4 × 10 to it.
    const outside = await begin('2029-12-25');
    const changing = await g.call('DELETE', `plan/program?expected_version=${put.body.version}&keep_week=1`);
    expect(changing.body).toEqual({ error: 'active_workout_targets_changed' });
    expect((await g.read()).version).toBe(put.body.version);
    expect(await slot()).toEqual({ target_sets: 3, target_reps: 8 });
    const done = await g.call('PATCH', `sessions/${outside.id}?expected_attempt=${outside.attempt}`, { status: 'completed' });
    expect(done.body).toMatchObject({ status: 'completed' });
    // Only the week-2 workout is in progress now, and keeping week 2 leaves it asking for the same 4 × 10.
    const kept = await g.call('DELETE', `plan/program?expected_version=${put.body.version}&keep_week=1`);
    expect(kept.body).toMatchObject({ ok: true, program: null });
    expect(await slot()).toEqual({ target_sets: 4, target_reps: 10 });
    expect(inBlock.id).toBeTruthy();
  });
});
