import { useCallback, useEffect, useState } from 'react';
import { ApiError, fetchDiagnostics, fetchReportScreenshot, SignedOutError } from './api';
import {
  activityPath,
  describeActivityAccess,
  describePause,
  describeReportContext,
  downloadName,
  LOOKUP_CHOICES,
  lookupPath,
  REPORT_KIND_LABELS,
  reportPath,
  STATE_LABELS,
  type LookupChoice,
  type PauseRow,
  type ReportRow,
} from './diagnostics';

type Result =
  | { kind: 'idle' }
  | { kind: 'loading'; label: string }
  | { kind: 'error'; text: string }
  | { kind: 'ready'; label: string; body: unknown };

interface RecordingRow {
  id: string;
  date: string;
  name: string | null;
  state: string;
  distance_m: number | null;
  pause_count: number | null;
}

interface RunDetail {
  activity_id: string;
  recorder: { auto_pause_on: boolean | null; pauses: PauseRow[]; gps_fixes: unknown[] } | null;
}

/** A report's screenshot, fetched with the owner's session on request. */
function ReportScreenshot({ reportId, onSignedOut }: { reportId: string; onSignedOut: () => void }) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => () => { if (url) URL.revokeObjectURL(url); }, [url]);
  useEffect(() => { setUrl(null); setFailed(false); }, [reportId]);
  if (url) return <img className="diagnostics-screenshot" src={url} alt="Screenshot the member attached" />;
  return (
    <p>
      <button type="button" className="ghost small" onClick={async () => {
        try { setUrl(await fetchReportScreenshot(reportId)); } catch (error) {
          if (error instanceof SignedOutError) return onSignedOut();
          setFailed(true);
        }
      }}>Show screenshot</button>
      {failed && <span className="muted"> The screenshot didn’t load.</span>}
    </p>
  );
}

/** The owner's diagnostics: read-only lookups of their own data, with
 * Garmin and WHOOP left out, and the problems members report from the app.
 * Only the owner sees the tab. */
export function DiagnosticsPage({ onSignedOut }: { onSignedOut: () => void }) {
  const [choice, setChoice] = useState<LookupChoice>(LOOKUP_CHOICES[0]!);
  const [days, setDays] = useState<number>(LOOKUP_CHOICES[0]!.days!.fallback);
  const [activityId, setActivityId] = useState('');
  const [result, setResult] = useState<Result>({ kind: 'idle' });
  const [copied, setCopied] = useState(false);

  const run = useCallback(async (label: string, path: string) => {
    setResult({ kind: 'loading', label });
    setCopied(false);
    try {
      setResult({ kind: 'ready', label, body: await fetchDiagnostics(path) });
    } catch (error) {
      if (error instanceof SignedOutError) return onSignedOut();
      const code = error instanceof ApiError ? (error.body as { error?: string } | null)?.error : null;
      setResult({
        kind: 'error',
        text: code === 'restricted_source'
          ? 'Garmin and WHOOP activities stay out of diagnostics.'
          : code === 'not_found' ? 'Nothing of yours has that id.'
            : 'That lookup didn’t load. Try again.',
      });
    }
  }, [onSignedOut]);

  const openReport = (id: string) => {
    void run('Problem report', reportPath(id));
  };

  const openActivity = (id: string) => {
    setActivityId(id);
    void run(`Activity ${id}`, activityPath(id));
  };

  const text = result.kind === 'ready' ? JSON.stringify(result.body, null, 2) : '';
  const recordings = result.kind === 'ready' && result.label === 'Recorded runs'
    ? ((result.body as { recordings?: RecordingRow[] }).recordings ?? [])
    : [];
  const reports = result.kind === 'ready' && result.label === 'Problem reports'
    ? ((result.body as { reports?: ReportRow[] }).reports ?? [])
    : [];
  const openedReport = result.kind === 'ready'
    ? (result.body as { report?: ReportRow; activity?: { available?: boolean; reason?: string; run_details?: RunDetail[] } | null })
    : null;
  const detailBody = openedReport?.report ? (openedReport.activity ?? {}) : (result.kind === 'ready' ? result.body : {});
  const runDetails = ((detailBody as { run_details?: RunDetail[] }).run_details ?? []).filter((d) => d.recorder);

  return (
    <main className="diagnostics">
      <h2>Diagnostics</h2>
      <p className="muted">
        Read-only lookups of your own data, the same ones your Claude threads read with the diagnostics token,
        and the problems members report from the app. Garmin and WHOOP data stay out, and every lookup is logged
        in your audit trail.
      </p>

      <section className="panel">
        <form className="diagnostics-form" onSubmit={(e) => { e.preventDefault(); void run(choice.label, lookupPath(choice, days)); }}>
          <label>
            Lookup
            <select value={choice.key} onChange={(e) => {
              const next = LOOKUP_CHOICES.find((c) => c.key === e.target.value)!;
              setChoice(next);
              if (next.days) setDays(next.days.fallback);
            }}>
              {LOOKUP_CHOICES.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
            </select>
          </label>
          {choice.days && (
            <label>
              Days
              <input type="number" min={1} max={choice.days.max} value={days}
                onChange={(e) => setDays(Number(e.target.value))} />
            </label>
          )}
          <button type="submit" disabled={result.kind === 'loading'}>Look up</button>
        </form>
        <form className="diagnostics-form" onSubmit={(e) => { e.preventDefault(); if (activityId.trim()) openActivity(activityId.trim()); }}>
          <label className="grow">
            Activity id
            <input value={activityId} onChange={(e) => setActivityId(e.target.value)}
              placeholder="recording:activity:… or intervals:…" spellCheck={false} />
          </label>
          <button type="submit" disabled={result.kind === 'loading' || !activityId.trim()}>Open activity</button>
        </form>
      </section>

      {result.kind === 'loading' && <p className="muted" aria-busy="true">Loading {result.label.toLowerCase()}…</p>}
      {result.kind === 'error' && <p role="alert">{result.text}</p>}

      {result.kind === 'ready' && result.label === 'Problem reports' && reports.length === 0 && (
        <p className="muted">No reports in this window.</p>
      )}

      {reports.length > 0 && (
        <section className="panel">
          <h3>Problem reports</h3>
          <table className="diagnostics-table">
            <thead><tr><th>Sent</th><th>From</th><th>Kind</th><th>Message</th><th /></tr></thead>
            <tbody>
              {reports.map((r) => (
                <tr key={r.id}>
                  <td>{new Date(r.created_at).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}</td>
                  <td>{r.member.is_owner ? 'You' : (r.member.display_name ?? 'A member')}</td>
                  <td>{REPORT_KIND_LABELS[r.kind] ?? r.kind}</td>
                  <td>{r.message.length > 120 ? `${r.message.slice(0, 120)}…` : r.message}</td>
                  <td><button type="button" className="ghost small" onClick={() => openReport(r.id)}>Open</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {openedReport?.report && (
        <section className="panel">
          <h3>{REPORT_KIND_LABELS[openedReport.report.kind] ?? openedReport.report.kind}</h3>
          <p className="muted">
            {openedReport.report.member.is_owner ? 'You' : (openedReport.report.member.display_name ?? 'A member')}
            {' · '}{new Date(openedReport.report.created_at).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}
            {' · '}{describeReportContext(openedReport.report.context)}
          </p>
          <p className="diagnostics-message">{openedReport.report.message}</p>
          {openedReport.report.contact && <p>Reply to: {openedReport.report.contact}</p>}
          {describeActivityAccess(openedReport.report) && <p className="muted">{describeActivityAccess(openedReport.report)}</p>}
          {openedReport.activity && openedReport.activity.available === false && (
            <p className="muted">
              {openedReport.activity.reason === 'deleted_by_member' ? 'The member deleted this activity.'
                : openedReport.activity.reason === 'consent_expired' ? 'The activity’s details are no longer readable.'
                  : 'The activity isn’t available.'}
            </p>
          )}
          {openedReport.report.has_screenshot && (
            <ReportScreenshot reportId={openedReport.report.id} onSignedOut={onSignedOut} />
          )}
        </section>
      )}

      {recordings.length > 0 && (
        <section className="panel">
          <h3>Recorded runs</h3>
          <table className="diagnostics-table">
            <thead><tr><th>Date</th><th>Name</th><th>State</th><th>Distance</th><th>Pauses</th><th /></tr></thead>
            <tbody>
              {recordings.map((r) => (
                <tr key={r.id}>
                  <td>{r.date}</td>
                  <td>{r.name ?? 'Run'}</td>
                  <td>{STATE_LABELS[r.state] ?? r.state}</td>
                  <td>{r.distance_m === null ? '–' : `${(r.distance_m / 1000).toFixed(2)} km`}</td>
                  <td>{r.pause_count ?? 'not sent'}</td>
                  <td><button type="button" className="ghost small" onClick={() => openActivity(r.id)}>Open</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {runDetails.map((detail) => (
        <section className="panel" key={detail.activity_id}>
          <h3>Pauses</h3>
          <p className="muted">
            {detail.recorder!.auto_pause_on === null ? 'Pause when I stop: not recorded'
              : `Pause when I stop: ${detail.recorder!.auto_pause_on ? 'on' : 'off'}`}
            {' · '}{detail.recorder!.gps_fixes.length} GPS fixes
          </p>
          {detail.recorder!.pauses.length === 0
            ? <p className="muted">No pauses.</p>
            : <ul>{detail.recorder!.pauses.map((p) => <li key={p.start_ms}>{describePause(p)}</li>)}</ul>}
        </section>
      ))}

      {result.kind === 'ready' && (
        <section className="panel">
          <div className="section-head">
            <h3>{result.label}</h3>
            <div className="row-actions">
              <button type="button" className="ghost small" onClick={async () => {
                try { await navigator.clipboard.writeText(text); setCopied(true); } catch { setCopied(false); }
              }}>{copied ? 'Copied' : 'Copy JSON'}</button>
              <a className="button ghost small" download={downloadName(result.label)}
                href={`data:application/json;charset=utf-8,${encodeURIComponent(text)}`}>Download</a>
            </div>
          </div>
          <pre className="diagnostics-json">{text}</pre>
        </section>
      )}
    </main>
  );
}
