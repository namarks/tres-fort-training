import { applyD1Migrations, env, SELF } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { createPlan, discardSession, getOrCreateSession, getOwnedSessionByDate,
  getPlanTree, getSessionsByDate, getSetsForSession, getState, logSet, patchSession,
  setPlannedSession, setPlanSchedule, skipPlannedSession, startFreestyleSession,
  todayForUser, updatePlanTree } from '../src/db';
import { projectCalendar } from '../src/calendarProjection';

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
  await env.DB.prepare('UPDATE workout_write_fence SET enabled=1,activated_at=1 WHERE id=1').run();
});

async function fixture() {
  const user = crypto.randomUUID();
  await env.DB.prepare('INSERT INTO users(id,apple_sub,created_at) VALUES(?,?,1)').bind(user,user).run();
  await createPlan(env.DB,user,'Two workouts');
  await updatePlanTree(env.DB,user,{workouts:[
    {name:'Morning',exercises:[{exercise:'bench',target_sets:2,target_reps:5}]},
    {name:'Evening',exercises:[{exercise:'squat',target_sets:3,target_reps:5}]},
  ]});
  const plan = (await getPlanTree(env.DB,user))!;
  const date = '2037-06-01';
  const primary = await getOrCreateSession(env.DB,user,plan.id,date,plan.workouts[0]!.id);
  const add = (id = crypto.randomUUID(), workout = plan.workouts[1]!.id) =>
    getOrCreateSession(env.DB,user,plan.id,date,workout,{additionalID:id,expectedAttempt:0,claimAttemptProtocol:true});
  return {user,plan,date,primary,add};
}

describe('independent workout sessions on a civil date', () => {
  it('allocates concurrent requests once and retries the UUID without another slot', async () => {
    const f = await fixture(); const id = crypto.randomUUID();
    const [a,b,c] = await Promise.all([f.add(id),f.add(id),f.add()]);
    expect(a).toEqual(b);
    expect(new Set([a.slot,c.slot])).toEqual(new Set([1,2]));
    expect(await getOwnedSessionByDate(env.DB,f.user,f.date)).toMatchObject({id:f.primary.id,slot:0});
    expect(await f.add(id)).toEqual(a);
    expect(await getSessionsByDate(env.DB,f.user,f.date)).toHaveLength(3);
  });

  it('rejects an id reused for another workout or member without exposing their row', async () => {
    const f = await fixture(); const g = await fixture(); const a = await f.add();
    await expect(f.add(a.id,f.plan.workouts[0]!.id)).rejects.toThrow('session_id_conflict');
    await expect(g.add(a.id)).rejects.toThrow('session_id_conflict');
    expect(await getSessionsByDate(env.DB,g.user,g.date)).toHaveLength(1);
  });

  it('never reuses discarded slots and preserves sibling sets and sync rows', async () => {
    const f = await fixture(); const a = await f.add(); const b = await f.add();
    const slot = f.plan.workouts[1]!.exercises[0]!;
    const log = (session_id:string) => logSet(env.DB,f.user,{id:crypto.randomUUID(),session_id,
      exercise_id:slot.exercise_id,template_exercise_id:slot.id,set_index:1,weight:100,reps:5,
      source:'ios',expected_attempt:0});
    await log(a.id); const surviving = await log(b.id);
    await discardSession(env.DB,f.user,a.id,0);
    const next = await f.add(); expect(next.slot).toBe(3);
    expect(await getSetsForSession(env.DB,b.id)).toEqual([surviving.set]);
    expect(await getOwnedSessionByDate(env.DB,f.user,f.date,1)).toMatchObject({id:a.id,status:'discarded'});
    const state = await getState(env.DB,f.user,0,0);
    expect(state.sessions.map(s => s.id)).toEqual(expect.arrayContaining([f.primary.id,a.id,b.id,next.id]));
  });

  it('finishes and skips exact slots while leaving the primary unchanged', async () => {
    const f = await fixture(); const a = await f.add(); const b = await f.add();
    await patchSession(env.DB,f.user,a.id,{status:'completed'},0);
    expect(await skipPlannedSession(env.DB,f.user,f.date,0,b.slot)).toMatchObject({ok:true,session:{id:b.id,status:'skipped'}});
    expect(await getOwnedSessionByDate(env.DB,f.user,f.date)).toMatchObject({id:f.primary.id,status:'planned',attempt:0});
    expect(await getOwnedSessionByDate(env.DB,f.user,f.date,a.slot)).toMatchObject({id:a.id,status:'completed'});
    expect(await setPlannedSession(env.DB,f.user,f.date,f.plan.workouts[0]!.id,0,8)).toHaveProperty('error');
  });

  it('creates freestyle independently and retains the original creation receipt after saving changes', async () => {
    const f = await fixture(); const id = crypto.randomUUID();
    const a = await startFreestyleSession(env.DB,f.user,f.date,0,'ios',{additionalID:id});
    expect(a).toMatchObject({session:{id,slot:1,kind:'freestyle',status:'in_progress'}});
    expect(await startFreestyleSession(env.DB,f.user,f.date,0,'ios',{additionalID:id})).toEqual(a);
    const planned = await f.add();
    expect(await setPlannedSession(env.DB,f.user,f.date,f.plan.workouts[0]!.id,0,planned.slot))
      .toMatchObject({ok:true,session:{slot:2,attempt:1}});
    expect(await f.add(planned.id)).toMatchObject({id:planned.id,slot:2,attempt:1});
  });

  it('allows full workouts in recurring extras', async () => {
    const f = await fixture();
    const result = await setPlanSchedule(env.DB,f.user,{mon:f.plan.workouts[0]!.id},undefined,undefined,undefined,
      {mon:[f.plan.workouts[1]!.id]});
    expect(result).toMatchObject({ok:true,schedule:{extras:{mon:[f.plan.workouts[1]!.id]}}});
  });

  it('keeps primary projection independent from additional statuses and blackout filtering', async () => {
    const f = await fixture(); const a = await f.add();
    const schedule = {version:1 as const,week:{mon:null,tue:null,wed:null,thu:null,fri:null,sat:null,sun:null}};
    const cells = (status:string, today=f.date, trip=false) => projectCalendar({id:f.plan.id},schedule,
      [{...f.primary,status:'discarded'},{...a,status}],f.date,f.date,today,[],
      trip ? [{id:'trip',start:f.date,end:f.date,type:'rest',can_train_light:false}] : []);
    expect(cells('completed')[0]).toMatchObject({status:'rest',sessions:[{id:a.id,status:'completed'}]});
    expect(cells('planned','2037-06-02')).toEqual([]);
    expect(cells('completed','2037-06-02')[0]).toMatchObject({status:'rest',sessions:[{id:a.id}]});
    expect(cells('planned',f.date,true)[0]).not.toHaveProperty('sessions');
    expect(cells('in_progress',f.date,true)[0]).toMatchObject({status:'unavailable',sessions:[{id:a.id}]});
  });
});

it('validates the explicit REST allocation contract before mutation', async () => {
  const auth = await SELF.fetch('https://test/auth/dev',{method:'POST',headers:{'content-type':'application/json'},
    body:JSON.stringify({secret:'test-dev'})});
  const {jwt} = await auth.json<{jwt:string}>();
  for (const body of [{additional:true},{additional:true,id:crypto.randomUUID(),slot:1},
    {id:crypto.randomUUID()},{slot:-1},{slot:1.5}]) {
    const response = await SELF.fetch('https://test/api/sessions',{method:'POST',
      headers:{Authorization:`Bearer ${jwt}`,'content-type':'application/json'},body:JSON.stringify(body)});
    expect(response.status).toBe(400);
  }
});

async function connectedFixture() {
  const auth = await SELF.fetch('https://test/auth/dev', { method: 'POST',
    headers: { 'content-type': 'application/json' }, body: JSON.stringify({ secret: 'test-dev' }) });
  const { jwt, user } = await auth.json<{ jwt: string; user: { id: string } }>();
  await createPlan(env.DB, user.id, 'Two workouts');
  await updatePlanTree(env.DB, user.id, { workouts: [
    { name: 'Morning', exercises: [{ exercise: 'bench', target_sets: 3, target_reps: 5 }] },
    { name: 'Evening', exercises: [{ exercise: 'bench', target_sets: 3, target_reps: 5 }] },
  ] });
  const plan = (await getPlanTree(env.DB, user.id))!;
  const date = await todayForUser(env.DB, user.id);
  const rest = async (path: string, method: string, body?: object) => {
    const response = await SELF.fetch(`https://test/api/${path}`, { method,
      headers: { Authorization: `Bearer ${jwt}`, 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, body: await response.json<any>() };
  };
  const tool = async (name: string, args: object = {}) => {
    const response = await SELF.fetch('https://test/mcp', { method: 'POST',
      headers: { Authorization: 'Bearer test-mcp-token', 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }) });
    expect(response.status).toBe(200);
    return JSON.parse((await response.json<any>()).result.content[0].text);
  };
  return { user: user.id, plan, date, rest, tool };
}

it('replays the REST creation receipt after an exact-slot calendar edit without touching the primary', async () => {
  const f = await connectedFixture();
  const primary = await f.rest('sessions', 'POST', { date: f.date, workout_id: f.plan.workouts[0]!.id, expected_attempt: 0 });
  expect(primary.status).toBe(201);
  const request = { id: crypto.randomUUID(), date: f.date, workout_id: f.plan.workouts[1]!.id,
    additional: true, expected_attempt: 0 };
  const added = await f.rest('sessions', 'POST', request);
  expect(added).toMatchObject({ status: 201, body: { id: request.id, slot: 1, attempt: 0 } });
  const changed = await f.rest(`calendar/${f.date}/1`, 'PUT', {
    workout_id: f.plan.workouts[0]!.id, expected_attempt: 0 });
  expect(changed).toMatchObject({ status: 200, body: { session: { id: request.id, slot: 1, attempt: 1 } } });
  expect(await f.rest('sessions', 'POST', request)).toMatchObject({ status: 201, body: changed.body.session });
  expect(await f.rest('sessions', 'POST', { ...request, workout_id: f.plan.workouts[0]!.id }))
    .toMatchObject({ status: 409, body: { error: 'session_id_conflict' } });
  expect(await getOwnedSessionByDate(env.DB, f.user, f.date)).toMatchObject(primary.body);
  expect(await getSessionsByDate(env.DB, f.user, f.date)).toHaveLength(2);
});

it('exposes both workouts to the coach and resolves explicit, sole-active and ambiguous log targets', async () => {
  const f = await connectedFixture();
  const primary = (await f.rest('sessions', 'POST', {
    date: f.date, workout_id: f.plan.workouts[0]!.id, expected_attempt: 0 })).body;
  const request = { date: f.date, day: f.plan.workouts[1]!.id, additional: true, id: crypto.randomUUID() };
  const added = await f.tool('set_planned_session', request);
  expect(added).toMatchObject({ ok: true, session: { id: request.id, slot: 1 } });
  expect(await f.tool('set_planned_session', request)).toEqual(added);
  expect(await f.tool('log_set', { slot: 1, exercise: 'bench', weight: 101, reps: 5 }))
    .toMatchObject({ set: { session_id: request.id, set_index: 1 } });
  expect(await f.tool('log_set', { exercise: 'bench', weight: 102, reps: 5 }))
    .toMatchObject({ set: { session_id: request.id, set_index: 2 } });
  expect(await f.tool('get_current_session')).toMatchObject({ session: { id: request.id } });
  expect(await f.rest(`sessions/${primary.id}/sets`, 'POST', { id: crypto.randomUUID(),
    exercise_id: 'ex_bench', set_index: 1, weight: 111, reps: 7, expected_attempt: primary.attempt }))
    .toMatchObject({ status: 201 });
  // The sibling's matching iOS set must not block an intentional evening set.
  expect(await f.tool('log_set', { slot: 1, exercise: 'bench', weight: 111, reps: 7 }))
    .toMatchObject({ set: { session_id: request.id } });
  expect(await f.tool('log_set', { slot: 0, exercise: 'bench', weight: 111, reps: 7 }))
    .toMatchObject({ error: 'recent_duplicate', existing_set: { session_id: primary.id } });
  expect(await f.tool('log_set', { exercise: 'bench', weight: 112, reps: 7 }))
    .toMatchObject({ set: { session_id: primary.id } });
  const active = await f.tool('get_current_session');
  expect(active.session).toBeNull();
  expect(active.sessions.map((s: any) => s.session.id)).toEqual([primary.id, request.id]);
  expect((await f.tool('get_current_session', { slot: 1 })).session.id).toBe(request.id);
  expect((await f.tool('get_today_workout')).sessions.map((s: any) => s.session.id)).toEqual([primary.id, request.id]);
  expect((await f.tool('get_session_log', { date: f.date })).map((s: any) => s.session.id)).toEqual([primary.id, request.id]);
  expect(await f.tool('log_workout_complete', { slot: 1 })).toMatchObject({ id: request.id, status: 'completed' });
  expect(await getOwnedSessionByDate(env.DB, f.user, f.date)).toMatchObject({ id: primary.id, status: 'in_progress' });
});
