import { metricCohorts } from '../../src/metrics';
import type { SessionRow, SetLogRow } from '../../src/types';
import type { StateResponse } from './api';
import type { CatalogExercise } from './editing';

export interface StrengthPoint {
  date: string;
  value: number;
  session: SessionRow;
  chronologicalTime: number;
  workoutName: string;
  set: SetLogRow;
}
export interface StrengthSeries {
  id: string;
  title: string;
  unit: string;
  estimate: boolean;
  points: StrengthPoint[];
}
export interface StrengthExercise {
  exercise: CatalogExercise;
  inPlan: boolean;
  series: StrengthSeries[];
  setCount: number;
}

const round = (value: number) => Math.round(value * 10) / 10;
const lbPerKg = 1 / 0.45359237;
const compareID = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
export const strengthNumber = (value: number) => String(round(value));

/** Persisted logs own their unit. Zero is one load condition, not separate lb/kg histories. */
function normalizedSet(set: SetLogRow, exercise: CatalogExercise): SetLogRow {
  return { ...set, weight_unit: set.weight === 0 || set.weight_unit !== 'kg' ? 'lb' : 'kg',
    is_timed: set.is_timed ?? (exercise.modality === 'timed' ? 1 : 0) };
}

const chronological = (a: StrengthPoint, b: StrengthPoint) => a.date.localeCompare(b.date)
  || a.chronologicalTime - b.chronologicalTime || (a.session.slot ?? 0) - (b.session.slot ?? 0)
  || compareID(a.session.id, b.session.id) || compareID(a.set.id, b.set.id);

function dailyBest(points: StrengthPoint[]): StrengthPoint[] {
  const best = new Map<string, StrengthPoint>();
  // Equal daily results use the later session, matching native history.
  for (const point of [...points].sort(chronological)) {
    if (!best.has(point.date) || point.value >= best.get(point.date)!.value) best.set(point.date, point);
  }
  return [...best.values()].sort((a, b) => a.date.localeCompare(b.date));
}

export function strengthHistory(state: StateResponse, catalog: CatalogExercise[], today: string): StrengthExercise[] {
  const completed = new Map(state.sessions.filter(session => session.status === 'completed' && session.date <= today).map(session => [session.id, session]));
  const byExercise = new Map<string, SetLogRow[]>();
  const earliestLog = new Map<string, number>();
  for (const row of state.sets ?? []) {
    if (!completed.has(row.session_id) || row.deleted_at !== null || row.is_warmup !== 0) continue;
    const rows = byExercise.get(row.exercise_id) ?? [];
    rows.push(row); byExercise.set(row.exercise_id, rows);
    earliestLog.set(row.session_id, Math.min(earliestLog.get(row.session_id) ?? Infinity, row.logged_at));
  }
  const planned = new Set(state.plan?.workouts.filter(workout => !workout.archived_at && !workout.one_time_date)
    .flatMap(workout => workout.exercises.map(slot => slot.exercise_id)) ?? []);
  return catalog.filter(exercise => exercise.modality !== 'cardio' && byExercise.has(exercise.id))
    .map(exercise => {
      const rows = (byExercise.get(exercise.id) ?? []).map(row => normalizedSet(row, exercise))
        .sort((a, b) => a.logged_at - b.logged_at || a.set_index - b.set_index || compareID(a.id, b.id));
      // Set the zero-load fallback explicitly instead of inheriting catalog seconds/minutes/kg.
      const metricExercise = { ...exercise, unit: 'lb' };
      const point = (set: SetLogRow, value: number): StrengthPoint => {
        const session = completed.get(set.session_id)!;
        return { date: session.date, session, set, value,
          workoutName: state.plan?.workouts.find(workout => workout.id === session.workout_id)?.name
            ?? (session.kind === 'freestyle' ? 'Freestyle workout' : 'Workout'),
          chronologicalTime: session.started_at ?? session.completed_at ?? earliestLog.get(session.id) ?? 0 };
      };
      const sessionRows = new Map<string, SetLogRow[]>();
      for (const row of rows) sessionRows.set(row.session_id, [...(sessionRows.get(row.session_id) ?? []), row]);
      const cohorts = [...sessionRows.values()].flatMap(sets => metricCohorts(sets, metricExercise));
      const conditions = new Map<string, StrengthSeries>();
      for (const cohort of cohorts) {
        const side = exercise.laterality === 'unilateral' ? ' per side' : '';
        const option = conditions.get(cohort.key) ?? { id: cohort.key,
          title: `${loadLabel(cohort.weight, cohort.unit, exercise)} · Best ${cohort.is_timed ? 'hold' : 'reps'}${side}`,
          unit: cohort.is_timed ? 's' : 'reps', estimate: false, points: [] };
        option.points.push(point(cohort.top, cohort.best_duration_s ?? cohort.best_reps ?? 0));
        conditions.set(cohort.key, option);
      }
      const series: StrengthSeries[] = [...conditions.values()].map(option => ({ ...option, points: dailyBest(option.points) }))
        .sort((a, b) => (b.points.at(-1)?.date ?? '').localeCompare(a.points.at(-1)?.date ?? '') || a.title.localeCompare(b.title));
      // First pick each session's best estimate in physical units. The latest
      // qualifying session's winning set determines display units, as on iPhone.
      const bestEstimates = new Map<string, StrengthPoint>();
      for (const cohort of cohorts) {
        if (cohort.est_1rm === null) continue;
        const candidate = point(cohort.top, cohort.est_1rm), current = bestEstimates.get(candidate.session.id);
        const pounds = (p: StrengthPoint) => p.set.weight_unit === 'kg' ? p.value * lbPerKg : p.value;
        if (!current || pounds(candidate) > pounds(current) || (pounds(candidate) === pounds(current)
          && (candidate.set.logged_at > current.set.logged_at || (candidate.set.logged_at === current.set.logged_at && candidate.set.id > current.set.id)))) {
          bestEstimates.set(candidate.session.id, candidate);
        }
      }
      const estimates = [...bestEstimates.values()], latest = [...estimates].sort(chronological).at(-1);
      if (latest) {
        const unit = latest.set.weight_unit;
        series.unshift({ id: 'estimated-1rm', title: `Estimated 1RM${exercise.load_mode === 'per_hand' ? ' per hand' : ''}`,
          unit: `${unit}${exercise.load_mode === 'per_hand' ? ' each hand' : ''}`, estimate: true, points: dailyBest(estimates.map(p => ({ ...p,
            value: p.set.weight_unit === unit ? p.value : round(unit === 'kg' ? p.value / lbPerKg : p.value * lbPerKg) }))) });
      }
      return { exercise, inPlan: planned.has(exercise.id), series, setCount: rows.length };
    }).sort((a, b) => a.exercise.name.localeCompare(b.exercise.name));
}

export function searchStrength(rows: StrengthExercise[], query: string): StrengthExercise[] {
  const words = query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
  return rows.filter(({ exercise }) => words.every(word => `${exercise.name} ${exercise.aliases ?? ''}`.toLocaleLowerCase().includes(word)));
}

function loadLabel(weight: number, unit: string, exercise: CatalogExercise): string {
  if (weight === 0) return exercise.modality === 'bw' || exercise.modality === 'timed' ? 'Bodyweight' : 'No external load';
  const relative = weight < 0 ? ' assistance' : exercise.modality === 'bw' || exercise.modality === 'timed' ? ' added' : '';
  return `${strengthNumber(Math.abs(weight))} ${unit}${exercise.load_mode === 'per_hand' ? ' each hand' : ''}${relative}`;
}

export function strengthSource(point: StrengthPoint, exercise: CatalogExercise): string {
  const set = point.set;
  const measure = set.is_timed === 1 ? `${set.duration_s ?? set.reps}s` : `${set.reps} reps`;
  return `${loadLabel(set.weight, set.weight_unit, exercise)} × ${measure}${exercise.laterality === 'unilateral' ? ' per side' : ''}`;
}
