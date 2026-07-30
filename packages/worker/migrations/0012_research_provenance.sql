-- Typed research entries.
--
-- Research was a `kind` string plus a free-text body, so everything that makes a
-- research record useful lived inside prose: what is claimed, what backs it, when
-- it was checked, how confident it is, and whether something later corrected it.
--
-- The gapfill idea shows the cost. It is an idea *about* per-field provenance and
-- it had to invent the vocabulary in prose — "every field stamped extracted /
-- derived / inferred / human-asserted / supplier-confirmed" — because the schema
-- had nowhere to put it. Its own correction entry ("CORRECTION TO THE COMPETITOR
-- SCAN — Matrixify was overstated") could not supersede the entry it corrected, so
-- both rendered as equal peers.
--
-- Prose `body` stays: narrative is still the point. These columns carry the parts
-- that need to be queried, filtered, cited and superseded.
ALTER TABLE contributions ADD COLUMN claim TEXT NOT NULL DEFAULT '';
ALTER TABLE contributions ADD COLUMN source_url TEXT NOT NULL DEFAULT '';
ALTER TABLE contributions ADD COLUMN accessed_at TEXT NOT NULL DEFAULT '';
-- extracted | derived | inferred | human-asserted | confirmed
ALTER TABLE contributions ADD COLUMN provenance TEXT NOT NULL DEFAULT '';
-- low | medium | high
ALTER TABLE contributions ADD COLUMN confidence TEXT NOT NULL DEFAULT '';
-- The contribution this one corrects, so the record self-corrects instead of
-- accumulating contradictions presented as peers.
ALTER TABLE contributions ADD COLUMN supersedes TEXT NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_contributions_supersedes ON contributions(supersedes);
