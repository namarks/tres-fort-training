-- Migration 0076: what the run recorder saw while recording
-- (docs/plans/run-recorder P5(e), docs/DIAGNOSTICS.md).
--
-- On 2026-11-11 the owner chose to keep, with each run recorded in the app,
-- the detail needed to diagnose it after the phone deletes its copy: every
-- pause with whether the member tapped it or auto-pause started it, whether
-- "Pause when I stop" was on, and each GPS fix's speed reading and
-- accuracy. One row per recording, as canonical JSON text in the shape of
-- src/recordingDiagnostics.ts.
--
-- Private to its member like activity_routes: only the owner diagnostics
-- lookups (the owner's own runs) and the account export read it, and group
-- views, the coach and intervals.icu sync never do. Deleting the run or the
-- account removes it.
CREATE TABLE IF NOT EXISTS recording_diagnostics (
  activity_id TEXT PRIMARY KEY REFERENCES external_activities(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  pause_count INTEGER NOT NULL CHECK (pause_count >= 0),
  fix_count INTEGER NOT NULL CHECK (fix_count >= 0),
  diagnostics TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_recording_diagnostics_user ON recording_diagnostics (user_id);
