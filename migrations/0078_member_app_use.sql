-- Migration 0078: which app builds each member uses, and on which days
-- (docs/DIAGNOSTICS.md, "Members").
--
-- On 2026-11-13 the owner asked to see which version beta testers run and
-- how they use the app. The Worker already sees every signed-in request;
-- these two tables keep the smallest trace of it, written at most every few
-- minutes per member and client (src/services/memberUsage.ts):
--
--   member_app_use     one row per member, client and build: when it was
--                      first and last seen, and the iOS version it last ran
--                      on. `client` is 'ios' (the app), 'web' (the web app)
--                      or 'coach' (an AI coaching connection). `build` is the
--                      app's build number from the request's standard
--                      User-Agent, '' when unknown (always for web and coach).
--   member_active_days one row per member, UTC day and client they used.
--
-- Nothing here holds training data, request paths or IP addresses. Only the
-- owner's Members page reads these rows; the member's account export
-- includes them and deleting the account removes them.
CREATE TABLE IF NOT EXISTS member_app_use (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client TEXT NOT NULL CHECK (client IN ('ios', 'web', 'coach')),
  build TEXT NOT NULL DEFAULT '',
  os_version TEXT,
  first_seen_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, client, build)
);

CREATE TABLE IF NOT EXISTS member_active_days (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day TEXT NOT NULL,
  client TEXT NOT NULL CHECK (client IN ('ios', 'web', 'coach')),
  PRIMARY KEY (user_id, day, client)
);

CREATE INDEX IF NOT EXISTS idx_member_active_days_day ON member_active_days (day);
