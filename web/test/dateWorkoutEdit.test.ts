import { afterEach, describe, expect, it, vi } from 'vitest';
import { AccountChangedError, copyWorkoutForDate, placeWorkoutForDate, planWrites, type StateResponse } from '../src/api';
import { assignedDateCopy, dateEditProblem, newDateEdit, readDateEdit, retainDateEdit, type PendingDateEdit } from '../src/dateEditState';

const today = '2026-11-13', date = '2026-11-19', copyId = '11111111-1111-4111-8111-111111111111';
const selection = { date, workoutId: 'run', primary: true };
function state(): StateResponse {
  return { plan: { id: 'plan', version: 8, meta: null, schedule: { version: 1, week: { thu: 'run' }, extras: { thu: ['core'] } }, trips: [],
    workouts: [{ id: 'run', name: 'Run', plan_id: 'plan', archived_at: null, exercises: [] },
      { id: 'core', name: 'Core', plan_id: 'plan', archived_at: null, exercises: [] }] }, sessions: [], external_events: [], external_activities: [] } as unknown as StateResponse;
}
function storage() {
  const values = new Map<string, string>();
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
}
afterEach(() => vi.unstubAllGlobals());

describe('one-date workout editing', () => {
  it('freezes source, date, plan version and absence token without touching the recurring week', () => {
    const current = state(), before = structuredClone(current);
    expect(newDateEdit(selection, current, today, () => copyId)).toEqual({ request: { id: copyId, name: 'Run', one_time_date: date,
      copy_from: 'run', expected_plan_id: 'plan', expected_version: 8 }, expectedAttempt: 0, phase: 'copy' });
    expect(current).toEqual(before);
  });

  it('blocks extras, stale primary selections, past, away and already-started main workouts', () => {
    expect(dateEditProblem({ ...selection, primary: false, workoutId: 'core' }, state(), today)).toMatch(/separate workout/);
    expect(newDateEdit({ ...selection, workoutId: 'core' }, state(), today)).toBeNull();
    expect(newDateEdit(selection, state(), '2026-11-20')).toBeNull();
    const away = state(); away.plan!.trips = [{ id: 'trip', start: date, end: date, type: 'travel', can_train_light: false }];
    expect(newDateEdit(selection, away, today)).toBeNull();
    for (const status of ['in_progress', 'completed'] as const) {
      const current = state();
      current.sessions = [{ date, slot: 0, workout_id: 'run', status }] as StateResponse['sessions'];
      expect(newDateEdit(selection, current, today)).toBeNull();
    }
  });

  it('does not recopy existing one-date workouts, and preserves a reviewed existing attempt', () => {
    const current = state();
    current.sessions = [{ date, slot: 0, workout_id: 'run', status: 'planned', attempt: 4 }] as StateResponse['sessions'];
    expect(newDateEdit(selection, current, today, () => copyId)?.expectedAttempt).toBe(4);
    current.plan!.workouts[0]!.one_time_date = date;
    expect(newDateEdit(selection, current, today, () => copyId)).toBeNull();
  });

  it('retains the same copy across reloads and accounts, without downgrading ACKs or erasing a newer request', () => {
    const local = storage(), copy = newDateEdit(selection, state(), today, () => copyId)!;
    expect(retainDateEdit(local, 'member-a', null, copy)).toBe(true);
    expect(readDateEdit(local, 'member-a')).toEqual(copy);
    expect(readDateEdit(local, 'member-b')).toBeNull();
    const placed: PendingDateEdit = { ...copy, phase: 'complete' };
    expect(retainDateEdit(local, 'member-a', copyId, placed)).toBe(true);
    expect(retainDateEdit(local, 'member-a', copyId, copy)).toBe(false);
    expect(retainDateEdit(local, 'member-a', 'another-request', null)).toBe(false);
    expect(readDateEdit(local, 'member-a')).toEqual(placed);
    expect(retainDateEdit(local, 'member-a', copyId, null)).toBe(true);
  });

  it('requires matching live copy and main-session assignment before opening confirmed recovery', () => {
    const current = state(), pending = newDateEdit(selection, current, today, () => copyId)!;
    current.plan!.workouts.push({ ...current.plan!.workouts[0]!, id: copyId, one_time_date: date });
    expect(assignedDateCopy(pending, current)).toBe(false);
    current.sessions = [{ date, workout_id: copyId, slot: 1, status: 'planned' }] as StateResponse['sessions'];
    expect(assignedDateCopy(pending, current)).toBe(false);
    current.sessions[0]!.slot = 0;
    expect(assignedDateCopy(pending, current)).toBe(true);
    current.sessions[0]!.status = 'skipped';
    expect(assignedDateCopy(pending, current)).toBe(false);
  });

  it('treats unreadable storage as unresolved rather than allowing a duplicate copy', () => {
    const local = storage(); local.setItem('tresfort.pendingDateEdit.v1.member', '{bad');
    expect(readDateEdit(local, 'member')).toBe('unreadable');
    expect(retainDateEdit(local, 'member', null, newDateEdit(selection, state(), today, () => copyId)!)).toBe(false);
  });

  it('binds copy, assignment and subsequent prescription edits to the reviewed account', async () => {
    const pending = newDateEdit(selection, state(), today, () => copyId)!;
    const fetch = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ id: copyId, plan_id: 'plan', one_time_date: date }), { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, session: { date, slot: 0, workout_id: copyId } })))
      .mockResolvedValueOnce(new Response('{}'));
    vi.stubGlobal('fetch', fetch);
    await copyWorkoutForDate(pending.request, 'member-a');
    await placeWorkoutForDate(pending.request, 4, 'member-a');
    await planWrites.updateSlot(copyId, 'slot', { target_duration_s: 20 }, { planId: 'plan', version: 9, accountId: 'member-a' });
    for (const [, options] of fetch.mock.calls) expect(options.headers['x-tresfort-account']).toBe('member-a');
    expect(JSON.parse(fetch.mock.calls[1]![1].body)).toEqual({ workout_id: copyId, expected_attempt: 4 });
  });

  it('rejects account switches and malformed success receipts without treating them as successful copies', async () => {
    const request = newDateEdit(selection, state(), today, () => copyId)!.request;
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response('{"error":"account_changed"}', { status: 409 }))
      .mockResolvedValueOnce(new Response('{}', { status: 201 }))
      .mockResolvedValueOnce(new Response('{"ok":true,"session":{"slot":1}}')));
    await expect(copyWorkoutForDate(request, 'member-a')).rejects.toBeInstanceOf(AccountChangedError);
    await expect(copyWorkoutForDate(request, 'member-a')).rejects.toThrow('unreadable_date_copy_receipt');
    await expect(placeWorkoutForDate(request, 0, 'member-a')).rejects.toThrow('unreadable_date_assignment_receipt');
  });
});
