import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { WeeklySchedule } from '../../src/types';
import { AddWorkoutToWeek, EveryWeekRow, EveryWeekdayPanel } from '../src/EveryWeek';
import type { Slot, Workout } from '../src/model';
import {
  choosableWorkouts, routineAddProblem, routineAdded, routineAddingWorkout, routineDay, routineDayFull,
  routineDayProblem, routineExtra, routinePrimary, routineWithDay,
} from '../src/scheduling';

function workout(id: string, name = id): Workout {
  return { id, name, plan_id: 'plan', day_label: null, order_index: 0, notes: null,
    created_at: 0, updated_at: 0, archived_at: null, exercises: [] };
}
const timedSlot: Slot = {
  id: 'plank', workout_id: 'core', exercise_id: 'ex_plank', order_index: 0, target_sets: 2,
  target_reps: 40, target_reps_max: null, target_rpe: null, rest_seconds: 20, target_weight: null,
  target_weight_unit: 'lb', target_duration_s: 40, progression: null, run_steps: null, cues: null,
  is_warmup: 0, created_at: 0, updated_at: 0, exercise_name: 'Plank', exercise_unit: 'lb',
  exercise_muscle: 'core', exercise_modality: 'timed', exercise_laterality: 'bilateral',
  exercise_load_mode: 'total', exercise_demo_slug: null,
};
const workouts = [workout('run', 'Morning run'), { ...workout('core', 'Timed core'), exercises: [timedSlot] },
  workout('stretch', 'Stretching'), workout('lift', 'Strength'), workout('ride', 'Ride'), workout('swim', 'Swim'),
  { ...workout('archived', 'Archived workout'), archived_at: 1 },
  { ...workout('one-time', 'One-time workout'), one_time_date: '2026-11-12' }];

function schedule(): WeeklySchedule {
  return {
    version: 2,
    week: { mon: null, tue: 'run', wed: 'lift', thu: 'run', fri: null, sat: null, sun: null },
    extras: { tue: ['core', 'stretch'], wed: ['ride'] },
    times: { tue: { run: '07:00', core: '20:00', stretch: '21:00' }, wed: { lift: '12:30', ride: '18:00' }, thu: { run: '08:00' } },
  };
}

describe('reviewed weekly routine editing', () => {
  it('edits a full workout alongside a run without changing siblings or unrelated days', () => {
    const before = schedule();
    const original = structuredClone(before);
    const draft = routineDay(before, 'tue');
    draft.times.core = '19:30';
    const result = routineWithDay(before, 'tue', draft, workouts);
    expect(result).toEqual({ ok: true, schedule: {
      week: before.week, extras: before.extras,
      times: { ...before.times, tue: { run: '07:00', core: '19:30', stretch: '21:00' } },
    } });
    expect(before).toEqual(original);
  });

  it('removes only the chosen extra and its time', () => {
    const before = schedule();
    const draft = routineExtra(routineDay(before, 'tue'), 0, null);
    const result = routineWithDay(before, 'tue', draft, workouts);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.schedule.extras).toEqual({ tue: ['stretch'], wed: ['ride'] });
    expect(result.schedule.times).toEqual({ ...before.times, tue: { run: '07:00', stretch: '21:00' } });
    expect(result.schedule.week).toEqual(before.week);
  });

  it('sends explicit empty maps when the last extra or time is removed', () => {
    const before: WeeklySchedule = { version: 9, week: schedule().week, extras: { tue: ['core'] }, times: { tue: { core: '20:00' } } };
    const result = routineWithDay(before, 'tue', routineExtra(routineDay(before, 'tue'), 0, null), workouts);
    expect(result).toEqual({ ok: true, schedule: { week: before.week, extras: {}, times: {} } });
  });

  it('promotes an extra with its own time and clears the replaced main workout time', () => {
    const before = schedule();
    const draft = routinePrimary(routineDay(before, 'tue'), 'core');
    expect(draft).toEqual({ primary: 'core', extras: ['stretch'], times: { core: '20:00', stretch: '21:00' } });
    const result = routineWithDay(before, 'tue', draft, workouts);
    expect(result.ok && result.schedule.week.tue).toBe('core');
    expect(result.ok && result.schedule.extras?.wed).toEqual(['ride']);
  });

  it('changes one extra without giving it the old workout time', () => {
    const draft = routineExtra(routineDay(schedule(), 'tue'), 0, 'swim');
    expect(draft.extras).toEqual(['swim', 'stretch']);
    expect(draft.times).toEqual({ run: '07:00', stretch: '21:00' });
    draft.times.swim = '17:45';
    expect(routineWithDay(schedule(), 'tue', draft, workouts).ok).toBe(true);
  });

  it('keeps extras when the main workout becomes rest, and clears times independently', () => {
    const draft = routinePrimary(routineDay(schedule(), 'tue'), null);
    draft.times.core = '';
    const result = routineWithDay(schedule(), 'tue', draft, workouts);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.schedule.week.tue).toBeNull();
    expect(result.schedule.extras?.tue).toEqual(['core', 'stretch']);
    expect(result.schedule.times?.tue).toEqual({ stretch: '21:00' });
  });

  it('rejects repeats and excludes archived or one-time workouts', () => {
    expect(choosableWorkouts(workouts).map((entry) => entry.id)).toEqual(['run', 'core', 'stretch', 'lift', 'ride', 'swim']);
    const draft = routineDay(schedule(), 'tue');
    expect(routineDayProblem({ ...draft, extras: ['run'] }, workouts)).toMatch(/only once/);
    expect(routineDayProblem({ ...draft, extras: ['core', 'core'] }, workouts)).toMatch(/only once/);
    for (const id of ['archived', 'one-time', 'unknown', '']) {
      expect(routineDayProblem({ ...draft, extras: [id] }, workouts)).toMatch(/saved workout/);
    }
  });

  it('enforces four separate workouts while allowing them without a main workout', () => {
    const draft = { primary: null, extras: ['core', 'stretch', 'ride', 'swim'], times: {} };
    expect(routineDayProblem(draft, workouts)).toBeNull();
    expect(routineDayProblem({ ...draft, extras: [...draft.extras, 'lift'] }, workouts)).toMatch(/four|4/);
    const before: WeeklySchedule = { ...schedule(), extras: { tue: draft.extras, mon: draft.extras } };
    expect(routineAddProblem(before, 'tue', 'lift')).toMatch(/four/);
    expect(routineAddProblem(before, 'mon', 'lift')).toBeNull();
    const result = routineAddingWorkout(before, ['mon'], 'lift', '', workouts);
    expect(result.ok && result.schedule.week.mon).toBe('lift');
    expect(result.ok && result.schedule.extras?.mon).toEqual(draft.extras);
  });

  it('adds a replacement into an empty main position, even beside four separate workouts', () => {
    // The main workout was removed and four separate ones remain: the day is not full.
    const draft = routinePrimary({ primary: 'run', extras: ['core', 'stretch', 'ride', 'swim'], times: {} }, null);
    expect(routineDayFull(draft)).toBe(false);
    const added = routineAdded(draft, 'lift');
    expect(added).toMatchObject({ primary: 'lift', extras: ['core', 'stretch', 'ride', 'swim'] });
    expect(routineDayProblem(added, workouts)).toBeNull();
    expect(routineDayFull(added)).toBe(true);
    // With a main workout in place, the next one goes alongside.
    expect(routineAdded({ primary: 'run', extras: ['core'], times: {} }, 'lift').extras).toEqual(['core', 'lift']);
  });

  it('offers Make main for a separate workout on a day with no main workout', () => {
    const noMain: WeeklySchedule = { ...schedule(), week: { ...schedule().week, tue: null } };
    const html = renderToStaticMarkup(createElement(EveryWeekdayPanel, {
      day: 'tue', schedule: noMain, workouts, reviewed: { planId: 'plan', version: 1 }, write: vi.fn(), busy: false,
      onClose: vi.fn(), onNewWorkout: vi.fn(), scope: 'Fills each Tuesday.',
    }));
    expect(html).toContain('Make Timed core the main workout');
  });

  it('accepts only optional strict local HH:MM times', () => {
    for (const time of ['', '00:00', '23:59']) {
      expect(routineAddingWorkout(schedule(), ['mon'], 'core', time, workouts).ok).toBe(true);
    }
    for (const time of ['24:00', '7:00', '12:60', ' 07:00', '07:00:00']) {
      expect(routineAddingWorkout(schedule(), ['mon'], 'core', time, workouts)).toEqual({ ok: false,
        error: 'Use a time between 00:00 and 23:59, or leave it blank.' });
    }
  });

  it('adds a selected workout to several days without replacing their main workout or times', () => {
    const before = schedule();
    const result = routineAddingWorkout(before, ['mon', 'thu'], 'core', '20:30', workouts);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.schedule.week).toEqual({ ...before.week, mon: 'core' });
    expect(result.schedule.extras).toEqual({ ...before.extras, thu: ['core'] });
    expect(result.schedule.times).toEqual({ ...before.times, mon: { core: '20:30' }, thu: { run: '08:00', core: '20:30' } });
    expect(before).toEqual(schedule());
  });

  it('rejects a repeated or full day atomically without changing earlier selected days', () => {
    const before = schedule();
    expect(routineAddingWorkout(before, ['mon', 'tue'], 'core', '20:30', workouts)).toEqual({ ok: false, error: 'Already on this day' });
    expect(routineAddingWorkout(before, [], 'core', '', workouts)).toEqual({ ok: false, error: 'Choose at least one day.' });
    expect(before).toEqual(schedule());
    const full = { ...before, extras: { ...before.extras, tue: ['core', 'stretch', 'ride', 'swim'] } };
    expect(routineAddingWorkout(full, ['mon', 'tue'], 'lift', '', workouts)).toEqual({ ok: false,
      error: 'This day already has four separate workouts' });
    expect(full.week.mon).toBeNull();
  });
});

describe('weekly routine controls', () => {
  const reviewed = { planId: 'plan', version: 42, accountId: 'account' };
  it('shows the repeating week as one row of weekday buttons with names and times', () => {
    const html = renderToStaticMarkup(createElement(EveryWeekRow, {
      schedule: schedule(), workouts, selected: 'tue', onSelect: vi.fn(), hint: 'Fills every week below',
    }));
    expect(html).toContain('aria-label="Every week"');
    expect(html).toContain('aria-label="Edit Tuesday"');
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain('Timed core');
    expect(html).toContain('7:00');
    expect(html).toContain('8:00');
    expect(html).toContain('Rest');
    expect(html).not.toContain('Archived workout');
    expect(html).not.toContain('One-time workout');
  });

  it('opens a weekday with its workouts, times, an add list and explicit Save and Cancel', () => {
    const write = vi.fn();
    const html = renderToStaticMarkup(createElement(EveryWeekdayPanel, {
      day: 'tue', schedule: schedule(), workouts, reviewed, busy: false, write, onClose: vi.fn(), onNewWorkout: vi.fn(),
      scope: 'Fills each Tuesday you haven’t changed on its own date.',
    }));
    expect(html).toContain('aria-label="Edit Tuesday"');
    expect(html).toContain('Every Tuesday');
    expect(html).toContain('Time for Timed core · optional');
    expect(html).toContain('aria-label="Remove Timed core from Tuesday"');
    expect(html).toContain('Add a workout to Tuesday');
    expect(html).toContain('Save Tuesday');
    expect(html).not.toContain('Archived workout');
    expect(write).not.toHaveBeenCalled();
  });

  it('opens the selected workout handoff with days, an optional time, Save and Cancel', () => {
    const write = vi.fn();
    const html = renderToStaticMarkup(createElement(AddWorkoutToWeek, {
      schedule: schedule(), workouts, reviewed, workout: workouts.find(workout => workout.id === 'core')!, busy: false, write,
      onDone: vi.fn(), onCancel: vi.fn(),
    }));
    expect(html).toContain('aria-label="Add Timed core to your week"');
    expect(html).toContain('Already on this day');
    expect(html).toContain('Alongside Morning run');
    expect(html).toContain('type="checkbox"');
    expect(html).toContain('type="time"');
    expect(html).toContain('Add to selected days');
    expect(html).toContain('Cancel');
    expect(html).toContain('notification settings');
    expect(write).not.toHaveBeenCalled();
  });
});
