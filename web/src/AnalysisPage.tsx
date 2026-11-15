import { useMemo, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react';
import { activityHref, dateTicks, listText, longDate, monthLabel, niceCeiling, rangeText, shortDate, useWidth } from './chartHelpers';
import { addDays } from '../../src/calendarProjection';
import type { StateResponse } from './api';
import { localToday, prefersMiles } from './model';
import {
  buildHistory,
  FAMILIES,
  FAMILY_LABELS,
  formatActivityDistance,
  formatDuration,
  totalSeconds,
  type Entry,
  type Family,
} from './activity';
import {
  buckets as bucketsFor,
  distanceKind,
  earliestDate,
  FATIGUE_DAYS,
  FITNESS_DAYS,
  fitnessSeries,
  formLabel,
  groupsFor,
  dataSources,
  loadSources,
  percentChange,
  RANGE_KEYS,
  RANGE_LABELS,
  RANGE_NAMES,
  rangeFor,
  seriesIn,
  totalsFor,
  type Bucket,
  type FitnessDay,
  type Group,
  type RangeKey,
  type Totals,
} from './analysis';
import { Methodology, methodologyHref, type MethodSection } from './MethodologyPage';
import { EventPage } from './EventPage';
import type { Catalog, Write } from './WorkoutEditor';
import { StrengthPage } from './StrengthPage';

const KIND_DISTANCE: Record<string, string> = {
  run: 'Run distance', ride: 'Ride distance', swim: 'Swim distance', walk: 'Walk distance', hike: 'Hike distance',
};

/** "0.0 mi", or "0 yd" for swims: the distance tile's unit with nothing in it. */
function noDistance(kind: string, miles: boolean): string {
  if (kind === 'swim') return miles ? '0 yd' : '0 m';
  return miles ? '0.0 mi' : '0.0 km';
}

export { activityHref };

/**
 * The Analysis section. Overview is its first page: everything the member
 * trained over a chosen range, beside the range before it. Event follows the
 * member's goal event; Methodology explains every figure.
 */
export type AnalysisPageKey = 'overview' | 'strength' | 'event' | 'methodology';

export function AnalysisPage({ state, page, section, write, busy, catalog, retryCatalog }: {
  state: StateResponse;
  page: AnalysisPageKey;
  section: MethodSection | null;
  write: Write;
  busy: boolean;
  catalog: Catalog;
  retryCatalog: () => void;
}) {
  const today = useMemo(() => localToday(), []);
  const miles = useMemo(() => prefersMiles(), []);
  const entries = useMemo(() => buildHistory(state, today, miles), [state, today, miles]);
  const [rangeKey, setRangeKey] = useState<RangeKey>(() => storedRange() ?? '12w');
  const [compare, setCompare] = useState(true);
  const range = useMemo(() => rangeFor(rangeKey, today, earliestDate(entries)), [rangeKey, today, entries]);
  const comparing = compare && range.previous !== null;

  function chooseRange(key: RangeKey) {
    setRangeKey(key);
    try { localStorage.setItem(RANGE_STORAGE, key); } catch { /* private window: keep it for this visit only */ }
  }

  return (
    <div className="analysis-page">
      <nav className="analysis-side" aria-label="Analysis">
        <p className="analysis-side-label">Analysis</p>
        <a href="#analysis" aria-current={page === 'overview' ? 'page' : undefined}>Overview</a>
        <a href="#analysis/strength" aria-current={page === 'strength' ? 'page' : undefined}>Strength</a>
        <a href="#analysis/event" aria-current={page === 'event' ? 'page' : undefined}>Event</a>
        <p className="analysis-side-label">About</p>
        <a href={methodologyHref()} aria-current={page === 'methodology' ? 'page' : undefined}>Methodology</a>
      </nav>
      <main className="analysis-main">
        {page === 'strength' ? <StrengthPage state={state} catalog={catalog} retryCatalog={retryCatalog} today={today} />
        : page === 'methodology' ? <Methodology section={section} /> : page === 'event' ? (
          <EventPage state={state} entries={entries} today={today} miles={miles} write={write} busy={busy} />
        ) : <>
        <div className="analysis-head">
          <div>
            <h1>Overview</h1>
            <p className="muted analysis-sub">{rangeText(range.from, range.to)} · everything you trained</p>
          </div>
          <div className="analysis-range">
            <div className="an-pills" role="group" aria-label="Range">
              {RANGE_KEYS.map((key) => (
                <button key={key} type="button" aria-pressed={key === rangeKey} onClick={() => chooseRange(key)}
                  title={key === 'all' ? 'All time' : `The last ${RANGE_NAMES[key]}`}>
                  {RANGE_LABELS[key]}
                </button>
              ))}
            </div>
            {range.previous && (
              <label className="compare-toggle">
                <input type="checkbox" checked={compare} onChange={(e) => setCompare(e.target.checked)} />
                Compare with the {RANGE_NAMES[rangeKey]} before
              </label>
            )}
          </div>
        </div>

        {entries.length === 0 ? (
          <section className="analysis-card">
            <h2>Nothing to look at yet</h2>
            <p className="muted">Finish a workout in the iPhone app, record a run, or connect Apple Health or intervals.icu, and your training shows up here.</p>
          </section>
        ) : (
          <Overview state={state} entries={entries} range={range} comparing={comparing} today={today} miles={miles} />
        )}
        </>}
      </main>
    </div>
  );
}

const RANGE_STORAGE = 'tf.analysis.range';

function storedRange(): RangeKey | null {
  try {
    const value = localStorage.getItem(RANGE_STORAGE);
    return RANGE_KEYS.includes(value as RangeKey) ? (value as RangeKey) : null;
  } catch {
    return null;
  }
}

function Overview({ state, entries, range, comparing, today, miles }: {
  state: StateResponse;
  entries: Entry[];
  range: ReturnType<typeof rangeFor>;
  comparing: boolean;
  today: string;
  miles: boolean;
}) {
  const current = useMemo(() => totalsFor(entries, state.sets, range.from, range.to), [entries, state.sets, range]);
  const previous = useMemo(
    () => (comparing && range.previous ? totalsFor(entries, state.sets, range.previous.from, range.previous.to) : null),
    [entries, state.sets, range, comparing],
  );
  const series = useMemo(() => fitnessSeries(entries, today), [entries, today]);
  const shown = useMemo(() => seriesIn(series, range), [series, range]);
  const sources = useMemo(() => loadSources(entries, range), [entries, range]);
  const counted = useMemo(() => dataSources(entries, range, comparing), [entries, range, comparing]);
  const weekly = useMemo(() => bucketsFor(entries, range), [entries, range]);
  const groups = useMemo(() => groupsFor(entries, state, range), [entries, state, range]);
  const byDate = useMemo(() => {
    const out = new Map<string, Entry[]>();
    for (const e of entries) out.set(e.date, [...(out.get(e.date) ?? []), e]);
    return out;
  }, [entries]);
  const firstLoad = series[0]?.date ?? null;
  const onlyStrength = current.workingSets > 0 && !entries.some(entry => entry.date >= range.from && entry.date <= range.to && entry.family !== 'strength');

  return (
    <>
      <Tiles current={current} previous={previous} miles={miles} />
      {counted.length > 0 && <p className="analysis-attribution analysis-sources">Includes sessions from {listText(counted)}.</p>}

      {current.workingSets > 0 && <section className="analysis-card" aria-labelledby="strength-overview-title">
        <h2 id="strength-overview-title">Strength progress</h2>
        <p>Review your lifts, reps and holds, with the exact logged set behind each result.</p>
        <a href="#analysis/strength">Explore strength progress</a>
      </section>}

      {(shown.length > 0 || !onlyStrength) && <section className="analysis-card" aria-labelledby="fitness-title">
        <div className="analysis-card-head">
          <h2 id="fitness-title">Fitness, fatigue and form</h2>
          {shown.length > 0 && (
            <ul className="legend" aria-label="Lines">
              <li><span className="line-swatch fitness" aria-hidden="true" />Fitness ({FITNESS_DAYS}-day)</li>
              <li><span className="line-swatch fatigue" aria-hidden="true" />Fatigue ({FATIGUE_DAYS}-day)</li>
              <li><span className="swatch load" aria-hidden="true" />Day’s load</li>
            </ul>
          )}
        </div>
        <p className="muted analysis-caption">
          Built from each session’s training load. Fitness is your average daily load over about six weeks, fatigue over about one week, and form is the gap between them. Lifting workouts have no load yet, so they aren’t in these lines.{' '}
<a href={methodologyHref('fitness')}>How this is calculated</a>
        </p>
        {shown.length === 0 ? (
          <p className="analysis-empty">
            Nothing in this range has a training load yet. Runs, rides and sports get one from heart rate, power or pace once your thresholds are set in the iPhone app (Profile, then Training thresholds), or from intervals.icu.
          </p>
        ) : (
          <>
            {firstLoad && firstLoad > addDays(range.from, -FITNESS_DAYS) && (
              <p className="analysis-note">Your first load is from {shortDate(firstLoad)}, so fitness is still filling in: it takes about six weeks of history to settle.</p>
            )}
            <FitnessChart days={shown} byDate={byDate} miles={miles} />
            {sources.length > 0 && (
              <p className="analysis-attribution">Load from {listText(sources)}.</p>
            )}
          </>
        )}
      </section>}

      <section className="analysis-card" aria-labelledby="time-title">
        <div className="analysis-card-head">
          <h2 id="time-title">Training time by {weekly.unit}</h2>
          <ul className="legend" aria-label="Kinds">
            {FAMILIES.filter((f) => weekly.buckets.some((b) => (b.seconds[f] ?? 0) > 0))
              .map((f) => <li key={f}><span className={`swatch fam-${f}`} aria-hidden="true" />{FAMILY_LABELS[f]}</li>)}
          </ul>
        </div>
        <TimeChart buckets={weekly.buckets} unit={weekly.unit} />
      </section>

      <section className="analysis-card" aria-labelledby="groups-title">
        <div className="analysis-card-head">
          <h2 id="groups-title">Where the time went</h2>
          {comparing && <span className="muted analysis-key"><span className="prev-mark" aria-hidden="true" /> the {RANGE_NAMES[range.key]} before</span>}
        </div>
        <GroupBars groups={groups} comparing={comparing} />
      </section>

      <p className="analysis-footnote muted">
        Every figure on this page is worked out as the <a href={methodologyHref()}>Methodology</a> page describes.
      </p>
    </>
  );
}

// ---- tiles ----------------------------------------------------------------

function Tiles({ current, previous, miles }: { current: Totals; previous: Totals | null; miles: boolean }) {
  const kind = distanceKind(current, previous);
  const tiles: { title: string; value: string; change: ReactNode; note?: string }[] = [
    {
      title: 'Training time',
      value: formatDuration(current.seconds),
      change: previous && <Change text={signedDuration(current.seconds - previous.seconds)} pct={percentChange(current.seconds, previous.seconds)} />,
    },
    {
      title: 'Sessions',
      value: String(current.sessions),
      change: previous && <Change text={signed(current.sessions - previous.sessions)} pct={null} />,
    },
  ];
  if (kind) {
    const now = current.meters.get(kind) ?? 0;
    const before = previous?.meters.get(kind) ?? 0;
    tiles.push({
      title: KIND_DISTANCE[kind] ?? 'Distance',
      value: formatActivityDistance(now, kind, miles) ?? noDistance(kind, miles),
      change: previous && <Change text={signedDistance(now - before, kind, miles)} pct={percentChange(now, before)} />,
    });
  }
  tiles.push({
    title: 'Training load',
    value: current.load === null ? '—' : Math.round(current.load).toLocaleString('en-US'),
    // A period with no known load has no number to compare: unknown is
    // never a drop to zero.
    change: previous && current.load !== null && previous.load !== null
      ? <Change text={signed(Math.round(current.load - previous.load))} pct={percentChange(current.load, previous.load)} />
      : <span>{current.scored} {current.scored === 1 ? 'session' : 'sessions'} scored{previous ? `, ${previous.scored} before` : ''}</span>,
    note: estimatedNote(current),
  });
  tiles.push({
    title: 'Working sets',
    value: current.workingSets.toLocaleString('en-US'),
    change: previous && <Change text={signed(current.workingSets - previous.workingSets)} pct={percentChange(current.workingSets, previous.workingSets)} />,
  });
  return (
    <section className="analysis-tiles" aria-label="Totals">
      {tiles.map((t) => (
        <div key={t.title} className="analysis-tile">
          <span className="analysis-tile-title">{t.title}</span>
          <span className="analysis-tile-value">{t.value}</span>
          {t.change && <span className="analysis-tile-change">{t.change}</span>}
          {t.note && <span className="analysis-tile-change">{t.note}</span>}
        </div>
      ))}
    </section>
  );
}

/** "2 estimated from effort ratings": which part of a load total is an estimate. */
function estimatedNote(totals: Totals): string | undefined {
  if (totals.estimated === 0) return undefined;
  if (totals.estimated === totals.scored) return totals.scored === 1 ? 'Estimated from your effort rating' : 'All estimated from effort ratings';
  return `${totals.estimated} ${totals.estimated === 1 ? 'session' : 'sessions'} estimated from effort ratings`;
}

function Change({ text, pct }: { text: string; pct: string | null }) {
  return <><b>{text}</b>{pct && pct !== 'same' ? ` (${pct})` : ''} vs before</>;
}

const signed = (n: number) => (n > 0 ? `+${n.toLocaleString('en-US')}` : n < 0 ? `−${Math.abs(n).toLocaleString('en-US')}` : '±0');
const signedDuration = (s: number) => (Math.abs(s) < 60 ? '±0m' : `${s > 0 ? '+' : '−'}${formatDuration(Math.abs(s))}`);
function signedDistance(meters: number, kind: string, miles: boolean): string {
  const text = formatActivityDistance(Math.abs(meters), kind, miles);
  if (!text || text.startsWith('0.0 ') || text.startsWith('0 ')) return `±0 ${noDistance(kind, miles).split(' ')[1]}`;
  return `${meters > 0 ? '+' : '−'}${text}`;
}

// ---- fitness chart --------------------------------------------------------

const CHART_LEFT = 40;
const CHART_RIGHT = 96;

function FitnessChart({ days, byDate, miles }: { days: FitnessDay[]; byDate: Map<string, Entry[]>; miles: boolean }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [active, setActive] = useState<number | null>(null);
  const [pinned, setPinned] = useState(false);
  const shownIndex = active ?? null;
  const W = Math.max(width, 320);
  const H = 240;
  const FORM_H = 110;
  const top = 10;
  const bottom = 24;
  const plotW = W - CHART_LEFT - CHART_RIGHT;
  const highest = Math.max(...days.map((d) => Math.max(d.load, d.fitness, d.fatigue)), 10);
  const step = niceCeiling(highest / 4);
  const ceiling = step * Math.ceil(highest / step);
  const steps = Array.from({ length: Math.round(ceiling / step) + 1 }, (_, k) => k);
  const x = (i: number) => CHART_LEFT + (days.length === 1 ? plotW / 2 : (plotW * i) / (days.length - 1));
  const y = (v: number) => top + (H - top - bottom) * (1 - v / ceiling);
  const formLimit = niceCeiling(Math.max(20, ...days.map((d) => Math.abs(d.form))));
  const fy = (v: number) => 12 + (FORM_H - 22) * (1 - (v + formLimit) / (2 * formLimit));
  const barW = Math.max(1.5, Math.min(6, plotW / days.length - 1));
  const path = (pick: (d: FitnessDay) => number, scale: (v: number) => number) =>
    days.map((d, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${scale(pick(d)).toFixed(1)}`).join('');
  const last = days[days.length - 1]!;
  const ticks = dateTicks(days.map((d) => d.date), Math.max(2, Math.floor(plotW / 110)));
  // Line-end labels must not overlap.
  let fitY = y(last.fitness) + 4;
  let fatY = y(last.fatigue) + 4;
  if (Math.abs(fitY - fatY) < 14) {
    if (fitY <= fatY) fatY = fitY + 14; else fitY = fatY + 14;
  }

  function indexAt(event: MouseEvent<SVGElement>) {
    const box = (event.currentTarget as SVGElement).getBoundingClientRect();
    const px = event.clientX - box.left;
    const i = Math.round(((px - CHART_LEFT) / plotW) * (days.length - 1));
    return Math.min(days.length - 1, Math.max(0, i));
  }
  function onKey(event: KeyboardEvent) {
    const from = active ?? days.length - 1;
    if (event.key === 'ArrowLeft') { setActive(Math.max(0, from - 1)); event.preventDefault(); }
    else if (event.key === 'ArrowRight') { setActive(Math.min(days.length - 1, from + 1)); event.preventDefault(); }
    else if (event.key === 'Home') { setActive(0); event.preventDefault(); }
    else if (event.key === 'End') { setActive(days.length - 1); event.preventDefault(); }
    else if (event.key === 'Enter' && active !== null) setPinned((p) => !p);
    else if (event.key === 'Escape') { setActive(null); setPinned(false); }
  }

  const day = shownIndex !== null ? days[shownIndex] : null;
  const sessions = day ? (byDate.get(day.date) ?? []) : [];
  const tipLeft = shownIndex !== null && x(shownIndex) > W - 260 ? x(shownIndex) - 250 : (shownIndex !== null ? x(shownIndex) + 14 : 0);

  return (
    <div className="an-chart" ref={ref}>
      <svg width={W} height={H} role="img" tabIndex={0} onKeyDown={onKey}
        aria-label={`Fitness ${Math.round(last.fitness)}, fatigue ${Math.round(last.fatigue)}, form ${Math.round(last.form)} (${formLabel(last.form)}) on ${shortDate(last.date)}. Use the left and right arrow keys to read each day.`}
        onPointerMove={(e) => { if (!pinned) setActive(indexAt(e)); }}
        onPointerLeave={() => { if (!pinned) setActive(null); }}
        onClick={(e) => { const i = indexAt(e); if (pinned && i === active) setPinned(false); else { setActive(i); setPinned(true); } }}>
        {steps.map((k) => (
          <g key={k}>
            <line className="grid-line" x1={CHART_LEFT} x2={W - CHART_RIGHT} y1={y(step * k)} y2={y(step * k)} />
            <text className="axis" x={CHART_LEFT - 8} y={y(step * k) + 4} textAnchor="end">{Math.round(step * k)}</text>
          </g>
        ))}
        {days.map((d, i) => d.load > 0 ? (
          <rect key={d.date} className="load-bar" x={x(i) - barW / 2} y={y(d.load)} width={barW} height={Math.max(1, y(0) - y(d.load))} rx={Math.min(2, barW / 2)} />
        ) : null)}
        <path className="line-fitness" d={path((d) => d.fitness, y)} />
        <path className="line-fatigue" d={path((d) => d.fatigue, y)} />
        <text className="end-label" x={W - CHART_RIGHT + 8} y={fitY}>Fitness {Math.round(last.fitness)}</text>
        <text className="end-label" x={W - CHART_RIGHT + 8} y={fatY}>Fatigue {Math.round(last.fatigue)}</text>
        {ticks.map((i) => <text key={i} className="axis" x={x(i)} y={H - 6} textAnchor="middle">{shortDate(days[i]!.date)}</text>)}
        {shownIndex !== null && day && (
          <g aria-hidden="true">
            <line className="crosshair" x1={x(shownIndex)} x2={x(shownIndex)} y1={top} y2={H - bottom} />
            <circle className="dot-fitness" cx={x(shownIndex)} cy={y(day.fitness)} r={5} />
            <circle className="dot-fatigue" cx={x(shownIndex)} cy={y(day.fatigue)} r={5} />
          </g>
        )}
      </svg>
      <svg width={W} height={FORM_H} aria-hidden="true" className="form-chart"
        onPointerMove={(e) => { if (!pinned) setActive(indexAt(e)); }}
        onPointerLeave={() => { if (!pinned) setActive(null); }}>
        <rect className="band-fresh" x={CHART_LEFT} y={fy(formLimit)} width={plotW} height={fy(5) - fy(formLimit)} />
        <rect className="band-building" x={CHART_LEFT} y={fy(-10)} width={plotW} height={fy(-formLimit) - fy(-10)} />
        <line className="zero-line" x1={CHART_LEFT} x2={W - CHART_RIGHT} y1={fy(0)} y2={fy(0)} />
        {[-formLimit / 2, 0, formLimit / 2].map((v) => <text key={v} className="axis" x={CHART_LEFT - 8} y={fy(v) + 4} textAnchor="end">{Math.round(v)}</text>)}
        <text className="axis strong" x={CHART_LEFT + 6} y={10}>FORM</text>
        <path className="line-form" d={path((d) => d.form, fy)} />
        <text className="end-label" x={W - CHART_RIGHT + 8} y={fy(formLimit / 2) + 4}>Fresh</text>
        <text className="end-label" x={W - CHART_RIGHT + 8} y={fy(-formLimit / 2) + 4}>Building</text>
        {shownIndex !== null && <line className="crosshair" x1={x(shownIndex)} x2={x(shownIndex)} y1={4} y2={FORM_H - 4} />}
      </svg>
      {day && (
        <div className={`an-tip${pinned ? ' pinned' : ''}`} style={{ left: tipLeft, top: 12 }} role={pinned ? 'dialog' : undefined} aria-label={pinned ? longDate(day.date) : undefined}>
          <div className="an-tip-when">{longDate(day.date)}</div>
          <div className="an-tip-row"><span>Fitness</span><span>{Math.round(day.fitness)}</span></div>
          <div className="an-tip-row"><span>Fatigue</span><span>{Math.round(day.fatigue)}</span></div>
          <div className="an-tip-row"><span>Form</span><span>{Math.round(day.form)} · {formLabel(day.form)}</span></div>
          {sessions.length > 0 ? (
            <ul className="an-tip-sessions">
              {sessions.map((s) => (
                <li key={s.key}>
                  {pinned ? <a href={activityHref(s)}>{s.title}</a> : s.title}
                  <span className="muted">{sessionFacts(s, miles)}</span>
                  {s.attribution && <span className="muted an-tip-source">{s.attribution}</span>}
                </li>
              ))}
            </ul>
          ) : <p className="muted an-tip-none">No sessions</p>}
          {!pinned && sessions.length > 0 && <p className="muted an-tip-hint">Click to open a session</p>}
        </div>
      )}
      <details className="an-table">
        <summary>Show as a table</summary>
        <table>
          <thead><tr><th scope="col">Week of</th><th scope="col">Load</th><th scope="col">Fitness</th><th scope="col">Fatigue</th><th scope="col">Form</th></tr></thead>
          <tbody>
            {weeklyRows(days).map((row) => (
              <tr key={row.date}>
                <th scope="row">{shortDate(row.date)}</th>
                <td>{Math.round(row.load)}</td>
                <td>{Math.round(row.fitness)}</td>
                <td>{Math.round(row.fatigue)}</td>
                <td>{Math.round(row.form)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}

/** The week's summed load, with fitness, fatigue and form at its last day. */
function weeklyRows(days: FitnessDay[]): FitnessDay[] {
  const rows: FitnessDay[] = [];
  for (let i = 0; i < days.length; i += 7) {
    const week = days.slice(i, i + 7);
    const end = week[week.length - 1]!;
    rows.push({ ...end, date: week[0]!.date, load: week.reduce((sum, d) => sum + d.load, 0) });
  }
  return rows;
}

function sessionFacts(entry: Entry, miles: boolean): string {
  const facts: string[] = [];
  if (entry.meters !== null && entry.activityKind) {
    const distance = formatActivityDistance(entry.meters, entry.activityKind, miles);
    if (distance) facts.push(distance);
  }
  if (entry.seconds > 0) facts.push(formatDuration(entry.seconds));
  // An effort rating's load is an estimate, never shown as a measured one.
  facts.push(entry.load === null ? 'no load' : `${entry.loadEstimated ? 'estimated load' : 'load'} ${entry.load}`);
  return ` · ${facts.join(' · ')}`;
}

// ---- time chart -----------------------------------------------------------

function TimeChart({ buckets, unit }: { buckets: Bucket[]; unit: 'week' | 'month' }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [active, setActive] = useState<number | null>(null);
  const W = Math.max(width, 320);
  const H = 220;
  const left = 40;
  const right = 8;
  const top = 10;
  const bottom = 24;
  const most = Math.max(...buckets.map((b) => totalSeconds(b.seconds)), 3600);
  const topHours = niceCeiling(most / 3600);
  const tickStep = topHours / (topHours <= 4 ? topHours : 3);
  const slot = (W - left - right) / buckets.length;
  const barW = Math.max(3, Math.min(48, slot * 0.6));
  const y = (s: number) => top + (H - top - bottom) * (1 - s / (topHours * 3600));
  const labelEvery = Math.max(1, Math.ceil(buckets.length / Math.max(2, Math.floor((W - left - right) / 70))));
  const activeBucket = active !== null ? buckets[active] : null;
  const tipLeft = active !== null ? (left + slot * (active + 0.5) > W - 240 ? left + slot * (active + 0.5) - 236 : left + slot * (active + 0.5) + 16) : 0;
  const ticks: number[] = [];
  for (let h = 0; h <= topHours + 1e-9; h += tickStep) ticks.push(h);

  function onKey(event: KeyboardEvent) {
    const from = active ?? buckets.length - 1;
    if (event.key === 'ArrowLeft') { setActive(Math.max(0, from - 1)); event.preventDefault(); }
    else if (event.key === 'ArrowRight') { setActive(Math.min(buckets.length - 1, from + 1)); event.preventDefault(); }
    else if (event.key === 'Escape') setActive(null);
  }

  return (
    <div className="an-chart" ref={ref}>
      <svg width={W} height={H} role="img" tabIndex={0} onKeyDown={onKey} onPointerLeave={() => setActive(null)}
        aria-label={`Training time by ${unit}. Use the left and right arrow keys to read each ${unit}.`}>
        {ticks.map((h) => (
          <g key={h}>
            <line className="grid-line" x1={left} x2={W - right} y1={y(h * 3600)} y2={y(h * 3600)} />
            <text className="axis" x={left - 8} y={y(h * 3600) + 4} textAnchor="end">{trimNumber(h)}h</text>
          </g>
        ))}
        {buckets.map((b, i) => {
          const cx = left + slot * i + (slot - barW) / 2;
          let base = 0;
          return (
            <g key={b.start} onPointerEnter={() => setActive(i)}>
              <rect className="hit" x={left + slot * i} y={top} width={slot} height={H - top - bottom} />
              {FAMILIES.map((f) => {
                const s = b.seconds[f] ?? 0;
                if (s <= 0) return null;
                const y0 = y(base);
                base += s;
                const y1 = y(base);
                return <rect key={f} className={`bar fam-fill-${f}`} x={cx} y={y1 + 1} width={barW} height={Math.max(1, y0 - y1 - 2)} rx={Math.min(3, barW / 2)} />;
              })}
              {(b.current || (i % labelEvery === 0 && buckets.length - 1 - i >= labelEvery)) && (
                <text className={`axis${b.current ? ' strong' : ''}`} x={cx + barW / 2} y={H - 6} textAnchor="middle">
                  {b.current ? (unit === 'week' ? 'This week' : 'This month') : unit === 'week' ? shortDate(b.start) : monthLabel(b.start)}
                </text>
              )}
            </g>
          );
        })}
        {active !== null && <rect className="bar-focus" x={left + slot * active} y={top} width={slot} height={H - top - bottom} rx={4} />}
      </svg>
      {activeBucket && (
        <div className="an-tip" style={{ left: tipLeft, top: 16 }}>
          <div className="an-tip-when">{unit === 'week' ? `Week of ${shortDate(activeBucket.start)}` : monthLabel(activeBucket.start, true)}</div>
          {FAMILIES.filter((f) => (activeBucket.seconds[f] ?? 0) > 0).map((f) => (
            <div key={f} className="an-tip-row"><span>{FAMILY_LABELS[f]}</span><span>{formatDuration(activeBucket.seconds[f]!)}</span></div>
          ))}
          <div className="an-tip-row total"><span>Total</span><span>{formatDuration(totalSeconds(activeBucket.seconds))}</span></div>
          <p className="muted an-tip-none">{activeBucket.sessions} {activeBucket.sessions === 1 ? 'session' : 'sessions'}</p>
        </div>
      )}
      <details className="an-table">
        <summary>Show as a table</summary>
        <table>
          <thead><tr><th scope="col">{unit === 'week' ? 'Week of' : 'Month'}</th>{FAMILIES.map((f) => <th key={f} scope="col">{FAMILY_LABELS[f]}</th>)}<th scope="col">Total</th><th scope="col">Sessions</th></tr></thead>
          <tbody>
            {buckets.map((b) => (
              <tr key={b.start}>
                <th scope="row">{unit === 'week' ? shortDate(b.start) : monthLabel(b.start, true)}</th>
                {FAMILIES.map((f) => <td key={f}>{formatDuration(b.seconds[f] ?? 0)}</td>)}
                <td>{formatDuration(totalSeconds(b.seconds))}</td>
                <td>{b.sessions}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}

// ---- groups ---------------------------------------------------------------

function GroupBars({ groups, comparing }: { groups: Group[]; comparing: boolean }) {
  const most = Math.max(...groups.map((g) => Math.max(g.seconds, comparing ? g.previousSeconds : 0)), 1);
  if (!groups.length) return <p className="analysis-empty">Nothing in this range.</p>;
  return (
    <ul className="an-groups">
      {groups.map((g) => {
        const change = g.seconds - g.previousSeconds;
        const spoken = `${g.label}: ${formatDuration(g.seconds)} over ${g.sessions} ${g.sessions === 1 ? 'session' : 'sessions'}`
          + (comparing ? `, ${Math.abs(change) < 60 ? 'the same as' : `${formatDuration(Math.abs(change))} ${change > 0 ? 'more than' : 'less than'}`} before` : '');
        return (
          <li key={g.label} aria-label={spoken} title={spoken}>
            <span className="an-group-name">{g.label}</span>
            <span className="an-group-track" aria-hidden="true">
              <span className={`an-group-fill fam-${g.family as Family}`} style={{ width: `${(g.seconds / most) * 100}%` }} />
              {comparing && g.previousSeconds > 0 && <span className="prev-mark" style={{ left: `${(g.previousSeconds / most) * 100}%` }} />}
            </span>
            <span className="an-group-num" aria-hidden="true">
              {formatDuration(g.seconds)}
              {comparing && <small> {Math.abs(change) < 60 ? '±0m' : `${change > 0 ? '+' : '−'}${formatDuration(Math.abs(change))}`}</small>}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

// ---- helpers --------------------------------------------------------------

function trimNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}
