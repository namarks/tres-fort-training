import { describe, expect, it } from 'vitest';
import {
  activityPath, describeActivityAccess, describePause, describeReportContext, downloadName, LOOKUP_CHOICES, lookupPath, reportPath,
  type ReportRow,
} from '../src/diagnostics';

describe('owner diagnostics page helpers', () => {
  const choice = (key: string) => LOOKUP_CHOICES.find((c) => c.key === key)!;

  it('builds lookup paths with the day window clamped', () => {
    expect(lookupPath(choice('recordings'), 14)).toBe('/api/me/diagnostics/recordings?days=14');
    expect(lookupPath(choice('recordings'), 500)).toBe('/api/me/diagnostics/recordings?days=90');
    expect(lookupPath(choice('audit'), 0)).toBe('/api/me/diagnostics/audit?days=1');
    expect(lookupPath(choice('audit'), Number.NaN)).toBe('/api/me/diagnostics/audit?days=7');
    expect(lookupPath(choice('sync'), 14)).toBe('/api/me/diagnostics/sync');
    expect(activityPath('recording:activity:u:1')).toBe('/api/me/diagnostics/activities/recording%3Aactivity%3Au%3A1');
  });

  it('describes a pause as tapped or automatic', () => {
    const start = Date.parse('2026-11-11T03:57:12Z');
    expect(describePause({ start_ms: start, end_ms: start + 42_000, automatic: false, tapped: true, duration_s: 42 }, 'America/Los_Angeles'))
      .toBe('7:57:12 PM · 42 s · tapped');
    expect(describePause({ start_ms: start, end_ms: null, automatic: true, tapped: false, duration_s: null }, 'UTC'))
      .toBe('3:57:12 AM · still paused · auto-pause');
  });

  it('names a download', () => {
    expect(downloadName('Activity recording:activity:x', new Date('2026-11-11T05:06:07Z')))
      .toBe('tres-fort-activity-recording-activity-x-2026-11-11-05-06-07.json');
  });

  it('describes a problem report', () => {
    expect(lookupPath(LOOKUP_CHOICES[0]!, 30)).toBe('/api/me/diagnostics/reports?days=30');
    expect(reportPath('0b8f0f7e-8a3c-4c8a-9d55-2f6c8c4f1a10')).toBe('/api/me/diagnostics/reports/0b8f0f7e-8a3c-4c8a-9d55-2f6c8c4f1a10');
    expect(describeReportContext({ app_version: '1.2', build: '80', os_version: 'iOS 26.1', device: 'iPhone14,2' }))
      .toBe('1.2 (80) · iOS 26.1 · iPhone14,2');
    expect(describeReportContext(null)).toBe('No app details');
    const now = Date.parse('2026-11-11T06:00:00Z');
    const report = (access: ReportRow['activity_access'], activity: string | null = 'recording:1'): ReportRow => ({
      id: 'r', created_at: now, kind: 'activity', member: { user_id: 'u', display_name: 'Sam', is_owner: false },
      message: 'm', contact: null, context: null, has_screenshot: false, activity_id: activity, activity_access: access,
    });
    expect(describeActivityAccess(report({ status: 'open', until: now + 13.5 * 86_400_000 }), now))
      .toBe('Activity attached; readable for 14 more days');
    expect(describeActivityAccess(report({ status: 'open', until: now + 1000 }), now))
      .toBe('Activity attached; readable for 1 more day');
    expect(describeActivityAccess(report({ status: 'expired', until: now - 1 }), now))
      .toBe('Activity attached; the member’s 14 days have passed');
    expect(describeActivityAccess(report(null, null), now)).toBeNull();
  });
});
