import { useId, useMemo, useRef, useState, type ReactNode } from 'react';
import type { RunPlanItem } from '../../src/runSteps';
import { ApiError, createPrescribedWorkout, planWrites, type Reviewed, type StateResponse } from './api';
import {
  activityCreation,
  ADD_KINDS,
  availableName,
  enduranceDraft,
  enduranceName,
  enduranceUnit,
  existingNamed,
  OTHER_SUGGESTIONS,
  receiptIsOurs,
  resumable,
  RUN_STYLES,
  runCreation,
  runDraft,
  runItems,
  runName,
  runStyled,
  sameSteps,
  versionAfterOwnWrites,
  type AddKind,
  type CreationResult,
  type EnduranceDraft,
  type RunDraft,
  type Unplaced,
} from './addToDay';
import { factsOfCatalog, searchCatalog } from './editing';
import { workoutSummary } from './EveryWeek';
import { buildPrescription, guidedErrors, guidedTarget, HOME_STARTS, initialGuidedDraft, isEquipmentFree, isTimed, type GuidedDraft, type HomeStart } from './guidedWorkout';
import { addLiftingExercise, buildLiftingPrescription, initialLiftingDraft, liftingErrors, liftingExercise, liftingTargetSummary, type LiftingDraft } from './liftingDraft';
import { describeRunSteps, isRunOnlyWorkout, type Slot, type Workout } from './model';
import { RunPlanEditor } from './RunPlanEditor';
import type { TargetChoice } from './runPlan';
import { choosableWorkouts } from './scheduling';
import { SlotFields } from './SlotFields';
import { preferredUnit, type Catalog, type Write } from './WorkoutEditor';
import './setup.css';

/** The choices an Add box holds, as they were when a save began. */
interface Choices {
  kind: AddKind | null; typed: string; run: RunDraft; ride: EnduranceDraft; swim: EnduranceDraft;
  home: GuidedDraft; homeStart: HomeStart; lift: LiftingDraft;
}

// A save that made its workout and could not place it, with the choices it
// came from. It outlives the box, which closes when the plan reloads after a
// conflict: the next Add box for the same plan opens on those choices, and
// Add places the workout already saved instead of making a numbered copy.
// Kept for this page only; after a reload the workout is under Saved.
let kept: { key: string; held: Unplaced; choices: Choices } | null = null;

/**
 * The Add box (owner, 2026-11-17: "on this day I want to do a run, and then
 * tweak the details"). Pick what it is, shape it, and one button saves it
 * as a workout and places it. Saved workouts have a separate reuse action.
 * Where it goes is the caller's: a date, a weekday, or a week of a new block.
 */
export function AddWorkout(props: {
  title: string;
  /** The button's words, such as "Add to Tue, Nov 17". */
  action: string;
  state: StateResponse;
  accountId: string;
  catalog: Catalog;
  write: Write;
  busy: boolean;
  miles: boolean;
  /** Choices shown above the button, such as which dates it goes on. */
  children?: ReactNode;
  /** Why a saved workout can't go here, or null. */
  unavailable?: (workout: Workout) => string | null;
  /** Why nothing can be added right now, or null. */
  blocked?: string | null;
  /** Places the workout, in the same save that makes it. */
  onPlace: (workoutId: string, at: Reviewed) => Promise<unknown> | void;
  onDone?: (workoutId: string) => void;
  onCancel?: () => void;
  initialKind?: AddKind;
}) {
  const { state, accountId, catalog, write, busy, miles, unavailable, blocked, onPlace, onDone, onCancel } = props;
  const plan = state.plan;
  const workouts = useMemo(() => (plan?.workouts ?? []) as Workout[], [plan]);
  const saved = useMemo(() => choosableWorkouts(workouts), [workouts]);
  const key = `${accountId}:${plan?.id ?? ''}`;
  const [restored] = useState(() => (kept?.key === key ? kept : null));
  const [kind, setKind] = useState<AddKind | null>(restored?.choices.kind ?? props.initialKind ?? null);
  const [typed, setTyped] = useState(restored?.choices.typed ?? '');
  const [renaming, setRenaming] = useState(false);
  const [run, setRun] = useState<RunDraft>(() => restored?.choices.run ?? runDraft('easy', miles));
  const [editingSteps, setEditingSteps] = useState(false);
  const [ride, setRide] = useState<EnduranceDraft>(() => restored?.choices.ride ?? enduranceDraft('ride', miles));
  const [swim, setSwim] = useState<EnduranceDraft>(() => restored?.choices.swim ?? enduranceDraft('swim', miles));
  const [home, setHome] = useState<GuidedDraft>(() => restored?.choices.home ?? initialGuidedDraft('core'));
  const [homeStart, setHomeStart] = useState<HomeStart>(restored?.choices.homeStart ?? 'core');
  const [lift, setLift] = useState<LiftingDraft>(() => restored?.choices.lift ?? initialLiftingDraft());
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const [showErrors, setShowErrors] = useState(false);
  const ids = useId();
  const rows = catalog.kind === 'ready' ? catalog.exercises : [];
  const needsCatalog = kind === 'lift' || kind === 'home';
  const choose = (next: AddKind) => { setKind(next); setTyped(''); setRenaming(false); setShowErrors(false); setEditingSteps(false); setQuery(''); };

  /** What Add would save, against the plan as `at` has it. A workout that
   * is already saved is used as it is, so it has to be one that can go here. */
  const build = (at: { planId: string; version: number }): CreationResult | null => {
    const made = shape(at);
    if (!made?.ok || (made.creation.kind !== 'existing' && made.creation.kind !== 'steps')) return made;
    const id = made.creation.workoutId;
    const there = workouts.find((workout) => workout.id === id);
    const reason = there ? unavailable?.(there) ?? null : null;
    return reason ? { ok: false, error: `You already have ${made.name}, and it can’t be added here: ${reason.charAt(0).toLowerCase()}${reason.slice(1)}.` } : made;
  };
  const shape = (at: { planId: string; version: number }): CreationResult | null => {
    if (!kind || kind === 'saved') return null;
    if (kind === 'run') return runCreation(run, typed, workouts, miles, at);
    if (kind === 'ride' || kind === 'swim') {
      const name = enduranceName(kind, kind === 'ride' ? ride : swim, typed, miles);
      return name.ok ? activityCreation(name.name, workouts) : name;
    }
    if (kind === 'other') return activityCreation(typed, workouts);
    if (catalog.kind !== 'ready') return { ok: false, error: 'Wait for the exercise list to load.' };
    if (kind === 'home') {
      const name = typed.trim() || availableName(home.name, workouts);
      const draft = { ...home, name };
      const errors = guidedErrors(draft, rows);
      const request = errors.length ? null : buildPrescription(draft, rows, at);
      return request ? { ok: true, name, creation: { kind: 'prescribed', request } } : { ok: false, error: errors[0] ?? 'Check the routine.' };
    }
    const name = typed.trim() || availableName(lift.name, workouts);
    const draft = { ...lift, name };
    const errors = liftingErrors(draft, rows);
    const request = errors.length ? null : buildLiftingPrescription(draft, rows, at);
    return request ? { ok: true, name, creation: { kind: 'prescribed', request } } : { ok: false, error: errors[0] ?? 'Check the exercises.' };
  };
  const preview = plan ? build({ planId: plan.id, version: plan.version }) : null;

  // A save that made its workout and then could not place it. Pressing Add
  // again finishes that save; it never makes a second workout.
  const heldNameOf = (held: Unplaced | null) => (held?.workoutId && held.creation.kind !== 'steps'
    ? { signature: held.signature, name: held.creation.kind === 'activity' ? held.creation.name : held.creation.request.name } : null);
  const unplaced = useRef<Unplaced | null>(restored?.held ?? null);
  const [heldName, setHeldName] = useState(() => heldNameOf(restored?.held ?? null));
  const hold = (next: Unplaced | null): Unplaced | null => {
    unplaced.current = next;
    kept = next ? { key, held: next, choices: { kind, typed, run, ride, swim, home, homeStart, lift } } : null;
    setHeldName(heldNameOf(next));
    return next;
  };
  const signature = JSON.stringify([kind, typed.trim(), miles,
    kind === 'run' ? run : kind === 'ride' ? ride : kind === 'swim' ? swim : kind === 'home' ? home : kind === 'lift' ? lift : null]);

  /**
   * Finishes a save: the workout, a run's steps, and the plan version to
   * place it at. Every write names the version the one before it left, never
   * a version read back from the server, so a change made elsewhere in
   * between is a conflict rather than something to write over.
   */
  const make = async (start: Unplaced, at: Reviewed): Promise<{ id: string; at: Reviewed }> => {
    let held = start;
    const creation = held.creation;
    let version = versionAfterOwnWrites(at.version, held.version);
    let id = held.workoutId;
    if (!id && creation.kind === 'activity') {
      // An answer that never arrived may still have saved it: use that one.
      const there = existingNamed(workouts, creation.name);
      if (there) id = there.id;
      else {
        const row = await planWrites.addWorkout(creation.name, { ...at, version });
        if (!row?.id) throw new Error('unreadable_workout_receipt');
        id = row.id;
        version += 1;
      }
      held = hold({ ...held, workoutId: id, version })!;
    }
    if (!id && creation.kind === 'prescribed') {
      let receipt;
      try {
        receipt = await createPrescribedWorkout(creation.request, accountId);
      } catch (error) {
        // A refusal means this request never saved and never will.
        if (error instanceof ApiError && error.status < 500) hold(null);
        throw error;
      }
      id = receipt.workout_id;
      version = receipt.version;
      held = hold({ ...held, workoutId: id, version })!;
      if (!receiptIsOurs(creation.request.expected_version, receipt.version, at.version)) {
        throw new ApiError(409, { conflict: true, current_version: receipt.version });
      }
    }
    if (!id) throw new Error('add_not_ready');
    const steps = creation.kind === 'prescribed' ? creation.steps : creation.kind === 'steps' ? creation : undefined;
    if (steps && !held.stepsSaved) {
      const slot = workouts.find((workout) => workout.id === id)?.exercises.find((entry) => entry.id === steps.slotId);
      if (!slot || !sameSteps(slot.run_steps, steps.items)) {
        await planWrites.updateSlot(id, steps.slotId, { run_steps: steps.items }, { ...at, version });
        version += 1;
      }
      hold({ ...held, stepsSaved: true, version });
    }
    return { id, at: { ...at, version } };
  };

  const add = async (existing?: Workout) => {
    if (busy || blocked) return;
    const resuming = !existing && resumable(unplaced.current, signature, workouts, plan?.version ?? 0) !== null;
    if (!existing && !resuming && (!preview || !preview.ok)) { setShowErrors(true); return; }
    let placed: string | null = null;
    const ok = await write(async (at) => {
      let result: { id: string; at: Reviewed } | null = null;
      if (existing) result = { id: existing.id, at };
      else {
        let held = resumable(unplaced.current, signature, workouts, at.version);
        if (!held) {
          hold(null);
          const made = build(at);
          if (!made?.ok) throw new Error('add_not_ready');
          const creation = made.creation;
          if (creation.kind === 'existing') result = { id: creation.workoutId, at };
          else held = hold({ signature, creation, workoutId: creation.kind === 'steps' ? creation.workoutId : null, version: null, stepsSaved: false });
        }
        if (held) result = await make(held, at);
      }
      if (!result) throw new Error('add_not_ready');
      await onPlace(result.id, result.at);
      hold(null);
      placed = result.id;
    });
    if (ok && placed) onDone?.(placed);
  };
  const unfinished = heldName && heldName.signature === signature ? heldName.name : null;

  const strip = (
    <div className="add-kinds" role="group" aria-label="What to add">
      {ADD_KINDS.filter((entry) => entry.kind !== 'saved').map((entry) => (
        <button key={entry.kind} type="button" className={kind === entry.kind ? 'add-kind on' : 'add-kind'}
          aria-pressed={kind === entry.kind} disabled={busy} onClick={() => choose(entry.kind)}>{entry.label}</button>
      ))}
    </div>
  );

  const leave = () => {
    hold(null);
    setKind(props.initialKind ?? null); setTyped(''); setRenaming(false); setShowErrors(false);
    setHome(initialGuidedDraft('core')); setHomeStart('core'); setLift(initialLiftingDraft());
  };
  const nameLine = unfinished && kind !== 'saved' ? (
    <p className="add-name fine" role="status">
      “{unfinished}” is saved to Workouts and not placed yet. {props.action} finishes it.
      {' '}<button type="button" className="link" disabled={busy} onClick={leave}>Leave it in Workouts</button>
    </p>
  ) : preview?.ok && kind !== 'other' && kind !== 'saved' && (
    <p className="add-name fine">
      {preview.creation.kind === 'existing' ? preview.note : <>Workout name: “{preview.name}”.{preview.note ? ` ${preview.note}` : ''}</>}
      {' '}{!renaming && preview.creation.kind !== 'existing' && (
        <button type="button" className="link" onClick={() => { setRenaming(true); setTyped(typed || preview.name); }}>Rename</button>
      )}
    </p>
  );
  const nameField = renaming && !unfinished && kind !== 'other' && (
    <div className="field">
      <label htmlFor={`${ids}-name`}>Name</label>
      <input id={`${ids}-name`} value={typed} maxLength={80} onChange={(event) => setTyped(event.target.value)} />
    </div>
  );

  return (
    <section className="add-box" aria-labelledby={`${ids}-title`}>
      <h3 id={`${ids}-title`}>{props.title}</h3>
      {strip}
      {saved.length > 0 && (
        <div className="form-actions">
          <button type="button" className={kind === 'saved' ? 'add-chip on' : 'add-chip'} aria-pressed={kind === 'saved'}
            aria-controls={kind === 'saved' ? `${ids}-saved-list` : undefined}
            disabled={busy} onClick={() => choose('saved')}>My workouts</button>
        </div>
      )}
      {blocked && kind !== null && <p className="problem" role="status">{blocked}</p>}

      {kind === 'run' && !editingSteps && (
        <RunFields ids={ids} draft={run} miles={miles} busy={busy} onChange={setRun} onSteps={() => setEditingSteps(true)} />
      )}
      {kind === 'run' && editingSteps && (
        <StepsEditor draft={run} miles={miles} busy={busy} onCancel={() => setEditingSteps(false)}
          onSave={(items) => { setRun({ ...run, custom: items }); setEditingSteps(false); }} />
      )}
      {(kind === 'ride' || kind === 'swim') && (
        <EnduranceFields ids={ids} kind={kind} miles={miles} draft={kind === 'ride' ? ride : swim}
          onChange={kind === 'ride' ? setRide : setSwim} />
      )}
      {kind === 'other' && (
        <div className="add-fields">
          <div className="field">
            <label htmlFor={`${ids}-other`}>What is it?</label>
            <input id={`${ids}-other`} value={typed} maxLength={80} placeholder="Soccer, yoga, a hike" autoFocus
              onChange={(event) => setTyped(event.target.value)} />
          </div>
          <div className="add-chips" role="group" aria-label="Ideas">
            {OTHER_SUGGESTIONS.map((name) => (
              <button key={name} type="button" className={typed.trim().toLowerCase() === name.toLowerCase() ? 'add-chip on' : 'add-chip'}
                aria-pressed={typed.trim().toLowerCase() === name.toLowerCase()} onClick={() => setTyped(name)}>{name}</button>
            ))}
          </div>
          <p className="fine muted">Log it in the iPhone app or sync it that day. No sets to log.</p>
          {!unfinished && preview?.ok && preview.note && <p className="fine">{preview.note}</p>}
        </div>
      )}
      {needsCatalog && catalog.kind === 'loading' && <p className="muted">Loading exercises…</p>}
      {needsCatalog && catalog.kind === 'error' && <p className="problem" role="alert">The exercise list could not load. Reload the page to try again.</p>}
      {kind === 'home' && catalog.kind === 'ready' && (
        <div className="add-fields">
          <div className="add-chips" role="group" aria-label="Starting point">
            {(Object.keys(HOME_STARTS) as HomeStart[]).map((start) => (
              <button key={start} type="button" className={homeStart === start ? 'add-chip on' : 'add-chip'} aria-pressed={homeStart === start}
                onClick={() => { setHomeStart(start); setHome(initialGuidedDraft(start)); setTyped(''); setRenaming(false); }}>{HOME_STARTS[start].title}</button>
            ))}
          </div>
          <ol className="add-exercises">
            {home.exerciseIds.map((id) => {
              const exercise = rows.find((row) => row.id === id);
              return (
                <li key={id}>
                  <div><strong>{exercise?.name ?? 'Exercise unavailable'}</strong>
                    <small className="muted">{exercise ? guidedTarget(home, exercise) : ''}</small></div>
                  <button type="button" className="ghost small" aria-label={`Remove ${exercise?.name ?? 'exercise'}`}
                    onClick={() => setHome({ ...home, exerciseIds: home.exerciseIds.filter((other) => other !== id) })}>Remove</button>
                </li>
              );
            })}
          </ol>
          <div className="add-row">
            <SmallField id={`${ids}-sets`} label={home.circuit ? 'Rounds' : 'Sets'} value={home.sets} onChange={(sets) => setHome({ ...home, sets })} />
            {home.exerciseIds.some((id) => { const exercise = rows.find((row) => row.id === id); return exercise && !isTimed(home, exercise); })
              && <SmallField id={`${ids}-reps`} label="Reps" value={home.reps} onChange={(reps) => setHome({ ...home, reps })} />}
            {home.exerciseIds.some((id) => { const exercise = rows.find((row) => row.id === id); return exercise && isTimed(home, exercise); })
              && <SmallField id={`${ids}-seconds`} label="Seconds" value={home.seconds} onChange={(seconds) => setHome({ ...home, seconds })} />}
          </div>
          <ExerciseSearch id={`${ids}-home-search`} label="Add an exercise with no equipment" query={query} onQuery={setQuery}
            matches={searchCatalog(rows.filter(isEquipmentFree), query, 8).filter((exercise) => !home.exerciseIds.includes(exercise.id))}
            onAdd={(exercise) => setHome({ ...home, exerciseIds: [...home.exerciseIds, exercise.id] })} />
        </div>
      )}
      {kind === 'lift' && catalog.kind === 'ready' && (
        <div className="add-fields">
          {lift.rows.length === 0 && <p className="muted">Search for your first exercise. Each starts at 3 sets of 8, and you can change it here.</p>}
          <ol className="add-exercises">
            {lift.rows.map((row) => {
              const exercise = rows.find((entry) => entry.id === row.exerciseId);
              return (
                <li key={row.exerciseId}>
                  <details>
                    <summary><strong>{exercise?.name ?? 'Exercise unavailable'}</strong>
                      <small className="muted">{exercise ? liftingTargetSummary(row, exercise) : ''}</small></summary>
                    {exercise && <SlotFields facts={factsOfCatalog(exercise)} draft={row.targets}
                      onChange={(targets) => setLift({ ...lift, rows: lift.rows.map((other) => (other.exerciseId === row.exerciseId ? { ...row, targets } : other)) })} />}
                  </details>
                  <button type="button" className="ghost small" aria-label={`Remove ${exercise?.name ?? 'exercise'}`}
                    onClick={() => setLift({ ...lift, rows: lift.rows.filter((other) => other.exerciseId !== row.exerciseId) })}>Remove</button>
                </li>
              );
            })}
          </ol>
          <ExerciseSearch id={`${ids}-lift-search`} label="Add an exercise" query={query} onQuery={setQuery}
            matches={query.trim() ? searchCatalog(rows.filter(liftingExercise), query, 8).filter((exercise) => !lift.rows.some((row) => row.exerciseId === exercise.id)) : []}
            onAdd={(exercise) => { setLift(addLiftingExercise(lift, exercise, preferredUnit(miles))); setQuery(''); }} />
          {!renaming && (
            <div className="field">
              <label htmlFor={`${ids}-lift-name`}>Name</label>
              <input id={`${ids}-lift-name`} value={typed} maxLength={80} placeholder={unfinished ?? availableName(lift.name, workouts)}
                onChange={(event) => setTyped(event.target.value)} />
            </div>
          )}
        </div>
      )}

      {kind !== null && kind !== 'saved' && (
        <>
          {nameField}
          {props.children}
          {showErrors && preview && !preview.ok && <p className="problem" role="alert">{preview.error}</p>}
          <div className="form-actions">
            <button type="button" className="primary" disabled={busy || !!blocked || (needsCatalog && catalog.kind !== 'ready')}
              onClick={() => { void add(); }}>{busy ? 'Saving…' : props.action}</button>
            {onCancel && <button type="button" className="ghost" disabled={busy} onClick={onCancel}>Cancel</button>}
          </div>
          {nameLine}
        </>
      )}

      {kind === 'saved' && (
        <div className="add-fields" id={`${ids}-saved-list`}>
          {props.children}
          {saved.length === 0 ? <p className="muted">You have no saved workouts yet. Pick a type above to make one.</p> : (
            <>
              <label className="visually-hidden" htmlFor={`${ids}-saved`}>Search your workouts</label>
              <input id={`${ids}-saved`} type="search" placeholder="Search your workouts" value={search}
                onChange={(event) => setSearch(event.target.value)} />
              <SavedList workouts={saved.filter((workout) => workout.name.toLowerCase().includes(search.trim().toLowerCase()))}
                unavailable={unavailable} busy={busy || !!blocked} action={props.action} onAdd={(workout) => { void add(workout); }} />
            </>
          )}
          {onCancel && <div className="form-actions"><button type="button" className="ghost" disabled={busy} onClick={onCancel}>Cancel</button></div>}
        </div>
      )}
      {kind === null && onCancel && <div className="form-actions"><button type="button" className="ghost" disabled={busy} onClick={onCancel}>Cancel</button></div>}
    </section>
  );
}

function SmallField({ id, label, value, onChange, suffix }: { id: string; label: string; value: string; onChange: (value: string) => void; suffix?: string }) {
  return (
    <div className="field small-field">
      <label htmlFor={id}>{label}</label>
      <span className="add-amount">
        <input id={id} inputMode="decimal" value={value} onChange={(event) => onChange(event.target.value)} />
        {suffix ? <span className="muted">{suffix}</span> : null}
      </span>
    </div>
  );
}

const TARGETS: { value: TargetChoice; label: string }[] = [
  { value: 'none', label: 'No target' },
  { value: 'heart_rate', label: 'Heart rate' },
  { value: 'pace', label: 'Pace' },
];

/** A run: its kind, how long or how far, and a range to keep it in. */
function RunFields({ ids, draft, miles, busy, onChange, onSteps }: {
  ids: string; draft: RunDraft; miles: boolean; busy: boolean; onChange: (draft: RunDraft) => void; onSteps: () => void;
}) {
  const set = (patch: Partial<RunDraft>) => onChange({ ...draft, ...patch });
  const result = runItems(draft, miles);
  const lines = result.ok && (draft.custom || result.items.length > 1) ? describeRunSteps(JSON.stringify(result.items), miles) : [];
  const unit = miles ? 'mi' : 'km';
  return (
    <div className="add-fields">
      <div className="add-chips" role="group" aria-label="Kind of run">
        {RUN_STYLES.map((entry) => (
          <button key={entry.style} type="button" className={draft.style === entry.style ? 'add-chip on' : 'add-chip'}
            aria-pressed={draft.style === entry.style} disabled={busy} onClick={() => onChange(runStyled(draft, entry.style))}>{entry.label}</button>
        ))}
      </div>
      {draft.custom ? (
        <p className="fine muted">These are your own steps. <button type="button" className="link" onClick={() => set({ custom: null })}>Use the short form</button></p>
      ) : draft.style === 'intervals' ? (
        <div className="add-row">
          <SmallField id={`${ids}-repeats`} label="Repeats" value={draft.repeats} onChange={(repeats) => set({ repeats })} />
          <SmallField id={`${ids}-rep`} label="Each" value={draft.repMeters} suffix="m" onChange={(repMeters) => set({ repMeters })} />
          <SmallField id={`${ids}-jog`} label="Jog between" value={draft.recovery} onChange={(recovery) => set({ recovery })} />
        </div>
      ) : (
        <div className="add-row">
          <div className={draft.measure === 'time' ? 'add-measure on' : 'add-measure'}>
            <SmallField id={`${ids}-time`} label="How long" value={draft.measure === 'time' ? draft.time : ''} suffix="min"
              onChange={(time) => set({ measure: 'time', time })} />
          </div>
          <span className="add-or muted">or</span>
          <div className={draft.measure === 'distance' ? 'add-measure on' : 'add-measure'}>
            <SmallField id={`${ids}-distance`} label="How far" value={draft.measure === 'distance' ? draft.distance : ''} suffix={unit}
              onChange={(distance) => set({ measure: 'distance', distance })} />
          </div>
        </div>
      )}
      {!draft.custom && (
        <div className="add-row">
          <div className="field small-field">
            <label htmlFor={`${ids}-target`}>Keep it at (optional)</label>
            <select id={`${ids}-target`} value={draft.target} onChange={(event) => set({ target: event.target.value as TargetChoice })}>
              {TARGETS.map((target) => <option key={target.value} value={target.value}>{target.label}</option>)}
            </select>
          </div>
          {draft.target === 'heart_rate' && (
            <span className="add-range">
              <input className="short" inputMode="numeric" aria-label="Lowest heart rate" value={draft.low} onChange={(event) => set({ low: event.target.value })} />
              <span aria-hidden="true">to</span>
              <input className="short" inputMode="numeric" aria-label="Highest heart rate" value={draft.high} onChange={(event) => set({ high: event.target.value })} />
              <span className="muted">bpm</span>
            </span>
          )}
          {draft.target === 'pace' && (
            <span className="add-range">
              <input className="short" aria-label={`Fastest pace per ${unit}`} placeholder="7:30" value={draft.fastest} onChange={(event) => set({ fastest: event.target.value })} />
              <span aria-hidden="true">to</span>
              <input className="short" aria-label={`Slowest pace per ${unit}`} placeholder="8:00" value={draft.slowest} onChange={(event) => set({ slowest: event.target.value })} />
              <span className="muted">/{unit}</span>
            </span>
          )}
        </div>
      )}
      {lines.length > 0 && <ul className="steps add-steps">{lines.map((line, index) => <li key={index}>{line}</li>)}</ul>}
      <button type="button" className="link" disabled={busy || !result.ok} onClick={onSteps}>
        {draft.custom ? 'Change the steps' : '+ Warm-up, repeats or cool-down'}
      </button>
      {draft.style === 'intervals' && !draft.custom && <p className="fine muted">Each repeat’s distance is in meters. Ten easy minutes go before and after.</p>}
      {draft.style === 'tempo' && !draft.custom && <p className="fine muted">Ten easy minutes go before and after the tempo.</p>}
    </div>
  );
}

/** The full step editor on the run as it stands, for a warm-up, repeats or
 * a cool-down. Its steps replace the short form until that is chosen again. */
function StepsEditor({ draft, miles, busy, onSave, onCancel }: {
  draft: RunDraft; miles: boolean; busy: boolean; onSave: (items: RunPlanItem[] | null) => void; onCancel: () => void;
}) {
  const result = runItems(draft, miles);
  const slot = { exercise_name: 'this run', run_steps: result.ok ? JSON.stringify(result.items) : null } as unknown as Slot;
  return <RunPlanEditor slot={slot} miles={miles} busy={busy} onCancel={onCancel} onSave={onSave}
    week={{ title: `Steps of ${runName(draft, result.ok ? result.items : [], miles)}`, save: 'Use these steps', changed: false }} />;
}

function EnduranceFields({ ids, kind, draft, miles, onChange }: {
  ids: string; kind: 'ride' | 'swim'; draft: EnduranceDraft; miles: boolean; onChange: (draft: EnduranceDraft) => void;
}) {
  return (
    <div className="add-fields">
      <div className="add-row">
        <div className={draft.measure === 'time' ? 'add-measure on' : 'add-measure'}>
          <SmallField id={`${ids}-minutes`} label="How long" value={draft.measure === 'time' ? draft.minutes : ''} suffix="min"
            onChange={(minutes) => onChange({ ...draft, measure: 'time', minutes })} />
        </div>
        <span className="add-or muted">or</span>
        <div className={draft.measure === 'distance' ? 'add-measure on' : 'add-measure'}>
          <SmallField id={`${ids}-far`} label="How far" value={draft.measure === 'distance' ? draft.distance : ''} suffix={enduranceUnit(kind, miles)}
            onChange={(distance) => onChange({ ...draft, measure: 'distance', distance })} />
        </div>
      </div>
      <p className="fine muted">A {kind} you record or sync that day counts as this one.</p>
    </div>
  );
}

function ExerciseSearch<T extends { id: string; name: string }>({ id, label, query, onQuery, matches, onAdd }: {
  id: string; label: string; query: string; onQuery: (query: string) => void; matches: T[]; onAdd: (exercise: T) => void;
}) {
  return (
    <div className="add-search">
      <label htmlFor={id}>{label}</label>
      <input id={id} type="search" value={query} placeholder="Search exercises" onChange={(event) => onQuery(event.target.value)}
        onKeyDown={(event) => { if (event.key === 'Enter') event.preventDefault(); }} />
      {query.trim() && (
        <ul className="matches">
          {matches.map((exercise) => (
            <li key={exercise.id}><button type="button" onClick={() => onAdd(exercise)}>{exercise.name}<span>Add</span></button></li>
          ))}
          {matches.length === 0 && <li className="muted">No exercise matches that.</li>}
        </ul>
      )}
    </div>
  );
}

/** Saved workouts by what they are, each with its own Add. */
function SavedList({ workouts, unavailable, busy, action, onAdd }: {
  workouts: Workout[]; unavailable?: (workout: Workout) => string | null; busy: boolean; action: string; onAdd: (workout: Workout) => void;
}) {
  const groups: Array<[string, Workout[]]> = [
    ['Runs', workouts.filter(isRunOnlyWorkout)],
    ['Workouts', workouts.filter((workout) => !isRunOnlyWorkout(workout) && workout.exercises.length > 0)],
    ['Activities', workouts.filter((workout) => workout.exercises.length === 0)],
  ];
  if (workouts.length === 0) return <p className="muted">No workout matches that search.</p>;
  return (
    <>
      {groups.filter(([, list]) => list.length > 0).map(([title, list]) => (
        <div key={title} className="every-day-group">
          <p className="kicker">{title}</p>
          <ul>
            {list.map((workout) => {
              const reason = unavailable?.(workout) ?? null;
              return (
                <li key={workout.id}>
                  <div><strong>{workout.name}</strong><small className="muted">{reason ?? workoutSummary(workout)}</small></div>
                  <button type="button" className="ghost small" disabled={busy || !!reason}
                    aria-label={`${action}: ${workout.name}`} onClick={() => onAdd(workout)}>Add</button>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </>
  );
}
