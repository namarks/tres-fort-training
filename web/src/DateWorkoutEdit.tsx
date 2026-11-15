import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ApiError, copyWorkoutForDate, isVersionConflict, placeWorkoutForDate, SignedOutError, type StateResponse } from './api';
import { assignedDateCopy, dateEditProblem, newDateEdit, readDateEdit, retainDateEdit,
  type DateWorkoutSelection, type PendingDateEdit, type StoredDateEdit } from './dateEditState';
import { formatLongDate } from './model';

function stored(accountId: string): StoredDateEdit {
  try { return readDateEdit(sessionStorage, accountId); } catch { return 'unreadable'; }
}

/** Copying and assigning are distinct acknowledged writes. Neither is repeated
 * with a new identity after an ambiguous response or failed plan refresh. */
export function DateWorkoutEdit({ selection, state, accountId, today, busy, reload, onSignedOut, onEdit, onClose }: {
  selection: DateWorkoutSelection | null; state: StateResponse; accountId: string; today: string; busy: boolean;
  reload: () => Promise<void>; onSignedOut: (error?: unknown) => void; onEdit: (id: string) => void; onClose: () => void;
}) {
  const [pending, setPending] = useState<StoredDateEdit>(() => stored(accountId));
  const [working, setWorking] = useState(false), [message, setMessage] = useState<string | null>(null);
  const [refreshed, setRefreshed] = useState(false), [refused, setRefused] = useState(false);
  const inFlight = useRef(false), mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { if (!pending) { setMessage(null); setRefused(false); setRefreshed(false); } }, [selection]);
  const locked = busy || working;
  const request = pending && pending !== 'unreadable' ? pending : null;
  const selected = selection ? state.plan?.workouts.find(workout => workout.id === selection.workoutId) : null;
  const problem = selection ? dateEditProblem(selection, state, today) : null;
  const heading = useRef<HTMLHeadingElement>(null);
  // This panel appears above the button that opened it. Move keyboard and
  // reading position on entry, including restored recovery, but leave focus
  // alone during retries, refreshes and other updates to the same request.
  const focusEntry = pending === 'unreadable' ? 'unreadable'
    : request ? `request:${request.request.id}`
      : selection ? `scope:${selection.date}:${selection.workoutId}:${selection.primary}` : null;
  useLayoutEffect(() => {
    if (!focusEntry) return;
    heading.current?.focus({ preventScroll: true });
    heading.current?.scrollIntoView({ block: 'nearest' });
  }, [focusEntry]);

  function remember(next: PendingDateEdit | null, expectedId: string | null): boolean {
    let saved = false;
    try { saved = retainDateEdit(sessionStorage, accountId, expectedId, next); } catch { /* Fail before another write. */ }
    if (mounted.current) {
      if (saved) setPending(next);
      else { setPending(stored(accountId)); setMessage('The local request could not be saved. Enable session storage and refresh this page before continuing.'); }
    }
    return saved;
  }

  async function refresh() {
    if (inFlight.current) return;
    inFlight.current = true; setWorking(true);
    try { await reload(); if (mounted.current) { setRefreshed(true); setMessage(null); } }
    catch (error) {
      if (mounted.current) {
        if (error instanceof SignedOutError) onSignedOut(error);
        else setMessage('The plan could not be refreshed. Your saved copy and request are kept. Try again when connected.');
      }
    } finally { inFlight.current = false; if (mounted.current) setWorking(false); }
  }

  async function save() {
    if (inFlight.current || busy || refused || pending === 'unreadable') return;
    let current = request ?? (selection ? newDateEdit(selection, state, today) : null);
    if (!current || current.phase === 'complete') return;
    if (!remember(current, request?.request.id ?? null)) return;
    inFlight.current = true; setWorking(true); setMessage(null); setRefreshed(false);
    try {
      if (current.phase === 'copy') {
        await copyWorkoutForDate(current.request, accountId);
        current = { ...current, phase: 'place' };
        if (!remember(current, current.request.id)) return;
      }
      await placeWorkoutForDate(current.request, current.expectedAttempt, accountId);
      current = { ...current, phase: 'complete' };
      remember(current, current.request.id);
      if (!mounted.current) return;
      try { await reload(); if (mounted.current) setRefreshed(true); }
      catch (error) {
        if (mounted.current) {
          if (error instanceof SignedOutError) onSignedOut(error);
          else setMessage('Saved for this date. Refresh the plan to open its editor; no need to save again.');
        }
      }
    } catch (error) {
      if (!mounted.current) return;
      if (error instanceof SignedOutError) { onSignedOut(error); return; }
      const rejected = error instanceof ApiError && (error.status === 400 || error.status === 409 || error.status === 422);
      if (rejected) {
        setRefused(true);
        setMessage(current.phase === 'copy' && isVersionConflict(error)
          ? 'The plan changed before the copy was saved. Refresh and review this date again.'
          : current.phase === 'place'
            ? 'The copy is saved, but the date changed or its workout started. Refresh to review the date before continuing.'
            : 'The copy could not be saved with this request. Refresh and review this date again.');
      } else setMessage(current.phase === 'copy'
        ? 'The copy could not be confirmed. Retry uses the same request and cannot create a second copy.'
        : 'The copy is saved, but its placement could not be confirmed. Retry places the same copy on the same date.');
    } finally { inFlight.current = false; if (mounted.current) setWorking(false); }
  }

  if (!selection && !pending) return null;
  if (pending === 'unreadable') return <section className="panel" aria-label="Date edit recovery">
    <h3 ref={heading} tabIndex={-1}>Check your calendar</h3>
    <p>An earlier date-edit request could not be read. It may already have saved. Refresh and check the calendar before making another copy.</p>
    <button type="button" disabled={locked} onClick={refresh}>Refresh plan</button>
    {refreshed && <button type="button" className="ghost" disabled={locked} onClick={() => {
      try { sessionStorage.removeItem(`tresfort.pendingDateEdit.v1.${encodeURIComponent(accountId)}`); setPending(null); onClose(); }
      catch { setMessage('The local request could not be cleared. Enable session storage and try again.'); }
    }}>I checked the calendar — clear this request</button>}
    {message && <p role="status">{message}</p>}
  </section>;

  if (request) {
    const assigned = refreshed && assignedDateCopy(request, state);
    const copy = state.plan?.workouts.find(workout => workout.id === request.request.id && workout.one_time_date === request.request.one_time_date);
    const saved = request.phase === 'complete' || assigned;
    const open = () => { if (remember(null, request.request.id)) { onClose(); onEdit(request.request.id); } };
    return <section className="panel" aria-label="Date edit recovery">
      <h3 ref={heading} tabIndex={-1}>{saved ? 'Date-specific workout saved' : 'Finish your date-specific edit'}</h3>
      <p>{request.request.name} · {formatLongDate(request.request.one_time_date)}</p>
      {message && <p role="status">{message}</p>}
      {assigned ? <><p>This copy is on the selected date. The saved workout and other weeks are unchanged.</p>
        <button type="button" disabled={locked} onClick={open}>Edit this date’s workout</button></> : <>
        {saved && <p>The copy and date assignment were saved. Refresh to see the latest date before editing.</p>}
        {!saved && !refused && <button type="button" disabled={locked} onClick={save}>{working ? 'Saving…' : 'Retry same date edit'}</button>}
        <button type="button" className="ghost" disabled={locked} onClick={refresh}>Refresh plan</button>
        {refreshed && copy && <><p>The copy is saved but is not currently assigned to the main workout on this date. Review the calendar before editing it.</p>
          <button type="button" className="ghost" disabled={locked} onClick={open}>Open saved date copy</button></>}
        {refreshed && saved && !copy && <p>The saved copy is no longer in the current plan. Close this request and review the calendar again.</p>}
        {refreshed && (refused || saved) && !copy && <button type="button" className="ghost" disabled={locked}
          onClick={() => { if (remember(null, request.request.id)) { setRefused(false); setMessage(null); onClose(); } }}>Close and review the date again</button>}
      </>}
    </section>;
  }

  if (!selected || !selection) return <section className="panel"><h3 ref={heading} tabIndex={-1}>Review the calendar again</h3>
    <p>The workout is no longer available.</p>
    <button type="button" className="ghost" onClick={onClose}>Close</button></section>;
  return <section className="panel" aria-label={`Edit scope for ${selected.name}`}>
    <h3 ref={heading} tabIndex={-1}>Edit {selected.name}</h3>
    <p>{formatLongDate(selection.date)}</p>
    {selected.one_time_date ? <>
      <p>This workout belongs only to {formatLongDate(selected.one_time_date)}. Editing it leaves your reusable workout and other dates unchanged.</p>
      <button type="button" disabled={locked} onClick={() => { onClose(); onEdit(selected.id); }}>Edit this date’s workout</button>
    </> : <>
      <p><strong>This date only</strong> makes a separate copy with this date’s targets, then opens its editor. Your saved workout and other weeks stay unchanged.</p>
      {problem ? <p className="fine">{problem}</p>
        : <button type="button" disabled={locked} onClick={save}>This date only</button>}
      <p><strong>Saved workout</strong> changes the reusable workout everywhere it is scheduled. Completed workouts keep their recorded targets.</p>
      <button type="button" className="ghost" disabled={locked} onClick={() => { onClose(); onEdit(selected.id); }}>Edit saved workout</button>
    </>}
    <button type="button" className="ghost" disabled={locked} onClick={onClose}>Cancel</button>
    {message && <p role="status">{message}</p>}
  </section>;
}
