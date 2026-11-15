import { describe, expect, it } from 'vitest';
import { StateReadOrder, type StateReadTicket } from '../src/stateReadOrder';
import { applyFeedbackReceipt } from '../src/workoutFeedback';
import type { SessionRow } from '../../src/types';
import type { StateResponse } from '../src/api';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function session(notes: string | null, updated_at: number): SessionRow {
  return { id: 'session', user_id: 'member-a', plan_id: 'plan', workout_id: 'workout', date: '2026-11-14', slot: 0,
    status: 'completed', started_at: null, completed_at: null, notes, perceived_fatigue: null,
    created_at: 1, updated_at, attempt: 0, write_protocol: 'attempt-v1' };
}
function state(row: SessionRow): StateResponse {
  return { plan: null, plan_version: 0, sessions: [row], external_events: [], external_activities: [] };
}
function readyOrder() {
  const order = new StateReadOrder();
  order.bindAccount(order.startAccountLoad(), 'member-a');
  return order;
}

describe('account-scoped state read order', () => {
  it.each([false, true])('keeps feedback ACK when a pre-save GET arrives after the new refresh (refresh fails: %s)', async failRefresh => {
    const order = readyOrder();
    let shown = state(session(null, 10));
    const oldGet = deferred<StateResponse>(), newGet = deferred<StateResponse>();
    const receive = async (ticket: StateReadTicket, response: Promise<StateResponse>) => {
      try {
        const value = await response;
        if (order.isCurrent(ticket)) shown = value;
      } catch { /* A read failure keeps the acknowledged state. */ }
    };
    // A prior plan-write refresh is held while the member moves to Activity.
    const oldRead = receive(order.startRead('member-a')!, oldGet.promise);
    const ack = session('Saved workout feedback', 20);
    expect(order.acknowledge('member-a')).toBe(true);
    shown = applyFeedbackReceipt(shown, ack, 'member-a', shown.sessions[0]!);
    const newRead = receive(order.startRead('member-a')!, newGet.promise);
    if (failRefresh) newGet.reject(new Error('offline'));
    else newGet.resolve(state(ack));
    await newRead;
    oldGet.resolve(state(session(null, 10)));
    await oldRead;
    expect(shown.sessions[0]).toEqual(ack);
  });

  it('invalidates a queued result at acknowledgement even before another refresh begins', () => {
    const order = readyOrder();
    const ticket = order.startRead('member-a')!;
    expect(order.isCurrent(ticket)).toBe(true);
    // React can apply a functional state update later than its fetch callback.
    const queued = () => order.isCurrent(ticket);
    order.acknowledge('member-a');
    expect(queued()).toBe(false);
    expect(order.isCurrent(order.startRead('member-a')!)).toBe(true);
  });

  it('allows only the newest initiated read, regardless of response order', () => {
    const order = readyOrder();
    const earlier = order.startRead('member-a')!;
    const later = order.startRead('member-a')!;
    expect(order.isCurrent(earlier)).toBe(false);
    expect(order.isCurrent(later)).toBe(true);
    expect(order.acknowledge('member-b')).toBe(false);
    expect(order.isCurrent(later)).toBe(true);
  });

  it('invalidates old replies and auth failures when loading another account, including a return to the same account', () => {
    const order = readyOrder();
    const stale = order.startRead('member-a')!;
    const otherLoad = order.startAccountLoad();
    expect(order.isCurrent(stale)).toBe(false);
    expect(order.startRead('member-a')).toBeNull();
    expect(order.acknowledge('member-a')).toBe(false);
    const other = order.bindAccount(otherLoad, 'member-b')!;
    expect(order.isCurrent(other)).toBe(true);
    // A delayed error for member A cannot clear member B's account.
    expect(order.clearAccount('member-a')).toBe(false);
    expect(order.isCurrent(other)).toBe(true);
    const back = order.bindAccount(order.startAccountLoad(), 'member-a')!;
    expect(order.isCurrent(back)).toBe(true);
    expect(order.isCurrent(stale)).toBe(false);
  });

  it('rejects superseded account lookups and invalidates every read on sign-out', () => {
    const order = new StateReadOrder();
    const first = order.startAccountLoad(), second = order.startAccountLoad();
    expect(order.bindAccount(first, 'member-a')).toBeNull();
    const current = order.bindAccount(second, 'member-b')!;
    expect(order.isCurrent(current)).toBe(true);
    const pending = order.startRead('member-b')!;
    expect(order.clearAccount('member-b')).toBe(true);
    expect(order.isCurrent(pending)).toBe(false);
    expect(order.startRead('member-b')).toBeNull();
  });
});
