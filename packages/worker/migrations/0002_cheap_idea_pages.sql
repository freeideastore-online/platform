ALTER TABLE ideas ADD COLUMN preview TEXT NOT NULL DEFAULT '';
ALTER TABLE ideas ADD COLUMN signal TEXT NOT NULL DEFAULT '';
ALTER TABLE ideas ADD COLUMN body_md TEXT NOT NULL DEFAULT '';
ALTER TABLE ideas ADD COLUMN body_key TEXT NOT NULL DEFAULT '';
ALTER TABLE ideas ADD COLUMN render_key TEXT NOT NULL DEFAULT '';
ALTER TABLE ideas ADD COLUMN source_url TEXT NOT NULL DEFAULT '';
ALTER TABLE ideas ADD COLUMN visibility TEXT NOT NULL DEFAULT 'public';

CREATE INDEX IF NOT EXISTS idx_ideas_stage_updated ON ideas(stage, updated_at);
CREATE INDEX IF NOT EXISTS idx_ideas_visibility ON ideas(visibility, updated_at);

UPDATE ideas
SET
  preview = CASE
    WHEN preview = '' THEN summary
    ELSE preview
  END,
  signal = CASE
    WHEN signal = '' THEN next_step
    ELSE signal
  END,
  body_md = CASE
    WHEN body_md = '' THEN
      '## Snapshot' || char(10) ||
      summary || char(10) || char(10) ||
      '## Current signal' || char(10) ||
      COALESCE(NULLIF(next_step, ''), 'No signal has been added yet.') || char(10) || char(10) ||
      '## Risk' || char(10) ||
      COALESCE(NULLIF(risk, ''), 'Main risk not yet identified.') || char(10) || char(10) ||
      '## How to help' || char(10) ||
      '- Add evidence from public sources.' || char(10) ||
      '- Name a risk or reason to trash it.' || char(10) ||
      '- Suggest a sharper customer, wedge, or pivot.'
    ELSE body_md
  END;
