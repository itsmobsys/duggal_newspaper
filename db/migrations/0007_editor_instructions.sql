-- ---------------------------------------------------------------------------
-- 0007: submitter's editorial instructions
--
-- A filer can now steer the rewrite ("make it shorter", "serious newspaper
-- tone"). The text is stored next to the story but is never published: it is
-- an instruction to the desk, not part of the news.
--
-- Additive only: existing rows have no instructions and the prompt falls back
-- to house style exactly as before.
-- ---------------------------------------------------------------------------

ALTER TABLE submissions ADD COLUMN editor_instructions TEXT;
