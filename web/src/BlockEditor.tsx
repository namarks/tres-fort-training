import { useMemo, useState, type FormEvent } from 'react';
import { addDays } from '../../src/calendarProjection';
import type { TrainingProgram } from '../../src/types';
import { planWrites, type StateResponse } from './api';
import {
  applyingRamp,
  currentWeek,
  editableFields,
  FIELD_LABELS,
  formatSeconds,
  formatValue,
  MAX_PROGRAM_WEEKS,
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
import type { Slot, Workout } from './model';
import type { Write } from './WorkoutEditor';
import { useEditorDraft } from './useEditorDraft';
import { isNewBlockDraft, NEW_BLOCK_DOCUMENT, newBlockDraft, newBlockRequest, type NewBlockDraft } from './programmingDrafts';
import { WEEKDAYS } from '../../src/types';
import { WEEKDAY_LABELS } from './model';
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

  const storedDraft = retained.record?.value.draft ?? programBody(saved);
  const inputs = retained.record?.value.inputs ?? {};
  const inputErrors = blockInputErrors(inputs, workouts);
  const problem = retained.record ? blockDraftProblem(retained.record.value, currentProgramId, workouts) : null;
  const draft = problem ? storedDraft : resolveBlockInputs(storedDraft, inputs, workouts);
  const initialDraft = (): BlockDraft => ({ programId: saved.id, saved: programBody(saved), draft, identities: blockSlotIdentities(workouts) });
  const setDraft = (next: ProgramBody) => {
    const keptInputs = reconcileBlockInputs(inputs, draft, next, workouts);
    if (!Object.keys(keptInputs).length && JSON.stringify(next) === JSON.stringify(programBody(saved))) { retained.clear(); return; }
    retained.save({ ...(retained.record?.value ?? initialDraft()), draft: next, inputs: keptInputs }, retained.record?.version ?? version);
  };
  const editInput = (workout: Workout, slot: Slot, index: number, field: TargetField, text: string) => {
    retained.save(changingBlockInput({ ...(retained.record?.value ?? initialDraft()), draft }, workouts, workout, slot, index, field, text), retained.record?.version ?? version);
  };
  const resetInputs = (workout: Workout, slot: Slot, index: number, fields: TargetField[]) => {
    const next = resettingBlockInputs({ ...(retained.record?.value ?? initialDraft()), draft }, workout, slot, index, fields);
    if (!Object.keys(next.inputs ?? {}).length && JSON.stringify(next.draft) === JSON.stringify(programBody(saved))) retained.clear();
    else retained.save(next, retained.record?.version ?? version);
  };
  const needsReview = !!retained.record && retained.record.version !== version;
  const comparisons = needsReview ? blockComparison(programBody(saved), draft, workouts) : [];
  const dirty = Object.keys(inputs).length > 0 || JSON.stringify(programBody(draft)) !== JSON.stringify(programBody(saved));
  const thisWeek = currentWeek({ ...draft, id: saved.id }, today);
  const canSave = dirty && !busy && !needsReview && !problem && inputErrors.length === 0;

  const save = async () => {
    const captured = retained.record;
    if (!captured || captured.version !== version || problem || busy || inputErrors.length) return;
    const ok = await write(at => {
      if (at.planId !== planId || at.accountId !== accountId || at.version !== captured.version) throw new Error('draft_version_changed');
      return planWrites.setProgram(programBody(resolveBlockInputs(captured.value.draft, captured.value.inputs ?? {}, workouts)), at);
    });
    if (ok) retained.clear(captured);
  };
  const discard = () => {
    if (window.confirm('Discard your unfinished block changes?')) retained.clear();
  };
  const end = () => {
    if (!window.confirm('End this block? Your usual week takes over again. Past workouts stay in your history.')) return;
    void write((at) => planWrites.clearProgram(at)).then(ok => { if (ok) retained.clear(); });
  };
  const useLatest = () => retained.save({ ...retained.record!.value, draft, saved: programBody(saved), identities: blockSlotIdentities(workouts) }, version);

  return {
    kind: 'block' as const,
    programId: saved.id,
    saved, draft, setDraft, inputs, inputErrors, problem, needsReview, comparisons, dirty, canSave, thisWeek,
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

/** The block's name, first Monday and whether it starts over. */
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
      <label className="check">
        <input type="checkbox" checked={draft.repeat} onChange={(e) => setDraft({ ...draft, repeat: e.target.checked })} />
        Start over when it ends
      </label>
    </div>
  );
}

/** One line about the block: where today is in it and when it ends. */
export function blockSummary(draft: ProgramBody, thisWeek: number | null): string {
  const lastDay = addDays(draft.start, draft.weeks.length * 7 - 1);
  const count = `${draft.weeks.length} ${draft.weeks.length === 1 ? 'week' : 'weeks'}`;
  const where = thisWeek != null ? `Week ${thisWeek + 1} of ${draft.weeks.length} · ` : `${count} · `;
  return `${where}${shortDate(draft.start)} to ${shortDate(lastDay)}${draft.repeat ? ', then starts over' : ', then your usual week'}`;
}

/** Start a block of weeks from the usual week. */
export function NewBlock({ state, workouts, write, busy, today, accountId, onCancel }: {
  accountId: string;
  onCancel?: () => void;
  state: StateResponse;
  workouts: Workout[];
  write: Write;
  busy: boolean;
  today: string;
}) {
  const choices = useMemo(() => startChoices(today), [today]);
  const planId = state.plan?.id ?? 'none';
  const version = state.plan?.version ?? 0;
  const retained = useEditorDraft<NewBlockDraft>({ accountId, planId, documentId: NEW_BLOCK_DOCUMENT }, isNewBlockDraft);
  const fresh = newBlockDraft(state.plan?.schedule, workouts, choices[0]!);
  const draft = retained.record?.value ?? fresh;
  const starts = choices.includes(draft.start) ? choices : [draft.start, ...choices];
  const exists = !!planBlocks(state).program;
  const needsReview = !!retained.record && retained.record.version !== version;
  const body = newBlockRequest(draft);
  const change = (patch: Partial<NewBlockDraft>) => retained.save({ ...draft, ...patch }, retained.record?.version ?? version);
  const cancel = () => {
    if (retained.record && !window.confirm('Discard your unfinished new block?')) return;
    retained.clear(); onCancel?.();
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!body || busy || needsReview || exists || !state.plan || retained.unreadable) return;
    const captured = retained.record ?? retained.save(draft, version);
    await write(async at => {
      if (at.planId !== planId || at.accountId !== accountId || at.version !== captured.version) throw new Error('draft_version_changed');
      await planWrites.setProgram(body, at);
      // Acknowledgement retires only this revision, even if the refresh fails.
      if (retained.clear(captured)) onCancel?.();
    });
  };
  const dayDescription = (value: NewBlockDraft, day: typeof WEEKDAYS[number]) => {
    const week = value.source.weeks[0]!;
    const ids = [week.week[day], ...(week.extras?.[day] ?? [])].filter((id): id is string => !!id);
    return ids.map(id => value.workoutNames[id] ?? 'Unavailable workout').join(' + ') || 'Rest';
  };
  if (retained.unreadable) return <section className="panel" role="alert">
    <p>This browser’s new-block draft could not be read. No change has been sent.</p>
    <button type="button" onClick={() => retained.clear()}>Discard unreadable new-block draft</button>
  </section>;
  return (
    <section className="block-intro panel" aria-labelledby="block-new-title">
      <h2 id="block-new-title">Start a training block</h2>
      <p>A block is a set number of weeks that can differ from each other: add load for three weeks, then take an easier one. It starts as copies of your usual week, and nothing changes until you start it.</p>
      {retained.record && <p className="muted">Your unfinished block is kept in this browser when you leave this page.</p>}
      {exists && <p role="alert" className="problem">A block has been saved since you started. Your new-block draft is kept below, but cannot replace that block. Discard this draft to work with the saved block.</p>}
      {needsReview && !exists && <section className="panel" aria-label="Review new-block draft">
        <h3>Review your usual week</h3>
        <p>Your plan changed. Your choices are kept. Review the week the new block will copy before continuing.</p>
        <div className="block-grid-wrap"><table><thead><tr><th>Day</th><th>Previously reviewed</th><th>Current usual week</th></tr></thead>
          <tbody>{WEEKDAYS.map(day => <tr key={day}><th scope="row">{WEEKDAY_LABELS[day]}</th><td>{dayDescription(draft, day)}</td><td>{dayDescription(fresh, day)}</td></tr>)}</tbody></table></div>
        <button type="button" className="ghost" disabled={busy} onClick={() => retained.save({ ...draft, source: fresh.source, workoutNames: fresh.workoutNames }, version)}>Use current week with my choices</button>
      </section>}
      <form className="block-new" onSubmit={submit}>
        <div className="field"><label htmlFor="block-new-name">Name (optional)</label>
          <input id="block-new-name" value={draft.name} maxLength={60} onChange={e => change({ name: e.target.value })} placeholder="Spring build" /></div>
        <div className="field-row">
          <div className="field"><label htmlFor="block-new-start">Starts</label>
            <select id="block-new-start" value={draft.start} onChange={e => change({ start: e.target.value })}>
              {starts.map(monday => <option key={monday} value={monday}>{monday === choices[0] ? `This week (${shortDate(monday)})` : monday === choices[1] ? `Next week (${shortDate(monday)})` : shortDate(monday)}</option>)}
            </select></div>
          <div className="field"><label htmlFor="block-new-weeks">Weeks</label>
            <input id="block-new-weeks" className="short" type="number" min={1} max={MAX_PROGRAM_WEEKS} value={draft.weeks} onChange={e => change({ weeks: e.target.value })} /></div>
        </div>
        <label className="check"><input type="checkbox" checked={draft.repeat} onChange={e => change({ repeat: e.target.checked })} />Start over when it ends</label>
        {!body && <p role="alert" className="problem">Choose a valid start and between 1 and {MAX_PROGRAM_WEEKS} whole weeks.</p>}
        <div className="form-actions">
          <button type="submit" disabled={busy || !body || needsReview || exists}>Start from my week</button>
          <button type="button" className="ghost" disabled={busy} onClick={cancel}>{retained.record ? 'Discard new-block draft' : 'Cancel'}</button>
        </div>
        <p className="muted fine">Then change any day on the calendar, give weeks their own targets, or ramp a target up week by week. Training for an event? <a href="#analysis/event">Set its date</a> to follow your progress toward it.</p>
      </form>
      <p className="muted fine">In the iPhone app, Plan a block can also lay out your runs to an event or keep building your long run. Those blocks show here too.</p>
    </section>
  );
}


export function TargetsByWeek({ draft, workouts, onChange, inputs, onInput, onReset }: {
  onReset: (workout: Workout, slot: Slot, index: number, fields: TargetField[]) => void;
  inputs: Record<string, string>;
  onInput: (workout: Workout, slot: Slot, index: number, field: TargetField, text: string) => void;
  draft: ProgramBody;
  workouts: Workout[];
  onChange: (next: ProgramBody) => void;
}) {
  const [workoutId, setWorkoutId] = useState<string>(workouts[0]?.id ?? '');
  const workout = workouts.find((w) => w.id === workoutId) ?? workouts[0];
  const slots = (workout?.exercises ?? []) as Slot[];
  const [slotId, setSlotId] = useState<string>('');
  const slot = slots.find((s) => s.id === slotId) ?? slots.find((s) => editableFields(s).length > 0);
  const fields = slot ? editableFields(slot) : [];

  return (
    <section className="block-targets" aria-labelledby="block-targets-title">
      <h2 id="block-targets-title">Targets by week</h2>
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
                    {s.exercise_name}{editableFields(s).length === 0 ? ' (steps change in the iPhone app)' : ''}
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
            <p className="muted">This workout has nothing to change by week here. A planned run’s distance and pace change in the iPhone app.</p>
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
    <details className="block-ramp" open>
      <summary>Ramp a target</summary>
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
