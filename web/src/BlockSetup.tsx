import { useMemo, useState, type KeyboardEvent } from 'react';
import { addDays } from '../../src/calendarProjection';
import { WEEKDAYS, type Weekday } from '../../src/types';
import { AddWorkout } from './AddWorkout';
import { planWrites, type StateResponse } from './api';
import { buildLabel, buildOptions, EASY_CHOICES, usableBuild, weeksToEvent, type BuildRule, type EasyEvery } from './blockBuild';
import { MAX_DAY_WORKOUTS, newBlockDay, trimmedSchedule, weekHeadline } from './blockLayers';
import { liveWorkouts, MAX_PROGRAM_WEEKS, shortDate, startChoices, weekStart } from './blocks';
import { DISCIPLINES, DISTANCE_PRESETS, draftKind, eventDraft, eventFromDraft, eventOf, planBlocks, type EventDraft } from './event';
import { workoutSummary } from './EveryWeek';
import { formatScheduleTime, WEEKDAY_LABELS, type Workout } from './model';
import {
  isNewBlockDraft, NEW_BLOCK_DOCUMENT, newBlockDraft, setupBlockRequest, setupEasy, setupWeeks, validBlockWeeks, type NewBlockDraft,
} from './programmingDrafts';
import { useEditorDraft } from './useEditorDraft';
import type { Catalog, Write } from './WorkoutEditor';
import './setup.css';

const STEPS = ['What it’s for', 'Your week', 'How it builds'] as const;
type Step = 1 | 2 | 3;

const sameJSON = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** "Soccer", "Soccer and Core", "Soccer, Core and Yoga". */
export const listed = (names: readonly string[]) =>
  names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;

/**
 * Starting a block, one question at a time (owner, 2026-11-17: "the user
 * needs to be walked through more clearly how to set it up"): what it is
 * for, what one week of it looks like, and how it builds. An event is the
 * first question, so nothing leaves the Plan page. Nothing is saved until
 * Start block; the draft is kept in this browser.
 */
export function BlockSetup({ state, write, busy, today, accountId, catalog, miles, onCancel }: {
  state: StateResponse;
  write: Write;
  busy: boolean;
  today: string;
  accountId: string;
  catalog: Catalog;
  miles: boolean;
  onCancel?: () => void;
}) {
  const plan = state.plan!;
  const version = plan.version;
  const choices = useMemo(() => startChoices(today), [today]);
  const retained = useEditorDraft<NewBlockDraft>({ accountId, planId: plan.id, documentId: NEW_BLOCK_DOCUMENT }, isNewBlockDraft);
  const live = useMemo(() => [...liveWorkouts(plan.workouts).values()], [plan.workouts]);
  const race = eventOf(state);
  const upcoming = race && race.date >= today ? race : null;
  const fresh = useMemo<NewBlockDraft>(() => ({
    ...newBlockDraft(plan.schedule, plan.workouts, choices[0]!),
    step: 1, purpose: upcoming ? 'event' : 'weeks', event: eventDraft(upcoming, miles),
  }), [plan.schedule, plan.workouts, choices, upcoming, miles]);
  const stored = retained.record?.value;
  // A draft from before the guided setup opens at its first step with its choices kept.
  const draft: NewBlockDraft = stored ? { ...stored, step: stored.step ?? 1, purpose: stored.purpose ?? 'weeks', event: stored.event ?? fresh.event } : fresh;
  const step = draft.step as Step;
  const event = draft.event as EventDraft;
  const kind = draftKind(event);
  const exists = !!planBlocks(state).program;
  // The plan moved on, but only a different every-week row is worth a second look.
  const needsReview = !!retained.record && retained.record.version !== version && !sameJSON(draft.source, fresh.source);
  const change = (patch: Partial<NewBlockDraft>) => retained.save({ ...draft, ...patch }, retained.record?.version ?? version);
  const [adding, setAdding] = useState<Weekday | null>(null);

  const starts = choices.includes(draft.start) ? choices : [draft.start, ...choices];
  const week = draft.source.weeks[0]!;
  const picked = (draft.picked ?? []).filter((id) => live.some((workout) => workout.id === id));
  const added = (draft.added ?? []).filter((entry) => live.some((workout) => workout.id === entry.id));
  const nameOf = (id: string) => live.find((workout) => workout.id === id)?.name ?? draft.workoutNames[id] ?? 'Workout';
  const usualOn = (day: Weekday) => [week.week[day], ...(week.extras?.[day] ?? [])].filter((id): id is string => !!id && live.some((workout) => workout.id === id));
  const inUsual = (id: string) => WEEKDAYS.some((day) => usualOn(day).includes(id));
  const ownOn = (day: Weekday) => newBlockDay(week, picked, added, day);
  const besideOn = (day: Weekday) => usualOn(day).filter((id) => !picked.includes(id));
  const ownIds = WEEKDAYS.flatMap(ownOn).filter((id, index, all) => all.indexOf(id) === index);
  const besideIds = WEEKDAYS.flatMap(besideOn).filter((id, index, all) => all.indexOf(id) === index);
  const overfull = WEEKDAYS.filter((day) => ownOn(day).length > MAX_DAY_WORKOUTS);

  const weeks = setupWeeks(draft);
  const eventResult = draft.purpose === 'event' ? eventFromDraft(event, race) : null;
  const stepOneProblem = draft.purpose === 'event'
    ? (eventResult && 'error' in eventResult ? eventResult.error
      : weeksToEvent(draft.start, event.date) == null
        ? (event.date < draft.start ? 'The event is before the block starts. Pick a later date or an earlier start.'
          : `A block can be up to ${MAX_PROGRAM_WEEKS} weeks. Pick a later start, or a set number of weeks.`)
        : null)
    : validBlockWeeks(draft.weeks) ? null : `Enter between 1 and ${MAX_PROGRAM_WEEKS} whole weeks.`;
  const stepTwoProblem = ownIds.length === 0 ? 'Put at least one workout in the block.'
    : overfull.length > 0 ? `${overfull.map((day) => WEEKDAY_LABELS[day]).join(', ')} ${overfull.length === 1 ? 'has' : 'have'} more than ${MAX_DAY_WORKOUTS} workouts in the block. Take one off.`
      : null;
  const body = stepOneProblem || stepTwoProblem ? null : setupBlockRequest(draft, live, miles);
  const easyEvery = weeks != null ? setupEasy(draft, weeks) : null;
  const [tried, setTried] = useState(false);
  const go = (next: Step) => { setTried(false); setAdding(null); change({ step: next }); };
  const forward = () => {
    const problem = step === 1 ? stepOneProblem : stepTwoProblem;
    if (problem) { setTried(true); return; }
    go((step + 1) as Step);
  };

  const cancel = () => {
    if (retained.record && !window.confirm('Discard your unfinished block?')) return;
    retained.clear(); onCancel?.();
  };
  // The Add box holds a form of its own (a run's steps), so the setup is
  // not a form: Enter in a field goes on, as a form's would.
  const onEnter = (keyEvent: KeyboardEvent) => {
    const target = keyEvent.target as HTMLElement;
    if (keyEvent.key !== 'Enter' || target.tagName !== 'INPUT' || target.closest('.add-box')) return;
    keyEvent.preventDefault();
    if (step !== 3) forward();
  };
  const submit = async () => {
    if (step !== 3) { forward(); return; }
    if (!body || busy || needsReview || exists || retained.unreadable) { setTried(true); return; }
    const schedule = plan.schedule;
    const saving = eventResult && 'race' in eventResult && !sameJSON(eventResult.race, race) ? eventResult.race : null;
    // The reviewed week is the one on screen, so the draft is saved at this version.
    const captured = retained.save(draft, version);
    await write(async (at) => {
      if (at.planId !== plan.id || at.accountId !== accountId || at.version !== captured.version) throw new Error('draft_version_changed');
      let next = at;
      if (saving) {
        const saved = await planWrites.setEvent(saving, at);
        if (!Number.isSafeInteger(saved?.version)) throw new Error('unreadable_event_receipt');
        next = { ...at, version: saved.version as number };
      }
      await planWrites.setProgram(body, next, trimmedSchedule(schedule, body.workout_ids));
      // Acknowledgement retires only this revision, even if the refresh fails.
      if (retained.clear(captured)) onCancel?.();
    });
  };

  if (retained.unreadable) return (
    <section className="panel" role="alert">
      <p>This browser’s new-block draft could not be read. No change has been sent.</p>
      <button type="button" onClick={() => retained.clear()}>Discard unreadable new-block draft</button>
    </section>
  );

  const dayDescription = (value: NewBlockDraft, day: Weekday) => {
    const source = value.source.weeks[0]!;
    const ids = [source.week[day], ...(source.extras?.[day] ?? [])].filter((id): id is string => !!id);
    return ids.map((id) => value.workoutNames[id] ?? 'Unavailable workout').join(' + ') || 'Rest';
  };
  /** A block workout taken off a day: one added for the block leaves that
   * day, and one from the every-week row goes back to it. */
  const takeOff = (id: string, day: Weekday) => {
    if (added.some((entry) => entry.id === id && entry.day === day)) change({ added: added.filter((entry) => !(entry.id === id && entry.day === day)) });
    else change({ picked: picked.filter((other) => other !== id) });
  };
  const place = (id: string, day: Weekday) => {
    const nextPicked = inUsual(id) && !picked.includes(id) ? [...picked, id] : picked;
    const onDay = newBlockDay(week, nextPicked, added, day).includes(id);
    change({ picked: nextPicked, added: onDay ? added : [...added, { id, day }] });
    setAdding(null);
  };

  return (
    <section className="block-setup panel" aria-labelledby="block-new-title">
      <ol className="setup-steps" aria-label="Steps">
        {STEPS.map((label, index) => {
          const number = (index + 1) as Step;
          const state = number === step ? 'on' : number < step ? 'done' : '';
          return (
            <li key={label} className={state} aria-current={number === step ? 'step' : undefined}>
              {number < step
                ? <button type="button" className="link" disabled={busy} onClick={() => go(number)}><i aria-hidden="true">✓</i>{label}<span className="visually-hidden"> (done, go back)</span></button>
                : <span><i aria-hidden="true">{number}</i>{label}</span>}
            </li>
          );
        })}
      </ol>
      {exists && <p role="alert" className="problem">A block has been saved since you started. Your draft is kept, but cannot replace that block. Discard this draft to work with the saved block.</p>}
      {needsReview && !exists && (
        <section className="panel" aria-label="Review new-block draft">
          <h3>Review your week</h3>
          <p>Your every-week row changed since you began. Your choices are kept. Look over the week the block starts from before continuing.</p>
          <div className="block-grid-wrap"><table><thead><tr><th>Day</th><th>Before</th><th>Now</th></tr></thead>
            <tbody>{WEEKDAYS.map((day) => <tr key={day}><th scope="row">{WEEKDAY_LABELS[day]}</th><td>{dayDescription(draft, day)}</td><td>{dayDescription(fresh, day)}</td></tr>)}</tbody></table></div>
          <button type="button" className="ghost" disabled={busy} onClick={() => {
            const now = fresh.source.weeks[0]!;
            retained.save({ ...draft, source: fresh.source, workoutNames: fresh.workoutNames,
              picked: (draft.picked ?? []).filter((id) => WEEKDAYS.some((day) => now.week[day] === id || (now.extras?.[day] ?? []).includes(id))) }, version);
          }}>Use the week as it is now</button>
        </section>
      )}

      <div className="setup-body" onKeyDown={onEnter}>
        {step === 1 && (
          <>
            <h1 id="block-new-title">What is this block for?</h1>
            <p className="setup-lead">A block is a few weeks of training that build toward something. Nothing changes until you start it.</p>
            <fieldset className="setup-options" disabled={busy}>
              <legend className="visually-hidden">What the block is for</legend>
              <div className={draft.purpose === 'event' ? 'setup-option on' : 'setup-option'}>
                <label className="setup-option-head">
                  <input type="radio" name="block-purpose" checked={draft.purpose === 'event'} onChange={() => change({ purpose: 'event' })} />
                  <span><strong>An event or a date</strong>
                    <small className="muted">A race, a test day, a season opener. The block ends that week.</small></span>
                </label>
                {draft.purpose === 'event' && (
                  <>
                    <div className="field-row">
                      <div className="field grow">
                        <label htmlFor="block-event-name">What</label>
                        <input id="block-event-name" value={event.name} maxLength={100} placeholder="Turkey Trot 5k"
                          onChange={(e) => change({ event: { ...event, name: e.target.value } })} />
                      </div>
                      <div className="field">
                        <label htmlFor="block-event-type">Type</label>
                        <select id="block-event-type" value={event.discipline} onChange={(e) => change({ event: { ...event, discipline: e.target.value, distanceChoice: '' } })}>
                          {DISCIPLINES.map((entry) => <option key={entry.id} value={entry.id}>{entry.label}</option>)}
                          <option value="other">Something else</option>
                        </select>
                      </div>
                      {event.discipline === 'other' && (
                        <div className="field">
                          <label htmlFor="block-event-other">What kind</label>
                          <input id="block-event-other" value={event.otherDiscipline} maxLength={40} placeholder="Biathlon"
                            onChange={(e) => change({ event: { ...event, otherDiscipline: e.target.value } })} />
                        </div>
                      )}
                      {kind && (
                        <div className="field">
                          <label htmlFor="block-event-distance">Distance (optional)</label>
                          <select id="block-event-distance" value={event.distanceChoice}
                            onChange={(e) => change({ event: { ...event, distanceChoice: e.target.value } })}>
                            <option value="">Not set</option>
                            {DISTANCE_PRESETS[kind].map((preset) => <option key={preset.label} value={preset.label}>{preset.label}</option>)}
                            {(event.distanceChoice === 'custom' || event.distanceChoice === 'text') && <option value={event.distanceChoice}>As saved</option>}
                          </select>
                        </div>
                      )}
                      <div className="field">
                        <label htmlFor="block-event-date">When</label>
                        <input id="block-event-date" type="date" min={today} value={event.date}
                          onChange={(e) => change({ event: { ...event, date: e.target.value } })} />
                      </div>
                      <div className="field">
                        <label htmlFor="block-event-goal">Goal time (optional)</label>
                        <input id="block-event-goal" className="short" value={event.goal} placeholder="18:00" inputMode="numeric"
                          onChange={(e) => change({ event: { ...event, goal: e.target.value } })} />
                      </div>
                    </div>
                    <p className="fine muted" role="status">
                      {weeks != null
                        ? `That is ${weeks} ${weeks === 1 ? 'week' : 'weeks'} from ${shortDate(draft.start)}. The event also shows on Analysis, and you stay here.`
                        : 'Its date sets how many weeks the block has.'}
                    </p>
                  </>
                )}
              </div>
              <div className={draft.purpose === 'weeks' ? 'setup-option on' : 'setup-option'}>
                <label className="setup-option-head">
                  <input type="radio" name="block-purpose" checked={draft.purpose === 'weeks'} onChange={() => change({ purpose: 'weeks' })} />
                  <span><strong>A set number of weeks</strong>
                    <small className="muted">No date in mind. Pick how long, and add an event later if one comes up.</small></span>
                </label>
                {draft.purpose === 'weeks' && (
                  <div className="field-row">
                    <div className="field">
                      <label htmlFor="block-new-weeks">Weeks</label>
                      <input id="block-new-weeks" className="short" type="number" min={1} max={MAX_PROGRAM_WEEKS} value={draft.weeks}
                        onChange={(e) => change({ weeks: e.target.value })} />
                    </div>
                  </div>
                )}
              </div>
            </fieldset>
            <div className="field-row">
              <div className="field">
                <label htmlFor="block-new-start">Starts</label>
                <select id="block-new-start" value={draft.start} disabled={busy} onChange={(e) => change({ start: e.target.value })}>
                  {starts.map((monday) => <option key={monday} value={monday}>{monday === choices[0] ? `This week · ${shortDate(monday)}` : monday === choices[1] ? `Next week · ${shortDate(monday)}` : shortDate(monday)}</option>)}
                </select>
              </div>
              <div className="field grow">
                <label htmlFor="block-new-name">Name (optional)</label>
                <input id="block-new-name" value={draft.name} maxLength={60} disabled={busy} placeholder={draft.purpose === 'event' && event.name.trim() ? event.name.trim() : 'Spring build'}
                  onChange={(e) => change({ name: e.target.value })} />
              </div>
            </div>
            {tried && stepOneProblem && <p role="alert" className="problem">{stepOneProblem}</p>}
          </>
        )}

        {step === 2 && (
          <>
            <h1 id="block-new-title">What does one week of it look like?</h1>
            <p className="setup-lead">
              Put each workout on the day you will do it. It starts from your week as it is now. The block repeats this
              week {weeks ?? ''} {weeks === 1 ? 'time' : 'times'}, and next you set how it builds.
            </p>
            <div className="block-grid-wrap">
              <div className="setup-lanes" role="table" aria-label="One week of the block">
                <div className="setup-lane head" role="row">
                  <div role="columnheader"><span className="visually-hidden">Row</span></div>
                  {WEEKDAYS.map((day) => <div key={day} role="columnheader">{WEEKDAY_LABELS[day].slice(0, 3)}</div>)}
                </div>
                <div className="setup-lane own" role="row">
                  <div role="rowheader" className="setup-lane-label">
                    <span className="kicker">In this block</span>
                    <strong>{weeks ?? '–'} {weeks === 1 ? 'week' : 'weeks'}</strong>
                    <small>Can change from week to week. Ends with the block.</small>
                  </div>
                  {WEEKDAYS.map((day) => {
                    const ids = ownOn(day);
                    return (
                      <div key={day} role="cell" className="setup-cell">
                        {ids.map((id) => {
                          const workout = live.find((entry) => entry.id === id);
                          const fromWeek = !added.some((entry) => entry.id === id && entry.day === day);
                          return (
                            <div key={id} className="setup-card">
                              <strong>{nameOf(id)}</strong>
                              {workout ? <small className="muted">{workoutSummary(workout)}</small> : null}
                              <button type="button" className="setup-card-x" disabled={busy}
                                aria-label={fromWeek ? `Move ${nameOf(id)} back to every week` : `Take ${nameOf(id)} off ${WEEKDAY_LABELS[day]}`}
                                title={fromWeek ? 'Back to every week' : 'Take off this day'} onClick={() => takeOff(id, day)}>×</button>
                            </div>
                          );
                        })}
                        <button type="button" className={adding === day ? 'setup-add on' : 'setup-add'} disabled={busy || ids.length >= MAX_DAY_WORKOUTS}
                          aria-expanded={adding === day} aria-label={`Add to the block on ${WEEKDAY_LABELS[day]}`}
                          onClick={() => setAdding(adding === day ? null : day)}>+ Add</button>
                      </div>
                    );
                  })}
                </div>
                <div className="setup-lane beside" role="row">
                  <div role="rowheader" className="setup-lane-label">
                    <span className="kicker">Every week</span>
                    <strong>Carries on</strong>
                    <small>The same every week, block or not.</small>
                  </div>
                  {WEEKDAYS.map((day) => (
                    <div key={day} role="cell" className="setup-cell">
                      {besideOn(day).map((id) => {
                        const time = plan.schedule.times?.[day]?.[id];
                        return (
                          <div key={id} className="setup-card quiet">
                            <strong>{nameOf(id)}</strong>
                            {time ? <small className="muted">{formatScheduleTime(time)}</small> : null}
                            <button type="button" className="link small" disabled={busy} aria-label={`Move ${nameOf(id)} into the block`}
                              onClick={() => change({ picked: [...picked, id] })}>Into block</button>
                          </div>
                        );
                      })}
                    </div>
                  ))}
                </div>
              </div>
            </div>
            {adding && (
              <div className="setup-adding">
                <AddWorkout key={adding} title={`Add to the block on ${WEEKDAY_LABELS[adding]}s`} action={`Add to ${WEEKDAY_LABELS[adding]}`}
                  state={state} accountId={accountId} catalog={catalog} write={write} busy={busy} miles={miles}
                  unavailable={(workout) => ownOn(adding).includes(workout.id) ? 'Already on this day' : null}
                  onPlace={(id) => place(id, adding)} onCancel={() => setAdding(null)} />
              </div>
            )}
            <p className="fine muted">
              {besideIds.length > 0
                ? `${listed(besideIds.map(nameOf))} already ${besideIds.length === 1 ? 'repeats' : 'repeat'} every week, so ${besideIds.length === 1 ? 'it stays where it is' : 'they stay where they are'}. Choose Into block on one if this block should change it from week to week.`
                : 'Anything you do every week anyway, like a weekly game, can stay out of the block. Add it in Schedule and it carries on beside it.'}
            </p>
            {tried && stepTwoProblem && <p role="alert" className="problem">{stepTwoProblem}</p>}
          </>
        )}

        {step === 3 && (
          <>
            <h1 id="block-new-title">How should it build?</h1>
            <p className="setup-lead">Pick how each workout grows and every week fills in. You can change any single week after the block starts.</p>
            {!body ? <p role="alert" className="problem">{stepOneProblem ?? stepTwoProblem ?? 'Go back and finish the earlier steps.'}</p> : (
              <>
                <div className="setup-easy">
                  <label htmlFor="block-easy">Easier week</label>
                  <select id="block-easy" value={draft.easy === undefined ? 4 : draft.easy ?? 0} disabled={busy}
                    onChange={(e) => change({ easy: (Number(e.target.value) || null) as EasyEvery })}>
                    {EASY_CHOICES.map((choice) => (
                      <option key={choice ?? 0} value={choice ?? 0} disabled={choice != null && body.weeks.length < choice}>
                        {choice == null ? 'None' : `Every ${choice === 3 ? '3rd' : `${choice}th`} week`}
                      </option>
                    ))}
                  </select>
                  <span className="muted fine">
                    {easyEvery != null ? 'An easier week is about four fifths of the week before it. ' : ''}Week 1 starts from what each workout asks for today.
                  </span>
                </div>
                <div className="block-grid-wrap">
                  <table className="block-table build-table">
                    <thead>
                      <tr>
                        <th scope="col">Workout</th>
                        <th scope="col" className="block-col">Builds by</th>
                        {body.weeks.map((entry, index) => (
                          <th key={index} scope="col" className="block-week">
                            <span className="kicker">Week {index + 1}</span>
                            <strong>{shortDate(weekStart(body, index)).slice(5)}</strong>
                            {entry.label ? <span className="muted">{entry.label}</span> : null}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {(body.workout_ids ?? []).flatMap((id) => live.find((workout) => workout.id === id) ?? []).map((workout) => (
                        <tr key={workout.id}>
                          <th scope="row">
                            <strong>{workout.name}</strong>
                            <small className="muted">{workoutSummary(workout)}</small>
                          </th>
                          <td>
                            <BuildsBy workout={workout} miles={miles} disabled={busy} rule={usableBuild(workout, draft.builds?.[workout.id], miles)}
                              onChange={(rule) => change({ builds: { ...(draft.builds ?? {}), [workout.id]: rule } })} />
                          </td>
                          {body.weeks.map((_, index) => (
                            <td key={index} className="block-cell"><span className="build-value">{weekHeadline(workout, body, index, miles) || 'As saved'}</span></td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="fine muted">
                  {draft.purpose === 'event' && weeks != null ? `The last week ends ${shortDate(addDays(draft.start, weeks * 7 - 1))}, the week of ${event.name.trim() || 'your event'}. ` : ''}
                  {besideIds.length > 0 ? `Beside the block every week: ${listed(besideIds.map(nameOf))}.` : ''}
                </p>
              </>
            )}
            {tried && !body && <p role="alert" className="problem">Finish the earlier steps to start the block.</p>}
          </>
        )}

        <div className="form-actions">
          {step === 3
            ? <button type="button" className="primary" disabled={busy || !body || needsReview || exists} onClick={() => { void submit(); }}>Start block</button>
            : <button type="button" className="primary" disabled={busy || needsReview || exists} onClick={forward}>Continue</button>}
          {step > 1 && <button type="button" className="ghost" disabled={busy} onClick={() => go((step - 1) as Step)}>Back</button>}
          <button type="button" className="ghost" disabled={busy} onClick={cancel}>{retained.record ? 'Discard this block' : 'Cancel'}</button>
          {step === 1 && retained.record && <span className="muted fine">Kept in this browser until you start or discard it.</span>}
          {step === 2 && (
            <span className="muted fine">{ownIds.length} block {ownIds.length === 1 ? 'workout' : 'workouts'} a week
              {besideIds.length > 0 ? ` · ${besideIds.length} every-week ${besideIds.length === 1 ? 'one' : 'ones'} beside ${ownIds.length === 1 ? 'it' : 'them'}` : ''}</span>
          )}
        </div>
      </div>
    </section>
  );
}

/**
 * How one workout builds: the same every week, a little more each week, or
 * set by hand. The amount is typed beside the choice.
 */
export function BuildsBy({ workout, rule, miles, disabled, onChange }: {
  workout: Workout; rule: BuildRule; miles: boolean; disabled?: boolean; onChange: (rule: BuildRule) => void;
}) {
  const options = buildOptions(workout, miles);
  const option = rule.kind === 'add' ? options.find((entry) => entry.target === rule.target) : undefined;
  const [text, setText] = useState<string | null>(null);
  const shown = text ?? (rule.kind === 'add' && option ? String(Math.round((rule.amount / option.scale) * 100) / 100) : '');
  const value = rule.kind === 'add' ? `add:${rule.target}` : rule.kind;
  if (options.length === 0) {
    return <span className="muted">{workout.exercises.length === 0 ? 'An activity: the same every week' : 'The same every week'}</span>;
  }
  return (
    <span className="builds-by">
      <select aria-label={`${workout.name}: builds by`} title={buildLabel(rule, options)} value={value} disabled={disabled} onChange={(event) => {
        setText(null);
        const next = event.target.value;
        if (next === 'same' || next === 'manual') { onChange({ kind: next }); return; }
        const chosen = options.find((entry) => `add:${entry.target}` === next);
        if (chosen) onChange({ kind: 'add', target: chosen.target, amount: chosen.amount });
      }}>
        {options.map((entry) => <option key={entry.target} value={`add:${entry.target}`}>Add {entry.name} each week</option>)}
        <option value="same">The same every week</option>
        <option value="manual">I’ll set each week myself</option>
      </select>
      {rule.kind === 'add' && option && (
        <span className="builds-amount">
          <span aria-hidden="true">+</span>
          <input className="short" inputMode="decimal" aria-label={`${workout.name}: ${option.name} added each week, in ${option.unit}`} value={shown} disabled={disabled}
            onChange={(event) => {
              setText(event.target.value);
              const amount = Number(event.target.value.trim().replace(',', '.'));
              if (event.target.value.trim() && Number.isFinite(amount) && amount > 0) onChange({ kind: 'add', target: option.target, amount: amount * option.scale });
            }}
            onBlur={() => setText(null)} />
          <span className="muted">{option.unit} a week</span>
        </span>
      )}
    </span>
  );
}
