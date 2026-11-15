import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
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
  type StateActivity,
  type StateResponse,
} from './api';
import { describeWriteError } from './editing';
import { WorkoutsPage, type Catalog, type Write } from './WorkoutEditor';
import { ActivityPage } from './ActivityPage';
import { BlockPage } from './BlockPage';
import { DiagnosticsPage } from './DiagnosticsPage';
import { MembersPage } from './MembersPage';
import { AnalysisPage, type AnalysisPageKey } from './AnalysisPage';
import { isMethodSection, type MethodSection } from './MethodologyPage';
import { AwayDates, DateActions, RoutineEditor } from './CalendarEditing';
import { RouteMap } from './RouteMapView';
import { ActivityCharts } from './ActivityChartsView';
import { chartableActivities } from './activityCharts';
import { routableActivityIds } from './routeMap';
import {
  activityLoads,
  activitySports,
  itemTitle,
  itemType,
  calendarInputs,
  calendarStatusLabel,
  describeGroup,
  describeRunSteps,
  describeSlot,
  finishedRunOf,
  formatClock,
  formatLongDate,
  formatMonth,
  formatScheduleTime,
  itemLoad,
  LOAD_METHOD_LABELS,
  localToday,
  monthOf,
  monthWeeks,
  plannedExtraWorkouts,
  plannedWorkoutOn,
  prefersMiles,
  projectRange,
  scheduleTimeOn,
  shiftMonth,
  slotBlocks,
  tripOn,
  WEEKDAY_LABELS,
  type CalendarCell,
  type ShownLoad,
  type Slot,
  type Workout,
} from './model';
import { WEEKDAYS, type SessionRow, type TrainingProgram, type WeeklySchedule } from '../../src/types';
import { PhoneHandoff } from './PhoneHandoff';
import { PlanNextSteps } from './PlanNextSteps';
import { DateWorkoutEdit } from './DateWorkoutEdit';
import type { DateWorkoutSelection } from './dateEditState';
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
  | { kind: 'calendar'; scheduleWorkoutId?: string | null }
  | { kind: 'block' }
  | { kind: 'activity'; entryKey: string | null }
  | { kind: 'analysis'; page: AnalysisPageKey; section: MethodSection | null }
  | { kind: 'workouts'; workoutId: string | null }
  | { kind: 'diagnostics' }
  | { kind: 'members' };

/** `#block` opens the block designer, `#workouts` and `#workouts/<id>` the
 * workout editor, `#activity` and
 * `#activity/<entry key>` the Activity page, `#analysis` the Analysis
 * overview, `#analysis/event` its Event page and
 * `#analysis/methodology[/<section>]` its Methodology page, `#diagnostics`
 * the owner's Diagnostics page, `#members` the owner's Members page;
 * anything else the calendar. */
export function viewFromHash(hash: string): View {
  const schedule = /^#calendar\/schedule\/([^/]+)$/.exec(hash);
  if (schedule) return { kind: 'calendar', scheduleWorkoutId: safeDecode(schedule[1]!) };
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
  if (!match) return { kind: 'calendar' };
  return { kind: 'workouts', workoutId: match[1] ? safeDecode(match[1]) : null };
}

export function hashFor(view: View): string {
  if (view.kind === 'calendar') return view.scheduleWorkoutId
    ? `#calendar/schedule/${encodeURIComponent(view.scheduleWorkoutId)}` : '#calendar';
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
        {opensBlock && <p className="muted">The block editor will open after sign-in. Start a block if you do not have one yet. Choose a workout and exercise under Targets by week to change one week’s sets, reps, load or time.</p>}
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
    if (view.kind === 'calendar' || view.kind === 'block' || (view.kind === 'analysis' && view.page !== 'strength') || view.kind === 'diagnostics' || view.kind === 'members' || catalog) return;
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
          <a href="#calendar" aria-current={view.kind === 'calendar' ? 'page' : undefined}>Calendar</a>
          <a href="#block" aria-current={view.kind === 'block' ? 'page' : undefined}>Block</a>
          <a href="#workouts" aria-current={view.kind === 'workouts' ? 'page' : undefined}>Workouts</a>
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
        <WorkoutsPage
          workouts={state.plan?.workouts ?? []}
          version={state.plan?.version ?? 0}
          selectedId={view.workoutId}
          onSelect={(workoutId) => go({ kind: 'workouts', workoutId })}
          onSchedule={(scheduleWorkoutId) => go({ kind: 'calendar', scheduleWorkoutId })}
          accountId={me.id}
          planId={state.plan?.id ?? null}
          reload={reload}
          onSignedOut={onSignedOut}
          write={write}
          busy={busy}
          catalog={catalog ?? { kind: 'loading' }}
          miles={prefersMiles()}
        />
      ) : view.kind === 'activity' ? (
        <ActivityPage key={view.entryKey ?? ''} state={state} catalog={catalog?.kind === 'ready' ? catalog.exercises : null} initialKey={view.entryKey}
          accountId={me.id} reload={reload} onSignedOut={onSignedOut} onFeedbackSaved={onFeedbackSaved} />
      ) : view.kind === 'block' ? (
        <BlockPage key={`${me.id}:${state.plan?.id ?? 'none'}`} accountId={me.id} state={state} write={write} busy={busy} today={localToday()} />
      ) : view.kind === 'analysis' ? (
        <AnalysisPage state={state} page={view.page} section={view.section} write={write} busy={busy}
          catalog={catalog ?? { kind: 'loading' }} retryCatalog={() => setCatalog(null)} />
      ) : (
        <CalendarView state={state} write={write} busy={busy} accountId={me.id} reload={reload} onSignedOut={onSignedOut}
          scheduleWorkoutId={view.kind === 'calendar' ? view.scheduleWorkoutId : null}
          onScheduled={() => go({ kind: 'calendar' })}
          onEditWorkout={(workoutId) => go({ kind: 'workouts', workoutId })} />
      )}
    </div>
  );
}

export function CalendarView({ state, write, busy, onEditWorkout, scheduleWorkoutId, onScheduled, accountId, reload, onSignedOut }: {
  state: StateResponse;
  write: Write;
  busy: boolean;
  onEditWorkout: (id: string | null) => void;
  scheduleWorkoutId?: string | null;
  onScheduled?: () => void;
  accountId?: string;
  reload?: () => Promise<void>;
  onSignedOut?: (error?: unknown) => void;
}) {
  const today = useMemo(() => localToday(), []);
  const [month, setMonth] = useState(monthOf(today));
  const [selected, setSelected] = useState(today);
  const [editSelection, setEditSelection] = useState<DateWorkoutSelection | null>(null);
  const miles = useMemo(() => prefersMiles(), []);
  const plan = state.plan;
  const inputs = useMemo(() => calendarInputs(state), [state]);
  const weeks = useMemo(() => monthWeeks(month), [month]);
  const cells = useMemo(() => {
    if (!inputs) return new Map<string, CalendarCell>();
    return projectRange(inputs, weeks[0]![0]!, weeks[weeks.length - 1]![6]!, today);
  }, [inputs, weeks, today]);
  const cellFor = useCallback(
    (date: string) => cells.get(date) ?? (inputs ? projectRange(inputs, date, date, today).get(date) : undefined),
    [cells, inputs, today],
  );
  const selectedCell = useMemo(() => cellFor(selected), [cellFor, selected]);
  const workouts = useMemo(() => new Map((plan?.workouts ?? []).map((w) => [w.id, w])), [plan]);
  const loads = useMemo(() => activityLoads(state), [state]);
  const sports = useMemo(() => activitySports(state), [state]);
  const routable = useMemo(() => routableActivityIds(state), [state]);
  const chartable = useMemo(() => chartableActivities(state), [state]);
  useEffect(() => {
    if (scheduleWorkoutId) document.getElementById('routine-title')?.scrollIntoView({ block: 'start' });
  }, [scheduleWorkoutId]);
  const dateEditPanel = accountId && reload && onSignedOut ? <DateWorkoutEdit key={accountId} selection={editSelection} state={state}
    accountId={accountId} today={today} busy={busy} reload={reload} onSignedOut={onSignedOut}
    onEdit={onEditWorkout} onClose={() => setEditSelection(null)} /> : null;

  return (
    <>
      {!plan ? (
        <main className="centered">
          <h1>Plan your week</h1>
          {dateEditPanel}
          <p className="muted">Create a run, a timed routine or your own workout, then choose its days and times. You can put core alongside a run and complete each separately in the iPhone app.</p>
          <button type="button" onClick={() => onEditWorkout(null)}>Create your first workout</button>
        </main>
      ) : (
        <main className="planner">
          <section className="calendar" aria-labelledby="month-title">
            <div className="calendar-head">
              <h1 id="month-title">{formatMonth(month)}</h1>
              <div className="month-nav">
                <button type="button" onClick={() => setMonth(shiftMonth(month, -1))} aria-label="Previous month">‹</button>
                <button type="button" onClick={() => { setMonth(monthOf(today)); setSelected(today); }}>Today</button>
                <button type="button" onClick={() => setMonth(shiftMonth(month, 1))} aria-label="Next month">›</button>
              </div>
            </div>
            <div className="grid" role="grid" aria-labelledby="month-title">
              <div className="grid-row weekdays" role="row">
                {WEEKDAYS.map((day) => <div key={day} role="columnheader">{WEEKDAY_LABELS[day].slice(0, 3)}</div>)}
              </div>
              {weeks.map((week) => (
                <div className="grid-row" role="row" key={week[0]}>
                  {week.map((date) => (
                    <DayCell
                      key={date}
                      date={date}
                      cell={cells.get(date)}
                      workout={workoutFor(cells.get(date), workouts)}
                      workouts={workouts}
                      schedule={plan.schedule}
                      activities={state.external_activities}
                      inMonth={monthOf(date) === month}
                      isToday={date === today}
                      isSelected={date === selected}
                      sports={sports}
                      onSelect={() => setSelected(date)}
                    />
                  ))}
                </div>
              ))}
            </div>
            {inputs?.program && <p className="panel muted">Your training block sets the workouts for its dates.
              {' '}The repeating week below applies outside that block. <a href="#block">Edit your block</a></p>}
            <RoutineEditor schedule={plan.schedule} workouts={plan.workouts} write={write} busy={busy}
              reviewed={{ planId: plan.id, version: plan.version }} selectedWorkoutId={scheduleWorkoutId}
              onScheduled={onScheduled} onCancelSelection={onScheduled} />
            <button type="button" className="ghost" disabled={busy} onClick={() => onEditWorkout(null)}>Create another workout</button>
            <PhoneHandoff state={state} today={today} />
            <PlanNextSteps state={state} />
            <AwayDates trips={plan.trips ?? []} today={today} version={plan.version} write={write} busy={busy} />
          </section>

          <DayDetail
            date={selected}
            cell={selectedCell}
            workout={workoutFor(selectedCell, workouts)}
            workouts={workouts}
            schedule={plan.schedule}
            program={inputs?.program}
            trip={tripOn(selected, plan.trips ?? [])}
            miles={miles}
            loads={loads}
            sports={sports}
            routable={routable}
            chartable={chartable}
            onEditWorkout={onEditWorkout}
            onEditDateWorkout={accountId ? (workoutId, primary) => setEditSelection({ date: selected, workoutId, primary }) : undefined}
            editPanel={dateEditPanel}
            actions={(
              <DateActions date={selected} today={today} cell={selectedCell} workout={workoutFor(selectedCell, workouts)}
                state={state} cellFor={cellFor} write={write} busy={busy} />
            )}
          />
        </main>
      )}
    </>
  );
}

function workoutFor(cell: CalendarCell | undefined, workouts: Map<string, Workout>): Workout | undefined {
  return cell?.workout_id ? workouts.get(cell.workout_id) : undefined;
}

/** A recurring reminder is planning information, never a historical start time. */
function plannedReminderTime(schedule: WeeklySchedule, workoutId: string | null, date: string,
  status: string | undefined): string | null {
  return workoutId && (status === 'projected' || status === 'planned')
    ? scheduleTimeOn(schedule, workoutId, date) : null;
}

function DayCell(props: {
  date: string;
  cell: CalendarCell | undefined;
  workout: Workout | undefined;
  workouts: Map<string, Workout>;
  schedule: WeeklySchedule;
  inMonth: boolean;
  isToday: boolean;
  isSelected: boolean;
  activities: StateActivity[];
  sports: Map<string, string>;
  onSelect: () => void;
}) {
  const { date, cell, workout, workouts, schedule, inMonth, isToday, isSelected, activities, sports, onSelect } = props;
  const status = cell?.status;
  // A finished run workout is its run: show the run once, not both under one name.
  const showWorkout = workout !== undefined && status !== 'rest' && !finishedRunOf(cell, workout, activities);
  const classes = ['day', inMonth ? '' : 'outside', isToday ? 'today' : '', isSelected ? 'selected' : '', status ? `status-${status}` : '']
    .filter(Boolean).join(' ');
  const additional = cell?.sessions ?? [];
  const extras = plannedExtraWorkouts(cell, workouts);
  const nameAt = (name: string, id: string | null, workoutStatus: string | undefined) => {
    const time = plannedReminderTime(schedule, id, date, workoutStatus);
    return time ? `${name} · ${formatScheduleTime(time)}` : name;
  };
  const additionalNames = additional.map((session) =>
    `${nameAt(session.kind === 'freestyle' ? 'Freestyle' : workouts.get(session.workout_id ?? '')?.name ?? 'Workout', session.workout_id, session.status)}, ${session.status.replaceAll('_', ' ')}`);
  const label = [formatLongDate(date), calendarStatusLabel(cell),
    ...(workout ? [nameAt(workout.name, workout.id, status)] : []), ...additionalNames,
    ...extras.map((extra) => `${nameAt(extra.name, extra.id, 'projected')}, planned`)].join(', ');
  return (
    <button type="button" role="gridcell" className={classes} onClick={onSelect} aria-label={label} aria-pressed={isSelected}>
      <span className="day-number">{Number(date.slice(8))}</span>
      {status === 'unavailable' || status === 'light' ? <span className="chip away">Away</span> : null}
      {workout && showWorkout ? <span className={`chip lift ${status ?? ''}`}>{nameAt(workout.name, workout.id, status)}</span> : null}
      {additional.map((session) => (
        <span key={session.id} className={`chip lift ${session.status}`}>
          {nameAt(session.kind === 'freestyle' ? 'Freestyle' : workouts.get(session.workout_id ?? '')?.name ?? 'Workout', session.workout_id, session.status)}
        </span>
      ))}
      {extras.map((extra) => (
        <span key={`planned:${extra.id}`} className="chip lift projected">{nameAt(extra.name, extra.id, 'projected')}</span>
      ))}
      {cell?.items.map((item) => (
        <span key={item.id} className={`chip endurance ${item.completed ? 'completed' : ''}`}>
          {itemTitle(item, sports)}
        </span>
      ))}
    </button>
  );
}

function DayDetail(props: {
  date: string;
  cell: CalendarCell | undefined;
  workout: Workout | undefined;
  workouts: Map<string, Workout>;
  schedule: WeeklySchedule;
  program: TrainingProgram | null | undefined;
  trip: ReturnType<typeof tripOn>;
  miles: boolean;
  loads: Map<string, ShownLoad | null>;
  sports: Map<string, string>;
  /** Completed activities that may have a route. */
  routable: Set<string>;
  chartable: Map<string, string>;
  onEditWorkout: (id: string) => void;
  onEditDateWorkout?: (id: string, primary: boolean) => void;
  editPanel?: ReactNode;
  actions: ReactNode;
}) {
  const { date, cell, workout, workouts, schedule, program, trip, miles, loads, sports, routable, chartable, onEditWorkout, onEditDateWorkout, editPanel, actions } = props;
  const extras = plannedExtraWorkouts(cell, workouts);
  return (
    <aside className="detail" aria-labelledby="detail-title">
      <h2 id="detail-title">{formatLongDate(date)}</h2>
      <p className="status-line">{calendarStatusLabel(cell)}</p>
      {editPanel}
      {actions}
      {trip && (
        <div className="note">
          <strong>Away</strong> {trip.start} to {trip.end}
          {trip.can_train_light ? ', light training possible' : ''}
          {trip.note ? <p className="muted">{trip.note}</p> : null}
        </div>
      )}
      {workout && cell?.status !== 'rest' && cell?.status !== 'unavailable' && (
        <CalendarWorkoutDetails workout={plannedWorkoutOn(workout, program, date, cell?.status ?? '')}
          time={plannedReminderTime(schedule, workout.id, date, cell?.status)} miles={miles}
          onEditWorkout={id => onEditDateWorkout ? onEditDateWorkout(id, true) : onEditWorkout(id)} />
      )}
      {cell?.sessions?.map((session) => {
        const additional = session.kind === 'freestyle' ? undefined : workouts.get(session.workout_id ?? '');
        const status = `Workout ${(session.slot ?? 0) + 1} · ${session.status.replaceAll('_', ' ')}`;
        return additional ? (
          <CalendarWorkoutDetails key={session.id} workout={plannedWorkoutOn(additional, program, date, session.status)}
            status={status} time={plannedReminderTime(schedule, additional.id, date, session.status)} miles={miles}
            onEditWorkout={id => onEditDateWorkout ? onEditDateWorkout(id, false) : onEditWorkout(id)} />
        ) : (
          <section key={session.id}>
            <h3>{session.kind === 'freestyle' ? 'Freestyle' : 'Workout'}</h3>
            <p className="muted">{status}</p>
          </section>
        );
      })}
      {extras.map((extra) => (
        <CalendarWorkoutDetails key={`planned:${extra.id}`} workout={plannedWorkoutOn(extra, program, date, 'projected')}
          status="Planned" time={scheduleTimeOn(schedule, extra.id, date)} miles={miles}
          onEditWorkout={id => onEditDateWorkout ? onEditDateWorkout(id, false) : onEditWorkout(id)} />
      ))}
      {cell?.items.length ? (
        <section>
          <h3>Endurance</h3>
          <ul className="slots">
            {cell.items.map((item) => {
              const load = itemLoad(item, loads);
              const method = load?.method ? LOAD_METHOD_LABELS[load.method] : undefined;
              const title = itemTitle(item, sports);
              return (
                <li key={item.id}>
                  <div className="slot-name">{title}</div>
                  <div className="muted">
                    {itemType(item, sports)} · {item.completed ? 'Done' : 'Planned'}
                    {item.planned_duration_sec ? ` · ${formatClock(item.planned_duration_sec)}` : ''}
                    {load ? ` · load ${Math.round(load.load)}${method ? ` (${method})` : ''}` : ''}
                  </div>
                  {item.completed && routable.has(item.id) ? <RouteMap activityId={item.id} label={`Route of ${title}`} miles={miles} /> : null}
                  {item.completed && chartable.has(item.id)
                    ? <ActivityCharts activityId={item.id} kind={chartable.get(item.id)!} miles={miles} />
                    : null}
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}
      {!workout && !extras.length && !cell?.sessions?.length && !cell?.items.length && !trip ? <p className="muted">A rest day.</p> : null}
    </aside>
  );
}

function CalendarWorkoutDetails({ workout, time, status, miles, onEditWorkout }: {
  workout: Workout;
  time: string | null;
  status?: string;
  miles: boolean;
  onEditWorkout: (id: string) => void;
}) {
  return (
    <section aria-label={workout.name}>
      <div className="section-head">
        <h3>{workout.name}</h3>
        <button type="button" className="ghost small" aria-label={`Edit ${workout.name}`}
          onClick={() => onEditWorkout(workout.id)}>Edit workout</button>
      </div>
      {time || status ? <p className="muted">{time ? <time dateTime={time}>{formatScheduleTime(time)}</time> : null}{time && status ? ' · ' : ''}{status}</p> : null}
      {workout.notes ? <p className="muted">{workout.notes}</p> : null}
      <ol className="slots">
        {slotBlocks(workout).map((block) => block.group ? (
          <li key={block.members[0]!.id} className="group-block">
            <div className="group-head">
              <strong>{block.group.title}</strong>
              <span className="muted">{describeGroup(block.group)}</span>
            </div>
            <ol className="slots">
              {block.members.map((slot) => <SlotItem key={slot.id} slot={slot} miles={miles} />)}
            </ol>
          </li>
        ) : (
          <SlotItem key={block.members[0]!.id} slot={block.members[0]!} miles={miles} />
        ))}
      </ol>
    </section>
  );
}

function SlotItem({ slot, miles }: { slot: Slot; miles: boolean }) {
  const steps = describeRunSteps(slot.run_steps, miles);
  return (
    <li className={slot.is_warmup ? 'warmup' : ''}>
      <div className="slot-name">
        {slot.group_label ? <span className="group">{slot.group_label}</span> : null}
        {slot.exercise_name}
        {slot.is_warmup ? <span className="tag">Warm-up</span> : null}
      </div>
      {steps.length ? (
        <ul className="steps">{steps.map((line, i) => <li key={i}>{line}</li>)}</ul>
      ) : (
        <div className="muted">{describeSlot(slot)}</div>
      )}
    </li>
  );
}
