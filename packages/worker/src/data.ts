import { id, slug } from './http';
import { defaultIdeaBody, PUBLICATION_POLICY } from './markdown';
import type { ContributorRow, Env, IdeaContributionRow, IdeaRow, ProfileContributionRow, ProfileIdeaRow } from './types';

const HIDDEN_HANDLES = ['system', 'risk-finder', 'pivot-maker', 'evidence-hunter', 'cloudflare-smoke'] as const;
const HIDDEN_HANDLES_PLACEHOLDERS = HIDDEN_HANDLES.map(() => '?').join(',');

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
         -- PUBLICATION_POLICY evaluated exactly, from metrics stored on the row
         -- (migration 0010). Measuring the text here is not an option: bodies
         -- live in R2, so body_md is empty for anything written since.
         CASE
           WHEN chapter_count >= ${PUBLICATION_POLICY.minChapters}
            AND body_words / chapter_count >= ${PUBLICATION_POLICY.minMeanChapterWords}
           THEN 1
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

/**
 * How many derived children a parent lists in its Signals rail.
 *
 * The same shape as RESEARCH_PAGE_SIZE in idea-research.ts: a bound on one
 * rail's HTML, paired with the total so the page states what it is not showing.
 * A silent cap is the bug — see #1, where a `.slice()` destroyed the tail of
 * four contributions — not the cap itself.
 */
export const DERIVED_CHILDREN_LIMIT = 50;

/**
 * The children derived from an idea, plus how many there are in total.
 *
 * Ordered oldest-first and NOT by `updated_at`. Under `updated_at DESC` with a
 * cap, *which* children a parent listed changed every time any child was
 * edited, so a set of annexes rotated in and out of its own parent's index as
 * work continued on them, and a reader refreshing mid-session saw a different
 * list with no sign either was partial (#80). Creation order is stable: the
 * same children appear in the same places until a new one is derived. `id` is
 * the tiebreak because `created_at` has one-second granularity and a burst of
 * `derive_idea` calls lands several children inside the same second.
 *
 * `total` is counted rather than inferred from `children.length`, which cannot
 * distinguish "exactly at the cap" from "over it". The caller renders it.
 */
export async function derivedIdeas(env: Env, parentId: string) {
  const [rows, count] = await Promise.all([
    env.DB.prepare(
      `SELECT id, title FROM ideas
       WHERE parent_id = ? AND status != 'removed'
       ORDER BY created_at ASC, id ASC
       LIMIT ?`,
    )
      .bind(parentId, DERIVED_CHILDREN_LIMIT)
      .all<{ id: string; title: string }>(),
    env.DB.prepare(
      `SELECT COUNT(*) AS n FROM ideas WHERE parent_id = ? AND status != 'removed'`,
    )
      .bind(parentId)
      .first<{ n: number }>(),
  ]);
  const children = rows.results || [];
  return { children, total: count?.n ?? children.length };
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
     WHERE p.handle NOT IN (${HIDDEN_HANDLES_PLACEHOLDERS})
     GROUP BY p.id
     ORDER BY p.reputation DESC, contribution_count DESC, idea_count DESC, p.handle ASC
     LIMIT 100`,
  ).bind(...HIDDEN_HANDLES).all<ContributorRow>();
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
     WHERE p.handle = ? AND p.handle NOT IN (${HIDDEN_HANDLES_PLACEHOLDERS})
     GROUP BY p.id`,
  )
    .bind(handle, ...HIDDEN_HANDLES)
    .first<ContributorRow>();
}

/**
 * A profile's own ideas.
 *
 * `parent_id` is in the projection so a caller can rebuild the tree it just
 * built: an agent that derives four annexes and then calls `my_ideas` used to
 * get four flat rows and no way to tell which of its own ideas were children of
 * which, even though the column was on every row it read (#80). `''` means no
 * parent, matching IdeaRow.
 */
export async function ideasByProfile(env: Env, profileId: string, limit = 500) {
  const rows = await env.DB.prepare(
    `SELECT id, title, summary, stage, category, updated_at, pro_candidate, parent_id
     FROM ideas
     WHERE created_by = ? AND status != 'removed'
     ORDER BY updated_at DESC
     LIMIT ?`,
  )
    .bind(profileId, limit)
    .all<ProfileIdeaRow>();
  return rows.results || [];
}

/**
 * Contributions for an idea, newest first.
 *
 * `limit`/`offset` page the read path: every body is inlined into the HTML, and
 * one idea already carries 42 research entries totalling ~79KB, so rendering the
 * whole record on every page load grows without bound as an idea deepens.
 */
export async function contributionsByIdea(
  env: Env,
  ideaId: string,
  limit?: number,
  offset = 0,
  researchOnly = false,
) {
  const rows = await env.DB.prepare(
    `SELECT c.id, c.kind, c.body, c.created_at, c.claim, c.source_url, c.accessed_at,
            c.provenance, c.confidence, c.supersedes, c.section, c.status, c.resolution,
            p.handle, p.display_name,
            -- The later entry that corrects this one, if any.
            (SELECT s.id FROM contributions s WHERE s.supersedes = c.id ORDER BY s.created_at DESC LIMIT 1)
              AS superseded_by
     FROM contributions c JOIN profiles p ON p.id = c.profile_id
     WHERE c.idea_id = ?${researchOnly ? " AND c.kind != 'comment'" : ''}
     ORDER BY c.created_at DESC
     ${limit ? 'LIMIT ? OFFSET ?' : ''}`,
  )
    .bind(...(limit ? [ideaId, limit, offset] : [ideaId]))
    .all<IdeaContributionRow>();
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

/** How many contributions an idea has, for pagers and counts. */
export async function contributionCount(env: Env, ideaId: string, researchOnly = false) {
  const row = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM contributions
     WHERE idea_id = ?${researchOnly ? " AND kind != 'comment'" : ''}`,
  )
    .bind(ideaId)
    .first<{ n: number }>();
  return row?.n ?? 0;
}
