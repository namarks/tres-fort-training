import { useEffect, useId, useRef, useState, type DragEvent, type FormEvent, type ReactNode } from 'react';
import { MAX_SCHEDULE_EXTRAS, WEEKDAYS, type Trip, type Weekday, type WeeklySchedule } from '../../src/types';
import { dateWrites, planWrites, type Reviewed, type StateResponse } from './api';
import { formatLongDate, formatScheduleTime, WEEKDAY_LABELS, type CalendarCell, type Workout } from './model';
import {
  AWAY_KINDS,
  NOTE_LIMIT,
  attemptOn,
  awayDraft,
  awayFields,
  awayKindLabel,
  choosableWorkouts,
  dateChangeBlocked,
  hasWorkout,
  moveBlocked,
  routineAddProblem,
  routineAddingWorkout,
  routineDay,
  routineDayProblem,
  routineExtra,
  routinePrimary,
  routineWithDay,
  splitTrips,
  type AwayDraft,
  type RoutineDayDraft,
  type RoutineSchedule,
} from './scheduling';
import type { Write } from './WorkoutEditor';
import './routine.css';

const DRAG_TYPE = 'application/x-tresfort-workout';

type RoutineReview = { schedule: RoutineSchedule; at: Reviewed };

/** Review the whole day's workouts and times before saving its repeating pattern. */
export function RoutineEditor(props: {
  schedule: WeeklySchedule; workouts: Workout[]; reviewed: Reviewed; write: Write; busy: boolean;
  selectedWorkoutId?: string | null; onScheduled?: () => void; onCancelSelection?: () => void;
  /** Opens one weekday's form, as when its Edit day button is chosen. */
  openDayRequest?: { day: Weekday; key: number } | null;
  hint?: string;
}) {
  const { schedule, workouts, reviewed, write, busy } = props;
  const choosable = choosableWorkouts(workouts);
  const [over, setOver] = useState<Weekday | null>(null);
  const [editing, setEditing] = useState<{ day: Weekday; review: RoutineReview; draft: RoutineDayDraft } | null>(null);
  const [localSelection, setLocalSelection] = useState<string | null>(null);
  const [dismissedSelection, setDismissedSelection] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const ids = useId();
  const reviewKey = `${reviewed.planId}:${reviewed.version}`;
  const selectedId = props.selectedWorkoutId && props.selectedWorkoutId !== dismissedSelection
    ? props.selectedWorkoutId : localSelection;
  const selected = choosable.find((workout) => workout.id === selectedId);
  const locked = busy || !!editing || !!selected;
  // A new reviewed plan cannot inherit a full-schedule draft from an old one.
  useEffect(() => { setEditing(null); setMessage(''); }, [reviewKey]);
  useEffect(() => { setDismissedSelection(null); setEditing(null); }, [props.selectedWorkoutId]);

  const review = (): RoutineReview => ({ schedule: structuredClone(schedule), at: { ...reviewed } });
  const openDay = (day: Weekday, workoutId?: string) => {
    if (locked) return;
    let draft = routineDay(schedule, day);
    if (workoutId) {
      const result = routineAddingWorkout(schedule, [day], workoutId, '', choosable);
      if (!result.ok) { setMessage(result.error); return; }
      draft = routineDay(result.schedule, day);
    }
    setMessage('');
    setEditing({ day, review: review(), draft });
  };
  const requestKey = props.openDayRequest?.key;
  useEffect(() => {
    if (props.openDayRequest) openDay(props.openDayRequest.day);
    // Only a new request opens a day; a re-render with the same one doesn't.
  }, [requestKey]);
  const drop = (day: Weekday) => (event: DragEvent) => {
    event.preventDefault();
    setOver(null);
    if (locked) return;
    const workoutId = event.dataTransfer.getData(DRAG_TYPE);
    if (choosable.some((workout) => workout.id === workoutId)) openDay(day, workoutId);
  };
  const dragOver = (day: Weekday) => (event: DragEvent) => {
    if (locked || !event.dataTransfer.types.includes(DRAG_TYPE)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    setOver(day);
  };

  return (
    <section className="routine routine-editor" aria-labelledby="routine-title">
      <h2 id="routine-title">Your usual week</h2>
      <p className="muted hint">{props.hint ? `${props.hint} ` : ''}Build your repeating week with a main workout and up to four separate workouts each day. Each can have its own time. Single dates on the calendar can still differ.</p>
      {selected && <AddWorkoutToWeek key={`${reviewKey}:${selected.id}`} workout={selected} workouts={choosable}
        review={review()} busy={busy} write={write} onDone={() => {
          setLocalSelection(null); setDismissedSelection(selected.id); props.onScheduled?.();
        }} onCancel={() => {
          setLocalSelection(null); setDismissedSelection(selected.id); props.onCancelSelection?.();
        }} />}
      {choosable.length > 0 && !selected && (
        <ul className="palette" aria-label="Workouts you can drag onto a weekday">
          {choosable.map((entry) => (
            <li key={entry.id}>
              <button type="button" className="ghost small" disabled={locked} draggable={!locked}
                onClick={() => { setLocalSelection(entry.id); setMessage(''); }}
                onDragStart={(event) => {
                  event.dataTransfer.setData(DRAG_TYPE, entry.id);
                  event.dataTransfer.effectAllowed = 'copy';
                }} aria-label={`Add ${entry.name} to your week`}>{entry.name}</button>
            </li>
          ))}
        </ul>
      )}
      {choosable.length > 0 && !selected && <p className="fine">Choose a workout above to add it to several days, or drag it onto a day to review before saving.</p>}
      {message && <p role="status" className="problem">{message}</p>}
      <ol className="routine-days">
        {WEEKDAYS.map((day) => {
          const draft = routineDay(schedule, day);
          const entries = [...(draft.primary ? [draft.primary] : []), ...draft.extras];
          return (
            <li key={day} className={over === day ? 'drop' : ''} onDragOver={dragOver(day)}
              onDragLeave={() => setOver((value) => (value === day ? null : value))} onDrop={drop(day)}>
              <h3>{WEEKDAY_LABELS[day]}</h3>
              {entries.length === 0 && <p className="muted">Rest</p>}
              {entries.map((id, index) => <div className="routine-entry" key={`${id}-${index}`}>
                <span>{choosable.find((workout) => workout.id === id)?.name ?? 'Unavailable workout'}</span>
                <small className="muted">{id === draft.primary ? 'Main' : 'Separate'}
                  {draft.times[id] ? ` · ${formatScheduleTime(draft.times[id])}` : ''}</small>
              </div>)}
              <button type="button" id={`${ids}-${day}`} className="ghost small" disabled={locked}
                aria-label={`Edit ${WEEKDAY_LABELS[day]}`} onClick={() => openDay(day)}>Edit day</button>
            </li>
          );
        })}
      </ol>
      {editing && <RoutineDayForm key={`${reviewKey}:${editing.day}`} day={editing.day} initial={editing.draft}
        review={editing.review} workouts={choosable} write={write} busy={busy} onClose={() => setEditing(null)} />}
    </section>
  );
}

function RoutineDayForm(props: {
  day: Weekday; initial: RoutineDayDraft; review: RoutineReview; workouts: Workout[];
  write: Write; busy: boolean; onClose: () => void;
}) {
  const { day, review, workouts, write, busy, onClose } = props;
  const [draft, setDraft] = useState(props.initial);
  const ids = useId();
  const problem = routineDayProblem(draft, workouts);
  const updateTime = (id: string, time: string) => setDraft((value) => ({ ...value, times: { ...value.times, [id]: time } }));
  return <form className="panel routine-form" aria-label={`Edit ${WEEKDAY_LABELS[day]}`} onSubmit={async (event) => {
    event.preventDefault();
    if (busy) return;
    const result = routineWithDay(review.schedule, day, draft, workouts);
    if (result.ok && await write(() => planWrites.setRoutine(result.schedule, review.at))) onClose();
  }}>
    <h3>Every {WEEKDAY_LABELS[day]}</h3>
    <p className="fine">Changes apply to this weekday in your repeating routine. Each workout keeps its own completion.</p>
    <fieldset disabled={busy}>
      <legend>Main workout</legend>
      <label htmlFor={`${ids}-main`}>Workout</label>
      <select id={`${ids}-main`} value={draft.primary ?? ''} autoFocus
        onChange={(event) => setDraft(routinePrimary(draft, event.target.value || null))}>
        <option value="">{draft.extras.length ? 'No main workout' : 'Rest'}</option>
        {draft.primary && !workouts.some((workout) => workout.id === draft.primary) && <option value={draft.primary}>Unavailable workout — choose another</option>}
        {workouts.map((workout) => <option key={workout.id} value={workout.id}>{workout.name}</option>)}
      </select>
      {draft.primary && <RoutineTime id={`${ids}-main-time`} name={workouts.find((workout) => workout.id === draft.primary)?.name ?? 'Main workout'}
        value={draft.times[draft.primary] ?? ''} onChange={(time) => updateTime(draft.primary!, time)} />}
    </fieldset>
    {draft.extras.map((id, index) => <fieldset key={index} disabled={busy}>
      <legend>Separate workout {index + 1}</legend>
      <label htmlFor={`${ids}-extra-${index}`}>Workout</label>
      <select id={`${ids}-extra-${index}`} value={id}
        onChange={(event) => setDraft(routineExtra(draft, index, event.target.value))}>
        <option value="">Choose a workout</option>
        {id && !workouts.some((workout) => workout.id === id) && <option value={id}>Unavailable workout — choose another</option>}
        {workouts.filter((workout) => workout.id !== draft.primary && (!draft.extras.includes(workout.id) || workout.id === id))
          .map((workout) => <option key={workout.id} value={workout.id}>{workout.name}</option>)}
      </select>
      {id && <RoutineTime id={`${ids}-extra-time-${index}`} name={workouts.find((workout) => workout.id === id)?.name ?? `Separate workout ${index + 1}`}
        value={draft.times[id] ?? ''} onChange={(time) => updateTime(id, time)} />}
      <button type="button" className="ghost small danger" onClick={() => setDraft(routineExtra(draft, index, null))}
        aria-label={`Remove separate workout ${index + 1}`}>Remove</button>
    </fieldset>)}
    <button type="button" className="ghost" disabled={busy || draft.extras.length >= MAX_SCHEDULE_EXTRAS
      || !workouts.some((workout) => workout.id !== draft.primary && !draft.extras.includes(workout.id))}
      onClick={() => setDraft({ ...draft, extras: [...draft.extras, ''] })}>Add a separate workout</button>
    {problem && <p className="problem" role="status">{problem}</p>}
    <p className="fine">Times are optional. On iPhone, reminders depend on your notification settings.</p>
    <div className="form-actions">
      <button type="submit" disabled={busy || !!problem}>Save {WEEKDAY_LABELS[day]}</button>
      <button type="button" className="ghost" disabled={busy} onClick={onClose}>Cancel</button>
    </div>
  </form>;
}

function RoutineTime(props: { id: string; name: string; value: string; onChange: (value: string) => void }) {
  return <div className="routine-time">
    <label htmlFor={props.id}>Time for {props.name} · optional</label>
    <input id={props.id} type="time" value={props.value} onChange={(event) => props.onChange(event.target.value)} />
    {props.value && <button type="button" className="ghost small" aria-label={`Clear time for ${props.name}`} onClick={() => props.onChange('')}>Clear time</button>}
  </div>;
}

function AddWorkoutToWeek(props: {
  workout: Workout; workouts: Workout[]; review: RoutineReview; write: Write; busy: boolean;
  onDone: () => void; onCancel: () => void;
}) {
  const { workout, workouts, write, busy, onDone, onCancel } = props;
  const [review] = useState(props.review);
  const [days, setDays] = useState<Weekday[]>([]);
  const [time, setTime] = useState('');
  const id = useId();
  const firstAvailableDay = WEEKDAYS.find((day) => !routineAddProblem(review.schedule, day, workout.id));
  const result = routineAddingWorkout(review.schedule, days, workout.id, time, workouts);
  return <form className="panel routine-form routine-add" aria-label={`Add ${workout.name} to your week`} onSubmit={async (event) => {
    event.preventDefault();
    if (!busy && result.ok && await write(() => planWrites.setRoutine(result.schedule, review.at))) onDone();
  }}>
    <h3>Add {workout.name} to your week</h3>
    <p className="muted">Choose its days. Workouts already on those days stay in place, with their own times.</p>
    <fieldset disabled={busy}>
      <legend>Every week on</legend>
      <div className="routine-day-choices">{WEEKDAYS.map((day) => {
        const problem = routineAddProblem(review.schedule, day, workout.id);
        const primary = workouts.find((entry) => entry.id === review.schedule.week[day]);
        return <label key={day}>
          <input type="checkbox" value={day} checked={days.includes(day)} disabled={!!problem} autoFocus={day === firstAvailableDay}
            onChange={(event) => setDays(event.target.checked ? [...days, day] : days.filter((entry) => entry !== day))} />
          <span>{WEEKDAY_LABELS[day]}<small className="muted">{problem ?? (primary ? `Alongside ${primary.name}` : 'As the main workout')}</small></span>
        </label>;
      })}</div>
      <RoutineTime id={`${id}-time`} name={workout.name} value={time} onChange={setTime} />
    </fieldset>
    <p className="fine">Times are optional. On iPhone, reminders depend on your notification settings.</p>
    {!result.ok && days.length > 0 && <p role="status" className="problem">{result.error}</p>}
    <div className="form-actions">
      <button type="submit" disabled={busy || !result.ok}>Add to selected days</button>
      <button type="button" className="ghost" disabled={busy} onClick={onCancel}>Cancel</button>
    </div>
  </form>;
}

type DatePanel = 'change' | 'move' | 'remove' | null;

/**
 * This date only: choose or change its workout, move it to another date, or
 * make it rest. The weekly routine and the saved workout stay as they are.
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
}) {
  const { date, today, cell, workout, state, cellFor, write, busy } = props;
  const [panel, setPanel] = useState<DatePanel>(null);
  const sessions = state.sessions;
  const workouts = choosableWorkouts(state.plan?.workouts ?? []);
  const showsWorkout = hasWorkout(cell) && !!workout;
  // Another date, or a newer plan, closes any open form.
  useEffect(() => setPanel(null), [date, state]);
  if (date < today || !state.plan) return null;
  const blocked = dateChangeBlocked(date, today, cell, sessions);
  if (blocked) return <p className="fine">{blocked}</p>;
  const plannedRow = sessions.some((session) => session.date === date && (session.slot ?? 0) === 0 && session.status === 'planned');
  const close = () => setPanel(null);
  const done = async (saved: Promise<boolean>) => { if (await saved) close(); };

  return (
    <section className="date-actions" aria-label="This date only">
      {panel === null && (
        <div className="head-actions">
          <button type="button" className="ghost small" disabled={busy} onClick={() => setPanel('change')}>
            {showsWorkout ? 'Change workout' : 'Choose a workout'}
          </button>
          {showsWorkout && <button type="button" className="ghost small" disabled={busy} onClick={() => setPanel('move')}>Move to another date</button>}
          {(showsWorkout || plannedRow) && cell?.status !== 'rest' && (
            <button type="button" className="ghost small danger" disabled={busy} onClick={() => setPanel('remove')}>Make it a rest day</button>
          )}
        </div>
      )}
      {panel === 'change' && (
        <ChooseWorkout
          workouts={workouts}
          current={showsWorkout ? workout!.id : null}
          busy={busy}
          onCancel={close}
          onChoose={(workoutId) => done(write(() => dateWrites.setDate(date, workoutId, attemptOn(sessions, date))))}
        />
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

function ChooseWorkout(props: {
  workouts: Workout[];
  current: string | null;
  busy: boolean;
  onChoose: (workoutId: string) => void;
  onCancel: () => void;
}) {
  const { workouts, current, busy, onChoose, onCancel } = props;
  const [choice, setChoice] = useState(workouts.find((workout) => workout.id !== current)?.id ?? '');
  const id = useId();
  if (workouts.length === 0) {
    return (
      <div className="panel">
        <p className="muted">There are no workouts to choose. Build one in Workouts first.</p>
        <div className="form-actions"><button type="button" className="ghost" onClick={onCancel}>Cancel</button></div>
      </div>
    );
  }
  return (
    <form className="panel" onSubmit={(event) => { event.preventDefault(); if (choice) onChoose(choice); }}>
      <label htmlFor={id}>Workout for this date only</label>
      <select id={id} value={choice} onChange={(event) => setChoice(event.target.value)} autoFocus>
        {workouts.map((workout) => (
          <option key={workout.id} value={workout.id}>{workout.name}{workout.id === current ? ' (now)' : ''}</option>
        ))}
      </select>
      <div className="form-actions">
        <button type="submit" disabled={busy || !choice || choice === current}>Save</button>
        <button type="button" className="ghost" onClick={onCancel}>Cancel</button>
      </div>
    </form>
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
