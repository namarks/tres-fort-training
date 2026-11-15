import type { SessionRow } from '../../src/types';

export const workoutRecordHref = (sessionId: string) => `#activity/${encodeURIComponent(`workout:${sessionId}`)}`;

/** An explicit record link must never fall back to a different workout. */
export function selectedRecord<T extends { key: string }>(entries: T[], key: string | null): T | null {
  return key === null ? entries[0] ?? null : entries.find(entry => entry.key === key) ?? null;
}

const validIdentifier = (id: string) => /^[A-Za-z0-9_-]{1,128}$/.test(id);

export function workoutCorrectionHref(accountId: string, session: SessionRow, setId?: string): string | null {
  const attempt = session.attempt ?? 0;
  if (session.user_id !== accountId || session.status !== 'completed' || !validIdentifier(accountId)
      || !validIdentifier(session.id) || (setId !== undefined && !validIdentifier(setId))
      || !Number.isSafeInteger(attempt) || attempt < 0) return null;
  const query = new URLSearchParams({ account: accountId, session: session.id, attempt: String(attempt) });
  if (setId !== undefined) query.set('set', setId);
  return `tresfort://workout-record?${query}`;
}
