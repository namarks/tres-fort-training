import { useEffect, useMemo, useState } from 'react';
import { WEEKDAYS, type RaceGoal, type Weekday } from '../../src/types';
import { AddWorkout } from './AddWorkout';
import { planWrites, type StateResponse } from './api';
import { markSetupDone, rememberSetupBlock, rememberSetupStep, safeStore, setupInProgress, setupWantsBlock, type SetupStep } from './connections';
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
  const [buildBlock, setBuildBlock] = useState(() => setupWantsBlock(session, accountId));
  useEffect(() => { rememberSetupStep(session, accountId, step); }, [session, accountId, step]);
  useEffect(() => { rememberSetupBlock(session, accountId, buildBlock); }, [session, accountId, buildBlock]);

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
      {step === 2 && <GoalStep state={state} write={write} busy={busy} miles={miles} buildBlock={buildBlock}
        onBuildBlock={setBuildBlock} onBack={() => setStep(1)} onNext={() => setStep(3)} />}
      {step === 3 && <ConnectStep refresh={refresh} onSignedOut={onSignedOut} onBack={() => setStep(2)}
        onLeaving={() => rememberSetupStep(session, accountId, 3)}
        onCoach={() => leave('#settings/coach', true)}
        onFinish={() => leave(buildBlock && state.plan?.race ? '#block/start' : '#plan', true)} />}
    </main>
  );
}

// ---- Step 1: the usual week ---------------------------------------------------

function WeekStep({ state, write, busy, catalog, miles, accountId, onNext }: {
  state: StateResponse; write: Write; busy: boolean; catalog: Catalog; miles: boolean; accountId: string; onNext: () => void;
}) {
  const [adding, setAdding] = useState<Weekday | null>(null);
  const plan = state.plan;
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
      <h1 id="setup-title">What does your usual week look like?</h1>
      <p className="muted first-run-lead">Add what you do on each day: a run, a ride, lifting, a class, soccer. It repeats every week, and you can change any single date later. Days you leave empty are rest days.</p>
      <div className="first-run-week" role="list" aria-label="Your usual week">
        {WEEKDAYS.map((day) => {
          const draft = routineDay(schedule, day);
          const ids = [...(draft.primary ? [draft.primary] : []), ...draft.extras];
          const name = WEEKDAY_LABELS[day];
          return (
            <div key={day} role="listitem" className={`first-run-day${adding === day ? ' on' : ''}`} aria-label={name}>
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
              <button type="button" className="ghost small first-run-add" disabled={busy || routineDayFull(draft)}
                aria-label={`Add to ${name}`} onClick={() => open(day)}>+ Add</button>
            </div>
          );
        })}
      </div>
      {adding && plan && (
        <div className="first-run-adder">
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
      <div className="first-run-foot">
        <button type="button" className="primary big" disabled={busy} onClick={onNext}>{empty ? 'Next, plan later' : 'Next'}</button>
        <span className="first-run-tail">{empty ? 'You can fill in your week on the Plan page any time.' : 'Saved. Times and reminders are on the Plan page.'}</span>
      </div>
    </section>
  );
}

// ---- Step 2: a goal event -----------------------------------------------------

function GoalStep({ state, write, busy, miles, buildBlock, onBuildBlock, onBack, onNext }: {
  state: StateResponse; write: Write; busy: boolean; miles: boolean;
  buildBlock: boolean; onBuildBlock: (on: boolean) => void; onBack: () => void; onNext: () => void;
}) {
  const race = state.plan?.race ?? null;
  const [choosing, setChoosing] = useState(false);
  const save = async (next: RaceGoal) => {
    if (await write((at) => planWrites.setEvent(next, at))) onNext();
  };
  const blockChoice = (
    <label className="check first-run-block">
      <input type="checkbox" checked={buildBlock} onChange={(event) => onBuildBlock(event.target.checked)} />
      Build up to it with a training block (you’ll set it up after this)
    </label>
  );

  return (
    <section className="first-run-step" aria-labelledby="setup-title">
      <h1 id="setup-title">Working toward something?</h1>
      <p className="muted first-run-lead">A race, a long ride, a swim, a trip or any day you’re training for. It’s optional: your usual week works on its own.</p>
      {race && !choosing ? (
        <div className="panel first-run-panel">
          <p><strong>{race.name}</strong>{race.date ? ` · ${race.date}` : ''}</p>
          {blockChoice}
          <div className="first-run-foot">
            <button type="button" className="ghost" onClick={onBack}>Back</button>
            <button type="button" className="primary big" onClick={onNext}>Next</button>
            <button type="button" className="ghost small" onClick={() => setChoosing(true)}>Change event</button>
          </div>
        </div>
      ) : choosing || race ? (
        <div className="panel first-run-panel">
          <EventForm race={race} miles={miles} busy={busy} onSave={save} submitLabel="Save and continue"
            cancelLabel="Not now" onCancel={() => { setChoosing(false); if (!race) onBuildBlock(false); }}>
            {blockChoice}
          </EventForm>
        </div>
      ) : (
        <div className="first-run-foot">
          <button type="button" className="ghost" onClick={onBack}>Back</button>
          <button type="button" className="primary big" onClick={() => { setChoosing(true); onBuildBlock(true); }}>Yes, add an event</button>
          <button type="button" className="ghost" onClick={() => { onBuildBlock(false); onNext(); }}>Not right now</button>
        </div>
      )}
    </section>
  );
}

// ---- Step 3: connect apps -----------------------------------------------------

function ConnectStep({ refresh, onSignedOut, onBack, onLeaving, onCoach, onFinish }: {
  refresh: number; onSignedOut: (error?: unknown) => void; onBack: () => void;
  onLeaving: () => void; onCoach: () => void; onFinish: () => void;
}) {
  const status = useConnectionStatus(refresh, onSignedOut);
  return (
    <section className="first-run-step" aria-labelledby="setup-title">
      <h1 id="setup-title">Bring in your workouts</h1>
      <p className="muted first-run-lead">Connect where your rides, runs and other workouts are recorded, so they land on your plan. Every one is optional, and you can change them later in Settings.</p>
      <ConnectionRows status={status} onSignedOut={onSignedOut} onLeaving={onLeaving} />
      <div className="connection-rows">
        <span className="kicker">Optional</span>
        <div className="connection-row" role="group" aria-label="AI coach">
          <span className="connection-logo coach" aria-hidden="true">AI</span>
          <div className="connection-text">
            <strong>AI coach</strong>
            <small>Let Claude, ChatGPT or another AI app read your training and adjust your plan when you ask. Everything works without one.</small>
          </div>
          <div className="connection-actions"><button type="button" className="ghost" onClick={onCoach}>Set up</button></div>
        </div>
      </div>
      <div className="first-run-foot">
        <button type="button" className="ghost" onClick={onBack}>Back</button>
        <button type="button" className="primary big" onClick={onFinish}>Finish</button>
      </div>
    </section>
  );
}
