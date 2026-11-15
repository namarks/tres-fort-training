// Garmin adapter: OAuth 2.0 with PKCE, the member
// endpoints, the push notifications Garmin sends and the one-time activity
// file download. No database access; the fetcher is injected, so tests run
// offline. Confidential provider documents stay with the owner.
//
// The webhook route authenticates incoming notifications and queues activity
// files for later download. Fetches use bounded timeouts and approved hosts.
import type { Fetcher } from './intervals';

export const GARMIN_AUTHORIZE_URL = 'https://connect.garmin.com/oauth2Confirm';
export const GARMIN_TOKEN_URL = 'https://diauth.garmin.com/di-oauth2-service/oauth/token';
export const GARMIN_API = 'https://apis.garmin.com';
const USER_API = `${GARMIN_API}/partner-gateway/rest/user`;
const FILE_PATH = '/wellness-api/rest/activityFile';

const TIMEOUT_MS = 10_000;
/** The download may be a long ride's file; give it longer than a JSON call. */
const DOWNLOAD_TIMEOUT_MS = 25_000;

/** Permission a member grants on Garmin's consent screen for their workouts. */
export const GARMIN_ACTIVITY_PERMISSION = 'ACTIVITY_EXPORT';

function base64Url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** A PKCE code verifier: 64 URL-safe characters (Garmin accepts 43 to 128). */
export function garminCodeVerifier(): string {
  return base64Url(crypto.getRandomValues(new Uint8Array(48)));
}

export async function garminCodeChallenge(verifier: string): Promise<string> {
  return base64Url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
}

export function garminAuthorizeUrl(clientId: string, redirectUri: string, state: string, challenge: string): string {
  const url = new URL(GARMIN_AUTHORIZE_URL);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('code_challenge', challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('state', state);
  return url.toString();
}

export interface GarminTokens {
  accessToken: string;
  refreshToken: string | null;
  /** Epoch ms, or null when Garmin sent no lifetime. */
  expiresAt: number | null;
}

export type GarminTokenResult =
  | { ok: true; tokens: GarminTokens }
  /** `invalid`: Garmin refused the code or refresh token (reconnect needed).
   * `transient`: network, timeout, 5xx, 429 or an unreadable body. */
  | { ok: false; reason: 'invalid' | 'transient'; status?: number };

export function parseGarminTokens(body: unknown, now = Date.now()): GarminTokens | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const b = body as Record<string, unknown>;
  if (typeof b.access_token !== 'string' || b.access_token.length === 0) return null;
  const expiresIn = typeof b.expires_in === 'number' && Number.isFinite(b.expires_in) && b.expires_in > 0
    ? b.expires_in : null;
  return {
    accessToken: b.access_token,
    refreshToken: typeof b.refresh_token === 'string' && b.refresh_token.length > 0 ? b.refresh_token : null,
    expiresAt: expiresIn === null ? null : now + Math.round(expiresIn * 1000),
  };
}

async function tokenRequest(fetcher: Fetcher, form: Record<string, string>): Promise<GarminTokenResult> {
  let res: Awaited<ReturnType<Fetcher>>;
  try {
    res = await fetcher(GARMIN_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams(form).toString(),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    return { ok: false, reason: 'transient' };
  }
  if (!res.ok) {
    const invalid = res.status === 400 || res.status === 401 || res.status === 403;
    return { ok: false, reason: invalid ? 'invalid' : 'transient', status: res.status };
  }
  let body: unknown;
  try { body = await res.json(); } catch { return { ok: false, reason: 'transient', status: res.status }; }
  const tokens = parseGarminTokens(body);
  return tokens ? { ok: true, tokens } : { ok: false, reason: 'transient', status: res.status };
}

export function exchangeGarminCode(
  fetcher: Fetcher,
  p: { clientId: string; clientSecret: string; code: string; codeVerifier: string; redirectUri: string },
): Promise<GarminTokenResult> {
  return tokenRequest(fetcher, {
    grant_type: 'authorization_code', client_id: p.clientId, client_secret: p.clientSecret,
    code: p.code, code_verifier: p.codeVerifier, redirect_uri: p.redirectUri,
  });
}

export function refreshGarminTokens(
  fetcher: Fetcher,
  p: { clientId: string; clientSecret: string; refreshToken: string },
): Promise<GarminTokenResult> {
  return tokenRequest(fetcher, {
    grant_type: 'refresh_token', client_id: p.clientId, client_secret: p.clientSecret, refresh_token: p.refreshToken,
  });
}

export type GarminReadResult<T> =
  | { ok: true; value: T }
  | { ok: false; status?: number; reason: 'unauthorized' | 'http' | 'timeout' | 'parse' };

async function getJson(fetcher: Fetcher, token: string, url: string): Promise<GarminReadResult<unknown>> {
  let res: Awaited<ReturnType<Fetcher>>;
  try {
    res = await fetcher(url, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    return { ok: false, reason: 'timeout' };
  }
  if (res.status === 401 || res.status === 403) return { ok: false, reason: 'unauthorized', status: res.status };
  if (!res.ok) return { ok: false, reason: 'http', status: res.status };
  try { return { ok: true, value: await res.json() }; } catch { return { ok: false, reason: 'parse', status: res.status }; }
}

const USER_ID = /^[A-Za-z0-9-]{1,64}$/;

export function isGarminUserId(value: unknown): value is string {
  return typeof value === 'string' && USER_ID.test(value);
}

/** Garmin's id for the member, the same for every app they connect. */
export async function fetchGarminUserId(fetcher: Fetcher, token: string): Promise<GarminReadResult<string>> {
  const r = await getJson(fetcher, token, `${USER_API}/id`);
  if (!r.ok) return r;
  const id = (r.value as { userId?: unknown } | null)?.userId;
  return isGarminUserId(id) ? { ok: true, value: id } : { ok: false, reason: 'parse' };
}

function permissionList(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const out = value.filter((p): p is string => typeof p === 'string' && /^[A-Z_]{1,64}$/.test(p));
  return [...new Set(out)].sort();
}

/** What the member shares with Tres Fort, as chosen on Garmin's consent screen. */
export async function fetchGarminPermissions(fetcher: Fetcher, token: string): Promise<GarminReadResult<string[]>> {
  const r = await getJson(fetcher, token, `${USER_API}/permissions`);
  if (!r.ok) return r;
  const list = permissionList((r.value as { permissions?: unknown } | null)?.permissions);
  return list ? { ok: true, value: list } : { ok: false, reason: 'parse' };
}

/** Tell Garmin the member disconnected. Garmin then stops sending their data
 * and sends a deregistration notification. Best effort. */
export async function deleteGarminRegistration(fetcher: Fetcher, token: string): Promise<boolean> {
  try {
    const res = await fetcher(`${USER_API}/registration`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    return res.ok;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Push notifications

/** Garmin's published source ranges for notifications. */
export const GARMIN_PUSH_RANGES = [
  '204.77.162.0/23', '204.77.163.0/24', '98.199.124.0/23', '185.132.79.0/24',
  '208.65.206.0/23', '185.207.94.0/23', '198.233.176.0/24',
] as const;

function ipv4(value: string): number | null {
  const parts = value.split('.');
  if (parts.length !== 4) return null;
  let n = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const octet = Number(part);
    if (octet > 255) return null;
    n = n * 256 + octet;
  }
  return n;
}

/** Whether an address (as Cloudflare reports it) is one Garmin sends from. */
export function isGarminPushAddress(address: string | null | undefined): boolean {
  const ip = address ? ipv4(address.trim()) : null;
  if (ip === null) return false;
  return GARMIN_PUSH_RANGES.some((range) => {
    const [base, bits] = range.split('/');
    const start = ipv4(base!)!;
    const size = 2 ** (32 - Number(bits));
    return ip >= start && ip < start + size;
  });
}

/** One workout file Garmin announced. */
export interface GarminActivityFile {
  userId: string;
  activityId: string;
  fileType: string;
  callbackUrl: string;
  activityName: string | null;
  activityType: string | null;
  deviceName: string | null;
  startTimeSec: number | null;
  manual: boolean;
}

function text(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const t = value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
  return t.length === 0 ? null : t.slice(0, max);
}

/** A download link is used only when it points at Garmin's own file endpoint. */
export function isGarminFileUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 2048) return false;
  let url: URL;
  try { url = new URL(value); } catch { return false; }
  return url.protocol === 'https:' && url.hostname === 'apis.garmin.com' && url.port === ''
    && url.username === '' && url.password === '' && url.pathname === FILE_PATH;
}

function entries(body: unknown, key: string): unknown[] {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return [];
  const list = (body as Record<string, unknown>)[key];
  return Array.isArray(list) ? list.slice(0, 500) : [];
}

/** The `activityFiles` list of a push. Entries that are not usable are dropped. */
export function parseGarminActivityFiles(body: unknown): GarminActivityFile[] {
  const out: GarminActivityFile[] = [];
  for (const entry of entries(body, 'activityFiles')) {
    if (!entry || typeof entry !== 'object') continue;
    const e = entry as Record<string, unknown>;
    const activityId = typeof e.activityId === 'number' && Number.isSafeInteger(e.activityId) && e.activityId > 0
      ? String(e.activityId)
      : typeof e.activityId === 'string' && /^\d{1,20}$/.test(e.activityId) ? e.activityId : null;
    if (!isGarminUserId(e.userId) || !activityId || !isGarminFileUrl(e.callbackURL)) continue;
    const fileType = typeof e.fileType === 'string' ? e.fileType.toUpperCase() : '';
    if (!/^[A-Z]{1,8}$/.test(fileType)) continue;
    const start = typeof e.startTimeInSeconds === 'number' && Number.isSafeInteger(e.startTimeInSeconds)
      ? e.startTimeInSeconds : null;
    out.push({
      userId: e.userId,
      activityId,
      fileType,
      callbackUrl: e.callbackURL,
      activityName: text(e.activityName, 200),
      activityType: typeof e.activityType === 'string' && /^[A-Z0-9_]{1,64}$/.test(e.activityType) ? e.activityType : null,
      deviceName: text(e.deviceName, 80),
      startTimeSec: start,
      manual: e.manual === true,
    });
  }
  return out;
}

/** Garmin user ids in a `deregistrations` push. */
export function parseGarminDeregistrations(body: unknown): string[] {
  return [...new Set(entries(body, 'deregistrations')
    .map(e => (e && typeof e === 'object' ? (e as { userId?: unknown }).userId : null))
    .filter(isGarminUserId))];
}

/** The latest permission list per Garmin user in a `userPermissionsChange` push. */
export function parseGarminPermissionChanges(body: unknown): Array<{ userId: string; permissions: string[] }> {
  const latest = new Map<string, { at: number; permissions: string[] }>();
  for (const entry of entries(body, 'userPermissionsChange')) {
    if (!entry || typeof entry !== 'object') continue;
    const e = entry as Record<string, unknown>;
    const permissions = permissionList(e.permissions);
    if (!isGarminUserId(e.userId) || !permissions) continue;
    const at = typeof e.changeTimeInSeconds === 'number' && Number.isFinite(e.changeTimeInSeconds)
      ? e.changeTimeInSeconds : 0;
    const prior = latest.get(e.userId);
    if (!prior || at >= prior.at) latest.set(e.userId, { at, permissions });
  }
  return [...latest].map(([userId, v]) => ({ userId, permissions: v.permissions }));
}

/**
 * A full fetch (redirect control and the raw body), for file downloads. Any
 * GarminFetcher is also a Fetcher, so one function serves both.
 */
export type GarminFetcher = (input: string, init?: RequestInit) => Promise<Response>;

export type GarminDownload =
  | { ok: true; bytes: Uint8Array }
  /** Already downloaded or expired: Garmin will never serve it again. */
  | { ok: false; reason: 'gone' }
  | { ok: false; reason: 'too_large' }
  | { ok: false; reason: 'unauthorized' | 'transient'; status?: number };

/**
 * Download an announced activity file. Garmin serves each link once, for 24
 * hours, and answers 410 after that. The link carries its own download token;
 * the member's access token is sent too.
 */
export async function downloadGarminFile(
  fetcher: GarminFetcher, url: string, token: string | null, maxBytes: number,
): Promise<GarminDownload> {
  if (!isGarminFileUrl(url)) return { ok: false, reason: 'gone' };
  let res: Response;
  try {
    res = await fetcher(url, {
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), Accept: 'application/octet-stream' },
      redirect: 'manual',
      signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
    });
  } catch {
    return { ok: false, reason: 'transient' };
  }
  if (res.status === 410 || res.status === 404) return { ok: false, reason: 'gone' };
  if (res.status === 401 || res.status === 403) return { ok: false, reason: 'unauthorized', status: res.status };
  if (!res.ok) return { ok: false, reason: 'transient', status: res.status };
  if (res.status !== 200) return { ok: false, reason: 'transient', status: res.status };
  const declared = Number(res.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) return { ok: false, reason: 'too_large' };
  let buffer: ArrayBuffer;
  try { buffer = await res.arrayBuffer(); } catch { return { ok: false, reason: 'transient', status: res.status }; }
  if (buffer.byteLength > maxBytes) return { ok: false, reason: 'too_large' };
  return { ok: true, bytes: new Uint8Array(buffer) };
}
