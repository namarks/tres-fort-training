import { useEffect, useId, useMemo, useState, type FormEvent, type KeyboardEvent, type ReactNode } from 'react';
import type { RaceGoal } from '../../src/types';
import { planWrites, type StateResponse } from './api';
import { formatActivityDistance, formatDuration, formatPace, type Entry } from './activity';
import { ConfirmPanel } from './CalendarEditing';
import { activityHref, longDate, niceCeiling, shortDate, useWidth } from './chartHelpers';
import {
  blockStatus,
  countdownText,
  daysUntil,
  DISCIPLINES,
  disciplineLabel,
  DISTANCE_PRESETS,
  draftKind,
  ESTIMATE_DAYS,
  eventDayResult,
  eventDraft,
  eventFromDraft,
  eventKinds,
  eventWeeks,
  goalTimeText,
  PHASE_LABELS,
  phaseOn,
  planBlocks,
  readiness,
  singleKind,
  bestEstimate,
  type DistanceUnit,
  type EventDraft,
  type EventKind,
  type EventWeek,
} from './event';
import { addDays } from '../../src/calendarProjection';
import { methodologyHref } from './MethodologyPage';
import type { Write } from './WorkoutEditor';

const KIND_NAMES: Record<EventKind, string> = { run: 'Running', ride: 'Riding', swim: 'Swimming' };
const KIND_SESSIONS: Record<EventKind, string> = { run: 'run', ride: 'ride', swim: 'swim' };

/**
 * The Analysis section's Event page: the member's goal event and how their
 * training is heading toward it. The event is set here (or in the app, or by
 * the coach); everything shown is worked out from the plan and the history.
 */
export function EventPage({ state, entries, today, miles, write, busy }: {
  state: StateResponse;
  entries: Entry[];
  today: string;
  miles: boolean;
  write: Write;
  busy: boolean;
}) {
  const race = state.plan?.race ?? null;
  const version = state.plan?.version ?? 0;
  const [mode, setMode] = useState<'view' | 'edit' | 'remove'>('view');
  // A newer plan closes an open form, so a stale one can't overwrite it.
  useEffect(() => setMode('view'), [version]);

  const save = (next: RaceGoal) => write((at) => planWrites.setEvent(next, at)).then((saved) => { if (saved) setMode('view'); });

  return (
    <>
      <div className="analysis-head">
        <div>
          <h1>Event</h1>
          <p className="muted analysis-sub">Your goal event, and how your training is heading toward it</p>
        </div>
        {race && mode === 'view' && (
          <div className="row-actions">
            <button type="button" className="ghost small" disabled={busy} onClick={() => setMode('edit')}>Edit event</button>
            <button type="button" className="ghost small danger" disabled={busy} onClick={() => setMode('remove')}>Remove</button>
          </div>
        )}
      </div>

      {mode === 'remove' && race && (
        <ConfirmPanel action="Remove event" busy={busy} onCancel={() => setMode('view')}
          onConfirm={() => write((at) => planWrites.clearEvent(at)).then((saved) => { if (saved) setMode('view'); })}>
          Remove {race.name}? Your plan and training history stay as they are.
        </ConfirmPanel>
      )}

      {!race ? (
        <section className="analysis-card" aria-labelledby="event-new-title">
          <h2 id="event-new-title">Set an event</h2>
          <p className="muted analysis-caption">
            A race, a ride, a swim or any day you’re training for. With a distance and a goal time, this page shows your goal pace and how your recent sessions compare with it, alongside your weekly distance, longest sessions and fitness heading in.
          </p>
          <EventForm race={null} miles={miles} busy={busy} onSave={save} />
        </section>
      ) : mode === 'edit' ? (
        <section className="analysis-card" aria-labelledby="event-edit-title">
          <h2 id="event-edit-title">Edit event</h2>
          <EventForm race={race} miles={miles} busy={busy} onSave={save} onCancel={() => setMode('view')} />
        </section>
      ) : (
        <EventAnalysis state={state} race={race} entries={entries} today={today} miles={miles} />
      )}

      <p className="analysis-footnote muted">
        Every figure on this page is worked out as the <a href={methodologyHref('event')}>Methodology</a> page describes.
      </p>
    </>
  );
}

// ---- the analysis -----------------------------------------------------------

function EventAnalysis({ state, race, entries, today, miles }: {
  state: StateResponse;
  race: RaceGoal;
  entries: Entry[];
  today: string;
  miles: boolean;
}) {
  const days = daysUntil(today, race.date);
  const kind = singleKind(race);
  const kinds = eventKinds(race.discipline);
  const target = race.distance_m ?? null;
  const { program, phases } = useMemo(() => planBlocks(state), [state]);
  const block = useMemo(() => blockStatus(program, today, race.date), [program, today, race.date]);
  const phase = phaseOn(phases, today);
  const weeks = useMemo(() => eventWeeks(entries, race, today), [entries, race, today]);
  const ready = useMemo(() => readiness(entries, race, today, weeks), [entries, race, today, weeks]);
  const estimate = useMemo(
    () => (kind && target ? bestEstimate(entries, kind, target, addDays(today, -(ESTIMATE_DAYS - 1)), today) : null),
    [entries, kind, target, today],
  );
  const result = useMemo(() => eventDayResult(entries, race, today), [entries, race, today]);
  const goalPace = kind && target && race.goal_time_s
    ? formatPace({ kind, distance_m: target, seconds: race.goal_time_s }, miles) : null;
  const distanceText = race.distance ?? (kind && target ? formatActivityDistance(target, kind, miles) : null);

  return (
    <>
      <section className="week-card event-card" aria-labelledby="event-name">
        <div className="week-card-head">
          <span className="week-card-title">{[disciplineLabel(race.discipline), distanceText].filter(Boolean).join(' · ')}</span>
          <span className="streak">{longDate(race.date)}</span>
        </div>
        <h2 id="event-name" className="event-name">{race.name}</h2>
        <p className="week-total">
          <span className="week-total-value event-countdown">{countdownText(days)}</span>
        </p>
        <dl className="week-stats">
          {race.goal_time_s ? <div><dd>{goalTimeText(race.goal_time_s)}</dd><dt>Goal time</dt></div> : null}
          {goalPace && <div><dd>{goalPace}</dd><dt>Goal {kind === 'ride' ? 'speed' : 'pace'}</dt></div>}
          {estimate && <div><dd>{goalTimeText(estimate.seconds)}</dd><dt>Estimate from recent {KIND_SESSIONS[kind!]}s</dt></div>}
          {block && block.weekToday !== null && (
            <div><dd>Week {block.weekToday + 1} of {block.weeks}</dd><dt>{block.name ?? 'Your block'}{block.label ? ` · ${block.label}` : ''}</dt></div>
          )}
          {phase && <div><dd>{PHASE_LABELS[phase.phase]}</dd><dt>Training phase</dt></div>}
          {race.location && <div><dd>{race.location}</dd><dt>Where</dt></div>}
        </dl>
      </section>

      {result && (
        <section className="analysis-card" aria-labelledby="event-day-title">
          <h2 id="event-day-title">On the day</h2>
          <p>
            <a href={activityHref(result)}>{result.title}</a>
            {result.meters && result.activityKind ? ` · ${formatActivityDistance(result.meters, result.activityKind, miles)}` : ''}
            {result.seconds > 0 ? ` in ${goalTimeText(result.seconds)}` : ''}
            {race.goal_time_s ? ` · goal ${goalTimeText(race.goal_time_s)}` : ''}
          </p>
          {race.goal_time_s && result.seconds > 0 && target && result.meters && Math.abs(result.meters - target) / target < 0.03 && (
            <p className="muted">{result.seconds <= race.goal_time_s
              ? `${goalTimeText(race.goal_time_s - result.seconds)} under your goal.`
              : `${goalTimeText(result.seconds - race.goal_time_s)} over your goal.`}</p>
          )}
          <p className="muted analysis-caption">When you’re ready, set your next event with Edit event.</p>
        </section>
      )}

      <PlanCard race={race} block={block} days={days} />

      {kind && target ? (
        <EstimateCard race={race} kind={kind} target={target} weeks={weeks} estimate={estimate} miles={miles} />
      ) : (
        <section className="analysis-card">
          <h2>Finish estimate</h2>
          <p className="analysis-empty">
            {kinds.length === 0
              ? `Très Fort can’t tell which sessions train for a ${disciplineLabel(race.discipline).toLowerCase()} event, so it shows your fitness and plan instead.`
              : kinds.length > 1
                ? 'A multisport event has no single pace to estimate, so this page shows your time in each sport instead.'
                : 'Add the event’s distance with Edit event to see your goal pace and an estimate from your recent sessions.'}
          </p>
        </section>
      )}

      {kinds.length > 0 && <WeeksCard race={race} kinds={kinds} kind={kind} target={target} weeks={weeks} miles={miles} />}

      <section className="analysis-tiles" aria-label="Heading in">
        <div className="analysis-tile">
          <span className="analysis-tile-title">Fitness</span>
          <span className="analysis-tile-value">{ready.today ? Math.round(ready.today.fitness) : '—'}</span>
          <span className="analysis-tile-change">
            {ready.today && ready.fitnessFourWeeksAgo !== null
              ? <><b>{signed(Math.round(ready.today.fitness - ready.fitnessFourWeeksAgo))}</b> in 4 weeks</>
              : 'Needs sessions with a training load'}
          </span>
        </div>
        <div className="analysis-tile">
          <span className="analysis-tile-title">Form</span>
          <span className="analysis-tile-value">{ready.today ? Math.round(ready.today.form) : '—'}</span>
          <span className="analysis-tile-change">{ready.formLabel ?? 'Fitness minus fatigue'}</span>
        </div>
        {kinds.length > 0 && (
          <div className="analysis-tile">
            <span className="analysis-tile-title">{kind ? `${KIND_SESSIONS[kind]}s` : 'Sessions'} a week</span>
            <span className="analysis-tile-value">{ready.sessionsPerWeek.toFixed(1)}</span>
            <span className="analysis-tile-change">Over the last 5 weeks</span>
          </div>
        )}
        {kind && (
          <div className="analysis-tile">
            <span className="analysis-tile-title">Longest {KIND_SESSIONS[kind]}, 4 weeks</span>
            <span className="analysis-tile-value">
              {ready.longestRecent ? formatActivityDistance(ready.longestRecent.meters, kind, miles) : '—'}
            </span>
            <span className="analysis-tile-change">
              {ready.longestRecent && target
                ? `${Math.round((ready.longestRecent.meters! / target) * 100)}% of the event distance`
                : ready.longestRecent ? shortDate(ready.longestRecent.date) : `No ${KIND_SESSIONS[kind]}s lately`}
            </span>
          </div>
        )}
      </section>
      <p className="muted analysis-caption">
        Fitness and form are the same lines as on Overview, from each session’s training load. Form rises when you train less than usual, as you do in the last week or two before an event.{' '}
        <a href={methodologyHref('fitness')}>How this is calculated</a>
      </p>
    </>
  );
}

function PlanCard({ race, block, days }: {
  race: RaceGoal;
  block: ReturnType<typeof blockStatus>;
  days: number;
}) {
  if (days < 0) return null;
  const lines: string[] = [];
  if (!block) {
    lines.push('Your plan has no block of weeks, so the same week repeats until the event. A block (a build of weeks that each differ) can be laid out on the Plan tab in the iPhone app.');
  } else if (block.repeat) {
    lines.push(`${block.name ?? 'Your block'} is a ${block.weeks}-week cycle that repeats${block.weekOnEvent !== null ? `; the event falls in its week ${block.weekOnEvent + 1}` : ''}.`);
  } else if (block.weekOnEvent !== null) {
    lines.push(`${block.name ?? 'Your block'} runs ${shortDate(block.start)} to ${shortDate(block.end!)}; the event falls in its week ${block.weekOnEvent + 1} of ${block.weeks}.`);
  } else if (block.end && block.end < race.date) {
    const gap = daysUntil(block.end, race.date);
    lines.push(`${block.name ?? 'Your block'} ends ${shortDate(block.end)}, ${weeksText(gap)} before the event; after that your repeating week applies.`);
  } else {
    lines.push(`${block.name ?? 'Your block'} starts ${shortDate(block.start)}, after the event.`);
  }
  return (
    <section className="analysis-card" aria-labelledby="event-plan-title">
      <h2 id="event-plan-title">Your plan</h2>
      {lines.map((line) => <p key={line} className="event-line">{line}</p>)}
    </section>
  );
}

function weeksText(days: number): string {
  if (days < 7) return `${days} ${days === 1 ? 'day' : 'days'}`;
  const weeks = Math.round(days / 7);
  return `${weeks} ${weeks === 1 ? 'week' : 'weeks'}`;
}

// ---- finish estimate --------------------------------------------------------

function EstimateCard({ race, kind, target, weeks, estimate, miles }: {
  race: RaceGoal;
  kind: EventKind;
  target: number;
  weeks: EventWeek[];
  estimate: ReturnType<typeof bestEstimate>;
  miles: boolean;
}) {
  const goal = race.goal_time_s ?? null;
  const shown = weeks.filter((w) => w.estimate !== null);
  return (
    <section className="analysis-card" aria-labelledby="estimate-title">
      <div className="analysis-card-head">
        <h2 id="estimate-title">Finish estimate</h2>
        {shown.length > 0 && (
          <ul className="legend" aria-label="Lines">
            <li><span className="line-swatch fitness" aria-hidden="true" />Week’s best estimate</li>
            {goal && <li><span className="line-swatch goal" aria-hidden="true" />Goal</li>}
          </ul>
        )}
      </div>
      <p className="muted analysis-caption">
        Each {KIND_SESSIONS[kind]} carried to the event distance{kind === 'ride' ? ' at its average speed' : ' with Riegel’s formula'}. Training sessions aren’t all-out efforts, so an estimate is usually slower than you’d race.{' '}
        <a href={methodologyHref('event')}>How this is calculated</a>
      </p>
      {estimate ? (
        <p className="event-line">
          Best in the last {ESTIMATE_DAYS / 7} weeks: <b>{goalTimeText(estimate.seconds)}</b>, from <a href={activityHref(estimate.entry)}>{estimate.entry.title}</a>
          {' '}({formatActivityDistance(estimate.entry.meters, kind, miles)} on {shortDate(estimate.entry.date)}).
          {goal && (estimate.seconds <= goal
            ? ` That’s at or under your ${goalTimeText(goal)} goal.`
            : ` Your goal is ${goalTimeText(goal)}, ${goalTimeText(estimate.seconds - goal)} faster.`)}
        </p>
      ) : (
        <p className="analysis-empty">No {KIND_SESSIONS[kind]} in the last {ESTIMATE_DAYS / 7} weeks is long enough to estimate from.</p>
      )}
      {shown.length > 1 && <EstimateChart weeks={weeks} goal={goal} />}
    </section>
  );
}

function EstimateChart({ weeks, goal }: { weeks: EventWeek[]; goal: number | null }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [active, setActive] = useState<number | null>(null);
  const W = Math.max(width, 320);
  const H = 200;
  const left = 52;
  const right = 12;
  const top = 12;
  const bottom = 24;
  const values = weeks.flatMap((w) => (w.estimate === null ? [] : [w.estimate]));
  if (goal) values.push(goal);
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const pad = Math.max(10, (hi - lo) * 0.15);
  const step = timeStep((hi - lo + 2 * pad) / 4);
  const min = Math.floor((lo - pad) / step) * step;
  const max = Math.ceil((hi + pad) / step) * step;
  const slot = (W - left - right) / weeks.length;
  const x = (i: number) => left + slot * (i + 0.5);
  // Faster is higher: less time sits at the top.
  const y = (s: number) => top + (H - top - bottom) * ((s - min) / (max - min));
  const ticks: number[] = [];
  for (let v = min; v <= max + 1e-9; v += step) ticks.push(v);
  const points = weeks.map((w, i) => (w.estimate === null ? null : { i, s: w.estimate }));
  const path = points.filter(Boolean).map((p, k) => `${k ? 'L' : 'M'}${x(p!.i).toFixed(1)},${y(p!.s).toFixed(1)}`).join('');
  const activeWeek = active !== null ? weeks[active] : null;

  function onKey(event: KeyboardEvent) {
    const from = active ?? weeks.length - 1;
    if (event.key === 'ArrowLeft') { setActive(Math.max(0, from - 1)); event.preventDefault(); }
    else if (event.key === 'ArrowRight') { setActive(Math.min(weeks.length - 1, from + 1)); event.preventDefault(); }
    else if (event.key === 'Escape') setActive(null);
  }

  return (
    <div className="an-chart" ref={ref}>
      <svg width={W} height={H} role="img" tabIndex={0} onKeyDown={onKey} onPointerLeave={() => setActive(null)}
        aria-label="Best finish estimate each week, faster higher. Use the left and right arrow keys to read each week.">
        {ticks.map((v) => (
          <g key={v}>
            <line className="grid-line" x1={left} x2={W - right} y1={y(v)} y2={y(v)} />
            <text className="axis" x={left - 8} y={y(v) + 4} textAnchor="end">{goalTimeText(v)}</text>
          </g>
        ))}
        {goal && <line className="goal-line" x1={left} x2={W - right} y1={y(goal)} y2={y(goal)} />}
        {weeks.map((w, i) => (
          <g key={w.start} onPointerEnter={() => setActive(i)}>
            <rect className="hit" x={left + slot * i} y={top} width={slot} height={H - top - bottom} />
            {showLabel(i, weeks.length, w.current, W - left - right) && (
              <text className={`axis${w.current ? ' strong' : ''}`} x={x(i)} y={H - 6} textAnchor="middle">
                {w.current ? 'This week' : shortDate(w.start)}
              </text>
            )}
          </g>
        ))}
        <path className="line-fitness" d={path} />
        {points.map((p) => p && <circle key={p.i} className="dot-fitness" cx={x(p.i)} cy={y(p.s)} r={active === p.i ? 5 : 3.5} />)}
        {active !== null && <rect className="bar-focus" x={left + slot * active} y={top} width={slot} height={H - top - bottom} rx={4} />}
      </svg>
      {activeWeek && (
        <div className="an-tip" style={{ left: x(active!) > W - 240 ? x(active!) - 236 : x(active!) + 14, top: 12 }}>
          <div className="an-tip-when">Week of {shortDate(activeWeek.start)}</div>
          <div className="an-tip-row"><span>Best estimate</span><span>{activeWeek.estimate === null ? '—' : goalTimeText(activeWeek.estimate)}</span></div>
          {goal && <div className="an-tip-row"><span>Goal</span><span>{goalTimeText(goal)}</span></div>}
        </div>
      )}
      <details className="an-table">
        <summary>Show as a table</summary>
        <table>
          <thead><tr><th scope="col">Week of</th><th scope="col">Best estimate</th></tr></thead>
          <tbody>
            {weeks.map((w) => (
              <tr key={w.start}><th scope="row">{shortDate(w.start)}</th><td>{w.estimate === null ? '—' : goalTimeText(w.estimate)}</td></tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}

// ---- weeks heading in -------------------------------------------------------

function WeeksCard({ race, kinds, kind, target, weeks, miles }: {
  race: RaceGoal;
  kinds: EventKind[];
  kind: EventKind | null;
  target: number | null;
  weeks: EventWeek[];
  miles: boolean;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [active, setActive] = useState<number | null>(null);
  // One sport shows distance; several show time, since their distances don't add up.
  const byDistance = kind !== null;
  const value = (w: EventWeek, k: EventKind) => (byDistance ? w.meters[k] ?? 0 : w.seconds[k] ?? 0);
  const total = (w: EventWeek) => kinds.reduce((sum, k) => sum + value(w, k), 0);
  const W = Math.max(width, 320);
  const H = 220;
  const left = 48;
  const right = 12;
  const top = 10;
  const bottom = 24;
  const unitMeters = kind === 'swim' ? (miles ? 0.9144 : 1) : miles ? 1609.344 : 1000;
  const scale = byDistance ? unitMeters : 3600;
  const most = Math.max(...weeks.map((w) => Math.max(total(w), byDistance ? w.longest : 0)), byDistance && target ? target : 0, scale);
  const step = niceCeiling(most / scale / 4);
  const ceiling = step * Math.ceil(most / scale / step) * scale;
  const slot = (W - left - right) / weeks.length;
  const barW = Math.max(4, Math.min(40, slot * 0.6));
  const y = (v: number) => top + (H - top - bottom) * (1 - v / ceiling);
  const ticks: number[] = [];
  for (let v = 0; v <= ceiling + 1e-6; v += step * scale) ticks.push(v);
  const unit = byDistance ? (kind === 'swim' ? (miles ? 'yd' : 'm') : miles ? 'mi' : 'km') : 'h';
  const tickText = (v: number) => {
    const n = v / scale;
    return `${Number.isInteger(n) ? n : n.toFixed(1)}${byDistance ? '' : 'h'}`;
  };
  const valueText = (v: number, k: EventKind) => (byDistance ? formatActivityDistance(v, k, miles) ?? `0 ${unit}` : formatDuration(v));
  const activeWeek = active !== null ? weeks[active] : null;

  function onKey(event: KeyboardEvent) {
    const from = active ?? weeks.length - 1;
    if (event.key === 'ArrowLeft') { setActive(Math.max(0, from - 1)); event.preventDefault(); }
    else if (event.key === 'ArrowRight') { setActive(Math.min(weeks.length - 1, from + 1)); event.preventDefault(); }
    else if (event.key === 'Escape') setActive(null);
  }

  return (
    <section className="analysis-card" aria-labelledby="weeks-title">
      <div className="analysis-card-head">
        <h2 id="weeks-title">{byDistance ? `${KIND_NAMES[kind!]} distance by week` : 'Time in each sport by week'}</h2>
        <ul className="legend" aria-label="Key">
          {kinds.map((k) => <li key={k}><span className={`swatch event-${k}`} aria-hidden="true" />{KIND_NAMES[k]}</li>)}
          {byDistance && <li><span className="dot-swatch" aria-hidden="true" />Longest {KIND_SESSIONS[kind!]}</li>}
          {byDistance && target && <li><span className="line-swatch goal" aria-hidden="true" />Event distance</li>}
        </ul>
      </div>
      <div className="an-chart" ref={ref}>
        <svg width={W} height={H} role="img" tabIndex={0} onKeyDown={onKey} onPointerLeave={() => setActive(null)}
          aria-label={`${byDistance ? 'Distance' : 'Time'} by week for ${race.name}. Use the left and right arrow keys to read each week.`}>
          {ticks.map((v) => (
            <g key={v}>
              <line className="grid-line" x1={left} x2={W - right} y1={y(v)} y2={y(v)} />
              <text className="axis" x={left - 8} y={y(v) + 4} textAnchor="end">{tickText(v)}</text>
            </g>
          ))}
          {byDistance && target && <line className="goal-line" x1={left} x2={W - right} y1={y(target)} y2={y(target)} />}
          {weeks.map((w, i) => {
            const cx = left + slot * i + (slot - barW) / 2;
            let base = 0;
            return (
              <g key={w.start} onPointerEnter={() => setActive(i)}>
                <rect className="hit" x={left + slot * i} y={top} width={slot} height={H - top - bottom} />
                {kinds.map((k) => {
                  const v = value(w, k);
                  if (v <= 0) return null;
                  const y0 = y(base);
                  base += v;
                  const y1 = y(base);
                  return <rect key={k} className={`bar event-fill-${k}`} x={cx} y={y1 + 1} width={barW} height={Math.max(1, y0 - y1 - 2)} rx={Math.min(3, barW / 2)} />;
                })}
                {byDistance && w.longest > 0 && <circle className="longest-dot" cx={cx + barW / 2} cy={y(w.longest)} r={4} />}
                {showLabel(i, weeks.length, w.current, W - left - right) && (
                  <text className={`axis${w.current ? ' strong' : ''}`} x={cx + barW / 2} y={H - 6} textAnchor="middle">
                    {w.current ? 'This week' : shortDate(w.start)}
                  </text>
                )}
              </g>
            );
          })}
          {active !== null && <rect className="bar-focus" x={left + slot * active} y={top} width={slot} height={H - top - bottom} rx={4} />}
        </svg>
        {activeWeek && (
          <div className="an-tip" style={{ left: left + slot * (active! + 0.5) > W - 240 ? left + slot * (active! + 0.5) - 236 : left + slot * (active! + 0.5) + 16, top: 16 }}>
            <div className="an-tip-when">Week of {shortDate(activeWeek.start)}</div>
            {kinds.map((k) => <div key={k} className="an-tip-row"><span>{KIND_NAMES[k]}</span><span>{valueText(value(activeWeek, k), k)}</span></div>)}
            {byDistance && <div className="an-tip-row"><span>Longest</span><span>{activeWeek.longest > 0 ? valueText(activeWeek.longest, kind!) : '—'}</span></div>}
            <p className="muted an-tip-none">{activeWeek.sessions} {activeWeek.sessions === 1 ? 'session' : 'sessions'}</p>
          </div>
        )}
        <details className="an-table">
          <summary>Show as a table</summary>
          <table>
            <thead>
              <tr>
                <th scope="col">Week of</th>
                {kinds.map((k) => <th key={k} scope="col">{KIND_NAMES[k]}</th>)}
                {byDistance && <th scope="col">Longest</th>}
                <th scope="col">Sessions</th>
              </tr>
            </thead>
            <tbody>
              {weeks.map((w) => (
                <tr key={w.start}>
                  <th scope="row">{shortDate(w.start)}</th>
                  {kinds.map((k) => <td key={k}>{valueText(value(w, k), k)}</td>)}
                  {byDistance && <td>{w.longest > 0 ? valueText(w.longest, kind!) : '—'}</td>}
                  <td>{w.sessions}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      </div>
    </section>
  );
}

// ---- the editor -------------------------------------------------------------

/** The event's name, date, type, distance and goal time. Also the first-run
 * setup's optional goal step, with its own button words and extra choices. */
export function EventForm({ race, miles, busy, onSave, onCancel, submitLabel, cancelLabel, children }: {
  race: RaceGoal | null;
  miles: boolean;
  busy: boolean;
  onSave: (race: RaceGoal) => void;
  onCancel?: () => void;
  submitLabel?: string;
  cancelLabel?: string;
  /** Shown above the buttons. */
  children?: ReactNode;
}) {
  const [draft, setDraft] = useState<EventDraft>(() => eventDraft(race, miles));
  const [error, setError] = useState<string | null>(null);
  const id = useId();
  const kind = draftKind(draft);
  const set = (patch: Partial<EventDraft>) => setDraft((current) => {
    const next = { ...current, ...patch };
    // A new type keeps a preset only when it is still one of that type's.
    if (patch.discipline !== undefined || patch.otherDiscipline !== undefined) {
      const nextKind = draftKind(next);
      const kept = next.distanceChoice === 'custom' || next.distanceChoice === 'text';
      if (!nextKind || (!kept && !DISTANCE_PRESETS[nextKind].some((p) => p.label === next.distanceChoice))) {
        next.distanceChoice = nextKind && kept ? next.distanceChoice : '';
      }
    }
    return next;
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    const result = eventFromDraft(draft, race);
    if ('error' in result) { setError(result.error); return; }
    setError(null);
    onSave(result.race);
  }

  const units: DistanceUnit[] = kind === 'swim' ? ['m', 'yd', 'km', 'mi'] : ['km', 'mi'];
  return (
    <form className="event-form" onSubmit={submit} noValidate>
      <div className="field-row">
        <div className="field grow">
          <label htmlFor={`${id}-name`}>Name</label>
          <input id={`${id}-name`} value={draft.name} maxLength={100} placeholder="Turkey Trot 5k" onChange={(e) => set({ name: e.target.value })} />
        </div>
        <div className="field">
          <label htmlFor={`${id}-date`}>Date</label>
          <input id={`${id}-date`} type="date" value={draft.date} onChange={(e) => set({ date: e.target.value })} />
        </div>
      </div>
      <div className="field-row">
        <div className="field">
          <label htmlFor={`${id}-type`}>Type</label>
          <select id={`${id}-type`} value={draft.discipline} onChange={(e) => set({ discipline: e.target.value })}>
            {DISCIPLINES.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
            <option value="other">Something else</option>
          </select>
        </div>
        {draft.discipline === 'other' && (
          <div className="field grow">
            <label htmlFor={`${id}-other`}>What kind of event</label>
            <input id={`${id}-other`} value={draft.otherDiscipline} maxLength={40} placeholder="Biathlon" onChange={(e) => set({ otherDiscipline: e.target.value })} />
          </div>
        )}
        {kind ? (
          <>
            <div className="field">
              <label htmlFor={`${id}-distance`}>Distance</label>
              <select id={`${id}-distance`} value={draft.distanceChoice} onChange={(e) => set({ distanceChoice: e.target.value })}>
                <option value="">No set distance</option>
                {draft.distanceChoice === 'text' && draft.distanceLabel.trim() && <option value="text">{draft.distanceLabel.trim()}</option>}
                {DISTANCE_PRESETS[kind].map((p) => <option key={p.label} value={p.label}>{p.label}</option>)}
                <option value="custom">Another distance</option>
              </select>
            </div>
            {draft.distanceChoice === 'custom' && (
              <div className="field">
                <label htmlFor={`${id}-amount`}>How far</label>
                <span className="event-amount">
                  <input id={`${id}-amount`} inputMode="decimal" value={draft.customAmount} onChange={(e) => set({ customAmount: e.target.value })} />
                  <select aria-label="Unit" value={draft.customUnit} onChange={(e) => set({ customUnit: e.target.value as DistanceUnit })}>
                    {(units.includes(draft.customUnit) ? units : [draft.customUnit, ...units]).map((u) => <option key={u} value={u}>{u}</option>)}
                  </select>
                </span>
              </div>
            )}
          </>
        ) : (
          <div className="field">
            <label htmlFor={`${id}-label`}>Distance (optional)</label>
            <input id={`${id}-label`} value={draft.distanceLabel} maxLength={40} placeholder="Sprint, 70.3" onChange={(e) => set({ distanceLabel: e.target.value })} />
          </div>
        )}
        <div className="field">
          <label htmlFor={`${id}-goal`}>Goal time (optional)</label>
          <input id={`${id}-goal`} value={draft.goal} placeholder="18:00" inputMode="numeric" onChange={(e) => set({ goal: e.target.value })} />
        </div>
      </div>
      {children}
      {error && <p className="problem" role="alert">{error}</p>}
      <div className="form-actions">
        <button type="submit" disabled={busy}>{submitLabel ?? (race ? 'Save event' : 'Set event')}</button>
        {onCancel && <button type="button" className="ghost" onClick={onCancel}>{cancelLabel ?? 'Cancel'}</button>}
      </div>
    </form>
  );
}

/** A tick step in whole clock units: 15 s up to an hour. */
function timeStep(seconds: number): number {
  for (const step of [15, 30, 60, 120, 300, 600, 900, 1800, 3600]) if (step >= seconds) return step;
  return 3600 * Math.ceil(seconds / 3600);
}

/** Week labels spaced to fit, always naming this week and never crowding it. */
function showLabel(i: number, count: number, current: boolean, plotWidth: number): boolean {
  if (current) return true;
  const every = Math.max(1, Math.ceil(count / Math.max(2, Math.floor(plotWidth / 70))));
  return i % every === 0 && count - 1 - i >= every;
}

const signed = (n: number) => (n > 0 ? `+${n}` : n < 0 ? `−${Math.abs(n)}` : '±0');
