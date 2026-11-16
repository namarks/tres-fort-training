import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { addDays, programWeekOn, weekdayOf } from '../../src/calendarProjection';
import { isLayered, splitBlockDay, standingOn } from '../../src/programLayers';
import { WEEKDAYS, type TrainingProgram, type Weekday, type WeeklySchedule } from '../../src/types';
import type { StateActivity, StateResponse } from './api';
import { AwayDates, DateActions } from './CalendarEditing';
import { splitTrips } from './scheduling';
import { AddWorkoutToWeek, EveryWeekRow, EveryWeekdayPanel } from './EveryWeek';
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
import { liveWorkouts, mondayOnOrBefore, shortDate } from './blocks';
import { ownForm, weekHeadline } from './blockLayers';
import { planBlocks } from './event';
import { blockEndMonday, MAX_PLAN_ROWS, planRows, type PlanRow } from './planWeeks';
import { DateWorkoutEdit } from './DateWorkoutEdit';
import type { DateWorkoutSelection } from './dateEditState';
import type { Write } from './WorkoutEditor';
import { prefersReducedMotion } from './mapkit';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Weeks added each time the list reaches its top or bottom. */
const WEEKS_PER_LOAD = 4;

/** Scrolls the week box so last week sits under the pinned rows (the
 * weekday names and the repeating week). False
 * when the box can't scroll that far yet (too few weeks below). */
function placeLastWeek(box: HTMLElement, thisMonday: string, smooth: boolean): boolean {
  const lastWeek = box.querySelector<HTMLElement>(`[data-monday="${addDays(thisMonday, -7)}"]`)
    ?? box.querySelector<HTMLElement>(`[data-monday="${thisMonday}"]`);
  const header = box.querySelector<HTMLElement>('.weeks-top') ?? box.querySelector<HTMLElement>('.weekdays');
  const top = Math.max(0, lastWeek
    ? box.scrollTop + lastWeek.getBoundingClientRect().top - box.getBoundingClientRect().top - box.clientTop - (header?.offsetHeight ?? 0)
    : 0);
  if (typeof box.scrollTo === 'function') box.scrollTo({ top, behavior: smooth ? 'smooth' : 'auto' });
  else box.scrollTop = top;
  return top <= box.scrollHeight - box.clientHeight + 1;
}

/**
 * The week list scrolls inside its own box (owner, 2026-11-16: earlier weeks
 * took over the page and couldn't be put away). Reaching the top or bottom
 * adds four weeks there, keeping the weeks in view where they were, and
 * "This week" goes back to the starting weeks with last week at the top.
 */
function useWeekScroller(firstMonday: string, rowCount: number, thisMonday: string,
  setEarlier: (update: (n: number) => number) => void, setLater: (update: (n: number) => number) => void) {
  const boxRef = useRef<HTMLDivElement | null>(null);
  const topRef = useRef<HTMLDivElement | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  // The week at the top of the box, and where it sat, just before earlier
  // weeks were added above it.
  const anchor = useRef<{ monday: string; offset: number } | null>(null);
  // Last week couldn't reach the top yet; place it again as weeks load.
  const unplaced = useRef(false);
  const [jump, setJump] = useState<{ key: number; smooth: boolean }>({ key: 0, smooth: false });
  const [ready, setReady] = useState(false);
  const canAdd = rowCount + WEEKS_PER_LOAD <= MAX_PLAN_ROWS;

  const loadEarlier = useCallback(() => {
    if (!canAdd) return;
    const box = boxRef.current;
    if (box) {
      const boxTop = box.getBoundingClientRect().top;
      const row = [...box.querySelectorAll<HTMLElement>('[data-monday]')].find((el) => el.getBoundingClientRect().bottom > boxTop);
      anchor.current = row ? { monday: row.dataset.monday!, offset: row.getBoundingClientRect().top - boxTop } : null;
    }
    setEarlier((n) => n + WEEKS_PER_LOAD);
  }, [canAdd, setEarlier]);
  const loadLater = useCallback(() => {
    if (canAdd) setLater((n) => n + WEEKS_PER_LOAD);
  }, [canAdd, setLater]);
  const toThisWeek = useCallback(() => {
    setReady(false);
    setEarlier(() => 0);
    setLater(() => 0);
    setJump((current) => ({ key: current.key + 1, smooth: !prefersReducedMotion() }));
  }, [setEarlier, setLater]);

  // Weeks added: keep the weeks in view where they were.
  useLayoutEffect(() => {
    const box = boxRef.current;
    const kept = anchor.current;
    anchor.current = null;
    if (box && unplaced.current) { unplaced.current = !placeLastWeek(box, thisMonday, false); return; }
    const row = kept && box?.querySelector<HTMLElement>(`[data-monday="${kept.monday}"]`);
    if (box && kept && row) box.scrollTop += row.getBoundingClientRect().top - box.getBoundingClientRect().top - kept.offset;
  }, [firstMonday, rowCount, thisMonday]);

  // On opening and on "This week": last week at the top, under the weekday names.
  useLayoutEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    unplaced.current = !placeLastWeek(box, thisMonday, jump.smooth);
    // Weeks load at the ends only once a smooth scroll has settled.
    if (!jump.smooth) { setReady(true); return; }
    const timer = window.setTimeout(() => setReady(true), 700);
    return () => window.clearTimeout(timer);
  }, [jump, thisMonday]);

  // Add weeks when the top or bottom of the list comes into view, once the
  // list has been placed.
  useEffect(() => {
    const box = boxRef.current;
    if (!ready || !box || typeof IntersectionObserver !== 'function') return;
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        if (entry.target === topRef.current) loadEarlier();
        if (entry.target === bottomRef.current) loadLater();
      }
    }, { root: box, rootMargin: '120px 0px' });
    if (topRef.current) observer.observe(topRef.current);
    if (bottomRef.current) observer.observe(bottomRef.current);
    return () => observer.disconnect();
  }, [ready, loadEarlier, loadLater, firstMonday, rowCount]);

  return { boxRef, topRef, bottomRef, loadEarlier, loadLater, toThisWeek, canAdd };
}

function routineIsEmpty(schedule: WeeklySchedule): boolean {
  return WEEKDAYS.every((day) => !schedule.week[day] && !(schedule.extras?.[day]?.length));
}

/**
 * The Schedule tab of Plan: one calendar of weeks under the row that
 * repeats every week. A block's weeks are labeled and show the block's own
 * workouts apart from what repeats every week; the block itself is shaped
 * in the Block tab. The chosen date's panel changes that date, and the top
 * row's panel changes a weekday.
 */
export function PlanPage({ state, write, busy, onEditWorkout, scheduleWorkoutId, onScheduled, accountId, reload, onSignedOut }: {
  state: StateResponse;
  write: Write;
  busy: boolean;
  onEditWorkout: (id: string | null) => void;
  scheduleWorkoutId?: string | null;
  onScheduled?: () => void;
  accountId?: string;
  reload?: () => Promise<void>;
  onSignedOut?: (error?: unknown) => void;
}) {
  const today = useMemo(() => localToday(), []);
  const thisMonday = mondayOnOrBefore(today);
  const [selected, setSelected] = useState(today);
  const [earlier, setEarlier] = useState(0);
  const [later, setLater] = useState(0);
  // The weekday of the repeating week open in the side panel, if any.
  const [weekday, setWeekday] = useState<Weekday | null>(null);
  // An open weekday with unsaved changes asks before another day or date replaces it.
  const weekdayDirty = useRef(false);
  const noteWeekdayDirty = useCallback((dirty: boolean) => { weekdayDirty.current = dirty; }, []);
  const leaveWeekday = (next: Weekday | null) => next === weekday || !weekdayDirty.current
    || window.confirm(`Discard your unsaved changes to ${weekday ? WEEKDAY_LABELS[weekday] : 'this day'}?`);
  const [awayOpen, setAwayOpen] = useState(false);
  const [addDismissed, setAddDismissed] = useState<string | null>(null);
  const [editSelection, setEditSelection] = useState<DateWorkoutSelection | null>(null);
  const miles = useMemo(() => prefersMiles(), []);
  const plan = state.plan;
  // The saved block. Changes to it are made, and kept until saved, in the Block tab.
  const program = useMemo(() => planBlocks(state).program, [state]);
  const inputs = useMemo(() => calendarInputs(state), [state]);
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
  const scroller = useWeekScroller(first, rows.length, thisMonday, setEarlier, setLater);
  const workouts = useMemo(() => new Map((plan?.workouts ?? []).map((w) => [w.id, w])), [plan]);
  const live = useMemo(() => liveWorkouts(plan?.workouts ?? []), [plan]);
  const loads = useMemo(() => activityLoads(state), [state]);
  const sports = useMemo(() => activitySports(state), [state]);
  const routable = useMemo(() => routableActivityIds(state), [state]);
  const chartable = useMemo(() => chartableActivities(state), [state]);
  useEffect(() => { setAddDismissed(null); if (scheduleWorkoutId) setWeekday(null); }, [scheduleWorkoutId]);
  // A newer plan closes the weekday form: its draft was made from the older week.
  const planVersion = plan?.version;
  useEffect(() => setWeekday(null), [planVersion]);
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
  const showStart = !program && routineIsEmpty(plan.schedule);
  // The block still has dates to come, so it shapes the weeks shown.
  const running = !!program && (program.repeat || today < blockEndMonday(program, today));
  const layered = isLayered(program);
  const thisBlockWeek = programWeekOn(program, today);
  const lastIndex = program ? program.weeks.length - 1 : -1;
  const endRow = program ? rows.findIndex((row, index) => row.week === lastIndex && rows[index + 1]?.week !== lastIndex) : -1;
  // What each block week owns, as the Block tab edits it: for its targets.
  const ownBlock = program ? ownForm(program, plan.schedule) : null;
  const blockIds = layered && running ? new Set(program!.workout_ids) : undefined;
  const adding = scheduleWorkoutId && scheduleWorkoutId !== addDismissed
    ? [...live.values()].find((workout) => workout.id === scheduleWorkoutId) : undefined;
  const reviewed = { planId: plan.id, version: plan.version };
  const weekScope = !running ? null
    : layered ? 'Shows every week, on your block’s dates too. The block’s own workouts are in the Block tab.'
      : program!.repeat ? 'Your block has its own weeks, so this week waits until the block ends.'
        : 'Fills the weeks before and after your block. The block has its own copy of each day until you sort it in the Block tab.';
  const selectedWeek = programWeekOn(program, selected);
  const awayCount = splitTrips(plan.trips ?? [], today).upcoming.length;

  return (
    <main className="planner plan-page">
      <section className="calendar" aria-labelledby="plan-title">
        <div className="plan-head">
          <div>
            <h1 id="plan-title">Your plan</h1>
            <p className="muted">The top row repeats every week. Choose a day in it, or any date.</p>
          </div>
          <div className="block-actions">
            {!program && hasWorkouts && <a className="ghost" href="#block">Training block</a>}
          </div>
        </div>
        {program && (
          <p className="block-strip">
            <span className="kicker">Training block</span>
            <strong>{program.name?.trim() || 'Your block'}</strong>
            <span className="muted">{blockStatus(program, thisBlockWeek, today)}</span>
            <a className="ghost small" href="#block">Open the block</a>
          </p>
        )}
        {adding && <AddWorkoutToWeek key={`${plan.id}:${plan.version}:${adding.id}`} workout={adding} workouts={plan.workouts}
          schedule={plan.schedule} reviewed={reviewed} write={write} busy={busy}
          onDone={() => { setAddDismissed(adding.id); onScheduled?.(); }}
          onCancel={() => { setAddDismissed(adding.id); onScheduled?.(); }} />}
        {showStart && !adding && <PlanStart hasWorkouts={hasWorkouts} onUsualWeek={() => setWeekday('mon')}
          onCreate={() => onEditWorkout(null)} />}

        <div className="plan-more">
          <p className="muted fine">Scroll the weeks to see earlier and later ones.</p>
          <div className="head-actions">
            {layered && running && (
              <span className="plan-legend" aria-hidden="true">
                <span className="chip lift projected own">From your block</span>
                <span className="chip lift projected">Every week</span>
              </span>
            )}
            <button type="button" className="ghost small" aria-expanded={awayOpen} onClick={() => setAwayOpen(!awayOpen)}>
              {awayCount ? `Away dates (${awayCount})` : 'Away dates'}
            </button>
            <button type="button" className="ghost small" onClick={scroller.toThisWeek}>This week</button>
          </div>
        </div>
        {awayOpen && <AwayDates trips={plan.trips ?? []} today={today} version={plan.version} write={write} busy={busy} />}
        <div className="grid weeks" role="grid" aria-labelledby="plan-title" ref={scroller.boxRef}>
          <div className="weeks-top" role="rowgroup">
            <div className="grid-row weekdays" role="row">
              <div role="columnheader" className="week-col">Week</div>
              {WEEKDAYS.map((day) => <div key={day} role="columnheader">{WEEKDAY_LABELS[day].slice(0, 3)}</div>)}
            </div>
            <EveryWeekRow schedule={plan.schedule} workouts={plan.workouts} selected={weekday} disabled={!!adding}
              onSelect={(day) => { if (leaveWeekday(day)) setWeekday(day); }}
              hint={!running ? 'Fills every week below' : layered ? 'Carries on beside your block' : 'Outside your block'} />
          </div>
          {scroller.canAdd && (
            <div role="row" className="grid-row weeks-more" ref={scroller.topRef}>
              <div role="gridcell"><button type="button" className="ghost small" onClick={scroller.loadEarlier}>Earlier weeks</button></div>
            </div>
          )}
          {rows.map((row, index) => (
            <Fragment key={row.monday}>
              <div role="row" data-monday={row.monday} className={['grid-row', 'week-row', row.week != null ? 'in-block' : '',
                row.monday === thisMonday ? 'current' : ''].filter(Boolean).join(' ')}>
                <WeekHeader row={row} program={program} thisMonday={thisMonday} today={today} />
                {WEEKDAYS.map((day, d) => {
                  const date = addDays(row.monday, d);
                  const week = row.week;
                  // The block's own workouts on this date, each with what its week asks for.
                  const own = layered && week != null
                    ? new Map(splitBlockDay(program!, plan.schedule, week, day).own.map((id) => {
                      const workout = workouts.get(id);
                      return [id, workout && ownBlock ? weekHeadline(workout, ownBlock, week, miles) : ''] as const;
                    })) : undefined;
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
                      ownDate={date >= today && dateSetOnItsOwn(cells.get(date))}
                      own={own}
                      isSelected={weekday === null && date === selected}
                      sports={sports}
                      onSelect={() => { if (leaveWeekday(null)) { setSelected(date); setWeekday(null); } }}
                    />
                  );
                })}
              </div>
              {program && index === endRow && (
                <div role="row" className="grid-row block-end">
                  <div role="gridcell">
                    <span>
                      <strong>{program.name?.trim() || 'Your block'}</strong>{' '}
                      {program.repeat
                        ? 'starts over at week 1 from here.'
                        : `ends ${shortDate(addDays(row.monday, 6))}. After it, ${layered ? 'what you do every week carries on.' : 'your every-week row takes over again.'}`}
                    </span>
                    <a className="ghost small" href="#block">Open the block</a>
                  </div>
                </div>
              )}
            </Fragment>
          ))}
          {scroller.canAdd && (
            <div role="row" className="grid-row weeks-more" ref={scroller.bottomRef}>
              <div role="gridcell"><button type="button" className="ghost small" onClick={scroller.loadLater}>Later weeks</button></div>
            </div>
          )}
        </div>
        <div className="plan-more">
          <p className="muted fine">Dashed: planned. Filled: done or started. “This date only” marks a date you changed on its own.</p>
        </div>

      </section>

      {weekday ? (
        <aside className="detail" aria-labelledby="every-day-title">
          <EveryWeekdayPanel key={`${plan.id}:${weekday}`} day={weekday} schedule={plan.schedule} workouts={plan.workouts}
            reviewed={reviewed} write={write} busy={busy} onClose={() => setWeekday(null)} onNewWorkout={() => onEditWorkout(null)} onDirty={noteWeekdayDirty}
            blockIds={blockIds}
            scope={weekScope ?? `Fills each ${WEEKDAY_LABELS[weekday]} you haven’t changed on its own date.`} />
        </aside>
      ) : <DayDetail
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
        onEditDateWorkout={accountId ? (workoutId, primary) => setEditSelection({ date: selected, workoutId, primary }) : undefined}
        editPanel={dateEditPanel}
        actions={(
          <>
            <DateActions date={selected} today={today} cell={selectedCell} workout={workoutFor(selectedCell, workouts)}
              state={state} cellFor={cellFor} write={write} busy={busy} />
            {program && selectedWeek != null && (
              <BlockDate program={program} index={selectedWeek} date={selected} layered={layered} />
            )}
            {(selectedWeek == null || layered) && (
              <UsualDay date={selected} busy={busy} onEdit={setWeekday} workouts={workouts}
                ids={program && selectedWeek != null ? standingOn(program, plan.schedule, weekdayOf(selected) as Weekday)
                  : [plan.schedule.week[weekdayOf(selected) as Weekday], ...(plan.schedule.extras?.[weekdayOf(selected) as Weekday] ?? [])]
                    .filter((id): id is string => !!id)} />
            )}
          </>
        )}
      />}
    </main>
  );
}

/** The first choice for a plan with nothing on its weekdays yet. */
function PlanStart({ hasWorkouts, onUsualWeek, onCreate }: {
  hasWorkouts: boolean;
  onUsualWeek: () => void;
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
          <h3>A training block</h3>
          <p className="muted">Your main training for a set number of weeks, with targets that change week to week: more volume, an easier week, a different mix. Good for custom swim, run and lift blocks.</p>
          {hasWorkouts
            ? <a className="ghost" href="#block">Start my block</a>
            : <p className="fine muted">Create a workout first.</p>}
        </article>
      </div>
    </section>
  );
}

/** "Nov 16 – 22" or "Nov 30 – Dec 6" for the week starting on a Monday. */
function weekRange(monday: string): string {
  const first = shortDate(monday).slice(5);
  const last = shortDate(addDays(monday, 6)).slice(5);
  return first.slice(0, 3) === last.slice(0, 3) ? `${first} – ${last.slice(4)}` : `${first} – ${last}`;
}

/** Where the block stands today, for the strip above the calendar. */
function blockStatus(program: TrainingProgram, thisWeek: number | null, today: string): string {
  const count = program.weeks.length;
  if (program.repeat) return thisWeek != null ? `Week ${thisWeek + 1} of ${count} · starts over when it ends` : `Starts ${shortDate(program.start)}`;
  const lastDay = addDays(program.start, count * 7 - 1);
  if (thisWeek != null) return `Week ${thisWeek + 1} of ${count} · ends ${shortDate(lastDay)}`;
  return today < program.start ? `${count} ${count === 1 ? 'week' : 'weeks'} from ${shortDate(program.start)}` : `Ended ${shortDate(lastDay)}`;
}

/** A week row's heading: where it is in the block, or its dates. */
function WeekHeader({ row, program, thisMonday, today }: { row: PlanRow; program: TrainingProgram | null; thisMonday: string; today: string }) {
  if (program && row.week != null) {
    const index = row.week;
    const label = program.weeks[index]?.label?.trim();
    return (
      <div role="rowheader" className="week-head">
        <span className="kicker">Week {index + 1} of {program.weeks.length}{row.monday === thisMonday ? ' · now' : ''}</span>
        <strong>{label || weekRange(row.monday)}</strong>
        {label ? <span className="muted">{weekRange(row.monday)}</span> : null}
      </div>
    );
  }
  const outside = program ? (row.monday < program.start ? 'Before the block' : row.monday >= blockEndMonday(program, today) ? 'After the block' : null) : null;
  return (
    <div role="rowheader" className="week-head usual">
      {outside || row.monday === thisMonday ? <span className="kicker">{row.monday === thisMonday ? 'This week' : outside}</span> : null}
      <strong>{program ? weekRange(row.monday) : `Week of ${shortDate(row.monday).slice(5)}`}</strong>
    </div>
  );
}

/** A block date in the side panel: which week it is, that changes here are
 * for the date alone, and the way to the block itself. */
function BlockDate({ program, index, date, layered }: { program: TrainingProgram; index: number; date: string; layered: boolean }) {
  return (
    <section className="block-day panel" aria-labelledby="block-day-title">
      <p className="kicker">Week {index + 1} of {program.weeks.length}</p>
      <h3 id="block-day-title">{program.name?.trim() || 'Your block'}</h3>
      <p className="muted">
        Changes here are for {shortDate(date)} only.
        {layered ? ' The block’s days and targets change in the Block tab.'
          : ' This block has its own copy of each day, so your every-week row doesn’t show on its dates until you sort it in the Block tab.'}
      </p>
      <a className="ghost small" href="#block">Open the block</a>
    </section>
  );
}

/** What repeats every week on the chosen weekday, with a way to change it. */
function UsualDay({ date, ids, workouts, busy, onEdit }: {
  date: string;
  /** What the repeating week gives this date. */
  ids: string[];
  workouts: Map<string, Workout>;
  busy: boolean;
  onEdit: (day: Weekday) => void;
}) {
  const day = weekdayOf(date) as Weekday;
  const name = WEEKDAY_LABELS[day];
  return (
    <section className="block-day panel" aria-labelledby="usual-day-title">
      <h3 id="usual-day-title">Every {name}</h3>
      <p className="muted">{ids.length ? ids.map((id) => workouts.get(id)?.name ?? 'Unavailable workout').join(', ') : 'Rest'} every week.</p>
      <button type="button" className="ghost small" disabled={busy} onClick={() => onEdit(day)}>Change every {name}</button>
    </section>
  );
}

/** A date the member planned, emptied or skipped on its own: its main workout is a saved choice, not the week's. */
function dateSetOnItsOwn(cell: CalendarCell | undefined): boolean {
  return !!cell?.real && (cell.status === 'planned' || cell.status === 'skipped');
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
  /** This date was planned or skipped on its own, apart from the week. */
  ownDate: boolean;
  /** The block's own workouts on this date: id → what its week asks for. */
  own?: ReadonlyMap<string, string>;
  isSelected: boolean;
  activities: StateActivity[];
  sports: Map<string, string>;
  onSelect: () => void;
}) {
  const { date, cell, workout, workouts, schedule, monthLabel, isToday, ownDate, own, isSelected, activities, sports, onSelect } = props;
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
  // A chip keeps the time on its own line, so a long name never cuts it short.
  const chipText = (name: string, id: string | null, workoutStatus: string | undefined) => {
    const time = plannedReminderTime(schedule, id, date, workoutStatus);
    // A block workout still to do says what its week asks for.
    const target = id && (workoutStatus === 'projected' || workoutStatus === 'planned') ? own?.get(id) : undefined;
    return <><span>{name}</span>{target ? <small className="target">{target}</small> : null}{time ? <small>{formatScheduleTime(time)}</small> : null}</>;
  };
  const ownClass = (id: string | null | undefined) => (id && own?.has(id) ? ' own' : '');
  const additionalNames = additional.map((session) =>
    `${nameAt(session.kind === 'freestyle' ? 'Freestyle' : workouts.get(session.workout_id ?? '')?.name ?? 'Workout', session.workout_id, session.status)}, ${session.status.replaceAll('_', ' ')}`);
  const label = [formatLongDate(date), calendarStatusLabel(cell),
    ...(workout ? [nameAt(workout.name, workout.id, status)] : []), ...additionalNames,
    ...extras.map((extra) => `${nameAt(extra.name, extra.id, 'projected')}, planned`),
    ...(own?.size ? [`from your block: ${[...own.keys()].map((id) => workouts.get(id)?.name ?? 'workout').join(', ')}`] : []),
    ...(ownDate ? ['this date only'] : [])].join(', ');
  return (
    <button type="button" role="gridcell" className={classes} onClick={onSelect} aria-label={label} aria-pressed={isSelected}>
      <span className="day-number">{monthLabel || dayOfMonth === 1 ? `${MONTHS[Number(date.slice(5, 7)) - 1]} ${dayOfMonth}` : dayOfMonth}</span>
      {status === 'unavailable' || status === 'light' ? <span className="chip away">Away</span> : null}
      {workout && showWorkout ? <span className={`chip lift ${status ?? ''}${ownClass(workout.id)}`}>{chipText(workout.name, workout.id, status)}</span> : null}
      {additional.map((session) => (
        <span key={session.id} className={`chip lift ${session.status}${ownClass(session.workout_id)}`}>
          {chipText(session.kind === 'freestyle' ? 'Freestyle' : workouts.get(session.workout_id ?? '')?.name ?? 'Workout', session.workout_id, session.status)}
        </span>
      ))}
      {extras.map((extra) => (
        <span key={`planned:${extra.id}`} className={`chip lift projected${ownClass(extra.id)}`}>{chipText(extra.name, extra.id, 'projected')}</span>
      ))}
      {cell?.items.map((item) => (
        <span key={item.id} className={`chip endurance ${item.completed ? 'completed' : ''}`}>
          <span>{itemTitle(item, sports)}</span>
        </span>
      ))}
      {ownDate && !(workout && showWorkout) ? <span className="own-rest">{status === 'skipped' ? 'Skipped' : 'Rest'}</span> : null}
      {ownDate ? <small className="own-date">This date only</small> : null}
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
