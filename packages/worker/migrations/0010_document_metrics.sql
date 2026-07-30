-- Stored document metrics.
--
-- has_publication used to be derived from the body text in SQL (`body_md LIKE
-- '%## %'`, later a character-length proxy for PUBLICATION_POLICY). Once
-- canonical bodies live in R2, body_md is empty and SQL can no longer measure
-- the document at all.
--
-- These columns are maintained on every canonical write from the parsed
-- document, so the catalog evaluates the real policy instead of a proxy.
ALTER TABLE ideas ADD COLUMN body_words INTEGER NOT NULL DEFAULT 0;
ALTER TABLE ideas ADD COLUMN chapter_count INTEGER NOT NULL DEFAULT 0;
