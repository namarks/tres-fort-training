import { describe, expect, it } from 'vitest';
import {
  activeMembers, buildsInUse, clientsUsed, describeBuild, describeBuildRow, describeConnections, describeSetup,
  memberName, membersPath, otherActivities, planChanges, relativeTime, type MemberUsage,
} from '../src/members';

const NOW = Date.parse('2026-11-13T12:00:00Z');

function member(overrides: Partial<MemberUsage> = {}): MemberUsage {
  return {
    user_id: crypto.randomUUID(),
    display_name: 'Ian',
    is_owner: false,
    is_test_member: false,
    joined_at: NOW - 30 * 86_400_000,
    last_seen_at: null,
    app: { ios: null, web_last_seen_at: null, coach_last_seen_at: null },
    builds: [],
    active_days: { any: 0, ios: 0, web: 0, coach: 0 },
    last_workout_at: null,
    last_set_at: null,
    last_activity_date: null,
    recent: {
      workouts_completed: 0, freestyle_workouts: 0, additional_workouts: 0, sets_logged: 0, runs_recorded: 0,
      apple_health_workouts: 0, fit_imports: 0, intervals_activities: 0, manual_activities: 0,
      plan_changes: { app: 0, web: 0, coach: 0 }, coach_changes: 0, problem_reports: 0,
    },
    totals: {
      workouts_completed: 0, sets_logged: 0, runs_recorded: 0, apple_health_workouts: 0, fit_imports: 0,
      intervals_activities: 0, manual_activities: 0,
    },
    setup: {
      workouts: 0, weekly_routine: false, block: false, event: false, groups: 0, apple_health: false,
      apple_health_group_sharing: false, intervals: 'not_connected', whoop: 'not_connected', garmin: 'not_connected',
      ai_coach_connections: 0,
    },
    ...overrides,
  };
}

describe('members page helpers', () => {
  it('names builds as App Store or TestFlight', () => {
    expect(membersPath(30)).toBe('/api/me/diagnostics/members?days=30');
    expect(describeBuild('70')).toBe('1.1 (70, App Store)');
    expect(describeBuild('55')).toBe('1.0 (55, App Store)');
    expect(describeBuild('81')).toBe('Build 81 (TestFlight)');
    expect(describeBuild(null)).toBe('Unknown build');
    expect(describeBuildRow({ client: 'ios', build: '81', os_version: 'iOS 26.1', first_seen_at: 0, last_seen_at: 0 }))
      .toBe('App · Build 81 (TestFlight) · iOS 26.1');
    expect(describeBuildRow({ client: 'coach', build: null, os_version: null, first_seen_at: 0, last_seen_at: 0 })).toBe('AI coach');
  });

  it('says when, in words', () => {
    expect(relativeTime(null, NOW)).toBe('Never');
    expect(relativeTime(NOW - 30_000, NOW)).toBe('Just now');
    expect(relativeTime(NOW - 12 * 60_000, NOW)).toBe('12 min ago');
    expect(relativeTime(NOW - 3 * 3_600_000, NOW)).toBe('3 h ago');
    expect(relativeTime(NOW - 30 * 3_600_000, NOW)).toBe('Yesterday');
    expect(relativeTime(NOW - 5 * 86_400_000, NOW)).toBe('5 days ago');
    expect(relativeTime(Date.parse('2026-09-01T12:00:00Z'), NOW)).toBe('Sep 1, 2026');
  });

  it('names members, the owner as you', () => {
    expect(memberName({ display_name: 'Nick', is_owner: true })).toBe('Nick (you)');
    expect(memberName({ display_name: null, is_owner: false })).toBe('Unnamed member');
  });

  it('sums the columns and counts the active members', () => {
    const busy = member({
      active_days: { any: 4, ios: 3, web: 1, coach: 0 },
      recent: { ...member().recent, apple_health_workouts: 2, manual_activities: 1, plan_changes: { app: 1, web: 2, coach: 3 } },
    });
    const loggedOnly = member({ recent: { ...member().recent, runs_recorded: 1 } });
    expect(otherActivities(busy)).toBe(3);
    expect(planChanges(busy)).toBe(6);
    expect(clientsUsed(busy)).toBe('iPhone/iPad, web');
    expect(clientsUsed(member())).toBe('–');
    expect(activeMembers([busy, loggedOnly, member()])).toBe(2);
  });

  it('counts each latest build once per member', () => {
    const on = (build: string) => member({ app: { ios: { build, os_version: null, last_seen_at: NOW }, web_last_seen_at: null, coach_last_seen_at: null } });
    expect(buildsInUse([on('81'), on('70'), on('81'), member()])).toEqual([
      { build: '81', members: 2 },
      { build: '70', members: 1 },
    ]);
  });

  it('describes setup and connections', () => {
    const m = member({
      setup: { ...member().setup, workouts: 1, weekly_routine: true, groups: 2, garmin: 'needs_reconnect', ai_coach_connections: 1 },
    });
    expect(describeSetup(m)).toEqual(['1 saved workout', 'Weekly routine', '2 groups']);
    expect(describeConnections(m).map((c) => `${c.name}: ${c.state}`)).toEqual([
      'Apple Health: no workouts synced',
      'intervals.icu: not connected',
      'WHOOP: not connected',
      'Garmin: needs reconnecting',
      'AI coach: 1 connection',
    ]);
  });
});
