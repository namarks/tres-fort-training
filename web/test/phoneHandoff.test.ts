import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { StateResponse } from '../src/api';
import { PhoneHandoff } from '../src/PhoneHandoff';
import { IPHONE_APP_URL, OPEN_TODAY_URL, nextPlannedDay } from '../src/phonePlanning';

function state(): StateResponse {
  return {
    plan: { id: 'plan', user_id: 'member', name: 'Week', status: 'active', version: 2,
      meta: null, created_at: 0, updated_at: 0, trips: [],
      schedule: { version: 1, week: { mon: null, tue: 'run', wed: null, thu: null, fri: null, sat: null, sun: null },
        extras: { tue: ['core'] }, times: { tue: { run: '07:00', core: '18:00' } } },
      workouts: ['run', 'core'].map((id, order_index) => ({ id, plan_id: 'plan', name: id === 'run' ? 'Morning run' : 'Evening core',
        order_index, day_label: null, notes: null, created_at: 0, updated_at: 0, archived_at: null, exercises: [] })),
    },
    plan_version: 2, sessions: [], external_events: [], external_activities: [],
  };
}

describe('phone handoff after planning', () => {
  it('shows the same mixed day and independent times, with concrete navigation-only links', () => {
    const input = state();
    expect(nextPlannedDay(input, '2026-11-16')).toEqual({ date: '2026-11-17', workouts: [
      { id: 'run', name: 'Morning run', time: '07:00', started: false },
      { id: 'core', name: 'Evening core', time: '18:00', started: false },
    ] });
    const html = renderToStaticMarkup(createElement(PhoneHandoff, { state: input, today: '2026-11-16' }));
    expect(html).toContain(IPHONE_APP_URL);
    expect(html).toContain(OPEN_TODAY_URL);
    expect(html).toContain('same Apple account');
    expect(html).toContain('Turn on workout reminders in the iPhone app');
  });

  it('does not imply an empty or unscheduled library is a ready week', () => {
    const input = state();
    input.plan!.schedule = { version: 1, week: { mon: null, tue: null, wed: null, thu: null, fri: null, sat: null, sun: null } };
    expect(nextPlannedDay(input, '2026-11-16')).toBeNull();
    expect(nextPlannedDay({ ...input, plan: null }, '2026-11-16')).toBeNull();
  });

  it('uses the block rather than the baseline week and respects away dates', () => {
    const input = state();
    input.plan!.meta = JSON.stringify({ program: { id: 'block', start: '2026-11-16', repeat: true,
      weeks: [{ week: { mon: null, tue: null, wed: null, thu: 'core', fri: null, sat: null, sun: null } }] } });
    expect(nextPlannedDay(input, '2026-11-16')?.date).toBe('2026-11-19');
    input.plan!.trips = [{ id: 'away', start: '2026-11-16', end: '2026-11-29', can_train_light: false }];
    expect(nextPlannedDay(input, '2026-11-16')).toBeNull();
  });

  it('keeps the pending core when the run is completed, and does not repeat a completed extra', () => {
    const input = state();
    const session = { id: 'session', user_id: 'member', plan_id: 'plan', date: '2026-11-17', workout_id: 'run', slot: 0,
      status: 'completed', attempt: 1, started_at: 1, completed_at: 2, created_at: 1, updated_at: 2,
      perceived_fatigue: null, notes: null, write_protocol: 'attempt-v1' as const };
    input.sessions = [session];
    expect(nextPlannedDay(input, '2026-11-17')?.workouts.map(workout => workout.id)).toEqual(['core']);
    input.sessions.push({ ...session, id: 'core-session', workout_id: 'core', slot: 1 });
    expect(nextPlannedDay(input, '2026-11-17')?.date).toBe('2026-11-24');
  });
});
