-- Migration 0071: a direct Garmin connection (docs/plans/garmin P1 and P2).
--
-- The provider tables from migration 0070 accept only 'whoop' in their
-- CHECKs, and SQLite cannot change a CHECK in place, so each is rebuilt with
-- 'garmin' added and its rows copied. Nothing references them by foreign key.
--
-- Garmin's OAuth uses PKCE: the verifier made at /start is needed again at
-- the callback, so the connect state keeps it, sealed like every other
-- credential. Garmin's members choose which data they share on its consent
-- screen and can change it later; `scopes` keeps what Garmin last reported.
CREATE TABLE provider_connections_0071 (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('whoop', 'garmin')),
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
  sync_attempt INTEGER NOT NULL DEFAULT 0,
  sync_lease_until INTEGER,
  sync_pending_days INTEGER,
  sync_rerun_days INTEGER,
  connected_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, provider)
);
INSERT INTO provider_connections_0071 SELECT
  user_id, provider, connection_id, provider_user_id, access_token, refresh_token, expires_at, scopes,
  token_version, refresh_lease_until, auth_error_at, last_synced_at, sync_attempt, sync_lease_until,
  sync_pending_days, sync_rerun_days, connected_at, updated_at
  FROM provider_connections;
DROP TABLE provider_connections;
ALTER TABLE provider_connections_0071 RENAME TO provider_connections;
CREATE UNIQUE INDEX IF NOT EXISTS ux_provider_connections_account
  ON provider_connections (provider, provider_user_id);

CREATE TABLE provider_oauth_states_0071 (
  state_sha256 TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('whoop', 'garmin')),
  app_session_id TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  -- Garmin's PKCE code verifier, sealed; NULL for WHOOP.
  code_verifier TEXT CHECK (code_verifier IS NULL OR code_verifier LIKE 'sealed:v1:%')
);
INSERT INTO provider_oauth_states_0071 (state_sha256, user_id, provider, app_session_id, expires_at)
  SELECT state_sha256, user_id, provider, app_session_id, expires_at FROM provider_oauth_states;
DROP TABLE provider_oauth_states;
ALTER TABLE provider_oauth_states_0071 RENAME TO provider_oauth_states;
CREATE INDEX IF NOT EXISTS ix_provider_oauth_states_expiry ON provider_oauth_states (expires_at);

CREATE TABLE provider_oauth_completions_0071 (
  completion_sha256 TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('whoop', 'garmin')),
  app_session_id TEXT NOT NULL,
  credential_ciphertext TEXT NOT NULL CHECK (credential_ciphertext LIKE 'sealed:v1:%'),
  expires_at INTEGER NOT NULL
);
INSERT INTO provider_oauth_completions_0071 SELECT
  completion_sha256, user_id, provider, app_session_id, credential_ciphertext, expires_at
  FROM provider_oauth_completions;
DROP TABLE provider_oauth_completions;
ALTER TABLE provider_oauth_completions_0071 RENAME TO provider_oauth_completions;
CREATE INDEX IF NOT EXISTS ix_provider_oauth_completions_expiry ON provider_oauth_completions (expires_at);

-- Garmin announces each new workout file with a one-time download link that
-- lasts 24 hours, and must be answered within 30 seconds, before the file is
-- fetched. Each announcement is kept here until its file is imported, so a
-- download that fails is retried by the cron while the link still works.
-- The link carries Garmin's download token, so it is sealed.
CREATE TABLE IF NOT EXISTS garmin_activity_files (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- Garmin Connect's activity id: the same workout is announced once per file.
  activity_id TEXT NOT NULL,
  connection_id TEXT NOT NULL,
  callback_url TEXT NOT NULL CHECK (callback_url LIKE 'sealed:v1:%'),
  file_type TEXT NOT NULL,
  -- Garmin's activity name, type and device model, as announced (JSON).
  meta TEXT NOT NULL,
  received_at INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  lease_until INTEGER,
  -- The downloaded workout (summary and heart-rate series, JSON), kept from
  -- the download until it is imported: the link works only once, so a
  -- failed import is retried from here.
  workout TEXT,
  -- Set once the file is imported or can never be: 'imported', 'gone'
  -- (Garmin answered 410 or the link expired), 'unsupported', 'invalid',
  -- 'disconnected' (the member left or stopped sharing activities first) or
  -- 'failed' (the import kept failing).
  outcome TEXT,
  finished_at INTEGER,
  PRIMARY KEY (user_id, activity_id)
);
CREATE INDEX IF NOT EXISTS ix_garmin_activity_files_pending
  ON garmin_activity_files (finished_at, received_at);
