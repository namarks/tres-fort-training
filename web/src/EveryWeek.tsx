import { useId, useMemo, useState } from 'react';
import { MAX_SCHEDULE_EXTRAS, WEEKDAYS, type Weekday } from '../../src/types';
import { planWrites, type Reviewed } from './api';
import { formatScheduleTime, isRunOnlyWorkout, WEEKDAY_LABELS, type Workout } from './model';
import {
  choosableWorkouts,
  routineAddProblem,
  routineAddingWorkout,
  routineDay,
  routineDayProblem,
  routineExtra,
  routinePrimary,
  routineWithDay,
  type RoutineDayDraft,
  type RoutineSchedule,
} from './scheduling';
import type { Write } from './WorkoutEditor';
import './routine.css';

type RoutineReview = { schedule: RoutineSchedule; at: Reviewed };

/** What a workout is, in a few words, beside its name. */
export function workoutSummary(workout: Workout): string {
  if (isRunOnlyWorkout(workout)) return 'Run';
  const count = workout.exercises.length;
  if (count === 0) return 'Activity';
  return `${count} ${count === 1 ? 'exercise' : 'exercises'}`;
}

/**
 * The repeating week as the calendar's first row, in the same seven columns
 * as the dates it fills (owner, 2026-11-16: one calendar, with the week
 * pinned on top). Choosing a cell opens that weekday in the side panel.
 */
export function EveryWeekRow(props: {
  schedule: RoutineSchedule; workouts: Workout[]; selected: Weekday | null;
  onSelect: (day: Weekday) => void; disabled?: boolean;
  /** Says which weeks the row fills, e.g. while a block has its own weeks. */
  hint: string;
}) {
  const { schedule, selected, onSelect, disabled, hint } = props;
  const choosable = choosableWorkouts(props.workouts);
  return (
    <div role="row" className="grid-row every-week" aria-label="Every week">
      <div role="rowheader" className="week-head">
        <span className="kicker">Repeats</span>
        <strong>Every week</strong>
        <span className="every-hint">{hint}</span>
      </div>
      {WEEKDAYS.map((day) => {
        const draft = routineDay(schedule, day);
        const ids = [...(draft.primary ? [draft.primary] : []), ...draft.extras];
        return (
          <button key={day} type="button" role="gridcell" className={`day every ${selected === day ? 'selected' : ''}`}
            disabled={disabled} aria-pressed={selected === day} aria-label={`Edit ${WEEKDAY_LABELS[day]}`} onClick={() => onSelect(day)}>
            {ids.length === 0 && <span className="every-rest">Rest</span>}
            {ids.map((id, index) => (
              <span className="every-entry" key={`${id}-${index}`}>
                <strong>{choosable.find((workout) => workout.id === id)?.name ?? 'Unavailable workout'}</strong>
                {draft.times[id] ? <small>{formatScheduleTime(draft.times[id])}</small> : null}
              </span>
            ))}
            {ids.length === 0 && <span className="every-add" aria-hidden="true">+ Add</span>}
          </button>
        );
      })}
    </div>
  );
}

/**
 * One weekday of the repeating week, in the side panel: what is on it, each
 * workout's optional time, and a list to add from. Nothing is saved until
 * Save, and the save sends the whole reviewed week with the plan version.
 */
export function EveryWeekdayPanel(props: {
  day: Weekday; schedule: RoutineSchedule; workouts: Workout[]; reviewed: Reviewed;
  write: Write; busy: boolean; onClose: () => void; onNewWorkout: () => void;
  /** Which dates this weekday fills. */
  scope: string;
}) {
  const { day, write, busy, onClose } = props;
  const workouts = useMemo(() => choosableWorkouts(props.workouts), [props.workouts]);
  // The week as reviewed when this weekday was opened.
  const [review] = useState<RoutineReview>(() => ({ schedule: structuredClone(props.schedule), at: { ...props.reviewed } }));
  const [draft, setDraft] = useState<RoutineDayDraft>(() => routineDay(props.schedule, day));
  const [adding, setAdding] = useState(false);
  const [search, setSearch] = useState('');
  const ids = useId();
  const name = WEEKDAY_LABELS[day];
  const entries = [...(draft.primary ? [draft.primary] : []), ...draft.extras];
  const problem = routineDayProblem(draft, workouts);
  const dirty = JSON.stringify(routineDay(review.schedule, day)) !== JSON.stringify(draft);
  const full = !!draft.primary && draft.extras.length >= MAX_SCHEDULE_EXTRAS;
  const available = workouts.filter((workout) => !entries.includes(workout.id)
    && workout.name.toLowerCase().includes(search.trim().toLowerCase()));
  const groups: Array<[string, Workout[]]> = [
    ['Runs', available.filter(isRunOnlyWorkout)],
    ['Workouts', available.filter((workout) => !isRunOnlyWorkout(workout) && workout.exercises.length > 0)],
    ['Activities', available.filter((workout) => workout.exercises.length === 0)],
  ];
  const nameOf = (id: string) => workouts.find((workout) => workout.id === id)?.name ?? 'Unavailable workout';
  const add = (id: string) => {
    // The first workout on a day is its main one; the rest go alongside.
    setDraft(draft.primary || draft.extras.length ? { ...draft, extras: [...draft.extras, id] } : { ...draft, primary: id });
    setAdding(false); setSearch('');
  };
  const remove = (id: string) => setDraft(id === draft.primary ? routinePrimary(draft, null) : routineExtra(draft, draft.extras.indexOf(id), null));
  const makeMain = (id: string) => setDraft({
    ...draft, primary: id, extras: [...(draft.primary ? [draft.primary] : []), ...draft.extras.filter((entry) => entry !== id)],
  });
  const setTime = (id: string, time: string) => setDraft({ ...draft, times: { ...draft.times, [id]: time } });

  return (
    <form className="every-day" aria-label={`Edit ${name}`} onSubmit={async (event) => {
      event.preventDefault();
      if (busy) return;
      const result = routineWithDay(review.schedule, day, draft, workouts);
      if (result.ok && await write(() => planWrites.setRoutine(result.schedule, review.at))) onClose();
    }}>
      <p className="kicker">Every week</p>
      <h2 id="every-day-title">Every {name}</h2>
      <p className="muted">{props.scope}</p>
      {entries.length === 0 && <p className="every-day-rest">Rest. Add a workout to train on {name}s.</p>}
      <ul className="every-day-entries">
        {entries.map((id) => {
          const workout = workouts.find((entry) => entry.id === id);
          const main = id === draft.primary;
          return (
            <li key={id}>
              <div className="every-day-entry-head">
                <div>
                  <strong>{nameOf(id)}</strong>
                  <small className="muted">{[workout ? workoutSummary(workout) : null, entries.length > 1 ? (main ? 'Main' : 'Separate') : null].filter(Boolean).join(' · ')}</small>
                </div>
                <button type="button" className="ghost small" disabled={busy} aria-label={`Remove ${nameOf(id)} from ${name}`} onClick={() => remove(id)}>Remove</button>
              </div>
              <RoutineTime id={`${ids}-time-${id}`} name={nameOf(id)} value={draft.times[id] ?? ''} onChange={(time) => setTime(id, time)} />
              {!main && draft.primary && <button type="button" className="ghost small" disabled={busy}
                aria-label={`Make ${nameOf(id)} the main workout`} onClick={() => makeMain(id)}>Make main</button>}
            </li>
          );
        })}
      </ul>
      {!adding && (
        <button type="button" className="every-day-add" disabled={busy || full} onClick={() => setAdding(true)}>
          + Add a workout to {name}
        </button>
      )}
      {full && <p className="fine">A day holds a main workout and up to {MAX_SCHEDULE_EXTRAS} separate ones.</p>}
      {adding && (
        <section className="every-day-picker" aria-label={`Add a workout to ${name}`}>
          <label htmlFor={`${ids}-search`}>Add a workout to {name}</label>
          <input id={`${ids}-search`} type="search" placeholder="Search your workouts" value={search} autoFocus
            onChange={(event) => setSearch(event.target.value)} />
          {groups.filter(([, list]) => list.length > 0).map(([title, list]) => (
            <div key={title} className="every-day-group">
              <p className="kicker">{title}</p>
              <ul>
                {list.map((workout) => (
                  <li key={workout.id}>
                    <div><strong>{workout.name}</strong><small className="muted">{workoutSummary(workout)}</small></div>
                    <button type="button" className="ghost small" disabled={busy} aria-label={`Add ${workout.name} to ${name}`} onClick={() => add(workout.id)}>Add</button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
          {available.length === 0 && <p className="muted">{search.trim() ? 'No workout matches that search.' : 'Every saved workout is already on this day.'}</p>}
          <div className="head-actions">
            <button type="button" className="ghost small" onClick={props.onNewWorkout}>New workout</button>
            <button type="button" className="ghost small" onClick={() => { setAdding(false); setSearch(''); }}>Close list</button>
          </div>
        </section>
      )}
      {problem && <p className="problem" role="status">{problem}</p>}
      <div className="form-actions">
        <button type="submit" disabled={busy || !!problem || !dirty}>Save {name}</button>
        <button type="button" className="ghost" disabled={busy} onClick={onClose}>{dirty ? 'Cancel' : 'Close'}</button>
      </div>
      <p className="fine">Times are optional. On iPhone, reminders depend on your notification settings.</p>
    </form>
  );
}

function RoutineTime(props: { id: string; name: string; value: string; onChange: (value: string) => void }) {
  return <div className="routine-time">
    <label htmlFor={props.id}>Time for {props.name} · optional</label>
    <input id={props.id} type="time" value={props.value} onChange={(event) => props.onChange(event.target.value)} />
    {props.value && <button type="button" className="ghost small" aria-label={`Clear time for ${props.name}`} onClick={() => props.onChange('')}>Clear time</button>}
  </div>;
}

/** A workout sent from the Workouts tab: choose the weekdays it repeats on. */
export function AddWorkoutToWeek(props: {
  workout: Workout; workouts: Workout[]; schedule: RoutineSchedule; reviewed: Reviewed; write: Write; busy: boolean;
  onDone: () => void; onCancel: () => void;
}) {
  const { workout, write, busy, onDone, onCancel } = props;
  const workouts = useMemo(() => choosableWorkouts(props.workouts), [props.workouts]);
  const [review] = useState<RoutineReview>(() => ({ schedule: structuredClone(props.schedule), at: { ...props.reviewed } }));
  const [days, setDays] = useState<Weekday[]>([]);
  const [time, setTime] = useState('');
  const id = useId();
  const firstAvailableDay = WEEKDAYS.find((day) => !routineAddProblem(review.schedule, day, workout.id));
  const result = routineAddingWorkout(review.schedule, days, workout.id, time, workouts);
  return <form id="add-to-week" className="panel routine-form routine-add" aria-label={`Add ${workout.name} to your week`} onSubmit={async (event) => {
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
