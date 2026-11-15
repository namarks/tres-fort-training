import { useEffect, useMemo, useRef, useState } from 'react';
import { fetchActivityRoute, fetchActivitySwim } from './api';
import { isEmptySwimView, swimView, type ActivitySwimResponse } from './swimDetail';
import type { StateActivity, StateResponse } from './api';
import type { CatalogExercise } from './editing';
import { RouteMap } from './RouteMapView';
import { drawRoute, loadMapKit, onMapKitFailure } from './mapkit';
import { ActivityCharts } from './ActivityChartsView';
import { WorkoutFeedback, type WorkoutFeedbackActions } from './WorkoutFeedbackEditor';
import { selectedRecord, workoutCorrectionHref } from './workoutRecord';
import { IPHONE_APP_URL } from './phonePlanning';
import { methodologyHref } from './MethodologyPage';
import { chartableActivities } from './activityCharts';
import { drawableSegments, routableActivityIds, routeOutline, type LatLon } from './routeMap';
import { formatLongDate, LOAD_METHOD_LABELS, activityLoad, localToday, prefersMiles } from './model';
import {
  averageWeekSeconds,
  buildHistory,
  byMonth,
  CATEGORY_LABELS,
  changeText,
  dayTitle,
  FAMILIES,
  FAMILY_LABELS,
  findHighlights,
  formatActivityDistance,
  formatDuration,
  formatPace,
  HIGHLIGHT_WINDOW_DAYS,
  loggedFacts,
  loggedLabel,
  presentCategories,
  runPace,
  sessionSets,
  summarize,
  totalSeconds,
  weekRange,
  whenText,
  activitySeconds,
  activityCardStats,
  byWeek,
  exerciseLines,
  findRecords,
  kindLabel,
  mayHaveRoute,
  totalsOf,
  totalsText,
  type Badge,
  type CardStat,
  type Category,
  type Entry,
  type Family,
  type Summary,
} from './activity';

const DAY_LETTERS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

/**
 * Everything the member has done, on one scrolling page, as the iPhone app's
 * Activity tab shows it: this week, highlights, the last eight weeks and the
 * whole history, with the chosen session's record beside it.
 */
export function ActivityPage({ state, catalog, initialKey = null, ...feedbackActions }: WorkoutFeedbackActions & {
  state: StateResponse;
  catalog: CatalogExercise[] | null;
  /** A session to open first (from `#activity/<key>`, as the Analysis page links). */
  initialKey?: string | null;
}) {
  const today = useMemo(() => localToday(), []);
  const miles = useMemo(() => prefersMiles(), []);
  const entries = useMemo(() => buildHistory(state, today, miles), [state, today, miles]);
  const summary = useMemo(() => summarize(entries, today), [entries, today]);
  const loaded = useMemo(() => {
    const modality = new Map((catalog ?? []).map((e) => [e.id, e.modality]));
    return (id: string) => modality.get(id) !== 'timed';
  }, [catalog]);
  const highlights = useMemo(() => findHighlights(
    entries, state.sets ?? [], new Map(state.sessions.map((s) => [s.id, s.date])), today, loaded,
  ), [entries, state.sets, state.sessions, today, loaded]);
  const names = useMemo(() => exerciseNames(state, catalog), [state, catalog]);
  const records = useMemo(() => findRecords(
    entries, state.sets, new Map(state.sessions.map((s) => [s.id, s.date])), loaded,
    (id) => names.get(id) ?? 'Exercise',
  ), [entries, state.sets, state.sessions, loaded, names]);
  const [category, setCategory] = useState<Category | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(initialKey);
  const detailRef = useRef<HTMLElement>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  useStickyOffset(toolbarRef);
  const categories = useMemo(() => presentCategories(entries), [entries]);
  const months = useMemo(() => byMonth(entries, category), [entries, category]);
  const selected = selectedRecord(entries, selectedKey);

  // An exact record link opens its detail on one-column screens, even when
  // the record is unavailable. A desktop keeps the chosen history card nearby.
  useEffect(() => {
    if (!initialKey) return;
    if (window.matchMedia('(max-width: 1000px)').matches) {
      detailRef.current?.scrollIntoView({ block: 'start' });
      return;
    }
    const card = [...document.querySelectorAll<HTMLElement>('[data-entry]')].find((node) => node.dataset.entry === initialKey);
    card?.scrollIntoView({ block: 'center' });
  }, [initialKey]);

  function jumpTo(month: string) {
    document.getElementById(`month-${month}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function select(key: string) {
    setSelectedKey(key);
    // One column on narrow screens: bring the record into view.
    if (window.matchMedia('(max-width: 1000px)').matches) detailRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  return (
    <main className="activity-page">
      <div className="activity-main">
        <h1>Activity</h1>
        <WeekCard summary={summary} miles={miles} />

        {(highlights.fastestRun || highlights.newBest || highlights.longestRun) && (
          <section className="activity-section" aria-labelledby="highlights-title">
            <div className="activity-section-head">
              <h2 id="highlights-title">Highlights</h2>
              <span className="muted">Last {HIGHLIGHT_WINDOW_DAYS} days · <a href={methodologyHref('records')}>How these are chosen</a></span>
            </div>
            <div className="highlights">
              {highlights.fastestRun && (
                <HighlightCard title="Fastest pace" value={runPace(highlights.fastestRun, miles)}
                  detail={`${highlights.fastestRun.entry.title} · ${dayTitle(highlights.fastestRun.entry.date)}`}
                  onOpen={() => select(highlights.fastestRun!.entry.key)} />
              )}
              {highlights.newBest && (
                <HighlightCard title="New best"
                  value={`${trim(highlights.newBest.weight)} ${highlights.newBest.unit} × ${highlights.newBest.reps}`}
                  detail={`${names.get(highlights.newBest.exerciseId) ?? 'Exercise'} · up from ${trim(highlights.newBest.previousWeight)} ${highlights.newBest.previousUnit}`}
                  onOpen={() => {
                    const key = `workout:${highlights.newBest!.sessionId}`;
                    if (entries.some((e) => e.key === key)) select(key);
                  }} />
              )}
              {highlights.longestRun && (
                <HighlightCard title="Longest run"
                  value={formatActivityDistance(highlights.longestRun.meters, 'run', miles) ?? ''}
                  detail={`${highlights.longestRun.entry.title} · ${dayTitle(highlights.longestRun.entry.date)}`}
                  onOpen={() => select(highlights.longestRun!.entry.key)} />
              )}
            </div>
          </section>
        )}

        {summary.weeks.some((w) => totalSeconds(w.seconds) > 0) && (
          <section className="activity-section" aria-labelledby="weeks-title">
            <div className="activity-section-head">
              <h2 id="weeks-title">Last {summary.weeks.length} weeks</h2>
            </div>
            <WeeksChart summary={summary} />
          </section>
        )}

        <section className="activity-section" aria-labelledby="history-title">
          <div className="activity-section-head">
            <h2 id="history-title">History</h2>
            <span className="muted">{entries.length} {entries.length === 1 ? 'session' : 'sessions'}</span>
          </div>
          {entries.length === 0 ? (
            <p className="muted">Nothing here yet. Workouts you finish, runs you record and activities you log show up here.</p>
          ) : (
            <>
              <div className="history-toolbar" ref={toolbarRef}>
                {categories.length > 1 && (
                  <div className="filters" role="group" aria-label="Show">
                    <button type="button" aria-pressed={category === null} onClick={() => setCategory(null)}>All</button>
                    {categories.map((c) => (
                      <button type="button" key={c} aria-pressed={category === c} onClick={() => setCategory(c)}>{CATEGORY_LABELS[c]}</button>
                    ))}
                  </div>
                )}
                {months.length > 1 && (
                  <label className="month-jump">
                    <span className="visually-hidden">Jump to month</span>
                    <select value="" onChange={(event) => jumpTo(event.target.value)} aria-label="Jump to month">
                      <option value="" disabled>Jump to month</option>
                      {months.map((m) => <option key={m.id} value={m.id}>{monthTitle(m.id)} ({m.entries.length})</option>)}
                    </select>
                  </label>
                )}
              </div>
              {months.map((month) => (
                <section key={month.id} className="history-month" id={`month-${month.id}`} aria-label={monthTitle(month.id)}>
                  <h3 className="month-head">
                    <span>{monthTitle(month.id)}</span>
                    <span className="month-totals">{totalsText(totalsOf(month.entries), miles)}</span>
                  </h3>
                  {byWeek(month.entries).map((week) => (
                    <div key={week.start} className="history-week">
                      <p className="week-divider">
                        <span>Week of {shortDate(week.start)}</span>
                        <span>{totalsText(totalsOf(week.entries), miles)}</span>
                      </p>
                      <ul className="history-cards">
                        {week.entries.map((entry) => (
                          <li key={entry.key} data-entry={entry.key}>
                            <HistoryCard entry={entry} state={state} today={today} miles={miles} names={names}
                              badges={records.get(entry.key) ?? []}
                              selected={entry.key === selected?.key} onSelect={() => select(entry.key)} />
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </section>
              ))}
              <BackToTop />
            </>
          )}
        </section>
      </div>

      <aside className="detail activity-detail" ref={detailRef} aria-labelledby="record-title">
        {selected
          ? <EntryRecord key={selected.key} entry={selected} state={state} today={today} miles={miles} names={names}
              badges={records.get(selected.key) ?? []} feedbackActions={feedbackActions} />
          : selectedKey !== null ? <><h2 id="record-title">Record unavailable</h2>
            <p>This record is no longer available. Choose a session from History to open its exact record.</p></>
          : <p className="muted" id="record-title">Choose a session to see its record.</p>}
      </aside>
    </main>
  );
}

function trim(value: number): string {
  return String(Math.round(value * 100) / 100);
}

function monthTitle(id: string): string {
  const [y, m] = id.split('-').map(Number) as [number, number];
  return new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}

/** Exercise names from the catalog, else from the plan's own slots. */
function exerciseNames(state: StateResponse, catalog: CatalogExercise[] | null): Map<string, string> {
  const names = new Map<string, string>();
  for (const w of state.plan?.workouts ?? []) for (const s of w.exercises) names.set(s.exercise_id, s.exercise_name);
  for (const e of catalog ?? []) names.set(e.id, e.name);
  return names;
}

// ---- this week -------------------------------------------------------------

function WeekCard({ summary, miles }: { summary: Summary; miles: boolean }) {
  const week = summary.weeks[summary.weeks.length - 1];
  const total = week ? totalSeconds(week.seconds) : 0;
  const first = summary.days[0]?.date;
  const last = summary.days[summary.days.length - 1]?.date;
  const strength = week?.seconds.strength ?? 0;
  const sessions = week?.sessions ?? 0;
  const distance = summary.distance
    ? formatActivityDistance(summary.distance.meters, summary.distance.kind, miles)
    : null;
  const stats: { value: string; caption: string }[] = [
    { value: String(sessions), caption: sessions === 1 ? 'session' : 'sessions' },
  ];
  if (distance && summary.distance) stats.push({ value: distance, caption: loggedLabel(summary.distance.kind).toLowerCase() });
  if (strength > 0) stats.push({ value: formatDuration(strength), caption: 'strength' });
  if (summary.load !== null) stats.push({ value: String(summary.load), caption: 'load' });
  const most = Math.max(1, ...summary.days.map((d) => totalSeconds(d.seconds)));
  const arrow = summary.changeSeconds >= 60 ? '↑' : summary.changeSeconds <= -60 ? '↓' : '=';

  return (
    <section className="week-card" aria-label="This week">
      <div className="week-card-head">
        <span className="week-card-title">This week{first && last ? ` · ${weekRange(first, last)}` : ''}</span>
        {summary.streak > 0 && <span className="streak">{summary.streak}-week streak</span>}
      </div>
      <p className="week-total" aria-label={`${formatDuration(total)} trained this week`}>
        <span className="week-total-value">{formatDuration(total)}</span> <span className="week-total-label">trained</span>
      </p>
      <dl className="week-stats">
        {stats.map((s) => (
          <div key={s.caption}><dt>{s.caption}</dt><dd>{s.value}</dd></div>
        ))}
      </dl>
      <ol className="week-bars" aria-label="Each day this week">
        {summary.days.map((day, i) => {
          const seconds = totalSeconds(day.seconds);
          const name = `${DAY_NAMES[i]}${day.isToday ? ', today' : ''}`;
          const spoken = day.isFuture ? `${name}: still to come`
            : day.sessions === 0 ? `${name}: rest`
            : `${name}: ${seconds > 0 ? `${formatDuration(seconds)}, ` : ''}${day.sessions} ${day.sessions === 1 ? 'session' : 'sessions'}`;
          return (
            <li key={day.date} aria-label={spoken} title={spoken}>
              <div className="week-bar-track">
                {seconds > 0 ? (
                  <div className="week-bar" style={{ height: `${Math.max(6, (seconds / most) * 100)}%` }}>
                    {[...FAMILIES].reverse().map((family) => (day.seconds[family] ?? 0) > 0 ? (
                      <span key={family} className={`fam-${family}`} style={{ flexGrow: day.seconds[family] }} />
                    ) : null)}
                  </div>
                ) : day.sessions > 0 ? (
                  <div className="week-bar unknown" />
                ) : (
                  <div className={`week-bar idle${day.isToday ? ' today' : ''}`} />
                )}
              </div>
              <span className={`week-letter${day.isToday ? ' today' : ''}`} aria-hidden="true">{DAY_LETTERS[i]}</span>
            </li>
          );
        })}
      </ol>
      {week && (week.sessions > 0 || summary.changeSeconds !== 0) && (
        <p className="week-change"><span aria-hidden="true">{arrow}</span> {changeText(summary.changeSeconds)}</p>
      )}
    </section>
  );
}

function HighlightCard({ title, value, detail, onOpen }: { title: string; value: string; detail: string; onOpen: () => void }) {
  return (
    <button type="button" className="highlight" onClick={onOpen}>
      <span className="highlight-title">{title}</span>
      <span className="highlight-value">{value}</span>
      <span className="muted highlight-detail">{detail}</span>
    </button>
  );
}

// ---- weeks -----------------------------------------------------------------

function WeeksChart({ summary }: { summary: Summary }) {
  const most = Math.max(...summary.weeks.map((w) => totalSeconds(w.seconds)), 1);
  // Whole hours on the scale, at least one.
  const topHours = Math.max(1, Math.ceil(most / 3600));
  const ticks = topHours <= 4 ? Array.from({ length: topHours + 1 }, (_, i) => i)
    : [0, Math.round(topHours / 2), topHours];
  const present = FAMILIES.filter((f) => summary.weeks.some((w) => (w.seconds[f] ?? 0) > 0));
  return (
    <div className="weeks-card">
      <p className="muted weeks-caption">Training time per week · average {formatDuration(averageWeekSeconds(summary))}</p>
      <div className="weeks-chart">
        <div className="weeks-ticks" aria-hidden="true">
          {[...ticks].reverse().map((h) => <span key={h}>{h}h</span>)}
        </div>
        <ol className="weeks-bars">
          {summary.weeks.map((week) => {
            const seconds = totalSeconds(week.seconds);
            const label = week.isCurrent ? 'This week' : dayTitle(week.start);
            const parts = FAMILIES.filter((f) => (week.seconds[f] ?? 0) > 0)
              .map((f) => `${FAMILY_LABELS[f]} ${formatDuration(week.seconds[f]!)}`);
            const spoken = `Week of ${label}: ${formatDuration(seconds)}${parts.length ? ` (${parts.join(', ')})` : ''}`;
            return (
              <li key={week.start} aria-label={spoken} title={spoken}>
                <div className="weeks-track">
                  <div className="weeks-bar" style={{ height: `${(seconds / (topHours * 3600)) * 100}%` }}>
                    {[...FAMILIES].reverse().map((family) => (week.seconds[family] ?? 0) > 0 ? (
                      <span key={family} className={`fam-${family}`} style={{ flexGrow: week.seconds[family] }} />
                    ) : null)}
                  </div>
                </div>
                <span className={`weeks-label${week.isCurrent ? ' current' : ''}`} aria-hidden="true">
                  {week.isCurrent ? 'This week' : shortDate(week.start)}
                </span>
              </li>
            );
          })}
        </ol>
      </div>
      <ul className="legend" aria-label="Kinds">
        {present.map((f: Family) => <li key={f}><span className={`swatch fam-${f}`} aria-hidden="true" />{FAMILY_LABELS[f]}</li>)}
      </ul>
    </div>
  );
}

function shortDate(date: string): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

// ---- history ---------------------------------------------------------------

/**
 * One session as a card: what it was, when, its headline numbers and, for a
 * run, ride or walk with a GPS track, its route; for a workout, each
 * exercise with its best set.
 */
function HistoryCard({ entry, state, today, miles, names, badges, selected, onSelect }: {
  entry: Entry;
  badges: Badge[];
  state: StateResponse;
  today: string;
  miles: boolean;
  names: Map<string, string>;
  selected: boolean;
  onSelect: () => void;
}) {
  const activity = entry.kind === 'activity' ? state.external_activities.find((a) => a.id === entry.id) : undefined;
  const logged = entry.kind === 'logged' ? (state.activities ?? []).find((a) => a.id === entry.id) : undefined;
  const stats: CardStat[] = activity ? activityCardStats(activity, miles)
    : logged ? loggedFacts(logged).map((f) => ({ ...f, label: f.label === 'Avg heart rate' ? 'Avg HR' : f.label }))
    : workoutStats(entry);
  const lines = entry.kind === 'workout' ? exerciseLines(state.sets, entry.id) : [];
  const shown = lines.slice(0, MAX_EXERCISE_LINES);
  return (
    <button type="button" className="history-card" aria-pressed={selected} onClick={onSelect}>
      <span className="history-card-main">
        <span className="history-card-kicker">
          <span className={`kind-mark fam-${entry.family}`} aria-hidden="true" />
          <span>{kindLabel(entry)}</span>
          <span aria-hidden="true">·</span>
          <span>{whenText(entry.date, today)}</span>
          {entry.attribution ? <span className="history-source">· {entry.attribution}</span> : null}
          {entry.inProgress ? <span className="in-progress">In progress</span> : null}
        </span>
        <span className="history-title">{entry.title}</span>
        <Badges badges={badges} />
        {stats.length > 0 && (
          <span className="card-stats">
            {stats.map((stat) => (
              <span key={stat.label} className="card-stat">
                <span className="card-stat-value">{stat.value}</span>
                <span className="card-stat-label">{stat.label}</span>
              </span>
            ))}
          </span>
        )}
        {shown.length > 0 && (
          <span className="card-exercises">
            {shown.map((line) => (
              <span key={line.exerciseId} className="card-exercise">
                <span className="card-exercise-name">{names.get(line.exerciseId) ?? 'Exercise'}</span>
                <span className="card-exercise-sets">{line.text}</span>
              </span>
            ))}
            {lines.length > shown.length ? <span className="muted card-more">+{lines.length - shown.length} more</span> : null}
          </span>
        )}
        {logged?.notes ? <span className="muted card-note">{logged.notes}</span> : null}
      </span>
      {activity && mayHaveRoute(activity) ? <RouteThumb activityId={activity.id} family={entry.family} /> : null}
    </button>
  );
}

const MAX_EXERCISE_LINES = 4;
const MAX_BADGES = 3;

/** Records the session set when it happened. */
function Badges({ badges }: { badges: Badge[] }) {
  if (!badges.length) return null;
  const shown = badges.slice(0, MAX_BADGES);
  return (
    <span className="badges">
      {shown.map((b) => (
        <span key={b.label} className={`badge tier-${b.tier}`}><span aria-hidden="true">★</span> {b.label}</span>
      ))}
      {badges.length > shown.length ? <span className="badge tier-recent">+{badges.length - shown.length} more</span> : null}
    </span>
  );
}

/** A workout's sets and time: its details are "6 sets" and, once finished, "35m". */
function workoutStats(entry: Entry): CardStat[] {
  const [sets, time] = entry.details;
  const stats: CardStat[] = [];
  if (sets) stats.push({ label: 'Logged', value: sets });
  if (time) stats.push({ label: 'Time', value: time });
  return stats;
}

/** Routes already fetched for cards, so scrolling back or filtering never refetches. */
const routeCache = new Map<string, Promise<LatLon[][]>>();

function cardRoute(activityId: string): Promise<LatLon[][]> {
  let found = routeCache.get(activityId);
  if (!found) {
    // A missing route (404) is kept as empty; a failed request is dropped so
    // a later card can retry once the network or provider is back.
    found = fetchActivityRoute(activityId).then((r) => (r ? drawableSegments(r.route) : [])).catch(() => {
      routeCache.delete(activityId);
      return [];
    });
    routeCache.set(activityId, found);
  }
  return found;
}

const THUMB_WIDTH = 168;
const THUMB_HEIGHT = 112;

/**
 * The route on the card: fetched once the card scrolls near the screen,
 * drawn as its shape at once, then on a muted Apple Maps picture like the
 * iPhone app's cards. The map lives only while the card is near the screen,
 * so a long history never holds hundreds of maps; the shape stays when maps
 * can't load. Nothing shows for an activity without a route.
 */
function RouteThumb({ activityId, family }: { activityId: string; family: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [segments, setSegments] = useState<LatLon[][] | null>(null);
  const [near, setNear] = useState(false);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    if (typeof IntersectionObserver === 'undefined') { setNear(true); return; }
    const observer = new IntersectionObserver((seen) => {
      const last = seen[seen.length - 1];
      if (last) setNear(last.isIntersecting);
    }, { rootMargin: '400px 0px' });
    observer.observe(element);
    return () => observer.disconnect();
  }, [activityId]);
  useEffect(() => {
    if (!near || segments !== null) return;
    let live = true;
    void cardRoute(activityId).then((found) => { if (live) setSegments(found); });
    return () => { live = false; };
  }, [activityId, near, segments]);
  if (segments !== null && segments.length === 0) return null;
  const paths = segments ? routeOutline(segments, THUMB_WIDTH, THUMB_HEIGHT, 14) : [];
  return (
    <span ref={ref} className={`route-thumb line-${family}${segments ? '' : ' loading'}`}>
      {paths.length > 0 && (
        <svg viewBox={`0 0 ${THUMB_WIDTH} ${THUMB_HEIGHT}`} role="img" aria-label="Route">
          {paths.map((d, i) => <path key={i} d={d} className="thumb-line" />)}
        </svg>
      )}
      {segments && segments.length > 0 && near ? <ThumbMap segments={segments} /> : null}
    </span>
  );
}

/** The route on a still, muted map over the card's shape. Removes itself
 * when MapKit can't load, leaving the shape. */
function ThumbMap({ segments }: { segments: LatLon[][] }) {
  const element = useRef<HTMLSpanElement>(null);
  const [failed, setFailed] = useState(false);
  const [drawn, setDrawn] = useState(false);
  useEffect(() => {
    const parent = element.current;
    if (failed || !parent) return;
    let cancelled = false;
    let map: ReturnType<typeof drawRoute> | null = null;
    const stopWatching = onMapKitFailure(() => setFailed(true));
    loadMapKit()
      .then((mapkit) => {
        if (cancelled) return;
        map = drawRoute(mapkit, parent, segments, 'thumbnail');
        setDrawn(true);
      })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => {
      cancelled = true;
      stopWatching();
      map?.map.destroy();
    };
  }, [segments, failed]);
  if (failed) return null;
  return <span ref={element} className={`thumb-map${drawn ? ' drawn' : ''}`} aria-hidden="true" />;
}

/** Keeps month headers just under the sticky filter bar, however tall it wraps. */
function useStickyOffset(ref: React.RefObject<HTMLElement>) {
  useEffect(() => {
    const element = ref.current;
    if (!element || typeof ResizeObserver === 'undefined') return;
    const set = () => document.documentElement.style.setProperty('--history-toolbar', `${element.offsetHeight}px`);
    set();
    const observer = new ResizeObserver(set);
    observer.observe(element);
    return () => observer.disconnect();
  });
}

/** A way back up once the summary has scrolled away. */
function BackToTop() {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const onScroll = () => setShown(window.scrollY > 900);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);
  if (!shown) return null;
  return (
    <button type="button" className="back-to-top" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}>
      <span aria-hidden="true">↑</span> This week
    </button>
  );
}

// ---- a swim's detail ---------------------------------------------------------

/** A swim's pool, lengths, strokes, SWOLF and sets (sport-activities P4),
 * fetched when its record opens. Nothing shows when none is kept. */
function SwimRecord({ activityId, miles }: { activityId: string; miles: boolean }) {
  const [loaded, setLoaded] = useState<{ id: string; swim: ActivitySwimResponse | null } | null>(null);
  useEffect(() => {
    let live = true;
    fetchActivitySwim(activityId)
      .then((swim) => { if (live) setLoaded({ id: activityId, swim }); })
      .catch(() => { if (live) setLoaded({ id: activityId, swim: null }); });
    return () => { live = false; };
  }, [activityId]);
  const swim = loaded?.id === activityId ? loaded.swim : null;
  if (!swim) return null;
  const view = swimView(swim, miles);
  if (isEmptySwimView(view)) return null;
  return (
    <section className="run-laps swim-detail" aria-label="Swim">
      <h4>Swim{view.place ? ` · ${view.place}` : ''}</h4>
      <Facts facts={view.facts} />
      {view.strokes ? <p className="muted">{view.strokes}</p> : null}
      {view.sets.length ? (
        <ol>
          {view.sets.map((set, i) => (
            <li key={i} className="run-lap recovery">
              <div className="run-lap-title">{set.title}</div>
              <div className="run-lap-figures">{set.figures}</div>
            </li>
          ))}
        </ol>
      ) : null}
    </section>
  );
}

// ---- one session's record -------------------------------------------------

function EntryRecord({ entry, state, today, miles, names, badges, feedbackActions }: {
  entry: Entry;
  badges: Badge[];
  state: StateResponse;
  today: string;
  miles: boolean;
  names: Map<string, string>;
  feedbackActions: WorkoutFeedbackActions;
}) {
  return (
    <>
      <h2 id="record-title">{entry.title}</h2>
      <p className="status-line">{entry.date === today ? 'Today' : formatLongDate(entry.date)}</p>
      {badges.length ? (
        <ul className="record-badges">
          {badges.map((b) => <li key={b.label} className={`badge tier-${b.tier}`}><span aria-hidden="true">★</span> {b.label}</li>)}
        </ul>
      ) : null}
      {entry.kind === 'activity' && <ActivityRecord entry={entry} state={state} miles={miles} />}
      {entry.kind === 'workout' && <WorkoutRecord entry={entry} state={state} names={names} feedbackActions={feedbackActions} />}
      {entry.kind === 'logged' && <LoggedRecord entry={entry} state={state} />}
    </>
  );
}

function Facts({ facts }: { facts: { label: string; value: string }[] }) {
  if (!facts.length) return null;
  return (
    <dl className="facts">
      {facts.map((f) => <div key={f.label}><dt>{f.label}</dt><dd>{f.value}</dd></div>)}
    </dl>
  );
}

function ActivityRecord({ entry, state, miles }: { entry: Entry; state: StateResponse; miles: boolean }) {
  const activity = state.external_activities.find((a) => a.id === entry.id);
  const routable = useMemo(() => routableActivityIds(state), [state]);
  const chartable = useMemo(() => chartableActivities(state), [state]);
  if (!activity) return null;
  return (
    <>
      <Facts facts={activityFacts(activity, miles)} />
      {activityLoad(activity) ? <p className="muted method-link"><a href={methodologyHref('load')}>How load is worked out</a></p> : null}
      {activity.source_attribution ? <p className="muted attribution">{activity.source_attribution}</p> : null}
      {activity.kind === 'swim' ? <SwimRecord activityId={activity.id} miles={miles} /> : null}
      {routable.has(activity.id) ? <RouteMap activityId={activity.id} label={`Route of ${entry.title}`} miles={miles} /> : null}
      {chartable.has(activity.id) ? <ActivityCharts activityId={activity.id} kind={chartable.get(activity.id)!} miles={miles} /> : null}
    </>
  );
}

export function activityFacts(activity: StateActivity, miles: boolean): { label: string; value: string }[] {
  const facts: { label: string; value: string }[] = [];
  const seconds = activitySeconds(activity);
  const distance = formatActivityDistance(activity.distance_m, activity.kind, miles);
  if (distance) facts.push({ label: 'Distance', value: distance });
  if (seconds > 0) facts.push({ label: 'Time', value: formatDuration(seconds) });
  const pace = formatPace({ ...activity, seconds }, miles);
  if (pace) facts.push({ label: activity.kind === 'ride' ? 'Speed' : 'Pace', value: pace });
  if (activity.average_hr) facts.push({ label: 'Avg heart rate', value: `${Math.round(activity.average_hr)} bpm` });
  if (activity.max_hr) facts.push({ label: 'Max heart rate', value: `${Math.round(activity.max_hr)} bpm` });
  if (activity.average_watts) facts.push({ label: 'Avg power', value: `${Math.round(activity.average_watts)} W` });
  if (activity.elevation_gain_m) {
    facts.push({ label: 'Climb', value: miles ? `${Math.round(activity.elevation_gain_m * 3.28084)} ft` : `${Math.round(activity.elevation_gain_m)} m` });
  }
  if (activity.calories) facts.push({ label: 'Calories', value: `${Math.round(activity.calories)} kcal` });
  const load = activityLoad(activity);
  if (load) {
    const method = load.method ? LOAD_METHOD_LABELS[load.method] : undefined;
    facts.push({ label: 'Load', value: `${Math.round(load.load)}${method ? ` (${method})` : ''}` });
  }
  if (activity.effort) facts.push({ label: 'Effort', value: `${activity.effort} of 10` });
  else if (activity.provider_effort) facts.push({ label: 'Apple Watch effort', value: `${activity.provider_effort} of 10` });
  return facts;
}

function WorkoutRecord({ entry, state, names, feedbackActions }: { entry: Entry; state: StateResponse; names: Map<string, string>; feedbackActions: WorkoutFeedbackActions }) {
  const groups = useMemo(() => sessionSets(state.sets, entry.id), [state.sets, entry.id]);
  const session = state.sessions.find((s) => s.id === entry.id);
  const correction = session ? workoutCorrectionHref(feedbackActions.accountId, session) : null;
  return (
    <>
      <Facts facts={entry.details.map((value, i) => ({ label: i === 0 ? 'Logged' : 'Time', value }))} />
      {entry.inProgress ? <p className="in-progress">In progress</p> : null}
      {session?.status === 'completed' ? <WorkoutFeedback session={session} {...feedbackActions} />
        : session?.notes ? <p className="note">{session.notes}</p> : null}
      {correction && <section className="panel" aria-label="Correct recorded sets">
        <a href={correction}>Correct sets in iPhone app</a>
        <p className="fine">On an iPhone with Très Fort installed, this opens this completed workout for review. Sign in with the same account. On a computer, open this page on your iPhone to correct sets.</p>
        <a href={IPHONE_APP_URL} target="_blank" rel="noopener noreferrer">Get the iPhone app</a>
      </section>}
      {groups.length ? (
        <ol className="slots record-sets">
          {groups.map((group) => (
            <li key={group.exerciseId}>
              <div className="slot-name">{names.get(group.exerciseId) ?? 'Exercise'}</div>
              <ol className="set-lines">
                {group.sets.map((set, index) => (
                  <li key={set.id} className={set.warmup ? 'warmup' : ''} data-record-set={set.id}>
                    {set.text}{set.warmup ? <span className="tag">Warm-up</span> : null}
                    {session && correction && workoutCorrectionHref(feedbackActions.accountId, session, set.id) &&
                      <a className="set-correction" href={workoutCorrectionHref(feedbackActions.accountId, session, set.id)!}>Correct set {state.sets?.find(row => row.id === set.id)?.set_index ?? index + 1} in iPhone app</a>}
                  </li>
                ))}
              </ol>
            </li>
          ))}
        </ol>
      ) : <p className="muted">No sets logged.</p>}
    </>
  );
}

function LoggedRecord({ entry, state }: { entry: Entry; state: StateResponse }) {
  const row = (state.activities ?? []).find((a) => a.id === entry.id);
  if (!row) return null;
  return (
    <>
      <Facts facts={[{ label: 'Kind', value: loggedLabel(row.type) }, ...loggedFacts(row)]} />
      {row.notes ? <p className="note">{row.notes}</p> : null}
      <p className="muted">Logged by hand.</p>
    </>
  );
}
