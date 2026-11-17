import { useMemo, useState } from 'react';
import type { TrainingProgram } from '../../src/types';
import { planWrites, type StateResponse } from './api';
import {
  applyingRamp,
  currentWeek,
  editableFields,
  FIELD_LABELS,
  formatSeconds,
  formatValue,
  parseSeconds,
  programBody,
  rampValues,
  roundFor,
  shortDate,
  slotUnit,
  startChoices,
  weekChanges,
  weekValue,
  type ProgramBody,
  type Ramp,
  type TargetField,
} from './blocks';
import { planBlocks } from './event';
import { ownForm, trimmedSchedule } from './blockLayers';
import type { Slot, Workout } from './model';
import type { Write } from './WorkoutEditor';
import { useEditorDraft } from './useEditorDraft';
import { blockComparison, blockDraftProblem, blockInputErrors, blockSlotIdentities, changingBlockInput, isBlockDraft, parsedTargetInput, reconcileBlockInputs, resettingBlockInputs, resolveBlockInputs, targetInputKey, type BlockDraft } from './blockDrafts';

export type BlockEditor = ReturnType<typeof useBlockEditor>;

/**
 * The block being edited on the Plan page: the saved block, or the draft
 * kept in this browser until it is saved as one change. Edits stay on the
 * page until saved.
 */
export function useBlockEditor({ state, write, busy, today, accountId }: {
  accountId: string;
  state: StateResponse;
  write: Write;
  busy: boolean;
  today: string;
}) {
  const plan = state.plan;
  const version = plan?.version ?? 0;
  const planId = plan?.id ?? 'none';
  const retained = useEditorDraft<BlockDraft>({ accountId, planId, documentId: 'block' }, isBlockDraft);
  const { program } = useMemo(() => planBlocks(state), [state]);
  const workouts = useMemo(() => (plan?.workouts ?? []) as Workout[], [plan]);
  if (retained.unreadable) return { kind: 'unreadable' as const, clear: () => retained.clear() };
  if (!plan || (!program && !retained.record)) return { kind: 'none' as const };
  const saved: TrainingProgram = program ?? { ...retained.record!.value.saved, id: retained.record!.value.programId };
  const currentProgramId = program?.id ?? null;

  // The block is edited as only what it owns; the every-week row is the
  // schedule's, and is laid back over it by the server on every save.
  const savedBody = program ? ownForm(saved, plan.schedule) : programBody(saved);
  const storedDraft = retained.record?.value.draft ?? savedBody;
  const inputs = retained.record?.value.inputs ?? {};
  const inputErrors = blockInputErrors(inputs, workouts);
  const problem = retained.record
    ? blockDraftProblem(retained.record.value, currentProgramId, workouts)
      ?? (Array.isArray(savedBody.workout_ids) && !Array.isArray(storedDraft.workout_ids)
        ? 'This block now keeps its own workouts apart from your every-week row. Your draft was made before that and cannot be saved over it. Discard it to work with the block as it is.'
        : null)
    : null;
  const draft = problem ? storedDraft : resolveBlockInputs(storedDraft, inputs, workouts);
  const initialDraft = (): BlockDraft => ({ programId: saved.id, saved: savedBody, draft, identities: blockSlotIdentities(workouts) });
  const setDraft = (next: ProgramBody) => {
    const keptInputs = reconcileBlockInputs(inputs, draft, next, workouts);
    if (!Object.keys(keptInputs).length && JSON.stringify(programBody(next)) === JSON.stringify(savedBody)) { retained.clear(); return; }
    retained.save({ ...(retained.record?.value ?? initialDraft()), draft: next, inputs: keptInputs }, retained.record?.version ?? version);
  };
  const editInput = (workout: Workout, slot: Slot, index: number, field: TargetField, text: string) => {
    retained.save(changingBlockInput({ ...(retained.record?.value ?? initialDraft()), draft }, workouts, workout, slot, index, field, text), retained.record?.version ?? version);
  };
  const resetInputs = (workout: Workout, slot: Slot, index: number, fields: TargetField[]) => {
    const next = resettingBlockInputs({ ...(retained.record?.value ?? initialDraft()), draft }, workout, slot, index, fields);
    if (!Object.keys(next.inputs ?? {}).length && JSON.stringify(programBody(next.draft)) === JSON.stringify(savedBody)) retained.clear();
    else retained.save(next, retained.record?.version ?? version);
  };
  const needsReview = !!retained.record && retained.record.version !== version;
  const comparisons = needsReview ? blockComparison(savedBody, draft, workouts) : [];
  const dirty = Object.keys(inputs).length > 0 || JSON.stringify(programBody(draft)) !== JSON.stringify(savedBody);
  const thisWeek = currentWeek({ ...draft, id: saved.id }, today);
  const canSave = dirty && !busy && !needsReview && !problem && inputErrors.length === 0;

  const save = async () => {
    const captured = retained.record;
    if (!captured || captured.version !== version || problem || busy || inputErrors.length) return;
    const ok = await write(at => {
      if (at.planId !== planId || at.accountId !== accountId || at.version !== captured.version) throw new Error('draft_version_changed');
      const body = programBody(resolveBlockInputs(captured.value.draft, captured.value.inputs ?? {}, workouts));
      // A workout the block owns leaves the every-week row in the same change.
      return planWrites.setProgram(body, at, trimmedSchedule(plan.schedule, body.workout_ids));
    });
    if (ok) retained.clear(captured);
  };
  const discard = () => {
    if (window.confirm('Discard your unfinished block changes?')) retained.clear();
  };
  /** Ends the block, with one of its weeks carried on every week or not. */
  const end = (keepWeek: number | null) =>
    write((at) => keepWeek == null ? planWrites.clearProgram(at) : planWrites.endProgramKeeping(keepWeek, at))
      .then(ok => { if (ok) retained.clear(); return ok; });
  const useLatest = () => retained.save({ ...retained.record!.value, draft, saved: savedBody, identities: blockSlotIdentities(workouts) }, version);

  return {
    kind: 'block' as const,
    programId: saved.id,
    saved, savedBody, draft, setDraft, inputs, inputErrors, problem, needsReview, comparisons, dirty, canSave, thisWeek,
    layered: Array.isArray(draft.workout_ids),
    editInput, resetInputs, save, discard, end, useLatest,
  };
}

export type ActiveBlock = Extract<BlockEditor, { kind: 'block' }>;

/** Why a retained draft can't be saved as it is, and the comparison to review. */
export function BlockReview({ block, busy }: { block: ActiveBlock; busy: boolean }) {
  const { problem, needsReview, comparisons, inputErrors } = block;
  return <>
    {problem && <div className="panel" role="alert"><p>{problem}</p></div>}
    {needsReview && !problem && <section className="panel" aria-label="Review retained block draft">
      <h2>Review your retained draft</h2>
      <p>Your plan changed. Compare the current saved block with your proposed block before continuing. Nothing has been reapplied.</p>
      {comparisons.length ? <div className="block-grid-wrap"><table><thead><tr><th>Setting</th><th>Current saved</th><th>Your draft</th></tr></thead>
        <tbody>{comparisons.map(row => <tr key={row.key}><th scope="row">{row.label}</th><td>{row.current}</td><td>{row.proposed}</td></tr>)}</tbody></table></div>
        : <p>The block values match. Review any changed saved-workout targets below.</p>}
      <button type="button" className="ghost" disabled={busy || inputErrors.length > 0} onClick={block.useLatest}>Use draft with latest block</button>
    </section>}
    {inputErrors.length > 0 && <ul role="alert" className="problem">{inputErrors.map((error, i) => <li key={i}>{error}</li>)}</ul>}
  </>;
}

/** The block's name and first Monday. */
export function BlockSettings({ block, today }: { block: ActiveBlock; today: string }) {
  const { draft, setDraft } = block;
  const starts = useMemo(() => {
    const list = startChoices(today);
    return list.includes(draft.start) ? list : [draft.start, ...list];
  }, [today, draft.start]);
  return (
    <div className="block-settings field-row">
      <div className="field">
        <label htmlFor="block-name">Name</label>
        <input id="block-name" value={draft.name ?? ''} maxLength={60}
          onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="Your block" />
      </div>
      <div className="field">
        <label htmlFor="block-start">Starts</label>
        <select id="block-start" value={draft.start} onChange={(e) => setDraft({ ...draft, start: e.target.value })}>
          {starts.map((monday) => <option key={monday} value={monday}>{shortDate(monday)}</option>)}
        </select>
      </div>
    </div>
  );
}

export function TargetsByWeek({ draft, workouts, onChange, inputs, onInput, onReset, initialWorkoutId, onClose }: {
  /** The workout shown first; remount (a new key) to show another. */
  initialWorkoutId?: string;
  onClose?: () => void;
  onReset: (workout: Workout, slot: Slot, index: number, fields: TargetField[]) => void;
  inputs: Record<string, string>;
  onInput: (workout: Workout, slot: Slot, index: number, field: TargetField, text: string) => void;
  draft: ProgramBody;
  workouts: Workout[];
  onChange: (next: ProgramBody) => void;
}) {
  const [workoutId, setWorkoutId] = useState<string>(initialWorkoutId ?? workouts[0]?.id ?? '');
  const workout = workouts.find((w) => w.id === workoutId) ?? workouts[0];
  const slots = (workout?.exercises ?? []) as Slot[];
  const [slotId, setSlotId] = useState<string>('');
  const slot = slots.find((s) => s.id === slotId) ?? slots.find((s) => editableFields(s).length > 0);
  const fields = slot ? editableFields(slot) : [];

  return (
    <section className="block-targets panel" aria-labelledby="block-targets-title">
      <div className="section-head">
        <h2 id="block-targets-title">{workout ? `${workout.name}, week by week` : 'Targets by week'}</h2>
        {onClose && <button type="button" className="ghost small" onClick={onClose}>Close</button>}
      </div>
      <p className="muted">
        Give any exercise its own sets, reps, load or time in each week. A blank week keeps the workout’s own target.
      </p>
      {!workout ? (
        <p className="muted">Put a workout in the block’s weeks to change its targets.</p>
      ) : (
        <>
          <div className="field-row">
            <div className="field">
              <label htmlFor="targets-workout">Workout</label>
              <select id="targets-workout" value={workout.id} onChange={(e) => { setWorkoutId(e.target.value); setSlotId(''); }}>
                {workouts.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
              </select>
            </div>
            <div className="field">
              <label htmlFor="targets-slot">Exercise</label>
              <select id="targets-slot" value={slot?.id ?? ''} onChange={(e) => setSlotId(e.target.value)}>
                {slots.map((s) => (
                  <option key={s.id} value={s.id} disabled={editableFields(s).length === 0}>
                    {s.exercise_name}{editableFields(s).length === 0 ? ' (choose its week in the table)' : ''}
                  </option>
                ))}
              </select>
            </div>
          </div>
          {slot && fields.length > 0 ? (
            <>
              <RampTool key={`${slot.id}:${draft.weeks.length}`} draft={draft} workout={workout} slot={slot} fields={fields} onChange={onChange} />
              <div className="block-grid-wrap">
                <table className="block-targets-table">
                  <thead>
                    <tr>
                      <th scope="col">Week</th>
                      {fields.map((f) => <th key={f} scope="col">{FIELD_LABELS[f]}{f === 'target_weight' ? ` (${slotUnit(slot)})` : ''}</th>)}
                      <th scope="col"><span className="visually-hidden">Reset</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {draft.weeks.map((week, index) => {
                      const changed = fields.some((f) => weekChanges(draft, index, slot, f));
                      return (
                        <tr key={index}>
                          <th scope="row">
                            {index + 1}{week.label ? <span className="muted"> · {week.label}</span> : null}
                          </th>
                          {fields.map((field) => (
                            <td key={field} className={weekChanges(draft, index, slot, field) ? 'changed' : undefined}>
                              <TargetInput
                                key={`${slot.id}:${index}:${field}`}
                                field={field}
                                value={weekValue(draft, index, slot, field)}
                                label={`Week ${index + 1} ${FIELD_LABELS[field]}`}
                                text={inputs[targetInputKey(slot.id, index, field)]}
                                valid={inputs[targetInputKey(slot.id, index, field)] === undefined || !!parsedTargetInput(inputs[targetInputKey(slot.id, index, field)]!, field, slot)}
                                onChange={text => onInput(workout, slot, index, field, text)}
                              />
                            </td>
                          ))}
                          <td>
                            {changed && (
                              <button type="button" className="ghost small" onClick={() => onReset(workout, slot, index, fields)}>Reset</button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          ) : (
            <p className="muted">This workout has nothing to change by week here. To change a planned run, choose its week in the table above.</p>
          )}
        </>
      )}
    </section>
  );
}

function TargetInput({ field, value, label, text, valid, onChange }: {
  field: TargetField;
  value: number | null;
  label: string;
  text?: string;
  valid: boolean;
  onChange: (text: string) => void;
}) {
  const shown = value == null ? '' : field === 'target_duration_s' ? formatSeconds(value) : String(value);
  return <input aria-label={label} aria-invalid={!valid} className="short"
    inputMode={field === 'target_duration_s' ? 'text' : 'decimal'}
    placeholder={field === 'target_duration_s' ? 'm:ss' : ''} value={text ?? shown}
    onChange={event => onChange(event.target.value)}
    onKeyDown={event => { if (event.key === 'Enter') event.preventDefault(); }} />;
}

const STEP_UNITS: Record<TargetField, string> = {
  target_sets: 'sets',
  target_reps: 'reps',
  target_weight: '',
  target_duration_s: 'min',
};

function RampTool({ draft, workout, slot, fields, onChange }: {
  draft: ProgramBody;
  workout: Workout;
  slot: Slot;
  fields: TargetField[];
  onChange: (next: ProgramBody) => void;
}) {
  const unit = slotUnit(slot);
  const [field, setField] = useState<TargetField>(fields.includes('target_duration_s') ? 'target_duration_s' : fields.includes('target_weight') && slot.target_weight ? 'target_weight' : fields[fields.length - 1]!);
  const [fromWeek, setFromWeek] = useState(1);
  const startValue = weekValue(draft, fromWeek - 1, slot, field);
  const [startText, setStartText] = useState<string | null>(null);
  const [kind, setKind] = useState<'percent' | 'amount'>('percent');
  const [stepText, setStepText] = useState('5');
  const [easyEvery, setEasyEvery] = useState<number | null>(4);
  const [easyPercent, setEasyPercent] = useState('80');
  const [ceilingText, setCeilingText] = useState('');

  const parse = (text: string): number | null => {
    if (!text.trim()) return null;
    const n = field === 'target_duration_s' ? parseSeconds(text) : Number(text);
    return n != null && Number.isFinite(n) && n > 0 ? n : null;
  };
  const shownStart = startText ?? (startValue == null ? '' : field === 'target_duration_s' ? formatSeconds(startValue) : String(startValue));
  const start = parse(shownStart);
  const stepNumber = Number(stepText);
  const stepValue = kind === 'amount' && field === 'target_duration_s' ? stepNumber * 60 : stepNumber;
  const typedCeiling = parse(ceilingText);
  // Sets and reps are whole numbers, so their ceiling is too.
  const ceiling = typedCeiling != null && (field === 'target_sets' || field === 'target_reps') ? Math.max(1, Math.floor(typedCeiling)) : typedCeiling;
  const easy = Number(easyPercent);
  const ramp: Ramp | null = start != null && Number.isFinite(stepNumber) && stepNumber >= 0 && Number.isFinite(easy) && easy > 0 && easy <= 100
    ? { fromWeek, start, step: { kind, value: stepValue }, easyEvery, easyPercent: easy, ceiling }
    : null;
  const preview = ramp ? rampValues(ramp, draft.weeks.length, (v) => roundFor(field, v, unit, ramp.start)) : [];

  return (
    <details className="block-ramp">
      <summary>Ramp one target by a percent, or up to a limit</summary>
      <p className="muted fine">Grow a target week by week, with an easier week every few weeks. You can still change any week after.</p>
      <div className="field-row">
        <div className="field">
          <label htmlFor="ramp-field">Target</label>
          <select id="ramp-field" value={field} onChange={(e) => { setField(e.target.value as TargetField); setStartText(null); setCeilingText(''); }}>
            {fields.map((f) => <option key={f} value={f}>{FIELD_LABELS[f]}</option>)}
          </select>
        </div>
        <div className="field">
          <label htmlFor="ramp-from">From week</label>
          <select id="ramp-from" value={fromWeek} onChange={(e) => { setFromWeek(Number(e.target.value)); setStartText(null); }}>
            {draft.weeks.map((_, i) => <option key={i} value={i + 1}>{i + 1}</option>)}
          </select>
        </div>
        <div className="field">
          <label htmlFor="ramp-start">Starting at{field === 'target_weight' ? ` (${unit})` : ''}</label>
          <input id="ramp-start" className="short" value={shownStart} placeholder={field === 'target_duration_s' ? 'm:ss' : ''}
            onChange={(e) => setStartText(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="ramp-step">Each week add</label>
          <div className="inline-fields">
            <input id="ramp-step" className="short" inputMode="decimal" value={stepText} onChange={(e) => setStepText(e.target.value)} />
            <select aria-label="Step kind" value={kind} onChange={(e) => setKind(e.target.value as 'percent' | 'amount')}>
              <option value="percent">%</option>
              <option value="amount">{field === 'target_weight' ? unit : STEP_UNITS[field]}</option>
            </select>
          </div>
        </div>
        <div className="field">
          <label htmlFor="ramp-easy">Easier week</label>
          <div className="inline-fields">
            <select id="ramp-easy" value={easyEvery ?? 0} onChange={(e) => setEasyEvery(Number(e.target.value) || null)}>
              <option value={0}>None</option>
              <option value={3}>Every 3rd</option>
              <option value={4}>Every 4th</option>
              <option value={5}>Every 5th</option>
            </select>
            {easyEvery != null && (
              <input aria-label="Easier week, percent of the week before" className="short" inputMode="decimal"
                value={easyPercent} onChange={(e) => setEasyPercent(e.target.value)} />
            )}
          </div>
        </div>
        <div className="field">
          <label htmlFor="ramp-ceiling">Up to (optional)</label>
          <input id="ramp-ceiling" className="short" value={ceilingText} placeholder={field === 'target_duration_s' ? 'm:ss' : ''}
            onChange={(e) => setCeilingText(e.target.value)} />
        </div>
      </div>
      {easyEvery != null && <p className="muted fine">An easier week is {easyPercent || '–'}% of the week before it.</p>}
      {preview.length > 0 && (
        <p className="block-ramp-preview">
          {preview.map((value, i) => (
            <span key={i}><span className="muted">W{fromWeek + i}</span> {formatValue(field, value, unit)}</span>
          ))}
        </p>
      )}
      <button type="button" className="primary" disabled={!ramp}
        onClick={() => { if (ramp) onChange(applyingRamp(draft, workout, slot, field, ramp)); }}>
        Fill weeks {fromWeek} to {draft.weeks.length}
      </button>
    </details>
  );
}
