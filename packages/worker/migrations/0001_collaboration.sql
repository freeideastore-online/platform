CREATE TABLE IF NOT EXISTS profiles (
  id TEXT PRIMARY KEY,
  handle TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  bio TEXT NOT NULL DEFAULT '',
  reputation INTEGER NOT NULL DEFAULT 0,
  badges_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS ideas (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  stage TEXT NOT NULL DEFAULT 'raw',
  category TEXT NOT NULL DEFAULT 'uncategorized',
  next_step TEXT NOT NULL DEFAULT '',
  risk TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  pro_candidate INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (created_by) REFERENCES profiles(id)
);

CREATE TABLE IF NOT EXISTS contributions (
  id TEXT PRIMARY KEY,
  idea_id TEXT NOT NULL,
  profile_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (idea_id) REFERENCES ideas(id),
  FOREIGN KEY (profile_id) REFERENCES profiles(id)
);

CREATE TABLE IF NOT EXISTS reactions (
  id TEXT PRIMARY KEY,
  idea_id TEXT NOT NULL,
  profile_id TEXT NOT NULL,
  type TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (idea_id, profile_id, type),
  FOREIGN KEY (idea_id) REFERENCES ideas(id),
  FOREIGN KEY (profile_id) REFERENCES profiles(id)
);

CREATE INDEX IF NOT EXISTS idx_ideas_stage ON ideas(stage);
CREATE INDEX IF NOT EXISTS idx_ideas_updated ON ideas(updated_at);
CREATE INDEX IF NOT EXISTS idx_contributions_idea ON contributions(idea_id, created_at);
CREATE INDEX IF NOT EXISTS idx_reactions_idea ON reactions(idea_id, type);

INSERT OR IGNORE INTO profiles (id, handle, display_name, reputation, badges_json) VALUES
  ('profile-system', 'system', 'Idea Store Seeder', 0, '["seed"]');

INSERT OR IGNORE INTO ideas (id, title, summary, stage, category, next_step, risk, created_by, pro_candidate) VALUES
  ('asx-filings-analyst', 'ASX Filings Analyst', 'Public reports, valuation screens, source-backed weekly watchlist.', 'researched', 'finance', 'Validate with 10 Australian retail investors using a manual weekly report.', 'Market data licensing and accidental financial advice.', 'profile-system', 1),
  ('parent-volleyball-community', 'Parent Volleyball Community', 'A focused parent/community coordination product has clearer demand than broad social features.', 'prototype', 'community', 'Run a local team pilot and measure repeat weekly use.', 'Distribution depends on clubs and parent group adoption.', 'profile-system', 1),
  ('school-transport-options', 'School Transport Options', 'Parents need safer, clearer transport options for ages 5-10.', 'critique', 'local-services', 'Interview 15 parents and 5 school administrators about trust and logistics.', 'Trust, liability, regulation, and operations are hard.', 'profile-system', 0),
  ('slowdown-personal-reset', 'Slowdown Personal Reset', 'A lightweight app already exists; next question is retention and use frequency.', 'built', 'wellbeing', 'Track 7-day return use and collect qualitative feedback.', 'Wellbeing apps are crowded and hard to monetize.', 'profile-system', 0),
  ('idea-reputation-system', 'Idea Reputation System', 'People can earn recognition by improving ideas, not just building apps.', 'raw', 'platform', 'Define badges and contribution events that cannot be gamed easily.', 'Low-quality AI-generated comments could flood the system.', 'profile-system', 1),
  ('proidea-dossier-builder', 'ProIdea Dossier Builder', 'The valuable artifact may be a complete opportunity packet, not the idea itself.', 'pivot', 'platform', 'Create one dossier manually and see if builders or investors ask for more.', 'Research quality must be high enough to justify curation.', 'profile-system', 1);

