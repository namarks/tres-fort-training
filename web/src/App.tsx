import { useCallback, useEffect, useRef, useState } from 'react';
import {
  fetchExercises,
  fetchMe,
  fetchState,
  isVersionConflict,
  ApiError,
  AccountChangedError,
  planWrites,
  signOut,
  SignedOutError,
  type Me,
  type Reviewed,
  type StateResponse,
} from './api';
import { describeWriteError } from './editing';
import { WorkoutsPage, type Catalog, type Write } from './WorkoutEditor';
import { ActivityPage } from './ActivityPage';
import { BlockPage } from './BlockPage';
import { PlanPage } from './PlanPage';
import { PlanTabs } from './PlanTabs';
import { DiagnosticsPage } from './DiagnosticsPage';
import { MembersPage } from './MembersPage';
import { AnalysisPage, type AnalysisPageKey } from './AnalysisPage';
import { isMethodSection, type MethodSection } from './MethodologyPage';
import { prefersMiles } from './model';
import type { SessionRow } from '../../src/types';
import { editorDraftStore } from './editorDrafts';
import { applyFeedbackReceipt } from './workoutFeedback';
import { StateReadOrder } from './stateReadOrder';

type Load =
  | { kind: 'loading' }
  | { kind: 'signed_out' }
  | { kind: 'account_changed' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; me: Me; state: StateResponse };

const SIGNIN_PROBLEMS: Record<string, string> = {
  cancelled: 'Sign in was cancelled.',
  failed: 'Sign in didn’t work. Please try again.',
  unavailable: 'This account can’t be used right now.',
};

export function App() {
  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  const [loadAttempt, setLoadAttempt] = useState(0);
  const readOrder = useRef(new StateReadOrder());

  useEffect(() => {
    let live = true;
    let ticket = readOrder.current.startAccountLoad();
    fetchMe().then(async me => {
      if (!live) return;
      const scoped = readOrder.current.bindAccount(ticket, me.id);
      if (!scoped) return;
      ticket = scoped;
      const state = await fetchState(me.id);
      if (live) setLoad(current => readOrder.current.isCurrent(ticket) ? { kind: 'ready', me, state } : current);
    })
      .catch((error: unknown) => {
        if (!live || !readOrder.current.isCurrent(ticket)) return;
        readOrder.current.startAccountLoad();
        if (error instanceof AccountChangedError) setLoad({ kind: 'account_changed' });
        else if (error instanceof SignedOutError) setLoad({ kind: 'signed_out' });
        else setLoad({ kind: 'error', message: 'Your plan couldn’t be loaded. Refresh to try again.' });
      });
    return () => { live = false; readOrder.current.startAccountLoad(); };
  }, [loadAttempt]);

  // After a write, the page shows the plan as the API now has it.
  const accountId = load.kind === 'ready' ? load.me.id : null;
  const reload = useCallback(async () => {
    if (!accountId) throw new SignedOutError();
    const ticket = readOrder.current.startRead(accountId);
    if (!ticket) return;
    try {
      const state = await fetchState(accountId);
      setLoad((current) => readOrder.current.isCurrent(ticket) && current.kind === 'ready' && current.me.id === accountId
        ? { ...current, state } : current);
    } catch (error) {
      if (!readOrder.current.isCurrent(ticket)) return;
      if (error instanceof AccountChangedError) {
        readOrder.current.clearAccount(accountId);
        setLoad({ kind: 'account_changed' });
      }
      throw error;
    }
  }, [accountId]);

  const onFeedbackSaved = useCallback((session: SessionRow, reviewed: SessionRow) => {
    if (!accountId || session.user_id !== accountId || !readOrder.current.acknowledge(accountId)) return;
    setLoad(current => current.kind === 'ready' && current.me.id === accountId
      ? { ...current, state: applyFeedbackReceipt(current.state, session, accountId, reviewed) } : current);
  }, [accountId]);

  const onSignedOut = useCallback((error?: unknown) => {
    if (!accountId || !readOrder.current.clearAccount(accountId)) return;
    setLoad(current => error instanceof AccountChangedError || current.kind === 'account_changed'
      ? { kind: 'account_changed' } : { kind: 'signed_out' });
  }, [accountId]);

  if (load.kind === 'loading') return <main className="centered" aria-busy="true"><p className="muted">Loading your plan…</p></main>;
  if (load.kind === 'signed_out') return <SignIn />;
  if (load.kind === 'account_changed') return <main className="centered">
    <h1>Your account changed in another tab</h1>
    <p>Load the current account to continue. Any retained drafts stay with their original account.</p>
    <button type="button" onClick={() => {
      readOrder.current.startAccountLoad(); setLoad({ kind: 'loading' }); setLoadAttempt(value => value + 1);
    }}>Load current account</button>
  </main>;
  if (load.kind === 'error') return <main className="centered"><p role="alert">{load.message}</p></main>;
  return <Planner key={load.me.id} me={load.me} state={load.state} reload={reload} onFeedbackSaved={onFeedbackSaved} onSignedOut={onSignedOut} />;
}

type View =
  | { kind: 'plan'; scheduleWorkoutId?: string | null }
  | { kind: 'block' }
  | { kind: 'activity'; entryKey: string | null }
  | { kind: 'analysis'; page: AnalysisPageKey; section: MethodSection | null }
  | { kind: 'workouts'; workoutId: string | null }
  | { kind: 'diagnostics' }
  | { kind: 'members' };

/** `#plan` (and the older `#calendar`) opens the Plan page,
 * `#plan/schedule/<id>` with a workout to add to the usual week, `#block`
 * the training block (a tab of Plan), `#workouts` and `#workouts/<id>` the
 * workout editor (a tab of Plan), `#activity` and
 * `#activity/<entry key>` the Activity page, `#analysis` the Analysis
 * overview, `#analysis/event` its Event page and
 * `#analysis/methodology[/<section>]` its Methodology page, `#diagnostics`
 * the owner's Diagnostics page, `#members` the owner's Members page;
 * anything else the Plan page. */
export function viewFromHash(hash: string): View {
  const schedule = /^#(?:plan|calendar)\/schedule\/([^/]+)$/.exec(hash);
  if (schedule) return { kind: 'plan', scheduleWorkoutId: safeDecode(schedule[1]!) };
  if (hash === '#diagnostics') return { kind: 'diagnostics' };
  if (hash === '#members') return { kind: 'members' };
  if (hash === '#block') return { kind: 'block' };
  if (hash === '#analysis') return { kind: 'analysis', page: 'overview', section: null };
  if (hash === '#analysis/strength') return { kind: 'analysis', page: 'strength', section: null };
  if (hash === '#analysis/event') return { kind: 'analysis', page: 'event', section: null };
  const method = /^#analysis\/methodology(?:\/([^/]+))?$/.exec(hash);
  if (method) return { kind: 'analysis', page: 'methodology', section: isMethodSection(method[1] ?? null) ? method[1] as MethodSection : null };
  const activity = /^#activity(?:\/(.+))?$/.exec(hash);
  if (activity) return { kind: 'activity', entryKey: activity[1] ? safeDecode(activity[1]) ?? activity[1] : null };
  const match = /^#workouts(?:\/(.+))?$/.exec(hash);
  if (!match) return { kind: 'plan' };
  return { kind: 'workouts', workoutId: match[1] ? safeDecode(match[1]) : null };
}

export function hashFor(view: View): string {
  if (view.kind === 'plan') {
    return view.scheduleWorkoutId ? `#plan/schedule/${encodeURIComponent(view.scheduleWorkoutId)}` : '#plan';
  }
  if (view.kind === 'block') return '#block';
  if (view.kind === 'diagnostics') return '#diagnostics';
  if (view.kind === 'members') return '#members';
  if (view.kind === 'analysis') {
    if (view.page === 'overview') return '#analysis';
    if (view.page === 'strength') return '#analysis/strength';
    if (view.page === 'event') return '#analysis/event';
    return view.section ? `#analysis/methodology/${view.section}` : '#analysis/methodology';
  }
  if (view.kind === 'activity') return view.entryKey ? `#activity/${encodeURIComponent(view.entryKey)}` : '#activity';
  return view.workoutId ? `#workouts/${encodeURIComponent(view.workoutId)}` : '#workouts';
}

function safeDecode(text: string): string | null {
  try { return decodeURIComponent(text); } catch { return null; }
}

type Notice = { kind: 'conflict' | 'error'; text: string; refresh?: boolean };

const CONFLICT_TEXT = 'Your plan changed in the app or with your coach. Your target drafts, edits to existing groups, and block drafts are kept. Review the latest saved values before saving again.';

function SignIn() {
  const problem = new URLSearchParams(window.location.search).get('signin');
  const opensBlock = window.location.hash === '#block';
  const signInHref = opensBlock ? `/auth/apple/start?return=${encodeURIComponent('/#block')}` : '/auth/apple/start';
  return (
    <main className="signin">
      <div className="signin-card">
        <img src="/assets/app-icon.png" alt="" width={72} height={72} />
        <h1 className="wordmark">Très Fort</h1>
        <p className="lede">Everything you train. One plan.</p>
        <p className="muted">Build your week with runs, lifts and timed routines. Schedule core separately from a run, with its own days and time.</p>
        <p className="muted">New here? Sign in to create your account. Already use Très Fort? Use the same Apple account to open your plan.</p>
        {opensBlock && <p className="muted">Your training block will open after sign-in. You can start one there if you do not have one yet.</p>}
        {problem && SIGNIN_PROBLEMS[problem] && <p role="alert" className="problem">{SIGNIN_PROBLEMS[problem]}</p>}
        <a className="apple-button" href={signInHref}>
          <AppleLogo /> Sign in with Apple
        </a>
        <p className="fine">Follow workouts, use work and rest timers, and record runs in the iPhone app.</p>
      </div>
    </main>
  );
}

export function AppleLogo() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" width="18" height="18" focusable="false">
      <path fill="currentColor" d="M16.365 1.43c0 1.14-.493 2.27-1.177 3.08-.744.9-1.99 1.57-2.987 1.57-.12 0-.23-.02-.3-.03-.01-.06-.04-.22-.04-.39 0-1.15.572-2.27 1.206-2.98.804-.94 2.142-1.64 3.248-1.68.03.13.05.28.05.43zm4.565 15.71c-.03.07-.463 1.58-1.518 3.12-.945 1.34-1.94 2.71-3.43 2.71-1.517 0-1.9-.88-3.63-.88-1.698 0-2.302.91-3.67.91-1.377 0-2.332-1.26-3.428-2.8-1.287-1.82-2.323-4.63-2.323-7.28 0-4.28 2.797-6.55 5.552-6.55 1.448 0 2.675.95 3.6.95.865 0 2.222-1.01 3.902-1.01.613 0 2.886.06 4.374 2.19-.13.09-2.383 1.37-2.383 4.19 0 3.26 2.854 4.42 2.955 4.45z" />
    </svg>
  );
}

function Planner({ me, state, reload, onSignedOut, onFeedbackSaved }: {
  me: Me;
  state: StateResponse;
  reload: () => Promise<void>;
  onSignedOut: (error?: unknown) => void;
  onFeedbackSaved: (session: SessionRow, reviewed: SessionRow) => void;
}) {
  const [view, setView] = useState<View>(() => viewFromHash(window.location.hash));
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const isOwner = me.coach?.is_owner === true;
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (editorDraftStore.hasDrafts(me.id)) { event.preventDefault(); event.returnValue = ''; }
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [me.id]);

  useEffect(() => {
    const onHash = () => setView(viewFromHash(window.location.hash));
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  // The exercise list names exercises for editing and on the Activity page,
  // so it loads with either view.
  useEffect(() => {
    if (view.kind === 'plan' || view.kind === 'block' || (view.kind === 'analysis' && view.page !== 'strength') || view.kind === 'diagnostics' || view.kind === 'members' || catalog) return;
    setCatalog({ kind: 'loading' });
    fetchExercises()
      .then((exercises) => setCatalog({ kind: 'ready', exercises }))
      .catch((error: unknown) => {
        if (error instanceof SignedOutError) onSignedOut(error);
        else setCatalog({ kind: 'error' });
      });
  }, [view, catalog, onSignedOut]);

  function go(next: View) {
    window.location.hash = hashFor(next);
    setView(next);
  }

  const write: Write = async (action) => {
    const plan = state.plan;
    setBusy(true);
    setNotice(null);
    try {
      let at: Reviewed;
      if (plan) {
        at = { planId: plan.id, version: plan.version, accountId: me.id };
      } else {
        // A new account has no plan yet; its first workout starts one.
        const started = await planWrites.startPlan();
        at = { planId: started.plan.id, version: started.plan.version, accountId: me.id };
      }
      await action(at);
    } catch (error) {
      if (error instanceof SignedOutError) {
        onSignedOut(error);
      } else if (isVersionConflict(error)) {
        setNotice({ kind: 'conflict', text: CONFLICT_TEXT });
        await reload().catch(() => undefined);
      } else if (error instanceof ApiError && error.status === 409) {
        // A date or workout changed elsewhere (a session started, another
        // device chose a different workout): show the latest before retrying.
        setNotice({ kind: 'conflict', text: describeWriteError(error.body) });
        await reload().catch(() => undefined);
      } else {
        setNotice({ kind: 'error', text: error instanceof ApiError ? describeWriteError(error.body) : 'That change didn’t save. Check your connection and try again.' });
      }
      setBusy(false);
      return false;
    }
    try {
      await reload();
    } catch {
      setNotice({ kind: 'error', text: 'Saved. Refresh your plan to see the change.', refresh: true });
    }
    setBusy(false);
    return true;
  };

  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand"><img src="/assets/app-icon.png" alt="" width={32} height={32} /><span className="wordmark">Très Fort</span></div>
        <nav className="views" aria-label="Views">
          <a href="#plan" aria-current={view.kind === 'plan' || view.kind === 'block' || view.kind === 'workouts' ? 'page' : undefined}>Plan</a>
          <a href="#activity" aria-current={view.kind === 'activity' ? 'page' : undefined}>Activity</a>
          <a href="#analysis" aria-current={view.kind === 'analysis' ? 'page' : undefined}>Analysis</a>
          {isOwner && <a href="#members" aria-current={view.kind === 'members' ? 'page' : undefined}>Members</a>}
          {isOwner && <a href="#diagnostics" aria-current={view.kind === 'diagnostics' ? 'page' : undefined}>Diagnostics</a>}
        </nav>
        <div className="account">
          <span className="muted">{me.display_name ?? me.email ?? 'Signed in'}</span>
          <button type="button" className="ghost" onClick={async () => {
            try { await signOut(); onSignedOut(); }
            catch { setNotice({ kind: 'error', text: 'Couldn’t sign out. Please try again.' }); }
          }}>Sign out</button>
        </div>
      </header>
      {notice && (
        <div className={`notice ${notice.kind}`} role="alert">
          <p>{notice.text}</p>
          {notice.refresh && <button type="button" className="ghost small" disabled={busy} onClick={async () => {
            setBusy(true);
            try { await reload(); setNotice(null); }
            catch (error) {
              if (error instanceof SignedOutError) onSignedOut(error);
              else setNotice({ kind: 'error', text: 'Your saved change is safe, but the plan still couldn’t be refreshed. Try again when you’re connected.', refresh: true });
            }
            finally { setBusy(false); }
          }}>Refresh plan</button>}
          <button type="button" className="ghost small" onClick={() => setNotice(null)}>Dismiss</button>
        </div>
      )}
      {view.kind === 'diagnostics' && isOwner ? (
        <DiagnosticsPage onSignedOut={onSignedOut} />
      ) : view.kind === 'members' && isOwner ? (
        <MembersPage onSignedOut={onSignedOut} />
      ) : view.kind === 'workouts' ? (
        <><PlanTabs current="workouts" /><WorkoutsPage
          workouts={state.plan?.workouts ?? []}
          version={state.plan?.version ?? 0}
          selectedId={view.workoutId}
          onSelect={(workoutId) => go({ kind: 'workouts', workoutId })}
          onSchedule={(scheduleWorkoutId) => go({ kind: 'plan', scheduleWorkoutId })}
          schedule={state.plan?.schedule}
          accountId={me.id}
          planId={state.plan?.id ?? null}
          reload={reload}
          onSignedOut={onSignedOut}
          write={write}
          busy={busy}
          catalog={catalog ?? { kind: 'loading' }}
          miles={prefersMiles()}
        /></>
      ) : view.kind === 'block' ? (
        <><PlanTabs current="block" /><BlockPage key={`${me.id}:${state.plan?.id ?? 'none'}`} state={state} write={write} busy={busy}
          accountId={me.id} onEditWorkout={(workoutId) => go({ kind: 'workouts', workoutId })} /></>
      ) : view.kind === 'activity' ? (
        <ActivityPage key={view.entryKey ?? ''} state={state} catalog={catalog?.kind === 'ready' ? catalog.exercises : null} initialKey={view.entryKey}
          accountId={me.id} reload={reload} onSignedOut={onSignedOut} onFeedbackSaved={onFeedbackSaved} />
      ) : view.kind === 'analysis' ? (
        <AnalysisPage state={state} page={view.page} section={view.section} write={write} busy={busy}
          catalog={catalog ?? { kind: 'loading' }} retryCatalog={() => setCatalog(null)} />
      ) : (
        <><PlanTabs current="schedule" /><PlanPage key={`${me.id}:${state.plan?.id ?? 'none'}`} state={state} write={write} busy={busy} accountId={me.id}
          reload={reload} onSignedOut={onSignedOut}
          scheduleWorkoutId={view.kind === 'plan' ? view.scheduleWorkoutId : null}
          onScheduled={() => go({ kind: 'plan' })}
          onEditWorkout={(workoutId) => go({ kind: 'workouts', workoutId })} /></>
      )}
    </div>
  );
}
