import { describe, expect, it } from 'vitest';
import type { StateActivity, StateResponse } from '../src/api';
import type { ActivityRow, SessionRow, SetLogRow } from '../../src/types';
import {
  activityCardStats,
  byWeek,
  exerciseLines,
  kindLabel,
  mayHaveRoute,
  totalsOf,
  totalsText,
  averageWeekSeconds,
  buildHistory,
  byMonth,
  changeText,
  describeSet,
  findHighlights,
  findRecords,
  formatActivityDistance,
  formatDuration,
  presentCategories,
  sessionSets,
  summarize,
  type Entry,
} from '../src/activity';
import type { Slot, Workout } from '../src/model';

const TODAY = '2026-11-07'; // a Saturday

function slot(exerciseId: string): Slot {
  return {
    id: `s-${exerciseId}`, workout_id: 'w', exercise_id: exerciseId, order_index: 0,
    target_sets: 1, target_reps: 1, target_reps_max: null, target_rpe: null,
    rest_seconds: 0, target_weight: null, target_weight_unit: 'lb', target_duration_s: null,
    progression: null, run_steps: null, cues: null, is_warmup: 0, created_at: 0, updated_at: 0,
    exercise_name: exerciseId, exercise_unit: 'lb', exercise_muscle: 'legs', exercise_modality: 'strength',
    exercise_laterality: 'bilateral', exercise_load_mode: 'total', exercise_demo_slug: null,
  };
}

function workout(id: string, name: string, exercises: Slot[]): Workout {
  return { id, plan_id: 'p1', name, day_label: null, order_index: 0, notes: null, created_at: 0, updated_at: 0, archived_at: null, exercises };
}

function session(id: string, date: string, overrides: Partial<SessionRow> = {}): SessionRow {
  return {
    id, user_id: 'u1', plan_id: 'p1', workout_id: 'lift', date, status: 'completed',
    started_at: Date.UTC(2026, 10, 1, 10), completed_at: Date.UTC(2026, 10, 1, 10, 45),
    perceived_fatigue: null, notes: null, created_at: 0, updated_at: 1, attempt: 1, write_protocol: 'attempt-v1',
    ...overrides,
  };
}

function activity(id: string, date: string, overrides: Partial<StateActivity> = {}): StateActivity {
  return {
    id, user_id: 'u1', source: 'intervals', external_id: id, date, kind: 'run', name: 'Run',
    moving_time_sec: 1800, elapsed_time_sec: 1900, distance_m: 5000, average_watts: null, weighted_avg_watts: null,
    average_hr: 150, max_hr: 170, training_load: 40, intensity: null, calories: null, elevation_gain_m: null,
    synced_at: 0, deleted_at: null, effective_load: 42, effective_intensity: null, load_method: 'heart_rate',
    ...overrides,
  } as StateActivity;
}

function set(id: string, sessionId: string, weight: number, reps: number, overrides: Partial<SetLogRow> = {}): SetLogRow {
  return {
    id, user_id: 'u1', session_id: sessionId, exercise_id: 'ex_squat', template_exercise_id: null, set_index: 0,
    weight, reps, rpe: null, is_warmup: 0, notes: null, logged_at: 0, updated_at: 0, source: 'ios',
    duration_s: null, is_timed: 0, deleted_at: null, weight_unit: 'lb',
    ...overrides,
  };
}

function logged(id: string, date: string, overrides: Partial<ActivityRow> = {}): ActivityRow {
  return {
    id, user_id: 'u1', date, type: 'soccer', title: null, duration_minutes: 60, duration_s: null,
    avg_hr: null, calories: null, notes: null, logged_at: 0, updated_at: 0, source: 'ios', deleted_at: null,
    ...overrides,
  };
}

function state(overrides: Partial<StateResponse> = {}): StateResponse {
  return {
    plan: {
      id: 'p1', user_id: 'u1', name: 'Plan', status: 'active', version: 1, meta: null, created_at: 0, updated_at: 0,
      schedule: { version: 1, week: { mon: null, tue: null, wed: null, thu: null, fri: null, sat: null, sun: null } },
      trips: [],
      workouts: [
        workout('lift', 'KB Strength A', [slot('ex_squat')]),
        workout('tempo', 'Tempo Run', [slot('ex_outdoor_run')]),
      ],
    },
    plan_version: 1,
    sessions: [],
    sets: [],
    external_events: [],
    external_activities: [],
    activities: [],
    ...overrides,
  };
}

describe('activity history', () => {
  it('lists workouts, activities and logged activities newest first', () => {
    const entries = buildHistory(state({
      sessions: [session('s1', '2026-11-03')],
      sets: [set('a', 's1', 100, 5), set('b', 's1', 100, 5)],
      external_activities: [activity('r1', '2026-11-05', { name: 'Easy Run' })],
      activities: [logged('l1', '2026-11-02')],
    }), TODAY, true);
    expect(entries.map((e) => e.key)).toEqual(['activity:r1', 'workout:s1', 'logged:l1']);
    expect(entries[1]).toMatchObject({ title: 'KB Strength A', family: 'strength', seconds: 2700, details: ['2 sets', '45m'] });
    expect(entries[0]).toMatchObject({ category: 'runs', family: 'endurance', load: 42, details: ['3.1 mi', '30m', '9:39 /mi'] });
    expect(entries[2]).toMatchObject({ title: 'Soccer', family: 'sport', category: 'other', seconds: 3600 });
  });

  it('marks a load estimated from an effort rating', () => {
    const entries = buildHistory(state({
      external_activities: [
        activity('r1', '2026-11-05'),
        activity('s1', '2026-11-04', { effective_load: 30, load_method: 'effort', training_load: null }),
      ],
    }), TODAY, true);
    expect(entries.map((e) => [e.key, e.load, e.loadEstimated])).toEqual([['activity:r1', 42, false], ['activity:s1', 30, true]]);
  });

  it('lists a finished run workout once, as its run', () => {
    const entries = buildHistory(state({
      sessions: [session('s1', '2026-11-05', { workout_id: 'tempo' })],
      external_activities: [activity('r1', '2026-11-05', { name: 'Tempo Run' })],
    }), TODAY, true);
    expect(entries.map((e) => e.key)).toEqual(['activity:r1']);
  });

  it('keeps a run workout without a recorded run, counted as endurance', () => {
    const entries = buildHistory(state({ sessions: [session('s1', '2026-11-05', { workout_id: 'tempo' })] }), TODAY, true);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.family).toBe('endurance');
  });

  it('skips removed, future, unstarted and empty in-progress records', () => {
    const entries = buildHistory(state({
      sessions: [
        session('s1', '2026-11-04', { status: 'in_progress' }),
        session('s2', '2026-11-04', { status: 'planned' }),
        session('s3', '2026-11-09'),
      ],
      external_activities: [activity('r1', '2026-11-05', { deleted_at: 5 }), activity('r2', '2026-11-08')],
      activities: [logged('l1', '2026-11-03', { deleted_at: 3 })],
    }), TODAY, true);
    expect(entries).toEqual([]);
  });

  it('shows an in-progress workout once it has sets, and never counts a workout left open for hours', () => {
    const entries = buildHistory(state({
      sessions: [
        session('s1', '2026-11-04', { status: 'in_progress' }),
        session('s2', '2026-11-03', { completed_at: Date.UTC(2026, 10, 1, 17) }),
      ],
      sets: [set('a', 's1', 100, 5)],
    }), TODAY, true);
    expect(entries[0]).toMatchObject({ key: 'workout:s1', inProgress: true, seconds: 0 });
    expect(entries[1]).toMatchObject({ key: 'workout:s2', seconds: 0, details: ['0 sets', '7h'] });
  });

  it('names a sport over the generic Workout title and shows swims in yards with pace per 100', () => {
    const entries = buildHistory(state({
      external_activities: [
        activity('a1', '2026-11-05', { kind: 'other', name: 'Workout', sport: 'tennis', distance_m: null }),
        activity('a2', '2026-11-04', { kind: 'swim', name: null, distance_m: 1000 }),
      ],
    }), TODAY, true);
    expect(entries[0]!.title).toBe('Tennis');
    expect(entries[1]).toMatchObject({ title: 'Swim', details: ['1,094 yd', '30m', '2:45 /100yd'] });
  });

  it('groups by month and filters by kind', () => {
    const entries = buildHistory(state({
      external_activities: [activity('r1', '2026-11-05'), activity('r2', '2026-10-20', { kind: 'ride', name: 'Zwift' })],
      activities: [logged('l1', '2026-10-01')],
    }), TODAY, false);
    expect(presentCategories(entries)).toEqual(['runs', 'rides', 'other']);
    expect(byMonth(entries).map((m) => [m.id, m.entries.length])).toEqual([['2026-11', 1], ['2026-10', 2]]);
    expect(byMonth(entries, 'rides').map((m) => m.id)).toEqual(['2026-10']);
  });
});

function entry(date: string, overrides: Partial<Entry> = {}): Entry {
  return {
    key: `activity:${date}`, id: date, kind: 'activity', date, category: 'runs', family: 'endurance', title: 'Run',
    details: [], attribution: null, inProgress: false, seconds: 1800, meters: 5000, load: 40, activityKind: 'run',
    ...overrides,
  };
}

describe('activity summary', () => {
  it('sums this week by day and kind, with distance and load', () => {
    const summary = summarize([
      entry('2026-11-07', { key: 'a' }),
      entry('2026-11-03', { key: 'b', family: 'strength', kind: 'workout', meters: null, load: null, activityKind: null, seconds: 2700 }),
      entry('2026-11-02', { key: 'c', activityKind: 'ride', meters: 20000, seconds: 3600 }),
    ], TODAY);
    expect(summary.days.map((d) => d.date)).toEqual([
      '2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06', '2026-11-07', '2026-11-08',
    ]);
    expect(summary.days[6]!.isFuture).toBe(true);
    expect(summary.days[1]!.seconds).toEqual({ strength: 2700 });
    expect(summary.weeks.at(-1)).toMatchObject({ start: '2026-11-02', end: TODAY, sessions: 3, isCurrent: true });
    expect(summary.distance).toEqual({ meters: 20000, kind: 'ride' });
    expect(summary.load).toBe(80);
  });

  it('shows a swim week\'s distance, by the kind with the most time', () => {
    const summary = summarize([
      entry('2026-11-03', { key: 's1', activityKind: 'swim', meters: 2500, seconds: 3600 }),
      entry('2026-11-05', { key: 'w1', activityKind: 'walk', meters: 3200, seconds: 1800 }),
    ], TODAY);
    expect(summary.distance).toEqual({ meters: 2500, kind: 'swim' });
  });

  it('leaves load unknown when nothing this week has one', () => {
    expect(summarize([entry('2026-11-05', { load: null })], TODAY).load).toBeNull();
  });

  it('counts the streak, keeping it while this week is still empty', () => {
    const entries = [entry('2026-10-28'), entry('2026-10-20'), entry('2026-10-05')];
    expect(summarize(entries, TODAY).streak).toBe(2);
    expect(summarize([entry('2026-11-03'), ...entries], TODAY).streak).toBe(3);
  });

  it('compares with last week up to the same weekday', () => {
    const summary = summarize([
      entry('2026-11-04', { seconds: 3600 }),
      entry('2026-10-28', { seconds: 1200 }),
      entry('2026-11-01', { seconds: 9000 }), // last Sunday, after the same weekday
    ], TODAY);
    expect(summary.changeSeconds).toBe(2400);
    expect(changeText(summary.changeSeconds)).toBe('40m more than this time last week');
    expect(changeText(-30)).toBe('Same as this time last week');
    expect(averageWeekSeconds(summary)).toBe(Math.floor((1200 + 9000) / 7));
  });
});

describe('highlights', () => {
  it('finds the fastest run of a mile or more and the longest run', () => {
    const entries = [
      entry('2026-11-05', { key: 'fast', meters: 4800, seconds: 1080 }),
      entry('2026-11-04', { key: 'sprint', meters: 400, seconds: 60 }),
      entry('2026-11-01', { key: 'long', meters: 16000, seconds: 5400 }),
      entry('2026-09-01', { key: 'old', meters: 30000, seconds: 6000 }),
    ];
    const found = findHighlights(entries, [], new Map(), TODAY);
    expect(found.fastestRun?.entry.key).toBe('fast');
    expect(found.longestRun?.entry.key).toBe('long');
  });

  it('finds a new heaviest working set as a physical load across units', () => {
    const dates = new Map([['old', '2026-09-01'], ['new', '2026-11-05'], ['newer', '2026-11-06']]);
    const found = findHighlights([], [
      set('a', 'old', 100, 5, { weight_unit: 'kg' }),
      set('b', 'new', 210, 5),       // 210 lb < 100 kg (220 lb): not a best
      set('c', 'newer', 105, 3, { weight_unit: 'kg' }),
      set('d', 'newer', 300, 5, { is_warmup: 1 }),
    ], dates, TODAY);
    expect(found.newBest).toMatchObject({ sessionId: 'newer', weight: 105, unit: 'kg', previousWeight: 100, previousUnit: 'kg' });
  });

  it('never calls a first-ever set a best, and skips timed exercises', () => {
    const dates = new Map([['s', '2026-11-05'], ['t', '2026-11-06']]);
    expect(findHighlights([], [set('a', 's', 100, 5)], dates, TODAY).newBest).toBeNull();
    const timed = findHighlights([], [set('a', 's', 10, 1), set('b', 't', 20, 1)], dates, TODAY, () => false);
    expect(timed.newBest).toBeNull();
  });
});

describe('formatting', () => {
  it('formats durations, distances and sets', () => {
    expect(formatDuration(8100)).toBe('2h 15m');
    expect(formatDuration(3600)).toBe('1h');
    expect(formatDuration(59)).toBe('0m');
    expect(formatActivityDistance(5000, 'run', false)).toBe('5.0 km');
    expect(formatActivityDistance(0, 'run', true)).toBeNull();
    expect(describeSet(set('a', 's', 22.5, 8, { weight_unit: 'kg', rpe: 8 }))).toBe('22.5 kg × 8 · RPE 8');
    expect(describeSet(set('a', 's', 0, 12))).toBe('12 reps');
    expect(describeSet(set('a', 's', 0, 0, { is_timed: 1, duration_s: 45 }))).toBe('0:45');
  });

  it('groups a session’s live sets by exercise in logged order', () => {
    const groups = sessionSets([
      set('a', 's', 100, 5, { logged_at: 1 }),
      set('b', 's', 50, 10, { logged_at: 2, exercise_id: 'ex_row' }),
      set('c', 's', 105, 5, { logged_at: 3 }),
      set('d', 's', 110, 5, { logged_at: 4, deleted_at: 9 }),
      set('e', 'other', 1, 1),
    ], 's');
    expect(groups.map((g) => [g.exerciseId, g.sets.map((s) => s.text)])).toEqual([
      ['ex_squat', ['100 lb × 5', '105 lb × 5']],
      ['ex_row', ['50 lb × 10']],
    ]);
  });
});

describe('history cards', () => {
  it('names each kind in a word', () => {
    expect(kindLabel(entry('2026-11-05'))).toBe('Run');
    expect(kindLabel(entry('2026-11-05', { category: 'workouts' }))).toBe('Workout');
    expect(kindLabel(entry('2026-11-05', { category: 'other', family: 'sport' }))).toBe('Sport');
  });

  it('shows an activity’s distance, time, pace, heart rate and load', () => {
    expect(activityCardStats(activity('r', '2026-11-05'), true)).toEqual([
      { label: 'Distance', value: '3.1 mi' },
      { label: 'Time', value: '30m' },
      { label: 'Pace', value: '9:39 /mi' },
      { label: 'Avg HR', value: '150 bpm' },
      { label: 'Load', value: '42' },
    ]);
    const rated = activityCardStats(activity('s', '2026-11-05', { effective_load: 30, load_method: 'effort', training_load: null }), true);
    expect(rated.at(-1)).toEqual({ label: 'Est. load', value: '30' });
  });

  it('sums each exercise’s working sets and finds its best set across units', () => {
    expect(exerciseLines([
      set('w', 's', 20, 10, { is_warmup: 1, logged_at: 0 }),
      set('a', 's', 100, 5, { logged_at: 1 }),
      set('b', 's', 50, 5, { logged_at: 2, weight_unit: 'kg' }),
      set('c', 's', 0, 12, { logged_at: 3, exercise_id: 'ex_pushup' }),
      set('d', 's', 0, 10, { logged_at: 4, exercise_id: 'ex_pushup' }),
      set('e', 's', 0, 0, { logged_at: 5, exercise_id: 'ex_plank', is_timed: 1, duration_s: 60 }),
    ], 's')).toEqual([
      { exerciseId: 'ex_squat', text: '2 sets · best 50 kg × 5' },
      { exerciseId: 'ex_pushup', text: '2 sets · 22 reps' },
      { exerciseId: 'ex_plank', text: '1 set · up to 1:00' },
    ]);
  });

  it('looks for a route on runs, rides and walks from a route source, and on swims, with a distance', () => {
    expect(mayHaveRoute(activity('r', '2026-11-05'))).toBe(true);
    expect(mayHaveRoute(activity('r', '2026-11-05', { kind: 'ride', source: 'healthkit' }))).toBe(true);
    // A swim from any source: its Apple Health route can sit behind the copy shown.
    expect(mayHaveRoute(activity('r', '2026-11-05', { kind: 'swim' }))).toBe(true);
    expect(mayHaveRoute(activity('r', '2026-11-05', { kind: 'swim', source: 'fit' }))).toBe(true);
    expect(mayHaveRoute(activity('r', '2026-11-05', { kind: 'swim', distance_m: 0 }))).toBe(false);
    expect(mayHaveRoute(activity('r', '2026-11-05', { source: 'fit' }))).toBe(false);
    expect(mayHaveRoute(activity('r', '2026-11-05', { distance_m: null }))).toBe(false);
  });

  it('totals a month or week and splits a month by week', () => {
    const entries = [
      entry('2026-11-05', { key: 'a', meters: 5000, seconds: 1800 }),
      entry('2026-11-02', { key: 'b', activityKind: null, meters: null, seconds: 3600 }),
      entry('2026-11-01', { key: 'c', meters: 3000, seconds: 900 }),
    ];
    expect(totalsText(totalsOf(entries), true)).toBe('3 sessions · 1h 45m · 5.0 mi run');
    expect(totalsText(totalsOf([entry('2026-11-05', { activityKind: null, seconds: 0 })]), true)).toBe('1 session');
    expect(byWeek(entries).map((w) => [w.start, w.entries.length])).toEqual([['2026-11-02', 2], ['2026-10-26', 1]]);
  });
});

describe('record badges', () => {
  const run = (key: string, date: string, meters: number, seconds = 1800) => entry(date, { key, meters, seconds });
  const labels = (found: Map<string, { label: string; tier: string }[]>, key: string) => (found.get(key) ?? []).map((b) => `${b.tier}:${b.label}`);
  const none = () => true;
  const name = (id: string) => (id === 'ex_squat' ? 'Goblet Squat' : id);

  it('calls out the longest run yet as of its own date, never a first-ever run', () => {
    const found = findRecords([
      run('r1', '2026-01-10', 5000, 1500),
      run('r2', '2026-02-10', 8000, 2700),
      run('r3', '2026-03-10', 6000, 2100),
    ], [], new Map(), none, name);
    expect(labels(found, 'r1')).toEqual([]);
    expect(labels(found, 'r2')).toEqual(['all:Longest run yet']);
    expect(labels(found, 'r3')).toEqual([]);
  });

  it('calls out the longest in 90 days only with three earlier runs in that window', () => {
    const early = [run('big', '2026-01-01', 20000, 7200), run('a', '2026-09-01', 5000), run('b', '2026-09-15', 5200)];
    const twoBefore = findRecords([...early, run('x', '2026-10-01', 9000, 3600)], [], new Map(), none, name);
    expect(labels(twoBefore, 'x')).toEqual([]);
    const threeBefore = findRecords([...early, run('c', '2026-09-20', 5100), run('x', '2026-10-01', 9000, 3600)], [], new Map(), none, name);
    expect(labels(threeBefore, 'x')).toEqual(['recent:Longest run in 90 days']);
  });

  it('calls out the fastest run only for a mile or more', () => {
    const found = findRecords([
      run('r1', '2026-01-10', 5000, 1800),
      run('short', '2026-01-12', 1000, 180),
      run('fast', '2026-01-14', 3000, 900),
    ], [], new Map(), none, name);
    expect(labels(found, 'short')).toEqual([]);
    expect(labels(found, 'fast')).toEqual(['all:Fastest run yet']);
  });

  it('orders same-day runs by start time, not id', () => {
    const found = findRecords([
      run('r0', '2026-01-01', 10000, 3000),
      entry('2026-01-10', { key: 'a-evening', meters: 15000, seconds: 4800, startedAt: Date.UTC(2026, 0, 10, 18) }),
      entry('2026-01-10', { key: 'b-morning', meters: 12000, seconds: 3900, startedAt: Date.UTC(2026, 0, 10, 7) }),
    ], [], new Map(), none, name);
    expect(labels(found, 'b-morning')).toEqual(['all:Longest run yet']);
    expect(labels(found, 'a-evening')).toEqual(['all:Longest run yet']);
  });

  it('keeps each kind separate', () => {
    const found = findRecords([
      run('r1', '2026-01-10', 30000, 9000),
      entry('2026-01-11', { key: 'w1', activityKind: 'walk', meters: 2000 }),
      entry('2026-01-12', { key: 'w2', activityKind: 'walk', meters: 4000 }),
    ], [], new Map(), none, name);
    expect(labels(found, 'w2')).toEqual(['all:Longest walk yet']);
  });

  it('calls out a lift PR heavier than every earlier set, across units, on its workout', () => {
    const workoutEntry = (id: string, date: string) => entry(date, { key: `workout:${id}`, id, kind: 'workout', activityKind: null });
    const dates = new Map([['old', '2026-09-01'], ['mid', '2026-10-01'], ['new', '2026-11-05']]);
    const found = findRecords(
      [workoutEntry('old', '2026-09-01'), workoutEntry('mid', '2026-10-01'), workoutEntry('new', '2026-11-05')],
      [
        set('a', 'old', 100, 5, { weight_unit: 'kg' }),
        set('b', 'mid', 210, 5),                         // 210 lb < 100 kg: no PR
        set('c', 'new', 105, 3, { weight_unit: 'kg' }),
        set('d', 'new', 107.5, 2, { weight_unit: 'kg' }), // the heavier new set names the PR
        set('e', 'new', 300, 5, { is_warmup: 1 }),
      ],
      dates, none, name,
    );
    expect(labels(found, 'workout:old')).toEqual([]);
    expect(labels(found, 'workout:mid')).toEqual([]);
    expect(labels(found, 'workout:new')).toEqual(['all:PR · Goblet Squat 107.5 kg × 2']);
  });

  it('never gives a first session a PR for its own climbing sets, and compares only with earlier sessions', () => {
    const workoutEntry = (id: string, date: string) => entry(date, { key: `workout:${id}`, id, kind: 'workout', activityKind: null });
    const dates = new Map([['first', '2026-09-01'], ['second', '2026-10-01']]);
    const found = findRecords(
      [workoutEntry('first', '2026-09-01'), workoutEntry('second', '2026-10-01')],
      [
        set('a', 'first', 100, 5, { logged_at: 1 }),
        set('b', 'first', 110, 5, { logged_at: 2 }),
        set('c', 'second', 105, 5, { logged_at: 3 }),
        set('d', 'second', 115, 3, { logged_at: 4 }),
      ],
      dates, none, name,
    );
    expect(labels(found, 'workout:first')).toEqual([]);
    expect(labels(found, 'workout:second')).toEqual(['all:PR · Goblet Squat 115 lb × 3']);
  });

  it('treats the same bell logged in kg and lb as the same load, not a PR', () => {
    const workoutEntry = (id: string, date: string) => entry(date, { key: `workout:${id}`, id, kind: 'workout', activityKind: null });
    const dates = new Map([['kg', '2026-09-01'], ['lb', '2026-10-01']]);
    const found = findRecords(
      [workoutEntry('kg', '2026-09-01'), workoutEntry('lb', '2026-10-01')],
      [set('a', 'kg', 24, 10, { weight_unit: 'kg' }), set('b', 'lb', 53, 10)], // 24 kg = 52.9 lb
      dates, none, name,
    );
    expect(labels(found, 'workout:lb')).toEqual([]);
    const highlight = findHighlights([], [set('a', 'kg', 24, 10, { weight_unit: 'kg' }), set('b', 'lb', 53, 10)], dates, '2026-10-02');
    expect(highlight.newBest).toBeNull();
  });
});
