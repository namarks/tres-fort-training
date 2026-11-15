// The owner's Members page (docs/DIAGNOSTICS.md, "Members"): which app build
// each member runs, when they last used Tres Fort, and which features they
// use, read with the owner's own web session at
// /api/me/diagnostics/members. Pure helpers; the page is MembersPage.tsx.

export type ConnectionState = 'connected' | 'needs_reconnect' | 'not_connected';
export type UsageClient = 'ios' | 'web' | 'coach';

export interface MemberBuild {
  client: UsageClient;
  build: string | null;
  os_version: string | null;
  first_seen_at: number;
  last_seen_at: number;
}

export interface MemberUsage {
  user_id: string;
  display_name: string | null;
  is_owner: boolean;
  is_test_member: boolean;
  joined_at: number;
  last_seen_at: number | null;
  app: {
    ios: { build: string | null; os_version: string | null; last_seen_at: number } | null;
    web_last_seen_at: number | null;
    coach_last_seen_at: number | null;
  };
  builds: MemberBuild[];
  active_days: { any: number; ios: number; web: number; coach: number };
  last_workout_at: number | null;
  last_set_at: number | null;
  last_activity_date: string | null;
  recent: {
    workouts_completed: number;
    freestyle_workouts: number;
    additional_workouts: number;
    sets_logged: number;
    runs_recorded: number;
    apple_health_workouts: number;
    fit_imports: number;
    intervals_activities: number;
    manual_activities: number;
    plan_changes: { app: number; web: number; coach: number };
    coach_changes: number;
    problem_reports: number;
  };
  totals: {
    workouts_completed: number;
    sets_logged: number;
    runs_recorded: number;
    apple_health_workouts: number;
    fit_imports: number;
    intervals_activities: number;
    manual_activities: number;
  };
  setup: {
    workouts: number;
    weekly_routine: boolean;
    block: boolean;
    event: boolean;
    groups: number;
    apple_health: boolean;
    apple_health_group_sharing: boolean;
    intervals: ConnectionState;
    whoop: ConnectionState;
    garmin: ConnectionState;
    ai_coach_connections: number;
  };
}

export interface MembersResponse {
  days: number;
  since: number;
  generated_at: number;
  tracking_since: number | null;
  members: MemberUsage[];
}

export const WINDOW_CHOICES = [7, 30, 90] as const;

export const membersPath = (days: number) => `/api/me/diagnostics/members?days=${days}`;

/** Builds that went to the App Store; every other build is a TestFlight
 * beta. Add each App Store release here. */
export const APP_STORE_BUILDS: Record<string, string> = {
  '55': '1.0',
  '70': '1.1',
};

/** "Build 81 (TestFlight)" or "1.1 (70, App Store)". */
export function describeBuild(build: string | null): string {
  if (!build) return 'Unknown build';
  const store = APP_STORE_BUILDS[build];
  return store ? `${store} (${build}, App Store)` : `Build ${build} (TestFlight)`;
}

/** A member's name on the page. */
export function memberName(member: Pick<MemberUsage, 'display_name' | 'is_owner'>): string {
  if (member.is_owner) return member.display_name ? `${member.display_name} (you)` : 'You';
  return member.display_name ?? 'Unnamed member';
}

/** "just now", "12 min ago", "3 h ago", "yesterday", "5 days ago", or a date. */
export function relativeTime(ms: number | null, now = Date.now()): string {
  if (ms === null) return 'Never';
  const minutes = Math.floor((now - ms) / 60_000);
  if (minutes < 2) return 'Just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'Yesterday';
  if (days < 14) return `${days} days ago`;
  return new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

/** "Nov 13" for a civil date, or "Never". */
export function civilDate(date: string | null): string {
  if (!date) return 'Never';
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

/** Where a member uses Tres Fort, from the clients seen in the window. */
export function clientsUsed(member: MemberUsage): string {
  const parts: string[] = [];
  if (member.active_days.ios) parts.push('iPhone/iPad');
  if (member.active_days.web) parts.push('web');
  if (member.active_days.coach) parts.push('AI coach');
  return parts.join(', ') || '–';
}

/** Other activities in the window: Apple Health, .fit, intervals.icu and
 * ones logged by hand. Recorded runs are their own column. */
export function otherActivities(member: MemberUsage): number {
  const r = member.recent;
  return r.apple_health_workouts + r.fit_imports + r.intervals_activities + r.manual_activities;
}

/** Plan changes in the window, by where they were made. */
export function planChanges(member: MemberUsage): number {
  const p = member.recent.plan_changes;
  return p.app + p.web + p.coach;
}

/** What a member has set up, as short phrases. */
export function describeSetup(member: MemberUsage): string[] {
  const s = member.setup;
  const out: string[] = [];
  out.push(s.workouts === 0 ? 'No saved workouts' : `${s.workouts} saved workout${s.workouts === 1 ? '' : 's'}`);
  if (s.weekly_routine) out.push('Weekly routine');
  if (s.block) out.push('Training block');
  if (s.event) out.push('Event goal');
  if (s.groups) out.push(`${s.groups} group${s.groups === 1 ? '' : 's'}`);
  return out;
}

const CONNECTION_LABELS: Record<ConnectionState, string> = {
  connected: 'connected',
  needs_reconnect: 'needs reconnecting',
  not_connected: 'not connected',
};

/** Each connection and its state. */
export function describeConnections(member: MemberUsage): Array<{ name: string; state: string; on: boolean }> {
  const s = member.setup;
  return [
    { name: 'Apple Health', state: s.apple_health ? 'workouts synced' : 'no workouts synced', on: s.apple_health },
    { name: 'intervals.icu', state: CONNECTION_LABELS[s.intervals], on: s.intervals !== 'not_connected' },
    { name: 'WHOOP', state: CONNECTION_LABELS[s.whoop], on: s.whoop !== 'not_connected' },
    { name: 'Garmin', state: CONNECTION_LABELS[s.garmin], on: s.garmin !== 'not_connected' },
    {
      name: 'AI coach',
      state: s.ai_coach_connections ? `${s.ai_coach_connections} connection${s.ai_coach_connections === 1 ? '' : 's'}` : 'not connected',
      on: s.ai_coach_connections > 0,
    },
  ];
}

/** How many members' latest app build is each build, most members first. */
export function buildsInUse(members: MemberUsage[]): Array<{ build: string | null; members: number }> {
  const counts = new Map<string | null, number>();
  for (const m of members) {
    if (!m.app.ios) continue;
    counts.set(m.app.ios.build, (counts.get(m.app.ios.build) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([build, n]) => ({ build, members: n }))
    .sort((a, b) => b.members - a.members || Number(b.build ?? 0) - Number(a.build ?? 0));
}

/** Members who used Tres Fort in the window: seen by the app, the web or a
 * coach, or with something logged. */
export function activeMembers(members: MemberUsage[]): number {
  return members.filter((m) => m.active_days.any > 0 || m.recent.workouts_completed > 0 ||
    m.recent.sets_logged > 0 || m.recent.runs_recorded > 0 || otherActivities(m) > 0).length;
}

const CLIENT_LABELS: Record<UsageClient, string> = { ios: 'App', web: 'Web', coach: 'AI coach' };

/** One build or client row: "App · Build 81 (TestFlight) · iOS 26.1". */
export function describeBuildRow(row: MemberBuild): string {
  if (row.client !== 'ios') return CLIENT_LABELS[row.client];
  return [CLIENT_LABELS.ios, describeBuild(row.build), row.os_version].filter(Boolean).join(' · ');
}
