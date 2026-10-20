-- ---------------------------------------------------------------------------
-- 0005: reader votes and reviews (no accounts)
--
-- Readers are identified by a pseudonymous voter cookie. The API stores only a
-- SHA-256 hash of that token, never the token itself. One browser gets one vote
-- and one review per article, but both can be changed or removed.
--
-- Reviews publish immediately when they pass the spam checks. Anything that
-- needs a human is stored as 'pending' and never counted until an admin
-- publishes it. 'hidden' reviews are kept for audit but excluded everywhere.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS article_votes (
  id TEXT PRIMARY KEY,
  article_id TEXT NOT NULL,
  voter_hash TEXT NOT NULL,
  value INTEGER NOT NULL CHECK (value IN (-1, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (article_id, voter_hash),
  FOREIGN KEY (article_id) REFERENCES articles(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_article_votes_article ON article_votes(article_id, value);
CREATE INDEX IF NOT EXISTS idx_article_votes_voter ON article_votes(voter_hash, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_article_votes_updated ON article_votes(updated_at DESC);

CREATE TABLE IF NOT EXISTS article_reviews (
  id TEXT PRIMARY KEY,
  article_id TEXT NOT NULL,
  voter_hash TEXT NOT NULL,
  display_name TEXT,
  rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'published', -- published | pending | hidden
  moderation_reason TEXT,
  ip_hash TEXT,
  user_agent TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (article_id, voter_hash),
  FOREIGN KEY (article_id) REFERENCES articles(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_article_reviews_article
  ON article_reviews(article_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_article_reviews_status
  ON article_reviews(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_article_reviews_voter
  ON article_reviews(voter_hash, updated_at DESC);
