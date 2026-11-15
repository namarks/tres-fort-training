// intervals.icu push webhook receiver — the §8 "sync evolution" that made push
// the primary sync path. The `wrangler.jsonc` cron (hourly: "0 * * * *") is now
// only the backstop for an undelivered webhook.
//
// One PUBLIC route, mounted at /webhooks:
//   POST /intervals  → intervals.icu POSTs a batch of events here whenever an
//                      athlete's data changes. We authenticate by matching the
//                      body `secret` (NOT app-JWT / MCP bearer), then for each
//                      event resolve the user by athlete_id and kick the
//                      relevant idempotent cache sync in the background.
//
// CONTRACT (from the intervals.icu cookbook + Manage App page):
//   - Body JSON: { secret, events: [{ athlete_id, type, timestamp, ... }] }.
//     CALENDAR_UPDATED events also carry oauth_client_id / external_id and
//     events[] / deleted_events[] arrays (we don't need those — a full
//     reconciled re-sync covers them).
//   - Authenticity = body `secret` === env.INTERVALS_WEBHOOK_SECRET. The
//     Manage App page can ALSO set a "Webhook Authorization Header"; when
//     env.INTERVALS_WEBHOOK_AUTH_HEADER is configured we additionally require
//     the request's Authorization header to match it.
//   - MUST return HTTP 200 on success. intervals retries on any non-2xx and
//     historically retried even on 204, so we return 200 with a tiny body —
//     NEVER 204.
//   - Webhooks can be DUPLICATED (multiple CALENDAR_UPDATED for one change)
//     and ACTIVITY_ANALYZED is delayed ~60s, so processing MUST be idempotent.
//     syncExternalEvents / syncExternalActivities are reconciled-cache syncs
//     that are already idempotent — re-triggering them is safe.
//   - STRAVA NUANCE: intervals does NOT deliver ACTIVITY_* webhooks for
//     Strava-sourced activities; CALENDAR_UPDATED is the catch-all. So
//     CALENDAR_UPDATED triggers BOTH an events sync AND an activities sync
//     (the latter covers a Strava-routed completed ride).
import { Hono } from 'hono';
import { diagnosticErrorType } from '../errors';
import type { HonoEnv } from '../types';
import {
  findWhoopMember, getUserByIntervalsAthleteId, handleGarminDeregistrations, handleGarminPermissionChanges,
  processGarminFiles, queueGarminActivityFiles, syncExternalActivities, syncExternalEvents, syncWhoopEvent,
} from '../db';
import { verifyWhoopWebhook } from '../whoop';
import {
  isGarminPushAddress, parseGarminActivityFiles, parseGarminDeregistrations, parseGarminPermissionChanges,
} from '../garmin';

export const webhookRoutes = new Hono<HonoEnv>();

/** Which cache sync(s) a given webhook event type should trigger. */
type SyncKind = 'events' | 'activities';

function syncsForType(type: string): SyncKind[] {
  // CALENDAR_UPDATED is the catch-all (covers Strava completed rides that
  // never fire ACTIVITY_*), so it kicks BOTH syncs.
  if (type === 'CALENDAR_UPDATED') return ['events', 'activities'];
  // Any ACTIVITY_* (UPLOADED / ANALYZED / UPDATED / DELETED) is a completed-
  // activity change → reconcile the actuals cache.
  if (type.startsWith('ACTIVITY_')) return ['activities'];
  // WELLNESS_UPDATED / FITNESS_UPDATED: accepted, but no-op — there is no
  // fitness/wellness store yet.
  // TODO(multisport §9 get_fitness): when a Form/Fatigue store lands, sync it
  // here on WELLNESS_UPDATED / FITNESS_UPDATED.
  return [];
}

// POST /webhooks/intervals — PUBLIC (authenticated only by the body secret).
webhookRoutes.post('/intervals', async (c) => {
  const configured = c.env.INTERVALS_WEBHOOK_SECRET;
  // If no secret is configured the receiver is dormant: reject so a misrouted
  // or premature POST can never trigger syncs unauthenticated.
  if (!configured) return c.json({ error: 'webhook_not_configured' }, 401);

  // Parse the body defensively — a malformed payload is unauthenticated by
  // definition (no matching secret), so it gets the same 401 as a wrong one.
  let body: { secret?: unknown; events?: unknown };
  try {
    body = await c.req.json<{ secret?: unknown; events?: unknown }>();
  } catch {
    return c.json({ error: 'invalid_payload' }, 401);
  }

  if (typeof body.secret !== 'string' || body.secret !== configured) {
    return c.json({ error: 'unauthorized' }, 401);
  }

  // Optional second factor: a configured "Webhook Authorization Header" on the
  // Manage App page. When set, the request's Authorization header must match.
  const headerExpected = c.env.INTERVALS_WEBHOOK_AUTH_HEADER;
  if (headerExpected && c.req.header('authorization') !== headerExpected) {
    return c.json({ error: 'unauthorized' }, 401);
  }

  // Secret valid → from here we ALWAYS return 200, even for unknown athletes /
  // types / an empty batch, so intervals never retries an already-accepted
  // delivery. Heavy work runs in the background via waitUntil so the 200
  // returns fast.
  const events = Array.isArray(body.events) ? body.events : [];

  // Deduplicate the (athleteId, syncKind) work this batch implies: a single
  // POST can carry duplicate CALENDAR_UPDATED events, and we never need to run
  // the same sync for the same user twice in one delivery.
  const eventsToSync = new Set<string>(); // user_id
  const activitiesToSync = new Set<string>(); // user_id

  for (const raw of events) {
    if (!raw || typeof raw !== 'object') continue;
    const ev = raw as { athlete_id?: unknown; type?: unknown };
    const athleteId = typeof ev.athlete_id === 'string' ? ev.athlete_id : null;
    const type = typeof ev.type === 'string' ? ev.type : null;
    if (!athleteId || !type) continue;

    const kinds = syncsForType(type);
    if (kinds.length === 0) continue; // accepted no-op (e.g. WELLNESS_UPDATED)

    // Resolve athlete → user. Unknown / disconnected athlete → accept
    // gracefully (no row, nothing to sync).
    const user = await getUserByIntervalsAthleteId(c.env.DB, athleteId);
    if (!user) continue;

    if (kinds.includes('events')) eventsToSync.add(user.id);
    if (kinds.includes('activities')) activitiesToSync.add(user.id);
  }

  if (eventsToSync.size > 0 || activitiesToSync.size > 0) {
    const env = c.env;
    c.executionCtx.waitUntil(
      (async () => {
        // Each sync is isolated so one user's / one kind's failure can't crash
        // the handler or block the others — mirrors the cron in src/index.ts.
        for (const userId of eventsToSync) {
          try {
            await syncExternalEvents(env.DB, env, { userId });
          } catch (error) {
            console.error({
              event: 'intervals_webhook_sync_failed',
              cache: 'events',
              error_type: diagnosticErrorType(error),
            });
          }
        }
        for (const userId of activitiesToSync) {
          try {
            await syncExternalActivities(env.DB, env, { userId });
          } catch (error) {
            console.error({
              event: 'intervals_webhook_sync_failed',
              cache: 'activities',
              error_type: diagnosticErrorType(error),
            });
          }
        }
      })(),
    );
  }

  // 200 (never 204) with a tiny body. intervals only needs a 2xx.
  return c.json({ ok: true }, 200);
});

// POST /webhooks/whoop — PUBLIC, authenticated by WHOOP's signature
// (docs/plans/whoop): base64 HMAC-SHA256 of X-WHOOP-Signature-Timestamp plus
// the raw body, keyed with the app's client secret. The body names only the
// WHOOP user and the record ({ user_id, id, type, trace_id }), so any
// workout, sleep or recovery event re-syncs that member's window back past
// the named record (at least 14 days), which also covers deletions. A 2xx
// stops WHOOP's retries.
webhookRoutes.post('/whoop', async (c) => {
  const secret = c.env.WHOOP_CLIENT_SECRET;
  if (!secret || !c.env.WHOOP_CLIENT_ID) return c.json({ error: 'webhook_not_configured' }, 401);
  const raw = await c.req.text();
  if (raw.length > 16_384) return c.json({ error: 'invalid_payload' }, 413);
  const valid = await verifyWhoopWebhook(
    secret, c.req.header('x-whoop-signature-timestamp') ?? null, c.req.header('x-whoop-signature') ?? null, raw,
  );
  if (!valid) return c.json({ error: 'unauthorized' }, 401);
  let body: { user_id?: unknown; type?: unknown; id?: unknown };
  try { body = JSON.parse(raw) as typeof body; } catch { return c.json({ ok: true }, 200); }
  const whoopUser = typeof body?.user_id === 'number' && Number.isSafeInteger(body.user_id) ? String(body.user_id)
    : typeof body?.user_id === 'string' && /^\d{1,20}$/.test(body.user_id) ? body.user_id : null;
  const type = typeof body?.type === 'string' ? body.type : '';
  if (!whoopUser || !/^(workout|sleep|recovery)\./.test(type)) return c.json({ ok: true }, 200);
  const userId = await findWhoopMember(c.env.DB, whoopUser);
  if (userId) {
    const env = c.env;
    const id = typeof body.id === 'string' ? body.id : null;
    c.executionCtx.waitUntil(syncWhoopEvent(env.DB, env, userId, { type, id }).catch((error: unknown) => {
      console.error({ event: 'whoop_webhook_sync_failed', error_type: diagnosticErrorType(error) });
    }));
  }
  return c.json({ ok: true }, 200);
});

/** Constant-time comparison of two strings of any length. */
async function sameSecret(a: string, b: string): Promise<boolean> {
  const digest = async (v: string) => new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(v)));
  const [x, y] = await Promise.all([digest(a), digest(b)]);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i]! ^ y[i]!;
  return diff === 0;
}

// POST /webhooks/garmin/:secret — accepts authenticated Garmin notifications,
// queues activity files, and handles disconnects and permission changes.
webhookRoutes.post('/garmin/:secret', async (c) => {
  const env = c.env;
  if (!env.GARMIN_CLIENT_ID || !env.GARMIN_CLIENT_SECRET || !env.GARMIN_PUSH_SECRET
      || !(await sameSecret(c.req.param('secret'), env.GARMIN_PUSH_SECRET))) {
    return c.json({ error: 'not_found' }, 404);
  }
  if (c.req.header('garmin-client-id') !== env.GARMIN_CLIENT_ID
      || !isGarminPushAddress(c.req.header('cf-connecting-ip'))) {
    return c.json({ error: 'forbidden' }, 403);
  }
  const raw = await c.req.text();
  if (raw.length > 1_048_576) return c.json({ error: 'invalid_payload' }, 413);
  let body: unknown;
  try { body = JSON.parse(raw); } catch { return c.json({ ok: true }, 200); }
  const members = await queueGarminActivityFiles(env.DB, env, parseGarminActivityFiles(body));
  await handleGarminDeregistrations(env.DB, parseGarminDeregistrations(body));
  await handleGarminPermissionChanges(env.DB, parseGarminPermissionChanges(body));
  if (members.length > 0) {
    c.executionCtx.waitUntil((async () => {
      for (const userId of members) {
        try {
          await processGarminFiles(env.DB, env, { userId });
        } catch (error) {
          console.error({ event: 'garmin_file_import_failed', error_type: diagnosticErrorType(error) });
        }
      }
    })());
  }
  return c.json({ ok: true }, 200);
});
