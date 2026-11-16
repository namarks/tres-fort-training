import { useMemo, useState } from 'react';
import { addDays } from '../../src/calendarProjection';
import { dayEntries } from '../../src/programLayers';
import { WEEKDAYS, type Weekday } from '../../src/types';
import type { StateResponse } from './api';
import { BlockReview, BlockSettings, NewBlock, TargetsByWeek, useBlockEditor, type ActiveBlock } from './BlockEditor';
import {
  addingToBlock,
  besideBlock,
  blockDays,
  blockWorkouts,
  dayFull,
  fullDays,
  daysIn,
  daysLabel,
  hasWeekTargets,
  headlineName,
  headlineSlot,
  isPlannedRun,
  placingOn,
  removingFromBlock,
  sortingBlock,
  suggestedSorting,
  weekHeadline,
} from './blockLayers';
import { addingWeek, copyingDown, liveWorkouts, MAX_PROGRAM_WEEKS, relabeling, removingLastWeek, settingRunSteps, shortDate, weekStart, workoutsInBlock } from './blocks';
import { applySlotTargets } from '../../src/programTargets';
import { formatScheduleTime, localToday, prefersMiles, WEEKDAY_LABELS, type Slot, type Workout } from './model';
import { RunPlanEditor } from './RunPlanEditor';
import { isNewBlockDraft, NEW_BLOCK_DOCUMENT } from './programmingDrafts';
import { useEditorDraft } from './useEditorDraft';
import { WeekAdjustment } from './WeekAdjustmentPanel';
import type { Write } from './WorkoutEditor';

/**
 * The Block tab of Plan: the one place a training block is started, shaped
 * and ended (owner, 2026-11-16). A block holds its own workouts; what the
 * member does every week stays in the Schedule tab's top row and carries on
 * beside it.
 */
export function BlockPage({ state, write, busy, accountId, onEditWorkout }: {
  state: StateResponse;
  write: Write;
  busy: boolean;
  accountId: string;
  onEditWorkout: (id: string | null) => void;
}) {
  const today = useMemo(() => localToday(), []);
  const plan = state.plan;
  const [starting, setStarting] = useState(false);
  const newDraft = useEditorDraft({ accountId, planId: plan?.id ?? 'none', documentId: NEW_BLOCK_DOCUMENT }, isNewBlockDraft);
  const block = useBlockEditor({ state, write, busy, today, accountId });
  const active = block.kind === 'block' ? block : null;
  const hasWorkouts = liveWorkouts(plan?.workouts ?? []).size > 0;
  const startOpen = (starting || !!newDraft.record || newDraft.unreadable) && (!active || !!newDraft.record || newDraft.unreadable);

  if (!plan) {
    return (
      <main className="block-page">
        <NoBlock hasWorkouts={false} onStart={() => undefined} onCreate={() => onEditWorkout(null)} />
      </main>
    );
  }
  return (
    <main className="block-page">
      {block.kind === 'unreadable' && (
        <div className="panel" role="alert">
          <p>This browser's saved block draft could not be read. No change has been sent.</p>
          <button type="button" onClick={block.clear}>Discard unreadable draft</button>
        </div>
      )}
      {startOpen && (hasWorkouts
        ? <NewBlock accountId={accountId} state={state} workouts={plan.workouts} write={write} busy={busy} today={today} onCancel={() => setStarting(false)} />
        : <div className="panel"><p>A block is made of your workouts. Create one first.</p>
          <button type="button" onClick={() => onEditWorkout(null)}>Create a workout</button></div>)}
      {!active && !startOpen && block.kind !== 'unreadable'
        && <NoBlock hasWorkouts={hasWorkouts} onStart={() => setStarting(true)} onCreate={() => onEditWorkout(null)} />}
      {active && <RunningBlock block={active} state={state} today={today} busy={busy} />}
    </main>
  );
}

function NoBlock({ hasWorkouts, onStart, onCreate }: { hasWorkouts: boolean; onStart: () => void; onCreate: () => void }) {
  return (
    <section className="panel block-none" aria-labelledby="block-none-title">
      <h1 id="block-none-title">No training block</h1>
      <p>A block is your main training for a set number of weeks, with targets that change from week to week. What you do every week carries on beside it.</p>
      <div className="form-actions">
        {hasWorkouts
          ? <button type="button" className="primary" onClick={onStart}>Start a block</button>
          : <button type="button" className="primary" onClick={onCreate}>Create a workout first</button>}
        <a className="ghost" href="#analysis/event">Start one for an event</a>
      </div>
    </section>
  );
}

/** Where today is in the block: "Week 2 of 6 · now", before it, or after. */
function blockPosition(block: ActiveBlock, today: string): string {
  const { draft, thisWeek } = block;
  if (thisWeek != null) return `Week ${thisWeek + 1} of ${draft.weeks.length} · now`;
  if (today < draft.start) return `Starts ${shortDate(draft.start)}`;
  return `Ended ${shortDate(addDays(draft.start, draft.weeks.length * 7 - 1))}`;
}

function RunningBlock({ block, state, today, busy }: { block: ActiveBlock; state: StateResponse; today: string; busy: boolean }) {
  const plan = state.plan!;
  const { draft, setDraft } = block;
  const miles = useMemo(() => prefersMiles(), []);
  const [settings, setSettings] = useState(false);
  const [lighterWeek, setLighterWeek] = useState<number | null>(null);
  const [ending, setEnding] = useState(false);
  const [targetsFor, setTargetsFor] = useState<string | null>(null);
  const rows = blockWorkouts(draft, plan.workouts);
  const lastDay = addDays(draft.start, draft.weeks.length * 7 - 1);
  const [runFor, setRunFor] = useState<{ workoutId: string; index: number } | null>(null);
  const reveal = (id: string) => window.setTimeout(() => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0);
  // A planned run's week opens its steps; anything else, the week-by-week numbers.
  const openTargets = (workout: Workout, index: number) => {
    if (isPlannedRun(headlineSlot(workout, draft))) {
      setRunFor({ workoutId: workout.id, index });
      reveal('block-run-week');
    } else {
      setRunFor(null);
      setTargetsFor(workout.id);
      reveal('block-targets-title');
    }
  };
  const runWorkout = runFor ? rows.find((workout) => workout.id === runFor.workoutId) : undefined;
  const runSlot = runWorkout ? headlineSlot(runWorkout, draft) : undefined;
  return (
    <>
      <header className="block-head">
        <div>
          <p className="kicker">{blockPosition(block, today)}</p>
          <h1 id="block-title">{draft.name?.trim() || 'Your block'}</h1>
          <p className="muted">
            {shortDate(draft.start)} to {shortDate(lastDay)} · {rows.length} {rows.length === 1 ? 'workout' : 'workouts'} a week
            {draft.repeat ? ' · starts over when it ends' : ''}
          </p>
        </div>
        <div className="block-actions">
          <button type="button" className="primary" disabled={!block.canSave} onClick={block.save}>Save changes</button>
          <button type="button" className="ghost" disabled={!block.dirty || busy} onClick={block.discard}>Discard</button>
          <button type="button" className="ghost" aria-expanded={settings} onClick={() => setSettings(!settings)}>Name and start</button>
          <button type="button" className="ghost" disabled={busy || draft.weeks.length >= MAX_PROGRAM_WEEKS}
            onClick={() => { const next = addingWeek(draft); if (next) setDraft(next); }}>Add a week</button>
          <button type="button" className="ghost" disabled={busy || draft.weeks.length <= 1}
            onClick={() => { const next = removingLastWeek(draft); if (next) setDraft(next); }}>Remove the last week</button>
          <button type="button" className="ghost danger" aria-expanded={ending} disabled={busy || !!block.problem} onClick={() => setEnding(!ending)}>End block</button>
        </div>
      </header>
      <BlockReview block={block} busy={busy} />
      {settings && <BlockSettings block={block} today={today} />}
      {ending && <EndBlock block={block} busy={busy} onClose={() => setEnding(false)} />}
      {!block.layered && <SortBlock block={block} state={state} busy={busy} />}
      {lighterWeek != null && draft.weeks[lighterWeek]
        && <WeekAdjustment key={`${block.programId}:${lighterWeek}`} block={block} index={lighterWeek} workouts={plan.workouts} onClose={() => setLighterWeek(null)} />}

      <section className="panel block-weeks" aria-labelledby="block-weeks-title">
        <h2 id="block-weeks-title">Week by week</h2>
        <p className="muted">What each block workout asks for in each week. Choose a target to change it, move a workout to another day, or make a whole week lighter.</p>
        <div className="block-grid-wrap">
          <table className="block-table">
            <thead>
              <tr>
                <th scope="col">Workout</th>
                <th scope="col">Day</th>
                {draft.weeks.map((week, index) => (
                  <WeekColumn key={index} block={block} index={index} today={today} onLighten={setLighterWeek} />
                ))}
                <th scope="col"><span className="visually-hidden">Remove</span></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((workout) => (
                <BlockRow key={workout.id} block={block} workout={workout} miles={miles} busy={busy} onTargets={openTargets} />
              ))}
              {rows.length === 0 && (
                <tr><td colSpan={draft.weeks.length + 3} className="muted">This block has no workouts of its own yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
        {block.layered && <AddToBlock block={block} state={state} busy={busy} />}
      </section>

      {runFor && runWorkout && isPlannedRun(runSlot) && draft.weeks[runFor.index] && (
        <section id="block-run-week" className="block-run" aria-label={`${runWorkout.name}, week ${runFor.index + 1}`}>
          <WeekRun key={`${runWorkout.id}:${runFor.index}`} block={block} workout={runWorkout} slot={runSlot} index={runFor.index}
            miles={miles} busy={busy} onClose={() => setRunFor(null)} />
        </section>
      )}

      <div className="block-aside">
        {block.layered && <BesideBlock block={block} state={state} />}
        <section className="panel" aria-labelledby="block-after-title">
          <h2 id="block-after-title">When it ends</h2>
          <p className="muted">
            {draft.repeat
              ? `After week ${draft.weeks.length} the block starts over at week 1, until you end it.`
              : block.layered
                ? `After ${shortDate(lastDay)}, what you do every week carries on by itself.`
                : `After ${shortDate(lastDay)}, your every-week row takes over again.`}
          </p>
          <label className="check">
            <input type="checkbox" checked={draft.repeat} disabled={busy} onChange={(e) => setDraft({ ...draft, repeat: e.target.checked })} />
            Start over when it ends
          </label>
          <p className="muted fine">To keep a week going every week instead, choose End block when you get there.</p>
        </section>
      </div>

      <TargetsByWeek key={targetsFor ?? 'first'} initialWorkoutId={targetsFor ?? undefined} draft={draft}
        workouts={block.layered ? rows : workoutsInBlock(draft, plan.workouts)} onChange={setDraft}
        inputs={block.inputs} onInput={block.editInput} onReset={block.resetInputs} />
      {block.dirty && (
        <div className="block-savebar" role="status">
          <span>Unsaved changes to your block.</span>
          <button type="button" className="primary" disabled={!block.canSave} onClick={block.save}>Save changes</button>
        </div>
      )}
    </>
  );
}

/** One week's column heading: its number, first day, label and tools. */
function WeekColumn({ block, index, today, onLighten }: { block: ActiveBlock; index: number; today: string; onLighten: (index: number) => void }) {
  const draft = block.draft;
  const week = draft.weeks[index]!;
  const monday = weekStart(draft, index);
  const now = block.thisWeek === index;
  const done = !draft.repeat && addDays(monday, 6) < today;
  return (
    <th scope="col" className={['block-week', now ? 'now' : '', done ? 'done' : ''].filter(Boolean).join(' ')}>
      <span className="kicker">Week {index + 1}{now ? ' · now' : ''}</span>
      <strong>{shortDate(monday).slice(5)}</strong>
      {week.label?.trim() ? <span className="muted">{week.label.trim()}</span> : done ? <span className="muted">Done</span> : null}
      <details className="week-menu">
        <summary>Edit week</summary>
        <div className="week-menu-body">
          <button type="button" className="ghost small" onClick={() => onLighten(index)}>Make week lighter</button>
          <input aria-label={`Week ${index + 1} label`} className="block-label" maxLength={40}
            value={week.label ?? ''} placeholder="Label, like Base or Easy"
            onChange={(e) => block.setDraft(relabeling(draft, index, e.target.value))} />
          {index < draft.weeks.length - 1 && (
            <>
              <button type="button" className="ghost small" onClick={() => block.setDraft(copyingDown(draft, index, 'next'))}
                title="Copy this week's days and targets to the next week">Copy to next week</button>
              <button type="button" className="ghost small" onClick={() => block.setDraft(copyingDown(draft, index, 'all'))}
                title="Copy this week's days and targets to every later week">Copy to all later weeks</button>
            </>
          )}
        </div>
      </details>
    </th>
  );
}

/** One block workout: its weekdays, and what each week asks of it. */
function BlockRow({ block, workout, miles, busy, onTargets }: {
  block: ActiveBlock; workout: Workout; miles: boolean; busy: boolean; onTargets: (workout: Workout, index: number) => void;
}) {
  const draft = block.draft;
  const { days, varies } = blockDays(draft, workout.id);
  const detail = headlineName(workout, draft);
  const editable = hasWeekTargets(workout);
  const [daysOpen, setDaysOpen] = useState(false);
  const daysText = varies ? 'Varies' : daysLabel(days);
  // Days it is on in some weeks that are full in others.
  const crowded = fullDays(draft, workout.id, days);
  return (
    <>
      <tr>
        <th scope="row">
          <strong>{workout.name}</strong>
          {detail ? <small className="muted">{detail}</small> : null}
        </th>
        <td>
          {block.layered ? (
            <button type="button" className="day-pick" aria-expanded={daysOpen}
              aria-label={`${workout.name}: days, ${varies ? 'they differ by week' : daysText}. Change days`}
              onClick={() => setDaysOpen(!daysOpen)}>{daysText}</button>
          ) : <span>{daysText}</span>}
        </td>
        {draft.weeks.map((_, index) => {
          const on = daysIn(draft, index, workout.id).length > 0;
          const text = on ? weekHeadline(workout, draft, index, miles) : '';
          const classes = ['block-cell', block.thisWeek === index ? 'now' : ''].filter(Boolean).join(' ');
          return (
            <td key={index} className={classes}>
              {!on ? <span className="muted">Not this week</span>
                : editable ? (
                  <button type="button" className="target" aria-label={`${workout.name}, week ${index + 1}: ${text || 'no target'}. Change targets`}
                    onClick={() => onTargets(workout, index)}>{text || 'Set a target'}</button>
                ) : <span className="muted">{text || 'As saved'}</span>}
            </td>
          );
        })}
        <td>
          {block.layered && (
            <button type="button" className="ghost small" disabled={busy} aria-label={`Remove ${workout.name} from the block`}
              onClick={() => block.setDraft(removingFromBlock(draft, workout))}>Remove</button>
          )}
        </td>
      </tr>
      {block.layered && daysOpen && (
        <tr className="block-days-row">
          <td colSpan={draft.weeks.length + 3}>
            <fieldset className="block-days" disabled={busy}>
              <legend>{workout.name}: days in every week of the block</legend>
              <div className="block-day-toggles">
                {WEEKDAYS.map((day) => {
                  const on = days.includes(day);
                  // A change puts the workout on the same days in every week, so each of them needs room in each week.
                  const next = on ? days.filter((d) => d !== day) : [...days, day];
                  return (
                    <label key={day} className={on ? 'day-toggle on' : 'day-toggle'}>
                      <input type="checkbox" checked={on} aria-label={WEEKDAY_LABELS[day]}
                        disabled={next.length === 0 || fullDays(draft, workout.id, next).length > 0}
                        onChange={() => block.setDraft(placingOn(draft, workout.id, next))} />
                      <span aria-hidden="true">{WEEKDAY_LABELS[day].slice(0, 3)}</span>
                    </label>
                  );
                })}
                <button type="button" className="ghost small" onClick={() => setDaysOpen(false)}>Done</button>
              </div>
              {varies && <p className="fine muted">The weeks differ now. A change here puts it on the same days in all of them.</p>}
              {crowded.length > 0 && <p role="status" className="fine muted">{crowded.map((day) => WEEKDAY_LABELS[day]).join(', ')} already {crowded.length === 1 ? 'has' : 'have'} five workouts in some weeks, so this can’t go there in every week. Untick {crowded.length === 1 ? 'it' : 'them'} to change the other days.</p>}
              {days.length === 1 && <p className="fine muted">To take it out of the block, choose Remove.</p>}
            </fieldset>
          </td>
        </tr>
      )}
    </>
  );
}

/** One week of a planned run: the steps that week asks for, kept in the
 * block's draft until Save changes. The workout's own steps never change. */
function WeekRun({ block, workout, slot, index, miles, busy, onClose }: {
  block: ActiveBlock; workout: Workout; slot: Slot; index: number; miles: boolean; busy: boolean; onClose: () => void;
}) {
  const targets = block.draft.weeks[index]?.targets?.[slot.id];
  return (
    <RunPlanEditor
      slot={applySlotTargets(slot, targets)}
      miles={miles}
      busy={busy}
      week={{ title: `${workout.name}, week ${index + 1}`, save: `Use for week ${index + 1}`, changed: targets?.run_steps !== undefined }}
      onCancel={onClose}
      onSave={(steps) => { block.setDraft(settingRunSteps(block.draft, index, slot, steps)); onClose(); }}
    />
  );
}

/** One more workout for the block. One the every-week row holds moves into
 * the block on its days; any other goes on the day chosen. */
function AddToBlock({ block, state, busy }: { block: ActiveBlock; state: StateResponse; busy: boolean }) {
  const plan = state.plan!;
  const [workoutId, setWorkoutId] = useState('');
  const [day, setDay] = useState<Weekday>('mon');
  const draft = block.draft;
  const inBlock = new Set(blockWorkouts(draft, plan.workouts).map((workout) => workout.id));
  const choices = [...liveWorkouts(plan.workouts).values()].filter((workout) => !inBlock.has(workout.id));
  const everyWeek = WEEKDAYS.filter((weekday) => !!workoutId && dayEntries(plan.schedule, weekday).includes(workoutId));
  const days = everyWeek.length > 0 ? everyWeek : [day];
  const full = !!workoutId && days.some((weekday) => dayFull(draft, weekday, workoutId));
  if (choices.length === 0) return null;
  return (
    <div className="block-add-row">
      <label className="visually-hidden" htmlFor="block-add-workout">Add a workout to the block</label>
      <select id="block-add-workout" value={workoutId} disabled={busy} onChange={(e) => setWorkoutId(e.target.value)}>
        <option value="">+ Add a workout to the block</option>
        {choices.map((workout) => <option key={workout.id} value={workout.id}>{workout.name}</option>)}
      </select>
      {workoutId && everyWeek.length === 0 && (
        <>
          <label className="visually-hidden" htmlFor="block-add-day">Day</label>
          <select id="block-add-day" value={day} disabled={busy} onChange={(e) => setDay(e.target.value as Weekday)}>
            {WEEKDAYS.map((weekday) => <option key={weekday} value={weekday}>{WEEKDAY_LABELS[weekday]}</option>)}
          </select>
        </>
      )}
      {workoutId && (
        <button type="button" className="ghost small" disabled={busy || full}
          onClick={() => { block.setDraft(addingToBlock(draft, workoutId, days)); setWorkoutId(''); }}>Add to block</button>
      )}
      {workoutId && everyWeek.length > 0 && (
        <p className="fine muted">It is in your every-week row on {daysLabel(everyWeek)}. It moves into the block on the same days when you save.</p>
      )}
      {full && <p className="fine problem">That day already has five workouts in one of the weeks.</p>}
    </div>
  );
}

/** What the member does every week, shown so the block's edges are clear. */
function BesideBlock({ block, state }: { block: ActiveBlock; state: StateResponse }) {
  const plan = state.plan!;
  const beside = besideBlock(block.draft, plan.schedule, plan.workouts);
  return (
    <section className="panel" aria-labelledby="block-beside-title">
      <h2 id="block-beside-title">Every week, beside this block</h2>
      <p className="muted">These carry on while the block runs. The block never changes them.</p>
      {beside.length === 0 ? <p className="muted">Nothing yet. Soccer on Mondays or core every night would go here.</p> : (
        <ul className="block-beside">
          {beside.map(({ workout, days }) => {
            const times = new Set(days.map((day) => plan.schedule.times?.[day]?.[workout.id] ?? ''));
            const time = times.size === 1 ? [...times][0] : '';
            return (
              <li key={workout.id}>
                <strong>{workout.name}</strong>
                <small className="muted">{daysLabel(days)}{time ? ` · ${formatScheduleTime(time)}` : ''}</small>
              </li>
            );
          })}
        </ul>
      )}
      <a href="#plan">Change these in Schedule</a>
    </section>
  );
}

/** A block made before blocks kept their own workouts apart (or in the
 * iPhone app): say which workouts are the block's. */
function SortBlock({ block, state, busy }: { block: ActiveBlock; state: StateResponse; busy: boolean }) {
  const plan = state.plan!;
  const inBlock = workoutsInBlock(block.draft, plan.workouts).filter((workout) => !workout.one_time_date);
  const [picked, setPicked] = useState<string[]>(() => suggestedSorting(block.draft, plan.schedule, plan.workouts));
  return (
    <section className="panel block-sort" aria-labelledby="block-sort-title">
      <h2 id="block-sort-title">Which workouts does this block train?</h2>
      <p>Right now this block has its own copy of every day, so a change to your every-week row doesn’t reach its weeks. Tick the workouts the block trains. They become the block’s own and leave your every-week row; everything else carries on beside the block and follows your every-week row from then on.</p>
      <fieldset className="block-picks" disabled={busy}>
        <legend className="visually-hidden">Workouts in this block</legend>
        {inBlock.map((workout) => {
          const ticked = picked.includes(workout.id);
          return (
            <label key={workout.id} className={ticked ? 'block-pick ticked' : 'block-pick'}>
              <input type="checkbox" checked={ticked}
                onChange={(e) => setPicked(e.target.checked ? [...picked, workout.id] : picked.filter((id) => id !== workout.id))} />
              <span><strong>{workout.name}</strong>
                <small className="muted">{daysLabel(blockDays(block.draft, workout.id).days)}{ticked ? '' : ' · every week'}</small></span>
            </label>
          );
        })}
      </fieldset>
      <button type="button" disabled={busy || picked.length === 0 || !!block.problem || block.needsReview}
        onClick={() => block.setDraft(sortingBlock(block.draft, picked, plan.workouts))}>Keep these as the block’s own</button>
      {inBlock.some((workout) => !picked.includes(workout.id)
        && block.draft.weeks.some((week) => workout.exercises.some((slot) => week.targets?.[slot.id] !== undefined))) && (
        <p role="status" className="muted fine">An unticked workout goes back to its own targets every week; the week-by-week targets this block gave it are removed.</p>
      )}
      <p className="muted fine">Nothing is saved until you choose Save changes.</p>
    </section>
  );
}

/** Ending the block: keep one of its weeks going every week, or leave only
 * what the member does every week. */
function EndBlock({ block, busy, onClose }: { block: ActiveBlock; busy: boolean; onClose: () => void }) {
  const weeks = block.saved.weeks.length;
  const [keep, setKeep] = useState(true);
  const [week, setWeek] = useState(block.thisWeek != null && block.thisWeek < weeks ? block.thisWeek : weeks - 1);
  const name = block.saved.name?.trim() || 'this block';
  return (
    <section className="panel block-ending" aria-labelledby="block-ending-title">
      <h2 id="block-ending-title">End {name}?</h2>
      <fieldset disabled={busy}>
        <legend className="visually-hidden">What happens to the block’s workouts</legend>
        <label className="check">
          <input type="radio" name="block-ending" checked={keep} onChange={() => setKeep(true)} />
          <span>Keep week{' '}
            <select aria-label="Week to keep going" value={week} onChange={(e) => { setWeek(Number(e.target.value)); setKeep(true); }}>
              {block.saved.weeks.map((_, index) => <option key={index} value={index}>{index + 1}</option>)}
            </select>{' '}going every week
            <small className="muted">Its workouts go into your every-week row on their days, with that week’s targets saved to each workout.</small></span>
        </label>
        <label className="check">
          <input type="radio" name="block-ending" checked={!keep} onChange={() => setKeep(false)} />
          <span>Just end it
            <small className="muted">{block.layered || Array.isArray(block.saved.workout_ids)
              ? 'Only what you do every week is left. The block’s workouts stay in Workouts.'
              : 'Your every-week row takes over again.'}</small></span>
        </label>
      </fieldset>
      <p className="muted fine">Past workouts stay in your history either way.</p>
      {block.dirty && <p role="alert" className="problem">Save or discard your block changes first.</p>}
      <div className="form-actions">
        <button type="button" className="danger-fill" disabled={busy || block.dirty}
          onClick={() => { void block.end(keep ? week : null).then((ok) => { if (ok) onClose(); }); }}>End block</button>
        <button type="button" className="ghost" onClick={onClose}>Cancel</button>
      </div>
    </section>
  );
}
