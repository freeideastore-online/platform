import { defaultIdeaBody } from './markdown';
import type { ContributorRow, Env, IdeaRow, ProfileContributionRow, ProfileIdeaRow } from './types';

const HIDDEN_CONTRIBUTOR_HANDLES = "'system','risk-finder','pivot-maker','evidence-hunter','cloudflare-smoke'";

function slug(input: string) {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}

function id(prefix: string) {
  return `${prefix}-${crypto.randomUUID()}`;
}

export async function uniqueIdeaId(env: Env, title: string) {
  const base = slug(title) || id('idea');
  const existing = await env.DB.prepare('SELECT id FROM ideas WHERE id = ?').bind(base).first<{ id: string }>();
  if (!existing) return base;
  return `${base.slice(0, 54)}-${crypto.randomUUID().slice(0, 8)}`;
}

export async function listIdeas(env: Env, options: { stage?: string; limit?: number }) {
  const stage = options.stage || 'all';
  const limit = options.limit || 60;
  const result = await env.DB.prepare(
    `WITH recent AS (
       SELECT
         id,
         title,
         summary,
         preview,
         signal,
         source_url,
         visibility,
         stage,
         category,
         next_step,
         risk,
         created_by,
         status,
         pro_candidate,
         CASE
           WHEN body_key != '' THEN 1
           WHEN body_md LIKE '%## %' THEN 1
           ELSE 0
         END AS has_publication,
         created_at,
         updated_at
       FROM ideas
       WHERE status != 'removed'
         AND (? = 'all' OR stage = ?)
       ORDER BY updated_at DESC
       LIMIT ?
     )
     SELECT
       recent.*,
       COUNT(DISTINCT CASE WHEN r.type = 'support' THEN r.id END) AS support,
       COUNT(DISTINCT CASE WHEN r.type = 'trash' THEN r.id END) AS trash,
       COUNT(DISTINCT CASE WHEN r.type = 'pivot' THEN r.id END) AS pivot,
       COUNT(DISTINCT c.id) AS contribution_count
     FROM recent
     LEFT JOIN reactions r ON r.idea_id = recent.id
     LEFT JOIN contributions c ON c.idea_id = recent.id
     GROUP BY recent.id
     ORDER BY recent.updated_at DESC`,
  )
    .bind(stage, stage, limit)
    .all<IdeaRow>();

  return result.results || [];
}

export async function ideaById(env: Env, ideaId: string) {
  return env.DB.prepare(
    `SELECT
       i.*,
       COUNT(DISTINCT CASE WHEN r.type = 'support' THEN r.id END) AS support,
       COUNT(DISTINCT CASE WHEN r.type = 'trash' THEN r.id END) AS trash,
       COUNT(DISTINCT CASE WHEN r.type = 'pivot' THEN r.id END) AS pivot,
       COUNT(DISTINCT c.id) AS contribution_count
     FROM ideas i
     LEFT JOIN reactions r ON r.idea_id = i.id
     LEFT JOIN contributions c ON c.idea_id = i.id
     WHERE i.id = ? AND i.status != 'removed'
     GROUP BY i.id`,
  )
    .bind(ideaId)
    .first<IdeaRow>();
}

export async function ideaBody(env: Env, idea: IdeaRow) {
  if (idea.body_key && env.IDEA_BUCKET) {
    const object = await env.IDEA_BUCKET.get(idea.body_key);
    if (object) return object.text();
  }
  return idea.body_md || defaultIdeaBody(idea);
}

export async function listContributors(env: Env) {
  const rows = await env.DB.prepare(
    `SELECT
       p.id,
       p.handle,
       p.display_name,
       p.bio,
       p.reputation,
       p.badges_json,
       COUNT(DISTINCT i.id) AS idea_count,
       COUNT(DISTINCT c.id) AS contribution_count,
       COUNT(DISTINCT r.id) AS reaction_count
     FROM profiles p
     LEFT JOIN ideas i ON i.created_by = p.id AND i.status != 'removed'
     LEFT JOIN contributions c ON c.profile_id = p.id
     LEFT JOIN reactions r ON r.profile_id = p.id
     WHERE p.handle NOT IN (${HIDDEN_CONTRIBUTOR_HANDLES})
     GROUP BY p.id
     ORDER BY p.reputation DESC, contribution_count DESC, idea_count DESC, p.handle ASC
     LIMIT 100`,
  ).all<ContributorRow>();
  return rows.results || [];
}

export async function contributorByHandle(env: Env, handle: string) {
  return env.DB.prepare(
    `SELECT
       p.id,
       p.handle,
       p.display_name,
       p.bio,
       p.reputation,
       p.badges_json,
       COUNT(DISTINCT i.id) AS idea_count,
       COUNT(DISTINCT c.id) AS contribution_count,
       COUNT(DISTINCT r.id) AS reaction_count
     FROM profiles p
     LEFT JOIN ideas i ON i.created_by = p.id AND i.status != 'removed'
     LEFT JOIN contributions c ON c.profile_id = p.id
     LEFT JOIN reactions r ON r.profile_id = p.id
     WHERE p.handle = ? AND p.handle NOT IN (${HIDDEN_CONTRIBUTOR_HANDLES})
     GROUP BY p.id`,
  )
    .bind(handle)
    .first<ContributorRow>();
}

export async function ideasByProfile(env: Env, profileId: string, limit = 500) {
  const rows = await env.DB.prepare(
    `SELECT id, title, summary, stage, category, updated_at, pro_candidate
     FROM ideas
     WHERE created_by = ? AND status != 'removed'
     ORDER BY updated_at DESC
     LIMIT ?`,
  )
    .bind(profileId, limit)
    .all<ProfileIdeaRow>();
  return rows.results || [];
}

export async function contributionsByProfile(env: Env, profileId: string, limit = 100) {
  const rows = await env.DB.prepare(
    `SELECT c.kind, c.body, c.created_at, i.id AS idea_id, i.title AS idea_title
     FROM contributions c
     JOIN ideas i ON i.id = c.idea_id
     WHERE c.profile_id = ?
     ORDER BY c.created_at DESC
     LIMIT ?`,
  )
    .bind(profileId, limit)
    .all<ProfileContributionRow>();
  return rows.results || [];
}
