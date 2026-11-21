import { useCallback, useEffect, useState } from 'react';
import {
  ApiError,
  connectionWrites,
  fetchCoachGrants,
  fetchMe,
  fetchWhoopStatus,
  SignedOutError,
  type CoachGrant,
  type ConnectProvider,
  type Me,
  type WhoopStatus,
} from './api';
import { SHARED_DATA } from './coachApproval';
import {
  APP_STORE_URL,
  claudeInstallUrl,
  CONNECT_GUIDE_URL,
  grantName,
  intervalsLine,
  MCP_URL,
  startErrorText,
  whenText,
  whoopLine,
  type ConnectionLine,
} from './connections';
import './settings.css';

export type SettingsSection = 'connections' | 'coach';

/**
 * Settings (owner, 2026-11-21: the web had no place to connect AI or any
 * integration). Connections connects intervals.icu (where Zwift rides come
 * from) and WHOOP from the web, and says plainly that Apple Health connects
 * on the iPhone. AI coach lists and removes AI apps' access and starts the
 * same connect flow as the iPhone. Garmin stays hidden here until it opens
 * to members.
 */
export function SettingsPage({ section, refresh, onSignedOut }: {
  section: SettingsSection;
  /** Bumped after a connection finishes, so statuses are read again. */
  refresh: number;
  onSignedOut: (error?: unknown) => void;
}) {
  return (
    <main className="settings-page">
      <nav className="settings-nav" aria-label="Settings">
        <p className="kicker">Settings</p>
        <a href="#settings/connections" aria-current={section === 'connections' ? 'page' : undefined}>Connections</a>
        <a href="#settings/coach" aria-current={section === 'coach' ? 'page' : undefined}>AI coach</a>
      </nav>
      <div className="settings-body">
        {section === 'connections'
          ? <ConnectionsSettings refresh={refresh} onSignedOut={onSignedOut} />
          : <CoachSettings onSignedOut={onSignedOut} />}
      </div>
    </main>
  );
}

type Loaded<T> = { kind: 'loading' } | { kind: 'error' } | { kind: 'ready'; value: T };

/** The member's connection statuses, read fresh (GET /api/me and /api/me/whoop). */
export function useConnectionStatus(refresh: number, onSignedOut: (error?: unknown) => void) {
  const [me, setMe] = useState<Loaded<Me>>({ kind: 'loading' });
  const [whoop, setWhoop] = useState<Loaded<WhoopStatus>>({ kind: 'loading' });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    fetchMe().then((value) => live && setMe({ kind: 'ready', value }))
      .catch((error: unknown) => { if (!live) return; if (error instanceof SignedOutError) onSignedOut(error); else setMe({ kind: 'error' }); });
    fetchWhoopStatus().then((value) => live && setWhoop({ kind: 'ready', value }))
      .catch((error: unknown) => { if (!live) return; if (error instanceof SignedOutError) onSignedOut(error); else setWhoop({ kind: 'error' }); });
    return () => { live = false; };
  }, [refresh, tick, onSignedOut]);
  return { me, whoop, reload: useCallback(() => setTick((value) => value + 1), []) };
}

function ConnectionsSettings({ refresh, onSignedOut }: { refresh: number; onSignedOut: (error?: unknown) => void }) {
  const status = useConnectionStatus(refresh, onSignedOut);
  return (
    <section aria-labelledby="connections-title">
      <h1 id="connections-title">Connections</h1>
      <p className="muted">Where your workouts come from. Every connection is optional: you can plan here and record workouts in the iPhone app without one.</p>
      <ConnectionRows status={status} onSignedOut={onSignedOut} detailed />
      <details className="panel settings-more">
        <summary>Other apps and devices</summary>
        <p><strong>Zwift:</strong> connect intervals.icu above, then link Zwift in intervals.icu’s own settings. Rides arrive with their power and heart rate.</p>
        <p><strong>A watch or bike computer:</strong> most sync to intervals.icu or Apple Health. You can also add a .fit file from the iPhone app.</p>
      </details>
      <p className="fine">Your group never sees your routes or heart rate.</p>
    </section>
  );
}

/**
 * intervals.icu, WHOOP and Apple Health, as rows. Shared by Settings and the
 * first-run setup, which shows them without the sync and disconnect controls.
 */
export function ConnectionRows({ status, onSignedOut, detailed = false, onLeaving }: {
  status: ReturnType<typeof useConnectionStatus>;
  onSignedOut: (error?: unknown) => void;
  /** Settings shows sync, disconnect and the group-sharing switch. */
  detailed?: boolean;
  /** Told just before the page leaves for a provider's sign-in. */
  onLeaving?: () => void;
}) {
  const [working, setWorking] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const { me, whoop, reload } = status;
  const intervals = me.kind === 'ready' ? me.value.intervals : me.kind === 'error' ? null : undefined;
  const whoopStatus = whoop.kind === 'ready' ? whoop.value : whoop.kind === 'error' ? null : undefined;

  const run = async (key: string, action: () => Promise<unknown>, failure: string) => {
    setWorking(key); setProblem(null);
    try { await action(); reload(); }
    catch (error) {
      if (error instanceof SignedOutError) onSignedOut(error);
      else setProblem(failure);
    } finally { setWorking(null); }
  };
  const connect = async (provider: ConnectProvider) => {
    setWorking(`${provider}-connect`); setProblem(null);
    try {
      const { authorize_url: target } = await connectionWrites.start(provider);
      const url = new URL(target);
      if (url.protocol !== 'https:') throw new Error('unexpected_authorize_url');
      onLeaving?.();
      window.location.assign(url.toString());
    } catch (error) {
      setWorking(null);
      if (error instanceof SignedOutError) onSignedOut(error);
      else setProblem(error instanceof ApiError ? startErrorText(provider, error.status, error.body) : startErrorText(provider, 0, null));
    }
  };

  const intervalsState = intervals === undefined ? null : intervalsLine(intervals);
  const whoopState = whoopStatus === undefined ? null : whoopLine(whoopStatus);
  return (
    <div className="connection-rows">
      <span className="kicker">Activity sources</span>
      <ConnectionRow logo="i.i" tone="intervals" name="intervals.icu" line={intervalsState}>
        {intervalsState && <ProviderActions line={intervalsState} name="intervals.icu" detailed={detailed} working={working} provider="intervals"
          onConnect={() => connect('intervals')}
          onSync={intervals ? () => run('intervals-sync', () => connectionWrites.syncIntervals(intervals.credential_generation), 'intervals.icu couldn’t sync just now. Try again in a minute.') : undefined}
          onDisconnect={() => run('intervals-disconnect', connectionWrites.disconnectIntervals, 'intervals.icu couldn’t be disconnected. Try again.')} />}
      </ConnectionRow>
      <ConnectionRow logo="W" tone="whoop" name="WHOOP" line={whoopState}>
        {whoopState && <ProviderActions line={whoopState} name="WHOOP" detailed={detailed} working={working} provider="whoop"
          onConnect={() => connect('whoop')}
          onSync={() => run('whoop-sync', connectionWrites.syncWhoop, 'WHOOP couldn’t sync just now. Try again in a minute.')}
          onDisconnect={() => run('whoop-disconnect', connectionWrites.disconnectWhoop, 'WHOOP couldn’t be disconnected. Try again.')} />}
      </ConnectionRow>
      <ConnectionRow logo="♥" tone="health" name="Apple Health" phone
        line={{ state: 'unavailable', text: 'Connects on iPhone only, because a browser can’t read Apple Health. Open Très Fort on your iPhone, then Profile → Connections → Apple Health.' }}>
        <a className="ghost small button-link" href={APP_STORE_URL} target="_blank" rel="noopener noreferrer">Get the iPhone app</a>
      </ConnectionRow>
      {detailed && me.kind === 'ready' && (
        <label className="check settings-switch">
          <input type="checkbox" checked={!!me.value.health?.sharing_in_group} disabled={working !== null}
            onChange={(event) => run('health', () => connectionWrites.setHealthSharing(event.target.checked), 'That setting didn’t save. Try again.')} />
          Show my Apple Health workouts to my group
        </label>
      )}
      {problem && <p className="problem" role="alert">{problem}</p>}
    </div>
  );
}

function ConnectionRow({ logo, tone, name, line, phone, children }: {
  logo: string; tone: string; name: string; line: ConnectionLine | null; phone?: boolean; children?: React.ReactNode;
}) {
  return (
    <div className={`connection-row${phone ? ' phone' : ''}`} role="group" aria-label={name}>
      <span className={`connection-logo ${tone}`} aria-hidden="true">{logo}</span>
      <div className="connection-text">
        <strong>{name}</strong>
        <small className={line ? `connection-${line.state}` : undefined}>{line ? line.text : 'Checking…'}</small>
      </div>
      <div className="connection-actions">{children}</div>
    </div>
  );
}

function ProviderActions({ line, name, provider, detailed, working, onConnect, onSync, onDisconnect }: {
  line: ConnectionLine; name: string; provider: ConnectProvider; detailed: boolean; working: string | null;
  onConnect: () => void; onSync?: () => void; onDisconnect: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const busy = working !== null;
  if (line.state === 'unavailable') return null;
  if (line.state === 'unknown') return null;
  if (line.state === 'disconnected' || line.state === 'reconnect') {
    return <button type="button" className="ghost connect" disabled={busy} onClick={onConnect}
      aria-label={`${line.state === 'reconnect' ? 'Reconnect' : 'Connect'} ${name}`}>
      {working === `${provider}-connect` ? 'Opening…' : line.state === 'reconnect' ? 'Reconnect' : 'Connect'}
    </button>;
  }
  if (!detailed) return <span className="connection-done">✓ Connected</span>;
  if (confirming) {
    return <span className="connection-confirm">
      <span className="fine">Stop bringing in {name} workouts?</span>
      <button type="button" className="ghost small danger" disabled={busy} onClick={() => { setConfirming(false); onDisconnect(); }}>Disconnect</button>
      <button type="button" className="ghost small" onClick={() => setConfirming(false)}>Keep</button>
    </span>;
  }
  return <>
    {onSync && <button type="button" className="ghost small" disabled={busy} onClick={onSync} aria-label={`Sync ${name} now`}>
      {working === `${provider}-sync` ? 'Syncing…' : 'Sync now'}</button>}
    <button type="button" className="ghost small danger" disabled={busy} onClick={() => setConfirming(true)} aria-label={`Disconnect ${name}`}>Disconnect</button>
  </>;
}

// ---- AI coach -----------------------------------------------------------------

function CoachSettings({ onSignedOut }: { onSignedOut: (error?: unknown) => void }) {
  const [grants, setGrants] = useState<Loaded<CoachGrant[]>>({ kind: 'loading' });
  const [tick, setTick] = useState(0);
  const [working, setWorking] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    let live = true;
    fetchCoachGrants().then((value) => live && setGrants({ kind: 'ready', value }))
      .catch((error: unknown) => { if (!live) return; if (error instanceof SignedOutError) onSignedOut(error); else setGrants({ kind: 'error' }); });
    return () => { live = false; };
  }, [tick, onSignedOut]);
  const remove = async (grantId: string | null) => {
    setWorking(grantId ?? 'all'); setProblem(null); setConfirming(null);
    try {
      if (grantId) await connectionWrites.removeCoachGrant(grantId);
      else await connectionWrites.removeAllCoachGrants();
      setTick((value) => value + 1);
    } catch (error) {
      if (error instanceof SignedOutError) onSignedOut(error);
      else setProblem('That didn’t go through. Nothing was removed; try again.');
    } finally { setWorking(null); }
  };
  const copy = async () => {
    try { await navigator.clipboard.writeText(MCP_URL); setCopied(true); } catch { setCopied(false); }
  };
  const list = grants.kind === 'ready' ? grants.value : [];

  return (
    <section aria-labelledby="coach-title">
      <h1 id="coach-title">AI coach</h1>
      <p className="muted">Optional. An AI app you already use, such as Claude or ChatGPT, can read your training and change your plan when you ask. Everything in Très Fort works without one.</p>

      <div className="panel settings-panel">
        <p className="kicker">Connected apps</p>
        {grants.kind === 'loading' && <p className="muted">Checking…</p>}
        {grants.kind === 'error' && <p role="alert" className="problem">Your AI connections couldn’t be read. Refresh to try again.</p>}
        {grants.kind === 'ready' && list.length === 0 && <p className="muted">No AI app has access.</p>}
        <ul className="grant-list">
          {list.map((grant) => (
            <li key={grant.id}>
              <div>
                <strong>{grantName(grant.client_name)}</strong>
                <small className="muted">Connected {whenText(grant.created_at)}{grant.last_refreshed_at ? ` · last used ${whenText(grant.last_refreshed_at)}` : ''}</small>
              </div>
              {confirming === grant.id
                ? <span className="connection-confirm">
                  <button type="button" className="ghost small danger" disabled={working !== null} onClick={() => remove(grant.id)}>Remove access</button>
                  <button type="button" className="ghost small" onClick={() => setConfirming(null)}>Keep</button>
                </span>
                : <button type="button" className="ghost small danger" disabled={working !== null}
                  aria-label={`Remove ${grantName(grant.client_name)}`} onClick={() => setConfirming(grant.id)}>Remove</button>}
            </li>
          ))}
        </ul>
        {list.length > 1 && (confirming === 'all'
          ? <p className="connection-confirm"><span className="fine">Every AI app loses access right away. Your training stays.</span>
            <button type="button" className="ghost small danger" disabled={working !== null} onClick={() => remove(null)}>Disconnect all</button>
            <button type="button" className="ghost small" onClick={() => setConfirming(null)}>Keep</button></p>
          : <button type="button" className="ghost small" disabled={working !== null} onClick={() => setConfirming('all')}>Disconnect all AI apps</button>)}
        {problem && <p className="problem" role="alert">{problem}</p>}
      </div>

      <div className="panel settings-panel">
        <p className="kicker">Connect an app</p>
        <ul className="grant-list connect-list">
          <li>
            <div><strong>Claude</strong><small className="muted">Opens Claude with Très Fort filled in. Add it there, then allow access on the Très Fort page it opens.</small></div>
            <a className="ghost button-link" href={claudeInstallUrl()} target="_blank" rel="noopener noreferrer">Connect Claude</a>
          </li>
          <li>
            <div><strong>ChatGPT</strong><small className="muted">Step-by-step on the Très Fort website.</small></div>
            <a className="ghost button-link" href={`${CONNECT_GUIDE_URL}#chatgpt`} target="_blank" rel="noopener noreferrer">Open the guide</a>
          </li>
          <li>
            <div><strong>Another app</strong><small className="muted">Any app that supports MCP with OAuth sign-in. Paste this address.</small></div>
          </li>
        </ul>
        <div className="url-copy">
          <code>{MCP_URL}</code>
          <button type="button" className="ghost small" onClick={copy}>{copied ? 'Copied' : 'Copy'}</button>
        </div>
        <details className="settings-shared">
          <summary>What a connected app can see</summary>
          <ul>{SHARED_DATA.map((line) => <li key={line}>{line}</li>)}</ul>
          <p className="fine">It can also change your plan and record training when you ask. It can’t see your Sign in with Apple email, your routes or heart-rate readings, or your Apple Health weight. Your AI app handles what it reads under its own terms.</p>
        </details>
      </div>
    </section>
  );
}
