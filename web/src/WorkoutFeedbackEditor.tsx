import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { SessionRow } from '../../src/types';
import { saveSessionFeedback, SignedOutError, type SessionFeedbackRequest } from './api';
import { canEditFeedback, feedbackDraft, feedbackDraftProblem, feedbackFailure, feedbackRequest,
  resolveFeedbackConflict, sameFeedbackTarget, type FeedbackDraft } from './workoutFeedback';

export interface WorkoutFeedbackActions {
  accountId: string;
  reload: () => Promise<void>;
  onSignedOut: (error?: unknown) => void;
  onFeedbackSaved: (session: SessionRow, reviewed: SessionRow) => void;
}

/** The keyed record owns this memory-only draft. Leaving it discards unsaved text. */
export function WorkoutFeedback({ session, accountId, reload, onSignedOut, onFeedbackSaved }: WorkoutFeedbackActions & { session: SessionRow }) {
  return <FeedbackEditor key={`${accountId}:${session.id}`} session={session} accountId={accountId}
    reload={reload} onSignedOut={onSignedOut} onFeedbackSaved={onFeedbackSaved} />;
}

function FeedbackEditor({ session, accountId, reload, onSignedOut, onFeedbackSaved }: WorkoutFeedbackActions & { session: SessionRow }) {
  const [draft, setDraft] = useState<FeedbackDraft | null>(null);
  const [pending, setPending] = useState<SessionFeedbackRequest | null>(null);
  const [conflict, setConflict] = useState<SessionRow | null>(null);
  const [blocked, setBlocked] = useState(false), [working, setWorking] = useState(false);
  const [message, setMessage] = useState<string | null>(null), [needsRefresh, setNeedsRefresh] = useState(false);
  const live = useRef(true), inFlight = useRef(false);
  useLayoutEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  const identity = `${accountId}:${session.id}`;
  const latest = useRef({ identity, session });
  latest.current = { identity, session };
  const current = () => live.current && latest.current.identity === identity;
  const stale = draft !== null && !sameFeedbackTarget(draft.reviewed, session);
  const locked = working || pending !== null || conflict !== null || blocked || stale;
  const problem = draft ? feedbackDraftProblem(draft) : null;

  // Warn before a browser navigation loses unapproved feedback; never persist it.
  useEffect(() => {
    if (!draft) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [draft]);

  async function refresh() {
    if (inFlight.current) return;
    inFlight.current = true; setWorking(true);
    try { await reload(); if (current()) { setNeedsRefresh(false); setMessage('Activity refreshed.'); } }
    catch (error) {
      if (!current()) return;
      if (error instanceof SignedOutError) onSignedOut(error);
      else setMessage('Activity could not be refreshed. Try again when connected.');
    } finally { inFlight.current = false; if (current()) setWorking(false); }
  }

  async function save() {
    if (!draft || inFlight.current || conflict || blocked || stale || !canEditFeedback(session, accountId)) return;
    const body = pending ?? feedbackRequest(draft);
    if (!body) return;
    inFlight.current = true; setWorking(true); setPending(body); setMessage(null);
    try {
      const receipt = await saveSessionFeedback(draft.reviewed, body, accountId);
      if (!current() || !sameFeedbackTarget(draft.reviewed, latest.current.session)) return;
      onFeedbackSaved(receipt, draft.reviewed);
      setDraft(null); setPending(null); setMessage('Feedback saved.');
      // ACK is final before refresh starts. A failed read must not offer another save.
      try { await reload(); }
      catch (error) {
        if (!current()) return;
        if (error instanceof SignedOutError) onSignedOut(error);
        else { setNeedsRefresh(true); setMessage('Feedback saved. The latest activity could not be refreshed; your saved feedback is shown.'); }
      }
    } catch (error) {
      if (!current()) return;
      if (error instanceof SignedOutError) { onSignedOut(error); return; }
      const failure = feedbackFailure(error, draft.reviewed);
      if (failure.kind === 'conflict') { setConflict(failure.current); setPending(null); }
      else { setMessage(failure.message); if (failure.kind === 'blocked') { setBlocked(true); setPending(null); } }
    } finally { inFlight.current = false; if (current()) setWorking(false); }
  }

  function choose(choice: 'saved' | 'mine') {
    if (!draft || !conflict) return;
    const next = resolveFeedbackConflict(draft, conflict, choice);
    if (!next) return;
    setConflict(null); setPending(null);
    if (choice === 'saved') { onFeedbackSaved(conflict, draft.reviewed); setDraft(null); setMessage('Using saved feedback.'); }
    else { setDraft(next); setMessage('Your feedback is kept. Review it, then save to replace the saved feedback.'); }
  }

  const privacy = <p className="fine">Saved feedback is available to a connected coach. It is not shared with your groups.</p>;
  return <section className="workout-feedback" aria-label="Workout feedback">
    <h3>Workout feedback</h3>
    {!draft ? <>
      <FeedbackValues notes={session.notes} fatigue={session.perceived_fatigue} />
      {canEditFeedback(session, accountId) && <button type="button" className="ghost" disabled={working || needsRefresh} onClick={() => {
        setDraft(feedbackDraft(session)); setMessage(null); setNeedsRefresh(false); setBlocked(false);
      }}>{session.notes !== null || session.perceived_fatigue !== null ? 'Edit workout feedback' : 'Add workout feedback'}</button>}
      {privacy}
    </> : <form onSubmit={event => { event.preventDefault(); void save(); }}>
      <p className="fine">Both fields are optional. Drafts stay on this page until you save.</p>
      <label className="field">Workout note (optional)<textarea aria-label="Workout note (optional)" autoFocus rows={4} value={draft.notes} disabled={locked}
        onChange={event => setDraft({ ...draft, notes: event.target.value })} /></label>
      <label className="field">Fatigue (optional)<select aria-label="Fatigue (optional)" value={draft.fatigue} disabled={locked}
        onChange={event => setDraft({ ...draft, fatigue: event.target.value })}>
        <option value="">Not rated</option>
        {problem && <option value={draft.fatigue} disabled>Recorded rating: {draft.fatigue}</option>}
        {Array.from({ length: 10 }, (_, i) => <option key={i + 1} value={String(i + 1)}>{i + 1}{i === 0 ? ' — least fatigued' : i === 9 ? ' — most fatigued' : ''}</option>)}
      </select></label>
      {privacy}
      {problem && <p className="problem" role="alert">{problem}</p>}
      {conflict && <div className="panel" role="group" aria-label="Workout feedback conflict">
        <p>This workout’s feedback changed. Choose which version to use before saving again.</p>
        <h4>Saved feedback</h4><FeedbackValues notes={conflict.notes} fatigue={conflict.perceived_fatigue} />
        <h4>Your feedback</h4><FeedbackValues notes={draft.notes.trim() || null} fatigue={draft.fatigue === '' ? null : Number(draft.fatigue)} />
        <div className="form-actions">
          <button type="button" className="ghost" onClick={() => choose('saved')}>Use saved feedback</button>
          <button type="button" className="ghost" onClick={() => choose('mine')}>Use my feedback</button>
        </div>
      </div>}
      {stale && <p role="alert">This workout changed or is no longer completed. Close this draft and refresh Activity before reviewing it again.</p>}
      <div className="form-actions">
        {!blocked && !stale && !conflict && <button type="submit" disabled={working || problem !== null}>{working ? 'Saving…' : pending ? 'Retry same save' : 'Save feedback'}</button>}
        <button type="button" className="ghost" disabled={working || pending !== null} onClick={() => {
          setDraft(null); setPending(null); setConflict(null); setBlocked(false);
          setMessage(null);
          setNeedsRefresh(blocked || stale);
        }}>{blocked || stale ? 'Close draft' : 'Cancel'}</button>
      </div>
    </form>}
    {message && <p role="status">{message}</p>}
    {needsRefresh && <button type="button" className="ghost" disabled={working} onClick={refresh}>Refresh Activity</button>}
  </section>;
}

function FeedbackValues({ notes, fatigue }: { notes: string | null; fatigue: number | null }) {
  return <><p className={notes ? 'note' : 'muted'}>{notes || 'No workout note.'}</p>
    <p className="muted">{fatigue === null ? 'Fatigue not rated.' : `Fatigue: ${fatigue} of 10`}</p></>;
}
