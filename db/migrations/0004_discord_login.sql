-- Discord OAuth2 login: richer member profiles and opaque user sessions.
-- Identity always comes from Discord; the browser only ever holds a random
-- session token that we store as a SHA-256 hash.

ALTER TABLE members ADD COLUMN global_name TEXT;
ALTER TABLE members ADD COLUMN avatar_url TEXT;

-- One member per Discord account. Nullable for legacy rows created before
-- Discord login existed, so the index is partial.
CREATE UNIQUE INDEX IF NOT EXISTS idx_members_discord_id
  ON members (discord_id)
  WHERE discord_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS user_sessions (
  id TEXT PRIMARY KEY,
  member_id TEXT NOT NULL REFERENCES members (id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  ip_hash TEXT,
  user_agent TEXT
);

CREATE INDEX IF NOT EXISTS idx_user_sessions_member ON user_sessions (member_id);
CREATE INDEX IF NOT EXISTS idx_user_sessions_expiry ON user_sessions (expires_at);
