-- Full-text search across documents and research.
--
-- There was no search at all: listIdeas filtered by stage, and the idea page's
-- chapter filter matched chapter *titles*. Nothing could answer "which ideas
-- mention ETIM" or "where did we record the Matrixify correction" — which is
-- what makes a deep corpus unusable as it grows.
--
-- The index is populated on write rather than derived from a content table,
-- because canonical bodies live in R2 and are not visible to SQL.
--
-- Tokenizer: porter over unicode61. Stemming matches plurals and inflections in
-- both directions (supplier/suppliers, infer/inferring), which is what prose
-- search needs. Prefix wildcards are deliberately NOT used with it: porter stems
-- the query as well as the content, so a prefix on a stemmed term matches
-- unpredictably.
CREATE VIRTUAL TABLE IF NOT EXISTS search_index USING fts5(
  title,
  text,
  idea_id UNINDEXED,
  -- 'section' | 'research'
  kind UNINDEXED,
  -- section id or contribution id
  ref UNINDEXED,
  tokenize = 'porter unicode61'
);
