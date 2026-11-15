import { Fragment, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { addDays, programWeekOn, weekdayOf } from '../../src/calendarProjection';
import { MAX_SCHEDULE_EXTRAS, WEEKDAYS, type TrainingProgram, type Weekday, type WeeklySchedule } from '../../src/types';
import type { StateActivity, StateResponse } from './api';
import { AwayDates, DateActions, RoutineEditor } from './CalendarEditing';
import { RouteMap } from './RouteMapView';
import { ActivityCharts } from './ActivityChartsView';
import { chartableActivities } from './activityCharts';
import { routableActivityIds } from './routeMap';
import {
  activityLoads,
  activitySports,
  calendarInputs,
  calendarStatusLabel,
  describeGroup,
  describeRunSteps,
  describeSlot,
  finishedRunOf,
  formatClock,
  formatLongDate,
  formatScheduleTime,
  itemLoad,
  itemTitle,
  itemType,
  LOAD_METHOD_LABELS,
  localToday,
  plannedExtraWorkouts,
  plannedWorkoutOn,
  prefersMiles,
  projectRange,
  scheduleTimeOn,
  slotBlocks,
  tripOn,
  WEEKDAY_LABELS,
  type CalendarCell,
  type ShownLoad,
  type Slot,
  type Workout,
} from './model';
import {
  addingWeek,
  copyingDown,
  liveWorkouts,
  MAX_PROGRAM_WEEKS,
  mondayOnOrBefore,
  relabeling,
  removingLastWeek,
  shortDate,
  workoutsInBlock,
} from './blocks';
import { BlockReview, BlockSettings, blockSummary, NewBlock, TargetsByWeek, useBlockEditor, type ActiveBlock } from './BlockEditor';
import { addingExtraIn, blockEndMonday, planRows, removingExtraIn, scopeDiffers, scopedWeeks, settingDayIn, type DayScope, type PlanRow } from './planWeeks';
import { PhoneHandoff } from './PhoneHandoff';
import { PlanNextSteps } from './PlanNextSteps';
import { DateWorkoutEdit } from './DateWorkoutEdit';
import type { DateWorkoutSelection } from './dateEditState';
import type { Write } from './WorkoutEditor';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function scrollToId(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function routineIsEmpty(schedule: WeeklySchedule): boolean {
  return WEEKDAYS.every((day) => !schedule.week[day] && !(schedule.extras?.[day]?.length));
}

/**
 * The Plan page: one calendar of weeks. Each row is a week; a block's weeks
 * are labeled and edited right where they show, and the usual week fills the
 * rest. The chosen date's panel changes that date, the block's weekday, or
 * the usual weekday.
 */
export function PlanPage({ state, write, busy, onEditWorkout, scheduleWorkoutId, onScheduled, accountId, reload, onSignedOut, startBlock }: {
  state: StateResponse;
  write: Write;
  busy: boolean;
  onEditWorkout: (id: string | null) => void;
  scheduleWorkoutId?: string | null;
  onScheduled?: () => void;
  accountId?: string;
  reload?: () => Promise<void>;
  onSignedOut?: (error?: unknown) => void;
  /** Open with the form that starts a block. */
  startBlock?: boolean;
}) {
  const today = useMemo(() => localToday(), []);
  const thisMonday = mondayOnOrBefore(today);
  const [selected, setSelected] = useState(today);
  const [earlier, setEarlier] = useState(0);
  const [later, setLater] = useState(0);
  const [starting, setStarting] = useState(!!startBlock);
  const [routineRequest, setRoutineRequest] = useState<{ day: Weekday; key: number } | null>(null);
  const [editSelection, setEditSelection] = useState<DateWorkoutSelection | null>(null);
  const [editBlocked, setEditBlocked] = useState(false);
  useEffect(() => { if (startBlock) setStarting(true); }, [startBlock]);
  const miles = useMemo(() => prefersMiles(), []);
  const plan = state.plan;
  const block = useBlockEditor({ state, write, busy, today, accountId: accountId ?? 'none' });
  const active = block.kind === 'block' ? block : null;
  // The calendar shows the block as it is being edited, saved or not.
  const draftText = active ? JSON.stringify(active.draft) : null;
  const programId = active?.programId ?? null;
  const program = useMemo<TrainingProgram | null>(
    () => (draftText && programId ? { ...JSON.parse(draftText), id: programId } : null), [draftText, programId]);
  const savedInputs = useMemo(() => calendarInputs(state), [state]);
  const inputs = useMemo(
    () => (savedInputs && block.kind !== 'unreadable' ? { ...savedInputs, program } : savedInputs),
    [savedInputs, program, block.kind]);
  const rows = useMemo(() => planRows(program, today, earlier, later), [program, today, earlier, later]);
  const first = rows[0]?.monday ?? thisMonday;
  const last = addDays(rows[rows.length - 1]?.monday ?? thisMonday, 6);
  const cells = useMemo(() => (inputs ? projectRange(inputs, first, last, today) : new Map<string, CalendarCell>()),
    [inputs, first, last, today]);
  const cellFor = useCallback(
    (date: string) => cells.get(date) ?? (inputs ? projectRange(inputs, date, date, today).get(date) : undefined),
    [cells, inputs, today],
  );
  const selectedCell = useMemo(() => cellFor(selected), [cellFor, selected]);
  // A date-only copy is made from the saved block's targets, so it waits
  // until unsaved block changes are saved or discarded.
  const blockDirty = !!active?.dirty;
  useEffect(() => { if (blockDirty) setEditSelection(null); else setEditBlocked(false); }, [blockDirty]);
  useEffect(() => setEditBlocked(false), [selected]);
  const workouts = useMemo(() => new Map((plan?.workouts ?? []).map((w) => [w.id, w])), [plan]);
  const live = useMemo(() => liveWorkouts(plan?.workouts ?? []), [plan]);
  const loads = useMemo(() => activityLoads(state), [state]);
  const sports = useMemo(() => activitySports(state), [state]);
  const routable = useMemo(() => routableActivityIds(state), [state]);
  const chartable = useMemo(() => chartableActivities(state), [state]);
  useEffect(() => {
    if (scheduleWorkoutId) document.getElementById('routine-title')?.scrollIntoView({ block: 'start' });
  }, [scheduleWorkoutId]);
  const dateEditPanel = accountId && reload && onSignedOut ? <DateWorkoutEdit key={accountId} selection={editSelection} state={state}
    accountId={accountId} today={today} busy={busy} reload={reload} onSignedOut={onSignedOut}
    onEdit={onEditWorkout} onClose={() => setEditSelection(null)} /> : null;

  if (!plan) {
    return (
      <main className="centered">
        <h1>Plan your week</h1>
        {dateEditPanel}
        <p className="muted">Create a run, a timed routine or your own workout, then choose its days and times. You can put core alongside a run and complete each separately in the iPhone app.</p>
        <button type="button" onClick={() => onEditWorkout(null)}>Create your first workout</button>
      </main>
    );
  }

  const hasWorkouts = live.size > 0;
  const showStart = !active && !starting && routineIsEmpty(plan.schedule);
  const lastIndex = active ? active.draft.weeks.length - 1 : -1;
  const endRow = active ? rows.findIndex((row) => row.week === lastIndex) : -1;
  const editUsualDay = (day: Weekday) => {
    setRoutineRequest({ day, key: Date.now() });
    scrollToId('routine-title');
  };
  const selectedWeek = programWeekOn(program, selected);

  return (
    <main className="planner plan-page">
      <section className="calendar" aria-labelledby="plan-title">
        <div className="plan-head">
          <div>
            <h1 id="plan-title">{active ? (active.draft.name?.trim() || 'Your block') : 'Your plan'}</h1>
            <p className="muted">
              {active ? blockSummary(active.draft, active.thisWeek)
                : 'Your usual week repeats. Plan week by week when weeks should differ.'}
            </p>
          </div>
          <div className="block-actions">
            {active ? (
              <>
                <button type="button" className="primary" disabled={!active.canSave} onClick={active.save}>Save changes</button>
                <button type="button" className="ghost" disabled={!active.dirty || busy} onClick={active.discard}>Discard</button>
                <button type="button" className="ghost" onClick={() => scrollToId('block-targets-title')}>Targets by week</button>
                <button type="button" className="ghost danger" disabled={busy || !!active.problem} onClick={active.end}>End block</button>
              </>
            ) : (
              <>
                {hasWorkouts && !starting && <button type="button" className="ghost" onClick={() => setStarting(true)}>Plan week by week</button>}
                <a className="ghost" href="#analysis/event">Build up to an event</a>
              </>
            )}
          </div>
        </div>

        {block.kind === 'unreadable' && (
          <div className="panel" role="alert">
            <p>This browser's saved block draft could not be read. No change has been sent.</p>
            <button type="button" onClick={block.clear}>Discard unreadable draft</button>
          </div>
        )}
        {showStart && <PlanStart hasWorkouts={hasWorkouts} onUsualWeek={() => scrollToId('routine-title')}
          onBlock={() => setStarting(true)} onCreate={() => onEditWorkout(null)} />}
        {starting && !active && (hasWorkouts
          ? <NewBlock state={state} workouts={plan.workouts} write={write} busy={busy} today={today} onCancel={() => setStarting(false)} />
          : <div className="panel"><p>A block is made of your workouts. Create one first.</p>
            <button type="button" onClick={() => onEditWorkout(null)}>Create a workout</button></div>)}
        {active && <BlockReview block={active} busy={busy} />}
        {active && <BlockSettings block={active} today={today} />}

        <div className="plan-more">
          <button type="button" className="ghost small" onClick={() => setEarlier((n) => n + 4)}>Show earlier weeks</button>
        </div>
        <div className="grid weeks" role="grid" aria-labelledby="plan-title">
          <div className="grid-row weekdays" role="row">
            <div role="columnheader" className="week-col">Week</div>
            {WEEKDAYS.map((day) => <div key={day} role="columnheader">{WEEKDAY_LABELS[day].slice(0, 3)}</div>)}
          </div>
          {rows.map((row, index) => (
            <Fragment key={row.monday}>
              <div role="row" className={['grid-row', 'week-row', row.week != null ? 'in-block' : '',
                row.monday === thisMonday ? 'current' : ''].filter(Boolean).join(' ')}>
                <WeekHeader row={row} block={active} thisMonday={thisMonday} today={today} />
                {WEEKDAYS.map((day, d) => {
                  const date = addDays(row.monday, d);
                  return (
                    <DayCell
                      key={date}
                      date={date}
                      cell={cells.get(date)}
                      workout={workoutFor(cells.get(date), workouts)}
                      workouts={workouts}
                      schedule={plan.schedule}
                      activities={state.external_activities}
                      monthLabel={index === 0 && d === 0}
                      isToday={date === today}
                      isSelected={date === selected}
                      sports={sports}
                      onSelect={() => setSelected(date)}
                    />
                  );
                })}
              </div>
              {active && index === endRow && (
                <div role="row" className="grid-row block-end">
                  <div role="gridcell">
                    <button type="button" className="ghost small" disabled={busy || active.draft.weeks.length >= MAX_PROGRAM_WEEKS}
                      onClick={() => { const next = addingWeek(active.draft); if (next) active.setDraft(next); }}>Add a week</button>
                    <button type="button" className="ghost small" disabled={busy || active.draft.weeks.length <= 1}
                      onClick={() => { const next = removingLastWeek(active.draft); if (next) active.setDraft(next); }}>Remove the last week</button>
                    <span className="muted">
                      {active.draft.repeat
                        ? 'Then the block starts over at week 1.'
                        : `The block ends ${shortDate(addDays(blockEndMonday(active.draft, today), -1))}. After it, your usual week repeats.`}
                    </span>
                  </div>
                </div>
              )}
            </Fragment>
          ))}
        </div>
        <div className="plan-more">
          <button type="button" className="ghost small" onClick={() => setLater((n) => n + 4)}>Show later weeks</button>
          <p className="muted fine">Dashed: planned. Filled: done or started. Choose any day to change it.</p>
        </div>

        {active && (
          <TargetsByWeek draft={active.draft} workouts={workoutsInBlock(active.draft, plan.workouts)} onChange={active.setDraft}
            inputs={active.inputs} onInput={active.editInput} onReset={active.resetInputs} />
        )}
        <RoutineEditor schedule={plan.schedule} workouts={plan.workouts} write={write} busy={busy}
          reviewed={{ planId: plan.id, version: plan.version }} selectedWorkoutId={scheduleWorkoutId}
          onScheduled={onScheduled} onCancelSelection={onScheduled} openDayRequest={routineRequest}
          hint={active ? 'Your usual week fills every week outside your block.' : undefined} />
        <button type="button" className="ghost" disabled={busy} onClick={() => onEditWorkout(null)}>Create another workout</button>
        <PhoneHandoff state={state} today={today} />
        <PlanNextSteps state={state} />
        <AwayDates trips={plan.trips ?? []} today={today} version={plan.version} write={write} busy={busy} />
        {active?.dirty && (
          <div className="block-savebar" role="status">
            <span>Unsaved changes to your block.</span>
            <button type="button" className="primary" disabled={!active.canSave} onClick={active.save}>Save changes</button>
          </div>
        )}
      </section>

      <DayDetail
        date={selected}
        cell={selectedCell}
        workout={workoutFor(selectedCell, workouts)}
        workouts={workouts}
        schedule={plan.schedule}
        program={program}
        trip={tripOn(selected, plan.trips ?? [])}
        miles={miles}
        loads={loads}
        sports={sports}
        routable={routable}
        chartable={chartable}
        onEditWorkout={onEditWorkout}
        onEditDateWorkout={accountId ? (workoutId, primary) => {
          if (blockDirty) setEditBlocked(true);
          else setEditSelection({ date: selected, workoutId, primary });
        } : undefined}
        editPanel={editBlocked && blockDirty ? (
          <div className="panel" role="status">
            <p>Save or discard your block changes first, so this date’s workout starts from the targets you see.</p>
            <button type="button" className="ghost small" onClick={() => setEditBlocked(false)}>OK</button>
          </div>
        ) : dateEditPanel}
        actions={(
          <>
            <DateActions date={selected} today={today} cell={selectedCell} workout={workoutFor(selectedCell, workouts)}
              state={state} cellFor={cellFor} write={write} busy={busy} />
            {active && selectedWeek != null
              ? <BlockDayEditor key={`${selected}`} block={active} date={selected} index={selectedWeek} live={live} busy={busy} />
              : <UsualDay date={selected} schedule={plan.schedule} workouts={workouts} busy={busy} onEdit={editUsualDay} />}
          </>
        )}
      />
    </main>
  );
}

/** The first choice for a plan with nothing on its weekdays yet. */
function PlanStart({ hasWorkouts, onUsualWeek, onBlock, onCreate }: {
  hasWorkouts: boolean;
  onUsualWeek: () => void;
  onBlock: () => void;
  onCreate: () => void;
}) {
  return (
    <section className="plan-start" aria-labelledby="plan-start-title">
      <h2 id="plan-start-title">Make your plan</h2>
      <p className="muted">Pick how you want to start. You can change any day afterwards, and add runs, lifts and other activities to any week.</p>
      <div className="plan-start-cards">
        <article className="panel">
          <p className="kicker">Most people start here</p>
          <h3>The same week, every week</h3>
          <p className="muted">Put your workouts on weekdays once: lifting Monday and Friday, a run Tuesday and Saturday, soccer Wednesday.</p>
          {hasWorkouts
            ? <button type="button" className="primary" onClick={onUsualWeek}>Set up my week</button>
            : <button type="button" className="primary" onClick={onCreate}>Create a workout</button>}
        </article>
        <article className="panel">
          <p className="kicker">Have a date in mind</p>
          <h3>Build up to an event</h3>
          <p className="muted">A race, a trip or a season. Set its date here, then the iPhone app lays out your runs week by week up to it. Those weeks show on this page to change.</p>
          <a className="ghost" href="#analysis/event">Set my event</a>
        </article>
        <article className="panel">
          <p className="kicker">Want full control</p>
          <h3>Plan week by week</h3>
          <p className="muted">Start from your usual week and change any week: more volume, an easier week, a different mix. Good for custom swim, run and lift blocks.</p>
          {hasWorkouts
            ? <button type="button" className="ghost" onClick={onBlock}>Start my block</button>
            : <p className="fine muted">Create a workout first.</p>}
        </article>
      </div>
    </section>
  );
}

/** A week row's heading: the block week with its label and copy tools, or
 * the usual week. */
function WeekHeader({ row, block, thisMonday, today }: { row: PlanRow; block: ActiveBlock | null; thisMonday: string; today: string }) {
  if (block && row.week != null) {
    const index = row.week;
    const draft = block.draft;
    const week = draft.weeks[index]!;
    return (
      <div role="rowheader" className="week-head">
        {week.label?.trim() ? <span className="kicker">Week {index + 1}</span> : null}
        <strong>{week.label?.trim() || `Week ${index + 1}`}</strong>
        <span className="muted">{shortDate(row.monday).slice(5)}</span>
        <details className="week-menu">
          <summary>Edit week</summary>
          <div className="week-menu-body">
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
      </div>
    );
  }
  const outside = block ? (row.monday < block.draft.start ? 'Before the block' : row.monday >= blockEndMonday(block.draft, today) ? 'After the block' : null) : null;
  return (
    <div role="rowheader" className="week-head usual">
      {outside || row.monday === thisMonday ? <span className="kicker">{outside ?? 'This week'}</span> : null}
      <strong>{block ? 'Your usual week' : `Week of ${shortDate(row.monday).slice(5)}`}</strong>
      {block && <span className="muted">{shortDate(row.monday).slice(5)}</span>}
    </div>
  );
}

const SCOPES: { scope: DayScope; label: (day: string, week: number, weeks: number) => string }[] = [
  { scope: 'week', label: (_day, week) => `Week ${week} only` },
  { scope: 'block', label: (day) => `Every ${day} in the block` },
  { scope: 'later', label: (_day, week, weeks) => week === weeks ? `Week ${week} only` : `Weeks ${week} to ${weeks}` },
];

/** Change the chosen weekday in the block: this week, every week, or from
 * this week on. Edits join the block's unsaved changes. */
function BlockDayEditor({ block, date, index, live, busy }: {
  block: ActiveBlock;
  date: string;
  index: number;
  live: Map<string, Workout>;
  busy: boolean;
}) {
  const [scope, setScope] = useState<DayScope | null>(null);
  const day = weekdayOf(date) as Weekday;
  const name = WEEKDAY_LABELS[day];
  const draft = block.draft;
  const options = SCOPES.filter((option) => option.scope !== 'later' || (index > 0 && index < draft.weeks.length - 1));
  if (!scope) {
    return (
      <section className="block-day panel" aria-labelledby="block-day-title">
        <h3 id="block-day-title">Change {name} in your block</h3>
        <div className="scope-choices">
          {options.map((option) => (
            <button key={option.scope} type="button" className="ghost small" disabled={busy} onClick={() => setScope(option.scope)}>
              {option.label(name, index + 1, draft.weeks.length)}
            </button>
          ))}
        </div>
        <p className="fine muted">For this date only, use the date’s options above.</p>
      </section>
    );
  }
  const week = draft.weeks[index]!;
  const main = week.week[day] ?? null;
  const extras = week.extras?.[day] ?? [];
  const weeks = scopedWeeks(draft, index, scope);
  const differs = weeks.length > 1 && scopeDiffers(draft, weeks, day);
  const choosable = [...live.values()];
  const addable = choosable.filter((w) => w.id !== main && !extras.includes(w.id));
  const label = `${name}, week ${index + 1}`;
  return (
    <section className="block-day panel" aria-labelledby="block-day-title">
      <h3 id="block-day-title">Change {name} in your block</h3>
      <fieldset className="scope" disabled={busy}>
        <legend>Apply to</legend>
        {options.map((option) => (
          <label key={option.scope} className="check">
            <input type="radio" name="block-day-scope" value={option.scope} checked={scope === option.scope}
              onChange={() => setScope(option.scope)} />
            {option.label(name, index + 1, draft.weeks.length)}
          </label>
        ))}
      </fieldset>
      <label htmlFor="block-day-main">Main workout</label>
      <select id="block-day-main" aria-label={`${label}: workout`} value={main ?? ''} disabled={busy}
        onChange={(e) => block.setDraft(settingDayIn(draft, weeks, day, e.target.value || null))}>
        <option value="">Rest</option>
        {main && !live.has(main) && <option value={main}>(archived workout)</option>}
        {choosable.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
      </select>
      {extras.length > 0 && (
        <ul className="block-extras">
          {extras.map((id) => (
            <li key={id} className="chip lift">
              <span>{live.get(id)?.name ?? 'Archived workout'}</span>
              <button type="button" className="icon" disabled={busy} aria-label={`Remove ${live.get(id)?.name ?? 'workout'} from ${label}`}
                onClick={() => block.setDraft(removingExtraIn(draft, weeks, day, id))}>×</button>
            </li>
          ))}
        </ul>
      )}
      {main && extras.length < MAX_SCHEDULE_EXTRAS && addable.length > 0 && (
        <select aria-label={`${label}: add another`} className="block-add" value="" disabled={busy}
          onChange={(e) => {
            const next = e.target.value ? addingExtraIn(draft, weeks, day, e.target.value) : null;
            if (next) block.setDraft(next);
          }}>
          <option value="">+ Also on {name}</option>
          {addable.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
        </select>
      )}
      {differs && <p className="fine">These weeks differ on {name} now. Shown here is week {index + 1}. A change here goes to each of them, and the rest of each week’s {name} stays as it is.</p>}
      <p className="fine muted">Block changes stay on this page until you save them.</p>
      <button type="button" className="ghost small" onClick={() => setScope(null)}>Done</button>
    </section>
  );
}

/** The usual week's plan for the chosen weekday, with a way to change it. */
function UsualDay({ date, schedule, workouts, busy, onEdit }: {
  date: string;
  schedule: WeeklySchedule;
  workouts: Map<string, Workout>;
  busy: boolean;
  onEdit: (day: Weekday) => void;
}) {
  const day = weekdayOf(date) as Weekday;
  const name = WEEKDAY_LABELS[day];
  const ids = [schedule.week[day], ...(schedule.extras?.[day] ?? [])].filter((id): id is string => !!id);
  return (
    <section className="block-day panel" aria-labelledby="usual-day-title">
      <h3 id="usual-day-title">Every {name}</h3>
      <p className="muted">{ids.length ? ids.map((id) => workouts.get(id)?.name ?? 'Unavailable workout').join(', ') : 'Rest'} in your usual week.</p>
      <button type="button" className="ghost small" disabled={busy} onClick={() => onEdit(day)}>Change every {name}</button>
    </section>
  );
}

function workoutFor(cell: CalendarCell | undefined, workouts: Map<string, Workout>): Workout | undefined {
  return cell?.workout_id ? workouts.get(cell.workout_id) : undefined;
}

/** A recurring reminder is planning information, never a historical start time. */
function plannedReminderTime(schedule: WeeklySchedule, workoutId: string | null, date: string,
  status: string | undefined): string | null {
  return workoutId && (status === 'projected' || status === 'planned')
    ? scheduleTimeOn(schedule, workoutId, date) : null;
}

function DayCell(props: {
  date: string;
  cell: CalendarCell | undefined;
  workout: Workout | undefined;
  workouts: Map<string, Workout>;
  schedule: WeeklySchedule;
  /** Name the month beside the day number. */
  monthLabel: boolean;
  isToday: boolean;
  isSelected: boolean;
  activities: StateActivity[];
  sports: Map<string, string>;
  onSelect: () => void;
}) {
  const { date, cell, workout, workouts, schedule, monthLabel, isToday, isSelected, activities, sports, onSelect } = props;
  const status = cell?.status;
  const dayOfMonth = Number(date.slice(8));
  // A finished run workout is its run: show the run once, not both under one name.
  const showWorkout = workout !== undefined && status !== 'rest' && !finishedRunOf(cell, workout, activities);
  const classes = ['day', isToday ? 'today' : '', isSelected ? 'selected' : '', status ? `status-${status}` : '']
    .filter(Boolean).join(' ');
  const additional = cell?.sessions ?? [];
  const extras = plannedExtraWorkouts(cell, workouts);
  const nameAt = (name: string, id: string | null, workoutStatus: string | undefined) => {
    const time = plannedReminderTime(schedule, id, date, workoutStatus);
    return time ? `${name} · ${formatScheduleTime(time)}` : name;
  };
  const additionalNames = additional.map((session) =>
    `${nameAt(session.kind === 'freestyle' ? 'Freestyle' : workouts.get(session.workout_id ?? '')?.name ?? 'Workout', session.workout_id, session.status)}, ${session.status.replaceAll('_', ' ')}`);
  const label = [formatLongDate(date), calendarStatusLabel(cell),
    ...(workout ? [nameAt(workout.name, workout.id, status)] : []), ...additionalNames,
    ...extras.map((extra) => `${nameAt(extra.name, extra.id, 'projected')}, planned`)].join(', ');
  return (
    <button type="button" role="gridcell" className={classes} onClick={onSelect} aria-label={label} aria-pressed={isSelected}>
      <span className="day-number">{monthLabel || dayOfMonth === 1 ? `${MONTHS[Number(date.slice(5, 7)) - 1]} ${dayOfMonth}` : dayOfMonth}</span>
      {status === 'unavailable' || status === 'light' ? <span className="chip away">Away</span> : null}
      {workout && showWorkout ? <span className={`chip lift ${status ?? ''}`}>{nameAt(workout.name, workout.id, status)}</span> : null}
      {additional.map((session) => (
        <span key={session.id} className={`chip lift ${session.status}`}>
          {nameAt(session.kind === 'freestyle' ? 'Freestyle' : workouts.get(session.workout_id ?? '')?.name ?? 'Workout', session.workout_id, session.status)}
        </span>
      ))}
      {extras.map((extra) => (
        <span key={`planned:${extra.id}`} className="chip lift projected">{nameAt(extra.name, extra.id, 'projected')}</span>
      ))}
      {cell?.items.map((item) => (
        <span key={item.id} className={`chip endurance ${item.completed ? 'completed' : ''}`}>
          {itemTitle(item, sports)}
        </span>
      ))}
    </button>
  );
}

function DayDetail(props: {
  date: string;
  cell: CalendarCell | undefined;
  workout: Workout | undefined;
  workouts: Map<string, Workout>;
  schedule: WeeklySchedule;
  program: TrainingProgram | null | undefined;
  trip: ReturnType<typeof tripOn>;
  miles: boolean;
  loads: Map<string, ShownLoad | null>;
  sports: Map<string, string>;
  /** Completed activities that may have a route. */
  routable: Set<string>;
  chartable: Map<string, string>;
  onEditWorkout: (id: string) => void;
  onEditDateWorkout?: (id: string, primary: boolean) => void;
  editPanel?: ReactNode;
  actions: ReactNode;
}) {
  const { date, cell, workout, workouts, schedule, program, trip, miles, loads, sports, routable, chartable, onEditWorkout, onEditDateWorkout, editPanel, actions } = props;
  const extras = plannedExtraWorkouts(cell, workouts);
  return (
    <aside className="detail" aria-labelledby="detail-title">
      <h2 id="detail-title">{formatLongDate(date)}</h2>
      <p className="status-line">{calendarStatusLabel(cell)}</p>
      {editPanel}
      {actions}
      {trip && (
        <div className="note">
          <strong>Away</strong> {trip.start} to {trip.end}
          {trip.can_train_light ? ', light training possible' : ''}
          {trip.note ? <p className="muted">{trip.note}</p> : null}
        </div>
      )}
      {workout && cell?.status !== 'rest' && cell?.status !== 'unavailable' && (
        <CalendarWorkoutDetails workout={plannedWorkoutOn(workout, program, date, cell?.status ?? '')}
          time={plannedReminderTime(schedule, workout.id, date, cell?.status)} miles={miles}
          onEditWorkout={id => onEditDateWorkout ? onEditDateWorkout(id, true) : onEditWorkout(id)} />
      )}
      {cell?.sessions?.map((session) => {
        const additional = session.kind === 'freestyle' ? undefined : workouts.get(session.workout_id ?? '');
        const status = `Workout ${(session.slot ?? 0) + 1} · ${session.status.replaceAll('_', ' ')}`;
        return additional ? (
          <CalendarWorkoutDetails key={session.id} workout={plannedWorkoutOn(additional, program, date, session.status)}
            status={status} time={plannedReminderTime(schedule, additional.id, date, session.status)} miles={miles}
            onEditWorkout={id => onEditDateWorkout ? onEditDateWorkout(id, false) : onEditWorkout(id)} />
        ) : (
          <section key={session.id}>
            <h3>{session.kind === 'freestyle' ? 'Freestyle' : 'Workout'}</h3>
            <p className="muted">{status}</p>
          </section>
        );
      })}
      {extras.map((extra) => (
        <CalendarWorkoutDetails key={`planned:${extra.id}`} workout={plannedWorkoutOn(extra, program, date, 'projected')}
          status="Planned" time={scheduleTimeOn(schedule, extra.id, date)} miles={miles}
          onEditWorkout={id => onEditDateWorkout ? onEditDateWorkout(id, false) : onEditWorkout(id)} />
      ))}
      {cell?.items.length ? (
        <section>
          <h3>Endurance</h3>
          <ul className="slots">
            {cell.items.map((item) => {
              const load = itemLoad(item, loads);
              const method = load?.method ? LOAD_METHOD_LABELS[load.method] : undefined;
              const title = itemTitle(item, sports);
              return (
                <li key={item.id}>
                  <div className="slot-name">{title}</div>
                  <div className="muted">
                    {itemType(item, sports)} · {item.completed ? 'Done' : 'Planned'}
                    {item.planned_duration_sec ? ` · ${formatClock(item.planned_duration_sec)}` : ''}
                    {load ? ` · load ${Math.round(load.load)}${method ? ` (${method})` : ''}` : ''}
                  </div>
                  {item.completed && routable.has(item.id) ? <RouteMap activityId={item.id} label={`Route of ${title}`} miles={miles} /> : null}
                  {item.completed && chartable.has(item.id)
                    ? <ActivityCharts activityId={item.id} kind={chartable.get(item.id)!} miles={miles} />
                    : null}
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}
      {!workout && !extras.length && !cell?.sessions?.length && !cell?.items.length && !trip ? <p className="muted">A rest day.</p> : null}
    </aside>
  );
}

function CalendarWorkoutDetails({ workout, time, status, miles, onEditWorkout }: {
  workout: Workout;
  time: string | null;
  status?: string;
  miles: boolean;
  onEditWorkout: (id: string) => void;
}) {
  return (
    <section aria-label={workout.name}>
      <div className="section-head">
        <h3>{workout.name}</h3>
        <button type="button" className="ghost small" aria-label={`Edit ${workout.name}`}
          onClick={() => onEditWorkout(workout.id)}>Edit workout</button>
      </div>
      {time || status ? <p className="muted">{time ? <time dateTime={time}>{formatScheduleTime(time)}</time> : null}{time && status ? ' · ' : ''}{status}</p> : null}
      {workout.notes ? <p className="muted">{workout.notes}</p> : null}
      <ol className="slots">
        {slotBlocks(workout).map((block) => block.group ? (
          <li key={block.members[0]!.id} className="group-block">
            <div className="group-head">
              <strong>{block.group.title}</strong>
              <span className="muted">{describeGroup(block.group)}</span>
            </div>
            <ol className="slots">
              {block.members.map((slot) => <SlotItem key={slot.id} slot={slot} miles={miles} />)}
            </ol>
          </li>
        ) : (
          <SlotItem key={block.members[0]!.id} slot={block.members[0]!} miles={miles} />
        ))}
      </ol>
    </section>
  );
}

function SlotItem({ slot, miles }: { slot: Slot; miles: boolean }) {
  const steps = describeRunSteps(slot.run_steps, miles);
  return (
    <li className={slot.is_warmup ? 'warmup' : ''}>
      <div className="slot-name">
        {slot.group_label ? <span className="group">{slot.group_label}</span> : null}
        {slot.exercise_name}
        {slot.is_warmup ? <span className="tag">Warm-up</span> : null}
      </div>
      {steps.length ? (
        <ul className="steps">{steps.map((line, i) => <li key={i}>{line}</li>)}</ul>
      ) : (
        <div className="muted">{describeSlot(slot)}</div>
      )}
    </li>
  );
}
