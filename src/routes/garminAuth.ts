// Garmin OAuth (docs/plans/garmin), mounted at /auth/garmin. Same shape as the
// WHOOP flow, with Garmin's PKCE:
//   POST /start    (app-JWT) → a single-use state bound to this app session,
//                  holding the PKCE verifier, and Garmin's consent URL for
//                  ASWebAuthenticationSession.
//   GET  /callback (public)  → Garmin sends the browser back with ?code&state.
//                  The code is exchanged server-side with the client secret
//                  and the verifier, Garmin's user id and the permissions the
//                  member chose are read, and the tokens are sealed as a
//                  pending completion returned to the app via tresfort://.
//   POST /finish   (the same app session + completion secret) → activate.
// Garmin's Starter access has no history: workouts arrive as they are synced
// from now on. The client secret never leaves the Worker.
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import type { Env, HonoEnv } from '../types';
import { requireAppJwt } from '../auth';
import {
  consumeGarminOAuthState, createGarminOAuthCompletion, createGarminOAuthState, finishGarminOAuth, writeAudit,
} from '../db';
import {
  exchangeGarminCode, fetchGarminPermissions, fetchGarminUserId, garminAuthorizeUrl, garminCodeChallenge,
} from '../garmin';
import type { Fetcher } from '../intervals';

export const garminAuthRoutes = new Hono<HonoEnv>();
garminAuthRoutes.use('*', async (c, next) => {
  c.header('Cache-Control', 'no-store');
  c.header('Referrer-Policy', 'no-referrer');
  await next();
});

const fetcher: Fetcher = (input, init) => globalThis.fetch(input, init);

/** Byte-identical between /start and /callback; Garmin rejects a mismatch. */
function callbackUrl(env: Env, reqUrl: string): string {
  return env.GARMIN_OAUTH_REDIRECT_URI ?? `${new URL(reqUrl).origin}/auth/garmin/callback`;
}

function appReturn(query: string): string {
  return `tresfort://garmin-connected?${query}`;
}

function failure(detail: string): string {
  return appReturn(`error=${encodeURIComponent(detail.slice(0, 64))}`);
}

garminAuthRoutes.post('/start', requireAppJwt, async (c) => {
  if (!c.env.GARMIN_CLIENT_ID || !c.env.GARMIN_CLIENT_SECRET || !c.env.GARMIN_PUSH_SECRET) {
    return c.json({ error: 'garmin_not_configured' }, 503);
  }
  const sessionId = c.get('appSessionId');
  if (!sessionId) return c.json({ error: 'app_session_required' }, 401);
  const { state, verifier } = await createGarminOAuthState(c.env.DB, c.env, c.get('userId'), sessionId);
  return c.json({
    authorize_url: garminAuthorizeUrl(
      c.env.GARMIN_CLIENT_ID, callbackUrl(c.env, c.req.url), state, await garminCodeChallenge(verifier),
    ),
  });
});

garminAuthRoutes.get('/callback', async (c) => {
  const q = c.req.query();
  if (q.error) return c.redirect(failure(q.error), 302);
  if (!q.code || !q.state) return c.redirect(failure('missing_code'), 302);
  const attempt = await consumeGarminOAuthState(c.env.DB, c.env, q.state);
  if (!attempt) return c.redirect(failure('bad_state'), 302);
  const clientId = c.env.GARMIN_CLIENT_ID, clientSecret = c.env.GARMIN_CLIENT_SECRET;
  if (!clientId || !clientSecret || !c.env.CREDENTIAL_ENCRYPTION_KEY) return c.redirect(failure('garmin_not_configured'), 302);
  const exchanged = await exchangeGarminCode(fetcher, {
    clientId, clientSecret, code: q.code, codeVerifier: attempt.code_verifier, redirectUri: callbackUrl(c.env, c.req.url),
  });
  if (!exchanged.ok) return c.redirect(failure(`exchange_${exchanged.status ?? 'network'}`), 302);
  if (!exchanged.tokens.refreshToken) return c.redirect(failure('no_refresh_token'), 302);
  const user = await fetchGarminUserId(fetcher, exchanged.tokens.accessToken);
  if (!user.ok) return c.redirect(failure(`profile_${user.status ?? user.reason}`), 302);
  const permissions = await fetchGarminPermissions(fetcher, exchanged.tokens.accessToken);
  if (!permissions.ok) return c.redirect(failure(`permissions_${permissions.status ?? permissions.reason}`), 302);
  const completion = await createGarminOAuthCompletion(
    c.env.DB, attempt.user_id, attempt.app_session_id,
    { ...exchanged.tokens, providerUserId: user.value, permissions: permissions.value },
    c.env.CREDENTIAL_ENCRYPTION_KEY,
  );
  return c.redirect(appReturn(`completion=${encodeURIComponent(completion)}`), 302);
});

garminAuthRoutes.post('/finish', bodyLimit({ maxSize: 1024 }), requireAppJwt, async (c) => {
  const body: unknown = await c.req.json().catch(() => null);
  if (!body || typeof body !== 'object' || Array.isArray(body)
      || Object.keys(body).some(key => key !== 'completion') || typeof (body as { completion?: unknown }).completion !== 'string') {
    return c.json({ error: 'invalid_completion' }, 400);
  }
  const sessionId = c.get('appSessionId');
  if (!sessionId) return c.json({ error: 'invalid_completion' }, 400);
  const userId = c.get('userId');
  const result = await finishGarminOAuth(c.env.DB, c.env, userId, sessionId, (body as { completion: string }).completion);
  if ('error' in result) return c.json({ error: result.error }, result.error === 'account_in_use' ? 409 : 400);
  await writeAudit(c.env.DB, userId, 'garmin_connect', { provider: 'garmin' }, 'connected', c.get('appClient'));
  return c.json({ connected: true, activity_permission: result.activity_permission });
});
