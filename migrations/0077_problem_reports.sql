-- Migration 0077: problems members report from the app (docs/DIAGNOSTICS.md).
--
-- On 2026-11-11 the owner asked for a better way for members to contact
-- support than an email: say what went wrong (something isn't working, an
-- activity looks wrong, or feedback), optionally with a screenshot and one
-- of their activities. Sending a report with an activity attached is the
-- member's consent for support to read that activity's details for 14 days
-- (activity_access_until); after that only the report itself stays.
--
-- `id` is the client's UUID, the idempotency key. `context` is the app's
-- version, build, OS and device as JSON (src/problemReports.ts). Only the
-- owner diagnostics lookups and the member's own account export read these
-- rows; Garmin and WHOOP activities can't be attached. Deleting the account
-- removes them, and deleting the activity detaches it.
CREATE TABLE IF NOT EXISTS problem_reports (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('bug', 'activity', 'feedback')),
  message TEXT NOT NULL,
  contact TEXT,
  activity_id TEXT REFERENCES external_activities(id) ON DELETE SET NULL,
  activity_access_until INTEGER,
  context TEXT NOT NULL,
  has_screenshot INTEGER NOT NULL DEFAULT 0 CHECK (has_screenshot IN (0, 1)),
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_problem_reports_created ON problem_reports (created_at);
CREATE INDEX IF NOT EXISTS idx_problem_reports_user ON problem_reports (user_id, created_at);

-- One screenshot per report, kept apart so listing reports never reads it.
CREATE TABLE IF NOT EXISTS problem_report_screenshots (
  report_id TEXT PRIMARY KEY REFERENCES problem_reports(id) ON DELETE CASCADE,
  content_type TEXT NOT NULL CHECK (content_type IN ('image/jpeg', 'image/png')),
  bytes BLOB NOT NULL
);
