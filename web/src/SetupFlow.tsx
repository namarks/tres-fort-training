import { useEffect, useMemo, useRef, useState } from 'react';
import { WEEKDAYS, type RaceGoal, type Weekday } from '../../src/types';
import { AddWorkout } from './AddWorkout';
import { planWrites, type StateResponse } from './api';
import { markSetupDone, rememberSetupStep, safeStore, setupInProgress, type SetupStep } from './connections';
import { EventForm } from './EventPage';
import { workoutSummary } from './EveryWeek';
import { WEEKDAY_LABELS, type Workout } from './model';
import { choosableWorkouts, routineAddingWorkout, routineAddProblem, routineDay, routineDayFull, routineExtra, routinePrimary, routineWithDay, type RoutineSchedule } from './scheduling';
import { ConnectionRows, useConnectionStatus } from './SettingsPage';
import type { Catalog, Write } from './WorkoutEditor';
import './settings.css';
import './firstRun.css';

/** Where finishing setup goes, and whether to say so. */
export type SetupExit = { hash: string; finished: boolean };

const EMPTY_WEEK: RoutineSchedule = {
  week: { mon: null, tue: null, wed: null, thu: null, fri: null, sat: null, sun: null }, extras: {}, times: {},
};

/**
 * The website's first-run setup (owner, 2026-11-21: a new account landed on
 * "Create your first workout" with no setup). Three steps, each optional:
 * the usual week, a goal event, then the apps workouts come from. Every
 * change saves as it is made through the same plan writes as the Plan page,
 * so leaving part way keeps what was done. The step is kept for this tab so
 * a provider's sign-in comes back to it.
 */
export function SetupFlow({ accountId, state, write, busy, catalog, miles, refresh, onSignedOut, onExit }: {
  accountId: string;
  state: StateResponse;
  write: Write;
  busy: boolean;
  catalog: Catalog;
  miles: boolean;
  /** Bumped after a connection finishes, so the step reads statuses again. */
  refresh: number;
  onSignedOut: (error?: unknown) => void;
  onExit: (exit: SetupExit) => void;
}) {
  const session = useMemo(() => safeStore('session'), []);
  const local = useMemo(() => safeStore('local'), []);
  const [step, setStep] = useState<SetupStep>(() => setupInProgress(session, accountId) ?? 1);
  useEffect(() => { rememberSetupStep(session, accountId, step); }, [session, accountId, step]);

  const leave = (hash: string, finished: boolean) => {
    markSetupDone(local, accountId);
    rememberSetupStep(session, accountId, null);
    onExit({ hash, finished });
  };

  return (
    <main className="first-run" aria-labelledby="setup-title">
      <div className="first-run-head">
        <p className="kicker">Set up · Step {step} of 3</p>
        <button type="button" className="ghost small" onClick={() => leave('#plan', false)}>Skip setup</button>
      </div>
      <div className="first-run-bar" role="progressbar" aria-label="Setup progress" aria-valuemin={1} aria-valuemax={3} aria-valuenow={step}>
        <i style={{ width: `${(step / 3) * 100}%` }} />
      </div>
      {step === 1 && <WeekStep state={state} write={write} busy={busy} catalog={catalog} miles={miles} accountId={accountId}
        onNext={() => setStep(2)} />}
      {step === 2 && <GoalStep state={state} write={write} busy={busy} miles={miles} onBack={() => setStep(1)} onNext={() => setStep(3)} />}
      {step === 3 && <ConnectStep accountId={accountId} refresh={refresh} onSignedOut={onSignedOut} onBack={() => setStep(2)}
        onLeaving={() => rememberSetupStep(session, accountId, 3)}
        onFinish={() => leave('#plan', true)} />}
    </main>
  );
}

// ---- Step 1: the usual week ---------------------------------------------------

function WeekStep({ state, write, busy, catalog, miles, accountId, onNext }: {
  state: StateResponse; write: Write; busy: boolean; catalog: Catalog; miles: boolean; accountId: string; onNext: () => void;
}) {
  const [adding, setAdding] = useState<Weekday | null>(null);
  const editor = useRef<HTMLDivElement>(null);
  const dayButtons = useRef<Partial<Record<Weekday, HTMLButtonElement | null>>>({});
  const lastDay = useRef<Weekday | null>(null);
  const plan = state.plan;
  const editing = adding !== null && plan !== null;
  useEffect(() => {
    if (adding && editor.current) {
      lastDay.current = adding;
      editor.current.focus({ preventScroll: true });
      editor.current.scrollIntoView({ block: 'start', behavior: 'instant' });
    } else if (!adding && lastDay.current) {
      const button = dayButtons.current[lastDay.current];
      if (button?.disabled) button.closest<HTMLElement>('[role="listitem"]')?.focus();
      else button?.focus();
      lastDay.current = null;
    }
  }, [adding, plan?.id]);
  const schedule = plan?.schedule ?? EMPTY_WEEK;
  const workouts = useMemo(() => choosableWorkouts((plan?.workouts ?? []) as Workout[]), [plan]);
  const nameOf = (id: string) => workouts.find((workout) => workout.id === id)?.name ?? 'Unavailable workout';
  const empty = WEEKDAYS.every((day) => { const draft = routineDay(schedule, day); return !draft.primary && draft.extras.length === 0; });

  const open = async (day: Weekday) => {
    // A new account has no plan yet; the first change starts one.
    if (!plan && !(await write(async () => undefined))) return;
    setAdding(day);
  };
  const remove = (day: Weekday, id: string) => {
    const draft = routineDay(schedule, day);
    const next = id === draft.primary ? routinePrimary(draft, draft.extras[0] ?? null) : routineExtra(draft, draft.extras.indexOf(id), null);
    const result = routineWithDay(schedule, day, next, workouts);
    if (result.ok) void write((at) => planWrites.setRoutine(result.schedule, at));
  };

  return (
    <section className="first-run-step" aria-labelledby="setup-title">
      <h1 id="setup-title">Set up your week</h1>
      <p className="muted first-run-lead">Add workouts to your weekly routine. It repeats each week; empty days are rest days.</p>
      {!editing && <div className="first-run-week" role="list" aria-label="Your usual week">
        {WEEKDAYS.map((day) => {
          const draft = routineDay(schedule, day);
          const ids = [...(draft.primary ? [draft.primary] : []), ...draft.extras];
          const name = WEEKDAY_LABELS[day];
          return (
            <div key={day} role="listitem" tabIndex={-1} className={`first-run-day${adding === day ? ' on' : ''}`} aria-label={name}>
              <strong className="first-run-dayname">{name.slice(0, 3)}</strong>
              {ids.length === 0 && <span className="first-run-rest">Rest</span>}
              {ids.map((id) => {
                const workout = workouts.find((entry) => entry.id === id);
                return (
                  <span key={id} className="first-run-entry">
                    <span><b>{nameOf(id)}</b>{workout && <small>{workoutSummary(workout)}</small>}</span>
                    <button type="button" className="icon" disabled={busy} aria-label={`Remove ${nameOf(id)} from ${name}`} onClick={() => remove(day, id)}>×</button>
                  </span>
                );
              })}
              <button type="button" className="ghost small first-run-add" ref={(button) => { dayButtons.current[day] = button; }} disabled={busy || routineDayFull(draft)}
                aria-label={`Add to ${name}`} onClick={() => open(day)}>+ Add</button>
            </div>
          );
        })}
      </div>}
      {adding && plan && (
        <div className="first-run-adder" ref={editor} tabIndex={-1} role="region" aria-label={`Add to every ${WEEKDAY_LABELS[adding]}`}>
          <AddWorkout key={adding} title={`Add to every ${WEEKDAY_LABELS[adding]}`} action={`Add to every ${WEEKDAY_LABELS[adding]}`}
            state={state} accountId={accountId} catalog={catalog} miles={miles} write={write} busy={busy}
            unavailable={(workout) => routineAddProblem(schedule, adding, workout.id)}
            blocked={routineDayFull(routineDay(schedule, adding)) ? `${WEEKDAY_LABELS[adding]} is full.` : null}
            onPlace={async (workoutId, at) => {
              const known = workouts.some((workout) => workout.id === workoutId) ? workouts
                : [...workouts, { id: workoutId, name: '', order_index: Number.MAX_SAFE_INTEGER, exercises: [] } as unknown as Workout];
              const result = routineAddingWorkout(schedule, [adding], workoutId, '', known);
              if (!result.ok) throw new Error(result.error);
              await planWrites.setRoutine(result.schedule, at);
            }}
            onDone={() => setAdding(null)}
            onCancel={() => setAdding(null)} />
        </div>
      )}
      {!editing && <div className="first-run-foot">
        <button type="button" className="primary big" disabled={busy} onClick={onNext}>{empty ? 'Skip for now' : 'Next'}</button>
      </div>}
    </section>
  );
}

// ---- Step 2: a goal event -----------------------------------------------------

function GoalStep({ state, write, busy, miles, onBack, onNext }: {
  state: StateResponse; write: Write; busy: boolean; miles: boolean;
  onBack: () => void; onNext: () => void;
}) {
  const race = state.plan?.race ?? null;
  const [choosing, setChoosing] = useState(false);
  const save = async (next: RaceGoal) => {
    if (await write((at) => planWrites.setEvent(next, at))) onNext();
  };

  return (
    <section className="first-run-step" aria-labelledby="setup-title">
      <h1 id="setup-title">Add an event goal?</h1>
      <p className="muted first-run-lead">Add a race or event to your plan, or skip for now.</p>
      {race && !choosing ? (
        <div className="panel first-run-panel">
          <p><strong>{race.name}</strong>{race.date ? ` · ${race.date}` : ''}</p>
          <div className="first-run-foot">
            <button type="button" className="ghost" onClick={onBack}>Back</button>
            <button type="button" className="primary big" onClick={onNext}>Next</button>
            <button type="button" className="ghost small" onClick={() => setChoosing(true)}>Change event</button>
          </div>
        </div>
      ) : choosing || race ? (
        <div className="panel first-run-panel">
          <EventForm race={race} miles={miles} busy={busy} onSave={save} submitLabel="Save and continue"
            cancelLabel="Cancel" onCancel={() => setChoosing(false)} />
        </div>
      ) : (
        <div className="first-run-foot">
          <button type="button" className="ghost" onClick={onBack}>Back</button>
          <button type="button" className="primary big" onClick={() => setChoosing(true)}>Add event</button>
          <button type="button" className="ghost" onClick={onNext}>Skip for now</button>
        </div>
      )}
    </section>
  );
}

// ---- Step 3: connect apps -----------------------------------------------------

function ConnectStep({ accountId, refresh, onSignedOut, onBack, onLeaving, onFinish }: {
  accountId: string; refresh: number; onSignedOut: (error?: unknown) => void; onBack: () => void;
  onLeaving: () => void; onFinish: () => void;
}) {
  const status = useConnectionStatus(accountId, refresh, onSignedOut);
  return (
    <section className="first-run-step" aria-labelledby="setup-title">
      <h1 id="setup-title">Connect your apps</h1>
      <p className="muted first-run-lead">Optional. Sync completed workouts from your apps and devices.</p>
      <ConnectionRows status={status} onSignedOut={onSignedOut} onLeaving={onLeaving} />
      <div className="first-run-foot">
        <button type="button" className="ghost" onClick={onBack}>Back</button>
        <button type="button" className="primary big" onClick={onFinish}>View my plan</button>
      </div>
    </section>
  );
}
