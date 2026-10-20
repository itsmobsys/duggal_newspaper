-- Duggal Badmosh Daily Newspaper - initial schema
-- All timestamps are ISO-8601 UTC strings. Booleans are INTEGER 0/1.

CREATE TABLE IF NOT EXISTS _migrations (
  id TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL
);

-- ---------------------------------------------------------------------------
-- Members / identities (no Discord bot: identity is typed by the submitter)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS members (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  discord_username TEXT,
  discord_id TEXT,
  submission_count INTEGER NOT NULL DEFAULT 0,
  published_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_members_discord ON members(discord_username);

-- ---------------------------------------------------------------------------
-- Uploads: bytes land in object storage before the submission exists, so a
-- failed form submit or a failed AI pass never destroys a photo.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS uploads (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending', -- pending | stored | claimed | expired
  storage_key TEXT,
  thumb_key TEXT,
  url TEXT,
  thumb_url TEXT,
  mime TEXT,
  bytes INTEGER,
  width INTEGER,
  height INTEGER,
  checksum TEXT,
  original_name TEXT,
  ip_hash TEXT,
  submission_id TEXT,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  stored_at TEXT,
  claimed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_uploads_expiry ON uploads(status, expires_at);

-- ---------------------------------------------------------------------------
-- Submissions: original text is never overwritten. AI output lives elsewhere.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS submissions (
  id TEXT PRIMARY KEY,
  public_token TEXT NOT NULL UNIQUE,
  headline TEXT NOT NULL,
  story TEXT NOT NULL,
  author_name TEXT NOT NULL,
  discord_handle TEXT,
  contact_email TEXT,
  category_slug TEXT,
  source_url TEXT,
  anonymous INTEGER NOT NULL DEFAULT 0,
  identity_mode TEXT NOT NULL DEFAULT 'named', -- named | discord | anonymous
  status TEXT NOT NULL DEFAULT 'received',
  -- received | processing | queued_review | published | rejected | failed
  review_reason TEXT,
  review_reasons TEXT,
  spam_score REAL NOT NULL DEFAULT 0,
  misleading_risk REAL NOT NULL DEFAULT 0,
  duplicate_of TEXT,
  duplicate_score REAL NOT NULL DEFAULT 0,
  content_hash TEXT NOT NULL,
  simhash TEXT,
  ip_hash TEXT,
  user_agent TEXT,
  ai_model TEXT,
  ai_attempts INTEGER NOT NULL DEFAULT 0,
  ai_last_error TEXT,
  ai_result TEXT,
  article_id TEXT,
  member_id TEXT,
  processed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_submissions_status ON submissions(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_submissions_hash ON submissions(content_hash);
CREATE INDEX IF NOT EXISTS idx_submissions_created ON submissions(created_at DESC);

CREATE TABLE IF NOT EXISTS submission_images (
  id TEXT PRIMARY KEY,
  submission_id TEXT NOT NULL,
  upload_id TEXT,
  storage_key TEXT NOT NULL,
  thumb_key TEXT,
  url TEXT NOT NULL,
  thumb_url TEXT,
  mime TEXT NOT NULL,
  bytes INTEGER NOT NULL,
  width INTEGER,
  height INTEGER,
  checksum TEXT,
  caption TEXT,
  alt_text TEXT,
  attribution TEXT,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  FOREIGN KEY (submission_id) REFERENCES submissions(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_submission_images_sub ON submission_images(submission_id, position);

-- ---------------------------------------------------------------------------
-- Articles
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS articles (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  submission_id TEXT,
  headline TEXT NOT NULL,
  dek TEXT,
  body TEXT NOT NULL,
  original_body TEXT,
  category_slug TEXT NOT NULL DEFAULT 'server-news',
  author_display TEXT NOT NULL,
  author_member_id TEXT,
  identity_mode TEXT NOT NULL DEFAULT 'named',
  tags TEXT NOT NULL DEFAULT '[]',
  breaking INTEGER NOT NULL DEFAULT 0,
  featured INTEGER NOT NULL DEFAULT 0,
  placement TEXT NOT NULL DEFAULT 'standard', -- lead | top | standard
  rank_score REAL NOT NULL DEFAULT 0,
  editor_note TEXT,
  status TEXT NOT NULL DEFAULT 'published', -- draft | published | unpublished | deleted
  source_url TEXT,
  ai_model TEXT,
  ai_generated INTEGER NOT NULL DEFAULT 1,
  reading_minutes INTEGER NOT NULL DEFAULT 2,
  edition_date TEXT NOT NULL,
  views INTEGER NOT NULL DEFAULT 0,
  published_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (submission_id) REFERENCES submissions(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_articles_status_pub ON articles(status, published_at DESC);
CREATE INDEX IF NOT EXISTS idx_articles_category ON articles(category_slug, status, published_at DESC);
CREATE INDEX IF NOT EXISTS idx_articles_edition ON articles(edition_date, status);
CREATE INDEX IF NOT EXISTS idx_articles_breaking ON articles(breaking, status, published_at DESC);

CREATE TABLE IF NOT EXISTS article_images (
  id TEXT PRIMARY KEY,
  article_id TEXT NOT NULL,
  upload_id TEXT,
  storage_key TEXT NOT NULL,
  thumb_key TEXT,
  url TEXT NOT NULL,
  thumb_url TEXT,
  mime TEXT NOT NULL,
  bytes INTEGER NOT NULL,
  width INTEGER,
  height INTEGER,
  checksum TEXT,
  caption TEXT,
  alt_text TEXT,
  attribution TEXT,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  FOREIGN KEY (article_id) REFERENCES articles(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_article_images_article ON article_images(article_id, position);

-- ---------------------------------------------------------------------------
-- Editions: an AI editor writes one per day. No human required.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS editions (
  edition_date TEXT PRIMARY KEY,
  headline TEXT,
  summary TEXT,
  mood TEXT,
  lead_article_id TEXT,
  article_count INTEGER NOT NULL DEFAULT 0,
  generated_by TEXT NOT NULL DEFAULT 'ai', -- ai | manual
  ai_model TEXT,
  status TEXT NOT NULL DEFAULT 'published', -- draft | published
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- ---------------------------------------------------------------------------
-- Community awards, generated weekly by the AI editor.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS awards (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  category TEXT,
  winner_name TEXT NOT NULL,
  winner_member_id TEXT,
  citation TEXT,
  edition_date TEXT,
  article_id TEXT,
  auto_generated INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_awards_active ON awards(active, sort_order);

-- ---------------------------------------------------------------------------
-- Configurable taxonomy + settings
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS categories (
  slug TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  accent TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT
);

-- ---------------------------------------------------------------------------
-- Durable, lease-based job queue. Survives restarts and cold starts.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  payload TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'pending', -- pending | leased | done | failed | dead
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 8,
  run_at TEXT NOT NULL,
  locked_until TEXT,
  locked_by TEXT,
  last_error TEXT,
  idempotency_key TEXT,
  priority INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  finished_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_jobs_ready ON jobs(status, run_at, priority DESC);
CREATE INDEX IF NOT EXISTS idx_jobs_lease ON jobs(status, locked_until);
CREATE INDEX IF NOT EXISTS idx_jobs_idem ON jobs(idempotency_key, status);

CREATE TABLE IF NOT EXISTS job_runs (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,
  attempt INTEGER NOT NULL,
  status TEXT NOT NULL, -- started | succeeded | failed
  duration_ms INTEGER,
  error TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_job_runs_job ON job_runs(job_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- Admin (override console only; the newsroom runs without it)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS admin_users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'owner', -- owner | editor
  disabled INTEGER NOT NULL DEFAULT 0,
  last_login_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS admin_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  ip_hash TEXT,
  user_agent TEXT,
  revoked INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES admin_users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_admin_sessions_token ON admin_sessions(token_hash);
CREATE INDEX IF NOT EXISTS idx_admin_sessions_expiry ON admin_sessions(expires_at);

-- ---------------------------------------------------------------------------
-- Public accountability: reports + corrections
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS reports (
  id TEXT PRIMARY KEY,
  article_id TEXT,
  reason TEXT NOT NULL,
  detail TEXT,
  reporter_contact TEXT,
  status TEXT NOT NULL DEFAULT 'open', -- open | resolved | dismissed
  resolution_note TEXT,
  ip_hash TEXT,
  created_at TEXT NOT NULL,
  resolved_at TEXT,
  resolved_by TEXT
);
CREATE INDEX IF NOT EXISTS idx_reports_status ON reports(status, created_at DESC);

CREATE TABLE IF NOT EXISTS corrections (
  id TEXT PRIMARY KEY,
  article_id TEXT NOT NULL,
  summary TEXT NOT NULL,
  detail TEXT,
  status TEXT NOT NULL DEFAULT 'pending', -- pending | accepted | rejected
  submitted_by TEXT,
  ip_hash TEXT,
  admin_id TEXT,
  created_at TEXT NOT NULL,
  applied_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_corrections_status ON corrections(status, created_at DESC);

-- ---------------------------------------------------------------------------
-- Audit log (append-only by convention)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  target_type TEXT,
  target_id TEXT,
  detail TEXT,
  ip_hash TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at DESC);

-- ---------------------------------------------------------------------------
-- Fixed-window rate limiting (durable across restarts / instances)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS rate_limits (
  key TEXT PRIMARY KEY,
  window_start INTEGER NOT NULL,
  count INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_rate_limits_expiry ON rate_limits(expires_at);

-- ---------------------------------------------------------------------------
-- AI usage telemetry (tokens only; never prompts or user content)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ai_usage (
  id TEXT PRIMARY KEY,
  job_id TEXT,
  purpose TEXT NOT NULL,
  model TEXT NOT NULL,
  prompt_tokens INTEGER,
  completion_tokens INTEGER,
  total_tokens INTEGER,
  duration_ms INTEGER,
  attempts INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL, -- ok | error | rate_limited
  error_code TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ai_usage_created ON ai_usage(created_at DESC);
