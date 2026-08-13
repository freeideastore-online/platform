export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  IDEA_BUCKET?: R2Bucket;
  /**
   * FIS's own HMAC key for signing sessions (see session.ts). Optional while the
   * FreeAppStore path is still the live one; #38 makes it required.
   */
  SESSION_SIGNING_KEY?: string;
  /** Public client ids — wrangler.toml vars, not secrets. */
  GH_OAUTH_CLIENT_ID?: string;
  GOOGLE_CLIENT_ID?: string;
  /** Worker secrets, placed via `ops put fis <KEY>`. */
  GH_OAUTH_CLIENT_SECRET?: string;
  GOOGLE_CLIENT_SECRET?: string;
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
  parent_id?: string;
  status: string;
  pro_candidate: number;
  created_at: string;
  updated_at: string;
  support: number;
  trash: number;
  pivot: number;
  contribution_count: number;
  has_publication?: number;
  /** Maintained on canonical writes; see migration 0010 and documentMetrics(). */
  body_words?: number;
  chapter_count?: number;
};

export type AuthUser = {
  handle: string;
  displayName: string;
  provider: string;
  avatarUrl: string | null;
};

/** A FIS-owned identity; see migration 0016. Joins to profiles by handle. */
export type IdentityRow = {
  id: string;
  provider: string;
  provider_user_id: string;
  handle: string;
  display_name: string;
  avatar_url?: string | null;
  created_at: string;
  updated_at: string;
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

export type IdeaContributionRow = {
  id: string;
  kind: string;
  body: string;
  created_at: string;
  handle: string;
  display_name: string;
  /** Typed research fields; see migration 0012. Empty when not supplied. */
  claim?: string;
  source_url?: string;
  accessed_at?: string;
  provenance?: string;
  confidence?: string;
  supersedes?: string;
  /** Derived: the id of a later entry that corrects this one, if any. */
  superseded_by?: string;
  /** Refinement queue state; see migration 0013. '' means still open. */
  section?: string;
  status?: string;
  resolution?: string;
  resolved_revision?: string;
};
