/**
 * Rules for Settings → Connections, Settings → AI coach and the first-run
 * setup (docs/plans/web-app P1 and P4). Pure, so they are tested without a
 * page. Status wording follows the iPhone's Connections screen
 * (docs/CONNECTIONS-UI-SPEC.md): missing status is never shown as
 * disconnected, and a pending import is not a failure.
 */
import type { ConnectProvider, IntervalsStatus, WhoopStatus } from './api';

/** The iPhone app's App Store listing, for what only the iPhone can do. */
export const APP_STORE_URL = 'https://apps.apple.com/us/app/id6772375823';

/** The coach connector address, as the website's guide shows it (website/connect.mjs). */
export const MCP_URL = 'https://tres-fort.nmarkspdx.workers.dev/mcp';

/** The member-facing guide for each AI app, on the public website. */
export const CONNECT_GUIDE_URL = 'https://tresfort.app/connect';

/**
 * Claude's documented install link: its custom-connector form with the name
 * and address filled in, as the iPhone's "Allow and connect Claude" opens
 * (CoachSetup.claudeInstallURL). It carries no member code or credential;
 * Claude then sends the member to the Très Fort approval page.
 */
export function claudeInstallUrl(mcpUrl = MCP_URL): string {
  const url = new URL('https://claude.ai/customize/connectors');
  url.searchParams.set('modal', 'add-custom-connector');
  url.searchParams.set('connectorName', 'Très Fort');
  url.searchParams.set('connectorUrl', mcpUrl);
  return url.toString();
}

export const PROVIDER_NAMES: Record<ConnectProvider, string> = { intervals: 'intervals.icu', whoop: 'WHOOP' };

/** "today at 9:14 AM", "yesterday at …", or "Nov 12". */
export function whenText(epochMs: number, now = Date.now()): string {
  const at = new Date(epochMs);
  const today = new Date(now);
  const time = at.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  const dayDiff = Math.round((startOfDay(today) - startOfDay(at)) / 86_400_000);
  if (dayDiff === 0) return `today at ${time}`;
  if (dayDiff === 1) return `yesterday at ${time}`;
  return at.toLocaleDateString(undefined, { month: 'short', day: 'numeric', ...(at.getFullYear() !== today.getFullYear() ? { year: 'numeric' } : {}) });
}

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

export type ConnectionState = 'unknown' | 'reconnect' | 'connected' | 'pending' | 'disconnected' | 'unavailable';

export interface ConnectionLine { state: ConnectionState; text: string }

export function intervalsLine(status: IntervalsStatus | undefined | null, now = Date.now()): ConnectionLine {
  if (!status) return { state: 'unknown', text: 'Check connection status' };
  if (status.needs_reauth) return { state: 'reconnect', text: 'Reconnect needed' };
  if (status.connected && status.sync_pending) return { state: 'pending', text: 'Connected · Sync pending' };
  if (status.connected) {
    return { state: 'connected', text: status.last_synced_at ? `Connected · last synced ${whenText(status.last_synced_at, now)}` : 'Connected' };
  }
  return { state: 'disconnected', text: 'Zwift rides, and workouts from most watches and bike computers. Your planned rides come back too.' };
}

export function whoopLine(status: WhoopStatus | undefined | null, now = Date.now()): ConnectionLine {
  if (!status) return { state: 'unknown', text: 'Check connection status' };
  if (!status.configured && !status.connected) return { state: 'unavailable', text: 'Not available right now.' };
  if (status.needs_reauth) return { state: 'reconnect', text: 'Reconnect needed' };
  if (status.connected) {
    return { state: 'connected', text: status.last_synced_at ? `Connected · last synced ${whenText(status.last_synced_at, now)}` : 'Connected · Sync pending' };
  }
  return { state: 'disconnected', text: 'Workouts and strain from your WHOOP. Recovery and sleep show in the iPhone app.' };
}

/** What the provider sent the browser back with, from the page's URL fragment. */
export type ConnectReturn =
  | { provider: ConnectProvider; completion: string }
  | { provider: ConnectProvider; error: string };

/** Reads `#settings/connections?provider=…&completion=…` (or `&error=…`), as
 * the API's connect callback writes it (src/connectReturn.ts). */
export function connectReturnFrom(hash: string): ConnectReturn | null {
  const match = /^#settings\/connections\?(.*)$/.exec(hash);
  if (!match) return null;
  const params = new URLSearchParams(match[1]);
  const provider = params.get('provider');
  if (provider !== 'intervals' && provider !== 'whoop') return null;
  const completion = params.get('completion');
  if (completion && /^[A-Za-z0-9_-]{20,128}$/.test(completion)) return { provider, completion };
  const error = params.get('error');
  return error ? { provider, error: error.slice(0, 64) } : null;
}

/** A short, plain reason a connection didn't finish. */
export function connectErrorText(provider: ConnectProvider, error: string): string {
  const name = PROVIDER_NAMES[provider];
  if (error === 'access_denied') return `You didn’t allow ${name}, so nothing was connected.`;
  if (error === 'connection_changed') return `Your ${name} connection changed in the app while this was open. Try again.`;
  if (error === 'bad_state') return `That ${name} sign-in expired or was already used. Try again.`;
  if (error === 'account_in_use') return 'That WHOOP account is already connected to another Très Fort member.';
  if (error === 'invalid_completion') return `That ${name} sign-in can only be finished in the browser tab that started it. Try again here.`;
  if (error.endsWith('not_configured')) return `${name} can’t be connected from the web right now.`;
  return `${name} didn’t connect. Try again.`;
}

/** Why starting a connection failed, from the API's answer. */
export function startErrorText(provider: ConnectProvider, status: number, body: unknown): string {
  const error = (body as { error?: unknown } | null)?.error;
  return connectErrorText(provider, typeof error === 'string' ? error : status === 503 ? 'not_configured' : 'failed');
}

/** The name to show for an AI app's access: the name it registered with, or a plain label. */
export function grantName(name: string | null | undefined): string {
  const trimmed = (name ?? '').trim();
  return trimmed ? trimmed.slice(0, 80) : 'An AI app';
}

// ---- First-run setup --------------------------------------------------------

export type SetupStep = 1 | 2 | 3;

const SETUP_STEP_KEY = (accountId: string) => `tf.setup.step.${accountId}`;
const SETUP_DONE_KEY = (accountId: string) => `tf.setup.done.${accountId}`;
const SETUP_BLOCK_KEY = (accountId: string) => `tf.setup.block.${accountId}`;

/** Storage that may be missing or refuse (private windows, blocked site data). */
export interface KeyValueStore { getItem(key: string): string | null; setItem(key: string, value: string): void; removeItem(key: string): void }

function read(store: KeyValueStore | null, key: string): string | null {
  try { return store?.getItem(key) ?? null; } catch { return null; }
}
function write(store: KeyValueStore | null, key: string, value: string | null) {
  try { if (value === null) store?.removeItem(key); else store?.setItem(key, value); } catch { /* the page works without it */ }
}

/** The step a setup in progress in this tab is on, if any. */
export function setupInProgress(session: KeyValueStore | null, accountId: string): SetupStep | null {
  const value = Number(read(session, SETUP_STEP_KEY(accountId)));
  return value === 1 || value === 2 || value === 3 ? value : null;
}

export function rememberSetupStep(session: KeyValueStore | null, accountId: string, step: SetupStep | null) {
  write(session, SETUP_STEP_KEY(accountId), step === null ? null : String(step));
  if (step === null) write(session, SETUP_BLOCK_KEY(accountId), null);
}

/** Whether finishing setup opens block setup, kept with the step so a
 * provider's sign-in doesn't lose it. */
export function setupWantsBlock(session: KeyValueStore | null, accountId: string): boolean {
  return read(session, SETUP_BLOCK_KEY(accountId)) === '1';
}

export function rememberSetupBlock(session: KeyValueStore | null, accountId: string, on: boolean) {
  write(session, SETUP_BLOCK_KEY(accountId), on ? '1' : null);
}

export function markSetupDone(local: KeyValueStore | null, accountId: string) {
  write(local, SETUP_DONE_KEY(accountId), '1');
}

/**
 * Whether opening the site should start setup: an account with no plan yet,
 * arriving at the site's front door (no page asked for), that hasn't
 * finished or skipped setup in this browser. A plan made anywhere (the app,
 * an AI coach, another browser) ends it for good.
 */
export function opensSetup(input: { hash: string; hasPlan: boolean; local: KeyValueStore | null; session: KeyValueStore | null; accountId: string }): boolean {
  if (input.hash === '#setup') return true;
  if (setupInProgress(input.session, input.accountId) && (input.hash === '' || input.hash === '#')) return true;
  if (input.hasPlan) return false;
  if (input.hash !== '' && input.hash !== '#') return false;
  return read(input.local, SETUP_DONE_KEY(input.accountId)) !== '1';
}

export function safeStore(kind: 'local' | 'session'): KeyValueStore | null {
  try { return kind === 'local' ? window.localStorage : window.sessionStorage; } catch { return null; }
}
