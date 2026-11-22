/**
 * Same-origin gateway for the Tres Fort web app (docs/plans/web-app).
 *
 * The page never sees an app JWT. Sign in with Apple finishes here, the JWT
 * lives in an HttpOnly cookie, and `/api/*` is forwarded to the API Worker
 * over a service binding with the bearer added. Nothing here depends on the
 * sign-in provider beyond the two `/auth/apple/*` routes, so another provider
 * later only adds routes. `/maps/token` hands a signed-in page the site's
 * MapKit JS token for the route map.
 */

export interface Fetchable {
  fetch(request: Request): Promise<Response>;
}

export interface GatewayEnv {
  /** Static assets (the built single-page app). */
  ASSETS: Fetchable;
  /** The API Worker (`tres-fort`) over a service binding. */
  API: Fetchable;
  /** Sign in with Apple Services ID (client_id for the web). */
  APPLE_WEB_SERVICES_ID: string;
  /** The public origin, e.g. https://app.tresfort.app. */
  WEB_ORIGIN: string;
  /** Local development only: enables /auth/dev through the API's dev sign-in. */
  DEV_AUTH_SECRET?: string;
  /**
   * The MapKit JS token for Apple Maps under recorded routes, restricted to
   * this site's domain (`wrangler secret put MAPKIT_TOKEN`). Without it the
   * page draws a route's shape without a map.
   */
  MAPKIT_TOKEN?: string;
}

export const SESSION_COOKIE = '__Host-tf_session';
export const SIGNIN_COOKIE = '__Host-tf_siwa';
/** Matches the API's app JWT lifetime (APP_JWT_TTL_SECONDS). */
export const SESSION_MAX_AGE = 60 * 60 * 24 * 60;
const SIGNIN_MAX_AGE = 60 * 10;
const APPLE_AUTHORIZE = 'https://appleid.apple.com/auth/authorize';
const API_ORIGIN = 'https://api.tres-fort.internal';
/** Header the page sends on every API call; a cross-site form cannot set it. */
export const WEB_HEADER = 'x-tres-fort-web';

/** Reads pass for any API path except the blocked ones below. */
const READ_METHODS = new Set(['GET', 'HEAD']);
/** API paths the web has no use for and should never reach. */
const BLOCKED_API_PATHS = new Set(['/api/me/station-link-key']);
/** Request headers passed through to the API; everything else is dropped. */
const FORWARDED_HEADERS = ['accept', 'content-type', 'if-none-match', 'x-tresfort-account'];
/** Plan edits are small JSON documents. */
const MAX_WRITE_BYTES = 64 * 1024;

const SEGMENT = '[^/]+';
/**
 * The writes the web may make, one per screen action. Everything else (sets,
 * session lifecycle, account, member groups) is refused here, so a bug or an
 * injected script on the page cannot reach it through the session.
 * Connecting intervals.icu or WHOOP goes through `/connect/*` below.
 */
const WRITE_ROUTES: { method: string; path: RegExp }[] = [
  // Feedback on an already completed exact session; lifecycle and set writes stay blocked.
  { method: 'PATCH', path: new RegExp(`^/api/sessions/${SEGMENT}/feedback$`) },
  { method: 'PUT', path: /^\/api\/plan\/active$/ },
  { method: 'POST', path: /^\/api\/workouts$/ },
  { method: 'POST', path: /^\/api\/workouts\/prescribed$/ },
  { method: 'PATCH', path: new RegExp(`^/api/workouts/${SEGMENT}$`) },
  { method: 'DELETE', path: new RegExp(`^/api/workouts/${SEGMENT}$`) },
  { method: 'POST', path: new RegExp(`^/api/workouts/${SEGMENT}/exercises$`) },
  { method: 'PATCH', path: new RegExp(`^/api/workouts/${SEGMENT}/exercises/${SEGMENT}$`) },
  { method: 'DELETE', path: new RegExp(`^/api/workouts/${SEGMENT}/exercises/${SEGMENT}$`) },
  { method: 'POST', path: new RegExp(`^/api/workouts/${SEGMENT}/exercises/${SEGMENT}/swap$`) },
  { method: 'PUT', path: new RegExp(`^/api/workouts/${SEGMENT}/groups$`) },
  { method: 'PUT', path: /^\/api\/plan\/schedule$/ },
  { method: 'PUT', path: /^\/api\/plan\/race$/ },
  { method: 'DELETE', path: /^\/api\/plan\/race$/ },
  // A block of weeks, designed on the Block page (progressive-plans P4).
  { method: 'PUT', path: /^\/api\/plan\/program$/ },
  { method: 'DELETE', path: /^\/api\/plan\/program$/ },
  { method: 'POST', path: /^\/api\/plan\/trips$/ },
  { method: 'PATCH', path: new RegExp(`^/api/plan/trips/${SEGMENT}$`) },
  { method: 'DELETE', path: new RegExp(`^/api/plan/trips/${SEGMENT}$`) },
  { method: 'PUT', path: new RegExp(`^/api/calendar/${SEGMENT}$`) },
  { method: 'POST', path: new RegExp(`^/api/calendar/${SEGMENT}/move$`) },
  // Allow or deny an AI app's connection request on /coach/authorize. The ID
  // comes from that app's OAuth sign-in page; the API binds the decision to
  // this session's member (src/oauth.ts).
  { method: 'POST', path: /^\/api\/coach-requests\/[a-f0-9]{64}$/ },
  // Settings → Connections: sync now and disconnect intervals.icu (all nulls)
  // and WHOOP, and the Apple Health group-sharing switch.
  { method: 'PATCH', path: /^\/api\/me\/integrations\/intervals$/ },
  { method: 'POST', path: /^\/api\/me\/integrations\/intervals\/sync$/ },
  { method: 'DELETE', path: /^\/api\/me\/whoop$/ },
  { method: 'POST', path: /^\/api\/me\/whoop\/sync$/ },
  { method: 'PATCH', path: /^\/api\/me\/health-sharing$/ },
  // Settings → AI coach: remove one AI app's access, or all of them.
  { method: 'DELETE', path: new RegExp(`^/api/me/coach-grants/${SEGMENT}$`) },
  { method: 'DELETE', path: /^\/api\/me\/coach-grants$/ },
];

/**
 * Starting and finishing a provider connection from Settings → Connections.
 * The page calls `/connect/<provider>/<step>`; the gateway forwards it to the
 * API's `/auth/<provider>/<step>` with the session's bearer, under the same
 * checks as a write. The API marks a web sign-in's attempt so the provider
 * sends the browser back to this site, and only this session can finish it.
 * Garmin is not here until it opens to members.
 */
const CONNECT_ROUTE = /^\/connect\/(intervals|whoop)\/(start|finish)$/;

/**
 * Sign in may return to an AI app's connection request or the block planner
 * opened from the iPhone. Keep destinations explicit, never arbitrary URLs.
 */
const RETURN_PATH = /^\/coach\/authorize\?request=[a-f0-9]{64}$/;

export function safeReturnPath(value: string | null): string | null {
  return value !== null && (value === '/#block' || RETURN_PATH.test(value)) ? value : null;
}

export function isAllowedWrite(method: string, path: string): boolean {
  return WRITE_ROUTES.some((route) => route.method === method && route.path.test(path));
}

export async function handle(request: Request, env: GatewayEnv): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;

  if (path === '/auth/apple/start' && request.method === 'GET') return startAppleSignIn(env, safeReturnPath(url.searchParams.get('return')));
  if (path === '/auth/apple/callback' && request.method === 'POST') return finishAppleSignIn(request, env);
  if (path === '/auth/signout' && request.method === 'POST') return signOut(request, env);
  if (path === '/auth/dev' && request.method === 'POST' && env.DEV_AUTH_SECRET) return devSignIn(request, env);
  if (path.startsWith('/auth/')) return json({ error: 'not_found' }, 404);
  if (path === '/maps/token' && request.method === 'GET') return mapsToken(request, env);
  if (path.startsWith('/maps/')) return json({ error: 'not_found' }, 404);
  const connect = CONNECT_ROUTE.exec(path);
  if (connect && request.method === 'POST') return forwardToApi(request, env, url, `/auth/${connect[1]}/${connect[2]}`);
  if (path.startsWith('/connect/')) return json({ error: 'not_found' }, 404);
  if (path === '/api' || path.startsWith('/api/')) return forwardToApi(request, env, url);
  return env.ASSETS.fetch(request);
}

// ---- Sign in with Apple -----------------------------------------------------

function randomToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let text = '';
  for (const byte of bytes) text += String.fromCharCode(byte);
  return btoa(text).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function callbackUrl(env: GatewayEnv): string {
  return `${env.WEB_ORIGIN}/auth/apple/callback`;
}

function startAppleSignIn(env: GatewayEnv, returnPath: string | null): Response {
  const state = randomToken();
  const nonce = randomToken();
  const authorize = new URL(APPLE_AUTHORIZE);
  authorize.search = new URLSearchParams({
    client_id: env.APPLE_WEB_SERVICES_ID,
    redirect_uri: callbackUrl(env),
    response_type: 'code id_token',
    response_mode: 'form_post',
    scope: 'name email',
    state,
    nonce,
  }).toString();
  const headers = new Headers({ location: authorize.toString(), 'cache-control': 'no-store' });
  // Apple posts the result back cross-site, so this short-lived cookie must be
  // SameSite=None to return with that POST. It holds only the random state
  // and nonce for this one attempt, plus the allowed page to return to.
  const pending = returnPath ? `${state}.${nonce}.${base64UrlEncode(returnPath)}` : `${state}.${nonce}`;
  headers.append('set-cookie', cookie(SIGNIN_COOKIE, pending, SIGNIN_MAX_AGE, 'None'));
  return new Response(null, { status: 302, headers });
}

function fullNameFrom(rawUser: unknown): string | undefined {
  if (typeof rawUser !== 'string') return undefined;
  try {
    const parsed = JSON.parse(rawUser) as { name?: { firstName?: unknown; lastName?: unknown } };
    const parts = [parsed.name?.firstName, parsed.name?.lastName]
      .filter((part): part is string => typeof part === 'string' && part.trim().length > 0)
      .map((part) => part.trim());
    return parts.length ? parts.join(' ').slice(0, 200) : undefined;
  } catch {
    return undefined;
  }
}

async function finishAppleSignIn(request: Request, env: GatewayEnv): Promise<Response> {
  const pending = readCookie(request, SIGNIN_COOKIE);
  const clearPending = cookie(SIGNIN_COOKIE, '', 0, 'None');
  const [expectedState, nonce, encodedReturn] = (pending ?? '').split('.');
  // Back to the allowed destination that started this sign-in, if any.
  const returnPath = safeReturnPath(encodedReturn ? base64UrlDecode(encodedReturn) : null);
  const redirectHome = (problem: string | null, cookies: string[]) => redirectAfterSignIn(returnPath, problem, cookies);
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return redirectHome('failed', [clearPending]);
  }
  const state = form.get('state');
  if (!expectedState || !nonce || typeof state !== 'string' || !sameText(state, expectedState)) {
    return redirectHome('failed', [clearPending]);
  }
  if (form.get('error')) return redirectHome('cancelled', [clearPending]);
  const identityToken = form.get('id_token');
  if (typeof identityToken !== 'string' || identityToken.length === 0) {
    return redirectHome('failed', [clearPending]);
  }

  const fullName = fullNameFrom(form.get('user'));
  const apiResponse = await env.API.fetch(new Request(`${API_ORIGIN}/auth/apple`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ identityToken, nonce, ...(fullName ? { fullName } : {}) }),
  }));
  if (!apiResponse.ok) {
    const reason = apiResponse.status === 410 || apiResponse.status === 409 ? 'unavailable' : 'failed';
    return redirectHome(reason, [clearPending]);
  }
  const body = (await apiResponse.json().catch(() => null)) as { jwt?: unknown } | null;
  if (!body || typeof body.jwt !== 'string' || body.jwt.length === 0) {
    return redirectHome('failed', [clearPending]);
  }
  return redirectHome(null, [clearPending, cookie(SESSION_COOKIE, body.jwt, SESSION_MAX_AGE, 'Lax')]);
}

async function devSignIn(request: Request, env: GatewayEnv): Promise<Response> {
  if (!isSameOrigin(request, env)) return json({ error: 'forbidden' }, 403);
  const apiResponse = await env.API.fetch(new Request(`${API_ORIGIN}/auth/dev`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ secret: env.DEV_AUTH_SECRET, client: 'web' }),
  }));
  const body = (await apiResponse.json().catch(() => null)) as { jwt?: unknown } | null;
  if (!apiResponse.ok || !body || typeof body.jwt !== 'string') return json({ error: 'dev_signin_failed' }, 502);
  return new Response(null, {
    status: 204,
    headers: { 'set-cookie': cookie(SESSION_COOKIE, body.jwt, SESSION_MAX_AGE, 'Lax'), 'cache-control': 'no-store' },
  });
}

async function signOut(request: Request, env: GatewayEnv): Promise<Response> {
  if (!isSameOrigin(request, env)) return json({ error: 'forbidden' }, 403);
  const token = readCookie(request, SESSION_COOKIE);
  if (token) {
    try {
      const revoked = await env.API.fetch(new Request(`${API_ORIGIN}/auth/logout`, {
        method: 'POST', headers: { Authorization: `Bearer ${token}` },
      }));
      // A rejected bearer is already unusable. An outage is not a successful
      // revocation; retain the cookie so the member can retry.
      if (revoked.status !== 401) {
        const body = await revoked.json().catch(() => null) as { ok?: unknown } | null;
        if (!revoked.ok || body?.ok !== true) return json({ error: 'signout_failed' }, 502);
      }
    } catch { return json({ error: 'signout_failed' }, 502); }
  }
  return new Response(null, {
    status: 204,
    headers: { 'set-cookie': cookie(SESSION_COOKIE, '', 0, 'Lax'), 'cache-control': 'no-store' },
  });
}

function redirectAfterSignIn(returnPath: string | null, problem: string | null, cookies: string[]): Response {
  const target = new URL(returnPath ?? '/', 'https://web.tres-fort.internal');
  if (problem) target.searchParams.set('signin', problem);
  // Query parameters precede the fragment, so a retry still opens #block.
  const location = target.pathname + target.search + target.hash;
  const headers = new Headers({ location, 'cache-control': 'no-store' });
  for (const value of cookies) headers.append('set-cookie', value);
  return new Response(null, { status: 303, headers });
}

// ---- API forwarding ---------------------------------------------------------

async function forwardToApi(request: Request, env: GatewayEnv, url: URL, upstreamPath?: string): Promise<Response> {
  if (BLOCKED_API_PATHS.has(url.pathname)) return json({ error: 'not_found' }, 404);
  const isRead = READ_METHODS.has(request.method);
  // A connect route is a write the router already matched exactly.
  if (!isRead && !upstreamPath && !isAllowedWrite(request.method, url.pathname)) return json({ error: 'not_allowed' }, 405);
  // Same-origin GET fetches carry no Origin header, so reads rely on the
  // custom header (a cross-site page cannot send it without a CORS preflight,
  // which this gateway never answers) plus Sec-Fetch-Site when the browser
  // sends it. Writes must also carry a matching Origin.
  if (!isSameOrigin(request, env, { requireOrigin: !isRead }) || request.headers.get(WEB_HEADER) !== '1') {
    return json({ error: 'forbidden' }, 403);
  }
  const jwt = readCookie(request, SESSION_COOKIE);
  if (!jwt) return json({ error: 'signed_out' }, 401);
  // A session from before web sign-ins were marked would have its edits
  // recorded as the iPhone app's. Sign in again once instead.
  if (!isWebSession(jwt)) return signedOut();

  let body: ArrayBuffer | undefined;
  if (!isRead && request.method !== 'DELETE') {
    if (!(request.headers.get('content-type') ?? '').startsWith('application/json')) {
      return json({ error: 'unsupported_media_type' }, 415);
    }
    body = await request.arrayBuffer();
    if (body.byteLength > MAX_WRITE_BYTES) return json({ error: 'too_large' }, 413);
  }

  const headers = new Headers();
  for (const name of FORWARDED_HEADERS) {
    const value = request.headers.get(name);
    if (value !== null) headers.set(name, value);
  }
  headers.set('authorization', `Bearer ${jwt}`);
  // Ask for the plan's superset and circuit groups, as the current app does.
  headers.set('x-tresfort-capabilities', 'groups');

  const upstream = await env.API.fetch(new Request(`${API_ORIGIN}${upstreamPath ?? `${url.pathname}${url.search}`}`, {
    method: request.method,
    headers,
    redirect: 'manual',
    ...(body === undefined ? {} : { body }),
  }));
  const responseHeaders = new Headers(upstream.headers);
  responseHeaders.delete('set-cookie');
  responseHeaders.set('cache-control', 'no-store');
  if (upstream.status === 401) {
    // The stored session is no longer accepted: drop it so the page shows sign-in.
    responseHeaders.append('set-cookie', cookie(SESSION_COOKIE, '', 0, 'Lax'));
  }
  return new Response(upstream.body, { status: upstream.status, headers: responseHeaders });
}

// ---- Maps -------------------------------------------------------------------

/**
 * The MapKit JS token, for a signed-in page of this site only. Apple accepts
 * the token only from this domain, so it is not a secret; the checks keep
 * other sites and signed-out visitors from spending the site's map quota.
 * The gateway can't verify the session itself, so the API does (`/api/me`).
 */
async function mapsToken(request: Request, env: GatewayEnv): Promise<Response> {
  if (!isSameOrigin(request, env, { requireOrigin: false }) || request.headers.get(WEB_HEADER) !== '1') {
    return json({ error: 'forbidden' }, 403);
  }
  const jwt = readCookie(request, SESSION_COOKIE);
  if (!jwt) return json({ error: 'signed_out' }, 401);
  if (!isWebSession(jwt)) return signedOut();
  const session = await env.API.fetch(new Request(`${API_ORIGIN}/api/me`, {
    headers: { authorization: `Bearer ${jwt}`, accept: 'application/json' },
  }));
  if (session.status === 401) return signedOut();
  if (!session.ok) return json({ error: 'unavailable' }, 502);
  if (!env.MAPKIT_TOKEN) return json({ error: 'not_configured' }, 404);
  return json({ token: env.MAPKIT_TOKEN }, 200);
}

function signedOut(): Response {
  return new Response(JSON.stringify({ error: 'signed_out' }), {
    status: 401,
    headers: {
      'content-type': 'application/json',
      'cache-control': 'no-store',
      'set-cookie': cookie(SESSION_COOKIE, '', 0, 'Lax'),
    },
  });
}

/**
 * Whether the stored app JWT was issued to a web sign-in. The gateway only
 * reads the claim; the API still verifies the signature on every call.
 */
export function isWebSession(jwt: string): boolean {
  const payload = jwt.split('.')[1];
  if (!payload) return false;
  try {
    const text = atob(payload.replace(/-/g, '+').replace(/_/g, '/'));
    return (JSON.parse(text) as { client?: unknown }).client === 'web';
  } catch {
    return false;
  }
}

// ---- helpers ----------------------------------------------------------------

/**
 * A request counts as same-origin only when the browser says so: Origin, when
 * sent (and always, for state-changing requests), must be this site, and
 * Sec-Fetch-Site, when sent, must be same-origin.
 */
export function isSameOrigin(
  request: Request,
  env: GatewayEnv,
  { requireOrigin = true }: { requireOrigin?: boolean } = {},
): boolean {
  const origin = request.headers.get('origin');
  if (origin === null ? requireOrigin : origin !== env.WEB_ORIGIN) return false;
  const site = request.headers.get('sec-fetch-site');
  return site === null || site === 'same-origin';
}

function cookie(name: string, value: string, maxAge: number, sameSite: 'Lax' | 'None'): string {
  return `${name}=${value}; Path=/; HttpOnly; Secure; SameSite=${sameSite}; Max-Age=${maxAge}`;
}

export function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get('cookie');
  if (!header) return null;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    if (part.slice(0, index).trim() === name) {
      const value = part.slice(index + 1).trim();
      return value.length ? value : null;
    }
  }
  return null;
}

function base64UrlEncode(text: string): string {
  return btoa(text).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlDecode(text: string): string | null {
  try {
    return atob(text.replace(/-/g, '+').replace(/_/g, '/'));
  } catch {
    return null;
  }
}

function sameText(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}
