-- Deploy the compatibility Worker described in multi-session-release.md first.
-- Existing sessions keep their identity, sets, attempts and primary slot.
ALTER TABLE sessions ADD COLUMN slot INTEGER NOT NULL DEFAULT 0 CHECK (slot >= 0);
-- Immutable creation receipt survives later calendar edits and plan remaps.
ALTER TABLE sessions ADD COLUMN additional_request TEXT;
DROP INDEX ux_session_user_date;
CREATE UNIQUE INDEX ux_session_user_date_slot ON sessions(user_id, date, slot);
