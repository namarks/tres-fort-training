import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { PlanPage } from '../src/PlanPage';
import type { StateActivity, StateResponse } from '../src/api';
import type { SessionRow } from '../../src/types';
import {
  activityLoad,
  activityLoads,
  activitySports,
  itemTitle,
  itemType,
  calendarInputs,
  calendarStatusLabel,
  describeDistance,
  describeGroup,
  describeRunSteps,
  describeSlot,
  finishedRunOf,
  formatScheduleTime,
  isRunOnlyWorkout,
  itemLoad,
  matchingRun,
  localToday,
  monthWeeks,
  plannedExtraWorkouts,
  plannedWorkoutOn,
  orderedSlots,
  prefersMiles,
  projectRange,
  scheduleTimeOn,
  shiftMonth,
  slotBlocks,
  type Slot,
  type Workout,
} from '../src/model';

function slot(overrides: Partial<Slot>): Slot {
  return {
    id: 's1', workout_id: 'w1', exercise_id: 'ex_squat', order_index: 0,
    target_sets: 3, target_reps: 5, target_reps_max: null, target_rpe: null,
    rest_seconds: 120, target_weight: 225, target_weight_unit: 'lb', target_duration_s: null,
    progression: null, run_steps: null, cues: null, is_warmup: 0, created_at: 0, updated_at: 0,
    exercise_name: 'Back Squat', exercise_unit: 'lb', exercise_muscle: 'legs', exercise_modality: 'strength',
    exercise_laterality: 'bilateral', exercise_load_mode: 'total', exercise_demo_slug: null,
    ...overrides,
  };
}

function workout(id: string, name: string, exercises: Slot[] = []): Workout {
  return { id, plan_id: 'p1', name, day_label: null, order_index: 0, notes: null, created_at: 0, updated_at: 0, archived_at: null, exercises };
}

function state(overrides: Partial<StateResponse> = {}): StateResponse {
  return {
    plan: {
      id: 'p1', user_id: 'u1', name: 'Plan', status: 'active', version: 3, meta: null, created_at: 0, updated_at: 0,
      schedule: { version: 1, week: { mon: 'w1', tue: null, wed: 'w2', thu: null, fri: 'w1', sat: null, sun: null } },
      trips: [],
      workouts: [workout('w1', 'Lower'), { ...workout('w2', 'Old'), archived_at: 1 }],
    },
    plan_version: 3,
    sessions: [],
    external_events: [],
    external_activities: [],
    ...overrides,
  };
}

describe('calendar', () => {
  it('builds Monday-first weeks that cover the whole month', () => {
    const weeks = monthWeeks('2026-11');
    expect(weeks[0]![0]).toBe('2026-10-26');
    expect(weeks.at(-1)![6]).toBe('2026-12-06');
    expect(weeks.flat()).toContain('2026-11-30');
    expect(weeks).toHaveLength(6);
    expect(monthWeeks('2027-02')).toHaveLength(4);
  });

  it('shifts months across years', () => {
    expect(shiftMonth('2026-12', 1)).toBe('2027-01');
    expect(shiftMonth('2026-01', -1)).toBe('2025-12');
  });

  it('uses the browser’s civil date for today', () => {
    expect(localToday(new Date(2026, 10, 1, 23, 59))).toBe('2026-11-01');
  });

  it('projects with the Worker’s own rules: routine, archived workouts, real sessions and trips', () => {
    const inputs = calendarInputs(state({
      sessions: [{
        id: 'sess', user_id: 'u1', plan_id: 'p1', workout_id: 'w1', date: '2026-10-30', status: 'completed',
        started_at: 1, completed_at: 2, perceived_fatigue: null, notes: null, created_at: 0, updated_at: 0,
        attempt: 1, write_protocol: 'attempt-v1',
      }],
      external_events: [{
        id: 'intervals:e1', user_id: 'u1', source: 'intervals', external_id: 'e1', date: '2026-11-03', kind: 'ride',
        title: 'Endurance ride', description: null, planned_duration_sec: 3600, training_load: 50, intensity: null,
        raw: null, synced_at: 0, deleted_at: null,
      }, {
        id: 'intervals:e2', user_id: 'u1', source: 'intervals', external_id: 'e2', date: '2026-11-04', kind: 'run',
        title: 'Deleted', description: null, planned_duration_sec: 1800, training_load: 20, intensity: null,
        raw: null, synced_at: 0, deleted_at: 5,
      }],
    }))!;
    inputs.trips = [{ id: 't1', start: '2026-11-06', end: '2026-11-06', type: 'travel', can_train_light: false }];
    const cells = projectRange(inputs, '2026-10-26', '2026-11-08', '2026-11-01');

    expect(cells.get('2026-10-30')).toMatchObject({ status: 'completed', workout_id: 'w1', real: true });
    expect(cells.has('2026-10-27')).toBe(false); // no invented past days
    expect(cells.get('2026-11-02')).toMatchObject({ status: 'projected', workout_id: 'w1' }); // Monday
    expect(cells.get('2026-11-03')!.items.map((i) => i.title)).toEqual(['Endurance ride']);
    expect(cells.get('2026-11-04')).toMatchObject({ status: 'rest', workout_id: null, items: [] }); // archived w2, deleted event
    expect(cells.get('2026-11-06')).toMatchObject({ status: 'unavailable' }); // trip over a Friday
  });

  it('has no calendar without a plan', () => {
    expect(calendarInputs(state({ plan: null }))).toBeNull();
  });
});

describe('mixed-session calendar', () => {
  const date = '2026-11-12';
  const blankWeek = { mon: null, tue: null, wed: null, thu: null, fri: null, sat: null, sun: null };

  function mixedState(block = false): StateResponse {
    const data = state();
    data.plan!.workouts = [
      workout('run', 'Morning run', [slot({ id: 'run-slot', workout_id: 'run', exercise_id: 'ex_outdoor_run',
        exercise_name: 'Outdoor run', exercise_modality: 'cardio', target_sets: 1,
        target_weight: null, target_duration_s: 1800, run_steps: '[{"kind":"work","duration_s":1800}]' })]),
      workout('core', 'Evening core', [slot({ id: 'core-slot', workout_id: 'core', exercise_id: 'ex_plank',
        exercise_name: 'Plank', exercise_modality: 'timed', target_sets: 3,
        target_weight: null, target_duration_s: 45, rest_seconds: 20 })]),
    ];
    const pattern = { week: { ...blankWeek, thu: 'run' }, extras: { thu: ['core'] } };
    data.plan!.schedule = block ? { version: 1, week: blankWeek } : {
      version: 1, ...pattern, times: { thu: { run: '07:00', core: '18:00' } },
    };
    if (block) data.plan!.meta = JSON.stringify({ schedule: data.plan!.schedule, program: {
      id: 'block', start: '2026-11-09', repeat: false,
      weeks: [{ ...pattern, targets: {
        'core-slot': { target_sets: 2, target_duration_s: 40 },
        'run-slot': { run_steps: '[{"kind":"work","duration_s":2400}]' },
      } }],
    } });
    return data;
  }

  function session(workoutID: string, slotIndex: number, status = 'completed'): SessionRow {
    return { id: `session-${slotIndex}`, user_id: 'u1', plan_id: 'p1', workout_id: workoutID, date, slot: slotIndex,
      status, started_at: 1, completed_at: status === 'completed' ? 2 : null,
      perceived_fatigue: null, notes: null, created_at: 0, updated_at: 0, attempt: 1, write_protocol: 'attempt-v1' };
  }

  function projected(data: StateResponse) {
    return projectRange(calendarInputs(data)!, date, date, date).get(date)!;
  }

  function rendered(data: StateResponse, todayDay = 12) {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 10, todayDay, 12));
    try {
      const html = renderToStaticMarkup(createElement(PlanPage, {
        state: data, write: async () => true, busy: false, onEditWorkout: () => {},
      }));
      const day = html.match(/<button[^>]*role="gridcell"[^>]*aria-pressed="true"[^>]*>[\s\S]*?<\/button>/)?.[0] ?? '';
      const detail = html.match(/<aside class="detail"[\s\S]*?<\/aside>/)?.[0] ?? '';
      expect(day).not.toBe('');
      expect(detail).not.toBe('');
      return { day, detail, html };
    } finally { vi.useRealTimers(); }
  }

  it('renders the saved block in Calendar with both workouts and that week’s targets', () => {
    const data = mixedState(true);
    const inputs = calendarInputs(data)!;
    const cell = projected(data);
    expect(cell).toMatchObject({ status: 'projected', workout_id: 'run', extras: ['core'] });
    const { day, detail } = rendered(data);
    expect(day).toContain('Morning run');
    expect(day).toContain('Evening core');
    expect(detail).toContain('Run 40:00');
    expect(detail).toContain('2 × 0:40 · rest 0:20');
    expect(detail).toContain('aria-label="Edit Evening core"');
    expect(data.plan!.workouts[1]!.exercises[0]!.target_duration_s).toBe(45);
    expect(plannedWorkoutOn(data.plan!.workouts[1]!, inputs.program, date, 'completed')).toBe(data.plan!.workouts[1]);
    expect(projectRange(inputs, '2026-11-19', '2026-11-19', date).get('2026-11-19'))
      .toMatchObject({ status: 'rest', workout_id: null });
  });

  it('shows separate weekly workouts and their times before either starts', () => {
    const { day, detail } = rendered(mixedState());
    expect(day).toMatch(/aria-label="[^"]*Morning run[^\"]*Evening core[^\"]*planned/);
    expect(day.match(/class="chip lift projected"/g)).toHaveLength(2);
    expect(detail).toContain('<time dateTime="07:00">');
    expect(detail).toContain('<time dateTime="18:00">');
    expect(detail).toContain('Plank');
    expect(detail).toContain('3 × 0:45 · rest 0:20');
  });

  it.each(['in_progress', 'completed'])('never presents current reminder times as %s session times', (status) => {
    const data = mixedState();
    data.sessions = [session('run', 0, status), session('core', 1, status)];
    const { day, detail } = rendered(data);
    expect(day).toContain('Morning run');
    expect(day).toContain('Evening core');
    expect(day).not.toContain(formatScheduleTime('07:00'));
    expect(day).not.toContain(formatScheduleTime('18:00'));
    expect(detail).not.toContain('<time ');

    // Viewing the calendar the following day must not rewrite history with
    // reminders from today's recurring schedule either.
    const { html } = rendered(data, 13);
    const pastDay = [...html.matchAll(/<button[^>]*role="gridcell"[^>]*>[\s\S]*?<\/button>/g)]
      .map((match) => match[0]).find((cell) => cell.includes('<span class="day-number">12</span>'));
    expect(pastDay).toContain('Evening core');
    expect(pastDay).not.toContain(formatScheduleTime('07:00'));
    expect(pastDay).not.toContain(formatScheduleTime('18:00'));
  });

  it('keeps reminder times on future explicitly planned sessions', () => {
    const data = mixedState();
    data.sessions = [session('run', 0, 'planned'), session('core', 1, 'planned')];
    const { html } = rendered(data, 11);
    const futureDay = [...html.matchAll(/<button[^>]*role="gridcell"[^>]*>[\s\S]*?<\/button>/g)]
      .map((match) => match[0]).find((cell) => cell.includes('<span class="day-number">12</span>'));
    expect(futureDay).toContain(formatScheduleTime('07:00'));
    expect(futureDay).toContain(formatScheduleTime('18:00'));
    const { detail } = rendered(data);
    expect(detail).toContain('<time dateTime="07:00">');
    expect(detail).toContain('<time dateTime="18:00">');
  });

  it('keeps core pending when the run finishes and replaces its projection with its own session', () => {
    const data = mixedState();
    const byID = new Map(data.plan!.workouts.map((workout) => [workout.id, workout]));
    data.sessions = [session('run', 0)];
    expect(plannedExtraWorkouts(projected(data), byID).map((workout) => workout.id)).toEqual(['core']);
    expect(rendered(data).detail).toContain('Evening core');
    data.sessions.push(session('core', 1, 'in_progress'));
    expect(plannedExtraWorkouts(projected(data), byID)).toEqual([]);
    let { day, detail } = rendered(data);
    expect(day.match(/class="chip lift in_progress"/g)).toHaveLength(1);
    expect(detail.match(/<h3>Evening core<\/h3>/g)).toHaveLength(1);
    expect(detail).toContain('Workout 2 · in progress');
    data.sessions[1]!.status = 'completed';
    ({ day, detail } = rendered(data));
    expect(detail.match(/<h3>Evening core<\/h3>/g)).toHaveLength(1);
    expect(detail).toContain('Workout 2 · completed');
    // A dated choice that places Core in the primary slot also replaces its projection.
    data.sessions = [session('core', 0, 'planned')];
    expect(plannedExtraWorkouts(projected(data), byID)).toEqual([]);
  });

  it('does not call an extra-only date a rest day or duplicate a listed extra', () => {
    const data = mixedState();
    data.plan!.schedule.week.thu = null;
    data.plan!.schedule.extras!.thu!.push('core');
    const cell = projected(data);
    expect(calendarStatusLabel(cell)).toBe('Planned workouts');
    const { day, detail } = rendered(data);
    expect(day.match(/class="chip lift projected"/g)).toHaveLength(1);
    expect(detail).not.toContain('A rest day.');
    expect(detail.match(/<h3>Evening core<\/h3>/g)).toHaveLength(1);
    data.sessions = [session('core', 1)];
    expect(calendarStatusLabel(projected(data))).toBe('Additional workouts');
  });

  it('keeps trip, skip, and past-history rules when presenting extra workouts', () => {
    const data = mixedState(true);
    const byID = new Map(data.plan!.workouts.map((workout) => [workout.id, workout]));
    data.sessions = [session('run', 0, 'skipped')];
    expect(plannedExtraWorkouts(projected(data), byID).map((workout) => workout.id)).toEqual(['core']);
    data.plan!.trips = [{ id: 'away', start: date, end: date, type: 'travel', can_train_light: false }];
    expect(projected(data)).toMatchObject({ status: 'unavailable', workout_id: null });
    expect(plannedExtraWorkouts(projected(data), byID)).toEqual([]);
    expect(rendered(data).detail).not.toContain('Evening core');
    data.sessions.push(session('core', 1));
    expect(rendered(data).detail).toContain('Evening core'); // actual completed work survives the trip
    data.plan!.trips = [];
    const past = projectRange(calendarInputs(data)!, date, date, '2026-11-13').get(date)!;
    expect(past.extras).toBeUndefined();
    expect(past.sessions?.map((row) => row.workout_id)).toEqual(['core']);
  });

  it('reads only valid local clock values without converting the weekday', () => {
    const schedule = mixedState().plan!.schedule;
    expect(scheduleTimeOn(schedule, 'core', date)).toBe('18:00');
    expect(scheduleTimeOn(schedule, 'core', '2026-11-13')).toBeNull();
    expect(formatScheduleTime('18:00', 'en-GB')).toBe('18:00');
    expect(formatScheduleTime('07:00', 'en-US')).toBe('7:00 AM');
    schedule.times!.thu!.core = '25:00';
    expect(scheduleTimeOn(schedule, 'core', date)).toBeNull();
  });
});

describe('workout details', () => {
  it('describes reps, ranges, loads, RPE, holds and sides', () => {
    expect(describeSlot(slot({}))).toBe('3 × 5 @ 225 lb · rest 2:00');
    expect(describeSlot(slot({ target_reps_max: 8, target_rpe: 8, target_weight: 100, target_weight_unit: 'kg' })))
      .toBe('3 × 5–8 @ 100 kg · RPE 8 · rest 2:00');
    expect(describeSlot(slot({ target_duration_s: 45, target_weight: null, rest_seconds: 0 }))).toBe('3 × 0:45');
    expect(describeSlot(slot({ exercise_laterality: 'unilateral', exercise_load_mode: 'per_hand', target_weight: 40 })))
      .toBe('3 × 5 each side @ 40 lb each hand · rest 2:00');
  });

  it('orders slots and labels supersets', () => {
    const labelled = orderedSlots(workout('w', 'W', [
      slot({ id: 'b', order_index: 1, group_id: 'g' }),
      slot({ id: 'a', order_index: 0, group_id: 'g' }),
      slot({ id: 'c', order_index: 2 }),
    ]));
    expect(labelled.map((s) => [s.id, s.group_label])).toEqual([['a', 'A1'], ['b', 'A2'], ['c', undefined]]);
  });

  it('shows a superset’s or circuit’s own rests, not its members’ ordinary rests', () => {
    const blocks = slotBlocks(workout('w', 'W', [
      slot({ id: 'a', order_index: 0, group_id: 'g', target_sets: 4, rest_seconds: 120, group_rest_seconds: 60, group_transition_seconds: 0 }),
      slot({ id: 'b', order_index: 1, group_id: 'g', target_sets: 4, rest_seconds: 120, group_rest_seconds: 60, group_transition_seconds: 0 }),
      slot({ id: 'c', order_index: 2 }),
      slot({ id: 'd', order_index: 3, group_id: 'h', group_rest_seconds: 90, group_transition_seconds: 15 }),
      slot({ id: 'e', order_index: 4, group_id: 'h', group_rest_seconds: 90, group_transition_seconds: 15 }),
      slot({ id: 'f', order_index: 5, group_id: 'h', group_rest_seconds: 90, group_transition_seconds: 15 }),
    ]));
    expect(blocks.map((b) => [b.group?.title ?? null, b.members.map((m) => m.id)])).toEqual([
      ['Superset A', ['a', 'b']], [null, ['c']], ['Circuit B', ['d', 'e', 'f']],
    ]);
    expect(describeGroup(blocks[0]!.group!)).toBe('4 rounds · round rest 1:00');
    expect(describeGroup(blocks[2]!.group!)).toBe('3 rounds · round rest 1:30 · 0:15 between exercises');
    expect(describeSlot(blocks[0]!.members[0]!)).toBe('4 × 5 @ 225 lb');
    expect(describeSlot(blocks[1]!.members[0]!)).toBe('3 × 5 @ 225 lb · rest 2:00');
  });

  it('describes planned run steps in miles or kilometres', () => {
    const raw = JSON.stringify([
      { kind: 'warmup', duration_s: 600 },
      { repeat: 4, steps: [
        { kind: 'work', distance_m: 800, target: { type: 'pace', fastest_s_per_km: 240, slowest_s_per_km: 250 } },
        { kind: 'recovery', duration_s: 120, target: { type: 'heart_rate', min_bpm: 120, max_bpm: 140 } },
      ] },
    ]);
    expect(describeRunSteps(raw, false)).toEqual([
      'Warm up 10:00',
      '4 × (Run 800 m at 4:00–4:10 /km, Recover 2:00 at 120–140 bpm)',
    ]);
    expect(describeRunSteps(raw, true)[1]).toBe('4 × (Run 800 m at 6:26–6:42 /mi, Recover 2:00 at 120–140 bpm)');
    const single = JSON.stringify([{ kind: 'work', duration_s: 2400, target: { type: 'heart_rate', min_bpm: 140, max_bpm: 140 } }]);
    expect(describeRunSteps(single, false)).toEqual(['Run 40:00 at 140 bpm']);
    expect(describeRunSteps('not json', true)).toEqual([]);
    expect(describeRunSteps(null, true)).toEqual([]);
  });

  it('reads distances as the app does: meters under a kilometer, else up to two decimals', () => {
    expect(describeDistance(50, true)).toBe('50 m');
    expect(describeDistance(400, true)).toBe('400 m');
    expect(describeDistance(999.6, false)).toBe('1000 m');
    expect(describeDistance(1000, false)).toBe('1 km');
    expect(describeDistance(1250, false)).toBe('1.25 km');
    expect(describeDistance(1609.344, true)).toBe('1 mi');
    expect(describeDistance(5000, true)).toBe('3.11 mi');
    expect(describeDistance(1500, true)).toBe('0.93 mi');
  });

  it('keeps two decimals of a load', () => {
    expect(describeSlot(slot({ target_weight: 21.25, target_weight_unit: 'kg', rest_seconds: 0 }))).toBe('3 × 5 @ 21.25 kg');
  });

  it('uses miles for US and UK locales only', () => {
    expect(prefersMiles('en-US')).toBe(true);
    expect(prefersMiles('en-GB')).toBe(true);
    expect(prefersMiles('fr-FR')).toBe(false);
    expect(prefersMiles('de')).toBe(false);
  });
});

describe('activity load', () => {
  function activity(overrides: Partial<StateActivity>): StateActivity {
    return {
      id: 'intervals:a1', user_id: 'u1', source: 'intervals', external_id: 'a1', date: '2026-10-30', kind: 'run',
      name: 'Easy run', moving_time_sec: 2400, elapsed_time_sec: 2500, distance_m: 7000, average_watts: null,
      weighted_avg_watts: null, average_hr: 140, max_hr: 160, training_load: null, intensity: null, calories: null,
      elevation_gain_m: null, raw: null, synced_at: 0, deleted_at: null, canonical: 1, duplicate_of: null,
      ...overrides,
    } as StateActivity;
  }

  it('shows the effective load and its method, not the provider figure alone', () => {
    expect(activityLoad(activity({ training_load: null, effective_load: 42, load_method: 'heart_rate' })))
      .toEqual({ load: 42, method: 'heart_rate' });
    expect(activityLoad(activity({ training_load: 60, effective_load: 60, load_method: 'provider' })))
      .toEqual({ load: 60, method: 'provider' });
  });

  it('leaves missing data unknown', () => {
    expect(activityLoad(activity({ training_load: null, effective_load: null, load_method: null }))).toBeNull();
    expect(activityLoad(activity({ training_load: null }))).toBeNull();
  });

  it('falls back to the provider load from an API without effective loads', () => {
    expect(activityLoad(activity({ training_load: 55 }))).toEqual({ load: 55, method: 'provider' });
  });

  it('carries completed loads through the calendar and keeps planned events their own', () => {
    const s = state({
      external_activities: [activity({ id: 'intervals:a1', training_load: null, effective_load: 42, load_method: 'pace' })],
      external_events: [{
        id: 'intervals:e1', user_id: 'u1', source: 'intervals', external_id: 'e1', date: '2026-11-03', kind: 'ride',
        title: 'Endurance ride', description: null, planned_duration_sec: 3600, training_load: 50, intensity: null,
        raw: null, synced_at: 0, deleted_at: null,
      }],
    });
    const cells = projectRange(calendarInputs(s)!, '2026-10-30', '2026-11-03', '2026-11-01');
    const loads = activityLoads(s);
    expect(itemLoad(cells.get('2026-10-30')!.items[0]!, loads)).toEqual({ load: 42, method: 'pace' });
    expect(itemLoad(cells.get('2026-11-03')!.items[0]!, loads)).toEqual({ load: 50, method: null });
  });
});

describe('activity sports', () => {
  function activity(overrides: Partial<StateActivity>): StateActivity {
    return {
      id: 'intervals:a1', user_id: 'u1', source: 'intervals', external_id: 'a1', date: '2026-10-30', kind: 'run',
      name: 'Easy run', moving_time_sec: 2400, elapsed_time_sec: 2500, distance_m: 7000, average_watts: null,
      weighted_avg_watts: null, average_hr: 140, max_hr: 160, training_load: null, intensity: null, calories: null,
      elevation_gain_m: null, raw: null, synced_at: 0, deleted_at: null, canonical: 1, duplicate_of: null,
      ...overrides,
    } as StateActivity;
  }

  it('names a completed activity by its sport and keeps planned events their own', () => {
    const s = state({
      external_activities: [
        activity({ id: 'healthkit:a1', kind: 'other', name: 'Workout', sport: 'soccer' }),
        activity({ id: 'intervals:a2', date: '2026-10-31', kind: 'other', name: 'Club tennis', sport: 'tennis' }),
        activity({ id: 'healthkit:a3', date: '2026-10-29', kind: 'other', name: 'Workout', sport: 'other' }),
      ],
      external_events: [{
        id: 'intervals:e1', user_id: 'u1', source: 'intervals', external_id: 'e1', date: '2026-11-03', kind: 'ride',
        title: null, description: null, planned_duration_sec: 3600, training_load: 50, intensity: null,
        raw: null, synced_at: 0, deleted_at: null,
      }],
    });
    const cells = projectRange(calendarInputs(s)!, '2026-10-29', '2026-11-03', '2026-11-01');
    const sports = activitySports(s);
    const first = (date: string) => cells.get(date)!.items[0]!;
    expect([itemTitle(first('2026-10-30'), sports), itemType(first('2026-10-30'), sports)]).toEqual(['Soccer', 'Soccer']);
    expect([itemTitle(first('2026-10-31'), sports), itemType(first('2026-10-31'), sports)]).toEqual(['Club tennis', 'Tennis']);
    expect([itemTitle(first('2026-10-29'), sports), itemType(first('2026-10-29'), sports)]).toEqual(['Workout', 'Activity']);
    expect([itemTitle(first('2026-11-03'), sports), itemType(first('2026-11-03'), sports)]).toEqual(['Ride', 'Ride']);
  });
});

describe('finished run workouts', () => {
  const runSlot = slot({ id: 'r1', exercise_id: 'ex_outdoor_run', exercise_name: 'Outdoor Run', target_sets: 1 });
  const tempo = workout('w-run', 'Tempo Run', [runSlot]);

  function run(overrides: Partial<StateActivity>): StateActivity {
    return {
      id: 'intervals:a1', user_id: 'u1', source: 'intervals', external_id: 'a1', date: '2026-11-05', kind: 'run',
      name: 'Tempo Run', moving_time_sec: 1814, elapsed_time_sec: 1900, distance_m: 5894, average_watts: null,
      weighted_avg_watts: null, average_hr: 151, max_hr: 167, training_load: 40, intensity: null, calories: null,
      elevation_gain_m: null, raw: null, synced_at: 0, deleted_at: null, canonical: 1, duplicate_of: null,
      ...overrides,
    } as StateActivity;
  }

  function cellsWith(activities: StateActivity[], plannedWorkout: Workout = tempo, status = 'completed') {
    const base = state();
    const inputs = calendarInputs(state({
      plan: { ...base.plan!, workouts: [...base.plan!.workouts, plannedWorkout] },
      sessions: [{
        id: 'sess', user_id: 'u1', plan_id: 'p1', workout_id: plannedWorkout.id, date: '2026-11-05', status,
        started_at: 1, completed_at: 2, perceived_fatigue: null, notes: null, created_at: 0, updated_at: 0,
        attempt: 1, write_protocol: 'attempt-v1',
      }],
      external_activities: activities,
    }))!;
    return projectRange(inputs, '2026-11-02', '2026-11-08', '2026-11-07');
  }

  it('knows a run-only workout', () => {
    expect(isRunOnlyWorkout(tempo)).toBe(true);
    expect(isRunOnlyWorkout(workout('w-mixed', 'Run + lift', [runSlot, slot({ id: 's2' })]))).toBe(false);
    expect(isRunOnlyWorkout(workout('w-empty', 'Empty'))).toBe(false);
  });

  it('matches the run named after the workout, else the longest run, like the app', () => {
    const named = run({ id: 'named', name: '  tempo run ', moving_time_sec: 600 });
    const longer = run({ id: 'longer', name: 'Morning Run', moving_time_sec: 3000 });
    const ride = run({ id: 'ride', kind: 'ride', name: 'Tempo Run', moving_time_sec: 9000 });
    expect(matchingRun('Tempo Run', [longer, ride, named])?.id).toBe('named');
    expect(matchingRun('Easy Run', [named, longer, ride])?.id).toBe('longer');
    expect(matchingRun(undefined, [named, longer])?.id).toBe('longer');
    expect(matchingRun('Tempo Run', [run({ deleted_at: 9 }), ride])).toBeNull();
    expect(matchingRun('Tempo Run', [])).toBeNull();
  });

  it('shows a finished run workout as its run, not twice', () => {
    const activities = [run({})];
    const cell = cellsWith(activities).get('2026-11-05')!;
    expect(cell).toMatchObject({ status: 'completed', workout_id: 'w-run', real: true });
    expect(cell.items.map((i) => i.title)).toEqual(['Tempo Run']);
    expect(finishedRunOf(cell, tempo, activities)?.id).toBe('intervals:a1');
  });

  it('keeps the workout when there is no run that day, or it is not a run-only workout', () => {
    expect(finishedRunOf(cellsWith([]).get('2026-11-05'), tempo, [])).toBeNull();
    const otherDay = [run({ date: '2026-11-04' })];
    expect(finishedRunOf(cellsWith(otherDay).get('2026-11-05'), tempo, otherDay)).toBeNull();
    const lower = workout('w-lower', 'Lower', [slot({ workout_id: 'w-lower' })]);
    const activities = [run({ name: 'Lower' })];
    expect(finishedRunOf(cellsWith(activities, lower).get('2026-11-05'), lower, activities)).toBeNull();
    const started = [run({})];
    expect(finishedRunOf(cellsWith(started, tempo, 'in_progress').get('2026-11-05'), tempo, started)).toBeNull();
  });
});
