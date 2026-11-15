import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchDiagnostics, SignedOutError } from './api';
import {
  activeMembers,
  buildsInUse,
  civilDate,
  clientsUsed,
  describeBuild,
  describeBuildRow,
  describeConnections,
  describeSetup,
  memberName,
  membersPath,
  otherActivities,
  planChanges,
  relativeTime,
  WINDOW_CHOICES,
  type MemberUsage,
  type MembersResponse,
} from './members';

type Load =
  | { kind: 'loading' }
  | { kind: 'error' }
  | { kind: 'ready'; body: MembersResponse };

const dateTime = (ms: number) => new Date(ms).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
const day = (ms: number) => new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

/** One member in full: builds and clients over time, the window's counts,
 * all-time totals and what they have set up. */
function MemberDetail({ member, days, onClose }: { member: MemberUsage; days: number; onClose: () => void }) {
  const r = member.recent;
  const t = member.totals;
  const rows: Array<[string, number, number | null]> = [
    ['Workouts finished', r.workouts_completed, t.workouts_completed],
    ['Sets logged', r.sets_logged, t.sets_logged],
    ['Runs recorded in the app', r.runs_recorded, t.runs_recorded],
    ['Apple Health workouts', r.apple_health_workouts, t.apple_health_workouts],
    ['.fit files imported', r.fit_imports, t.fit_imports],
    ['intervals.icu activities', r.intervals_activities, t.intervals_activities],
    ['Activities logged by hand', r.manual_activities, t.manual_activities],
    ['Plan changes in the app', r.plan_changes.app, null],
    ['Plan changes on the web', r.plan_changes.web, null],
    ['Plan changes by the AI coach', r.plan_changes.coach, null],
    ['All AI coach changes', r.coach_changes, null],
    ['Problems reported', r.problem_reports, null],
  ];
  return (
    <section className="panel member-detail" aria-label={`${memberName(member)} in detail`}>
      <div className="section-head">
        <h3>{memberName(member)}</h3>
        <button type="button" className="ghost small" onClick={onClose}>Close</button>
      </div>
      <p className="muted">
        Joined {day(member.joined_at)}
        {member.is_test_member && ' · test member'}
        {' · '}last seen {relativeTime(member.last_seen_at).toLowerCase()}
        {member.last_workout_at !== null && ` · last workout ${relativeTime(member.last_workout_at).toLowerCase()}`}
      </p>

      <h4>Where they use it</h4>
      {member.builds.length === 0
        ? <p className="muted">Not seen since app use started being recorded.</p>
        : (
          <table className="diagnostics-table">
            <thead><tr><th>App, web or coach</th><th>First seen</th><th>Last seen</th></tr></thead>
            <tbody>
              {member.builds.map((b) => (
                <tr key={`${b.client}:${b.build ?? ''}`}>
                  <td>{describeBuildRow(b)}</td>
                  <td>{dateTime(b.first_seen_at)}</td>
                  <td>{dateTime(b.last_seen_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      <p className="muted">
        Active on {member.active_days.any} of the last {days} days
        {member.active_days.any > 0 && ` (app ${member.active_days.ios}, web ${member.active_days.web}, AI coach ${member.active_days.coach})`}.
      </p>

      <h4>What they do</h4>
      <table className="diagnostics-table">
        <thead><tr><th /><th>Last {days} days</th><th>All time</th></tr></thead>
        <tbody>
          {rows.map(([label, recent, total]) => (
            <tr key={label} className={recent === 0 && !total ? 'muted' : undefined}>
              <td>{label}</td><td>{recent}</td><td>{total ?? '–'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {(r.freestyle_workouts > 0 || r.additional_workouts > 0) && (
        <p className="muted">
          Of the workouts: {r.freestyle_workouts} started without a plan, {r.additional_workouts} as a second workout on a day.
        </p>
      )}
      <p className="muted">Last activity: {civilDate(member.last_activity_date)}.</p>

      <h4>Set up</h4>
      <p>{describeSetup(member).join(' · ')}</p>
      <ul className="member-connections">
        {describeConnections(member).map((c) => (
          <li key={c.name} className={c.on ? undefined : 'muted'}>{c.name}: {c.state}</li>
        ))}
      </ul>
      {member.setup.apple_health_group_sharing && <p className="muted">Shares Apple Health workouts with their groups.</p>}
    </section>
  );
}

/** The owner's Members page: who uses Tres Fort, on which build, and what
 * they use. Only the owner sees the tab. */
export function MembersPage({ onSignedOut }: { onSignedOut: () => void }) {
  const [days, setDays] = useState<number>(30);
  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  const [openId, setOpenId] = useState<string | null>(null);

  // Only the latest request may publish, so a slow answer for an earlier
  // window never replaces the one the owner picked since.
  const generation = useRef(0);
  const refresh = useCallback(async (window: number) => {
    const mine = ++generation.current;
    setLoad({ kind: 'loading' });
    try {
      const body = (await fetchDiagnostics(membersPath(window))) as MembersResponse;
      if (mine === generation.current) setLoad({ kind: 'ready', body });
    } catch (error) {
      if (mine !== generation.current) return;
      if (error instanceof SignedOutError) return onSignedOut();
      setLoad({ kind: 'error' });
    }
  }, [onSignedOut]);

  useEffect(() => { void refresh(days); }, [days, refresh]);

  const body = load.kind === 'ready' ? load.body : null;
  const members = body?.members ?? [];
  const opened = members.find((m) => m.user_id === openId) ?? null;
  const builds = buildsInUse(members);

  return (
    <main className="diagnostics members">
      <h2>Members</h2>
      <p className="muted">
        Who uses Très Fort, on which app build, and what they use.
        {body?.tracking_since
          ? ` App builds and active days are recorded from ${day(body.tracking_since)}; workouts, activities and setup go back to the start.`
          : ' App builds and active days start being recorded once members open the app after this release; workouts, activities and setup go back to the start.'}
        {' '}Garmin and WHOOP show only whether they’re connected. Opening this page is logged in your audit trail.
      </p>

      <div className="members-toolbar">
        <div className="members-window" role="group" aria-label="Window">
          {WINDOW_CHOICES.map((n) => (
            <button key={n} type="button" className="ghost small" aria-pressed={n === days}
              onClick={() => setDays(n)}>{n} days</button>
          ))}
        </div>
        <button type="button" className="ghost small" onClick={() => void refresh(days)} disabled={load.kind === 'loading'}>Refresh</button>
      </div>

      {load.kind === 'loading' && <p className="muted" aria-busy="true">Loading members…</p>}
      {load.kind === 'error' && <p role="alert">Members didn’t load. Try again.</p>}

      {body && (
        <>
          <section className="members-summary" aria-label="Summary">
            <div><strong>{members.length}</strong><span className="muted">members</span></div>
            <div><strong>{activeMembers(members)}</strong><span className="muted">active in {days} days</span></div>
            <div className="grow">
              <span className="muted">Latest app build</span>
              <span>{builds.length === 0 ? 'None seen yet'
                : builds.map((b) => `${describeBuild(b.build)}: ${b.members} member${b.members === 1 ? '' : 's'}`).join(' · ')}</span>
            </div>
          </section>

          <section className="panel">
            <table className="diagnostics-table members-table">
              <thead>
                <tr>
                  <th>Member</th>
                  <th>Last seen</th>
                  <th>App build</th>
                  <th title={`Days with any use in the last ${days}`}>Active days</th>
                  <th>Uses</th>
                  <th>Workouts</th>
                  <th>Sets</th>
                  <th>Runs recorded</th>
                  <th>Other activities</th>
                  <th>Plan changes</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {members.map((m) => (
                  <tr key={m.user_id} aria-selected={m.user_id === openId}>
                    <td>
                      {memberName(m)}
                      {m.is_test_member && <span className="muted"> · test</span>}
                    </td>
                    <td title={m.last_seen_at === null ? undefined : dateTime(m.last_seen_at)}>{relativeTime(m.last_seen_at)}</td>
                    <td>{m.app.ios ? `${m.app.ios.build ?? '?'}${m.app.ios.os_version ? ` · ${m.app.ios.os_version}` : ''}` : '–'}</td>
                    <td>{m.active_days.any}</td>
                    <td className="uses">{clientsUsed(m)}</td>
                    <td>{m.recent.workouts_completed}</td>
                    <td>{m.recent.sets_logged}</td>
                    <td>{m.recent.runs_recorded}</td>
                    <td>{otherActivities(m)}</td>
                    <td>{planChanges(m)}</td>
                    <td>
                      <button type="button" className="ghost small" onClick={() => setOpenId(m.user_id === openId ? null : m.user_id)}>
                        {m.user_id === openId ? 'Close' : 'Open'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="muted small-print">Counts cover the last {days} days. App build is the latest one each member opened.</p>
          </section>

          {opened && <MemberDetail member={opened} days={days} onClose={() => setOpenId(null)} />}
        </>
      )}
    </main>
  );
}
