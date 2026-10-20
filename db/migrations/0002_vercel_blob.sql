-- ---------------------------------------------------------------------------
-- 0002: Vercel Blob photo storage
--
-- Photos now live in a Vercel Blob store instead of R2/S3. Two things changed
-- in the data model:
--
-- 1. The untouched upload is preserved next to the optimized WebP derivative.
--    `original_*` columns record where it went and whether the API kept it.
--    Originals are never rendered on the site - they exist so a bad re-encode
--    (or a legal takedown) can be reconciled against exactly what was filed.
-- 2. Free-tier usage must be countable without asking Vercel. `storage_usage`
--    keeps a per-month tally of advanced operations (uploads, copies, lists),
--    because Hobby allows only 2,000 of them per month before Blob locks out.
--
-- Additive only: existing rows keep working, with originals marked as absent.
-- ---------------------------------------------------------------------------

ALTER TABLE uploads ADD COLUMN original_key TEXT;
ALTER TABLE uploads ADD COLUMN original_url TEXT;
ALTER TABLE uploads ADD COLUMN original_bytes INTEGER;
ALTER TABLE uploads ADD COLUMN original_mime TEXT;
ALTER TABLE uploads ADD COLUMN original_store TEXT; -- public | private
ALTER TABLE uploads ADD COLUMN original_preserved INTEGER NOT NULL DEFAULT 0;
ALTER TABLE uploads ADD COLUMN original_pruned_at TEXT;

ALTER TABLE submission_images ADD COLUMN original_key TEXT;
ALTER TABLE submission_images ADD COLUMN original_url TEXT;
ALTER TABLE submission_images ADD COLUMN original_bytes INTEGER;
ALTER TABLE submission_images ADD COLUMN original_mime TEXT;
ALTER TABLE submission_images ADD COLUMN original_store TEXT;
ALTER TABLE submission_images ADD COLUMN original_preserved INTEGER NOT NULL DEFAULT 0;
ALTER TABLE submission_images ADD COLUMN original_pruned_at TEXT;

ALTER TABLE article_images ADD COLUMN original_key TEXT;
ALTER TABLE article_images ADD COLUMN original_url TEXT;
ALTER TABLE article_images ADD COLUMN original_bytes INTEGER;
ALTER TABLE article_images ADD COLUMN original_mime TEXT;
ALTER TABLE article_images ADD COLUMN original_store TEXT;
ALTER TABLE article_images ADD COLUMN original_preserved INTEGER NOT NULL DEFAULT 0;
ALTER TABLE article_images ADD COLUMN original_pruned_at TEXT;

CREATE INDEX IF NOT EXISTS idx_uploads_originals ON uploads(original_preserved, stored_at);
CREATE INDEX IF NOT EXISTS idx_article_images_originals
  ON article_images(original_preserved, created_at);

-- Monthly tally of Blob usage so the API can stay inside the Hobby allowance
-- (1 GB storage, 2,000 advanced operations) without a paid plan or a surprise
-- lockout. Delete operations are free, so they are not counted.
CREATE TABLE IF NOT EXISTS storage_usage (
  month TEXT PRIMARY KEY, -- UTC month, e.g. 2026-10
  advanced_ops INTEGER NOT NULL DEFAULT 0,
  simple_ops INTEGER NOT NULL DEFAULT 0,
  bytes_uploaded INTEGER NOT NULL DEFAULT 0,
  bytes_pruned INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);
