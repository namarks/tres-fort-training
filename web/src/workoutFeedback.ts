import type { SessionRow } from '../../src/types';
import { ApiError, type SessionFeedback, type SessionFeedbackRequest, type StateResponse } from './api';

export interface FeedbackDraft {
  reviewed: SessionRow;
  notes: string;
  fatigue: string;
}

export const feedbackOf = (session: SessionRow): SessionFeedback => ({ notes: session.notes, perceived_fatigue: session.perceived_fatigue });

export function canEditFeedback(session: SessionRow, accountId: string): boolean {
  return session.user_id === accountId && session.status === 'completed'
    && Number.isSafeInteger(session.attempt) && session.attempt >= 0;
}

export function feedbackDraft(session: SessionRow): FeedbackDraft {
  return { reviewed: { ...session }, notes: session.notes ?? '', fatigue: session.perceived_fatigue === null ? '' : String(session.perceived_fatigue) };
}

export function feedbackDraftProblem(draft: FeedbackDraft): string | null {
  return draft.fatigue !== '' && !/^(?:[1-9]|10)$/.test(draft.fatigue)
    ? 'Choose a fatigue rating from 1 to 10, or Not rated.' : null;
}

export function feedbackRequest(draft: FeedbackDraft): SessionFeedbackRequest | null {
  if (feedbackDraftProblem(draft)) return null;
  return {
    expected_attempt: draft.reviewed.attempt,
    expected_feedback: feedbackOf(draft.reviewed),
    notes: draft.notes.trim() || null,
    perceived_fatigue: draft.fatigue === '' ? null : Number(draft.fatigue),
  };
}

/** A newer attempt, a sibling, or another account can never become this draft's target. */
export function sameFeedbackTarget(reviewed: SessionRow, current: SessionRow): boolean {
  return reviewed.id === current.id && reviewed.user_id === current.user_id
    && reviewed.date === current.date && (reviewed.slot ?? 0) === (current.slot ?? 0)
    && reviewed.attempt === current.attempt && current.status === 'completed';
}

export type FeedbackFailure =
  | { kind: 'conflict'; current: SessionRow }
  | { kind: 'blocked'; message: string }
  | { kind: 'uncertain'; message: string };

export function feedbackFailure(error: unknown, reviewed: SessionRow): FeedbackFailure {
  if (error instanceof ApiError) {
    const body = error.body as { error?: string; current_session?: SessionRow } | null;
    const current = body?.current_session;
    if (error.status === 409 && body?.error === 'session_feedback_conflict' && current
        && sameFeedbackTarget(reviewed, current) && (typeof current.notes === 'string' || current.notes === null)
        && Number.isSafeInteger(current.updated_at) && current.updated_at >= 0
        && (current.perceived_fatigue === null || (Number.isSafeInteger(current.perceived_fatigue) && current.perceived_fatigue >= 0))) {
      return { kind: 'conflict', current };
    }
    if (error.status >= 400 && error.status < 500) {
      return { kind: 'blocked', message: error.status === 409 || error.status === 404
        ? 'This workout changed or is no longer completed. Close this draft and refresh Activity before reviewing it again.'
        : 'This feedback request was refused. Close this draft and refresh Activity before trying again.' };
    }
    if (error.status === 503 && body?.error === 'write_protocol_not_active') {
      return { kind: 'blocked', message: 'Feedback editing is not available yet. Your draft has not been saved.' };
    }
  }
  return { kind: 'uncertain', message: 'The save could not be confirmed. Your reviewed feedback is locked. Retry sends the same request.' };
}

/** Choosing mine only adopts the returned baseline; a separate Save approves the write. */
export function resolveFeedbackConflict(draft: FeedbackDraft, current: SessionRow, choice: 'saved' | 'mine'): FeedbackDraft | null {
  if (!sameFeedbackTarget(draft.reviewed, current)) return null;
  return choice === 'saved' ? feedbackDraft(current) : { ...draft, reviewed: current };
}

/** Publish an ACK only to the exact live row, without overwriting a newer generation or read. */
export function applyFeedbackReceipt(state: StateResponse, receipt: SessionRow, accountId: string, reviewed: SessionRow): StateResponse {
  if (receipt.user_id !== accountId || !sameFeedbackTarget(reviewed, receipt)) return state;
  const index = state.sessions.findIndex(session => session.id === receipt.id);
  const current = state.sessions[index];
  if (!current || !sameFeedbackTarget(current, receipt) || current.status !== 'completed'
      || receipt.updated_at < current.updated_at) return state;
  // Two server writes can share an epoch-ms cursor. A different feedback pair
  // already read at that cursor is newer than this editor's reviewed baseline;
  // a delayed ACK (or chosen conflict response) must not replace that pair.
  const sameFeedback = (a: SessionRow, b: SessionRow) => a.notes === b.notes && a.perceived_fatigue === b.perceived_fatigue;
  if (receipt.updated_at === current.updated_at
      && !sameFeedback(current, reviewed) && !sameFeedback(current, receipt)) return state;
  const sessions = [...state.sessions];
  sessions[index] = { ...current, notes: receipt.notes, perceived_fatigue: receipt.perceived_fatigue,
    updated_at: receipt.updated_at, write_protocol: receipt.write_protocol };
  return { ...state, sessions };
}
