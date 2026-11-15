// WHOOP OAuth (docs/plans/whoop), mounted at /auth/whoop. Same shape as the
// intervals.icu flow:
//   POST /start    (app-JWT) → a single-use state bound to this app session and
//                  the WHOOP authorize URL for ASWebAuthenticationSession.
//   GET  /callback (public)  → WHOOP sends the browser back with ?code&state.
//                  The code is exchanged server-side with the client secret,
//                  the WHOOP user id is read, and the tokens are sealed as a
//                  pending completion returned to the app via tresfort://.
//   POST /finish   (the same app session + completion secret) → activate, then
//                  the first sync runs in the background.
// The client secret never leaves the Worker.
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import type { Env, HonoEnv } from '../types';
import { requireAppJwt } from '../auth';
import {
  consumeWhoopOAuthState, createWhoopOAuthCompletion, createWhoopOAuthState, finishWhoopOAuth, syncWhoop, writeAudit,
} from '../db';
import { exchangeWhoopCode, fetchWhoopUserId, whoopAuthorizeUrl } from '../whoop';
import type { Fetcher } from '../intervals';
import { diagnosticErrorType } from '../errors';

export const whoopAuthRoutes = new Hono<HonoEnv>();
whoopAuthRoutes.use('*', async (c, next) => {
  c.header('Cache-Control', 'no-store');
  c.header('Referrer-Policy', 'no-referrer');
  await next();
});

const fetcher: Fetcher = (input, init) => globalThis.fetch(input, init);

/** Byte-identical between /start and /callback; WHOOP rejects a mismatch. */
function callbackUrl(env: Env, reqUrl: string): string {
  return env.WHOOP_OAUTH_REDIRECT_URI ?? `${new URL(reqUrl).origin}/auth/whoop/callback`;
}

function appReturn(query: string): string {
  return `tresfort://whoop-connected?${query}`;
}

function failure(detail: string): string {
  return appReturn(`error=${encodeURIComponent(detail.slice(0, 64))}`);
}

whoopAuthRoutes.post('/start', requireAppJwt, async (c) => {
  if (!c.env.WHOOP_CLIENT_ID || !c.env.WHOOP_CLIENT_SECRET) return c.json({ error: 'whoop_not_configured' }, 503);
  const sessionId = c.get('appSessionId');
  if (!sessionId) return c.json({ error: 'app_session_required' }, 401);
  const state = await createWhoopOAuthState(c.env.DB, c.get('userId'), sessionId);
  return c.json({ authorize_url: whoopAuthorizeUrl(c.env.WHOOP_CLIENT_ID, callbackUrl(c.env, c.req.url), state) });
});

whoopAuthRoutes.get('/callback', async (c) => {
  const q = c.req.query();
  if (q.error) return c.redirect(failure(q.error), 302);
  if (!q.code || !q.state) return c.redirect(failure('missing_code'), 302);
  const attempt = await consumeWhoopOAuthState(c.env.DB, q.state);
  if (!attempt) return c.redirect(failure('bad_state'), 302);
  const clientId = c.env.WHOOP_CLIENT_ID, clientSecret = c.env.WHOOP_CLIENT_SECRET;
  if (!clientId || !clientSecret || !c.env.CREDENTIAL_ENCRYPTION_KEY) return c.redirect(failure('whoop_not_configured'), 302);
  const exchanged = await exchangeWhoopCode(fetcher, {
    clientId, clientSecret, code: q.code, redirectUri: callbackUrl(c.env, c.req.url),
  });
  if (!exchanged.ok) return c.redirect(failure(`exchange_${exchanged.status ?? 'network'}`), 302);
  if (!exchanged.tokens.refreshToken) return c.redirect(failure('no_refresh_token'), 302);
  const profile = await fetchWhoopUserId(fetcher, exchanged.tokens.accessToken);
  if (!profile.ok) return c.redirect(failure(`profile_${profile.status ?? profile.reason}`), 302);
  const completion = await createWhoopOAuthCompletion(
    c.env.DB, attempt.user_id, attempt.app_session_id, { ...exchanged.tokens, providerUserId: profile.value },
    c.env.CREDENTIAL_ENCRYPTION_KEY,
  );
  return c.redirect(appReturn(`completion=${encodeURIComponent(completion)}`), 302);
});

whoopAuthRoutes.post('/finish', bodyLimit({ maxSize: 1024 }), requireAppJwt, async (c) => {
  const body: unknown = await c.req.json().catch(() => null);
  if (!body || typeof body !== 'object' || Array.isArray(body)
      || Object.keys(body).some(key => key !== 'completion') || typeof (body as { completion?: unknown }).completion !== 'string') {
    return c.json({ error: 'invalid_completion' }, 400);
  }
  const sessionId = c.get('appSessionId');
  if (!sessionId) return c.json({ error: 'invalid_completion' }, 400);
  const userId = c.get('userId');
  const result = await finishWhoopOAuth(c.env.DB, c.env, userId, sessionId, (body as { completion: string }).completion);
  if ('error' in result) return c.json({ error: result.error }, result.error === 'account_in_use' ? 409 : 400);
  await writeAudit(c.env.DB, userId, 'whoop_connect', { provider: 'whoop' }, 'connected', c.get('appClient'));
  c.executionCtx.waitUntil(syncWhoop(c.env.DB, c.env, userId).catch((error: unknown) => {
    console.error({ event: 'whoop_first_sync_failed', error_type: diagnosticErrorType(error) });
  }));
  return c.json({ connected: true });
});
