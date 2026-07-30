-- Source registry and citation index.
--
-- Sources existed only as inline markdown links inside bodies and contribution
-- prose. Nothing could answer "what does this idea rest on", "what else cites
-- ISO 13006", or "which of these links are dead" — and for an idea whose
-- defensibility argument turns on evidence quality, the evidence base was the
-- least inspectable part of the page. The gapfill document alone carries ~30
-- links, several repeated across sections.
CREATE TABLE IF NOT EXISTS sources (
  id TEXT PRIMARY KEY,
  -- Normalised so the same source cited three ways is one row. See
  -- normaliseSourceUrl() for exactly what normalisation does.
  url TEXT NOT NULL UNIQUE,
  host TEXT NOT NULL DEFAULT '',
  first_seen TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  -- Link health, filled in by the scheduled check. status 0 = never checked.
  last_checked TEXT NOT NULL DEFAULT '',
  status INTEGER NOT NULL DEFAULT 0
);

-- Where a source is cited. A source can be cited by a document section, by a
-- contribution, or both, and by more than one idea.
CREATE TABLE IF NOT EXISTS source_links (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL,
  idea_id TEXT NOT NULL,
  section TEXT NOT NULL DEFAULT '',
  contribution_id TEXT NOT NULL DEFAULT '',
  UNIQUE (source_id, idea_id, section, contribution_id),
  FOREIGN KEY (source_id) REFERENCES sources(id),
  FOREIGN KEY (idea_id) REFERENCES ideas(id)
);

CREATE INDEX IF NOT EXISTS idx_source_links_idea ON source_links(idea_id);
CREATE INDEX IF NOT EXISTS idx_source_links_source ON source_links(source_id);
CREATE INDEX IF NOT EXISTS idx_sources_checked ON sources(last_checked);
