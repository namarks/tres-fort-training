/**
 * Member usage (docs/DIAGNOSTICS.md, "Members"): which app build each member
 * runs, when they last used Tres Fort, and which features they use, for the
 * owner's Members page on the web.
 *
 * Two halves:
 *
 *  - `recordAppUse` keeps the smallest trace of a signed-in request
 *    (migration 0078): the member, the client (the iOS app, the web app or
 *    an AI coaching connection), the app's build and iOS version read from
 *    the request's standard User-Agent, and the UTC day. It writes at most
 *    once per member, client and build every few minutes per isolate, never
 *    fails the request, and stores no path, IP address or training data.
 *  - `memberUsage` reads that trace together with counts from the training
 *    tables. Garmin and WHOOP stay out of every count (their licenses); the
 *    page shows only whether each is connected.
 *
 * This module owns its SQL and imports only pure modules, never the db.ts
 * facade.
 */
import { APP_REVIEW_SUB } from '../appReview';
import { parsePlanMeta } from '../types';

/** The external id prefix of activities Tres Fort writes to intervals.icu
 * (`TRES_FORT_ACTIVITY_PREFIX` in src/services/intervalsActivityWrite.ts,
 * repeated here so this module imports no service). */
const TRES_FORT_ACTIVITY_PREFIX = 'tresfort:activity:';

export type AppUseClient = 'ios' | 'web' | 'coach';

/** Sources whose data stays out of every count (license terms). */
const EXCLUDED_SOURCES_SQL = "('garmin','whoop')";

const DAY_MS = 24 * 60 * 60 * 1000;

/** How long a recorded use stands before the same member, client and build
 * is written again. Last-seen times are this precise. */
export const APP_USE_WRITE_INTERVAL_MS = 5 * 60 * 1000;

const MAX_THROTTLE_KEYS = 5000;
const lastWritten = new Map<string, number>();

/** Forget the in-memory write throttle (tests). */
export function resetAppUseThrottle(): void {
  lastWritten.clear();
}

/**
 * The app's build and iOS version from the User-Agent iOS sends by default:
 * `TresFort/81 CFNetwork/3826.500.111 Darwin/25.1.0`. Every build sends it,
 * including the App Store builds that predate this page, so no app update is
 * needed. The iOS version comes from Darwin's (Darwin 24.4 is iOS 18.4,
 * Darwin 25.1 is iOS 26.1); a point release may read one lower.
 */
export function parseIosUserAgent(userAgent: string | null | undefined): { build: string | null; osVersion: string | null } {
  if (!userAgent) return { build: null, osVersion: null };
  const app = /^[^\s/]{1,64}\/(\d{1,6}(?:\.\d{1,6}){0,2})\s+CFNetwork\//.exec(userAgent);
  const darwin = /\bDarwin\/(\d{1,3})\.(\d{1,3})/.exec(userAgent);
  let osVersion: string | null = null;
  if (darwin) {
    const major = Number(darwin[1]);
    const minor = Number(darwin[2]);
    // Darwin 19-24 were iOS 13-18; iOS 26 (Darwin 25) jumped to the year.
    const ios = major >= 25 ? major + 1 : major >= 19 ? major - 6 : null;
    if (ios !== null) osVersion = `iOS ${ios}.${minor}`;
  }
  return { build: app ? app[1]! : null, osVersion };
}

/**
 * Record that a member used a client now. Best-effort: a failure (such as
 * the migration not applied yet) is logged and swallowed, never thrown.
 */
export async function recordAppUse(
  db: D1Database,
  userId: string,
  client: AppUseClient,
  userAgent: string | null | undefined,
  now = Date.now(),
): Promise<void> {
  const parsed = client === 'ios' ? parseIosUserAgent(userAgent) : { build: null, osVersion: null };
  const build = parsed.build ?? '';
  const day = new Date(now).toISOString().slice(0, 10);
  // The day is in the key so the first use after UTC midnight always lands.
  const key = `${userId}|${client}|${build}|${day}`;
  const previous = lastWritten.get(key);
  if (previous !== undefined && now - previous < APP_USE_WRITE_INTERVAL_MS) return;
  if (lastWritten.size >= MAX_THROTTLE_KEYS) lastWritten.clear();
  lastWritten.set(key, now);
  try {
    await db.batch([
      db
        .prepare(
          `INSERT INTO member_app_use (user_id, client, build, os_version, first_seen_at, last_seen_at)
           VALUES (?1, ?2, ?3, ?4, ?5, ?5)
           ON CONFLICT (user_id, client, build) DO UPDATE
              SET last_seen_at = excluded.last_seen_at,
                  os_version = COALESCE(excluded.os_version, member_app_use.os_version)
            WHERE excluded.last_seen_at > member_app_use.last_seen_at`,
        )
        .bind(userId, client, build, parsed.osVersion, now),
      db
        .prepare('INSERT OR IGNORE INTO member_active_days (user_id, day, client) VALUES (?1, ?2, ?3)')
        .bind(userId, day, client),
    ]);
  } catch (error) {
    lastWritten.delete(key);
    console.warn({ event: 'record_app_use_failed', message: error instanceof Error ? error.message : String(error) });
  }
}

/** `days` for the Members page: a whole number from 1 to 365, default 30. */
export function memberUsageDays(value: string | undefined): number | null {
  if (value === undefined || value === '') return 30;
  if (!/^\d{1,3}$/.test(value)) return null;
  const days = Number(value);
  return days >= 1 && days <= 365 ? days : null;
}

type Row = Record<string, unknown>;

const num = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) ? value : 0);
const numOrNull = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null);
const strOrNull = (value: unknown): string | null => (typeof value === 'string' ? value : null);

function maxOf(...values: Array<number | null>): number | null {
  const present = values.filter((v): v is number => v !== null);
  return present.length ? Math.max(...present) : null;
}

/** Group rows by `user_id`. */
function byUser(rows: Row[]): Map<string, Row[]> {
  const out = new Map<string, Row[]>();
  for (const row of rows) {
    const id = String(row.user_id);
    const list = out.get(id);
    if (list) list.push(row);
    else out.set(id, [row]);
  }
  return out;
}

/** One `user_id` row per member. */
function oneByUser(rows: Row[]): Map<string, Row> {
  return new Map(rows.map((row) => [String(row.user_id), row]));
}

/** A UTC civil date the given number of milliseconds ago. */
function utcDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** Activity sources the page counts, and their labels in the response. */
const SOURCE_KEYS: Record<string, string> = {
  recording: 'runs_recorded',
  healthkit: 'apple_health_workouts',
  fit: 'fit_imports',
  intervals: 'intervals_activities',
};

/** Whether a plan's weekly routine has anything on it. */
function hasRoutine(meta: ReturnType<typeof parsePlanMeta>): boolean {
  const week = meta.schedule?.week as Record<string, unknown> | undefined;
  const extras = meta.schedule?.extras as Record<string, unknown> | undefined;
  return Object.values(week ?? {}).some((v) => v !== null && v !== undefined) ||
    Object.values(extras ?? {}).some((v) => Array.isArray(v) && v.length > 0);
}

/**
 * Every member's usage: the app builds and clients they use, active days
 * and feature counts in the last `days` days, all-time totals for the main
 * training actions, and what they have set up now. Newest activity first.
 */
export async function memberUsage(
  db: D1Database,
  ownerId: string,
  days: number,
  testMemberPrefix: string,
  now = Date.now(),
) {
  const sinceMs = now - days * DAY_MS;
  // One day of slack, so every member's local "today" counts.
  const sinceDay = utcDay(sinceMs - DAY_MS);
  // Active days are UTC dates already: exactly `days` of them, today included.
  const activeSinceDay = utcDay(now - (days - 1) * DAY_MS);
  const results = await db.batch([
    db.prepare(
      `SELECT id AS user_id, display_name, apple_sub, created_at,
              COALESCE(intervals_cutover_athlete_id, intervals_athlete_id) IS NOT NULL AS intervals_connected,
              intervals_auth_error_at IS NOT NULL AS intervals_needs_reauth,
              share_health_activities
         FROM users WHERE apple_sub <> ?1`,
    ).bind(APP_REVIEW_SUB),
    db.prepare('SELECT user_id, client, build, os_version, first_seen_at, last_seen_at FROM member_app_use'),
    db.prepare(
      `SELECT user_id, client, COUNT(*) AS days FROM member_active_days
        WHERE day >= ?1 GROUP BY user_id, client`,
    ).bind(activeSinceDay),
    db.prepare(
      `SELECT user_id, COUNT(DISTINCT day) AS days FROM member_active_days
        WHERE day >= ?1 GROUP BY user_id`,
    ).bind(activeSinceDay),
    db.prepare(
      `SELECT user_id, COUNT(*) AS total, SUM(completed_at >= ?1) AS recent,
              SUM(completed_at >= ?1 AND kind = 'freestyle') AS recent_freestyle,
              SUM(completed_at >= ?1 AND slot > 0) AS recent_additional,
              MAX(completed_at) AS last
         FROM sessions WHERE status = 'completed' GROUP BY user_id`,
    ).bind(sinceMs),
    db.prepare(
      `SELECT s.user_id, COUNT(*) AS total, SUM(l.logged_at >= ?1) AS recent, MAX(l.logged_at) AS last
         FROM set_logs l JOIN sessions s ON s.id = l.session_id
        WHERE l.deleted_at IS NULL GROUP BY s.user_id`,
    ).bind(sinceMs),
    // A run dedup merged into its intervals.icu copy was still recorded, so
    // only a member's own delete leaves a row out.
    // A run, ride, swim or walk typed in by hand goes to intervals.icu
    // (src/services/intervalsActivityWrite.ts) and syncs back carrying the
    // external id Tres Fort gave it: count those as logged by hand.
    db.prepare(
      `SELECT user_id,
              CASE WHEN source = 'intervals' AND json_valid(raw)
                        AND json_extract(raw, '$.external_id') LIKE '${TRES_FORT_ACTIVITY_PREFIX}%'
                   THEN 'by_hand' ELSE source END AS source,
              COUNT(*) AS total, SUM(date >= ?1) AS recent, MAX(date) AS last
         FROM external_activities
        WHERE source NOT IN ${EXCLUDED_SOURCES_SQL}
          AND (deleted_at IS NULL OR duplicate_of IS NOT NULL)
        GROUP BY 1, 2`,
    ).bind(sinceDay),
    db.prepare(
      `SELECT user_id, COUNT(*) AS total, SUM(date >= ?1) AS recent, MAX(date) AS last
         FROM activities WHERE deleted_at IS NULL GROUP BY user_id`,
    ).bind(sinceDay),
    db.prepare(
      `SELECT p.user_id, p.meta,
              (SELECT COUNT(*) FROM workouts w
                WHERE w.plan_id = p.id AND w.archived_at IS NULL AND w.one_time_date IS NULL) AS workouts
         FROM plans p WHERE p.status = 'active'`,
    ),
    db.prepare(
      `SELECT user_id, actor, COUNT(*) AS n FROM plan_snapshots
        WHERE created_at >= ?1 GROUP BY user_id, actor`,
    ).bind(sinceMs),
    db.prepare(
      `SELECT user_id, COUNT(*) AS n FROM audit_log
        WHERE actor = 'mcp' AND created_at >= ?1 GROUP BY user_id`,
    ).bind(sinceMs),
    db.prepare(
      `SELECT user_id, COUNT(*) AS n FROM oauth_grants
        WHERE user_id IS NOT NULL AND revoked_at IS NULL
          AND (inactivity_expires_at IS NULL OR inactivity_expires_at > ?1)
          AND (absolute_expires_at IS NULL OR absolute_expires_at > ?1)
        GROUP BY user_id`,
    ).bind(now),
    db.prepare('SELECT user_id, provider, auth_error_at FROM provider_connections'),
    db.prepare('SELECT user_id, COUNT(*) AS n FROM group_members GROUP BY user_id'),
    db.prepare(
      `SELECT user_id, COUNT(*) AS n FROM problem_reports
        WHERE created_at >= ?1 GROUP BY user_id`,
    ).bind(sinceMs),
  ]);
  const rows = (i: number): Row[] => (results[i]?.results ?? []) as Row[];
  const users = rows(0);
  const appUse = byUser(rows(1));
  const activeByClient = byUser(rows(2));
  const activeDays = oneByUser(rows(3));
  const sessions = oneByUser(rows(4));
  const sets = oneByUser(rows(5));
  const activitySources = byUser(rows(6));
  const manual = oneByUser(rows(7));
  const plans = oneByUser(rows(8));
  const planEdits = byUser(rows(9));
  const coachChanges = oneByUser(rows(10));
  const coachGrants = oneByUser(rows(11));
  const providers = byUser(rows(12));
  const groups = oneByUser(rows(13));
  const reports = oneByUser(rows(14));

  let trackingSince: number | null = null;
  const members = users.map((user) => {
    const id = String(user.user_id);
    const builds = (appUse.get(id) ?? [])
      .map((row) => ({
        client: String(row.client) as AppUseClient,
        build: strOrNull(row.build) || null,
        os_version: strOrNull(row.os_version),
        first_seen_at: num(row.first_seen_at),
        last_seen_at: num(row.last_seen_at),
      }))
      .sort((a, b) => b.last_seen_at - a.last_seen_at);
    for (const b of builds) trackingSince = trackingSince === null ? b.first_seen_at : Math.min(trackingSince, b.first_seen_at);
    const lastSeen = (client: AppUseClient) =>
      maxOf(...builds.filter((b) => b.client === client).map((b) => b.last_seen_at));
    const latestIos = builds.find((b) => b.client === 'ios') ?? null;
    const clientDays = Object.fromEntries((activeByClient.get(id) ?? []).map((r) => [String(r.client), num(r.days)]));

    const sources = Object.fromEntries((activitySources.get(id) ?? []).map((r) => [String(r.source), r]));
    const sourceCounts = (key: 'recent' | 'total') => Object.fromEntries(
      Object.entries(SOURCE_KEYS).map(([source, label]) => [label, num(sources[source]?.[key])]),
    );
    const lastActivityDate = Object.values(sources)
      .map((r) => strOrNull(r.last))
      .concat(strOrNull(manual.get(id)?.last))
      .filter((d): d is string => d !== null)
      .sort()
      .pop() ?? null;

    const edits = Object.fromEntries((planEdits.get(id) ?? []).map((r) => [String(r.actor), num(r.n)]));
    const plan = plans.get(id);
    const meta = plan ? parsePlanMeta(strOrNull(plan.meta)) : null;
    const connected = new Map((providers.get(id) ?? []).map((r) => [String(r.provider), r]));
    const session = sessions.get(id);
    const set = sets.get(id);

    return {
      user_id: id,
      display_name: strOrNull(user.display_name),
      is_owner: id === ownerId,
      is_test_member: typeof user.apple_sub === 'string' && user.apple_sub.startsWith(testMemberPrefix),
      joined_at: num(user.created_at),
      last_seen_at: maxOf(lastSeen('ios'), lastSeen('web'), lastSeen('coach')),
      app: {
        ios: latestIos && { build: latestIos.build, os_version: latestIos.os_version, last_seen_at: latestIos.last_seen_at },
        web_last_seen_at: lastSeen('web'),
        coach_last_seen_at: lastSeen('coach'),
      },
      builds,
      active_days: {
        any: num(activeDays.get(id)?.days),
        ios: clientDays.ios ?? 0,
        web: clientDays.web ?? 0,
        coach: clientDays.coach ?? 0,
      },
      last_workout_at: numOrNull(session?.last),
      last_set_at: numOrNull(set?.last),
      last_activity_date: lastActivityDate,
      recent: {
        workouts_completed: num(session?.recent),
        freestyle_workouts: num(session?.recent_freestyle),
        additional_workouts: num(session?.recent_additional),
        sets_logged: num(set?.recent),
        ...sourceCounts('recent'),
        manual_activities: num(manual.get(id)?.recent) + num(sources.by_hand?.recent),
        plan_changes: { app: edits.ios ?? 0, web: edits.web ?? 0, coach: edits.mcp ?? 0 },
        coach_changes: num(coachChanges.get(id)?.n),
        problem_reports: num(reports.get(id)?.n),
      },
      totals: {
        workouts_completed: num(session?.total),
        sets_logged: num(set?.total),
        ...sourceCounts('total'),
        manual_activities: num(manual.get(id)?.total) + num(sources.by_hand?.total),
      },
      setup: {
        workouts: num(plan?.workouts),
        weekly_routine: meta ? hasRoutine(meta) : false,
        block: Boolean(meta?.program),
        event: Boolean(meta?.race),
        groups: num(groups.get(id)?.n),
        apple_health: num(sources.healthkit?.total) > 0,
        apple_health_group_sharing: user.share_health_activities === 1,
        // An expired or revoked credential clears the athlete id and sets the
        // error, so the error comes first (as on the member's Profile).
        intervals: user.intervals_needs_reauth === 1 ? 'needs_reconnect'
          : user.intervals_connected === 1 ? 'connected' : 'not_connected',
        whoop: connected.has('whoop') ? (connected.get('whoop')!.auth_error_at ? 'needs_reconnect' : 'connected') : 'not_connected',
        garmin: connected.has('garmin') ? (connected.get('garmin')!.auth_error_at ? 'needs_reconnect' : 'connected') : 'not_connected',
        ai_coach_connections: num(coachGrants.get(id)?.n),
      },
    };
  });

  members.sort((a, b) =>
    (b.last_seen_at ?? -1) - (a.last_seen_at ?? -1) ||
    (b.last_workout_at ?? -1) - (a.last_workout_at ?? -1) ||
    b.joined_at - a.joined_at);

  return {
    days,
    since: sinceMs,
    generated_at: now,
    tracking_since: trackingSince,
    excluded_sources: ['garmin', 'whoop'],
    members,
  };
}
