-- Migration 0070: a direct WHOOP connection (docs/plans/whoop P2 and P3).
--
-- provider_connections holds one member's connection to an outside service
-- the Worker pulls from with OAuth. WHOOP is the first; Garmin's Activity API
-- (endurance-training-load P5) can join it. intervals.icu keeps its existing
-- users columns. Tokens are always sealed (src/credentials.ts), so the CHECKs
-- reject plaintext from the first row. WHOOP rotates its refresh token on
-- every refresh: token_version is the compare-and-swap fence and
-- refresh_lease_until stops two requests refreshing at once, which would
-- leave the loser holding a dead refresh token. connection_id changes on
-- every connect, so a sync still running after a disconnect writes nothing.
CREATE TABLE IF NOT EXISTS provider_connections (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('whoop')),
  connection_id TEXT NOT NULL,
  provider_user_id TEXT NOT NULL,
  access_token TEXT NOT NULL CHECK (access_token LIKE 'sealed:v1:%'),
  refresh_token TEXT CHECK (refresh_token IS NULL OR refresh_token LIKE 'sealed:v1:%'),
  expires_at INTEGER,
  scopes TEXT,
  token_version INTEGER NOT NULL DEFAULT 1,
  refresh_lease_until INTEGER,
  auth_error_at INTEGER,
  last_synced_at INTEGER,
  -- Syncs never overlap: each claims sync_lease_until and a new sync_attempt,
  -- and every sync write is fenced by connection_id and sync_attempt. A sync
  -- that finds the lease held leaves the window it wanted in
  -- sync_pending_days for the holder to run before letting go.
  sync_attempt INTEGER NOT NULL DEFAULT 0,
  sync_lease_until INTEGER,
  sync_pending_days INTEGER,
  sync_rerun_days INTEGER,
  connected_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, provider)
);
-- A WHOOP account links to one Tres Fort member; webhooks name the WHOOP user.
CREATE UNIQUE INDEX IF NOT EXISTS ux_provider_connections_account
  ON provider_connections (provider, provider_user_id);

-- The connect round trip, as for intervals.icu (migration 0065): a
-- single-use state bound to the app session that started it, then a
-- completion secret only that session can redeem.
CREATE TABLE IF NOT EXISTS provider_oauth_states (
  state_sha256 TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('whoop')),
  app_session_id TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_provider_oauth_states_expiry ON provider_oauth_states (expires_at);

CREATE TABLE IF NOT EXISTS provider_oauth_completions (
  completion_sha256 TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('whoop')),
  app_session_id TEXT NOT NULL,
  credential_ciphertext TEXT NOT NULL CHECK (credential_ciphertext LIKE 'sealed:v1:%'),
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_provider_oauth_completions_expiry ON provider_oauth_completions (expires_at);

-- WHOOP's Strain for a workout (0 to 21), kept as WHOOP's own figure. It is
-- not a training load and never feeds effective_load.
ALTER TABLE external_activities ADD COLUMN strain REAL;

-- One row per WHOOP physiological cycle: the morning's recovery, the night's
-- sleep and the day's strain. Private to the member: only
-- GET /api/me/recovery reads it; group views and the coach never do. `date`
-- is the civil date the member woke up. Missing values stay NULL.
CREATE TABLE IF NOT EXISTS daily_recovery (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source TEXT NOT NULL CHECK (source IN ('whoop')),
  external_id TEXT NOT NULL,
  date TEXT NOT NULL,
  recovery_score REAL,
  hrv_rmssd_ms REAL,
  resting_hr REAL,
  spo2_pct REAL,
  skin_temp_c REAL,
  calibrating INTEGER,
  sleep_start_utc_ms INTEGER,
  sleep_end_utc_ms INTEGER,
  sleep_ms INTEGER,
  in_bed_ms INTEGER,
  sleep_performance_pct REAL,
  sleep_efficiency_pct REAL,
  respiratory_rate REAL,
  day_strain REAL,
  -- The night's WHOOP sleep id: sleep and recovery webhooks name it.
  sleep_id TEXT,
  synced_at INTEGER NOT NULL,
  UNIQUE (user_id, source, external_id)
);
CREATE INDEX IF NOT EXISTS ix_daily_recovery_user_date ON daily_recovery (user_id, date);
CREATE INDEX IF NOT EXISTS ix_daily_recovery_user_sleep ON daily_recovery (user_id, sleep_id);
