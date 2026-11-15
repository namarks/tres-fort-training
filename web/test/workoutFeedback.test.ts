import { afterEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { SessionRow } from '../../src/types';
import { AccountChangedError, ApiError, saveSessionFeedback, SignedOutError, type StateResponse } from '../src/api';
import { applyFeedbackReceipt, canEditFeedback, feedbackDraft, feedbackDraftProblem, feedbackFailure,
  feedbackRequest, resolveFeedbackConflict, sameFeedbackTarget } from '../src/workoutFeedback';
import { WorkoutFeedback } from '../src/WorkoutFeedbackEditor';

function session(fields: Partial<SessionRow> = {}): SessionRow {
  return { id: 'session-additional', user_id: 'member-a', plan_id: 'plan', workout_id: 'workout', date: '2026-11-14', slot: 2,
    status: 'completed', started_at: null, completed_at: null, perceived_fatigue: null, notes: null,
    created_at: 10, updated_at: 20, attempt: 0, write_protocol: 'legacy', ...fields };
}
function state(sessions: SessionRow[]): StateResponse {
  return { plan: null, plan_version: 0, sessions, sets: [], external_activities: [], external_events: [] };
}
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('completed workout feedback review', () => {
  it('allows a completed finishless record and attempt zero, but never other states or accounts', () => {
    expect(canEditFeedback(session(), 'member-a')).toBe(true);
    for (const status of ['planned', 'in_progress', 'skipped', 'discarded']) {
      expect(canEditFeedback(session({ status }), 'member-a')).toBe(false);
    }
    expect(canEditFeedback(session(), 'member-b')).toBe(false);
    for (const attempt of [-1, 0.5, NaN, undefined]) {
      expect(canEditFeedback(session({ attempt }), 'member-a')).toBe(false);
    }
  });

  it('makes an explicit optional clear with the exact saved baseline, preserving historical ratings', () => {
    const saved = session({ notes: '  old note  ', perceived_fatigue: 17 });
    const draft = feedbackDraft(saved);
    expect(draft).toMatchObject({ notes: '  old note  ', fatigue: '17' });
    expect(feedbackRequest(draft)).toBeNull();
    expect(feedbackDraftProblem(draft)).toContain('1 to 10');
    expect(feedbackRequest({ ...draft, notes: ' \n ', fatigue: '' })).toEqual({ expected_attempt: 0,
      expected_feedback: { notes: '  old note  ', perceived_fatigue: 17 }, notes: null, perceived_fatigue: null });
    expect(feedbackRequest({ ...feedbackDraft(session({ perceived_fatigue: 0 })), notes: 'Felt good', fatigue: '1' }))
      .toMatchObject({ expected_feedback: { notes: null, perceived_fatigue: 0 }, notes: 'Felt good', perceived_fatigue: 1 });
  });

  it('builds a detached request so later typing cannot change an uncertain retry', () => {
    const draft = { ...feedbackDraft(session()), notes: '  last set was tough  ', fatigue: '10' };
    const request = feedbackRequest(draft)!;
    draft.notes = 'Another proposal'; draft.fatigue = '1';
    draft.reviewed.notes = 'New saved note';
    expect(request).toEqual({ expected_attempt: 0, notes: 'last set was tough', perceived_fatigue: 10,
      expected_feedback: { notes: null, perceived_fatigue: null } });
    for (const fatigue of ['0', '11', '-1', '2.5', '1e1', ' 3 ', 'NaN']) {
      expect(feedbackRequest({ ...draft, fatigue })).toBeNull();
    }
  });

  it('adopts the returned baseline only after an explicit conflict choice', () => {
    const draft = { ...feedbackDraft(session()), notes: 'My correction', fatigue: '5' };
    const saved = session({ notes: 'From another device', perceived_fatigue: 8, updated_at: 30 });
    expect(feedbackFailure(new ApiError(409, { error: 'session_feedback_conflict', current_session: saved }), draft.reviewed))
      .toEqual({ kind: 'conflict', current: saved });
    expect(feedbackRequest(draft)?.expected_feedback).toEqual({ notes: null, perceived_fatigue: null });
    const mine = resolveFeedbackConflict(draft, saved, 'mine')!;
    expect(feedbackRequest(mine)).toEqual({ notes: 'My correction', perceived_fatigue: 5, expected_attempt: 0,
      expected_feedback: { notes: 'From another device', perceived_fatigue: 8 } });
    expect(resolveFeedbackConflict(draft, saved, 'saved')).toEqual(feedbackDraft(saved));
  });

  it('does not retarget a draft to a sibling, attempt, date, account or noncompleted workout', () => {
    const reviewed = session();
    for (const change of [{ id: 'sibling' }, { slot: 0 }, { attempt: 1 }, { user_id: 'member-b' }, { date: '2026-11-15' },
      { status: 'discarded' }, { status: 'in_progress' }]) {
      const current = session(change);
      expect(sameFeedbackTarget(reviewed, current)).toBe(false);
      expect(resolveFeedbackConflict(feedbackDraft(reviewed), current, 'mine')).toBeNull();
      expect(feedbackFailure(new ApiError(409, { error: 'session_feedback_conflict', current_session: current }), reviewed).kind).toBe('blocked');
    }
    for (const error of ['session_attempt_conflict', 'session_discarded', 'session_state_conflict']) {
      expect(feedbackFailure(new ApiError(409, { error, current_session: session() }), reviewed).kind).toBe('blocked');
    }
    expect(feedbackFailure(new ApiError(404, {}), reviewed).kind).toBe('blocked');
  });

  it('keeps unreadable success, network loss and server failure uncertain; distinguishes a disabled gate', () => {
    for (const error of [new TypeError('network unavailable'), new Error('unreadable_feedback_receipt'), new ApiError(500, {})]) {
      expect(feedbackFailure(error, session())).toMatchObject({ kind: 'uncertain', message: expect.stringContaining('same request') });
    }
    expect(feedbackFailure(new ApiError(503, { error: 'write_protocol_not_active' }), session())).toMatchObject({ kind: 'blocked' });
  });

  it('merges an ACK into only the exact completed session, preserving sibling sets, timing and generation', () => {
    const row = session(), sibling = session({ id: 'main', slot: 0, notes: 'Main note' });
    const before = state([sibling, row]);
    const ack = session({ notes: 'Additional note', perceived_fatigue: 7, updated_at: 30, write_protocol: 'attempt-v1' });
    const after = applyFeedbackReceipt(before, ack, 'member-a', row);
    expect(after.sessions[0]).toBe(sibling);
    expect(after.sets).toBe(before.sets);
    expect(after.sessions[1]).toEqual({ ...row, notes: 'Additional note', perceived_fatigue: 7, updated_at: 30, write_protocol: 'attempt-v1' });
    expect(before.sessions[1]?.notes).toBeNull();
    expect(applyFeedbackReceipt(before, ack, 'member-b', row)).toBe(before);
    for (const change of [{ attempt: 1 }, { status: 'discarded' }, { status: 'in_progress' }, { updated_at: 40 }, { slot: 3 }]) {
      const changed = state([session(change)]);
      expect(applyFeedbackReceipt(changed, ack, 'member-a', row)).toBe(changed);
    }
    expect(applyFeedbackReceipt(state([sibling]), ack, 'member-a', row).sessions).toEqual([sibling]);
  });

  it('preserves a later read with different feedback at the same millisecond as a delayed ACK or saved-conflict choice', () => {
    const reviewed = session({ notes: 'Originally reviewed', perceived_fatigue: 3, updated_at: 20 });
    const receipt = session({ notes: 'This edit', perceived_fatigue: 6, updated_at: 30 });
    for (const newer of [{ notes: 'Later note' }, { perceived_fatigue: 8 }, { notes: null }, { perceived_fatigue: null }]) {
      const current = state([{ ...receipt, ...newer }]);
      expect(applyFeedbackReceipt(current, receipt, 'member-a', reviewed)).toBe(current);
    }
    // This also applies to a 409's saved feedback: selecting it must not roll
    // back a different same-cursor row read while the conflict was open.
    const conflict = session({ notes: 'Saved conflict version', perceived_fatigue: 4, updated_at: 30 });
    const latest = state([session({ notes: 'Later saved version', perceived_fatigue: 9, updated_at: 30 })]);
    expect(applyFeedbackReceipt(latest, conflict, 'member-a', reviewed)).toBe(latest);
  });

  it('accepts an equal-ms ACK only over its reviewed feedback or its already returned feedback', () => {
    const reviewed = session({ notes: 'Reviewed', perceived_fatigue: 3, updated_at: 30 });
    const receipt = session({ notes: 'Accepted', perceived_fatigue: null, updated_at: 30, write_protocol: 'attempt-v1' });
    expect(applyFeedbackReceipt(state([reviewed]), receipt, 'member-a', reviewed).sessions[0]).toEqual(receipt);
    expect(applyFeedbackReceipt(state([receipt]), receipt, 'member-a', reviewed).sessions[0]).toEqual(receipt);
    const current = state([reviewed]);
    expect(applyFeedbackReceipt(current, receipt, 'member-a', { ...reviewed, id: 'sibling' })).toBe(current);
  });
});

describe('feedback API acknowledgements', () => {
  it('binds the exact route, account, attempt-zero and frozen feedback body on every retry', async () => {
    const saved = session({ id: 'session/encoded' });
    const body = feedbackRequest({ ...feedbackDraft(saved), notes: 'Reviewed', fatigue: '6' })!;
    const receipt = { ...saved, notes: body.notes, perceived_fatigue: 6, updated_at: 25 };
    const fetch = vi.fn().mockRejectedValueOnce(new TypeError('lost response')).mockResolvedValueOnce(Response.json(receipt));
    vi.stubGlobal('fetch', fetch);
    await expect(saveSessionFeedback(saved, body, 'member-a')).rejects.toThrow('lost response');
    await expect(saveSessionFeedback(saved, body, 'member-a')).resolves.toEqual(receipt);
    expect(fetch.mock.calls[1]).toEqual(fetch.mock.calls[0]);
    const [path, options] = fetch.mock.calls[1]!;
    expect(path).toBe('/api/sessions/session%2Fencoded/feedback');
    expect(options.method).toBe('PATCH');
    expect(options.headers['x-tresfort-account']).toBe('member-a');
    expect(options.headers['x-tresfort-write-protocol']).toBeUndefined();
    expect(JSON.parse(options.body)).toEqual(body);
  });

  it('rejects malformed or unrelated success receipts rather than clearing the pending request', async () => {
    const reviewed = session(), body = feedbackRequest({ ...feedbackDraft(reviewed), notes: 'Saved', fatigue: '3' })!;
    const good = { ...reviewed, notes: 'Saved', perceived_fatigue: 3 };
    for (const response of [null, {}, { ...good, id: 'sibling' }, { ...good, user_id: 'member-b' }, { ...good, attempt: 1 },
      { ...good, date: '2026-11-15' }, { ...good, slot: 0 }, { ...good, status: 'in_progress' },
      { ...good, notes: 'Another note' }, { ...good, perceived_fatigue: null }, { ...good, updated_at: undefined }, { ...good, updated_at: 19 }]) {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json(response)));
      await expect(saveSessionFeedback(reviewed, body, 'member-a')).rejects.toThrow('unreadable_feedback_receipt');
    }
  });

  it('surfaces account change and sign-out separately from feedback conflicts', async () => {
    const row = session(), body = feedbackRequest(feedbackDraft(row))!;
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(Response.json({ error: 'account_changed' }, { status: 409 }))
      .mockResolvedValueOnce(Response.json({}, { status: 401 })));
    await expect(saveSessionFeedback(row, body, 'member-a')).rejects.toBeInstanceOf(AccountChangedError);
    await expect(saveSessionFeedback(row, body, 'member-a')).rejects.toBeInstanceOf(SignedOutError);
  });
});

describe('workout feedback presentation', () => {
  it('offers an explicit add or edit with coach and group visibility, keeping external persistence untouched', () => {
    // React's server renderer warns about the browser lifetime guard; no effects run here.
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const storage = { getItem: vi.fn(), setItem: vi.fn(), removeItem: vi.fn() };
    vi.stubGlobal('localStorage', storage); vi.stubGlobal('sessionStorage', storage);
    const actions = { accountId: 'member-a', reload: vi.fn(), onSignedOut: vi.fn(), onFeedbackSaved: vi.fn() };
    const render = (row: SessionRow) => renderToStaticMarkup(createElement(WorkoutFeedback, { ...actions, session: row }));
    const empty = render(session());
    expect(empty).toContain('Add workout feedback');
    expect(empty).toContain('No workout note.');
    expect(empty).toContain('Fatigue not rated.');
    expect(empty).toContain('available to a connected coach');
    expect(empty).toContain('not shared with your groups');
    expect(empty).not.toContain('<textarea');
    const existing = render(session({ notes: 'A & B', perceived_fatigue: 7 }));
    expect(existing).toContain('Edit workout feedback');
    expect(existing).toContain('A &amp; B');
    expect(existing).toContain('Fatigue: 7 of 10');
    expect(render(session({ status: 'in_progress' }))).not.toContain('Add workout feedback');
    expect(render(session({ user_id: 'member-b' }))).not.toContain('Add workout feedback');
    expect(storage.getItem).not.toHaveBeenCalled();
    expect(storage.setItem).not.toHaveBeenCalled();
    expect(actions.reload).not.toHaveBeenCalled();
  });
});
