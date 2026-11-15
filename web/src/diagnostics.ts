// The owner's diagnostics page (docs/DIAGNOSTICS.md): the same fixed,
// read-only lookups the diagnostics token opens, read with the owner's own
// web session at /api/me/diagnostics/*, plus the problems members report
// from the app. Pure helpers; the page is DiagnosticsPage.tsx.

export type LookupKey = 'reports' | 'recordings' | 'activities' | 'sessions' | 'audit' | 'sync';

export interface LookupChoice {
  key: LookupKey;
  label: string;
  /** Default and largest day window; null for a lookup without one. */
  days: { fallback: number; max: number } | null;
}

export const LOOKUP_CHOICES: LookupChoice[] = [
  { key: 'reports', label: 'Problem reports', days: { fallback: 30, max: 90 } },
  { key: 'recordings', label: 'Recorded runs', days: { fallback: 14, max: 90 } },
  { key: 'activities', label: 'Activities', days: { fallback: 14, max: 90 } },
  { key: 'sessions', label: 'Workouts', days: { fallback: 14, max: 90 } },
  { key: 'audit', label: 'Audit trail', days: { fallback: 7, max: 30 } },
  { key: 'sync', label: 'Sync', days: null },
];

/** The API path of a list lookup, its day window clamped to what it allows. */
export function lookupPath(choice: LookupChoice, days: number): string {
  const base = `/api/me/diagnostics/${choice.key}`;
  if (!choice.days) return base;
  const whole = Number.isFinite(days) ? Math.round(days) : choice.days.fallback;
  return `${base}?days=${Math.min(Math.max(whole, 1), choice.days.max)}`;
}

/** The API path of one activity in full. */
export const activityPath = (id: string) => `/api/me/diagnostics/activities/${encodeURIComponent(id)}`;

/** The API path of one problem report in full. */
export const reportPath = (id: string) => `/api/me/diagnostics/reports/${encodeURIComponent(id)}`;

export const REPORT_KIND_LABELS: Record<string, string> = {
  bug: 'Something isn’t working',
  activity: 'An activity looks wrong',
  feedback: 'Feedback or an idea',
};

export interface ReportRow {
  id: string;
  created_at: number;
  kind: string;
  member: { user_id: string; display_name: string | null; is_owner: boolean };
  message: string;
  contact: string | null;
  context: { platform?: string | null; app_version?: string | null; build?: string | null;
    os_version?: string | null; device?: string | null; screen?: string | null } | null;
  has_screenshot: boolean;
  activity_id: string | null;
  activity_access: { status: 'open' | 'expired'; until: number } | null;
}

/** "1.2 (80) · iOS 26.1 · iPhone14,2" from a report's context. */
export function describeReportContext(context: ReportRow['context']): string {
  if (!context) return 'No app details';
  const version = context.app_version
    ? `${context.app_version}${context.build ? ` (${context.build})` : ''}`
    : null;
  return [version, context.os_version, context.device].filter(Boolean).join(' · ') || 'No app details';
}

/** Whether support may still open the attached activity, in words. */
export function describeActivityAccess(report: ReportRow, now = Date.now()): string | null {
  if (!report.activity_id || !report.activity_access) return null;
  if (report.activity_access.status === 'expired' || report.activity_access.until <= now) {
    return 'Activity attached; the member’s 14 days have passed';
  }
  const days = Math.max(1, Math.ceil((report.activity_access.until - now) / 86_400_000));
  return `Activity attached; readable for ${days} more day${days === 1 ? '' : 's'}`;
}

export interface PauseRow {
  start_ms: number;
  end_ms: number | null;
  automatic: boolean;
  tapped: boolean;
  duration_s: number | null;
}

/** "7:57:12 PM · 42 s · tapped" for one pause, in the viewer's time zone. */
export function describePause(pause: PauseRow, timeZone?: string): string {
  const at = new Date(pause.start_ms).toLocaleTimeString('en-US', {
    hour: 'numeric', minute: '2-digit', second: '2-digit', ...(timeZone ? { timeZone } : {}),
  });
  const length = pause.duration_s === null ? 'still paused' : `${Math.round(pause.duration_s)} s`;
  return `${at} · ${length} · ${pause.automatic ? 'auto-pause' : 'tapped'}`;
}

/** What a row's dedup markers mean, in words. */
export const STATE_LABELS: Record<string, string> = {
  shown: 'Shown',
  merged_into_copy: 'Merged into another copy',
  deleted_by_member: 'Deleted by the member',
};

/** A file name for a downloaded lookup. */
export function downloadName(label: string, now = new Date()): string {
  const stamp = now.toISOString().slice(0, 19).replace(/[:T]/g, '-');
  return `tres-fort-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}-${stamp}.json`;
}
