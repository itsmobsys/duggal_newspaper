-- 0006: remove the reader account system introduced in 0004.
--
-- The site no longer has reader accounts, Discord login, profiles, or reader
-- sessions. Votes and reviews are tied to a pseudonymous voter cookie instead.
-- This migration keeps already-deployed databases in step with fresh ones.

DROP TABLE IF EXISTS user_sessions;
DROP INDEX IF EXISTS idx_user_sessions_member;
DROP INDEX IF EXISTS idx_user_sessions_expiry;
DROP INDEX IF EXISTS idx_members_discord_id;

ALTER TABLE members DROP COLUMN global_name;
ALTER TABLE members DROP COLUMN avatar_url;
