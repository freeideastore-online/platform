import type { Env, IdeaContributionRow } from './types';

export const REFINEMENT_KIND = 'refinement';

/** Terminal states for a proposal. An empty status means still open. */
export const RESOLUTION_VALUES = new Set(['applied', 'rejected', 'superseded']);

export type RefinementRow = IdeaContributionRow & {
  section: string;
  status: string;
  resolution: string;
  resolved_revision: string;
  resolved_at: string;
};

/**
 * The proposal text a refinement carries.
 *
 * `propose_idea_refinement` composes the body as "Section: x / Proposal: … /
 * Rationale: …". Older rows only have that prose, so the proposal is recovered
 * from it; newer rows also carry the target section as a column.
 */
export function proposalText(body: string) {
  const match = body.match(/^\s*Proposal:\s*([\s\S]*?)(?:\n\s*Rationale:|$)/m);
  return (match?.[1] ?? body).trim();
}

/** Target section from the column, falling back to the prose prefix. */
export function proposalSection(row: { section?: string; body?: string }) {
  if (row.section) return row.section;
  const match = String(row.body || '').match(/^\s*Section:\s*(\S+)/m);
  return (match?.[1] ?? '').trim();
}

export async function listRefinements(env: Env, ideaId: string, status?: 'open' | 'resolved' | 'all') {
  const scope = status || 'open';
  const rows = await env.DB.prepare(
    `SELECT c.id, c.kind, c.body, c.created_at, c.section, c.status, c.resolution,
            c.resolved_revision, c.resolved_at, p.handle, p.display_name
     FROM contributions c JOIN profiles p ON p.id = c.profile_id
     WHERE c.idea_id = ? AND c.kind = ?
       ${scope === 'open' ? "AND c.status = ''" : ''}
       ${scope === 'resolved' ? "AND c.status != ''" : ''}
     ORDER BY c.created_at ASC`,
  )
    .bind(ideaId, REFINEMENT_KIND)
    .all<RefinementRow>();
  return (rows.results || []).map((row) => ({
    ...row,
    section: proposalSection(row),
    proposal: proposalText(String(row.body || '')),
  }));
}

/** How many proposals are still waiting, for the idea page and console. */
export async function openRefinementCount(env: Env, ideaId: string) {
  const row = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM contributions WHERE idea_id = ? AND kind = ? AND status = ''`,
  )
    .bind(ideaId, REFINEMENT_KIND)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

export async function refinementById(env: Env, ideaId: string, contributionId: string) {
  return env.DB.prepare(
    `SELECT id, kind, body, created_at, section, status, resolution, resolved_revision
     FROM contributions WHERE id = ? AND idea_id = ? AND kind = ?`,
  )
    .bind(contributionId, ideaId, REFINEMENT_KIND)
    .first<RefinementRow>();
}

export async function markRefinementResolved(
  env: Env,
  contributionId: string,
  status: string,
  resolution: string,
  revisionId = '',
) {
  await env.DB.prepare(
    `UPDATE contributions
     SET status = ?, resolution = ?, resolved_revision = ?, resolved_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
  )
    .bind(status, resolution, revisionId, contributionId)
    .run();
}
