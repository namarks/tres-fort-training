/**
 * Problems members report from the app (migration 0077, docs/DIAGNOSTICS.md).
 * A report is kept once per client id; a retry returns the first one. An
 * attached activity must be the member's own and not from Garmin or WHOOP
 * (license terms); otherwise the report is kept without it, so a report is
 * never lost. Owner reads live in src/services/diagnostics.ts.
 *
 * This module owns its SQL and imports only pure modules, never the db.ts
 * facade.
 */
import { PROBLEM_REPORT_LIMITS, type ProblemReportInput, type ScreenshotType } from '../problemReports';
import { DIAGNOSTICS_EXCLUDED_SOURCES } from './diagnostics';

export interface ProblemReportScreenshot {
  contentType: ScreenshotType;
  bytes: Uint8Array;
}

export interface SubmittedProblemReport {
  id: string;
  created_at: number;
  activity_attached: boolean;
  /** Why an activity the app sent was left off: `not_found` or `restricted_source`. */
  activity_ignored?: 'not_found' | 'restricted_source';
  activity_access_until: number | null;
  has_screenshot: boolean;
}

export type SubmitProblemReportResult =
  | { ok: true; report: SubmittedProblemReport; deduplicated: boolean }
  | { ok: false; error: 'id_conflict' | 'rate_limited' };

interface StoredRow {
  user_id: string;
  created_at: number;
  activity_id: string | null;
  activity_access_until: number | null;
  has_screenshot: number;
}

function submitted(id: string, row: StoredRow): SubmittedProblemReport {
  return {
    id,
    created_at: row.created_at,
    activity_attached: row.activity_id !== null,
    activity_access_until: row.activity_access_until,
    has_screenshot: row.has_screenshot === 1,
  };
}

export async function submitProblemReport(
  db: D1Database,
  userId: string,
  input: ProblemReportInput,
  screenshot: ProblemReportScreenshot | null,
  now: number = Date.now(),
): Promise<SubmitProblemReportResult> {
  const existing = await db
    .prepare('SELECT user_id, created_at, activity_id, activity_access_until, has_screenshot FROM problem_reports WHERE id = ?1')
    .bind(input.id)
    .first<StoredRow>();
  if (existing) {
    if (existing.user_id !== userId) return { ok: false, error: 'id_conflict' };
    return { ok: true, report: submitted(input.id, existing), deduplicated: true };
  }
  const recent = await db
    .prepare('SELECT COUNT(*) AS n FROM problem_reports WHERE user_id = ?1 AND created_at > ?2')
    .bind(userId, now - 24 * 60 * 60 * 1000)
    .first<{ n: number }>();
  if ((recent?.n ?? 0) >= PROBLEM_REPORT_LIMITS.perDay) return { ok: false, error: 'rate_limited' };

  let activityId: string | null = null;
  let ignored: SubmittedProblemReport['activity_ignored'];
  if (input.activity_id !== null) {
    const activity = await db
      .prepare('SELECT source FROM external_activities WHERE id = ?1 AND user_id = ?2')
      .bind(input.activity_id, userId)
      .first<{ source: string }>();
    if (!activity) ignored = 'not_found';
    else if ((DIAGNOSTICS_EXCLUDED_SOURCES as readonly string[]).includes(activity.source)) ignored = 'restricted_source';
    else activityId = input.activity_id;
  }
  const accessUntil = activityId === null ? null : now + PROBLEM_REPORT_LIMITS.activityAccessMs;
  const statements = [
    db
      .prepare(
        `INSERT INTO problem_reports
           (id,user_id,kind,message,contact,activity_id,activity_access_until,context,has_screenshot,created_at)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)
         ON CONFLICT(id) DO NOTHING`,
      )
      .bind(input.id, userId, input.kind, input.message, input.contact, activityId, accessUntil,
        JSON.stringify(input.context), screenshot ? 1 : 0, now),
  ];
  if (screenshot) {
    statements.push(
      db
        .prepare(
          `INSERT INTO problem_report_screenshots (report_id,content_type,bytes)
           SELECT ?1, ?2, ?3 WHERE EXISTS (SELECT 1 FROM problem_reports WHERE id = ?1 AND user_id = ?4)
           ON CONFLICT(report_id) DO NOTHING`,
        )
        .bind(input.id, screenshot.contentType, screenshot.bytes, userId),
    );
  }
  const [inserted] = await db.batch(statements);
  if ((inserted?.meta.changes ?? 0) === 0) {
    // A concurrent retry stored it first.
    const row = await db
      .prepare('SELECT user_id, created_at, activity_id, activity_access_until, has_screenshot FROM problem_reports WHERE id = ?1')
      .bind(input.id)
      .first<StoredRow>();
    if (!row || row.user_id !== userId) return { ok: false, error: 'id_conflict' };
    return { ok: true, report: submitted(input.id, row), deduplicated: true };
  }
  const report: SubmittedProblemReport = {
    id: input.id,
    created_at: now,
    activity_attached: activityId !== null,
    activity_access_until: accessUntil,
    has_screenshot: screenshot !== null,
  };
  if (ignored) report.activity_ignored = ignored;
  return { ok: true, report, deduplicated: false };
}
