-- ---------------------------------------------------------------------------
-- 0003: human editor override
--
-- The desk may hold a submission the editor wants to run anyway. Instead of
-- quietly editing the database, an admin can clear the hold and send the piece
-- back through the AI with the flag list attached: the AI is told a human has
-- reviewed exactly those concerns, so it rewrites the story instead of raising
-- the same flags again.
--
-- The original reasons are kept even after `review_reasons` is cleared, so the
-- override is auditable next to the submission it belongs to.
--
-- Additive only: existing rows have no override and behave exactly as before.
-- ---------------------------------------------------------------------------

ALTER TABLE submissions ADD COLUMN editor_override_at TEXT;
ALTER TABLE submissions ADD COLUMN editor_override_by TEXT; -- admin actor id
ALTER TABLE submissions ADD COLUMN editor_override_note TEXT;
ALTER TABLE submissions ADD COLUMN editor_override_reasons TEXT; -- JSON array of cleared flags
