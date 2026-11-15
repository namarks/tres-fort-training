import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { SessionRow, SetLogRow } from '../../src/types';
import type { StateResponse } from '../src/api';
import type { CatalogExercise } from '../src/editing';
import { searchStrength, strengthHistory, strengthSource } from '../src/strength';
import { selectedRecord, workoutCorrectionHref, workoutRecordHref } from '../src/workoutRecord';
import { hashFor, viewFromHash } from '../src/App';
import { StrengthPage } from '../src/StrengthPage';

const today = '2026-11-14';
function exercise(id = 'bench', overrides: Partial<CatalogExercise> = {}): CatalogExercise {
  return { id, name: id, modality: 'barbell', unit: 'kg', laterality: 'bilateral', load_mode: 'total',
    primary_muscle: 'chest', aliases: null, demo_slug: null, ...overrides };
}
function session(id: string, date = today, overrides: Partial<SessionRow> = {}): SessionRow {
  return { id, user_id: 'member', plan_id: 'plan', workout_id: 'workout', date, status: 'completed',
    slot: 0, attempt: 2, started_at: null, completed_at: null, perceived_fatigue: null, notes: null,
    created_at: 1, updated_at: 2, write_protocol: 'attempt-v1', ...overrides };
}
function set(id: string, session_id: string, overrides: Partial<SetLogRow> = {}): SetLogRow {
  return { id, session_id, user_id: 'member', exercise_id: 'bench', template_exercise_id: null, set_index: 1,
    weight: 100, weight_unit: 'lb', reps: 6, duration_s: null, is_timed: 0, is_warmup: 0, deleted_at: null,
    rpe: null, notes: null, logged_at: 10, updated_at: 10, source: 'ios', ...overrides };
}
function state(sessions: SessionRow[], sets: SetLogRow[]): StateResponse {
  return { plan: null, plan_version: 0, sessions, sets, external_events: [], external_activities: [] };
}

describe('strength daily evidence', () => {
  it('counts only live working sets from completed workouts through today', () => {
    const rows = state([session('done'), session('active', today, { status: 'in_progress' }), session('future', '2026-11-15'),
      session('discarded', today, { status: 'discarded' })], [set('valid', 'done'), set('warmup', 'done', { is_warmup: 1 }),
      set('deleted', 'done', { deleted_at: 1 }), set('active-set', 'active'), set('future-set', 'future'), set('gone', 'discarded')]);
    const history = strengthHistory(rows, [exercise()], today);
    expect(history[0]?.setCount).toBe(1);
    expect(history[0]?.series[0]?.points.map(point => point.set.id)).toEqual(['valid']);
  });

  it('uses latest eligible session winning-estimate unit and retains exact original mixed-unit source', () => {
    const rows = state([session('old', '2026-11-10'), session('new')], [set('old100lb', 'old'),
      set('new50kg', 'new', { weight: 50, weight_unit: 'kg', reps: 6, logged_at: 20 }),
      set('later-but-weaker-lb', 'new', { weight: 10, reps: 1, logged_at: 30 })]);
    const series = strengthHistory(rows, [exercise()], today)[0]!.series;
    expect(series[0]?.unit).toBe('kg');
    expect(series[0]?.points.map(point => [point.value, point.set.id])).toEqual([[54.4, 'old100lb'], [60, 'new50kg']]);
    expect(strengthSource(series[0]!.points[0]!, exercise())).toBe('100 lb × 6 reps');
    expect(series.filter(option => !option.estimate)).toHaveLength(3);
  });

  it('uses chronological session time before slot and ID for daily ties, independent of array order', () => {
    const sessions = [session('a', today, { started_at: 300, slot: 0 }), session('z', today, { started_at: 200, slot: 1 })];
    const sets = [set('a-source', 'a'), set('z-source', 'z')];
    const first = strengthHistory(state(sessions, sets), [exercise()], today)[0]!;
    const reversed = strengthHistory(state([...sessions].reverse(), [...sets].reverse()), [exercise()], today)[0]!;
    expect(first.series).toEqual(reversed.series);
    expect(first.series.every(option => option.points.length === 1 && option.points[0]?.session.id === 'a')).toBe(true);
  });

  it('uses completion time, then earliest working log across exercises for finishless ordering', () => {
    const sessions = [session('first', today, { completed_at: 200 }), session('second', today)];
    const rows = [set('first-source', 'first'), set('second-source', 'second', { logged_at: 400 }),
      set('earlier-other-lift', 'second', { exercise_id: 'curl', logged_at: 100 })];
    expect(strengthHistory(state(sessions, rows), [exercise()], today)[0]!.series[0]!.points[0]!.session.id).toBe('first');
  });

  it('keeps earliest equal set within a condition, later equal daily session, and exact additional-session identity', () => {
    const rows = state([session('primary', today, { started_at: 10 }), session('additional', today, { slot: 1, started_at: 20 })],
      [set('primary-best', 'primary'), set('additional-first', 'additional', { logged_at: 10 }),
        set('additional-later-tie', 'additional', { set_index: 3, logged_at: 20 })]);
    for (const series of strengthHistory(rows, [exercise()], today)[0]!.series) {
      expect(series.points[0]?.set.id).toBe('additional-first');
      expect(workoutRecordHref(series.points[0]!.session.id)).toBe('#activity/workout%3Aadditional');
    }
  });

  it('normalizes missing load units to lb and never merges rep comparisons across units or load', () => {
    const rows = state([session('s')], [set('old', 's', { weight_unit: undefined }),
      set('kg', 's', { weight_unit: 'kg' }), set('different-load', 's', { weight: 105 })]);
    const options = strengthHistory(rows, [exercise()], today)[0]!.series.filter(option => !option.estimate);
    expect(options.map(option => option.title).sort()).toEqual(['100 kg · Best reps', '100 lb · Best reps', '105 lb · Best reps']);
  });

  it('keeps bodyweight, added load, assistance and holds separate without unsupported estimates', () => {
    const ex = exercise('pullup', { modality: 'bw', laterality: 'unilateral', load_mode: 'per_hand' });
    const rows = state([session('s')], [set('bw', 's', { exercise_id: ex.id, weight: 0 }),
      set('bw-kg', 's', { exercise_id: ex.id, weight: 0, weight_unit: 'kg', reps: 8 }),
      set('assisted', 's', { exercise_id: ex.id, weight: -10 }), set('added', 's', { exercise_id: ex.id, weight: 10 }),
      set('hold', 's', { exercise_id: ex.id, weight: 0, is_timed: 1, duration_s: 45 })]);
    const options = strengthHistory(rows, [ex], today)[0]!.series;
    expect(options).toHaveLength(4);
    expect(options.every(option => !option.estimate)).toBe(true);
    expect(options.find(option => option.title === 'Bodyweight · Best reps per side')?.points[0]?.value).toBe(8);
    expect(options.some(option => option.title.includes('10 lb each hand assistance'))).toBe(true);
    expect(options.some(option => option.title.includes('10 lb each hand added'))).toBe(true);
  });

  it('uses the legacy timed fallback consistently for cohorts and source labels', () => {
    const timed = exercise('hold', { modality: 'timed', unit: 'sec' });
    const rows = state([session('s')], [set('legacy', 's', { exercise_id: timed.id, weight: 0, reps: 35, is_timed: undefined }),
      set('explicit-reps', 's', { exercise_id: timed.id, weight: 0, reps: 10, is_timed: 0 })]);
    const options = strengthHistory(rows, [timed], today)[0]!.series;
    const hold = options.find(option => option.unit === 's')!;
    expect(hold.points[0]?.value).toBe(35);
    expect(strengthSource(hold.points[0]!, timed)).toBe('Bodyweight × 35s');
    expect(options).toHaveLength(2);
  });

  it('keeps dumbbell estimates per hand without multiplying unilateral reps', () => {
    const ex = exercise('db', { modality: 'dumbbell', laterality: 'unilateral', load_mode: 'per_hand' });
    const row = strengthHistory(state([session('s')], [set('db-set', 's', { exercise_id: ex.id, weight: 20, reps: 6 })]), [ex], today)[0]!;
    expect(row.series[0]?.title).toBe('Estimated 1RM per hand');
    expect(row.series[0]?.points[0]?.value).toBe(24);
    expect(strengthSource(row.series[0]!.points[0]!, ex)).toBe('20 lb each hand × 6 reps per side');
  });

  it('searches old exercise aliases and only marks logged current-plan exercises', () => {
    const rows = state([session('s')], [set('historical', 's', { exercise_id: 'old' }), set('current', 's')]);
    rows.plan = { workouts: [{ id: 'workout', name: 'Press day', exercises: [{ exercise_id: 'bench' }, { exercise_id: 'unused' }] }] } as StateResponse['plan'];
    const catalog = [exercise(), exercise('old', { name: 'Incline Dumbbell Curl', aliases: '["old curl nickname"]' }), exercise('unused')];
    const history = strengthHistory(rows, catalog, today);
    expect(history).toHaveLength(2);
    expect(history.find(item => item.exercise.id === 'bench')?.inPlan).toBe(true);
    expect(searchStrength(history, 'OLD nickname').map(item => item.exercise.id)).toEqual(['old']);
    expect(history.find(item => item.exercise.id === 'old')?.inPlan).toBe(false);
  });
});

describe('strength routes and exact record handoff', () => {
  it('round-trips Strength and exact record links and fails closed for missing or malformed records', () => {
    expect(hashFor(viewFromHash('#analysis/strength'))).toBe('#analysis/strength');
    expect(viewFromHash(workoutRecordHref('additional'))).toEqual({ kind: 'activity', entryKey: 'workout:additional' });
    const entries = [{ key: 'workout:primary' }, { key: 'workout:additional' }];
    expect(selectedRecord(entries, null)).toBe(entries[0]);
    expect(selectedRecord(entries, 'workout:additional')).toBe(entries[1]);
    expect(selectedRecord(entries, 'workout:missing')).toBeNull();
    const invalid = viewFromHash('#activity/%bad');
    expect(invalid).toEqual({ kind: 'activity', entryKey: '%bad' });
  });

  it('names exact account/session/attempt/set and rejects unsupported or unsafe handoff targets', () => {
    const row = session('session_1');
    const url = new URL(workoutCorrectionHref('member', row, 'set-3')!);
    expect(url.protocol).toBe('tresfort:'); expect(url.hostname).toBe('workout-record');
    expect(Object.fromEntries(url.searchParams)).toEqual({ account: 'member', session: 'session_1', attempt: '2', set: 'set-3' });
    expect(workoutCorrectionHref('member', { ...row, attempt: 0 })).toContain('attempt=0');
    for (const change of [{ user_id: 'other' }, { status: 'in_progress' }, { attempt: -1 }, { attempt: 1.5 }, { id: 'not/a/session' }]) {
      expect(workoutCorrectionHref('member', { ...row, ...change })).toBeNull();
    }
    expect(workoutCorrectionHref('member', row, 'set&other=x')).toBeNull();
  });

  it('presents loading, retry, empty history, one-date evidence and its table accessibly', () => {
    const props = { state: state([], []), today, retryCatalog: () => undefined };
    const render = (catalog: Parameters<typeof StrengthPage>[0]['catalog'], current = props.state) =>
      renderToStaticMarkup(createElement(StrengthPage, { ...props, state: current, catalog }));
    expect(render({ kind: 'loading' })).toContain('Loading your exercises');
    expect(render({ kind: 'error' })).toContain('Retry exercises');
    expect(render({ kind: 'ready', exercises: [] })).toContain('No strength history yet');
    const html = render({ kind: 'ready', exercises: [exercise()] }, state([session('s')], [set('source', 's')]));
    expect(html).toContain('One recorded date'); expect(html).toContain('Show all source sets');
    expect(html).not.toContain('Previous date'); expect(html).not.toContain('<svg');
    expect(html).toContain('data-source-set="source"'); expect(html).toContain('Set 1');
    expect(html).toContain('Epley formula'); expect(html).toContain('not a tested maximum');
  });
});
