-- Refinement queue state.
--
-- `propose_idea_refinement` writes a contribution and explicitly does not touch
-- the canonical document. Nothing then recorded whether a proposal had been
-- acted on, and nothing surfaced that one was waiting: the gapfill idea carried
-- four refinements, none published, with 2.8x more research outside the document
-- than in it.
--
-- The proposal's target section lived in prose ("Section: design"), so it could
-- not be queried or used to route the write either.
ALTER TABLE contributions ADD COLUMN section TEXT NOT NULL DEFAULT '';
-- '' = open. applied | rejected | superseded
ALTER TABLE contributions ADD COLUMN status TEXT NOT NULL DEFAULT '';
-- Why it was applied, rejected or superseded.
ALTER TABLE contributions ADD COLUMN resolution TEXT NOT NULL DEFAULT '';
-- The revision produced when the proposal was applied, linking the queue to
-- document history.
ALTER TABLE contributions ADD COLUMN resolved_revision TEXT NOT NULL DEFAULT '';
ALTER TABLE contributions ADD COLUMN resolved_at TEXT NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_contributions_queue ON contributions(idea_id, kind, status);
