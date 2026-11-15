// Garmin connection and workout files (docs/plans/garmin P1 and P2). Internal
// service: public callers use the db.ts facade, which injects the shared
// helpers.
//
// - Connect mirrors WHOOP's flow (migration 0070) with Garmin's PKCE: the
//   verifier is sealed into the single-use connect state, then a completion
//   secret only the starting app session can redeem activates it.
// - Tokens are sealed. Garmin rotates the refresh token on every refresh, so a
//   refresh claims a short lease and swaps tokens with a compare-and-swap on
//   token_version, the same as WHOOP.
// - Garmin pushes each new workout as a one-time file link. The link is kept
//   (sealed) in garmin_activity_files before the push is answered, then the
//   file is downloaded and imported; the cron retries while the link lasts.
//   Every import is fenced by the connection it was announced to, so a
//   disconnect is never undone by an import already running.
// - Garmin data stays out of MCP and group views (Garmin's license; see the
//   plan). Those exclusions live with each query.
import { credentialDigest, openCredential, randomSecret, sealCredential } from '../credentials';
import type { Fetcher } from '../intervals';
import type { Env } from '../types';
import { diagnosticErrorType } from '../errors';
import { FitParseError, parseFit, type FitActivity } from '../fitFile';
import { encodeHeartRate, type EncodedHeartRate } from '../heartRateSeries';
import { fitPowerSeries, type EncodedPowerSeries } from '../powerSeries';
import { heartRateStreamSummary, powerStreamSummary } from '../trainingLoad';
import {
  deleteGarminRegistration, downloadGarminFile, fetchGarminPermissions, garminCodeVerifier, refreshGarminTokens,
  GARMIN_ACTIVITY_PERMISSION, type GarminActivityFile, type GarminFetcher, type GarminTokens,
} from '../garmin';

const STATE_TTL_MS = 10 * 60_000;
const LEASE_MS = 30_000;
/** Garmin recommends refreshing at least ten minutes before expiry. */
const EXPIRY_MARGIN_MS = 15 * 60_000;
/** A download link lasts 24 hours; stop trying a little before that. */
export const GARMIN_FILE_TTL_MS = 23 * 60 * 60_000;
const FILE_LEASE_MS = 2 * 60_000;
const MAX_FILE_ATTEMPTS = 8;
/** Garmin allows 50 file downloads a minute per app on Starter. */
export const GARMIN_FILES_PER_RUN = 25;
export const GARMIN_MAX_FILE_BYTES = 10 * 1024 * 1024;

/** What a Garmin workout announcement records about it. */
export interface GarminFileMeta {
  activityName: string | null;
  activityType: string | null;
  deviceName: string | null;
  manual: boolean;
}

/**
 * What Tres Fort keeps from one Garmin workout file: the summary fields an
 * imported .fit activity stores and its heart-rate series. Staged with the
 * queued file before the import, so a failed import is retried without the
 * one-time download.
 */
export interface GarminWorkout {
  v: 1;
  start_utc_ms: number;
  local_offset_sec: number | null;
  kind: FitActivity['kind'];
  sport: FitActivity['sport'];
  moving_sec: number | null;
  elapsed_sec: number | null;
  distance_m: number | null;
  avg_power: number | null;
  normalized_power: number | null;
  avg_hr: number | null;
  max_hr: number | null;
  calories: number | null;
  ascent_m: number | null;
  stream_np_w: number | null;
  stream_hr_rms: number | null;
  stream_hr_sec: number | null;
  heart_rate: EncodedHeartRate | null;
  /** A ride's power and cadence (run-detail-charts P7); absent from a file
   * queued before it. */
  power_series?: EncodedPowerSeries | null;
}

export function garminWorkoutFromFit(fit: FitActivity): GarminWorkout {
  const moving = fit.timer_sec === null ? null : Math.round(fit.timer_sec);
  const hr = fit.hr.length > 0 ? heartRateStreamSummary(fit.hr, moving) : null;
  const round = (v: number | null) => (v === null ? null : Math.round(v));
  return {
    v: 1,
    start_utc_ms: fit.start_utc_ms,
    local_offset_sec: fit.local_offset_sec,
    kind: fit.kind,
    sport: fit.sport,
    moving_sec: moving,
    elapsed_sec: round(fit.elapsed_sec),
    distance_m: fit.distance_m,
    avg_power: fit.avg_power,
    normalized_power: fit.normalized_power,
    avg_hr: fit.avg_hr,
    max_hr: round(fit.max_hr),
    calories: round(fit.calories),
    ascent_m: fit.ascent_m,
    stream_np_w: fit.power.length > 0 ? powerStreamSummary(fit.power, moving) : null,
    stream_hr_rms: hr?.rms_bpm ?? null,
    stream_hr_sec: hr ? Math.round(hr.seconds) : null,
    heart_rate: encodeHeartRate(fit.hr, fit.start_utc_ms),
    power_series: fitPowerSeries(fit),
  };
}

export interface GarminDeps {
  /** Cross-source dedup (db.ts dedupeHealthKitAgainstIntervals). */
  dedupe: (db: D1Database, userId: string) => Promise<number>;
  /** db.ts importGarminActivity: store one workout, fenced by the connection and its activity permission. */
  importActivity: (
    db: D1Database, userId: string, connectionId: string, activityId: string, workout: GarminWorkout, meta: GarminFileMeta,
  ) => Promise<'imported' | 'existing' | 'disconnected'>;
}

export interface PendingGarminCredential extends GarminTokens {
  providerUserId: string;
  permissions: string[];
}

interface ConnectionRow {
  connection_id: string;
  provider_user_id: string;
  access_token: string;
  refresh_token: string | null;
  expires_at: number | null;
  scopes: string | null;
  token_version: number;
  auth_error_at: number | null;
  last_synced_at: number | null;
  connected_at: number;
}

export interface GarminStatus {
  configured: boolean;
  connected: boolean;
  /** The member turned off workout sharing on Garmin's side. */
  activity_permission: boolean;
  needs_reauth: boolean;
  connected_at: number | null;
  last_synced_at: number | null;
}

export type GarminTokenAccess =
  | { ok: true; token: string; connectionId: string }
  | { ok: false; reason: 'disabled' | 'not_connected' | 'reauth' | 'busy' | 'transient' };

/** A queued file one run has claimed, and the lease it claimed it with. */
interface FileClaim {
  user_id: string;
  activity_id: string;
  lease: number;
}

export interface GarminFileRun {
  imported: number;
  failed: number;
  pending: number;
}

function configured(env: Env): env is Env & { GARMIN_CLIENT_ID: string; GARMIN_CLIENT_SECRET: string } {
  return Boolean(env.GARMIN_CLIENT_ID && env.GARMIN_CLIENT_SECRET);
}

const purpose = {
  access: 'garmin-access-token',
  refresh: 'garmin-refresh-token',
  verifier: (digest: string) => `garmin-pkce:${digest}`,
  completion: (digest: string) => `garmin-completion:${digest}`,
  file: (activityId: string) => `garmin-file:${activityId}`,
};

/** SQL twin of hasActivityPermission over provider_connections.scopes. */
export const ACTIVITY_PERMISSION_SQL =
  `(' ' || COALESCE(scopes, '') || ' ') LIKE '% ${GARMIN_ACTIVITY_PERMISSION} %'`;

function hasActivityPermission(scopes: string | null): boolean {
  return (scopes ?? '').split(' ').includes(GARMIN_ACTIVITY_PERMISSION);
}

export function createGarminService(deps: GarminDeps) {
  async function readConnection(db: D1Database, userId: string): Promise<ConnectionRow | null> {
    return db.prepare(
      `SELECT connection_id, provider_user_id, access_token, refresh_token, expires_at, scopes, token_version,
              auth_error_at, last_synced_at, connected_at
         FROM provider_connections WHERE user_id = ?1 AND provider = 'garmin'`,
    ).bind(userId).first<ConnectionRow>();
  }

  /** A single-use state and the PKCE verifier it keeps for the callback. */
  async function createGarminOAuthState(
    db: D1Database, env: Env, userId: string, appSessionId: string, now = Date.now(),
  ): Promise<{ state: string; verifier: string }> {
    const state = randomSecret();
    const digest = await credentialDigest(state);
    const verifier = garminCodeVerifier();
    const sealed = await sealCredential(verifier, env.CREDENTIAL_ENCRYPTION_KEY, userId, purpose.verifier(digest));
    await db.batch([
      db.prepare('DELETE FROM provider_oauth_states WHERE expires_at <= ?1').bind(now),
      db.prepare(`INSERT INTO provider_oauth_states (state_sha256, user_id, provider, app_session_id, expires_at, code_verifier)
        VALUES (?1, ?2, 'garmin', ?3, ?4, ?5)`).bind(digest, userId, appSessionId, now + STATE_TTL_MS, sealed),
    ]);
    return { state, verifier };
  }

  /** Single use: the row is deleted whether or not it is still valid. */
  async function consumeGarminOAuthState(db: D1Database, env: Env, state: string, now = Date.now()) {
    if (!/^[A-Za-z0-9_-]{43}$/.test(state)) return null;
    const digest = await credentialDigest(state);
    const row = await db.prepare(`DELETE FROM provider_oauth_states WHERE state_sha256 = ?1 AND provider = 'garmin'
      RETURNING user_id, app_session_id, expires_at, code_verifier`).bind(digest)
      .first<{ user_id: string; app_session_id: string; expires_at: number; code_verifier: string | null }>();
    if (!row || row.expires_at <= now || !row.code_verifier) return null;
    const verifier = await openCredential(row.code_verifier, env.CREDENTIAL_ENCRYPTION_KEY, row.user_id, purpose.verifier(digest));
    if (!verifier) return null;
    return { user_id: row.user_id, app_session_id: row.app_session_id, code_verifier: verifier };
  }

  async function createGarminOAuthCompletion(
    db: D1Database, userId: string, appSessionId: string, credential: PendingGarminCredential,
    encryptionKey: string | undefined, now = Date.now(),
  ): Promise<string> {
    const completion = randomSecret();
    const digest = await credentialDigest(completion);
    const ciphertext = await sealCredential(JSON.stringify(credential), encryptionKey, userId, purpose.completion(digest));
    await db.batch([
      db.prepare('DELETE FROM provider_oauth_completions WHERE expires_at <= ?1').bind(now),
      db.prepare(`INSERT INTO provider_oauth_completions
          (completion_sha256, user_id, provider, app_session_id, credential_ciphertext, expires_at)
        VALUES (?1, ?2, 'garmin', ?3, ?4, ?5)`).bind(digest, userId, appSessionId, ciphertext, now + STATE_TTL_MS),
    ]);
    return completion;
  }

  /** Hide the member's Garmin workouts (copies they had hidden come back once
   * dedup runs) and drop their kept heart rate, power and queued files. */
  function forgetGarminData(db: D1Database, userId: string, now: number): D1PreparedStatement[] {
    return [
      db.prepare(`DELETE FROM activity_heart_rates WHERE user_id = ?1 AND activity_id IN
          (SELECT id FROM external_activities WHERE user_id = ?1 AND source = 'garmin')`).bind(userId),
      db.prepare(`DELETE FROM activity_power_series WHERE user_id = ?1 AND activity_id IN
          (SELECT id FROM external_activities WHERE user_id = ?1 AND source = 'garmin')`).bind(userId),
      db.prepare(`UPDATE external_activities
          SET deleted_at = MAX(synced_at + 1, ?2), synced_at = MAX(synced_at + 1, ?2), canonical = 1, duplicate_of = NULL
        WHERE user_id = ?1 AND source = 'garmin' AND (deleted_at IS NULL OR duplicate_of IS NOT NULL)`).bind(userId, now),
      db.prepare(`DELETE FROM garmin_activity_files WHERE user_id = ?1`).bind(userId),
    ];
  }

  /** Activate a connection from the original app session's completion secret.
   * A new connection_id fences off anything a previous connection started. */
  async function finishGarminOAuth(
    db: D1Database, env: Env, userId: string, appSessionId: string, completion: string, now = Date.now(),
  ): Promise<{ connected: true; connection_id: string; activity_permission: boolean }
    | { error: 'invalid_completion' | 'account_in_use' }> {
    if (!/^[A-Za-z0-9_-]{43}$/.test(completion)) return { error: 'invalid_completion' };
    const digest = await credentialDigest(completion);
    const pending = await db.prepare(`DELETE FROM provider_oauth_completions
        WHERE completion_sha256 = ?1 AND user_id = ?2 AND app_session_id = ?3 AND provider = 'garmin'
        RETURNING credential_ciphertext, expires_at`).bind(digest, userId, appSessionId)
      .first<{ credential_ciphertext: string; expires_at: number }>();
    if (!pending || pending.expires_at <= now) return { error: 'invalid_completion' };
    const credential = JSON.parse((await openCredential(
      pending.credential_ciphertext, env.CREDENTIAL_ENCRYPTION_KEY, userId, purpose.completion(digest),
    ))!) as PendingGarminCredential;
    const other = await db.prepare(`SELECT user_id FROM provider_connections
        WHERE provider = 'garmin' AND provider_user_id = ?1 AND user_id <> ?2`)
      .bind(credential.providerUserId, userId).first<{ user_id: string }>();
    if (other) return { error: 'account_in_use' };
    const previous = await readConnection(db, userId);
    const connectionId = crypto.randomUUID();
    const access = await sealCredential(credential.accessToken, env.CREDENTIAL_ENCRYPTION_KEY, userId, purpose.access);
    const refresh = await sealCredential(credential.refreshToken, env.CREDENTIAL_ENCRYPTION_KEY, userId, purpose.refresh);
    const scopes = credential.permissions.join(' ');
    const statements = [
      db.prepare(`INSERT INTO provider_connections
          (user_id, provider, connection_id, provider_user_id, access_token, refresh_token, expires_at, scopes,
           token_version, refresh_lease_until, auth_error_at, last_synced_at, connected_at, updated_at)
        VALUES (?1, 'garmin', ?2, ?3, ?4, ?5, ?6, ?7, 1, NULL, NULL, NULL, ?8, ?8)
        ON CONFLICT (user_id, provider) DO UPDATE SET
          connection_id = excluded.connection_id, provider_user_id = excluded.provider_user_id,
          access_token = excluded.access_token, refresh_token = excluded.refresh_token,
          expires_at = excluded.expires_at, scopes = excluded.scopes,
          token_version = provider_connections.token_version + 1, refresh_lease_until = NULL,
          auth_error_at = NULL, last_synced_at = NULL, connected_at = excluded.connected_at,
          updated_at = excluded.updated_at`)
        .bind(userId, connectionId, credential.providerUserId, access, refresh, credential.expiresAt, scopes, now),
      // Files announced to an earlier connection are not this one's.
      db.prepare(`DELETE FROM garmin_activity_files WHERE user_id = ?1`).bind(userId),
    ];
    // Reconnecting a different Garmin account starts clean.
    if (previous && previous.provider_user_id !== credential.providerUserId) {
      statements.push(...forgetGarminData(db, userId, now));
    }
    try {
      await db.batch(statements);
    } catch (error) {
      if (error instanceof Error && /UNIQUE/i.test(error.message)) return { error: 'account_in_use' };
      throw error;
    }
    if (previous && previous.provider_user_id !== credential.providerUserId) await deps.dedupe(db, userId);
    return { connected: true, connection_id: connectionId, activity_permission: hasActivityPermission(scopes) };
  }

  async function getGarminStatus(db: D1Database, env: Env, userId: string): Promise<GarminStatus> {
    const row = await readConnection(db, userId);
    return {
      configured: configured(env),
      connected: row !== null,
      activity_permission: row !== null && hasActivityPermission(row.scopes),
      needs_reauth: row?.auth_error_at != null,
      connected_at: row?.connected_at ?? null,
      last_synced_at: row?.last_synced_at ?? null,
    };
  }

  /** Remove the connection and everything it brought in. Idempotent. */
  async function removeConnection(db: D1Database, userId: string, now: number): Promise<void> {
    await db.batch([
      db.prepare(`DELETE FROM provider_connections WHERE user_id = ?1 AND provider = 'garmin'`).bind(userId),
      db.prepare(`DELETE FROM provider_oauth_completions WHERE user_id = ?1 AND provider = 'garmin'`).bind(userId),
      db.prepare(`DELETE FROM provider_oauth_states WHERE user_id = ?1 AND provider = 'garmin'`).bind(userId),
      ...forgetGarminData(db, userId, now),
    ]);
    await deps.dedupe(db, userId);
  }

  /**
   * Disconnect from the app. Garmin's license requires telling Garmin, so the
   * registration is deleted first with a usable token (refreshed if needed);
   * the local connection and Garmin's workouts go either way.
   */
  async function disconnectGarmin(
    db: D1Database, env: Env, userId: string, fetcher: Fetcher = (i, init) => globalThis.fetch(i, init), now = Date.now(),
  ): Promise<{ disconnected: boolean; garmin_notified: boolean }> {
    const row = await readConnection(db, userId);
    let notified = false;
    if (row) {
      const access = await garminAccessToken(db, env, userId, fetcher, now).catch(() => null);
      if (access?.ok) notified = await deleteGarminRegistration(fetcher, access.token);
    }
    await removeConnection(db, userId, now);
    return { disconnected: row !== null, garmin_notified: notified };
  }

  /** A usable access token, refreshing it (once, across concurrent requests) when it is about to expire. */
  async function garminAccessToken(
    db: D1Database, env: Env, userId: string, fetcher: Fetcher, now = Date.now(),
  ): Promise<GarminTokenAccess> {
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
      const claimed = await db.prepare(`UPDATE provider_connections SET refresh_lease_until = ?3
          WHERE user_id = ?1 AND provider = 'garmin' AND token_version = ?2
            AND (refresh_lease_until IS NULL OR refresh_lease_until <= ?4) AND connection_id = ?5`)
        .bind(userId, row.token_version, now + LEASE_MS, now, row.connection_id).run();
      if ((claimed.meta.changes ?? 0) !== 1) {
        if (attempt === 0) continue;
        return { ok: false, reason: 'busy' };
      }
      const refreshed = await refreshGarminTokens(fetcher, {
        clientId: env.GARMIN_CLIENT_ID, clientSecret: env.GARMIN_CLIENT_SECRET, refreshToken,
      });
      if (!refreshed.ok) {
        if (refreshed.reason === 'invalid') {
          await markReauth(db, userId, row.connection_id, row.token_version, now);
          return { ok: false, reason: 'reauth' };
        }
        await db.prepare(`UPDATE provider_connections SET refresh_lease_until = NULL
            WHERE user_id = ?1 AND provider = 'garmin' AND token_version = ?2 AND connection_id = ?3`)
          .bind(userId, row.token_version, row.connection_id).run();
        return { ok: false, reason: 'transient' };
      }
      const t = refreshed.tokens;
      const access = await sealCredential(t.accessToken, key, userId, purpose.access);
      const nextRefresh = t.refreshToken === null ? row.refresh_token
        : await sealCredential(t.refreshToken, key, userId, purpose.refresh);
      const swapped = await db.prepare(`UPDATE provider_connections
          SET access_token = ?3, refresh_token = ?4, expires_at = ?5,
              token_version = token_version + 1, refresh_lease_until = NULL, updated_at = ?6
        WHERE user_id = ?1 AND provider = 'garmin' AND token_version = ?2 AND connection_id = ?7`)
        .bind(userId, row.token_version, access, nextRefresh, t.expiresAt, now, row.connection_id).run();
      if ((swapped.meta.changes ?? 0) !== 1) return { ok: false, reason: 'not_connected' };
      return { ok: true, token: t.accessToken, connectionId: row.connection_id };
    }
    return { ok: false, reason: 'busy' };
  }

  async function markReauth(db: D1Database, userId: string, connectionId: string, tokenVersion: number, now: number) {
    await db.prepare(`UPDATE provider_connections SET auth_error_at = ?3, refresh_lease_until = NULL, updated_at = ?3
        WHERE user_id = ?1 AND provider = 'garmin' AND token_version = ?2 AND connection_id = ?4`)
      .bind(userId, tokenVersion, now, connectionId).run();
  }

  async function findGarminMember(db: D1Database, garminUserId: string) {
    return db.prepare(`SELECT user_id, connection_id, scopes FROM provider_connections
        WHERE provider = 'garmin' AND provider_user_id = ?1`)
      .bind(garminUserId).first<{ user_id: string; connection_id: string; scopes: string | null }>();
  }

  /**
   * Keep each announced file of a connected member who shares workouts, so
   * the push can be answered at once. Returns the members with new files.
   * A repeated announcement leaves a file still in progress alone (its claim
   * and any staged workout); it only revives one that finished without
   * being imported.
   */
  async function queueGarminActivityFiles(
    db: D1Database, env: Env, files: GarminActivityFile[], now = Date.now(),
  ): Promise<string[]> {
    const members = new Set<string>();
    const statements: D1PreparedStatement[] = [];
    for (const file of files) {
      const member = await findGarminMember(db, file.userId);
      if (!member || !hasActivityPermission(member.scopes)) continue;
      const sealed = await sealCredential(file.callbackUrl, env.CREDENTIAL_ENCRYPTION_KEY, member.user_id,
        purpose.file(file.activityId));
      const meta: GarminFileMeta = {
        activityName: file.activityName, activityType: file.activityType, deviceName: file.deviceName, manual: file.manual,
      };
      statements.push(db.prepare(`INSERT INTO garmin_activity_files
          (user_id, activity_id, connection_id, callback_url, file_type, meta, received_at)
        SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7
         WHERE EXISTS (SELECT 1 FROM provider_connections
                        WHERE user_id = ?1 AND provider = 'garmin' AND connection_id = ?3
                          AND ${ACTIVITY_PERMISSION_SQL})
        ON CONFLICT (user_id, activity_id) DO UPDATE SET
          connection_id = excluded.connection_id, callback_url = excluded.callback_url,
          file_type = excluded.file_type, meta = excluded.meta, received_at = excluded.received_at,
          attempts = 0, lease_until = NULL, outcome = NULL, finished_at = NULL, workout = NULL
        WHERE garmin_activity_files.finished_at IS NOT NULL
          AND garmin_activity_files.outcome IS NOT 'imported'`)
        .bind(member.user_id, file.activityId, member.connection_id, sealed, file.fileType, JSON.stringify(meta), now));
      members.add(member.user_id);
    }
    for (let i = 0; i < statements.length; i += 50) await db.batch(statements.slice(i, i + 50));
    return [...members];
  }

  /** Garmin says these members disconnected Tres Fort on its side. */
  async function handleGarminDeregistrations(db: D1Database, garminUserIds: string[], now = Date.now()): Promise<number> {
    let removed = 0;
    for (const garminUserId of garminUserIds) {
      const member = await findGarminMember(db, garminUserId);
      if (!member) continue;
      await removeConnection(db, member.user_id, now);
      removed++;
    }
    return removed;
  }

  /** The member changed what they share on Garmin's side. */
  async function handleGarminPermissionChanges(
    db: D1Database, changes: Array<{ userId: string; permissions: string[] }>, now = Date.now(),
  ): Promise<number> {
    let updated = 0;
    for (const change of changes) {
      const member = await findGarminMember(db, change.userId);
      if (!member) continue;
      const scopes = change.permissions.join(' ');
      const statements = [
        db.prepare(`UPDATE provider_connections SET scopes = ?3, updated_at = ?4
            WHERE user_id = ?1 AND provider = 'garmin' AND connection_id = ?2`)
          .bind(member.user_id, member.connection_id, scopes, now),
      ];
      // Files not yet fetched are no longer shared with Tres Fort.
      if (!hasActivityPermission(scopes)) {
        statements.push(db.prepare(`DELETE FROM garmin_activity_files WHERE user_id = ?1 AND finished_at IS NULL`)
          .bind(member.user_id));
      }
      await db.batch(statements);
      updated++;
    }
    return updated;
  }

  /** Re-read the member's permissions from Garmin (after connecting). */
  async function refreshGarminPermissions(
    db: D1Database, env: Env, userId: string, fetcher: Fetcher, now = Date.now(),
  ): Promise<boolean> {
    const access = await garminAccessToken(db, env, userId, fetcher, now);
    if (!access.ok) return false;
    const permissions = await fetchGarminPermissions(fetcher, access.token);
    if (!permissions.ok) return false;
    await db.prepare(`UPDATE provider_connections SET scopes = ?3, updated_at = ?4
        WHERE user_id = ?1 AND provider = 'garmin' AND connection_id = ?2`)
      .bind(userId, access.connectionId, permissions.value.join(' '), now).run();
    return true;
  }

  /** Record a file's outcome and drop what it no longer needs (its link and staged workout). */
  // Each write below acts only while this run still holds the claim it made
  // (`lease`), so a run whose lease lapsed can never finish, release or
  // overwrite a file another run has since claimed.
  async function finishFile(db: D1Database, c: FileClaim, outcome: string, now: number) {
    await db.prepare(`UPDATE garmin_activity_files
        SET outcome = ?3, finished_at = ?4, lease_until = NULL, workout = NULL
        WHERE user_id = ?1 AND activity_id = ?2 AND lease_until = ?5`)
      .bind(c.user_id, c.activity_id, outcome, now, c.lease).run();
  }

  async function releaseFile(db: D1Database, c: FileClaim) {
    await db.prepare(`UPDATE garmin_activity_files SET lease_until = NULL
        WHERE user_id = ?1 AND activity_id = ?2 AND lease_until = ?3`)
      .bind(c.user_id, c.activity_id, c.lease).run();
  }

  /**
   * Download and import queued files: one member's (after a push), or the
   * oldest due across members (the cron). A file is claimed with a lease so
   * two runs never download the same link (Garmin serves it only once). The
   * downloaded workout is staged on the queue row before it is imported, so
   * a failed import is retried from the staged copy, never by downloading
   * again.
   */
  async function processGarminFiles(
    db: D1Database, env: Env,
    opts: { userId?: string; fetcher?: GarminFetcher; now?: number; limit?: number } = {},
  ): Promise<GarminFileRun> {
    // A run can take minutes, so each claim reads the clock again.
    const clock = () => opts.now ?? Date.now();
    const now = clock();
    const fetcher: GarminFetcher = opts.fetcher ?? ((i, init) => globalThis.fetch(i, init));
    const limit = Math.max(1, Math.min(GARMIN_FILES_PER_RUN, opts.limit ?? GARMIN_FILES_PER_RUN));
    // Links past their lifetime can never be fetched; a staged workout no longer needs its link.
    await db.prepare(`UPDATE garmin_activity_files SET outcome = 'gone', finished_at = ?1, lease_until = NULL
        WHERE finished_at IS NULL AND workout IS NULL AND received_at <= ?2
          AND (lease_until IS NULL OR lease_until <= ?1)`).bind(now, now - GARMIN_FILE_TTL_MS).run();
    const due = await db.prepare(`SELECT user_id, activity_id, connection_id, callback_url, file_type, meta, attempts,
             workout IS NOT NULL AS staged
        FROM garmin_activity_files
       WHERE finished_at IS NULL AND (lease_until IS NULL OR lease_until <= ?1) AND (?2 IS NULL OR user_id = ?2)
       ORDER BY received_at LIMIT ?3`).bind(now, opts.userId ?? null, limit)
      .all<{ user_id: string; activity_id: string; connection_id: string; callback_url: string; file_type: string;
        meta: string; attempts: number; staged: number }>();
    const run: GarminFileRun = { imported: 0, failed: 0, pending: 0 };
    for (const row of due.results) {
      const claimedAt = clock();
      const file = { ...row, lease: claimedAt + FILE_LEASE_MS };
      const claimed = await db.prepare(`UPDATE garmin_activity_files SET lease_until = ?3, attempts = attempts + 1
          WHERE user_id = ?1 AND activity_id = ?2 AND finished_at IS NULL AND (lease_until IS NULL OR lease_until <= ?4)
            AND attempts = ?5`)
        .bind(file.user_id, file.activity_id, file.lease, claimedAt, file.attempts).run();
      if ((claimed.meta.changes ?? 0) !== 1) continue;
      const lastAttempt = file.attempts + 1 >= MAX_FILE_ATTEMPTS;
      let workout: GarminWorkout | null = null;
      if (file.staged) {
        const row = await db.prepare(`SELECT workout FROM garmin_activity_files WHERE user_id = ?1 AND activity_id = ?2`)
          .bind(file.user_id, file.activity_id).first<{ workout: string | null }>();
        workout = row?.workout ? JSON.parse(row.workout) as GarminWorkout : null;
      }
      if (!workout) {
        const fetched = await fetchWorkout(db, env, file, fetcher, now, lastAttempt);
        if (fetched.outcome !== 'staged') {
          run[fetched.outcome]++;
          continue;
        }
        workout = fetched.workout;
      }
      const meta = JSON.parse(file.meta) as GarminFileMeta;
      let outcome: Awaited<ReturnType<GarminDeps['importActivity']>>;
      try {
        outcome = await deps.importActivity(db, file.user_id, file.connection_id, file.activity_id, workout, meta);
      } catch (error) {
        // The workout stays staged: the next run imports it without a download.
        if (lastAttempt) {
          await finishFile(db, file, 'failed', now);
          run.failed++;
        } else {
          await releaseFile(db, file);
          run.pending++;
        }
        console.error({ event: 'garmin_file_import_failed', error_type: diagnosticErrorType(error) });
        continue;
      }
      await finishFile(db, file, outcome === 'disconnected' ? 'disconnected' : 'imported', now);
      if (outcome !== 'disconnected') {
        run.imported++;
        await db.prepare(`UPDATE provider_connections SET last_synced_at = ?3
            WHERE user_id = ?1 AND provider = 'garmin' AND connection_id = ?2`)
          .bind(file.user_id, file.connection_id, now).run();
      }
    }
    return run;
  }

  /** Download, parse and stage one claimed file, or record why it can't be. */
  async function fetchWorkout(
    db: D1Database, env: Env,
    file: FileClaim & { connection_id: string; callback_url: string; file_type: string },
    fetcher: GarminFetcher, now: number, lastAttempt: boolean,
  ): Promise<{ outcome: 'staged'; workout: GarminWorkout } | { outcome: 'failed' | 'pending' }> {
    if (file.file_type !== 'FIT') {
      await finishFile(db, file, 'unsupported', now);
      return { outcome: 'failed' };
    }
    const access = await garminAccessToken(db, env, file.user_id, fetcher, now);
    if ((!access.ok && (access.reason === 'not_connected' || access.reason === 'disabled'))
        || (access.ok && access.connectionId !== file.connection_id)) {
      await finishFile(db, file, 'disconnected', now);
      return { outcome: 'failed' };
    }
    const url = await openCredential(file.callback_url, env.CREDENTIAL_ENCRYPTION_KEY, file.user_id,
      purpose.file(file.activity_id));
    if (!url) {
      await finishFile(db, file, 'invalid', now);
      return { outcome: 'failed' };
    }
    const download = await downloadGarminFile(fetcher, url, access.ok ? access.token : null, GARMIN_MAX_FILE_BYTES);
    if (!download.ok) {
      if (download.reason === 'gone' || download.reason === 'too_large' || lastAttempt) {
        await finishFile(db, file, download.reason === 'too_large' ? 'invalid' : 'gone', now);
        return { outcome: 'failed' };
      }
      await releaseFile(db, file);
      return { outcome: 'pending' };
    }
    let workout: GarminWorkout;
    try {
      workout = garminWorkoutFromFit(parseFit(download.bytes));
    } catch (e) {
      if (e instanceof FitParseError || e instanceof RangeError) {
        await finishFile(db, file, 'invalid', now);
        return { outcome: 'failed' };
      }
      throw e;
    }
    // The link is spent: keep the workout instead, under the lease this run holds.
    await db.prepare(`UPDATE garmin_activity_files SET workout = ?3
        WHERE user_id = ?1 AND activity_id = ?2 AND lease_until = ?4`)
      .bind(file.user_id, file.activity_id, JSON.stringify(workout), file.lease).run();
    return { outcome: 'staged', workout };
  }

  /** Members with files still to fetch (the cron's work list). */
  async function hasGarminFilesDue(db: D1Database, now = Date.now()): Promise<boolean> {
    const row = await db.prepare(`SELECT 1 AS due FROM garmin_activity_files
        WHERE finished_at IS NULL AND (received_at > ?1 OR workout IS NOT NULL)
          AND (lease_until IS NULL OR lease_until <= ?2) LIMIT 1`)
      .bind(now - GARMIN_FILE_TTL_MS, now).first<{ due: number }>();
    return row !== null;
  }

  return {
    createGarminOAuthState, consumeGarminOAuthState, createGarminOAuthCompletion, finishGarminOAuth,
    getGarminStatus, disconnectGarmin, garminAccessToken, queueGarminActivityFiles, handleGarminDeregistrations,
    handleGarminPermissionChanges, refreshGarminPermissions, processGarminFiles, hasGarminFilesDue,
  };
}
