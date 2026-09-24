-- Persist retired chapter ids so routine section cleanup does not break links.
--
-- Policy: keep the newest 256 redirects per idea. That is enough for repeated
-- editing sessions and still gives every idea a hard storage ceiling; the write
-- path enforces the cap after each canonical body change.
CREATE TABLE IF NOT EXISTS chapter_redirects (
  idea_id     TEXT NOT NULL,
  old_id      TEXT NOT NULL,
  chapter_id  TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (idea_id, old_id)
);

CREATE INDEX IF NOT EXISTS idx_chapter_redirects_target
  ON chapter_redirects (idea_id, chapter_id);
