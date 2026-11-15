import { describe, expect, it } from 'vitest';
import type { Entry } from '../src/activity';
import type { RaceGoal, TrainingProgram } from '../../src/types';
import {
  bestEstimate,
  blockStatus,
  carriedTime,
  countdownText,
  daysUntil,
  draftKind,
  eventDayResult,
  eventDraft,
  eventFromDraft,
  eventKinds,
  eventWeeks,
  goalTimeText,
  parseGoalTime,
  phaseOn,
  readiness,
  shortestEstimateDistance,
  singleKind,
  WEEKS_SHOWN,
} from '../src/event';

const TODAY = '2026-11-07'; // a Saturday; its Monday is Nov 2

function entry(key: string, date: string, overrides: Partial<Entry> = {}): Entry {
  return {
    key, id: key.split(':')[1] ?? key, kind: 'activity', date, category: 'runs', family: 'endurance',
    title: 'Run', details: [], attribution: null, inProgress: false, seconds: 1800, meters: 5000,
    load: 40, activityKind: 'run', ...overrides,
  };
}

const FIVE_K: RaceGoal = { name: 'Turkey Trot', date: '2026-11-26', discipline: 'running', distance: '5k', distance_m: 5000, goal_time_s: 1080 };

describe('the event', () => {
  it('knows which sessions train for which kind of event', () => {
    expect(eventKinds('running')).toEqual(['run']);
    expect(eventKinds('Trail marathon')).toEqual(['run']);
    expect(eventKinds('10k')).toEqual(['run']);
    expect(eventKinds('cycling')).toEqual(['ride']);
    expect(eventKinds('road cycling')).toEqual(['ride']);
    expect(eventKinds('Gravel')).toEqual(['ride']);
    expect(eventKinds('open water swim')).toEqual(['swim']);
    expect(eventKinds('triathlon')).toEqual(['swim', 'ride', 'run']);
    expect(eventKinds('Sprint tri')).toEqual(['swim', 'ride', 'run']);
    expect(eventKinds('duathlon')).toEqual(['run', 'ride']);
    expect(eventKinds('biathlon')).toEqual([]);
    expect(eventKinds('electric')).toEqual([]);
    expect(singleKind(FIVE_K)).toBe('run');
    expect(singleKind({ ...FIVE_K, discipline: 'triathlon' })).toBeNull();
  });

  it('counts down in days and weeks', () => {
    expect(daysUntil(TODAY, '2026-11-26')).toBe(19);
    expect(daysUntil(TODAY, '2026-11-01')).toBe(-6);
    // Across a clock change the count stays whole days.
    expect(daysUntil('2026-10-31', '2026-11-02')).toBe(2);
    expect(countdownText(0)).toBe('Today');
    expect(countdownText(1)).toBe('Tomorrow');
    expect(countdownText(5)).toBe('5 days to go');
    expect(countdownText(7)).toBe('1 week to go');
    expect(countdownText(19)).toBe('2 weeks, 5 days to go');
    expect(countdownText(22)).toBe('3 weeks, 1 day to go');
    expect(countdownText(-1)).toBe('Yesterday');
    expect(countdownText(-6)).toBe('6 days ago');
  });

  it('reads goal times', () => {
    expect(parseGoalTime('18:00')).toBe(1080);
    expect(parseGoalTime('1:45:30')).toBe(6330);
    expect(parseGoalTime(' 45 ')).toBe(2700);
    expect(parseGoalTime('18:60')).toBeNull();
    expect(parseGoalTime('1:60:00')).toBeNull();
    expect(parseGoalTime('fast')).toBeNull();
    expect(parseGoalTime('0:00')).toBeNull();
    expect(parseGoalTime('')).toBeNull();
    expect(goalTimeText(1080)).toBe('18:00');
    expect(goalTimeText(6330.4)).toBe('1:45:30');
  });
});

describe('where the plan is', () => {
  const week = { mon: null, tue: null, wed: null, thu: null, fri: null, sat: null, sun: null };
  const block: TrainingProgram = {
    id: 'p1', name: 'Build to 5k', start: '2026-10-19', repeat: false,
    weeks: [{ week }, { week }, { week, label: 'Build' }, { week }, { week, label: 'Taper' }],
  };

  it('finds this week and the event’s week in a one-off block', () => {
    expect(blockStatus(block, TODAY, '2026-11-20')).toEqual({
      name: 'Build to 5k', weekToday: 2, weekOnEvent: 4, weeks: 5, repeat: false,
      start: '2026-10-19', end: '2026-11-22', label: 'Build',
    });
    // An event after the block ends falls outside it.
    expect(blockStatus(block, TODAY, '2026-11-26').weekOnEvent).toBeNull();
    expect(blockStatus(null, TODAY, '2026-11-26')).toBeNull();
  });

  it('keeps cycling through a repeating block', () => {
    const cycle = { ...block, repeat: true, weeks: [{ week, label: 'A' }, { week, label: 'B' }] };
    const status = blockStatus(cycle, TODAY, '2026-11-26')!;
    expect(status.end).toBeNull();
    expect(status.weekToday).toBe(0);
    expect(status.weekOnEvent).toBe(1);
  });

  it('finds the phase covering a date', () => {
    const phases = [
      { phase: 'build' as const, start: '2026-10-01', end: '2026-11-15' },
      { phase: 'taper' as const, start: '2026-11-16', end: '2026-11-26' },
    ];
    expect(phaseOn(phases, TODAY)?.phase).toBe('build');
    expect(phaseOn(phases, '2026-11-20')?.phase).toBe('taper');
    expect(phaseOn(phases, '2026-12-01')).toBeNull();
  });
});

describe('finish estimate', () => {
  it('carries runs and swims with Riegel’s formula and rides at their speed', () => {
    expect(carriedTime(1200, 5000, 5000, 'run')).toBe(1200);
    expect(Math.round(carriedTime(1200, 5000, 10000, 'run'))).toBe(Math.round(1200 * 2 ** 1.06));
    expect(carriedTime(3600, 30000, 60000, 'ride')).toBe(7200);
    expect(shortestEstimateDistance('run', 5000)).toBeCloseTo(1609.344);
    expect(shortestEstimateDistance('run', 42195)).toBeCloseTo(42195 / 4);
    expect(shortestEstimateDistance('ride', 100000)).toBe(50000);
  });

  it('takes the fastest estimate from long enough sessions of the event’s kind', () => {
    const entries = [
      entry('activity:slow', '2026-11-01', { meters: 8000, seconds: 2880 }), // 6:00/km
      entry('activity:quick', '2026-11-05', { meters: 5000, seconds: 1300 }),
      entry('activity:short', '2026-11-06', { meters: 1000, seconds: 200 }), // too short
      entry('activity:ride', '2026-11-06', { activityKind: 'ride', meters: 20000, seconds: 1800 }),
      entry('workout:lift', '2026-11-06', { kind: 'workout', activityKind: null, meters: null }),
    ];
    const best = bestEstimate(entries, 'run', 5000, '2026-10-01', TODAY)!;
    expect(best.entry.key).toBe('activity:quick');
    expect(best.seconds).toBe(1300);
    // The 8 km run carries to 5 km faster than its pace alone suggests.
    const slow = bestEstimate(entries, 'run', 5000, '2026-11-01', '2026-11-01')!;
    expect(slow.seconds).toBeCloseTo(2880 * (5000 / 8000) ** 1.06);
    expect(bestEstimate(entries, 'run', 5000, '2026-10-01', '2026-10-31')).toBeNull();
  });
});

describe('weeks heading in', () => {
  it('sums the event’s kind by week, with the longest session and the week’s best estimate', () => {
    const entries = [
      entry('activity:a', '2026-11-02', { meters: 5000, seconds: 1500 }),
      entry('activity:b', '2026-11-05', { meters: 8000, seconds: 2600 }),
      entry('activity:c', '2026-10-28', { meters: 6000, seconds: 1900 }),
      entry('activity:ride', '2026-11-04', { activityKind: 'ride', meters: 30000, seconds: 3600 }),
      entry('activity:future', '2026-11-08', { meters: 4000 }),
    ];
    const weeks = eventWeeks(entries, FIVE_K, TODAY);
    expect(weeks).toHaveLength(WEEKS_SHOWN);
    const now = weeks[weeks.length - 1]!;
    expect(now).toMatchObject({ start: '2026-11-02', end: TODAY, current: true, sessions: 2, longest: 8000 });
    expect(now.meters).toEqual({ run: 13000 });
    expect(now.seconds).toEqual({ run: 4100 });
    expect(now.estimate).toBe(1500);
    expect(weeks[weeks.length - 2]).toMatchObject({ start: '2026-10-26', end: '2026-11-01', sessions: 1, longest: 6000 });
    expect(weeks[0]).toMatchObject({ start: '2026-08-17', sessions: 0, estimate: null, longest: 0 });
  });

  it('shows each sport of a multisport event without a single-sport estimate', () => {
    const tri: RaceGoal = { name: 'Tri', date: '2027-06-01', discipline: 'triathlon', distance: 'Sprint' };
    const entries = [
      entry('activity:run', '2026-11-03'),
      entry('activity:ride', '2026-11-04', { activityKind: 'ride', meters: 30000, seconds: 3600 }),
      entry('activity:swim', '2026-11-05', { activityKind: 'swim', meters: 1500, seconds: 1800 }),
    ];
    const now = eventWeeks(entries, tri, TODAY).pop()!;
    expect(now.seconds).toEqual({ run: 1800, ride: 3600, swim: 1800 });
    expect(now.longest).toBe(0);
    expect(now.estimate).toBeNull();
  });

  it('reads fitness, the longest recent session and sessions a week', () => {
    const entries = [
      entry('activity:old', '2026-09-01', { meters: 20000, load: 80 }),
      entry('activity:a', '2026-10-20', { meters: 9000, load: 60 }),
      entry('activity:b', '2026-11-05', { meters: 7000, load: 50 }),
    ];
    const ready = readiness(entries, FIVE_K, TODAY, eventWeeks(entries, FIVE_K, TODAY));
    expect(ready.today?.date).toBe(TODAY);
    expect(ready.fitnessFourWeeksAgo).not.toBeNull();
    expect(ready.formLabel).toBeTruthy();
    expect(ready.longestRecent?.key).toBe('activity:a');
    expect(ready.sessionsPerWeek).toBeCloseTo(2 / 5);
    expect(readiness([], FIVE_K, TODAY, eventWeeks([], FIVE_K, TODAY)).today).toBeNull();
  });

  it('finds what was done on the day once the event has passed', () => {
    const past = { ...FIVE_K, date: '2026-11-01' };
    const entries = [
      entry('activity:warmup', '2026-11-01', { meters: 1500 }),
      entry('activity:race', '2026-11-01', { meters: 5020, seconds: 1100 }),
    ];
    expect(eventDayResult(entries, past, TODAY)?.key).toBe('activity:race');
    expect(eventDayResult(entries, FIVE_K, TODAY)).toBeNull();
  });
});

describe('the editor', () => {
  it('opens an existing event with its preset distance and goal', () => {
    const draft = eventDraft(FIVE_K, true);
    expect(draft).toMatchObject({ name: 'Turkey Trot', discipline: 'running', distanceChoice: '5k', goal: '18:00' });
    expect(eventFromDraft(draft, FIVE_K)).toEqual({ race: FIVE_K });
  });

  it('keeps a distance that isn’t a preset, a type the coach typed and the coach’s priority', () => {
    const coach: RaceGoal = { name: 'Biathlon', date: '2027-03-01', discipline: 'biathlon', distance: 'Sprint', priority: 'A', location: 'Bend' };
    const draft = eventDraft(coach, false);
    expect(draft).toMatchObject({ discipline: 'other', otherDiscipline: 'biathlon', distanceLabel: 'Sprint' });
    expect(eventFromDraft(draft, coach)).toEqual({ race: coach });

    const odd = eventDraft({ ...FIVE_K, distance: '4 mi', distance_m: 4 * 1609.344 }, true);
    expect(odd).toMatchObject({ distanceChoice: 'custom', customAmount: '4', customUnit: 'mi' });
    expect(eventFromDraft(odd, null)).toEqual({
      race: { name: 'Turkey Trot', date: '2026-11-26', discipline: 'running', distance: '4 mi', distance_m: 6437.4, goal_time_s: 1080 },
    });
  });

  it('keeps a single-sport distance saved as text only', () => {
    const coach: RaceGoal = { name: 'CIM', date: '2026-12-06', discipline: 'running', distance: 'marathon' };
    const preset = eventDraft(coach, true);
    expect(preset.distanceChoice).toBe('Marathon');
    expect(eventFromDraft(preset, coach)).toEqual({
      race: { ...coach, distance: 'Marathon', distance_m: 42195 },
    });
    const odd: RaceGoal = { ...coach, distance: 'Trail 25k' };
    const kept = eventDraft(odd, true);
    expect(kept.distanceChoice).toBe('text');
    // Changing only the name keeps the distance.
    expect(eventFromDraft({ ...kept, name: 'Trail day' }, odd)).toEqual({ race: { ...odd, name: 'Trail day' } });
  });

  it('says what to fix', () => {
    const blank = eventDraft(null, true);
    expect(blank.discipline).toBe('running');
    expect(draftKind(blank)).toBe('run');
    expect(eventFromDraft(blank, null)).toEqual({ error: 'Name the event.' });
    expect(eventFromDraft({ ...blank, name: 'Trot' }, null)).toEqual({ error: 'Pick the event’s date.' });
    const dated = { ...blank, name: 'Trot', date: '2026-11-26' };
    expect(eventFromDraft({ ...dated, discipline: 'other' }, null)).toEqual({ error: 'Say what kind of event it is.' });
    expect(eventFromDraft({ ...dated, distanceChoice: 'custom', customAmount: 'far' }, null)).toEqual({ error: 'Enter the distance as a number.' });
    expect(eventFromDraft({ ...dated, goal: 'soon' }, null)).toEqual({ error: 'Enter the goal time like 18:00 or 1:45:30.' });
    expect(eventFromDraft(dated, null)).toEqual({ race: { name: 'Trot', date: '2026-11-26', discipline: 'running' } });
  });
});
