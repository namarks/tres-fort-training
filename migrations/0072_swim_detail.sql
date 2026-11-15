-- Migration 0072: swim detail and Apple Watch's effort score
-- (docs/plans/sport-activities P4 and P5).
--
-- activity_swims keeps what an Apple Watch saves with a swim: pool or open
-- water, the pool's length and unit, and its lengths and sets with stroke and
-- stroke count, as canonical JSON text in the shape of src/swimDetail.ts.
-- One row per activity. Private to its member like activity_laps: only
-- GET /api/activities/:id/swim reads it, and group views and coach tools
-- never do. The account export includes it; deleting the account removes it.
CREATE TABLE IF NOT EXISTS activity_swims (
  activity_id TEXT PRIMARY KEY REFERENCES external_activities(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  location TEXT CHECK (location IS NULL OR location IN ('pool', 'open_water')),
  pool_length_m REAL,
  pool_unit TEXT CHECK (pool_unit IS NULL OR pool_unit IN ('m', 'yd')),
  length_count INTEGER NOT NULL CHECK (length_count >= 0),
  detail TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_activity_swims_user ON activity_swims (user_id);

-- Apple Watch's workout effort score (1 to 10), the member's own rating in
-- Apple's Fitness app, else the watch's estimate. The member's rating in
-- Tres Fort (effort, migration 0066) wins over it; either scores a workout
-- with no measured load as load_method 'effort'. Null when Apple Health has
-- none or the member hasn't allowed reading it.
ALTER TABLE external_activities ADD COLUMN provider_effort REAL;
