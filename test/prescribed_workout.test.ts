import { applyD1Migrations, env, SELF } from 'cloudflare:test';
import { beforeAll, expect, it } from 'vitest';
import { issueAppJwt } from '../src/auth';
import { createPartnerWorkout, createPrescribedWorkout, getPlanTree, patchWorkoutAtVersion } from '../src/db';
import type { PartnerWorkoutInput } from '../src/partnerTraining';

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
  await env.DB.prepare('UPDATE workout_write_fence SET enabled=1,activated_at=1 WHERE id=1').run();
});

async function member() {
  const id = crypto.randomUUID();
  await env.DB.prepare('INSERT INTO users (id,apple_sub,created_at) VALUES (?,?,1)').bind(id, id).run();
  return id;
}

function core(): PartnerWorkoutInput {
  const group = crypto.randomUUID();
  return {
    workout_id: crypto.randomUUID(), name: 'Evening core', expected_plan_id: null, expected_version: 0,
    slots: ['ex_plank', 'ex_side_plank', 'ex_hollow'].map((exercise_id, order_index) => ({
      id: crypto.randomUUID(), exercise_id, order_index, target_sets: 2, target_reps: 40,
      target_reps_max: null, target_rpe: null, rest_seconds: 20, target_weight: null,
      target_weight_unit: 'lb', target_duration_s: 40, progression: null, cues: null, is_warmup: 0,
      group_id: group, group_rest_seconds: 60, group_transition_seconds: 20,
    })),
  };
}

async function client(userId: string, actor: 'ios' | 'web' = 'ios') {
  const jwt = await issueAppJwt(userId, env.APP_JWT_SECRET, { client: actor });
  return (body: unknown) => SELF.fetch('https://test/api/workouts/prescribed', {
    method: 'POST', headers: { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

it.each(['ios', 'web'] as const)('saves reviewed timed circuits with one version, snapshot and %s audit', async actor => {
  const user = await member(), input = core(), post = await client(user, actor);
  const reply = await post(input);
  expect(reply.status).toBe(201);
  const receipt = await reply.json<{ workout_id: string; plan_id: string; version: number }>();
  expect(receipt).toMatchObject({ workout_id: input.workout_id, version: 1 });
  const tree = (await getPlanTree(env.DB, user))!;
  expect(tree.id).toBe(receipt.plan_id);
  expect(tree.version).toBe(1);
  expect(tree.workouts).toHaveLength(1);
  expect(tree.workouts[0]!.exercises).toMatchObject(input.slots);
  const audits = await env.DB.prepare('SELECT id,actor,tool FROM audit_log WHERE user_id=?').bind(user).all();
  expect(audits.results).toEqual([{ id: input.workout_id, actor, tool: 'create_workout_prescription' }]);
  const snapshots = await env.DB.prepare('SELECT version,actor,operation,document FROM plan_snapshots WHERE plan_id=?')
    .bind(tree.id).all();
  expect(snapshots.results).toHaveLength(1);
  expect(snapshots.results[0]).toMatchObject({ version: 1, actor, operation: 'create_workout_prescription' });
  expect(String(snapshots.results[0]!.document)).toContain(input.slots[0]!.id);
  expect(String(snapshots.results[0]!.document)).toContain(input.slots[0]!.group_id);
  expect((await env.DB.prepare('SELECT id FROM sessions WHERE user_id=?').bind(user).all()).results).toHaveLength(0);
});

it.each(['ios', 'web'] as const)('saves six individually reviewed lifting targets atomically for %s', async actor => {
  const user = await member(), post = await client(user, actor);
  const slot = core().slots[0]!;
  const targets = [
    { exercise_id: 'ex_bench', target_sets: 2, target_reps: 10, target_weight: 20, target_weight_unit: 'kg', rest_seconds: 45, is_warmup: 1 },
    { exercise_id: 'ex_bench', target_sets: 4, target_reps: 5, target_weight: 135, target_weight_unit: 'lb', rest_seconds: 150, target_rpe: 8 },
    { exercise_id: 'ex_back_squat', target_sets: 3, target_reps: 6, target_weight: 60, target_weight_unit: 'kg', rest_seconds: 135 },
    { exercise_id: 'ex_db_press', target_sets: 3, target_reps: 8, target_reps_max: 12, target_weight: null, rest_seconds: 75 },
    { exercise_id: 'ex_pullup', target_sets: 2, target_reps: 6, target_weight: -10, rest_seconds: 90 },
    { exercise_id: 'ex_plank', target_sets: 2, target_reps: 40, target_duration_s: 40, target_weight: null, rest_seconds: 35 },
  ];
  const input: PartnerWorkoutInput = {
    workout_id: crypto.randomUUID(), name: 'Reviewed strength day', expected_plan_id: null, expected_version: 0,
    slots: targets.map((target, order_index) => ({
      ...slot, id: crypto.randomUUID(), order_index, target_duration_s: null, is_warmup: 0,
      group_id: null, group_rest_seconds: null, group_transition_seconds: null,
      ...target, target_weight_unit: target.target_weight_unit === 'kg' ? 'kg' : 'lb',
    })),
  };
  const invalid = structuredClone(input);
  invalid.slots[3]!.target_reps_max = 4;
  expect((await post(invalid)).status).toBe(400);
  expect(await getPlanTree(env.DB, user)).toBeNull();
  expect((await env.DB.prepare('SELECT id FROM audit_log WHERE user_id=?').bind(user).all()).results).toHaveLength(0);

  const reply = await post(input);
  expect(reply.status).toBe(201);
  const receipt = await reply.json();
  const tree = (await getPlanTree(env.DB, user))!;
  expect(tree.version).toBe(1);
  expect(tree.workouts).toHaveLength(1);
  expect(tree.workouts[0]!.exercises).toMatchObject(input.slots);
  expect(tree.workouts[0]!.exercises[3]!.target_weight).toBeNull();
  const retry = await post(structuredClone(input));
  expect(retry.status).toBe(201);
  expect(await retry.json()).toEqual(receipt);
  expect((await getPlanTree(env.DB, user))!.version).toBe(1);
  expect((await env.DB.prepare('SELECT version FROM plan_snapshots WHERE user_id=?').bind(user).all()).results).toHaveLength(1);
  expect((await env.DB.prepare('SELECT id FROM sessions WHERE user_id=?').bind(user).all()).results).toHaveLength(0);
});

it('binds a planless browser draft and its refresh to the reviewed account before mutation', async () => {
  const original = await member(), other = await member();
  const jwt = await issueAppJwt(other, env.APP_JWT_SECRET, { client: 'web' });
  const profile = await SELF.fetch('https://test/api/me', { headers: { Authorization: `Bearer ${jwt}` } });
  expect(profile.status).toBe(200);
  expect(await profile.json()).toMatchObject({ id: other });
  const headers = { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json', 'X-TresFort-Account': original };
  const rejected = await SELF.fetch('https://test/api/workouts/prescribed', {
    method: 'POST', headers, body: JSON.stringify(core()),
  });
  expect(rejected.status).toBe(409);
  expect(await rejected.json()).toEqual({ error: 'account_changed' });
  const read = await SELF.fetch('https://test/api/state', { headers });
  expect(read.status).toBe(409);
  expect(await getPlanTree(env.DB, original)).toBeNull();
  expect(await getPlanTree(env.DB, other)).toBeNull();
  expect((await env.DB.prepare('SELECT id FROM audit_log WHERE user_id IN (?,?)').bind(original, other).all()).results).toHaveLength(0);
  const accepted = await SELF.fetch('https://test/api/workouts/prescribed', {
    method: 'POST', headers: { ...headers, 'X-TresFort-Account': other }, body: JSON.stringify(core()),
  });
  expect(accepted.status).toBe(201);
});

it('replays an exact receipt after later plan changes without creating or scheduling another workout', async () => {
  const user = await member(), input = core(), post = await client(user);
  const first = await post(input);
  expect(first.status).toBe(201);
  const saved = await first.json<{ plan_id: string; version: number }>();
  const another = { ...core(), name: 'Morning routine', expected_plan_id: saved.plan_id, expected_version: 1 };
  expect((await post(another)).status).toBe(201);
  // The original request still carries version zero: receipt lookup precedes CAS.
  const retry = await post(JSON.parse(JSON.stringify(input)));
  expect(retry.status).toBe(201);
  expect(await retry.json()).toEqual({ workout_id: input.workout_id, plan_id: saved.plan_id, version: 2 });
  expect((await getPlanTree(env.DB, user))!.workouts).toHaveLength(2);
  expect((await env.DB.prepare('SELECT id FROM audit_log WHERE id=?').bind(input.workout_id).all()).results).toHaveLength(1);
  expect((await env.DB.prepare('SELECT version FROM plan_snapshots WHERE plan_id=?').bind(saved.plan_id).all()).results).toHaveLength(2);
});

it('canonicalizes omitted nullable fields without changing retry identity', async () => {
  const user = await member(), post = await client(user);
  const input = core();
  const omitted = {
    ...input,
    slots: input.slots.map(({ target_reps_max, target_rpe, target_weight, cues, ...slot }) => slot),
  };
  const first = await post(omitted);
  expect(first.status).toBe(201);
  const retry = await post(input);
  expect(retry.status).toBe(201);
  expect(await retry.json()).toEqual(await first.json());
});

it('keeps receipt identity bound to the account, operation and reviewed payload', async () => {
  const user = await member(), input = core(), post = await client(user);
  expect((await post(input)).status).toBe(201);
  for (const changed of [
    { ...input, name: 'Another core' },
    { ...input, slots: input.slots.map(slot => ({ ...slot, target_duration_s: 50 })) },
  ]) {
    const reply = await post(changed);
    expect(reply.status).toBe(409);
    expect(await reply.json()).toEqual({ error: 'idempotency_conflict' });
  }
  const stranger = await member(), otherPost = await client(stranger);
  const foreign = await otherPost(input);
  expect(foreign.status).toBe(409);
  expect(await foreign.json()).toEqual({ error: 'idempotency_conflict' });
  expect(await getPlanTree(env.DB, stranger)).toBeNull();
  expect(await createPartnerWorkout(env.DB, user, input)).toEqual({ error: 'idempotency_conflict' });
  const partnerUser = await member(), partnerInput = core();
  await createPartnerWorkout(env.DB, partnerUser, partnerInput);
  expect(await createPrescribedWorkout(env.DB, partnerUser, partnerInput)).toEqual({ error: 'idempotency_conflict' });
  expect((await getPlanTree(env.DB, user))!.version).toBe(1);
});

it.each(['rename', 'archive'] as const)('does not recreate or overwrite a saved workout after %s', async change => {
  const user = await member(), input = core(), post = await client(user);
  expect((await post(input)).status).toBe(201);
  const tree = (await getPlanTree(env.DB, user))!;
  await patchWorkoutAtVersion(env.DB, user, tree, input.workout_id,
    change === 'rename' ? { name: 'Edited core' } : { archived_at: 1 });
  const retry = await post(input);
  expect(retry.status).toBe(409);
  expect(await retry.json()).toEqual({ error: 'workout_changed' });
  const after = (await getPlanTree(env.DB, user))!;
  expect(after.version).toBe(2);
  expect(after.workouts).toHaveLength(1);
  expect(after.workouts[0]).toMatchObject(change === 'rename' ? { name: 'Edited core' } : { archived_at: 1 });
});

it.each([
  ['unknown top-level field', (input: PartnerWorkoutInput) => ({ ...input, user_id: 'another-member' })],
  ['unknown slot field', (input: PartnerWorkoutInput) => ({ ...input, slots: input.slots.map(slot => ({ ...slot, run_steps: [] })) })],
  ['unknown exercise', (input: PartnerWorkoutInput) => ({ ...input, slots: input.slots.map(slot => ({ ...slot, exercise_id: 'missing' })) })],
  ['invalid sets', (input: PartnerWorkoutInput) => ({ ...input, slots: input.slots.map(slot => ({ ...slot, target_sets: 0 })) })],
  ['inconsistent circuit', (input: PartnerWorkoutInput) => ({ ...input, slots: input.slots.map((slot, i) => ({ ...slot, target_sets: i + 1 })) })],
  ['duplicate slot identity', (input: PartnerWorkoutInput) => ({ ...input, slots: input.slots.map(slot => ({ ...slot, id: input.slots[0]!.id })) })],
] as const)('rejects %s before creating any durable state', async (_name, invalidate) => {
  const user = await member(), post = await client(user);
  const reply = await post(invalidate(core()));
  expect(reply.status).toBe(400);
  expect(await getPlanTree(env.DB, user)).toBeNull();
  expect((await env.DB.prepare('SELECT id FROM audit_log WHERE user_id=?').bind(user).all()).results).toHaveLength(0);
  expect((await env.DB.prepare('SELECT id FROM plan_snapshots WHERE user_id=?').bind(user).all()).results).toHaveLength(0);
});

it('concurrent identical requests share a receipt while distinct stale drafts conflict', async () => {
  const user = await member(), input = core();
  const copies = await Promise.all([
    createPrescribedWorkout(env.DB, user, input), createPrescribedWorkout(env.DB, user, input),
  ]);
  expect(copies[0]).toEqual(copies[1]);
  expect(copies[0]).toMatchObject({ workout_id: input.workout_id, version: 1 });
  const tree = (await getPlanTree(env.DB, user))!;
  const drafts = [core(), core()].map(draft => ({ ...draft, expected_plan_id: tree.id, expected_version: tree.version }));
  const replies = await Promise.all(drafts.map(draft => createPrescribedWorkout(env.DB, user, draft)));
  expect(replies.filter(result => 'workout_id' in result)).toHaveLength(1);
  expect(replies.filter(result => 'conflict' in result)).toHaveLength(1);
  expect((await getPlanTree(env.DB, user))!.workouts).toHaveLength(2);
});

it.each([false, true])('rolls back the entire prescription if audit fails (existing plan: %s)', async existingPlan => {
  const user = await member(), input = core();
  if (existingPlan) {
    await createPrescribedWorkout(env.DB, user, core());
    const tree = (await getPlanTree(env.DB, user))!;
    input.expected_plan_id = tree.id;
    input.expected_version = tree.version;
  }
  await env.DB.exec("CREATE TRIGGER fail_prescription_audit BEFORE INSERT ON audit_log WHEN NEW.tool='create_workout_prescription' BEGIN SELECT RAISE(ABORT,'prescription test failure'); END");
  try { await expect(createPrescribedWorkout(env.DB, user, input)).rejects.toThrow('prescription test failure'); }
  finally { await env.DB.exec('DROP TRIGGER fail_prescription_audit'); }
  const after = await getPlanTree(env.DB, user);
  if (existingPlan) {
    expect(after!.version).toBe(1);
    expect(after!.workouts).toHaveLength(1);
  } else expect(after).toBeNull();
  expect(await env.DB.prepare('SELECT id FROM workouts WHERE id=?').bind(input.workout_id).first()).toBeNull();
  expect((await env.DB.prepare('SELECT id FROM template_exercises WHERE workout_id=?').bind(input.workout_id).all()).results).toHaveLength(0);
  expect(await env.DB.prepare('SELECT id FROM audit_log WHERE id=?').bind(input.workout_id).first()).toBeNull();
  expect((await env.DB.prepare('SELECT version FROM plan_snapshots WHERE user_id=?').bind(user).all()).results).toHaveLength(existingPlan ? 1 : 0);
});

it('requires authentication before accepting a reviewed workout', async () => {
  const reply = await SELF.fetch('https://test/api/workouts/prescribed', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(core()),
  });
  expect(reply.status).toBe(401);
});
