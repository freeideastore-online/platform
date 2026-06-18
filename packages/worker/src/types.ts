export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  IDEA_BUCKET?: R2Bucket;
}

export type IdeaRow = {
  id: string;
  title: string;
  summary: string;
  preview?: string;
  signal?: string;
  body_md?: string;
  body_key?: string;
  render_key?: string;
  source_url?: string;
  visibility?: string;
  stage: string;
  category: string;
  next_step: string;
  risk: string;
  created_by: string;
  status: string;
  pro_candidate: number;
  created_at: string;
  updated_at: string;
  support: number;
  trash: number;
  pivot: number;
  contribution_count: number;
  has_publication?: number;
};

export type AuthUser = {
  handle: string;
  displayName: string;
  provider: string;
  avatarUrl: string | null;
};

export type ContributorRow = {
  id: string;
  handle: string;
  display_name: string;
  bio?: string;
  reputation: number;
  badges_json?: string;
  idea_count: number;
  contribution_count: number;
  reaction_count: number;
};

export type ProfileIdeaRow = {
  id: string;
  title: string;
  summary: string;
  stage: string;
  category: string;
  updated_at: string;
  pro_candidate?: number;
};

export type ProfileContributionRow = {
  kind: string;
  body: string;
  created_at: string;
  idea_id: string;
  idea_title: string;
};
