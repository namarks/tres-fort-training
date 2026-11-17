import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { weekdayOf } from '../../src/calendarProjection';
import type { Trip, Weekday } from '../../src/types';
import { AddWorkout } from './AddWorkout';
import { dateWrites, planWrites, type StateResponse } from './api';
import { shortDate } from './blocks';
import { formatLongDate, WEEKDAY_LABELS, type CalendarCell, type Workout } from './model';
import {
  AWAY_KINDS,
  NOTE_LIMIT,
  attemptOn,
  awayDraft,
  awayFields,
  awayKindLabel,
  dateChangeBlocked,
  hasWorkout,
  moveBlocked,
  routineAddingWorkout,
  routineAddProblem,
  routineDay,
  routineDayFull,
  splitTrips,
  type AwayDraft,
} from './scheduling';
import type { Catalog, Write } from './WorkoutEditor';

/** What the Add box needs to make a workout: without it a date can't take one here. */
export interface Adder { accountId: string; catalog: Catalog; miles: boolean }

type DatePanel = 'change' | 'move' | 'remove' | null;

/** A date nothing is planned on and nothing was chosen for: its Add box opens with it. */
function emptyDate(cell: CalendarCell | undefined): boolean {
  return !hasWorkout(cell) && !cell?.real && !cell?.sessions?.length && !cell?.extras?.length && !cell?.items.length
    && cell?.status !== 'unavailable';
}

/**
 * A date's own changes: add or change its workout, move it to another date,
 * or make it rest. A workout is added by type (a run, a ride, a lift) or
 * from the saved ones, for this date or for its weekday every week.
 */
export function DateActions(props: {
  date: string;
  today: string;
  cell: CalendarCell | undefined;
  workout: Workout | undefined;
  state: StateResponse;
  cellFor: (date: string) => CalendarCell | undefined;
  write: Write;
  busy: boolean;
  adder?: Adder;
  /** False on a block's dates that the repeating week does not reach. */
  weekly?: boolean;
  /** A running block's own workouts, which the repeating week can't hold. */
  blockIds?: ReadonlySet<string>;
  /** The latest ask to open a date's Add box (a double click on it). */
  addAsked?: { date: string } | null;
}) {
  const { date, today, cell, workout, state, cellFor, write, busy, adder, weekly = true, addAsked = null, blockIds } = props;
  const empty = !!adder && date >= today && emptyDate(cell);
  const [panel, setPanel] = useState<DatePanel>(adder && (empty || addAsked?.date === date) ? 'change' : null);
  const sessions = state.sessions;
  const showsWorkout = hasWorkout(cell) && !!workout;
  // Another date, or a newer plan, closes any open form; an empty date opens with its Add box.
  const mounted = useRef(false);
  useEffect(() => {
    if (mounted.current) setPanel(empty ? 'change' : null);
    // `empty` follows the date and the plan, so it is not a reason of its own.
  }, [date, state]);
  useEffect(() => {
    if (mounted.current && adder && addAsked?.date === date) setPanel('change');
  }, [addAsked]);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  if (date < today || !state.plan) return null;
  const blocked = dateChangeBlocked(date, today, cell, sessions);
  if (blocked) return <p className="fine">{blocked}</p>;
  const plannedRow = sessions.some((session) => session.date === date && (session.slot ?? 0) === 0 && session.status === 'planned');
  const close = () => setPanel(null);
  const done = async (saved: Promise<boolean>) => { if (await saved) close(); };

  return (
    <section className="date-actions" aria-label="This date">
      {panel === null && (
        <div className="head-actions">
          {adder && (
            <button type="button" className={showsWorkout ? 'ghost small' : 'small'} disabled={busy} onClick={() => setPanel('change')}>
              {showsWorkout ? 'Change workout' : 'Add a workout'}
            </button>
          )}
          {showsWorkout && <button type="button" className="ghost small" disabled={busy} onClick={() => setPanel('move')}>Move to another date</button>}
          {(showsWorkout || plannedRow) && cell?.status !== 'rest' && (
            <button type="button" className="ghost small danger" disabled={busy} onClick={() => setPanel('remove')}>Make it a rest day</button>
          )}
        </div>
      )}
      {panel === 'change' && adder && (
        <AddToDate key={date} date={date} current={showsWorkout ? workout! : null} state={state} write={write} busy={busy}
          adder={adder} weekly={weekly} blockIds={blockIds} onClose={close} />
      )}
      {panel === 'move' && workout && (
        <MoveWorkout
          from={date}
          today={today}
          workout={workout}
          busy={busy}
          problem={(to) => moveBlocked({ from: date, to, today, fromCell: cell, toCell: cellFor(to), sessions })}
          onCancel={close}
          onMove={(to) => done(write((at) => dateWrites.moveDate({
            from: date, to, today, workoutId: workout.id,
            fromAttempt: attemptOn(sessions, date), toAttempt: attemptOn(sessions, to),
          }, at)))}
        />
      )}
      {panel === 'remove' && (
        <ConfirmPanel action={cell?.sessions?.length ? 'Skip main workout' : 'Make it a rest day'} busy={busy} onCancel={close}
          onConfirm={() => done(write(() => dateWrites.setDate(date, null, attemptOn(sessions, date))))}>
          {cell?.sessions?.length ? `Skip the main workout on ${formatLongDate(date)}. Other workouts on this date stay in place.`
            : `${formatLongDate(date)} becomes a rest day.`} The saved workout and your weekly routine stay as they are.
        </ConfirmPanel>
      )}
    </section>
  );
}

/**
 * The Add box for a date (owner, 2026-11-17): pick what it is, set its
 * details, and say whether it is for this date or for the weekday every
 * week. One save makes the workout and places it.
 */
function AddToDate({ date, current, state, write, busy, adder, weekly, blockIds, onClose }: {
  date: string;
  /** The workout this date shows now, which a choice for the date replaces. */
  current: Workout | null;
  state: StateResponse;
  write: Write;
  busy: boolean;
  adder: Adder;
  weekly: boolean;
  blockIds?: ReadonlySet<string>;
  onClose: () => void;
}) {
  const plan = state.plan!;
  const day = weekdayOf(date) as Weekday;
  const dayName = WEEKDAY_LABELS[day];
  const short = shortDate(date);
  const [when, setWhen] = useState<'date' | 'weekly'>('date');
  const [time, setTime] = useState('');
  const id = useId();
  const everyWeek = weekly && when === 'weekly';
  const held = routineDay(plan.schedule, day);
  return (
    <AddWorkout
      title={current ? `Change ${short}` : `Add to ${short}`}
      action={everyWeek ? `Add to every ${dayName}` : current ? `Use on ${short}` : `Add to ${short}`}
      state={state} accountId={adder.accountId} catalog={adder.catalog} miles={adder.miles} write={write} busy={busy}
      // A block places its own workouts, so the repeating week can't take them.
      unavailable={(workout) => everyWeek ? blockIds?.has(workout.id) ? 'In your block' : routineAddProblem(plan.schedule, day, workout.id)
        : workout.id === current?.id ? 'On this date now' : null}
      blocked={everyWeek && routineDayFull(held) ? `${dayName} already has five workouts every week.` : null}
      onPlace={async (workoutId, at) => {
        if (!everyWeek) { await dateWrites.setDate(date, workoutId, attemptOn(state.sessions, date)); return; }
        // One made in this save is not in the reviewed list yet.
        const known = plan.workouts.some((workout) => workout.id === workoutId) ? plan.workouts
          : [...plan.workouts, { id: workoutId, name: '', order_index: Number.MAX_SAFE_INTEGER, exercises: [] } as unknown as Workout];
        const result = routineAddingWorkout(plan.schedule, [day], workoutId, time, known);
        if (!result.ok) throw new Error(result.error);
        await planWrites.setRoutine(result.schedule, at);
      }}
      onCancel={onClose}
    >
      {weekly && (
        <fieldset className="add-when">
          <legend>When</legend>
          <label className="check">
            <input type="radio" name={`${id}-when`} checked={when === 'date'} onChange={() => setWhen('date')} />
            <span>Just {short}{current ? <small className="muted">Instead of {current.name}, on this date only.</small> : null}</span>
          </label>
          <label className="check">
            <input type="radio" name={`${id}-when`} checked={when === 'weekly'} onChange={() => setWhen('weekly')} />
            <span>Every {dayName}{held.primary ? <small className="muted">Alongside what is already on {dayName}s.</small> : null}</span>
          </label>
          {everyWeek && (
            <div className="field">
              <label htmlFor={`${id}-time`}>Time · optional</label>
              <input id={`${id}-time`} type="time" value={time} onChange={(event) => setTime(event.target.value)} />
            </div>
          )}
        </fieldset>
      )}
      {!weekly && current && <p className="fine muted">Instead of {current.name}, on {short} only.</p>}
    </AddWorkout>
  );
}

function MoveWorkout(props: {
  from: string;
  today: string;
  workout: Workout;
  busy: boolean;
  problem: (to: string) => string | null;
  onMove: (to: string) => void;
  onCancel: () => void;
}) {
  const { from, today, workout, busy, problem, onMove, onCancel } = props;
  const [to, setTo] = useState('');
  const id = useId();
  const reason = to ? problem(to) : null;
  return (
    <form className="panel" onSubmit={(event) => { event.preventDefault(); if (to && !reason) onMove(to); }}>
      <label htmlFor={id}>Move {workout.name} to</label>
      <input id={id} type="date" min={today} value={to} onChange={(event) => setTo(event.target.value)}
        aria-describedby={`${id}-hint`} autoFocus />
      <small id={`${id}-hint`} className="muted">{formatLongDate(from)} becomes a rest day. Your saved workout and weekly routine stay the same.</small>
      {reason && <p role="alert" className="problem">{reason}</p>}
      <div className="form-actions">
        <button type="submit" disabled={busy || !to || !!reason}>Move workout</button>
        <button type="button" className="ghost" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

export function ConfirmPanel(props: { children: ReactNode; action: string; busy: boolean; onConfirm: () => void; onCancel: () => void }) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  useEffect(() => cancelRef.current?.focus(), []);
  return (
    <div className="panel confirm" role="group" aria-label={props.action}>
      <p>{props.children}</p>
      <div className="form-actions">
        <button type="button" className="danger-fill" disabled={props.busy} onClick={props.onConfirm}>{props.action}</button>
        <button ref={cancelRef} type="button" className="ghost" onClick={props.onCancel}>Cancel</button>
      </div>
    </div>
  );
}

/** Trips, planned rest and injuries that pause the weekly routine. */
export function AwayDates(props: { trips: Trip[]; today: string; version: number; write: Write; busy: boolean }) {
  const { trips, today, version, write, busy } = props;
  const [editing, setEditing] = useState<{ trip: Trip | null } | null>(null);
  const [removing, setRemoving] = useState<Trip | null>(null);
  const [showPast, setShowPast] = useState(false);
  // A newer plan closes any open form, so a stale one can't overwrite it.
  useEffect(() => { setEditing(null); setRemoving(null); }, [version]);
  const { upcoming, past } = splitTrips(trips, today);

  const row = (trip: Trip) => (
    <li key={trip.id}>
      <div className="away-row">
        <div>
          <div>{tripRange(trip)}</div>
          <div className="muted">{awayKindLabel(trip)}</div>
          {trip.note ? <div className="muted">{trip.note}</div> : null}
        </div>
        <div className="row-actions">
          <button type="button" className="ghost small" disabled={busy} onClick={() => setEditing({ trip })}
            aria-label={`Edit away dates ${tripRange(trip)}`}>Edit</button>
          <button type="button" className="ghost small danger" disabled={busy} onClick={() => setRemoving(trip)}
            aria-label={`Remove away dates ${tripRange(trip)}`}>Remove</button>
        </div>
      </div>
      {editing?.trip?.id === trip.id && (
        <AwayForm trip={trip} today={today} busy={busy} onCancel={() => setEditing(null)}
          onSave={(fields) => write((at) => planWrites.updateAwayDates(trip.id, fields, at)).then((saved) => { if (saved) setEditing(null); })} />
      )}
      {removing?.id === trip.id && (
        <ConfirmPanel action="Remove away dates" busy={busy} onCancel={() => setRemoving(null)}
          onConfirm={() => write((at) => planWrites.removeAwayDates(trip.id, at)).then((saved) => { if (saved) setRemoving(null); })}>
          Remove {tripRange(trip)}? Your weekly routine applies to these days again.
        </ConfirmPanel>
      )}
    </li>
  );

  return (
    <section className="away" aria-labelledby="away-title">
      <div className="section-head">
        <h2 id="away-title">Away dates</h2>
        {!editing && <button type="button" className="ghost small" disabled={busy} onClick={() => setEditing({ trip: null })}>Add away dates</button>}
      </div>
      <p className="muted hint">Your weekly routine pauses on these days.</p>
      {editing && editing.trip === null && (
        <AwayForm trip={null} today={today} busy={busy} onCancel={() => setEditing(null)}
          onSave={(fields) => write((at) => planWrites.addAwayDates(fields, at)).then((saved) => { if (saved) setEditing(null); })} />
      )}
      {upcoming.length ? <ul className="away-list">{upcoming.map(row)}</ul> : <p className="muted">Nothing coming up.</p>}
      {past.length > 0 && (
        <>
          <button type="button" className="ghost small" onClick={() => setShowPast(!showPast)} aria-expanded={showPast}>
            {showPast ? 'Hide past away dates' : `Show past away dates (${past.length})`}
          </button>
          {showPast && <ul className="away-list">{past.map(row)}</ul>}
        </>
      )}
    </section>
  );
}

function tripRange(trip: Trip): string {
  const short = (date: string) => new Date(`${date}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
  return trip.start === trip.end ? short(trip.start) : `${short(trip.start)} – ${short(trip.end)}`;
}

function AwayForm(props: {
  trip: Trip | null;
  today: string;
  busy: boolean;
  onSave: (fields: Record<string, unknown>) => void;
  onCancel: () => void;
}) {
  const { trip, today, busy, onSave, onCancel } = props;
  const [draft, setDraft] = useState<AwayDraft>(() => awayDraft(trip, today));
  const [error, setError] = useState<string | null>(null);
  const id = useId();
  const set = (patch: Partial<AwayDraft>) => setDraft((current) => {
    const next = { ...current, ...patch };
    // Moving the first day past the last day moves the last day with it.
    if (patch.start && next.end < next.start) next.end = next.start;
    return next;
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    const result = awayFields(draft, trip);
    if (!result.ok) return setError(result.error);
    setError(null);
    if (Object.keys(result.fields).length === 0) return onCancel();
    onSave(result.fields);
  }

  return (
    <form className="panel away-form" onSubmit={submit} noValidate aria-label={trip ? 'Edit away dates' : 'Add away dates'}>
      <div className="field-row">
        <div className="field">
          <label htmlFor={`${id}-start`}>First day</label>
          <input id={`${id}-start`} type="date" value={draft.start} onChange={(e) => set({ start: e.target.value })} autoFocus />
        </div>
        <div className="field">
          <label htmlFor={`${id}-end`}>Last day</label>
          <input id={`${id}-end`} type="date" min={draft.start} value={draft.end} onChange={(e) => set({ end: e.target.value })} />
        </div>
        <div className="field">
          <label htmlFor={`${id}-type`}>Reason</label>
          <select id={`${id}-type`} value={draft.type} onChange={(e) => set({ type: e.target.value as AwayDraft['type'] })}>
            {AWAY_KINDS.map((kind) => <option key={kind.type} value={kind.type}>{kind.label}</option>)}
          </select>
        </div>
      </div>
      <label className="check">
        <input type="checkbox" checked={draft.canTrain} onChange={(e) => set({ canTrain: e.target.checked })} aria-describedby={`${id}-train`} />
        I can still train
      </label>
      <small id={`${id}-train`} className="muted">
        {draft.canTrain
          ? 'Your weekly routine pauses on these days. You can still put a workout on one of them.'
          : 'These days are blocked: your weekly routine pauses and no workout can go on them.'}
      </small>
      <div className="field">
        <label htmlFor={`${id}-note`}>Note</label>
        <input id={`${id}-note`} value={draft.note} maxLength={NOTE_LIMIT} placeholder="Optional, such as hotel gym only"
          onChange={(e) => set({ note: e.target.value })} />
      </div>
      {error && <p role="alert" className="problem">{error}</p>}
      <div className="form-actions">
        <button type="submit" disabled={busy}>{busy ? 'Saving…' : trip ? 'Save' : 'Add away dates'}</button>
        <button type="button" className="ghost" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}
