-- Migration 0074: power and cadence series of a member's own rides
-- (docs/plans/run-detail-charts P7).
--
-- On 2026-11-10 the owner asked to depend on intervals.icu less: a ride from
-- a power meter should keep its power in Tres Fort itself, so its power and
-- cadence charts, best efforts and time in zones work for a ride imported
-- from a .fit file or from Garmin, or pushed from Apple Health, as they do
-- for an intervals.icu ride (that one is read from intervals.icu live and
-- never stored). Until now those sources kept only normalized power
-- (migration 0061). One row per workout, in the encoding of
-- src/powerSeries.ts: one reading per whole second of moving time,
-- delta-coded, as JSON text.
--
-- Private to its member like activity_heart_rates: only
-- GET /api/activities/:id/streams reads it, and group views, the coach and
-- intervals.icu sync never do. The account export includes it; deleting the
-- workout, a Garmin disconnect or the account removes it.
CREATE TABLE IF NOT EXISTS activity_power_series (
  activity_id TEXT PRIMARY KEY REFERENCES external_activities(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  point_count INTEGER NOT NULL CHECK (point_count > 0),
  series TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_activity_power_series_user ON activity_power_series (user_id);
