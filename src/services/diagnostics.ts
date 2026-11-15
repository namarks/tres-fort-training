/**
 * Owner diagnostics (docs/DIAGNOSTICS.md): a fixed list of read-only lookups
 * of the owner's own data, so a problem can be diagnosed without querying
 * the production database by hand. Served at `/diagnostics/*` with the
 * separate DIAGNOSTICS_TOKEN (for Nick's Claude threads) and at
 * `/api/me/diagnostics/*` with the owner's own app session (the web page).
 *
 * Every lookup reads the owner's rows only (the caller resolves the owner),
 * except the problem reports members send from the app (migration 0077):
 * those are every member's, and an activity a member attached is readable
 * for the 14 days their report consented to. No lookup writes training
 * data, and every lookup excludes Garmin and WHOOP activities, Garmin
 * activity files, and WHOOP recovery. Each lookup is recorded in audit_log as
 * `diagnostics_read`.
 *
 * The lookups already account for this schema's traps: a run recorded in
 * the app that dedup merged into its intervals.icu copy has `deleted_at`
 * set AND `duplicate_of` set, while a run the member deleted has only
 * `deleted_at`; every row says which as `state`.
 *
 * This module owns its SQL and imports only pure modules, never the db.ts
 * facade.
 */
import { decodeRoute, parseStoredRoute } from '../activityRoute';
import { decodeHeartRate, parseStoredHeartRate } from '../heartRateSeries';
import { parseRunLaps } from '../runLaps';
import { decodeSpeeds, parseRecordingDiagnostics } from '../recordingDiagnostics';
import { blobBytes, parseStoredContext } from '../problemReports';

/** Sources whose data stays out of every lookup (license terms). */
export const DIAGNOSTICS_EXCLUDED_SOURCES = ['garmin', 'whoop'] as const;

export const DIAGNOSTICS_LOOKUPS = {
  recordings: 'Runs recorded in the app, newest first, including ones merged into an intervals.icu copy. ?days=1..90 (14).',
  activities: 'Imported and recorded activities from every source except Garmin and WHOOP, plus activities logged by hand. ?days=1..90 (14).',
  'activities/:id': 'One activity in full: its row and provider data, the copies dedup linked to it, and for runs recorded in the app or Apple Health runs their route, laps, heart rate, pauses and GPS speed readings.',
  sessions: 'Workout sessions by date and slot, with every set (soft-deleted sets included and marked). ?days=1..90 (14).',
  audit: 'Audit records: plan changes, coach writes and other recorded actions, newest first. ?days=1..30 (7).',
  sync: 'intervals.icu connection and sync state, and how many activities each source holds in the last 30 days.',
  reports: 'Problems members reported from the app (every member), newest first: kind, message, app and device, screenshot and attached activity. ?days=1..90 (30).',
  'reports/:id': 'One report in full, with the attached activity in full (as activities/:id) while the member\'s 14-day consent lasts.',
  'reports/:id/screenshot': 'The report\'s screenshot image.',
} as const;

/** `members` is the owner's Members page only (src/services/memberUsage.ts):
 * other members' usage never reaches the token door Claude reads. */
export type DiagnosticsLookup = keyof typeof DIAGNOSTICS_LOOKUPS | 'members';

/** Who asked: Nick's Claude threads (the token) or Nick on the web page. */
export type DiagnosticsActor = 'diagnostics' | 'web' | 'ios';

const EXCLUDED_SQL = `('${DIAGNOSTICS_EXCLUDED_SOURCES.join("','")}')`;

/** A civil date `days - 1` days before `today`, so `days=1` is just today. */
export function diagnosticsSince(today: string, days: number): string {
  const [y, m, d] = today.split('-').map(Number) as [number, number, number];
  const date = new Date(Date.UTC(y, m - 1, d - (days - 1)));
  return date.toISOString().slice(0, 10);
}

/** `days` from a query string: a whole number in range, else the default. */
export function diagnosticsDays(value: string | undefined, fallback: number, max: number): number | null {
  if (value === undefined || value === '') return fallback;
  if (!/^\d{1,3}$/.test(value)) return null;
  const days = Number(value);
  return days >= 1 && days <= max ? days : null;
}

type RowState = 'shown' | 'merged_into_copy' | 'deleted_by_member';

/** What a member's activity row means, given this schema's dedup markers. */
function rowState(row: { deleted_at: number | null; duplicate_of: string | null }): RowState {
  if (row.deleted_at === null) return 'shown';
  return row.duplicate_of !== null ? 'merged_into_copy' : 'deleted_by_member';
}

function parseJson(text: unknown): unknown {
  if (typeof text !== 'string') return text ?? null;
  try { return JSON.parse(text); } catch { return text; }
}

/** Record that a lookup ran, for the visible trail every access leaves. */
export async function recordDiagnosticsRead(
  db: D1Database,
  userId: string,
  actor: DiagnosticsActor,
  lookup: DiagnosticsLookup,
  params: Record<string, string | number>,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO audit_log (id,user_id,actor,tool,args,result,created_at)
       VALUES (?1,?2,?3,'diagnostics_read',?4,NULL,?5)`,
    )
    .bind(crypto.randomUUID(), userId, actor, JSON.stringify({ lookup, ...params }), Date.now())
    .run();
}

interface RecordingListRow {
  id: string;
  recording_id: string;
  date: string;
  name: string | null;
  start_date_utc_ms: number | null;
  moving_time_sec: number | null;
  elapsed_time_sec: number | null;
  distance_m: number | null;
  average_hr: number | null;
  deleted_at: number | null;
  duplicate_of: string | null;
  synced_at: number;
  route_points: number | null;
  lap_count: number | null;
  heart_rate_points: number | null;
  pause_count: number | null;
  fix_count: number | null;
}

export async function diagnosticsRecordings(db: D1Database, userId: string, since: string) {
  const { results } = await db
    .prepare(
      `SELECT a.id, a.external_id AS recording_id, a.date, a.name, a.start_date_utc_ms,
              a.moving_time_sec, a.elapsed_time_sec, a.distance_m, a.average_hr,
              a.deleted_at, a.duplicate_of, a.synced_at,
              r.point_count AS route_points, l.lap_count, h.point_count AS heart_rate_points,
              d.pause_count, d.fix_count
         FROM external_activities a
         LEFT JOIN activity_routes r ON r.activity_id = a.id AND r.user_id = a.user_id
         LEFT JOIN activity_laps l ON l.activity_id = a.id AND l.user_id = a.user_id
         LEFT JOIN activity_heart_rates h ON h.activity_id = a.id AND h.user_id = a.user_id
         LEFT JOIN recording_diagnostics d ON d.activity_id = a.id AND d.user_id = a.user_id
        WHERE a.user_id = ?1 AND a.source = 'recording' AND a.date >= ?2
        ORDER BY a.date DESC, a.start_date_utc_ms DESC, a.id
        LIMIT 200`,
    )
    .bind(userId, since)
    .all<RecordingListRow>();
  return {
    since,
    recordings: results.map((row) => ({
      ...row,
      state: rowState(row),
      has_diagnostics: row.pause_count !== null,
    })),
  };
}

const ACTIVITY_SUMMARY_COLUMNS = `id, source, external_id, date, start_date_utc_ms, source_timezone, kind, sport, name,
  moving_time_sec, elapsed_time_sec, distance_m, average_hr, max_hr, average_watts,
  training_load, effective_load, load_method, effort, provider_effort,
  deleted_at, duplicate_of, canonical, synced_at`;

interface ActivitySummaryRow {
  id: string;
  source: string;
  deleted_at: number | null;
  duplicate_of: string | null;
  [key: string]: unknown;
}

export async function diagnosticsActivities(db: D1Database, userId: string, since: string) {
  const [external, manual] = await db.batch([
    db
      .prepare(
        `SELECT ${ACTIVITY_SUMMARY_COLUMNS} FROM external_activities
          WHERE user_id = ?1 AND date >= ?2 AND source NOT IN ${EXCLUDED_SQL}
          ORDER BY date DESC, start_date_utc_ms DESC, id
          LIMIT 500`,
      )
      .bind(userId, since),
    db
      .prepare(
        `SELECT * FROM activities WHERE user_id = ?1 AND date >= ?2
          ORDER BY date DESC, logged_at DESC, id LIMIT 500`,
      )
      .bind(userId, since),
  ]);
  return {
    since,
    excluded_sources: DIAGNOSTICS_EXCLUDED_SOURCES,
    activities: ((external?.results ?? []) as ActivitySummaryRow[]).map((row) => ({ ...row, state: rowState(row) })),
    logged_by_hand: manual?.results ?? [],
  };
}

interface DetailRow {
  activity_id: string;
  route: string | null;
  laps: string | null;
  heart_rate: string | null;
  diagnostics: string | null;
}

/** What Tres Fort keeps beside one recorded or Apple Health run. */
function detailOf(row: DetailRow) {
  const route = row.route === null ? null : parseStoredRoute(row.route);
  const heartRate = row.heart_rate === null ? null : parseStoredHeartRate(row.heart_rate);
  const diagnostics = row.diagnostics === null ? null : parseRecordingDiagnostics(row.diagnostics);
  return {
    activity_id: row.activity_id,
    // One segment per stretch of running; a pause starts a new one.
    route_segments: route
      ? decodeRoute(route).map((segment) => segment.map((p) => ({ t_ms: p.t, lat: p.lat, lon: p.lon, alt: p.alt })))
      : null,
    laps: row.laps === null ? null : parseRunLaps(row.laps),
    // Seconds of moving time from the start (pauses taken out), bpm.
    heart_rate: heartRate
      ? { start_ms: heartRate.start_ms, readings: decodeHeartRate(heartRate).map((s) => ({ moving_s: s.t, bpm: s.v })) }
      : null,
    recorder: diagnostics
      ? {
          auto_pause_on: diagnostics.auto_pause,
          pauses: diagnostics.pauses.map((p) => ({
            ...p,
            tapped: !p.automatic,
            duration_s: p.end_ms === null ? null : Math.round((p.end_ms - p.start_ms) / 100) / 10,
          })),
          gps_fixes: diagnostics.speeds ? decodeSpeeds(diagnostics.speeds) : [],
        }
      : null,
  };
}

export type DiagnosticsActivityResult =
  | { ok: true; body: Record<string, unknown> }
  | { ok: false; error: 'not_found' | 'restricted_source' };

export async function diagnosticsActivity(
  db: D1Database,
  userId: string,
  activityId: string,
): Promise<DiagnosticsActivityResult> {
  const row = await db
    .prepare('SELECT * FROM external_activities WHERE user_id = ?1 AND id = ?2')
    .bind(userId, activityId)
    .first<ActivitySummaryRow & { raw: string | null }>();
  if (!row) return { ok: false, error: 'not_found' };
  if ((DIAGNOSTICS_EXCLUDED_SOURCES as readonly string[]).includes(row.source)) {
    return { ok: false, error: 'restricted_source' };
  }
  // The copies dedup linked to it either way: rows merged into this one,
  // the row this one was merged into, and that row's other copies.
  const { results: copies } = await db
    .prepare(
      `SELECT ${ACTIVITY_SUMMARY_COLUMNS} FROM external_activities
        WHERE user_id = ?1 AND id <> ?2 AND source NOT IN ${EXCLUDED_SQL}
          AND (duplicate_of = ?2 OR id = ?3 OR (?3 IS NOT NULL AND duplicate_of = ?3))
        ORDER BY id`,
    )
    .bind(userId, activityId, row.duplicate_of)
    .all<ActivitySummaryRow>();
  const runIds = [row, ...copies]
    .filter((r) => r.source === 'recording' || r.source === 'healthkit')
    .map((r) => r.id);
  let details: ReturnType<typeof detailOf>[] = [];
  if (runIds.length > 0) {
    const { results } = await db
      .prepare(
        `SELECT a.id AS activity_id, r.route, l.laps, h.series AS heart_rate, d.diagnostics
           FROM external_activities a
           LEFT JOIN activity_routes r ON r.activity_id = a.id AND r.user_id = a.user_id
           LEFT JOIN activity_laps l ON l.activity_id = a.id AND l.user_id = a.user_id
           LEFT JOIN activity_heart_rates h ON h.activity_id = a.id AND h.user_id = a.user_id
           LEFT JOIN recording_diagnostics d ON d.activity_id = a.id AND d.user_id = a.user_id
          WHERE a.user_id = ?1 AND a.id IN (SELECT value FROM json_each(?2))
          ORDER BY a.id`,
      )
      .bind(userId, JSON.stringify(runIds))
      .all<DetailRow>();
    details = results.map(detailOf);
  }
  const { raw, ...fields } = row;
  return {
    ok: true,
    body: {
      activity: { ...fields, state: rowState(row), raw: parseJson(raw) },
      copies: copies.map((copy) => ({ ...copy, state: rowState(copy) })),
      run_details: details,
    },
  };
}

export async function diagnosticsSessions(db: D1Database, userId: string, since: string) {
  const [sessions, sets] = await db.batch([
    db
      .prepare(
        `SELECT * FROM sessions WHERE user_id = ?1 AND date >= ?2
          ORDER BY date DESC, slot, id LIMIT 300`,
      )
      .bind(userId, since),
    db
      .prepare(
        `SELECT s.* FROM set_logs s JOIN sessions x ON x.id = s.session_id
          WHERE s.user_id = ?1 AND x.user_id = ?1 AND x.date >= ?2
          ORDER BY s.session_id, s.logged_at, s.id LIMIT 5000`,
      )
      .bind(userId, since),
  ]);
  const bySession = new Map<string, Record<string, unknown>[]>();
  for (const set of (sets?.results ?? []) as Record<string, unknown>[]) {
    const key = String(set.session_id);
    const list = bySession.get(key) ?? [];
    list.push({ ...set, deleted: set.deleted_at !== null });
    bySession.set(key, list);
  }
  return {
    since,
    sessions: ((sessions?.results ?? []) as Record<string, unknown>[]).map((session) => ({
      ...session,
      sets: bySession.get(String(session.id)) ?? [],
    })),
  };
}

export async function diagnosticsAudit(db: D1Database, userId: string, sinceMs: number) {
  const { results } = await db
    .prepare(
      `SELECT id, actor, tool, args, result, created_at FROM audit_log
        WHERE user_id = ?1 AND created_at >= ?2 AND tool <> 'diagnostics_read'
        ORDER BY created_at DESC, id LIMIT 500`,
    )
    .bind(userId, sinceMs)
    .all<{ args: string | null; result: string | null; [key: string]: unknown }>();
  return {
    since_ms: sinceMs,
    records: results.map((row) => ({ ...row, args: parseJson(row.args), result: parseJson(row.result) })),
  };
}

export async function diagnosticsSync(db: D1Database, userId: string, since: string) {
  const [user, counts] = await db.batch([
    db
      .prepare(
        `SELECT COALESCE(intervals_cutover_athlete_id, intervals_athlete_id) AS intervals_athlete_id,
                intervals_auth_error_at, intervals_credential_generation,
                intervals_activities_synced_at, intervals_activities_sync_attempt,
                intervals_events_synced_at, intervals_events_sync_attempt,
                intervals_oauth_expires_at,
                (intervals_oauth_access_token IS NOT NULL) AS intervals_oauth,
                (intervals_api_key IS NOT NULL) AS intervals_api_key,
                share_health_activities
           FROM users WHERE id = ?1`,
      )
      .bind(userId),
    db
      .prepare(
        `SELECT source,
                COUNT(*) AS rows,
                SUM(deleted_at IS NULL) AS shown,
                SUM(deleted_at IS NOT NULL AND duplicate_of IS NOT NULL) AS merged_into_copy,
                SUM(deleted_at IS NOT NULL AND duplicate_of IS NULL) AS deleted_by_member,
                MAX(synced_at) AS last_synced_at
           FROM external_activities
          WHERE user_id = ?1 AND date >= ?2 AND source NOT IN ${EXCLUDED_SQL}
          GROUP BY source ORDER BY source`,
      )
      .bind(userId, since),
  ]);
  const intervals = (user?.results?.[0] ?? null) as Record<string, unknown> | null;
  return {
    since,
    intervals: intervals && {
      ...intervals,
      connected: intervals.intervals_athlete_id !== null,
      needs_reauth: intervals.intervals_auth_error_at !== null,
      intervals_oauth: intervals.intervals_oauth === 1,
      intervals_api_key: intervals.intervals_api_key === 1,
    },
    sources_last_30_days: counts?.results ?? [],
    excluded_sources: DIAGNOSTICS_EXCLUDED_SOURCES,
  };
}

interface ReportRow {
  id: string;
  user_id: string;
  display_name: string | null;
  kind: string;
  message: string;
  contact: string | null;
  activity_id: string | null;
  activity_access_until: number | null;
  context: string;
  has_screenshot: number;
  created_at: number;
}

const REPORT_COLUMNS = `r.id, r.user_id, u.display_name, r.kind, r.message, r.contact, r.activity_id,
  r.activity_access_until, r.context, r.has_screenshot, r.created_at`;

/** An attached activity's access: open until a time, or expired. */
function activityAccess(row: ReportRow, now: number) {
  if (row.activity_id === null || row.activity_access_until === null) return null;
  return row.activity_access_until > now
    ? { status: 'open' as const, until: row.activity_access_until }
    : { status: 'expired' as const, until: row.activity_access_until };
}

function reportOf(row: ReportRow, ownerId: string, now: number) {
  return {
    id: row.id,
    created_at: row.created_at,
    kind: row.kind,
    member: { user_id: row.user_id, display_name: row.display_name, is_owner: row.user_id === ownerId },
    message: row.message,
    contact: row.contact,
    context: parseStoredContext(row.context),
    has_screenshot: row.has_screenshot === 1,
    activity_id: row.activity_id,
    activity_access: activityAccess(row, now),
  };
}

/** Every member's reports since a time, newest first. */
export async function diagnosticsReports(db: D1Database, ownerId: string, sinceMs: number, now = Date.now()) {
  const { results } = await db
    .prepare(
      `SELECT ${REPORT_COLUMNS} FROM problem_reports r JOIN users u ON u.id = r.user_id
        WHERE r.created_at >= ?1 ORDER BY r.created_at DESC, r.id LIMIT 500`,
    )
    .bind(sinceMs)
    .all<ReportRow>();
  return { reports: results.map((row) => reportOf(row, ownerId, now)) };
}

export type DiagnosticsReportResult =
  | { ok: true; body: Record<string, unknown>; memberId: string }
  | { ok: false; error: 'not_found' };

/**
 * One report, with its attached activity in full while the member's
 * consent lasts. A member's own delete of the activity ends access too.
 */
export async function diagnosticsReport(
  db: D1Database,
  ownerId: string,
  reportId: string,
  now = Date.now(),
): Promise<DiagnosticsReportResult> {
  const row = await db
    .prepare(`SELECT ${REPORT_COLUMNS} FROM problem_reports r JOIN users u ON u.id = r.user_id WHERE r.id = ?1`)
    .bind(reportId)
    .first<ReportRow>();
  if (!row) return { ok: false, error: 'not_found' };
  const report = reportOf(row, ownerId, now);
  let activity: Record<string, unknown> | null = null;
  if (report.activity_access?.status === 'expired') {
    activity = { available: false, reason: 'consent_expired' };
  } else if (report.activity_access?.status === 'open' && row.activity_id !== null) {
    const found = await diagnosticsActivity(db, row.user_id, row.activity_id);
    if (!found.ok) {
      activity = { available: false, reason: found.error };
    } else if ((found.body.activity as { state: RowState }).state === 'deleted_by_member') {
      activity = { available: false, reason: 'deleted_by_member' };
    } else {
      activity = { available: true, ...found.body };
    }
  }
  return { ok: true, body: { report, activity }, memberId: row.user_id };
}

/** A report's screenshot, or null. */
export async function diagnosticsReportScreenshot(
  db: D1Database,
  reportId: string,
): Promise<{ contentType: string; bytes: Uint8Array } | null> {
  const row = await db
    .prepare('SELECT content_type, bytes FROM problem_report_screenshots WHERE report_id = ?1')
    .bind(reportId)
    .first<{ content_type: string; bytes: ArrayBuffer | number[] | Uint8Array }>();
  if (!row) return null;
  return { contentType: row.content_type, bytes: blobBytes(row.bytes) };
}

