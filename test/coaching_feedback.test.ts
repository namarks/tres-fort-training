import { env, applyD1Migrations, SELF } from 'cloudflare:test';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { issueAppJwt } from '../src/auth';
import { coachingSession, coachingPlanMeta } from '../src/coachingContext';
import { patchCompletedSessionFeedback } from '../src/db';
import type { SessionRow } from '../src/types';
import { runWorkoutWriteStatement } from '../src/workout-write-fence';
import contextFixture from '../ios/TresFortTests/Fixtures/CoachingContext.json';
import feedback from '../ios/TresFortTests/Fixtures/WorkoutFeedback.json';

const BASE = 'https://tres-fort.test';
let jwt: string;
let session: { id: string; date: string; attempt: number };
async function rest(path: string, method = 'GET', body?: unknown, token = jwt) {
  const response = await SELF.fetch(`${BASE}/api/${path}`, {
    method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  expect(response.ok).toBe(true);
  return response.json<any>();
}
async function rpc(method: string, params: unknown) {
  const r = await SELF.fetch(`${BASE}/mcp`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-mcp-token' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  expect(r.status).toBe(200);
  return (await r.json<any>()).result;
}
async function tool(name: string, args = {}) {
  return JSON.parse((await rpc('tools/call', { name, arguments: args })).content[0].text);
}
function brief(text: string) { return JSON.parse(text.match(/```json\n([\s\S]*?)\n```/)![1]!); }

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
  const auth = await SELF.fetch(`${BASE}/auth/dev`, { method: 'POST',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ secret: 'test-dev' }) });
  jwt = (await auth.json<any>()).jwt;
  await rest('plan', 'POST', { name: 'Feedback contract' });
  session = await rest('sessions', 'POST', { date: '2026-09-08' });
  await rest(`sessions/${session.id}/sets`, 'POST', { id: crypto.randomUUID(),
    exercise_id: 'ex_bench', set_index: 1, weight: 45, reps: 5 });
  // The same edited transcript and fatigue fixture is encoded by iOS tests.
  await rest(`sessions/${session.id}?expected_attempt=${session.attempt}`, 'PATCH', {
    notes: feedback.recognized, perceived_fatigue: feedback.perceived_fatigue,
  });
  await rest(`sessions/${session.id}?expected_attempt=${session.attempt}`, 'PATCH', {
    status: 'completed', notes: feedback.edited, perceived_fatigue: feedback.perceived_fatigue,
    expected_feedback: { notes: feedback.recognized, perceived_fatigue: feedback.perceived_fatigue },
  });
});

const expected = { notes: feedback.edited, perceived_fatigue: feedback.perceived_fatigue };

const feedbackBody = (changes: Record<string, unknown> = {}) => ({
  notes: 'Post-workout correction', perceived_fatigue: 6,
  expected_attempt: session.attempt, expected_feedback: expected, ...changes,
});
const sendFeedback = (body: unknown, id = session.id, token = jwt, headers: Record<string, string> = {}) =>
  SELF.fetch(`${BASE}/api/sessions/${id}/feedback`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...headers },
    body: JSON.stringify(body),
  });
const persistedSession = async (id = session.id) => (await env.DB
  .prepare('SELECT * FROM sessions WHERE id=?').bind(id).first<SessionRow>())!;

it('requires attempt-protocol activation even when the feedback route has no protocol header', async () => {
  const before = await persistedSession();
  const variants: Record<string, string>[] = [{}, { 'X-TresFort-Write-Protocol': 'attempt-v1' }];
  for (const headers of variants) {
    const response = await sendFeedback(feedbackBody(), session.id, jwt, headers);
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: 'write_protocol_not_active', retryable: true });
  }
  expect(await persistedSession()).toEqual(before);
});

describe('editing feedback on an exact completed workout', () => {
  beforeEach(async () => {
    await env.DB.prepare('UPDATE workout_write_fence SET enabled=1,activated_at=1 WHERE id=1').run();
  });

  it('adds, edits, and clears optional feedback without changing completion or logged work', async () => {
    await rest(`sessions/${session.id}?expected_attempt=${session.attempt}`, 'PATCH', {
      notes: null, perceived_fatigue: null,
    });
    const before = await persistedSession();
    const sets = await env.DB.prepare('SELECT * FROM set_logs ORDER BY id').all();
    const count = await env.DB.prepare('SELECT COUNT(*) AS count FROM sessions').first();
    let baseline: { notes: string | null; perceived_fatigue: number | null } = { notes: null, perceived_fatigue: null };
    for (const desired of [
      { notes: 'Felt strong after finishing', perceived_fatigue: 6 },
      { notes: 'Edited after cooling down', perceived_fatigue: 3 },
      { notes: null, perceived_fatigue: null },
    ]) {
      const response = await sendFeedback(feedbackBody({ ...desired, expected_feedback: baseline }));
      expect(response.status).toBe(200);
      const saved = await response.json<SessionRow>();
      expect(saved).not.toHaveProperty('summary');
      expect(saved).toEqual({ ...before, ...desired, updated_at: saved.updated_at, write_protocol: 'attempt-v1' });
      expect(await persistedSession()).toEqual(saved);
      expect((await env.DB.prepare('SELECT * FROM set_logs ORDER BY id').all()).results).toEqual(sets.results);
      expect(await env.DB.prepare('SELECT COUNT(*) AS count FROM sessions').first()).toEqual(count);
      baseline = desired;
    }
  });

  it('edits an additional session without changing its primary sibling or another date', async () => {
    const added = await rest('sessions', 'POST', {
      date: session.date, additional: true, id: crypto.randomUUID(), expected_attempt: 0,
    });
    await rest(`sessions/${added.id}/sets`, 'POST', { id: crypto.randomUUID(),
      exercise_id: 'ex_bench', set_index: 1, weight: 95, reps: 5, expected_attempt: added.attempt });
    await rest(`sessions/${added.id}?expected_attempt=${added.attempt}`, 'PATCH', { status: 'completed' });
    const otherDate = await rest('sessions', 'POST', { date: '2026-09-07' });
    const primaryBefore = await persistedSession();
    const otherBefore = await persistedSession(otherDate.id);
    const addedBefore = await persistedSession(added.id);
    const response = await sendFeedback(feedbackBody({ expected_attempt: added.attempt,
      expected_feedback: { notes: null, perceived_fatigue: null } }), added.id);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ id: added.id, slot: 1, date: session.date,
      attempt: added.attempt, status: 'completed', started_at: addedBefore.started_at,
      completed_at: addedBefore.completed_at, notes: 'Post-workout correction' });
    expect(await persistedSession()).toEqual(primaryBefore);
    expect(await persistedSession(otherDate.id)).toEqual(otherBefore);
  });

  it('accepts identical retries and atomically refuses a competing feedback baseline', async () => {
    const bodies = [feedbackBody({ notes: 'Choice A' }), feedbackBody({ notes: 'Choice B' })];
    const responses = await Promise.all(bodies.map(body => sendFeedback(body)));
    expect(responses.map(r => r.status).sort()).toEqual([200, 409]);
    const winner = await responses.find(r => r.status === 200)!.json<SessionRow>();
    expect(await responses.find(r => r.status === 409)!.json()).toMatchObject({
      error: 'session_feedback_conflict', current_session: { id: session.id, notes: winner.notes },
    });
    const retry = await sendFeedback(bodies.find(body => body.notes === winner.notes));
    expect(retry.status).toBe(200);
    expect(await retry.json()).toMatchObject({ id: winner.id, notes: winner.notes, perceived_fatigue: 6 });
    expect((await persistedSession()).notes).toBe(winner.notes);
  });

  it.each(['planned', 'in_progress', 'skipped'])('refuses feedback for a %s session', async status => {
    const target = await rest('sessions', 'POST', { date: '2026-09-10' });
    if (status !== 'planned') await rest(`sessions/${target.id}`, 'PATCH', { status });
    const before = await persistedSession(target.id);
    const response = await sendFeedback(feedbackBody({ expected_attempt: target.attempt,
      expected_feedback: { notes: null, perceived_fatigue: null } }), target.id);
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: 'session_state_conflict',
      expected_status: 'completed', current_session: before });
    expect(await persistedSession(target.id)).toEqual(before);
  });

  it('refuses discarded and restarted attempts without writing feedback to the new workout', async () => {
    await rest(`sessions/${session.id}/discard?expected_attempt=${session.attempt}`, 'POST');
    const discarded = await sendFeedback(feedbackBody());
    expect(discarded.status).toBe(409);
    expect(await discarded.json()).toMatchObject({ error: 'session_discarded', current_session: { status: 'discarded' } });
    const restart = await rest('sessions', 'POST', {
      date: session.date, restart_discarded: true, expected_attempt: session.attempt,
    });
    await rest(`sessions/${restart.id}?expected_attempt=${restart.attempt}`, 'PATCH', { status: 'completed' });
    const before = await persistedSession();
    const stale = await sendFeedback(feedbackBody());
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({ error: 'session_attempt_conflict',
      expected_attempt: session.attempt, current_attempt: restart.attempt, current_session: before });
    expect(await persistedSession()).toEqual(before);
  });

  it('accepts owned aliases but does not expose a session or alias to another account', async () => {
    const alias = crypto.randomUUID();
    await env.DB.prepare('INSERT INTO session_aliases (alias_session_id,canonical_session_id) VALUES (?,?)')
      .bind(alias, session.id).run();
    const otherId = crypto.randomUUID();
    await env.DB.prepare('INSERT INTO users (id,apple_sub,created_at) VALUES (?,?,0)').bind(otherId, otherId).run();
    const otherToken = await issueAppJwt(otherId, 'test-secret');
    const before = await persistedSession();
    for (const id of [session.id, alias]) {
      const response = await sendFeedback(feedbackBody(), id, otherToken);
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ error: 'not_found' });
    }
    expect(await persistedSession()).toEqual(before);
    const owned = await sendFeedback(feedbackBody(), alias);
    expect(owned.status).toBe(200);
    expect(await owned.json()).toMatchObject({ id: session.id, notes: 'Post-workout correction' });
  });

  it.each([0, 11])('can replace a legacy fatigue baseline of %s', async legacy => {
    await rest(`sessions/${session.id}?expected_attempt=${session.attempt}`, 'PATCH', { perceived_fatigue: legacy });
    const response = await sendFeedback(feedbackBody({ expected_feedback: { ...expected, perceived_fatigue: legacy } }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ perceived_fatigue: 6 });
  });

  it('rejects missing, unknown, and invalid fields before any session mutation', async () => {
    const valid = feedbackBody();
    const missing = Object.keys(valid).map(key => Object.fromEntries(Object.entries(valid).filter(([field]) => field !== key)));
    const bodies = [null, [], ...missing,
      ...['status', 'workout_id', 'started_at', 'completed_at', 'attempt', 'set_logs', '__proto__'].map(key => ({ ...valid, [key]: 'forbidden' })),
      ...[-1, 0, 11, 2.5, '5', true, {}].map(perceived_fatigue => ({ ...valid, perceived_fatigue })),
      ...[-1, 0.5, '0', null].map(expected_attempt => ({ ...valid, expected_attempt })),
      { ...valid, notes: 4 }, { ...valid, expected_feedback: null },
      { ...valid, expected_feedback: { notes: null } },
      { ...valid, expected_feedback: { notes: null, perceived_fatigue: -1 } },
      { ...valid, expected_feedback: { notes: null, perceived_fatigue: 1, extra: true } },
    ];
    const before = await persistedSession();
    for (const body of bodies) expect((await sendFeedback(body)).status, JSON.stringify(body)).toBe(400);
    const invalidHeader = await sendFeedback(valid, session.id, jwt, { 'X-TresFort-Write-Protocol': 'unknown' });
    expect(invalidHeader.status).toBe(400);
    expect(await invalidHeader.json()).toEqual({ error: 'invalid_write_protocol' });
    expect(await persistedSession()).toEqual(before);
  });

  it('rechecks completed status in the write predicate after the initial read', async () => {
    const before = await persistedSession();
    const racingDB = new Proxy(env.DB, {
      get(target, property) {
        if (property === 'batch') return async (statements: D1PreparedStatement[]) => {
          // Simulate a competing lifecycle writer after the service has read
          // the completed row but before its UPDATE reaches D1.
          await runWorkoutWriteStatement(env.DB, env.DB.prepare("UPDATE sessions SET status='in_progress' WHERE id=?").bind(session.id));
          return target.batch(statements);
        };
        const value = Reflect.get(target, property);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    const result = await patchCompletedSessionFeedback(racingDB, before.user_id, session.id,
      { notes: 'Should not save', perceived_fatigue: 6, expected_feedback: expected }, session.attempt);
    expect(result).toMatchObject({ error: 'session_state_conflict', expected_status: 'completed',
      current_session: { status: 'in_progress', ...expected } });
    expect(await persistedSession()).toEqual({ ...before, status: 'in_progress' });
  });

  it('returns the committed acknowledgement without a post-write read or summary', async () => {
    const before = await persistedSession();
    let committed = false;
    const noReadbackDB = new Proxy(env.DB, {
      get(target, property) {
        if (property === 'batch') return async (statements: D1PreparedStatement[]) => {
          const result = await target.batch(statements);
          committed = true;
          return result;
        };
        if (property === 'prepare' && committed) throw new Error('readback unavailable');
        const value = Reflect.get(target, property);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    const result = await patchCompletedSessionFeedback(noReadbackDB, before.user_id, session.id,
      { notes: 'Acknowledged', perceived_fatigue: null, expected_feedback: expected }, session.attempt);
    expect(committed).toBe(true);
    expect(result).toMatchObject({ id: session.id, status: 'completed', notes: 'Acknowledged', perceived_fatigue: null });
    expect(result).toEqual(await persistedSession());
  });

  it('updates private coach context while keeping the edited words out of group projections', async () => {
    const response = await sendFeedback(feedbackBody());
    expect(response.status).toBe(200);
    const saved = await response.json<SessionRow>();
    expect((await tool('get_session_log', { date: session.date }))[0].session).toMatchObject(saved);
    expect(brief((await rpc('resources/read', { uri: 'coach://state/current' })).contents[0].text)
      .last_completed_session).toMatchObject({ notes: saved.notes, perceived_fatigue: saved.perceived_fatigue });
    const group = await rest('groups', 'POST', { name: 'Edited feedback privacy' });
    const feed = await tool('get_group_feed', { group_id: group.id, range: '30d' });
    expect(feed.items.length).toBeGreaterThan(0);
    expect(JSON.stringify(feed)).not.toContain(saved.notes);
    expect(JSON.stringify(feed)).not.toMatch(/perceived_fatigue|session_notes/);
  });
});

describe('private workout feedback from finish to coach', () => {
  it('returns the edited words and fatigue through state, session log, and exercise history', async () => {
    const state = await rest('state');
    expect(state.sessions.find((s: any) => s.id === session.id)).toMatchObject(expected);
    expect((await tool('get_session_log', { date: session.date }))[0].session).toMatchObject(expected);
    const history = await tool('get_history', { exercise: 'bench', range: '365d' });
    expect(history.by_session.find((s: any) => s.date === session.date)).toMatchObject(expected);
  });
  it('keeps feedback on the latest completed session in the resource and prompt', async () => {
    const resource = await rpc('resources/read', { uri: 'coach://state/current' });
    expect(brief(resource.contents[0].text).last_session).toMatchObject(expected);
    const prompt = await rpc('prompts/get', { name: 'coach_brief' });
    expect(prompt.messages.map((m: any) => m.content.text).join('\n')).toContain(feedback.edited);
  });
  it.each(['skipped', 'in_progress'])('keeps prior completed feedback when latest is %s', async (status) => {
    const latest = await rest('sessions', 'POST', { date: '2026-09-09' });
    if (status === 'skipped') await rest(`sessions/${latest.id}`, 'PATCH', { status });
    else await rest(`sessions/${latest.id}/sets`, 'POST', { id: crypto.randomUUID(),
      exercise_id: 'ex_bench', set_index: 1, weight: 45, reps: 5 });
    const resource = await rpc('resources/read', { uri: 'coach://state/current' });
    const result = brief(resource.contents[0].text);
    expect(result.last_session.status).toBe(status);
    expect(result.last_session.notes).toBeNull();
    expect(result.last_session.perceived_fatigue).toBeNull();
    expect(result.last_completed_session).toMatchObject({ date: session.date, ...expected });
    expect((await tool('get_today_workout')).last_completed_session).toMatchObject(expected);
  });
  it('projects the same persisted sessions and authored plan metadata delivered to iOS', async () => {
    const state = await rest('state');
    await env.DB.prepare('UPDATE plans SET meta = ? WHERE id = ?')
      .bind(JSON.stringify(contextFixture.meta), state.plan.id).run();
    // A future planned row must not displace recent training in the brief.
    await rest('sessions', 'POST', { date: '2099-01-01' });
    const current = await rest('state');
    const catalog = await rest('exercises');
    const result = brief((await rpc('resources/read', { uri: 'coach://state/current' })).contents[0].text);
    expect(result.active_plan).toMatchObject({ id: current.plan.id, version: current.plan.version,
      authored_context: coachingPlanMeta(current.plan.meta) });
    expect(result.active_plan.authored_context.stress_model).toEqual(contextFixture.meta.stress_model);
    expect(result.recent_sessions.some((s: any) => s.date === '2099-01-01')).toBe(false);
    const row = current.sessions.find((s: any) => s.id === session.id);
    const projection = coachingSession(row, current.sets, catalog);
    expect(result.recent_sessions.find((s: any) => s.id === row.id)).toEqual(projection);
    expect(result.last_completed_session).toEqual(projection);
    expect(result.scheduling_context.basis).toBe('scheduling_heuristic');
    expect(JSON.stringify(result)).not.toContain('readiness_score');
  });
  it('retries an identical finish without losing edited feedback', async () => {
    const response = await rest(`sessions/${session.id}?expected_attempt=${session.attempt}`, 'PATCH', {
      status: 'completed', ...expected,
    });
    expect(response).toMatchObject(expected);
    expect((await rest('state')).sessions.filter((s: any) => s.id === session.id)).toHaveLength(1);
  });
  it('does not replay a timed-out finish over newer feedback in the same attempt', async () => {
    await rest(`sessions/${session.id}`, 'PATCH', { notes: 'Newer coaching correction', perceived_fatigue: 4 });
    const response = await SELF.fetch(`${BASE}/api/sessions/${session.id}?expected_attempt=${session.attempt}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt}` },
      body: JSON.stringify({ status: 'completed', ...expected,
        expected_feedback: { notes: feedback.recognized, perceived_fatigue: feedback.perceived_fatigue } }),
    });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: 'session_feedback_conflict', current_session: {
      notes: 'Newer coaching correction', perceived_fatigue: 4,
    } });
    expect((await rest('state')).sessions.find((s: any) => s.id === session.id)).toMatchObject({
      notes: 'Newer coaching correction', perceived_fatigue: 4,
    });
  });
  it('allows explicit clearing while an absent feedback envelope leaves fields unchanged', async () => {
    const unchanged = await rest(`sessions/${session.id}`, 'PATCH', { status: 'completed' });
    expect(unchanged).toMatchObject(expected);
    const cleared = await rest(`sessions/${session.id}`, 'PATCH', { status: 'completed',
      notes: null, perceived_fatigue: null, expected_feedback: expected });
    expect(cleared).toMatchObject({ notes: null, perceived_fatigue: null });
  });
  it('accepts exact feedback retries and rejects a competing edit atomically', async () => {
    const send = (notes: string) => SELF.fetch(`${BASE}/api/sessions/${session.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt}` },
      body: JSON.stringify({ status: 'completed', notes, perceived_fatigue: 5, expected_feedback: expected }),
    });
    const responses = await Promise.all([send('Choice A'), send('Choice B')]);
    expect(responses.map(r => r.status).sort()).toEqual([200, 409]);
    const winner = await responses.find(r => r.status === 200)!.json<any>();
    const retry = await send(winner.notes);
    expect(retry.status).toBe(200);
    expect(await retry.json()).toMatchObject({ notes: winner.notes, perceived_fatigue: 5 });
  });
  it('keeps feedback absent from group projections and other member state', async () => {
    const group = await rest('groups', 'POST', { name: 'Private feedback check' });
    const feed = await tool('get_group_feed', { group_id: group.id, range: '30d' });
    expect(feed.items.length).toBeGreaterThan(0);
    expect(JSON.stringify(feed)).not.toContain(feedback.edited);
    expect(JSON.stringify(feed)).not.toMatch(/perceived_fatigue|session_notes/);
    const id = crypto.randomUUID();
    await env.DB.prepare('INSERT INTO users (id,apple_sub,display_name,created_at) VALUES (?1,?2,?3,?4)')
      .bind(id, `synthetic-${id}`, 'Other member', Date.now()).run();
    const other = await rest('state', 'GET', undefined, await issueAppJwt(id, 'test-secret'));
    expect(other.sessions).toEqual([]);
    expect(JSON.stringify(other)).not.toContain(feedback.edited);
  });
});

describe('working-set trend semantics', () => {
  it('states effort coverage and primary attribution and never adds incompatible units', async () => {
    await rest(`sessions/${session.id}/sets`, 'POST', { id: crypto.randomUUID(),
      exercise_id: 'ex_bench', set_index: 2, weight: 50, reps: 5, rpe: 8 });
    // Same primary muscle, different unit; the set carries its own unit.
    // Catalog fixtures are test-only.
    await env.DB.prepare(`INSERT INTO exercises (id,name,primary_muscle,modality,unit,created_at)
      VALUES ('coaching-kg','Kilogram press','chest','barbell','kg',0)`).run();
    await rest(`sessions/${session.id}/sets`, 'POST', { id: crypto.randomUUID(),
      exercise_id: 'coaching-kg', set_index: 1, weight: 20, reps: 5, weight_unit: 'kg' });
    const result = await tool('get_volume_trend', { muscle_group: 'chest', range: 'all' });
    expect(result).toMatchObject({ muscle_attribution: 'primary_muscle_only', set_count_basis: 'logged_non_warmup_sets' });
    expect(result.buckets).toEqual([expect.objectContaining({ hard_sets: 3, logged_working_sets: 3,
      sets_with_effort: 1, tonnage: null, unit: null, external_load_volume: [
        { unit: 'kg', value: 100, contributing_sets: 1 },
        { unit: 'lb', value: 475, contributing_sets: 2 },
      ] })]);
  });
});
