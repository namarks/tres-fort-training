// WHOOP connection and sync (docs/plans/whoop P2 and P3). Internal service:
// public callers use the db.ts facade, which injects the shared helpers.
//
// - Connect mirrors intervals.icu's flow (migration 0065): a single-use state
//   bound to the app session, then a completion secret only that session can
//   redeem, so a browser return alone never links an account.
// - Tokens are sealed. WHOOP rotates the refresh token on every refresh, so a
//   refresh first claims a short lease and then swaps tokens with a
//   compare-and-swap on token_version; a request that loses the race uses the
//   winner's token instead of spending a dead refresh token.
// - A sync reconciles a time window: workouts into external_activities
//   (source='whoop'), cycles into daily_recovery. Every write is guarded by
//   the connection_id it started with, so a disconnect is never undone by a
//   sync that was already running.
// - WHOOP data stays out of the coach and group views (see the plan's notes on
//   WHOOP's API terms). Those exclusions live with each query.
import { markWebState } from '../connectReturn';
import { credentialDigest, openCredential, randomSecret, sealCredential } from '../credentials';
import type { Fetcher } from '../intervals';
import type { Env } from '../types';
import {
  buildRecoveryDays, fetchWhoopCollection, fetchWhoopRecordStart, parseWhoopWorkout, refreshWhoopTokens, revokeWhoopAccess,
  type RecoveryDay, type WhoopReadResult, type WhoopTokens, type WhoopWorkout,
} from '../whoop';
import { sportLabel } from '../sports';

const DAY_MS = 86_400_000;
const STATE_TTL_MS = 10 * 60_000;
const LEASE_MS = 30_000;
/** A sync holds its connection this long at most; a crashed one frees it then. */
const SYNC_LEASE_MS = 5 * 60_000;
/** Refresh this long before WHOOP's expiry, so a sync never starts on a token about to lapse. */
const EXPIRY_MARGIN_MS = 2 * 60_000;
export const WHOOP_FIRST_SYNC_DAYS = 90;
export const WHOOP_SYNC_DAYS = 14;
/** The furthest back one webhook reaches to reconcile an older record. */
export const WHOOP_EVENT_MAX_DAYS = 400;

export interface WhoopDeps {
  /** Cross-source dedup (db.ts dedupeHealthKitAgainstIntervals). */
  dedupe: (db: D1Database, userId: string) => Promise<number>;
  refreshActivityLoads: (db: D1Database, userId: string, window?: { fromDate?: string; toDate?: string }) => Promise<number>;
  getUserTimezone: (db: D1Database, userId: string) => Promise<string | null>;
  /** db.ts fitLocalTime: civil date, wall-clock ms and zone label. */
  localTime: (startUtcMs: number, offsetSec: number | null, zone: string | null) => { date: string; localMs: number; zone: string };
}

export interface PendingWhoopCredential extends WhoopTokens {
  providerUserId: string;
}

interface ConnectionRow {
  connection_id: string;
  provider_user_id: string;
  access_token: string;
  refresh_token: string | null;
  expires_at: number | null;
  token_version: number;
  refresh_lease_until: number | null;
  auth_error_at: number | null;
  last_synced_at: number | null;
  connected_at: number;
  sync_attempt: number;
}

export interface WhoopStatus {
  configured: boolean;
  connected: boolean;
  needs_reauth: boolean;
  connected_at: number | null;
  last_synced_at: number | null;
}

export type WhoopTokenAccess =
  | { ok: true; token: string; connectionId: string }
  | { ok: false; reason: 'disabled' | 'not_connected' | 'reauth' | 'busy' | 'transient' };

export type WhoopSyncStatus = 'ok' | 'partial' | 'disabled' | 'not_connected' | 'reauth' | 'busy' | 'fetch_failed';
export interface WhoopSyncResult {
  status: WhoopSyncStatus;
  workouts: number;
  days: number;
}

export interface RecoveryDayView {
  date: string;
  recovery_score: number | null;
  hrv_rmssd_ms: number | null;
  resting_hr: number | null;
  spo2_pct: number | null;
  skin_temp_c: number | null;
  calibrating: boolean | null;
  sleep_start_utc_ms: number | null;
  sleep_end_utc_ms: number | null;
  sleep_ms: number | null;
  in_bed_ms: number | null;
  sleep_performance_pct: number | null;
  sleep_efficiency_pct: number | null;
  respiratory_rate: number | null;
  day_strain: number | null;
  source: 'whoop';
}

function configured(env: Env): env is Env & { WHOOP_CLIENT_ID: string; WHOOP_CLIENT_SECRET: string } {
  return Boolean(env.WHOOP_CLIENT_ID && env.WHOOP_CLIENT_SECRET);
}

const purpose = {
  access: 'whoop-access-token',
  refresh: 'whoop-refresh-token',
  completion: (digest: string) => `whoop-completion:${digest}`,
};

/** Sync writes bind ?3 to `${connection_id}:${sync_attempt}`: a write from a
 * disconnected connection or a superseded sync attempt changes nothing. */
const guard = `EXISTS (SELECT 1 FROM provider_connections
  WHERE user_id = ?2 AND provider = 'whoop' AND connection_id || ':' || sync_attempt = ?3)`;

/**
 * Retire WHOOP workouts that another record already covers, and restore ones
 * whose cover went away. A WHOOP workout is a copy when at least half of the
 * shorter of the two overlaps: a completed Tres Fort session (for a strength
 * or unnamed WHOOP workout), or an intervals.icu, .fit or recorded-run
 * activity of the same kind (any kind when WHOOP's is unnamed). WHOOP's
 * auto-detected start and end often differ from the watch by minutes, so the
 * two-minute start match the other sources use would miss them.
 */
export async function retireWhoopDuplicates(db: D1Database, userId: string, now = Date.now()): Promise<number> {
  const dur = 'COALESCE(i.elapsed_time_sec, i.moving_time_sec) * 1000';
  const ws = 'w.start_date_utc_ms';
  const we = '(w.start_date_utc_ms + w.elapsed_time_sec * 1000)';
  const overlapActivity = `MIN(i.start_date_utc_ms + ${dur}, ${we}) - MAX(i.start_date_utc_ms, ${ws})`;
  const overlapSession = `MIN(s.completed_at, ${we}) - MAX(s.started_at, ${ws})`;
  const result = await db.prepare(`WITH desired AS MATERIALIZED (
      SELECT w.id, COALESCE(
        (SELECT 'session:' || id FROM (
           SELECT s.id, ${overlapSession} AS overlap, s.completed_at - s.started_at AS span, ${we} - ${ws} AS whoop_span
             FROM sessions s
            WHERE s.user_id = ?1 AND s.status = 'completed' AND w.kind IN ('strength', 'other')
              AND s.started_at IS NOT NULL AND s.completed_at > s.started_at
         ) WHERE overlap >= 0.5 * MIN(span, whoop_span) ORDER BY overlap DESC, id LIMIT 1),
        (SELECT id FROM (
           SELECT i.id, ${overlapActivity} AS overlap, ${dur} AS span, ${we} - ${ws} AS whoop_span
             FROM external_activities i
            WHERE i.user_id = ?1 AND i.source IN ('intervals', 'fit', 'recording', 'garmin') AND i.deleted_at IS NULL
              AND i.start_date_utc_ms IS NOT NULL AND COALESCE(i.elapsed_time_sec, i.moving_time_sec) > 0
              AND (i.kind = w.kind OR w.kind = 'other')
         ) WHERE overlap >= 0.5 * MIN(span, whoop_span) ORDER BY overlap DESC, id LIMIT 1)
      ) AS winner
        FROM external_activities w
       WHERE w.user_id = ?1 AND w.source = 'whoop' AND (w.deleted_at IS NULL OR w.duplicate_of IS NOT NULL)
         AND w.start_date_utc_ms IS NOT NULL AND w.elapsed_time_sec > 0
    ) UPDATE external_activities SET
      duplicate_of = (SELECT winner FROM desired WHERE desired.id = external_activities.id),
      canonical = CASE WHEN (SELECT winner FROM desired WHERE desired.id = external_activities.id) IS NULL THEN 1 ELSE 0 END,
      deleted_at = CASE WHEN (SELECT winner FROM desired WHERE desired.id = external_activities.id) IS NULL
        THEN NULL ELSE MAX(synced_at + 1, ?2) END,
      synced_at = MAX(synced_at + 1, ?2)
    WHERE id IN (SELECT id FROM desired) AND (
      duplicate_of IS NOT (SELECT winner FROM desired WHERE desired.id = external_activities.id)
      OR (deleted_at IS NULL) != ((SELECT winner FROM desired WHERE desired.id = external_activities.id) IS NULL)
    )`).bind(userId, now).run();
  return result.meta.changes ?? 0;
}

export function createWhoopService(deps: WhoopDeps) {
  async function readConnection(db: D1Database, userId: string): Promise<ConnectionRow | null> {
    return db.prepare(
      `SELECT connection_id, provider_user_id, access_token, refresh_token, expires_at, token_version,
              refresh_lease_until, auth_error_at, last_synced_at, connected_at, sync_attempt
         FROM provider_connections WHERE user_id = ?1 AND provider = 'whoop'`,
    ).bind(userId).first<ConnectionRow>();
  }

  async function createWhoopOAuthState(db: D1Database, userId: string, appSessionId: string, now = Date.now(),
    web = false): Promise<string> {
    // A web sign-in's state is marked so its callback returns to the web app.
    // The digest covers the marker, so it can't be added or removed.
    const state = web ? markWebState(randomSecret()) : randomSecret();
    await db.batch([
      db.prepare('DELETE FROM provider_oauth_states WHERE expires_at <= ?1').bind(now),
      db.prepare(`INSERT INTO provider_oauth_states (state_sha256, user_id, provider, app_session_id, expires_at)
        VALUES (?1, ?2, 'whoop', ?3, ?4)`).bind(await credentialDigest(state), userId, appSessionId, now + STATE_TTL_MS),
    ]);
    return state;
  }

  /** Single use: the row is deleted whether or not it is still valid. */
  async function consumeWhoopOAuthState(db: D1Database, state: string, now = Date.now()) {
    if (!/^(?:web\.)?[A-Za-z0-9_-]{43}$/.test(state)) return null;
    const row = await db.prepare(`DELETE FROM provider_oauth_states WHERE state_sha256 = ?1 AND provider = 'whoop'
      RETURNING user_id, app_session_id, expires_at`).bind(await credentialDigest(state))
      .first<{ user_id: string; app_session_id: string; expires_at: number }>();
    if (!row || row.expires_at <= now) return null;
    return { user_id: row.user_id, app_session_id: row.app_session_id };
  }

  async function createWhoopOAuthCompletion(
    db: D1Database, userId: string, appSessionId: string, credential: PendingWhoopCredential,
    encryptionKey: string | undefined, now = Date.now(),
  ): Promise<string> {
    const completion = randomSecret();
    const digest = await credentialDigest(completion);
    const ciphertext = await sealCredential(JSON.stringify(credential), encryptionKey, userId, purpose.completion(digest));
    await db.batch([
      db.prepare('DELETE FROM provider_oauth_completions WHERE expires_at <= ?1').bind(now),
      db.prepare(`INSERT INTO provider_oauth_completions
          (completion_sha256, user_id, provider, app_session_id, credential_ciphertext, expires_at)
        VALUES (?1, ?2, 'whoop', ?3, ?4, ?5)`).bind(digest, userId, appSessionId, ciphertext, now + STATE_TTL_MS),
    ]);
    return completion;
  }

  /** Activate a connection from the original app session's completion secret.
   * A new connection_id fences off anything a previous connection started. */
  async function finishWhoopOAuth(
    db: D1Database, env: Env, userId: string, appSessionId: string, completion: string, now = Date.now(),
  ): Promise<{ connected: true; connection_id: string } | { error: 'invalid_completion' | 'account_in_use' }> {
    if (!/^[A-Za-z0-9_-]{43}$/.test(completion)) return { error: 'invalid_completion' };
    const digest = await credentialDigest(completion);
    const pending = await db.prepare(`DELETE FROM provider_oauth_completions
        WHERE completion_sha256 = ?1 AND user_id = ?2 AND app_session_id = ?3 AND provider = 'whoop'
        RETURNING credential_ciphertext, expires_at`).bind(digest, userId, appSessionId)
      .first<{ credential_ciphertext: string; expires_at: number }>();
    if (!pending || pending.expires_at <= now) return { error: 'invalid_completion' };
    const credential = JSON.parse((await openCredential(
      pending.credential_ciphertext, env.CREDENTIAL_ENCRYPTION_KEY, userId, purpose.completion(digest),
    ))!) as PendingWhoopCredential;
    const other = await db.prepare(`SELECT user_id FROM provider_connections
        WHERE provider = 'whoop' AND provider_user_id = ?1 AND user_id <> ?2`)
      .bind(credential.providerUserId, userId).first<{ user_id: string }>();
    if (other) return { error: 'account_in_use' };
    const previous = await readConnection(db, userId);
    const connectionId = crypto.randomUUID();
    const access = await sealCredential(credential.accessToken, env.CREDENTIAL_ENCRYPTION_KEY, userId, purpose.access);
    const refresh = await sealCredential(credential.refreshToken, env.CREDENTIAL_ENCRYPTION_KEY, userId, purpose.refresh);
    const statements = [
      db.prepare(`INSERT INTO provider_connections
          (user_id, provider, connection_id, provider_user_id, access_token, refresh_token, expires_at, scopes,
           token_version, refresh_lease_until, auth_error_at, last_synced_at, connected_at, updated_at)
        VALUES (?1, 'whoop', ?2, ?3, ?4, ?5, ?6, ?7, 1, NULL, NULL, NULL, ?8, ?8)
        ON CONFLICT (user_id, provider) DO UPDATE SET
          connection_id = excluded.connection_id, provider_user_id = excluded.provider_user_id,
          access_token = excluded.access_token, refresh_token = excluded.refresh_token,
          expires_at = excluded.expires_at, scopes = excluded.scopes,
          token_version = provider_connections.token_version + 1, refresh_lease_until = NULL,
          auth_error_at = NULL, last_synced_at = NULL, connected_at = excluded.connected_at,
          updated_at = excluded.updated_at`)
        .bind(userId, connectionId, credential.providerUserId, access, refresh, credential.expiresAt, credential.scopes, now),
    ];
    // Reconnecting a different WHOOP account starts clean.
    if (previous && previous.provider_user_id !== credential.providerUserId) {
      statements.push(...forgetWhoopData(db, userId, now));
    }
    try {
      await db.batch(statements);
    } catch (error) {
      if (error instanceof Error && /UNIQUE/i.test(error.message)) return { error: 'account_in_use' };
      throw error;
    }
    return { connected: true, connection_id: connectionId };
  }

  function forgetWhoopData(db: D1Database, userId: string, now: number): D1PreparedStatement[] {
    return [
      db.prepare(`UPDATE external_activities
          SET deleted_at = MAX(synced_at + 1, ?2), synced_at = MAX(synced_at + 1, ?2), canonical = 1, duplicate_of = NULL
        WHERE user_id = ?1 AND source = 'whoop' AND (deleted_at IS NULL OR duplicate_of IS NOT NULL)`).bind(userId, now),
      db.prepare(`DELETE FROM daily_recovery WHERE user_id = ?1 AND source = 'whoop'`).bind(userId),
    ];
  }

  async function getWhoopStatus(db: D1Database, env: Env, userId: string): Promise<WhoopStatus> {
    const row = await readConnection(db, userId);
    return {
      configured: configured(env),
      connected: row !== null,
      needs_reauth: row?.auth_error_at != null,
      connected_at: row?.connected_at ?? null,
      last_synced_at: row?.last_synced_at ?? null,
    };
  }

  /**
   * Disconnect: drop the tokens, hide the member's WHOOP workouts (Apple
   * Health copies they had hidden come back) and delete their recovery days.
   * WHOOP is told on a best-effort basis. Idempotent.
   */
  async function disconnectWhoop(
    db: D1Database, env: Env, userId: string, fetcher: Fetcher = (i, init) => globalThis.fetch(i, init), now = Date.now(),
  ): Promise<{ disconnected: boolean }> {
    const row = await readConnection(db, userId);
    let token: string | null = null;
    if (row) {
      try { token = await openCredential(row.access_token, env.CREDENTIAL_ENCRYPTION_KEY, userId, purpose.access); }
      catch { token = null; }
    }
    await db.batch([
      db.prepare(`DELETE FROM provider_connections WHERE user_id = ?1 AND provider = 'whoop'`).bind(userId),
      db.prepare(`DELETE FROM provider_oauth_completions WHERE user_id = ?1 AND provider = 'whoop'`).bind(userId),
      db.prepare(`DELETE FROM provider_oauth_states WHERE user_id = ?1 AND provider = 'whoop'`).bind(userId),
      ...forgetWhoopData(db, userId, now),
    ]);
    await deps.dedupe(db, userId);
    if (token && row && (row.expires_at === null || row.expires_at > now)) await revokeWhoopAccess(fetcher, token);
    return { disconnected: row !== null };
  }

  /** A usable access token, refreshing it (once, across concurrent requests) when it is about to expire. */
  async function whoopAccessToken(
    db: D1Database, env: Env, userId: string, fetcher: Fetcher, now = Date.now(),
  ): Promise<WhoopTokenAccess> {
    if (!configured(env)) return { ok: false, reason: 'disabled' };
    const key = env.CREDENTIAL_ENCRYPTION_KEY;
    for (let attempt = 0; attempt < 2; attempt++) {
      const row = await readConnection(db, userId);
      if (!row) return { ok: false, reason: 'not_connected' };
      if (row.auth_error_at !== null) return { ok: false, reason: 'reauth' };
      if (row.expires_at === null || row.expires_at > now + EXPIRY_MARGIN_MS) {
        const token = await openCredential(row.access_token, key, userId, purpose.access);
        return { ok: true, token: token!, connectionId: row.connection_id };
      }
      const refreshToken = await openCredential(row.refresh_token, key, userId, purpose.refresh);
      if (!refreshToken) {
        await markReauth(db, userId, row.connection_id, row.token_version, now);
        return { ok: false, reason: 'reauth' };
      }
      // Every write below is fenced by connection_id as well as token_version:
      // a reconnect starts a new row at version 1, which an old refresh must
      // never touch.
      const claimed = await db.prepare(`UPDATE provider_connections SET refresh_lease_until = ?3
          WHERE user_id = ?1 AND provider = 'whoop' AND token_version = ?2
            AND (refresh_lease_until IS NULL OR refresh_lease_until <= ?4) AND connection_id = ?5`)
        .bind(userId, row.token_version, now + LEASE_MS, now, row.connection_id).run();
      if ((claimed.meta.changes ?? 0) !== 1) {
        // Another request is refreshing (or just did). Re-read once: if it
        // finished, its token is used; otherwise this attempt yields.
        if (attempt === 0) continue;
        return { ok: false, reason: 'busy' };
      }
      const refreshed = await refreshWhoopTokens(fetcher, {
        clientId: env.WHOOP_CLIENT_ID, clientSecret: env.WHOOP_CLIENT_SECRET, refreshToken,
      });
      if (!refreshed.ok) {
        if (refreshed.reason === 'invalid') {
          await markReauth(db, userId, row.connection_id, row.token_version, now);
          return { ok: false, reason: 'reauth' };
        }
        await db.prepare(`UPDATE provider_connections SET refresh_lease_until = NULL
            WHERE user_id = ?1 AND provider = 'whoop' AND token_version = ?2 AND connection_id = ?3`)
          .bind(userId, row.token_version, row.connection_id).run();
        return { ok: false, reason: 'transient' };
      }
      const t = refreshed.tokens;
      const access = await sealCredential(t.accessToken, key, userId, purpose.access);
      // WHOOP sends a new refresh token with every refresh; keep the old one only if it did not.
      const nextRefresh = t.refreshToken === null ? row.refresh_token
        : await sealCredential(t.refreshToken, key, userId, purpose.refresh);
      const swapped = await db.prepare(`UPDATE provider_connections
          SET access_token = ?3, refresh_token = ?4, expires_at = ?5, scopes = COALESCE(?6, scopes),
              token_version = token_version + 1, refresh_lease_until = NULL, updated_at = ?7
        WHERE user_id = ?1 AND provider = 'whoop' AND token_version = ?2 AND connection_id = ?8`)
        .bind(userId, row.token_version, access, nextRefresh, t.expiresAt, t.scopes, now, row.connection_id).run();
      // Disconnected or reconnected while refreshing: the new tokens belong to nothing.
      if ((swapped.meta.changes ?? 0) !== 1) return { ok: false, reason: 'not_connected' };
      return { ok: true, token: t.accessToken, connectionId: row.connection_id };
    }
    return { ok: false, reason: 'busy' };
  }

  async function markReauth(db: D1Database, userId: string, connectionId: string, tokenVersion: number, now: number) {
    await db.prepare(`UPDATE provider_connections SET auth_error_at = ?3, refresh_lease_until = NULL, updated_at = ?3
        WHERE user_id = ?1 AND provider = 'whoop' AND token_version = ?2 AND connection_id = ?4`)
      .bind(userId, tokenVersion, now, connectionId).run();
  }

  function workoutStatement(
    db: D1Database, userId: string, connectionId: string, w: WhoopWorkout,
    local: { date: string; localMs: number; zone: string }, now: number,
  ): D1PreparedStatement {
    const seconds = Math.round((w.endUtcMs - w.startUtcMs) / 1000);
    const raw = JSON.stringify({
      source: 'whoop', score_state: w.scored ? 'SCORED' : 'UNSCORED',
      percent_recorded: w.percentRecorded, zone_durations_ms: w.zoneDurationsMs,
    });
    const changed = ['date', 'start_date_local_ms', 'kind', 'name', 'moving_time_sec', 'elapsed_time_sec', 'distance_m',
      'average_hr', 'max_hr', 'calories', 'elevation_gain_m', 'raw', 'start_date_utc_ms', 'source_timezone', 'sport', 'strain']
      .map(c => `external_activities.${c} IS NOT excluded.${c}`).join(' OR ');
    return db.prepare(`INSERT INTO external_activities
        (id, user_id, source, external_id, date, start_date_local_ms, kind, name, moving_time_sec, elapsed_time_sec,
         distance_m, average_watts, weighted_avg_watts, average_hr, max_hr, training_load, intensity, calories,
         elevation_gain_m, raw, synced_at, deleted_at, canonical, duplicate_of, start_date_utc_ms, source_timezone,
         sport, strain)
      SELECT ?1, ?2, 'whoop', ?4, ?5, ?6, ?7, ?8, ?9, ?9, ?10, NULL, NULL, ?11, ?12, NULL, NULL, ?13, ?14, ?15, ?16,
             NULL, 1, NULL, ?17, ?18, ?19, ?20
       WHERE ${guard}
      ON CONFLICT (id) DO UPDATE SET
        date = excluded.date, start_date_local_ms = excluded.start_date_local_ms, kind = excluded.kind,
        name = excluded.name, moving_time_sec = excluded.moving_time_sec, elapsed_time_sec = excluded.elapsed_time_sec,
        distance_m = excluded.distance_m, average_hr = excluded.average_hr, max_hr = excluded.max_hr,
        calories = excluded.calories, elevation_gain_m = excluded.elevation_gain_m, raw = excluded.raw,
        start_date_utc_ms = excluded.start_date_utc_ms, source_timezone = excluded.source_timezone,
        sport = excluded.sport, strain = excluded.strain,
        deleted_at = CASE WHEN external_activities.duplicate_of IS NULL THEN NULL ELSE external_activities.deleted_at END,
        synced_at = MAX(external_activities.synced_at + 1, excluded.synced_at)
      WHERE ${changed} OR (external_activities.deleted_at IS NOT NULL AND external_activities.duplicate_of IS NULL)`)
      .bind(
        `whoop:${userId}:${w.id}`, userId, connectionId, w.id, local.date, local.localMs, w.kind,
        sportLabel(w.sport) ?? 'Workout', seconds, w.distanceM, w.averageHr, w.maxHr, w.calories, w.elevationGainM,
        raw, now, w.startUtcMs, local.zone, w.sport, w.strain,
      );
  }

  function recoveryStatement(db: D1Database, userId: string, connectionId: string, d: RecoveryDay, now: number) {
    const cols = ['date', 'recovery_score', 'hrv_rmssd_ms', 'resting_hr', 'spo2_pct', 'skin_temp_c', 'calibrating',
      'sleep_start_utc_ms', 'sleep_end_utc_ms', 'sleep_ms', 'in_bed_ms', 'sleep_performance_pct',
      'sleep_efficiency_pct', 'respiratory_rate', 'day_strain', 'sleep_id'];
    return db.prepare(`INSERT INTO daily_recovery
        (id, user_id, source, external_id, ${cols.join(', ')}, synced_at)
      SELECT ?1, ?2, 'whoop', ?4, ${cols.map((_, i) => `?${i + 5}`).join(', ')}, ?${cols.length + 5}
       WHERE ${guard}
      ON CONFLICT (id) DO UPDATE SET ${cols.map(c => `${c} = excluded.${c}`).join(', ')}, synced_at = excluded.synced_at
      WHERE ${cols.map(c => `daily_recovery.${c} IS NOT excluded.${c}`).join(' OR ')}`)
      .bind(
        `whoop:${userId}:${d.cycleId}`, userId, connectionId, d.cycleId, d.date, d.recoveryScore, d.hrvRmssdMs,
        d.restingHr, d.spo2Pct, d.skinTempC, d.calibrating === null ? null : d.calibrating ? 1 : 0,
        d.sleepStartUtcMs, d.sleepEndUtcMs, d.sleepMs, d.inBedMs, d.sleepPerformancePct, d.sleepEfficiencyPct,
        d.respiratoryRate, d.dayStrain, d.sleepId, now,
      );
  }

  async function batched(db: D1Database, statements: D1PreparedStatement[]) {
    for (let i = 0; i < statements.length; i += 50) await db.batch(statements.slice(i, i + 50));
  }

  /**
   * Reconcile the member's WHOOP workouts and recovery days since `days`
   * ago (90 until one full sync succeeds, 14 after). A collection that fails
   * to load leaves its rows untouched; anything WHOOP no longer lists inside
   * a window that did load is removed (workouts are hidden, days deleted).
   *
   * Syncs of one connection never overlap: each claims a lease and a new
   * `sync_attempt`, and every write is fenced by connection and attempt, so
   * an older snapshot can never land after a newer one. A sync that finds
   * the lease held records the window it wanted (`sync_pending_days`) and
   * answers busy; the holder runs again with it before letting go. A window
   * the holder could not finish (a failed or partial load, or one still
   * queued after its last pass) goes back to `sync_pending_days`, so the
   * next sync, at the latest the hourly cron, reaches back that far. The
   * window in flight is kept in `sync_rerun_days` until it is reconciled, so
   * a Worker that dies mid-sync leaves it for whoever claims the expired
   * lease.
   */
  async function syncWhoop(
    db: D1Database, env: Env, userId: string,
    opts: { fetcher?: Fetcher; days?: number; now?: number } = {},
  ): Promise<WhoopSyncResult> {
    const now = opts.now ?? Date.now();
    const fetcher: Fetcher = opts.fetcher ?? ((i, init) => globalThis.fetch(i, init));
    const wanted = opts.days ?? WHOOP_SYNC_DAYS;
    const access = await whoopAccessToken(db, env, userId, fetcher, now);
    if (!access.ok) {
      // Another request holds the token refresh, or WHOOP failed to answer
      // it: keep the window this caller wanted for the next sync.
      if (access.reason === 'busy' || access.reason === 'transient') {
        await db.prepare(`UPDATE provider_connections
            SET sync_pending_days = MAX(COALESCE(sync_pending_days, 0), ?2)
          WHERE user_id = ?1 AND provider = 'whoop'`)
          .bind(userId, wanted).run();
      }
      const status = access.reason === 'transient' ? 'fetch_failed' : access.reason;
      return { status, workouts: 0, days: 0 };
    }
    const row = await readConnection(db, userId);
    if (!row || row.connection_id !== access.connectionId) return { status: 'not_connected', workouts: 0, days: 0 };
    const claim = await db.prepare(`UPDATE provider_connections
        SET sync_attempt = sync_attempt + 1, sync_lease_until = ?3,
            sync_rerun_days = MAX(COALESCE(sync_rerun_days, 0), COALESCE(sync_pending_days, 0), ?5),
            sync_pending_days = NULL
      WHERE user_id = ?1 AND provider = 'whoop' AND connection_id = ?2
        AND (sync_lease_until IS NULL OR sync_lease_until <= ?4)
      RETURNING sync_attempt, sync_rerun_days`)
      .bind(userId, row.connection_id, now + SYNC_LEASE_MS, now, wanted)
      .first<{ sync_attempt: number; sync_rerun_days: number }>();
    if (!claim) {
      await db.prepare(`UPDATE provider_connections
          SET sync_pending_days = MAX(COALESCE(sync_pending_days, 0), ?3)
        WHERE user_id = ?1 AND provider = 'whoop' AND connection_id = ?2`)
        .bind(userId, row.connection_id, wanted).run();
      return { status: 'busy', workouts: 0, days: 0 };
    }
    const fence = `${row.connection_id}:${claim.sync_attempt}`;
    let days = claim.sync_rerun_days;
    let result: WhoopSyncResult = { status: 'fetch_failed', workouts: 0, days: 0 };
    let released = false;
    // The window not yet reconciled in full; handed back on the way out.
    let unfinished: number | null = days;
    try {
      for (let run = 0; run < 3; run++) {
        const current = await readConnection(db, userId);
        if (!current || `${current.connection_id}:${current.sync_attempt}` !== fence) {
          return { status: 'not_connected', workouts: 0, days: 0 };
        }
        // Until one full sync has succeeded, every caller (Sync now, a
        // webhook, the cron) reaches back at least the first-sync window, so
        // a failed backfill is never replaced by a narrower one.
        const window = current.last_synced_at === null ? Math.max(days, WHOOP_FIRST_SYNC_DAYS) : days;
        result = await syncWindow(db, userId, fetcher, access.token, fence,
          { connectionId: current.connection_id, tokenVersion: current.token_version }, window, now);
        if (result.status !== 'ok') break;
        unfinished = null;
        // Let go, unless another sync asked for a window meanwhile: then run it.
        const next = await db.prepare(`UPDATE provider_connections
            SET sync_rerun_days = sync_pending_days, sync_pending_days = NULL,
                sync_lease_until = CASE WHEN sync_pending_days IS NULL THEN NULL ELSE ?3 END
          WHERE user_id = ?1 AND provider = 'whoop' AND connection_id || ':' || sync_attempt = ?2
          RETURNING sync_rerun_days`)
          .bind(userId, fence, now + SYNC_LEASE_MS).first<{ sync_rerun_days: number | null }>();
        if (!next || next.sync_rerun_days === null) { released = true; break; }
        days = next.sync_rerun_days;
        unfinished = days;
      }
      return result;
    } finally {
      if (!released) {
        await db.prepare(`UPDATE provider_connections
            SET sync_lease_until = NULL,
                sync_pending_days = CASE WHEN ?3 IS NULL THEN sync_pending_days
                  ELSE MAX(COALESCE(sync_pending_days, 0), ?3) END
            WHERE user_id = ?1 AND provider = 'whoop' AND connection_id || ':' || sync_attempt = ?2`)
          .bind(userId, fence, unfinished).run();
      }
    }
  }

  async function syncWindow(
    db: D1Database, userId: string, fetcher: Fetcher, token: string, fence: string,
    row: { connectionId: string; tokenVersion: number }, days: number, now: number,
  ): Promise<WhoopSyncResult> {
    const windowStart = now - days * DAY_MS;
    const startIso = new Date(windowStart).toISOString();
    const [workouts, recoveries, sleeps, cycles] = await Promise.all([
      fetchWhoopCollection(fetcher, token, 'activity/workout', startIso),
      fetchWhoopCollection(fetcher, token, 'recovery', startIso),
      fetchWhoopCollection(fetcher, token, 'activity/sleep', startIso),
      fetchWhoopCollection(fetcher, token, 'cycle', startIso),
    ]);
    const all: WhoopReadResult<unknown[]>[] = [workouts, recoveries, sleeps, cycles];
    if (all.some(r => !r.ok && r.reason === 'unauthorized')) {
      // A token WHOOP just accepted for refresh was refused: the member revoked access.
      await markReauth(db, userId, row.connectionId, row.tokenVersion, now);
      return { status: 'reauth', workouts: 0, days: 0 };
    }
    const tz = await deps.getUserTimezone(db, userId);
    let workoutCount = 0;
    let dayCount = 0;
    // Loads are refreshed from the earliest civil date the window touched.
    let fromDate = new Date(windowStart - DAY_MS).toISOString().slice(0, 10);
    if (workouts.ok) {
      const parsed = workouts.value.map(parseWhoopWorkout).filter((w): w is WhoopWorkout => w !== null);
      const statements: D1PreparedStatement[] = [];
      for (const w of parsed) {
        const local = deps.localTime(w.startUtcMs, w.offsetSec, tz);
        if (local.date < fromDate) fromDate = local.date;
        statements.push(workoutStatement(db, userId, fence, w, local, now));
      }
      statements.push(db.prepare(`UPDATE external_activities
          SET deleted_at = MAX(synced_at + 1, ?4), synced_at = MAX(synced_at + 1, ?4), canonical = 1, duplicate_of = NULL
        WHERE user_id = ?2 AND source = 'whoop' AND start_date_utc_ms >= ?5
          AND (deleted_at IS NULL OR duplicate_of IS NOT NULL)
          AND id NOT IN (SELECT value FROM json_each(?1))
          AND ${guard}`)
        .bind(JSON.stringify(parsed.map(w => `whoop:${userId}:${w.id}`)), userId, fence, now, windowStart));
      await batched(db, statements);
      workoutCount = parsed.length;
    }
    if (recoveries.ok && sleeps.ok && cycles.ok) {
      const daysBuilt = buildRecoveryDays(recoveries.value, sleeps.value, cycles.value);
      const statements = daysBuilt.map(d => recoveryStatement(db, userId, fence, d, now));
      // Days at the window's edge may have lost their cycle to the window, so
      // only days well inside it are removed when WHOOP stops listing them.
      const keepBefore = new Date(windowStart + 2 * DAY_MS).toISOString().slice(0, 10);
      statements.push(db.prepare(`DELETE FROM daily_recovery
        WHERE user_id = ?2 AND source = 'whoop' AND date >= ?4
          AND id NOT IN (SELECT value FROM json_each(?1)) AND ${guard}`)
        .bind(JSON.stringify(daysBuilt.map(d => `whoop:${userId}:${d.cycleId}`)), userId, fence, keepBefore));
      await batched(db, statements);
      dayCount = daysBuilt.length;
    }
    const complete = all.every(r => r.ok);
    if (complete) {
      await db.prepare(`UPDATE provider_connections SET last_synced_at = ?3
          WHERE user_id = ?1 AND provider = 'whoop' AND connection_id || ':' || sync_attempt = ?2`)
        .bind(userId, fence, now).run();
    }
    if (workouts.ok) {
      await deps.dedupe(db, userId);
      await deps.refreshActivityLoads(db, userId, { fromDate });
    }
    const anyOk = all.some(r => r.ok);
    return { status: complete ? 'ok' : anyOk ? 'partial' : 'fetch_failed', workouts: workoutCount, days: dayCount };
  }

  async function findWhoopMember(db: D1Database, providerUserId: string): Promise<string | null> {
    const row = await db.prepare(`SELECT user_id FROM provider_connections
        WHERE provider = 'whoop' AND provider_user_id = ?1`).bind(providerUserId).first<{ user_id: string }>();
    return row?.user_id ?? null;
  }

  /** Connected members not synced since `before`, oldest first. */
  async function listWhoopMembersDue(db: D1Database, before: number, limit = 50): Promise<string[]> {
    const rows = await db.prepare(`SELECT user_id FROM provider_connections
        WHERE provider = 'whoop' AND auth_error_at IS NULL AND (last_synced_at IS NULL OR last_synced_at < ?1)
        ORDER BY COALESCE(last_synced_at, 0), user_id LIMIT ?2`).bind(before, limit).all<{ user_id: string }>();
    return rows.results.map(r => r.user_id);
  }

  async function listRecoveryDays(db: D1Database, userId: string, from: string, to: string): Promise<RecoveryDayView[]> {
    const rows = await db.prepare(`SELECT date, recovery_score, hrv_rmssd_ms, resting_hr, spo2_pct, skin_temp_c,
          calibrating, sleep_start_utc_ms, sleep_end_utc_ms, sleep_ms, in_bed_ms, sleep_performance_pct,
          sleep_efficiency_pct, respiratory_rate, day_strain, source
        FROM daily_recovery WHERE user_id = ?1 AND date >= ?2 AND date <= ?3
        ORDER BY date, sleep_end_utc_ms, external_id`)
      .bind(userId, from, to)
      .all<Omit<RecoveryDayView, 'calibrating'> & { calibrating: number | null }>();
    return rows.results.map(r => ({ ...r, calibrating: r.calibrating === null ? null : r.calibrating === 1 }));
  }

  /**
   * A webhook names one record. Re-sync a window reaching back past it, so an
   * edit or deletion of an older workout or night is reconciled too, not only
   * the last 14 days. The record's start comes from the stored row, else from
   * WHOOP (a record Tres Fort does not hold yet); a deleted record not held
   * here needs nothing.
   */
  async function syncWhoopEvent(
    db: D1Database, env: Env, userId: string, event: { type: string; id: string | null },
    opts: { fetcher?: Fetcher; now?: number } = {},
  ): Promise<WhoopSyncResult> {
    const now = opts.now ?? Date.now();
    const fetcher: Fetcher = opts.fetcher ?? ((i, init) => globalThis.fetch(i, init));
    const kind = event.type.startsWith('workout.') ? 'workout' : 'sleep';
    const id = event.id?.toLowerCase() ?? null;
    let start: number | null = null;
    if (id) {
      const held = kind === 'workout'
        ? await db.prepare(`SELECT start_date_utc_ms AS start FROM external_activities
            WHERE user_id = ?1 AND source = 'whoop' AND external_id = ?2`).bind(userId, id).first<{ start: number | null }>()
        : await db.prepare(`SELECT MIN(sleep_start_utc_ms) AS start FROM daily_recovery
            WHERE user_id = ?1 AND source = 'whoop' AND sleep_id = ?2`).bind(userId, id).first<{ start: number | null }>();
      start = held?.start ?? null;
      if (start === null && !event.type.endsWith('.deleted')) {
        const access = await whoopAccessToken(db, env, userId, fetcher, now);
        if (access.ok) {
          const found = await fetchWhoopRecordStart(fetcher, access.token, kind, id);
          if (found.ok) start = found.value;
        }
      }
    }
    const back = start === null ? 0 : Math.ceil((now - start) / DAY_MS) + 3;
    const days = Math.min(WHOOP_EVENT_MAX_DAYS, Math.max(WHOOP_SYNC_DAYS, back));
    return syncWhoop(db, env, userId, { fetcher, days, now });
  }

  return {
    createWhoopOAuthState, consumeWhoopOAuthState, createWhoopOAuthCompletion, finishWhoopOAuth, getWhoopStatus,
    disconnectWhoop, whoopAccessToken, syncWhoop, syncWhoopEvent, findWhoopMember, listWhoopMembersDue,
    listRecoveryDays,
  };
}
