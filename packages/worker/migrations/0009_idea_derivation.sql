-- Idea derivation (fork) lineage. A derived idea keeps a pointer to the idea it
-- was forked from; the parent stays owned by its author, the fork is a new idea.
ALTER TABLE ideas ADD COLUMN parent_id TEXT NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_ideas_parent ON ideas(parent_id);
