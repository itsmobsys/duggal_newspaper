-- Indexes for the queries that still fell back to full scans and temp sorts.
-- Measured with EXPLAIN QUERY PLAN against production (25 published articles):
-- admin article list, publish-by-submission lookup, archive month filter, front
-- page category strips, and the job queue all used `SCAN` + `USE TEMP B-TREE`.

-- Admin article list: ORDER BY created_at DESC, with and without a status filter.
CREATE INDEX IF NOT EXISTS idx_articles_created ON articles (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_articles_status_created ON articles (status, created_at DESC);

-- Publish path: newest article for a submission, inside the publish transaction.
CREATE INDEX IF NOT EXISTS idx_articles_submission ON articles (submission_id, created_at DESC);

-- Front page strips: filter + order without a window over the whole category.
CREATE INDEX IF NOT EXISTS idx_articles_category_pub_created
  ON articles (category_slug, status, published_at DESC, created_at DESC);

-- Archive month filter is `substr(edition_date, 1, 7) = ?`, so the index has to
-- match the expression; a plain edition_date index cannot serve it.
CREATE INDEX IF NOT EXISTS idx_articles_edition_month
  ON articles (substr(edition_date, 1, 7), status, published_at DESC);

-- Queue: admin list, worker claim ordering, and the 24h completed count.
CREATE INDEX IF NOT EXISTS idx_jobs_created ON jobs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_jobs_claim ON jobs (status, priority DESC, run_at ASC);
CREATE INDEX IF NOT EXISTS idx_jobs_done_finished ON jobs (status, finished_at DESC);

-- Without table stats the planner kept preferring the status index even when a
-- month/category index was far more selective.
ANALYZE;
