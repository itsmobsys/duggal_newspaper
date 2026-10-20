-- ---------------------------------------------------------------------------
-- 0005: reader likes, dislikes and 1-5 star reviews.
--
-- One vote and one review per member per article. A member is a Discord
-- identity (see 0004), so counts cannot be inflated by clearing cookies. Both
-- can be changed or removed by their author at any time.
--
-- Reviews publish immediately when they pass the spam checks. Anything that
-- needs a human is stored as 'pending' and never counted until an admin
-- publishes it. 'hidden' reviews are kept for audit but excluded everywhere.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS article_votes (
  id TEXT PRIMARY KEY,
  article_id TEXT NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  member_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  value INTEGER NOT NULL CHECK (value IN (-1, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (article_id, member_id)
);

CREATE INDEX IF NOT EXISTS idx_article_votes_article ON article_votes(article_id, value);
CREATE INDEX IF NOT EXISTS idx_article_votes_member ON article_votes(member_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS article_reviews (
  id TEXT PRIMARY KEY,
  article_id TEXT NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  member_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  -- Snapshot of the Discord identity at write time. Members can rename
  -- themselves; a published review keeps the name it was published under.
  display_name TEXT,
  avatar_url TEXT,
  rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'published' CHECK (status IN ('published', 'pending', 'hidden')),
  moderation_reason TEXT,
  ip_hash TEXT,
  user_agent TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (article_id, member_id)
);

CREATE INDEX IF NOT EXISTS idx_article_reviews_article
  ON article_reviews(article_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_article_reviews_status
  ON article_reviews(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_article_reviews_member
  ON article_reviews(member_id, updated_at DESC);
