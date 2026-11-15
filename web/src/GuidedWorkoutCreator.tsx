import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { createPrescribedWorkout, SignedOutError } from './api';
import { factsOfCatalog, searchCatalog, type WeightUnit } from './editing';
import { SlotFields } from './SlotFields';
import { useEditorDraft } from './useEditorDraft';
import { CREATION_DOCUMENT_ID, editorDraftStore } from './editorDrafts';
import { addLiftingExercise, buildLiftingPrescription, initialLiftingDraft, isRetainedLiftingDraft, liftingDraftFromPrescription, liftingErrors, liftingExercise, liftingTargetSummary, moveLiftingExercise, type LiftingDraft } from './liftingDraft';
import { buildPrescription, creationFailure, creationReview, draftFromPrescription, guidedErrors, guidedTarget, prescriptionAuthority,
  HOME_STARTS, initialGuidedDraft, isEquipmentFree, isTimed, readPendingCreation, savePendingCreation, transitionPendingCreation,
  type GuidedDraft, type HomeStart, type PendingCreation, type StoredCreation } from './guidedWorkout';
import type { Catalog } from './WorkoutEditor';
import type { Workout } from './model';
import { routineTimerPreview } from './routineTimerPreview';
import { RoutineTimerPreview } from './RoutineTimerPreviewPanel';
import './guidedWorkout.css';

function stored(accountId: string): StoredCreation {
  try { return readPendingCreation(sessionStorage, accountId); } catch { return null; }
}
function persist(accountId: string, pending: PendingCreation | null): boolean {
  try { return savePendingCreation(sessionStorage, accountId, pending); } catch { return false; }
}

export function GuidedWorkoutCreator({ accountId, planId, version, catalog, busy, workouts, reload, onSelect, onSignedOut, customForm, unit = 'lb' }: {
  accountId: string; planId: string | null; version: number; catalog: Catalog; unit?: WeightUnit; busy: boolean; workouts: Workout[];
  reload: () => Promise<void>; onSelect: (id: string) => void; onSignedOut: (error?: unknown) => void; customForm: ReactNode;
}) {
  const [pending, setPending] = useState<StoredCreation>(() => stored(accountId));
  // A planless request may already have created the plan. Retire its original
  // draft after the receipt, even when the retry mounts with that new plan.
  const [draftScope, setDraftScope] = useState(() => ({ accountId,
    planId: pending && pending !== 'unreadable' && pending.kind === 'lifting' ? pending.request.expected_plan_id : planId,
    documentId: CREATION_DOCUMENT_ID }));
  const retained = useEditorDraft(draftScope, isRetainedLiftingDraft);
  const [mode, setMode] = useState<'choose' | 'run' | 'home' | 'lifting' | 'custom'>(() => pending && pending !== 'unreadable'
    ? pending.kind ?? draftFromPrescription(pending.request).kind : retained.record ? 'lifting' : 'choose');
  const [draft, setDraft] = useState<GuidedDraft>(() => pending && pending !== 'unreadable'
    ? draftFromPrescription(pending.request) : initialGuidedDraft('core'));
  const [lifting, setLifting] = useState<LiftingDraft>(() => pending && pending !== 'unreadable' && pending.kind === 'lifting'
    ? liftingDraftFromPrescription(pending.request) : retained.record?.value.draft ?? initialLiftingDraft());
  const [review, setReview] = useState(() => pending && pending !== 'unreadable'
    ? { at: { planId: pending.request.expected_plan_id, version: pending.request.expected_version }, recovery: 'none' as const }
    : retained.record?.value.review ?? { at: { planId, version }, recovery: 'none' as const });
  function updateReview(event: Parameters<typeof creationReview>[1]) {
    const next = creationReview(review, event);
    setReview(next);
    if (mode === 'lifting') retained.save({ draft: lifting, review: next }, next.at.version);
  }
  function updateLifting(next: LiftingDraft) {
    setLifting(next);
    retained.save({ draft: next, review }, review.at.version);
  }
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [storageFailed, setStorageFailed] = useState(false);
  const [neverSent, setNeverSent] = useState(false);
  const [libraryReviewed, setLibraryReviewed] = useState(false);
  const [query, setQuery] = useState('');
  const working = useRef(false), mounted = useRef(true);
  const prefix = useId();
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const catalogRows = catalog.kind === 'ready' ? catalog.exercises : [];
  const exercises = draft.exerciseIds.flatMap(id => catalogRows.find(exercise => exercise.id === id) ?? []);
  const errors = catalog.kind === 'ready' ? (mode === 'lifting' ? liftingErrors(lifting, catalogRows) : guidedErrors(draft, catalogRows)) : ['Wait for the exercise catalog before saving.'];
  const timerPreview = catalog.kind === 'ready' ? routineTimerPreview(draft, catalogRows) : null;
  // Restart the rehearsal in the same render as an edited prescription.
  // A post-render effect can briefly pair new targets with the old last step;
  // keying on values also preserves position during unrelated parent renders.
  const timerPreviewKey = JSON.stringify([draft, exercises.map(({ id, name, modality, laterality }) => ({ id, name, modality, laterality }))]);
  const authority = prescriptionAuthority(review, { planId, version });
  const changed = authority === null;
  const planReplaced = mode === 'lifting' && review.at.planId !== planId;
  const locked = busy || saving || !!pending;
  const update = (fields: Partial<GuidedDraft>) => setDraft(current => ({ ...current, ...fields }));

  function remember(next: PendingCreation | null, expectedId: string | null) {
    let result: 'saved' | 'stale' | 'unavailable' = 'unavailable';
    try { result = transitionPendingCreation(sessionStorage, accountId, expectedId, next); } catch { /* Storage unavailable. */ }
    if (mounted.current) {
      if (result === 'stale') setPending(stored(accountId));
      else setPending(next);
      setStorageFailed(result === 'unavailable');
    }
    return result;
  }
  function clearReviewedRequest(openId?: string) {
    if (!persist(accountId, null)) { setMessage('The local request could not be cleared. Enable session storage and try again.'); return; }
    if (pending && pending !== 'unreadable' && pending.kind === 'lifting') retained.clear();
    setPending(null); setMode('choose'); setMessage(null); setLibraryReviewed(false);
    if (openId) onSelect(openId);
  }
  function choose(start: HomeStart | 'run') {
    setDraft(initialGuidedDraft(start)); setMode(start === 'run' ? 'run' : 'home');
    updateReview({ kind: 'new_draft', at: { planId, version } }); setMessage(null); setQuery('');
  }
  function chooseLifting() {
    if (retained.record) {
      setLifting(retained.record.value.draft); setReview(retained.record.value.review);
    } else {
      const next = initialLiftingDraft(), nextReview = { at: { planId, version }, recovery: 'none' as const };
      setLifting(next); setReview(nextReview);
      const scope = { accountId, planId, documentId: CREATION_DOCUMENT_ID };
      setDraftScope(scope);
      editorDraftStore.write(scope, null, { draft: next, review: nextReview }, version);
    }
    setMode('lifting'); setMessage(null); setQuery('');
  }
  function discardLifting() {
    if (retained.record?.dirty && !window.confirm('Discard your unfinished lifting workout?')) return;
    retained.clear(); setDraftScope({ accountId, planId, documentId: CREATION_DOCUMENT_ID });
    setLifting(initialLiftingDraft()); setMode('choose'); setMessage(null);
  }
  async function refresh(savedId?: string) {
    if (working.current) return;
    working.current = true; setSaving(true);
    try {
      await reload();
      if (mounted.current) {
        setLibraryReviewed(true);
        if (review.recovery !== 'none') updateReview({ kind: 'refreshed' });
      }
      if (mounted.current && savedId) onSelect(savedId);
      else if (mounted.current) setMessage(review.recovery !== 'none'
        ? 'Plan refreshed. Review your draft with the latest plan before saving.'
        : 'Plan refreshed. Check the workout library before making another workout.');
    } catch (error) {
      if (mounted.current) {
        if (error instanceof SignedOutError) onSignedOut(error);
        else {
          if (review.recovery !== 'none') updateReview({ kind: 'refresh_failed' });
          setMessage(savedId ? 'Saved, but the plan could not be refreshed. Reload the saved workout below.' : 'The plan could not be refreshed. Your draft is kept. Use Refresh plan to try again.');
        }
      }
    } finally { working.current = false; if (mounted.current) setSaving(false); }
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (working.current || busy || pending === 'unreadable' || pending?.status === 'blocked' || pending?.status === 'saved') return;
    const request = pending?.request ?? (authority ? mode === 'lifting' ? buildLiftingPrescription(lifting, catalogRows, authority) : buildPrescription(draft, catalogRows, authority) : null);
    if (!request) return;
    const metadata = pending?.kind === 'lifting' || mode === 'lifting' ? { kind: 'lifting' as const } : {};
    const reviewedDraft = retained.record;
    working.current = true; setSaving(true); setMessage(null);
    // Persist before sending: navigation or a lost response must retain all UUIDs.
    const retention = remember({ request, ...metadata, status: 'pending' }, pending && !neverSent ? request.workout_id : null);
    if (retention !== 'saved') {
      if (retention === 'unavailable') {
        if (!pending || neverSent) setNeverSent(true);
        setMessage('This attempt was not sent. Enable session storage and retry, or create the workout in the iPhone app.');
      }
      working.current = false; setSaving(false); return;
    }
    setNeverSent(false);
    try {
      await createPrescribedWorkout(request, accountId);
      remember({ request, ...metadata, status: 'saved' }, request.workout_id);
      if (metadata.kind && reviewedDraft) retained.clear(reviewedDraft);
      if (!mounted.current) return;
      // Selection is the acknowledged UUID, even when a subsequent read fails.
      onSelect(request.workout_id);
      try { await reload(); }
      catch (error) {
        if (mounted.current) {
          if (error instanceof SignedOutError) onSignedOut(error);
          else setMessage('Saved, but the plan could not be refreshed. Reload the saved workout below.');
        }
      }
    } catch (error) {
      if (error instanceof SignedOutError) { if (mounted.current) onSignedOut(error); return; }
      const failure = creationFailure(error);
      if (failure === 'review') {
        remember(null, request.workout_id);
        if (!mounted.current) return;
        updateReview({ kind: 'refused' });
        setMessage('Nothing was saved by this request. Review the targets and latest plan before saving again.');
        try {
          await reload();
          if (mounted.current) updateReview({ kind: 'refreshed' });
        } catch (refreshError) {
          if (mounted.current) {
            if (refreshError instanceof SignedOutError) onSignedOut(refreshError);
            else {
              updateReview({ kind: 'refresh_failed' });
              setMessage('Nothing was saved by this request, and the latest plan could not load. Your draft is kept. Refresh the plan before reviewing and saving again.');
            }
          }
        }
      } else if (failure === 'blocked') {
        remember({ request, ...metadata, status: 'blocked' }, request.workout_id);
        if (mounted.current) setMessage('This request conflicts with a saved or changed workout. Check your workout library before creating another.');
      } else if (mounted.current) setMessage('The save could not be confirmed. Retry uses the same request to avoid a duplicate workout.');
    } finally { working.current = false; if (mounted.current) setSaving(false); }
  }

  if (pending === 'unreadable') return <article className="workout-editor guided-workout">
    <h2>Check your workout library</h2>
    <p>The earlier creation request could not be read. It may already have saved. Check your library before creating another workout.</p>
    <button type="button" className="ghost" disabled={saving} onClick={() => refresh()}>Refresh plan</button>
    {libraryReviewed && <div className="panel"><p>Clearing this local request does not delete any saved workouts.</p>
      <button type="button" className="ghost" disabled={saving} onClick={() => clearReviewedRequest()}>I checked my workouts — clear this request</button></div>}
    {message && <p role="status">{message}</p>}
  </article>;

  if (pending?.status === 'saved' || pending?.status === 'blocked') {
    const saved = pending.status === 'saved', found = workouts.some(workout => workout.id === pending.request.workout_id);
    const canOpen = found && (saved || libraryReviewed);
    return <article className="workout-editor guided-workout">
      <h2>{saved ? `${pending.request.name} is saved` : 'Check your workout library'}</h2>
      <p>{saved ? 'The workout was saved with the targets you reviewed. Refresh to open it and add it to your week.'
        : 'An earlier request may have saved, and its receipt no longer matches. This screen will not create another copy.'}</p>
      {message && <p role="status">{message}</p>}
      <button type="button" className="primary" disabled={saving} onClick={() => canOpen ? clearReviewedRequest(pending.request.workout_id) : refresh(saved ? pending.request.workout_id : undefined)}>
        {saving ? 'Refreshing…' : canOpen ? 'Open saved workout' : saved ? 'Reload saved workout' : 'Refresh workout library'}
      </button>
      {libraryReviewed && !found && <div className="panel"><p>Clearing this local request does not delete any saved workouts.</p>
        <button type="button" className="ghost" disabled={saving} onClick={() => clearReviewedRequest()}>I checked my workouts — clear this request</button></div>}
    </article>;
  }

  return <article className="workout-editor guided-workout" aria-labelledby={`${prefix}-title`}>
    <h2 id={`${prefix}-title`}>{mode === 'choose' ? 'Create a workout' : mode === 'custom' ? 'Custom workout' : 'Review your workout'}</h2>
    {mode === 'choose' ? <>
      <p className="muted">Choose exercises and review their targets, then choose when the workout belongs in your week.</p>
      <div className="guided-choices">
        <button type="button" className="ghost" disabled={busy || retained.unreadable} onClick={chooseLifting}><strong>Lifting</strong><span>Choose exercises and review each target before saving.</span></button>
        <button type="button" className="ghost" disabled={busy} onClick={() => choose('run')}><strong>Run</strong><span>Start with an open run.</span></button>
        <button type="button" className="ghost" disabled={busy} onClick={() => choose('core')}><strong>At home</strong><span>Core, stretching or a bodyweight circuit.</span></button>
        <button type="button" className="ghost" disabled={busy} onClick={() => setMode('custom')}><strong>Custom workout</strong><span>Name a workout and build it exercise by exercise.</span></button>
      </div>
      {retained.unreadable && <p role="alert">The retained lifting draft could not be read. <button type="button" className="ghost" onClick={discardLifting}>Discard lifting draft</button></p>}
    </> : mode === 'custom' ? <>
      <p className="muted">Create an empty workout, then use the detailed editor for exercises, loads, run steps and groups.</p>
      {customForm}
      <button type="button" className="ghost" disabled={busy} onClick={() => setMode('choose')}>Back</button>
    </> : <form onSubmit={submit}>
      <fieldset className="guided-fields" disabled={locked}>
        {mode === 'home' && <div className="guided-presets" role="group" aria-label="Home routine starting point">
          {(Object.keys(HOME_STARTS) as HomeStart[]).map(start => <button type="button" className="ghost" key={start} onClick={() => choose(start)}>{HOME_STARTS[start].title}</button>)}
        </div>}
        <label className="field">Workout name<input value={mode === 'lifting' ? lifting.name : draft.name} maxLength={200} onChange={event => mode === 'lifting' ? updateLifting({ ...lifting, name: event.target.value }) : update({ name: event.target.value })} /></label>
        {mode === 'lifting' ? <>
          <p className="muted">Review each exercise below. Loads and target RPE are optional. Save once all targets are ready; arrange supersets or circuits in the workout editor after saving.</p>
          <p className="muted">Create Outdoor Run separately with the Run starting point to schedule it alongside this workout.</p>
          <h3>Exercises and targets</h3>
          <ol className="lifting-exercises">{lifting.rows.map((row, index) => {
            const exercise = catalogRows.find(exercise => exercise.id === row.exerciseId);
            return <li key={row.exerciseId}>
              <details className="panel lifting-targets">
                <summary><strong>{index + 1}. {exercise?.name ?? 'Exercise unavailable'}</strong>
                  {exercise && <span className="muted">{liftingTargetSummary(row, exercise)}</span>}
                </summary>
                <fieldset aria-label={exercise?.name ?? 'Exercise unavailable'}>
                <div className="row-actions">
                  <button type="button" className="ghost" disabled={index === 0} aria-label={`Move ${exercise?.name ?? 'exercise'} up`} onClick={() => updateLifting(moveLiftingExercise(lifting, index, -1))}>↑</button>
                  <button type="button" className="ghost" disabled={index === lifting.rows.length - 1} aria-label={`Move ${exercise?.name ?? 'exercise'} down`} onClick={() => updateLifting(moveLiftingExercise(lifting, index, 1))}>↓</button>
                  <button type="button" className="ghost" aria-label={`Remove ${exercise?.name ?? 'exercise'}`} onClick={() => updateLifting({ ...lifting, rows: lifting.rows.filter(other => other.exerciseId !== row.exerciseId) })}>Remove</button>
                </div>
                {exercise && <SlotFields facts={factsOfCatalog(exercise)} draft={row.targets} onChange={targets => updateLifting({ ...lifting, rows: lifting.rows.map(other => other.exerciseId === row.exerciseId ? { ...row, targets } : other) })} />}
                </fieldset>
              </details>
            </li>;
          })}</ol>
          <section className="guided-picker" aria-label="Choose lifting exercises">
            <h3>Add exercises · {lifting.rows.length}/50</h3>
            <label className="field">Find a lifting exercise<input type="search" value={query} onChange={event => setQuery(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') event.preventDefault(); }} /></label>
            <ul className="matches">{searchCatalog(catalogRows.filter(liftingExercise), query).filter(exercise => !lifting.rows.some(row => row.exerciseId === exercise.id)).map(exercise => <li key={exercise.id}>
              <button type="button" disabled={lifting.rows.length >= 50} onClick={() => updateLifting(addLiftingExercise(lifting, exercise, unit))}>{exercise.name}<span>Add</span></button>
            </li>)}</ul>
            {catalog.kind === 'ready' && searchCatalog(catalogRows.filter(liftingExercise), query).filter(exercise => !lifting.rows.some(row => row.exerciseId === exercise.id)).length === 0 && <p className="muted">No more matching exercises. Try another name.</p>}
          </section>
        </> : <>
        {mode === 'run' ? <p>Open run — choose distance or intervals in the run editor after saving. Record the run in the iPhone app.</p> : <>
          <p className="muted">These starting targets are editable. No equipment or added load is required.</p>
          <label className="check"><input type="checkbox" checked={draft.circuit} onChange={event => update({ circuit: event.target.checked })} />Do one set of each exercise per round</label>
          <label className="check"><input type="checkbox" checked={draft.timeEveryExercise} onChange={event => update({ timeEveryExercise: event.target.checked })} />Time every exercise</label>
          <div className="guided-targets">
            <NumberField label={draft.circuit ? 'Rounds' : 'Sets per exercise'} value={draft.sets} onChange={sets => update({ sets })} />
            {exercises.some(exercise => !isTimed(draft, exercise)) && <NumberField label="Reps per set" value={draft.reps} onChange={reps => update({ reps })} />}
            {exercises.some(exercise => isTimed(draft, exercise)) && <NumberField label="Hold / work (seconds)" value={draft.seconds} onChange={seconds => update({ seconds })} />}
            {draft.circuit ? <>
              <NumberField label="Between exercises (seconds)" value={draft.transitionRest} onChange={transitionRest => update({ transitionRest })} />
              <NumberField label="After each round (seconds)" value={draft.roundRest} onChange={roundRest => update({ roundRest })} />
            </> : <NumberField label="Rest after each set (seconds)" value={draft.rest} onChange={rest => update({ rest })} />}
          </div>
        </>}
        <h3>Exercises and targets</h3>
        <ol className="guided-exercises">{draft.exerciseIds.map((id, index) => {
          const exercise = catalogRows.find(row => row.id === id);
          return <li key={id}><div><strong>{exercise?.name ?? 'Exercise unavailable'}</strong><span className="muted">{exercise ? guidedTarget(draft, exercise) : id}</span></div>
            {mode === 'home' && <div className="row-actions">
              <button type="button" className="ghost" aria-label={`Move ${exercise?.name ?? 'exercise'} up`} disabled={index === 0} onClick={() => {
                const ids = [...draft.exerciseIds]; [ids[index - 1], ids[index]] = [ids[index]!, ids[index - 1]!]; update({ exerciseIds: ids });
              }}>↑</button>
              <button type="button" className="ghost" onClick={() => update({ exerciseIds: draft.exerciseIds.filter(other => other !== id) })} aria-label={`Remove ${exercise?.name ?? 'exercise'}`}>Remove</button>
            </div>}
          </li>;
        })}</ol>
        {mode === 'home' && <details className="guided-picker">
          <summary>Add an exercise</summary>
          <label className="field">Find an exercise with no equipment<input type="search" value={query} onChange={event => setQuery(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') event.preventDefault(); }} /></label>
          <ul className="matches">{searchCatalog(catalogRows.filter(isEquipmentFree), query).filter(exercise => !draft.exerciseIds.includes(exercise.id)).map(exercise => <li key={exercise.id}>
            <button type="button" disabled={draft.exerciseIds.length >= 50} onClick={() => update({ exerciseIds: [...draft.exerciseIds, exercise.id] })}>{exercise.name}<span>Add</span></button>
          </li>)}</ul>
        </details>}
        </>}
      </fieldset>
      {mode === 'home' && <section className="panel" aria-labelledby={`${prefix}-timers`}>
        <h3 id={`${prefix}-timers`}>How the timers work on iPhone</h3>
        <p>{draft.circuit ? 'Do one set of each exercise per round. Transition rest follows each exercise; round rest follows the last.'
          : 'Finish the sets of one exercise before moving to the next. Rest follows each set.'}</p>
        <p>Tap Start for each timed set. When its timer finishes, the set logs automatically. Rest ending gives a cue; tap Start when you're ready for the next set.</p>
      </section>}
      {mode === 'home' && timerPreview && <RoutineTimerPreview key={timerPreviewKey} preview={timerPreview} />}
      {catalog.kind === 'error' && <p className="problem">The exercise catalog could not load. Reload this page to try again.</p>}
      {!pending && errors.length > 0 && <ul className="problem">{errors.map(error => <li key={error}>{error}</li>)}</ul>}
      {message && <p role="status">{message}</p>}
      {storageFailed && <p role="status">This browser could not retain the request across a reload. Keep this page open while resolving the storage issue.</p>}
      {pending && <p role="status">{neverSent ? 'This request has not been sent.' : 'The earlier save is unconfirmed.'} Your reviewed targets are locked; retry sends the same request.</p>}
      {!pending && planReplaced && <p role="alert">This draft belongs to a different plan. Its targets are kept for that plan. Discard the draft before starting a workout in the current plan.</p>}
      {!pending && changed && !planReplaced && <div className="panel"><p>{review.recovery === 'needs_refresh'
        ? 'Load the latest plan before reviewing this draft. Your exercise targets are kept.'
        : 'Review this draft against the latest plan. The exercise targets above have been kept.'}</p>
        {review.recovery === 'needs_refresh'
          ? <button type="button" className="ghost" disabled={saving} onClick={() => refresh()}>Refresh plan</button>
          : <button type="button" className="ghost" disabled={saving} onClick={() => updateReview({ kind: 'review', at: { planId, version } })}>Review with latest plan</button>}
      </div>}
      <div className="form-actions">
        <button type="submit" disabled={busy || saving || (!pending && (errors.length > 0 || changed))}>{saving ? 'Saving…' : pending ? 'Retry same save' : 'Save reviewed workout'}</button>
        {!pending && <button type="button" className="ghost" disabled={busy || saving} onClick={() => setMode('choose')}>Back</button>}
        {!pending && mode === 'lifting' && <button type="button" className="ghost" disabled={busy || saving} onClick={discardLifting}>Discard lifting draft</button>}
      </div>
    </form>}
  </article>;
}

function NumberField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return <label className="field">{label}<input inputMode="numeric" value={value} onChange={event => onChange(event.target.value)} /></label>;
}
