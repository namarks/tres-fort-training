import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ConnectionRows } from '../src/SettingsPage';
import { MCP_URL as WEBSITE_MCP_URL } from '../../website/connect.mjs';
import { hashFor, viewFromHash } from '../src/App';
import {
  claudeInstallUrl,
  connectErrorText,
  connectReturnFrom,
  grantName,
  intervalsLine,
  markSetupDone,
  MCP_URL,
  opensSetup,
  rememberSetupBlock,
  rememberSetupStep,
  setupInProgress,
  setupWantsBlock,
  startErrorText,
  whenText,
  whoopLine,
  type KeyValueStore,
} from '../src/connections';

function memory(): KeyValueStore & { values: Map<string, string> } {
  const values = new Map<string, string>();
  return { values, getItem: (key) => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value); }, removeItem: (key) => { values.delete(key); } };
}
const refusing: KeyValueStore = {
  getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); }, removeItem: () => { throw new Error('blocked'); },
};

const NOW = new Date(2026, 10, 21, 15, 0).getTime();

describe('connection status lines', () => {
  it('never shows a missing status as disconnected', () => {
    expect(intervalsLine(undefined)).toEqual({ state: 'unknown', text: 'Check connection status' });
    expect(whoopLine(null)).toEqual({ state: 'unknown', text: 'Check connection status' });
  });

  it('describes intervals.icu as the iPhone does', () => {
    expect(intervalsLine({ connected: false, needs_reauth: false }).state).toBe('disconnected');
    expect(intervalsLine({ connected: false, needs_reauth: true })).toEqual({ state: 'reconnect', text: 'Reconnect needed' });
    expect(intervalsLine({ connected: true, sync_pending: true })).toEqual({ state: 'pending', text: 'Connected · Sync pending' });
    expect(intervalsLine({ connected: true }, NOW)).toEqual({ state: 'connected', text: 'Connected' });
    expect(intervalsLine({ connected: true, last_synced_at: new Date(2026, 10, 21, 9, 14).getTime() }, NOW).text).toMatch(/^Connected · last synced today at /);
  });

  it('says WHOOP is unavailable only when it is not set up and not connected', () => {
    expect(whoopLine({ configured: false, connected: false }).state).toBe('unavailable');
    expect(whoopLine({ configured: true, connected: false }).text).toMatch(/Recovery and sleep show in the iPhone app/);
    expect(whoopLine({ configured: true, connected: true, needs_reauth: true }).state).toBe('reconnect');
    // A pending first import is not a failure.
    expect(whoopLine({ configured: true, connected: true })).toEqual({ state: 'connected', text: 'Connected · Sync pending' });
  });

  it('writes recent times as today and yesterday, older ones as dates', () => {
    expect(whenText(new Date(2026, 10, 20, 8, 0).getTime(), NOW)).toMatch(/^yesterday at /);
    expect(whenText(new Date(2026, 10, 12, 8, 0).getTime(), NOW)).not.toMatch(/2026/);
    expect(whenText(new Date(2025, 10, 12, 8, 0).getTime(), NOW)).toMatch(/2025/);
  });
});

describe('returning from a provider', () => {
  it('reads a completion or an error from the address the API writes', () => {
    const completion = 'a'.repeat(43);
    expect(connectReturnFrom(`#settings/connections?provider=intervals&completion=${completion}`)).toEqual({ provider: 'intervals', completion });
    expect(connectReturnFrom('#settings/connections?provider=whoop&error=access_denied')).toEqual({ provider: 'whoop', error: 'access_denied' });
  });

  it('ignores other providers, malformed secrets and other pages', () => {
    expect(connectReturnFrom('#settings/connections?provider=garmin&error=access_denied')).toBeNull();
    expect(connectReturnFrom('#settings/connections?provider=whoop&completion=short')).toBeNull();
    expect(connectReturnFrom('#settings/connections?provider=whoop&completion=<script>')).toBeNull();
    expect(connectReturnFrom('#settings/connections')).toBeNull();
    expect(connectReturnFrom('#plan?provider=whoop&error=x')).toBeNull();
    expect(connectReturnFrom(`#settings/connections?provider=whoop&error=${'x'.repeat(200)}`)).toEqual({ provider: 'whoop', error: 'x'.repeat(64) });
  });

  it('explains why a connection did not finish, without echoing the provider', () => {
    expect(connectErrorText('intervals', 'access_denied')).toBe('You didn’t allow intervals.icu, so nothing was connected.');
    expect(connectErrorText('whoop', 'account_in_use')).toBe('That WHOOP account is already connected to another Très Fort member.');
    expect(connectErrorText('whoop', 'whoop_not_configured')).toBe('WHOOP can’t be connected from the web right now.');
    expect(connectErrorText('whoop', '<b>anything</b>')).toBe('WHOOP didn’t connect. Try again.');
    expect(startErrorText('intervals', 503, { error: 'web_connect_not_configured' })).toBe('intervals.icu can’t be connected from the web right now.');
    expect(startErrorText('intervals', 503, null)).toBe('intervals.icu can’t be connected from the web right now.');
    expect(startErrorText('whoop', 500, 'oops')).toBe('WHOOP didn’t connect. Try again.');
  });
});

describe('AI coach', () => {
  it('uses the connector address the website shows', () => {
    expect(MCP_URL).toBe(WEBSITE_MCP_URL);
  });

  it('opens Claude’s custom-connector form with Très Fort filled in and no credential', () => {
    const url = new URL(claudeInstallUrl());
    expect(url.origin + url.pathname).toBe('https://claude.ai/customize/connectors');
    expect(Object.fromEntries(url.searchParams)).toEqual({ modal: 'add-custom-connector', connectorName: 'Très Fort', connectorUrl: MCP_URL });
  });

  it('names a grant by its registered name, or plainly', () => {
    expect(grantName('Claude')).toBe('Claude');
    expect(grantName('  ')).toBe('An AI app');
    expect(grantName(null)).toBe('An AI app');
    expect(grantName('x'.repeat(200))).toHaveLength(80);
  });
});

describe('first-run setup', () => {
  const base = { hash: '', hasPlan: false, accountId: 'member-1' };

  it('opens for a new account at the front door only', () => {
    expect(opensSetup({ ...base, local: memory(), session: memory() })).toBe(true);
    expect(opensSetup({ ...base, hash: '#', local: memory(), session: memory() })).toBe(true);
    expect(opensSetup({ ...base, hash: '#workouts', local: memory(), session: memory() })).toBe(false);
    expect(opensSetup({ ...base, hash: '#block', local: memory(), session: memory() })).toBe(false);
  });

  it('ends for good once a plan exists, wherever it was made', () => {
    expect(opensSetup({ ...base, hasPlan: true, local: memory(), session: memory() })).toBe(false);
  });

  it('stays closed once finished or skipped in this browser, for that account only', () => {
    const local = memory();
    markSetupDone(local, 'member-1');
    expect(opensSetup({ ...base, local, session: memory() })).toBe(false);
    expect(opensSetup({ ...base, accountId: 'member-2', local, session: memory() })).toBe(true);
  });

  it('comes back to the step a tab was on, even once its plan exists', () => {
    const session = memory();
    rememberSetupStep(session, 'member-1', 3);
    expect(setupInProgress(session, 'member-1')).toBe(3);
    expect(setupInProgress(session, 'member-2')).toBeNull();
    expect(opensSetup({ ...base, hasPlan: true, local: memory(), session })).toBe(true);
    expect(opensSetup({ ...base, hasPlan: true, hash: '#plan', local: memory(), session })).toBe(false);
    rememberSetupBlock(session, 'member-1', true);
    expect(setupWantsBlock(session, 'member-1')).toBe(true);
    expect(setupWantsBlock(session, 'member-2')).toBe(false);
    rememberSetupStep(session, 'member-1', null);
    expect(setupInProgress(session, 'member-1')).toBeNull();
    expect(setupWantsBlock(session, 'member-1')).toBe(false);
    session.values.set('tf.setup.step.member-1', '7');
    expect(setupInProgress(session, 'member-1')).toBeNull();
  });

  it('opens on request, and works when site storage is blocked', () => {
    expect(opensSetup({ ...base, hasPlan: true, hash: '#setup', local: null, session: null })).toBe(true);
    expect(opensSetup({ ...base, local: refusing, session: refusing })).toBe(true);
    expect(() => markSetupDone(refusing, 'member-1')).not.toThrow();
    expect(() => rememberSetupStep(refusing, 'member-1', 2)).not.toThrow();
  });
});

describe('addresses', () => {
  it('opens setup, Settings and block setup', () => {
    expect(viewFromHash('#setup')).toEqual({ kind: 'setup' });
    expect(viewFromHash('#settings')).toEqual({ kind: 'settings', section: 'connections' });
    expect(viewFromHash('#settings/coach')).toEqual({ kind: 'settings', section: 'coach' });
    expect(viewFromHash('#settings/connections?provider=whoop&error=x')).toEqual({ kind: 'settings', section: 'connections' });
    expect(viewFromHash('#block/start')).toEqual({ kind: 'block', start: true });
    expect(hashFor({ kind: 'settings', section: 'coach' })).toBe('#settings/coach');
    expect(hashFor({ kind: 'block', start: true })).toBe('#block/start');
    expect(hashFor({ kind: 'block' })).toBe('#block');
    expect(hashFor({ kind: 'setup' })).toBe('#setup');
  });
});

describe('connection rows', () => {
  const status = (intervals: object, whoop: object) => ({
    accountId: 'member-1', reload: () => undefined,
    me: { kind: 'ready' as const, value: { id: 'member-1', intervals } as never },
    whoop: { kind: 'ready' as const, value: whoop as never },
  });
  const render = (detailed: boolean) => renderToStaticMarkup(createElement(ConnectionRows, {
    status: status({ connected: false, needs_reauth: true }, { configured: true, connected: true, needs_reauth: true }),
    onSignedOut: () => undefined, detailed,
  }));

  it('lets Settings disconnect a connection that needs reconnecting', () => {
    const html = render(true);
    expect(html).toContain('aria-label="Reconnect WHOOP"');
    expect(html).toContain('aria-label="Disconnect WHOOP"');
    expect(html).toContain('aria-label="Disconnect intervals.icu"');
  });

  it('offers only Reconnect in setup', () => {
    const html = render(false);
    expect(html).toContain('aria-label="Reconnect WHOOP"');
    expect(html).not.toContain('Disconnect');
  });
});
