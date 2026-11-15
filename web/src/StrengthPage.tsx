import { useMemo, useState, type KeyboardEvent } from 'react';
import type { StateResponse } from './api';
import type { Catalog } from './WorkoutEditor';
import { RANGE_KEYS, RANGE_LABELS, rangeFor, type RangeKey } from './analysis';
import { longDate, niceCeiling, shortDate, useWidth } from './chartHelpers';
import { searchStrength, strengthHistory, strengthNumber, strengthSource, type StrengthExercise, type StrengthPoint, type StrengthSeries } from './strength';
import { workoutRecordHref } from './workoutRecord';

export function StrengthPage({ state, catalog, today, retryCatalog }: {
  state: StateResponse; catalog: Catalog; today: string; retryCatalog: () => void;
}) {
  const [query, setQuery] = useState(''), [selectedId, setSelectedId] = useState<string | null>(null);
  const [rangeKey, setRangeKey] = useState<RangeKey>('12w');
  const exercises = useMemo(() => strengthHistory(state, catalog.kind === 'ready' ? catalog.exercises : [], today), [state, catalog, today]);
  const matches = useMemo(() => searchStrength(exercises, query), [exercises, query]);
  const selected = matches.find(item => item.exercise.id === selectedId)
    ?? matches.find(item => item.inPlan && item.setCount > 0) ?? matches.find(item => item.setCount > 0) ?? matches[0];
  return <>
    <div className="analysis-head"><div><h1>Strength</h1><p className="muted analysis-sub">Your lifts, reps and holds over time.</p></div>
      <div className="an-pills" role="group" aria-label="Strength range">{RANGE_KEYS.map(key => <button type="button" key={key}
        aria-pressed={key === rangeKey} onClick={() => setRangeKey(key)}>{RANGE_LABELS[key]}</button>)}</div></div>
    {catalog.kind === 'loading' ? <p role="status">Loading your exercises…</p> : catalog.kind === 'error' ?
      <section className="analysis-card"><h2>Exercises could not load</h2><p>Load the exercise catalog to compare like-for-like sets.</p>
        <button type="button" className="ghost" onClick={retryCatalog}>Retry exercises</button></section> : <>
      <label className="field strength-search">Find an exercise<input type="search" aria-label="Find an exercise" value={query}
        placeholder="Name or alias" onChange={event => setQuery(event.target.value)} /></label>
      {exercises.length === 0 ? <section className="analysis-card"><h2>No strength history yet</h2>
        <p>Finish a lifting or timed workout in the iPhone app. Working sets from completed workouts appear here.</p>
        <a href="#workouts">Open workouts</a></section> : <div className="strength-layout">
        <aside className="strength-exercises" aria-label="Exercises">
          {[{ name: 'Current plan', rows: matches.filter(item => item.inPlan) }, { name: 'Past exercises', rows: matches.filter(item => !item.inPlan) }]
            .filter(group => group.rows.length > 0).map(group => <section key={group.name}><h2>{group.name}</h2>
              <ul>{group.rows.map(item => <li key={item.exercise.id}><button type="button" aria-pressed={item === selected}
                onClick={() => setSelectedId(item.exercise.id)}>{item.exercise.name}<span className="muted">{item.setCount} working {item.setCount === 1 ? 'set' : 'sets'}</span></button></li>)}</ul></section>)}
          {matches.length === 0 && <p role="status">No exercises match that name or alias.</p>}
        </aside>
        {selected && <ExerciseProgress key={selected.exercise.id} item={selected} today={today} rangeKey={rangeKey} />}
      </div>}
    </>}
    <p className="analysis-footnote muted">Only completed workouts through today count. Warm-ups and deleted sets are excluded. Each point is the best comparable working set on that date, including separate workouts on the same date. One date is a result, not a trend. Strength is not converted into training load.</p>
  </>;
}

function ExerciseProgress({ item, today, rangeKey }: { item: StrengthExercise; today: string; rangeKey: RangeKey }) {
  const [seriesId, setSeriesId] = useState<string | null>(null);
  const series = item.series.find(option => option.id === seriesId) ?? item.series[0];
  const range = rangeFor(rangeKey, today, series?.points[0]?.date ?? null);
  const points = series?.points.filter(point => point.date >= range.from && point.date <= range.to) ?? [];
  return <section className="analysis-card strength-progress" aria-label={`${item.exercise.name} progress`}>
    <h2>{item.exercise.name}</h2>
    {!series ? <p className="analysis-empty">No completed working sets for this exercise yet. Your current plan is ready to log in the iPhone app.</p> : <>
      <label className="field">Compare<select aria-label="Compare strength metric" value={series.id} onChange={event => setSeriesId(event.target.value)}>
        {item.series.map(option => <option key={option.id} value={option.id}>{option.title}</option>)}
      </select></label>
      <p className="muted analysis-caption">{series.estimate
        ? `Estimated 1RM uses the Epley formula: load × (1 + reps ÷ 30), rounded to one decimal. It is an estimate, not a tested maximum. Loads are converted to ${series.unit}, using the best set from your latest qualifying workout. ${item.exercise.load_mode === 'per_hand' ? 'The estimate is for one hand.' : ''}`
        : 'Reps and holds compare only the same exercise, load, unit and per-hand or per-side setup. Assistance and added load stay separate.'}</p>
      {points.length === 0 ? <p className="analysis-empty">No comparable completed sets in this range. Choose a wider range or another comparison.</p>
        : <StrengthChart key={`${series.id}:${rangeKey}`} series={series} points={points} item={item} />}
    </>}
  </section>;
}

function StrengthChart({ series, points, item }: { series: StrengthSeries; points: StrengthPoint[]; item: StrengthExercise }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [selectedDate, setSelectedDate] = useState(points.at(-1)!.date);
  const selected = points.some(point => point.date === selectedDate) ? points.findIndex(point => point.date === selectedDate) : points.length - 1;
  const selectIndex = (index: number) => setSelectedDate(points[Math.min(points.length - 1, Math.max(0, index))]!.date);
  const W = Math.max(260, width), H = 210, left = 40, right = 20, top = 15, bottom = 35;
  const max = niceCeiling(Math.max(...points.map(point => point.value)));
  const firstDate = Date.parse(points[0]!.date), lastDate = Date.parse(points.at(-1)!.date);
  const x = (index: number) => left + (W - left - right) * (points.length === 1 ? 0.5
    : (Date.parse(points[index]!.date) - firstDate) / (lastDate - firstDate));
  const y = (value: number) => top + (H - top - bottom) * (1 - value / max);
  const point = points[selected] ?? points.at(-1)!;
  const onKey = (event: KeyboardEvent) => {
    if (event.key === 'ArrowLeft') selectIndex(selected - 1);
    else if (event.key === 'ArrowRight') selectIndex(selected + 1);
    else if (event.key === 'Home') selectIndex(0);
    else if (event.key === 'End') selectIndex(points.length - 1);
    else return;
    event.preventDefault();
  };
  return <div ref={ref} className="strength-chart">
    <p><strong>{strengthNumber(point.value)} {series.unit}</strong> · {longDate(point.date)}{points.length === 1 ? ' · One recorded date' : ''}</p>
    {points.length > 1 && <><svg viewBox={`0 0 ${W} ${H}`} role="img" tabIndex={0} onKeyDown={onKey}
      aria-label={`${series.title}, ${points.length} recorded ${points.length === 1 ? 'date' : 'dates'}. Use left and right arrow keys to inspect source sets. Dates with no records are not plotted.`}>
      {[0, 0.5, 1].map(fraction => <g key={fraction}><line className="grid-line" x1={left} x2={W - right} y1={y(max * fraction)} y2={y(max * fraction)} />
        <text className="axis" x={left - 6} y={y(max * fraction) + 4} textAnchor="end">{strengthNumber(max * fraction)}</text></g>)}
      {points.length > 1 && <path className="line-fitness" d={points.map((p, index) => `${index ? 'L' : 'M'}${x(index)},${y(p.value)}`).join(' ')} />}
      {points.map((p, index) => <circle key={p.date} cx={x(index)} cy={y(p.value)} r={index === selected ? 6 : 4}
        className="dot-fitness" onClick={() => selectIndex(index)}><title>{`${longDate(p.date)}: ${strengthNumber(p.value)} ${series.unit}`}</title></circle>)}
      <text className="axis" x={left} y={H - 5}>{shortDate(points[0]!.date)}</text>
      {points.length > 1 && <text className="axis" x={W - right} y={H - 5} textAnchor="end">{shortDate(points.at(-1)!.date)}</text>}
    </svg>
    <div className="head-actions"><button type="button" className="ghost" disabled={selected === 0} onClick={() => selectIndex(selected - 1)}>Previous date</button>
      <button type="button" className="ghost" disabled={selected === points.length - 1} onClick={() => selectIndex(selected + 1)}>Next date</button></div></>}
    <div className="strength-source" aria-live="polite" data-source-set={point.set.id} data-source-session={point.session.id}>
      <h3>Source set</h3><p>{strengthSource(point, item.exercise)}</p>
      <p className="muted">{longDate(point.date)} · {point.workoutName} · Workout {(point.session.slot ?? 0) + 1} · Set {point.set.set_index}</p>
      <a href={workoutRecordHref(point.session.id)}>Open this workout record</a>
    </div>
    <details className="an-table"><summary>Show all source sets</summary><table>
      <thead><tr><th scope="col">Date</th><th scope="col">{series.title}</th><th scope="col">Source set</th></tr></thead>
      <tbody>{points.map(p => <tr key={p.date} data-source-set={p.set.id}><th scope="row">{longDate(p.date)}</th>
        <td>{strengthNumber(p.value)} {series.unit}</td><td><a href={workoutRecordHref(p.session.id)}>{strengthSource(p, item.exercise)} · {p.workoutName} · Workout {(p.session.slot ?? 0) + 1} · Set {p.set.set_index}</a></td></tr>)}</tbody>
    </table></details>
  </div>;
}
