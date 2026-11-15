-- Migration 0075: one-time workouts (docs/plans/workout-library P3).
--
-- On 2026-11-10 the owner asked the coach to make the day's run harder and
-- found the only way was to change the saved run for every week: every
-- planned day had to point at a reusable workout in the library. A one-time
-- workout is a workout made for one date. It is part of the versioned plan
-- tree like any workout (slots, targets, audit, snapshots) and its date's
-- session points at it, but it is not a library workout: it never appears
-- in the library, the weekly schedule, a block of weeks or another date's
-- picker, and an `update_plan` rebuild of the library leaves it alone.
--
-- `one_time_date` is the device-local YYYY-MM-DD it was made for; NULL for
-- every library workout. Additive and nullable: a Worker without this
-- column's code still reads and writes plans (it would list a one-time
-- workout as an ordinary one), so the migration goes first.
ALTER TABLE workouts ADD COLUMN one_time_date TEXT
  CHECK (one_time_date IS NULL OR (length(one_time_date) = 10 AND date(one_time_date) = one_time_date));
