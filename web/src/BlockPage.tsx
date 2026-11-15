import { useMemo, useState, type FormEvent } from 'react';
import { addDays } from '../../src/calendarProjection';
import { MAX_SCHEDULE_EXTRAS, WEEKDAYS, type TrainingProgram, type Weekday } from '../../src/types';
import { planWrites, type StateResponse } from './api';
import {
  addingExtra,
  addingWeek,
  applyingRamp,
  copyingDown,
  currentWeek,
  editableFields,
  FIELD_LABELS,
  formatSeconds,
  formatValue,
  liveWorkouts,
  MAX_PROGRAM_WEEKS,
  newBlock,
  parseSeconds,
  programBody,
  rampValues,
  relabeling,
  removingExtra,
  removingLastWeek,
  roundFor,
  settingDay,
  shortDate,
  slotUnit,
  startChoices,
  weekChanges,
  weekStart,
  weekValue,
  workoutsInBlock,
  type ProgramBody,
  type Ramp,
  type TargetField,
} from './blocks';
import { planBlocks } from './event';
import { WEEKDAY_LABELS, type Slot, type Workout } from './model';
import type { Write } from './WorkoutEditor';
import { useEditorDraft } from './useEditorDraft';
import { blockComparison, blockDraftProblem, blockInputErrors, blockSlotIdentities, changingBlockInput, isBlockDraft, parsedTargetInput, reconcileBlockInputs, resettingBlockInputs, resolveBlockInputs, targetInputKey, type BlockDraft } from './blockDrafts';

/**
 * The block designer: a block of weeks as a grid of days, any mix of
 * workouts, with targets changed week by week and a ramp for any of them.
 * Edits stay on the page until saved as one change.
 */
export function BlockPage({ state, write, busy, today, accountId }: {
  accountId: string;
  state: StateResponse;
  write: Write;
  busy: boolean;
  today: string;
}) {
  const plan = state.plan;
  const retained = useEditorDraft<BlockDraft>({ accountId, planId: plan?.id ?? 'none', documentId: 'block' }, isBlockDraft);
  const { program } = useMemo(() => planBlocks(state), [state]);
  const workouts = useMemo(() => (plan?.workouts ?? []) as Workout[], [plan]);

  if (!plan || (workouts.every((w) => w.archived_at) && !retained.record)) {
    return (
      <main className="centered">
        <h1>No workouts yet</h1>
        <p className="muted">A block is made of your workouts. Build one on the Workouts page first.</p>
        <a className="ghost" href="#workouts">Go to Workouts</a>
      </main>
    );
  }
  if (retained.unreadable) return <main className="block-page"><h1>Block draft unavailable</h1><p role="alert">This browser's saved block draft could not be read. No change has been sent.</p><button onClick={() => retained.clear()}>Discard unreadable draft</button></main>;
  if (!program && !retained.record) return <NewBlock state={state} workouts={workouts} write={write} busy={busy} today={today} />;
  return (
    <BlockDesigner
      saved={program ?? { ...retained.record!.value.saved, id: retained.record!.value.programId }}
      currentProgramId={program?.id ?? null}
      version={plan.version}
      planId={plan.id}
      accountId={accountId}
      retained={retained}
      workouts={workouts}
      write={write}
      busy={busy}
      today={today}
    />
  );
}

function NewBlock({ state, workouts, write, busy, today }: {
  state: StateResponse;
  workouts: Workout[];
  write: Write;
  busy: boolean;
  today: string;
}) {
  const choices = useMemo(() => startChoices(today), [today]);
  const [name, setName] = useState('');
  const [start, setStart] = useState(choices[0]!);
  const [weeks, setWeeks] = useState(8);
  const [repeat, setRepeat] = useState(false);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const body = newBlock(state.plan?.schedule, workouts, { start, weeks, repeat, name });
    void write((at) => planWrites.setProgram(body, at));
  };

  return (
    <main className="block-page">
      <section className="block-intro">
        <h1>Plan a block</h1>
        <p>
          A block is a run of weeks that can differ from each other: a base month, a build, an easier week every so often.
          It holds any mix of workouts (lifting, runs, swims, rides and sports), and each week can change its days and its targets.
        </p>
        <form className="block-new" onSubmit={submit}>
          <div className="field">
            <label htmlFor="block-name">Name (optional)</label>
            <input id="block-name" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} placeholder="Spring build" />
          </div>
          <div className="field-row">
            <div className="field">
              <label htmlFor="block-start">Starts</label>
              <select id="block-start" value={start} onChange={(e) => setStart(e.target.value)}>
                {choices.map((monday, index) => (
                  <option key={monday} value={monday}>
                    {index === 0 ? `This week (${shortDate(monday)})` : index === 1 ? `Next week (${shortDate(monday)})` : shortDate(monday)}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="block-weeks">Weeks</label>
              <input id="block-weeks" className="short" type="number" min={1} max={MAX_PROGRAM_WEEKS} value={weeks}
                onChange={(e) => setWeeks(Math.min(MAX_PROGRAM_WEEKS, Math.max(1, Number(e.target.value) || 1)))} />
            </div>
          </div>
          <label className="check">
            <input type="checkbox" checked={repeat} onChange={(e) => setRepeat(e.target.checked)} />
            Start over when it ends
          </label>
          <button type="submit" disabled={busy}>Start from my week</button>
          <p className="muted fine">
            Every week starts as a copy of your weekly routine. Then change any day, give weeks their own targets, or ramp a target up week by week.
          </p>
        </form>
        <p className="muted fine">
          In the iPhone app, Plan a block can also lay out your runs to an event or keep building your long run. Those blocks show here too, to change week by week.
        </p>
      </section>
    </main>
  );
}

function BlockDesigner({ saved, workouts, write, busy, today, version, planId, accountId, currentProgramId, retained }: {
  version: number;
  planId: string;
  accountId: string;
  currentProgramId: string | null;
  retained: ReturnType<typeof useEditorDraft<BlockDraft>>;
  saved: TrainingProgram;
  workouts: Workout[];
  write: Write;
  busy: boolean;
  today: string;
}) {
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
  const live = useMemo(() => liveWorkouts(workouts), [workouts]);
  const choosable = useMemo(() => [...live.values()], [live]);
  const dirty = Object.keys(inputs).length > 0 || JSON.stringify(programBody(draft)) !== JSON.stringify(programBody(saved));
  const thisWeek = currentWeek({ ...draft, id: saved.id }, today);
  const starts = useMemo(() => {
    const list = startChoices(today);
    return list.includes(draft.start) ? list : [draft.start, ...list];
  }, [today, draft.start]);
  const lastDay = addDays(draft.start, draft.weeks.length * 7 - 1);

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
    if (!window.confirm('End this block? Your weekly routine takes over again. Past workouts stay in your history.')) return;
    void write((at) => planWrites.clearProgram(at)).then(ok => { if (ok) retained.clear(); });
  };

  return (
    <main className="block-page">
      <section className="block-head">
        <div>
          <h1>{draft.name?.trim() || 'Your block'}</h1>
          <p className="muted">
            {draft.weeks.length} {draft.weeks.length === 1 ? 'week' : 'weeks'} from {shortDate(draft.start)}
            {draft.repeat ? ', then starts over' : ` to ${shortDate(lastDay)}, then your weekly routine`}
            {thisWeek != null ? ` · This is week ${thisWeek + 1}` : ''}
          </p>
        </div>
        <div className="block-actions">
          <button type="button" className="primary" disabled={!dirty || busy || needsReview || !!problem || inputErrors.length > 0} onClick={save}>Save changes</button>
          <button type="button" className="ghost" disabled={!dirty || busy} onClick={discard}>Discard</button>
          <button type="button" className="ghost danger" disabled={busy || !!problem} onClick={end}>End block</button>
        </div>
      </section>

      {problem && <div className="panel" role="alert"><p>{problem}</p></div>}
      {needsReview && !problem && <section className="panel" aria-label="Review retained block draft">
        <h2>Review your retained draft</h2>
        <p>Your plan changed. Compare the current saved block with your proposed block before continuing. Nothing has been reapplied.</p>
        {comparisons.length ? <div className="block-grid-wrap"><table><thead><tr><th>Setting</th><th>Current saved</th><th>Your draft</th></tr></thead>
          <tbody>{comparisons.map(row => <tr key={row.key}><th scope="row">{row.label}</th><td>{row.current}</td><td>{row.proposed}</td></tr>)}</tbody></table></div>
          : <p>The block values match. Review any changed saved-workout targets in the grid below.</p>}
        <button type="button" className="ghost" disabled={busy || inputErrors.length > 0} onClick={() => retained.save({ ...retained.record!.value, draft, saved: programBody(saved), identities: blockSlotIdentities(workouts) }, version)}>Use draft with latest block</button>
      </section>}

      <section className="block-settings field-row">
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
      </section>

      <section aria-labelledby="block-weeks-title">
        <h2 id="block-weeks-title">Weeks</h2>
        <div className="block-grid-wrap">
          <table className="block-grid">
            <thead>
              <tr>
                <th scope="col">Week</th>
                {WEEKDAYS.map((day) => <th key={day} scope="col">{WEEKDAY_LABELS[day]}</th>)}
              </tr>
            </thead>
            <tbody>
              {draft.weeks.map((week, index) => (
                <tr key={index} className={index === thisWeek ? 'current' : undefined}>
                  <th scope="row">
                    <div className="block-week-name">
                      <strong>Week {index + 1}</strong>
                      <span className="muted">{shortDate(weekStart(draft, index))}</span>
                    </div>
                    <input aria-label={`Week ${index + 1} label`} className="block-label" maxLength={40}
                      value={week.label ?? ''} placeholder="Label"
                      onChange={(e) => setDraft(relabeling(draft, index, e.target.value))} />
                    {index < draft.weeks.length - 1 && (
                      <div className="block-row-actions">
                        <button type="button" className="ghost small" onClick={() => setDraft(copyingDown(draft, index, 'next'))}
                          title="Copy this week's days and targets to the next week">Copy to next</button>
                        <button type="button" className="ghost small" onClick={() => setDraft(copyingDown(draft, index, 'all'))}
                          title="Copy this week's days and targets to every later week">Copy to all later</button>
                      </div>
                    )}
                  </th>
                  {WEEKDAYS.map((day) => (
                    <DayCell key={day} draft={draft} index={index} day={day} live={live} choosable={choosable} onChange={setDraft} />
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="block-week-buttons">
          <button type="button" className="ghost" disabled={draft.weeks.length >= MAX_PROGRAM_WEEKS}
            onClick={() => { const next = addingWeek(draft); if (next) setDraft(next); }}>Add a week</button>
          <button type="button" className="ghost" disabled={draft.weeks.length <= 1}
            onClick={() => { const next = removingLastWeek(draft); if (next) setDraft(next); }}>Remove the last week</button>
        </div>
      </section>

      {inputErrors.length > 0 && <ul role="alert" className="problem">{inputErrors.map((error, i) => <li key={i}>{error}</li>)}</ul>}
      <TargetsByWeek draft={draft} workouts={workoutsInBlock(draft, workouts)} onChange={setDraft} inputs={inputs} onInput={editInput} onReset={resetInputs} />

      {dirty && (
        <div className="block-savebar" role="status">
          <span>Unsaved changes to your block.</span>
          <button type="button" className="primary" disabled={busy || needsReview || !!problem || inputErrors.length > 0} onClick={save}>Save changes</button>
        </div>
      )}
    </main>
  );
}

function DayCell({ draft, index, day, live, choosable, onChange }: {
  draft: ProgramBody;
  index: number;
  day: Weekday;
  live: Map<string, Workout>;
  choosable: Workout[];
  onChange: (next: ProgramBody) => void;
}) {
  const week = draft.weeks[index]!;
  const main = week.week[day] ?? null;
  const extras = week.extras?.[day] ?? [];
  const label = `${WEEKDAY_LABELS[day]}, week ${index + 1}`;
  const addable = choosable.filter((w) => w.id !== main && !extras.includes(w.id));
  return (
    <td>
      <select aria-label={`${label}: workout`} value={main ?? ''}
        onChange={(e) => onChange(settingDay(draft, index, day, e.target.value || null))}>
        <option value="">Rest</option>
        {main && !live.has(main) && <option value={main}>(archived workout)</option>}
        {choosable.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
      </select>
      {extras.length > 0 && (
        <ul className="block-extras">
          {extras.map((id) => (
            <li key={id} className="chip lift">
              <span>{live.get(id)?.name ?? 'Archived workout'}</span>
              <button type="button" className="icon" aria-label={`Remove ${live.get(id)?.name ?? 'workout'} from ${label}`}
                onClick={() => onChange(removingExtra(draft, index, day, id))}>×</button>
            </li>
          ))}
        </ul>
      )}
      {main && extras.length < MAX_SCHEDULE_EXTRAS && addable.length > 0 && (
        <select aria-label={`${label}: add another`} className="block-add" value=""
          onChange={(e) => {
            const next = e.target.value ? addingExtra(draft, index, day, e.target.value) : null;
            if (next) onChange(next);
          }}>
          <option value="">+ Also</option>
          {addable.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
        </select>
      )}
    </td>
  );
}

function TargetsByWeek({ draft, workouts, onChange, inputs, onInput, onReset }: {
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
