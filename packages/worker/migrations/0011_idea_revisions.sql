-- Canonical document history.
--
-- updateIdea() overwrote body_md in place, so republishing destroyed the version
-- it replaced. That is the wrong default for a platform whose stated product is
-- "the visible history of who made it better", and it has already bitten: a
-- document was rewritten while another session was reading it, with no way to
-- recover what was there.
--
-- A revision records the body being REPLACED, written before the overwrite. The
-- live `ideas` row is always the head, so the pre-write state is recoverable
-- even for the first write to a document that had no history.
--
-- Blobs follow the same storage rule as bodies: R2 when bound (body_key),
-- inline in D1 otherwise (body_md).
CREATE TABLE IF NOT EXISTS idea_revisions (
  id TEXT PRIMARY KEY,
  idea_id TEXT NOT NULL,
  body_md TEXT NOT NULL DEFAULT '',
  body_key TEXT NOT NULL DEFAULT '',
  body_words INTEGER NOT NULL DEFAULT 0,
  chapter_count INTEGER NOT NULL DEFAULT 0,
  -- Who caused the change, and what kind of write it was.
  author_profile_id TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT 'update',
  section TEXT NOT NULL DEFAULT '',
  reason TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (idea_id) REFERENCES ideas(id)
);

CREATE INDEX IF NOT EXISTS idx_idea_revisions_idea ON idea_revisions(idea_id, created_at DESC);
