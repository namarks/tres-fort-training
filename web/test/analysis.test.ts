import { describe, expect, it } from 'vitest';
import type { StateResponse } from '../src/api';
import type { Entry } from '../src/activity';
import type { SetLogRow } from '../../src/types';
import {
  buckets,
  distanceKind,
  earliestDate,
  fitnessSeries,
  formLabel,
  groupsFor,
  dataSources,
  loadSources,
  MOST_GROUPS,
  percentChange,
  rangeFor,
  seriesIn,
  totalsFor,
} from '../src/analysis';

const TODAY = '2026-11-07'; // a Saturday; its Monday is Nov 2

function entry(key: string, date: string, overrides: Partial<Entry> = {}): Entry {
  return {
    key, id: key.split(':')[1] ?? key, kind: 'activity', date, category: 'runs', family: 'endurance',
    title: 'Run', details: [], attribution: null, inProgress: false, seconds: 1800, meters: 5000,
    load: 40, activityKind: 'run', ...overrides,
  };
}

function set(id: string, sessionId: string, overrides: Partial<SetLogRow> = {}): SetLogRow {
  return {
    id, user_id: 'u1', session_id: sessionId, exercise_id: 'squat', template_exercise_id: null, set_index: 0,
    weight: 100, reps: 5, rpe: null, is_warmup: 0, notes: null, logged_at: 0, updated_at: 0, source: 'ios',
    duration_s: null, is_timed: 0, deleted_at: null, weight_unit: 'lb', ...overrides,
  };
}

const emptyState = (overrides: Partial<StateResponse> = {}): StateResponse => ({
  plan: null, plan_version: 0, sessions: [], sets: [], external_events: [], external_activities: [], activities: [], ...overrides,
});

describe('rangeFor', () => {
  it('ends today, starts on a Monday, and compares with the same days whole weeks earlier', () => {
    const range = rangeFor('4w', TODAY, '2025-01-01');
    expect(range).toEqual({
      key: '4w', from: '2026-10-12', to: TODAY,
      previous: { from: '2026-09-14', to: '2026-10-10' },
    });
    expect(rangeFor('12w', TODAY, null).from).toBe('2026-08-17');
    expect(rangeFor('1y', TODAY, null).previous?.to).toBe('2025-11-08');
  });

  it('starts all time on the first session’s Monday, with nothing to compare', () => {
    expect(rangeFor('all', TODAY, '2026-03-05')).toEqual({ key: 'all', from: '2026-03-02', to: TODAY, previous: null });
    expect(rangeFor('all', TODAY, null).from).toBe('2026-11-02');
  });

  it('finds the earliest date', () => {
    expect(earliestDate([entry('activity:a', '2026-10-01'), entry('activity:b', '2026-09-01')])).toBe('2026-09-01');
    expect(earliestDate([])).toBeNull();
  });
});

describe('totalsFor', () => {
  it('sums time, sessions, distance by kind, known loads and working sets in the range', () => {
    const entries = [
      entry('activity:r1', '2026-11-03'),
      entry('activity:r2', '2026-11-05', { load: null }),
      entry('activity:s1', '2026-11-04', { activityKind: 'swim', meters: 1000, family: 'endurance' }),
      entry('workout:w1', '2026-11-06', { kind: 'workout', family: 'strength', meters: null, load: null, activityKind: null, seconds: 2400 }),
      entry('activity:old', '2026-10-20'),
    ];
    const sets = [set('a', 'w1'), set('b', 'w1'), set('c', 'w1', { is_warmup: 1 }), set('d', 'w1', { deleted_at: 5 }), set('e', 'other')];
    const totals = totalsFor(entries, sets, '2026-11-02', TODAY);
    expect(totals.seconds).toBe(1800 * 3 + 2400);
    expect(totals.sessions).toBe(4);
    expect([...totals.meters]).toEqual([['run', 10000], ['swim', 1000]]);
    expect(totals.load).toBe(80);
    expect(totals.scored).toBe(2);
    expect(totals.workingSets).toBe(2);
  });

  it('counts loads estimated from an effort rating', () => {
    const totals = totalsFor([
      entry('activity:a', TODAY, { load: 30, loadEstimated: true }),
      entry('activity:b', TODAY, { load: 50 }),
    ], [], TODAY, TODAY);
    expect(totals).toMatchObject({ load: 80, scored: 2, estimated: 1 });
  });

  it('keeps load unknown when nothing has one', () => {
    expect(totalsFor([entry('activity:a', TODAY, { load: null })], [], TODAY, TODAY).load).toBeNull();
  });

  it('shows run distance when either period has runs, else rides', () => {
    const now = totalsFor([entry('activity:a', TODAY, { activityKind: 'ride', meters: 50000 })], [], TODAY, TODAY);
    const before = totalsFor([entry('activity:b', TODAY, { meters: 5000 })], [], TODAY, TODAY);
    expect(distanceKind(now, before)).toBe('run');
    expect(distanceKind(now, null)).toBe('ride');
    expect(distanceKind(totalsFor([], [], TODAY, TODAY), null)).toBeNull();
  });

  it('shows the distance of the kind with the most time, swims included', () => {
    const swims = totalsFor([
      entry('activity:s1', TODAY, { activityKind: 'swim', meters: 2500, seconds: 3600 }),
      entry('activity:k1', TODAY, { activityKind: 'walk', meters: 3200, seconds: 1800 }),
    ], [], TODAY, TODAY);
    expect(distanceKind(swims, null)).toBe('swim');
    const runs = totalsFor([entry('activity:r1', TODAY, { seconds: 5400 })], [], TODAY, TODAY);
    expect(distanceKind(swims, runs)).toBe('run');
  });

  it('describes the change as a percentage only when there is a base', () => {
    expect(percentChange(113, 100)).toBe('+13%');
    expect(percentChange(96, 100)).toBe('−4%');
    expect(percentChange(100, 100)).toBe('same');
    expect(percentChange(5, 0)).toBeNull();
  });
});

describe('buckets', () => {
  it('splits a range into Monday weeks by family, the last one ending today', () => {
    const range = rangeFor('4w', TODAY, null);
    const entries = [
      entry('activity:a', '2026-11-03'),
      entry('workout:w', '2026-11-03', { kind: 'workout', family: 'strength', seconds: 600 }),
      entry('activity:b', '2026-10-14', { family: 'sport', seconds: 900 }),
    ];
    const result = buckets(entries, range);
    expect(result.unit).toBe('week');
    expect(result.buckets.map((b) => b.start)).toEqual(['2026-10-12', '2026-10-19', '2026-10-26', '2026-11-02']);
    expect(result.buckets[3]).toMatchObject({ end: TODAY, current: true, sessions: 2, seconds: { endurance: 1800, strength: 600 } });
    expect(result.buckets[0]).toMatchObject({ end: '2026-10-18', current: false, seconds: { sport: 900 } });
  });

  it('uses months for long ranges', () => {
    const result = buckets([entry('activity:a', '2025-03-10')], rangeFor('all', TODAY, '2025-01-15'));
    expect(result.unit).toBe('month');
    expect(result.buckets[0]!.start).toBe('2025-01-01');
    expect(result.buckets[2]).toMatchObject({ start: '2025-03-01', end: '2025-03-31', sessions: 1 });
    expect(result.buckets.at(-1)).toMatchObject({ start: '2026-11-01', end: TODAY, current: true });
  });
});

describe('groupsFor', () => {
  it('names lifting, endurance kinds and sports, with the time before', () => {
    const state = emptyState({
      external_activities: [{ id: 'soccer1', sport: 'soccer' }, { id: 'yoga1', sport: 'yoga' }] as StateResponse['external_activities'],
      activities: [{ id: 'log1', type: 'pilates' }] as StateResponse['activities'],
    });
    const range = rangeFor('4w', TODAY, null);
    const entries = [
      entry('activity:r1', '2026-11-03', { seconds: 3000 }),
      entry('activity:r0', '2026-10-01', { seconds: 1000 }),
      entry('workout:w1', '2026-11-04', { kind: 'workout', family: 'strength', activityKind: null, seconds: 2000 }),
      entry('workout:w2', '2026-11-05', { kind: 'workout', family: 'endurance', activityKind: null, seconds: 1200 }),
      entry('activity:soccer1', '2026-11-02', { activityKind: 'other', family: 'sport', seconds: 4000 }),
      entry('logged:log1', '2026-11-01', { kind: 'logged', activityKind: null, family: 'sport', seconds: 600 }),
    ];
    const groups = groupsFor(entries, state, range);
    expect(groups.map((g) => [g.label, g.seconds, g.sessions, g.previousSeconds])).toEqual([
      ['Running', 4200, 2, 1000],
      ['Soccer', 4000, 1, 0],
      ['Lifting', 2000, 1, 0],
      ['Pilates', 600, 1, 0],
    ]);
  });

  it('folds the smallest groups into one', () => {
    const kinds = ['run', 'ride', 'swim', 'walk', 'hike', 'row', 'ski', 'elliptical'];
    const entries = kinds.map((kind, i) => entry(`activity:${kind}`, TODAY, { activityKind: kind, seconds: 1000 * (10 - i) }));
    const groups = groupsFor(entries, emptyState(), rangeFor('4w', TODAY, null));
    expect(groups).toHaveLength(MOST_GROUPS);
    expect(groups.at(-1)).toMatchObject({ label: 'Everything else', seconds: 5000 + 4000 + 3000, sessions: 3 });
  });
});

describe('fitnessSeries', () => {
  it('weights daily load over 42 and 7 days from the first load', () => {
    const series = fitnessSeries([
      entry('activity:a', '2026-11-01', { load: 70 }),
      entry('activity:b', '2026-11-01', { load: 30 }),
      entry('workout:w', '2026-10-01', { load: null }),
    ], '2026-11-03');
    expect(series.map((d) => d.date)).toEqual(['2026-11-01', '2026-11-02', '2026-11-03']);
    const k42 = 1 - Math.exp(-1 / 42);
    const k7 = 1 - Math.exp(-1 / 7);
    expect(series[0]!.load).toBe(100);
    expect(series[0]!.fitness).toBeCloseTo(100 * k42);
    expect(series[0]!.fatigue).toBeCloseTo(100 * k7);
    expect(series[2]!.fitness).toBeCloseTo(100 * k42 * (1 - k42) ** 2);
    expect(series[2]!.form).toBeCloseTo(series[2]!.fitness - series[2]!.fatigue);
  });

  it('is empty without loads, ignores future dates and trims to a range', () => {
    expect(fitnessSeries([entry('activity:a', TODAY, { load: null })], TODAY)).toEqual([]);
    expect(fitnessSeries([entry('activity:a', '2026-12-01')], TODAY)).toEqual([]);
    const series = fitnessSeries([entry('activity:a', '2026-09-01')], TODAY);
    expect(seriesIn(series, rangeFor('4w', TODAY, null))[0]!.date).toBe('2026-10-12');
  });

  it('names where the loads behind the lines came from, earlier ones too, most first', () => {
    const range = rangeFor('4w', TODAY, null);
    expect(loadSources([
      entry('activity:a', TODAY, { attribution: 'Zwift' }),
      entry('activity:b', TODAY, { attribution: 'Garmin Forerunner 945' }),
      entry('activity:c', '2026-06-01', { attribution: 'Garmin Forerunner 945' }),
      entry('activity:d', TODAY, { attribution: 'Apple Health', load: null }),
      entry('activity:e', '2026-12-01', { attribution: 'Polar' }),
    ], range)).toEqual(['Garmin Forerunner 945', 'Zwift']);
  });

  it('names the sources of every counted session, with or without a load', () => {
    const range = rangeFor('4w', TODAY, null);
    const entries = [
      entry('activity:a', TODAY, { attribution: 'Garmin Forerunner 945', load: null }),
      entry('activity:b', TODAY, { attribution: 'Zwift' }),
      entry('activity:c', TODAY, { attribution: 'Zwift' }),
      entry('activity:d', '2026-09-20', { attribution: 'Apple Health' }),
      entry('activity:e', '2026-01-01', { attribution: 'Polar' }),
    ];
    expect(dataSources(entries, range, false)).toEqual(['Zwift', 'Garmin Forerunner 945']);
    expect(dataSources(entries, range, true)).toEqual(['Zwift', 'Apple Health', 'Garmin Forerunner 945']);
  });

  it('labels form', () => {
    expect([12, 0, -20, -40].map(formLabel)).toEqual(['Fresh', 'Steady', 'Building', 'Heavy load']);
  });
});
