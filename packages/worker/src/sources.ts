import { id } from './http';
import { ideaChapters } from './markdown';
import type { Env, IdeaRow } from './types';

/** Tracking parameters carry no meaning about the source itself. */
const TRACKING_PARAMS = /^(utm_|fbclid$|gclid$|mc_[ce]id$|ref$|ref_src$)/i;

/**
 * Canonical form of a source URL, so the same source cited three different ways
 * is one row in the registry.
 *
 * Deliberately conservative: it lowercases the host, drops the fragment and
 * tracking parameters, and removes a bare trailing slash. It does not touch the
 * path's case or ordering of meaningful parameters, because those can be
 * significant and guessing would merge genuinely different pages.
 */
export function normaliseSourceUrl(raw: string): string | null {
  const trimmed = String(raw || '').trim();
  if (!/^https?:\/\//i.test(trimmed)) return null;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  url.hash = '';
  url.hostname = url.hostname.toLowerCase();
  url.protocol = url.protocol.toLowerCase();
  for (const key of [...url.searchParams.keys()]) {
    if (TRACKING_PARAMS.test(key)) url.searchParams.delete(key);
  }
  let out = url.toString();
  // A bare trailing slash on a path-only URL is not a different page.
  if (out.endsWith('/') && !url.search && url.pathname !== '/') out = out.slice(0, -1);
  return out;
}

/** Every http(s) URL in some markdown, markdown-link or bare. */
export function extractUrls(markdown: string): string[] {
  const found = new Set<string>();
  // Markdown links first so the label does not swallow the target.
  for (const match of String(markdown || '').matchAll(/\]\((https?:\/\/[^)\s]+)\)/gi)) {
    const normalised = normaliseSourceUrl(match[1] || '');
    if (normalised) found.add(normalised);
  }
  for (const match of String(markdown || '').matchAll(/(?<!\]\()\bhttps?:\/\/[^\s<>)"'\]]+/gi)) {
    // Trailing sentence punctuation is not part of the URL.
    const cleaned = (match[0] || '').replace(/[),.;:!?]+$/, '');
    const normalised = normaliseSourceUrl(cleaned);
    if (normalised) found.add(normalised);
  }
  return [...found];
}

async function upsertSource(env: Env, url: string) {
  let host = '';
  try {
    host = new URL(url).hostname;
  } catch {
    host = '';
  }
  const sourceId = id('source');
  // First writer wins the row; everyone else reads the existing id.
  await env.DB.prepare('INSERT OR IGNORE INTO sources (id, url, host) VALUES (?, ?, ?)')
    .bind(sourceId, url, host)
    .run();
  const row = await env.DB.prepare('SELECT id FROM sources WHERE url = ?').bind(url).first<{ id: string }>();
  return row?.id || sourceId;
}

async function linkSource(
  env: Env,
  sourceId: string,
  ideaId: string,
  where: { section?: string; contributionId?: string },
) {
  await env.DB.prepare(
    `INSERT OR IGNORE INTO source_links (id, source_id, idea_id, section, contribution_id)
     VALUES (?, ?, ?, ?, ?)`,
  )
    .bind(id('sourcelink'), sourceId, ideaId, where.section || '', where.contributionId || '')
    .run();
}

/**
 * Re-indexes the sources cited by a canonical document, per section.
 *
 * Called after a canonical write. Document links are replaced wholesale so a
 * link removed from the document stops being listed; contribution citations are
 * left alone, since a contribution is a historical record and its sources stay
 * cited by it.
 */
export async function syncDocumentSources(env: Env, idea: IdeaRow, body: string) {
  await env.DB.prepare("DELETE FROM source_links WHERE idea_id = ? AND contribution_id = ''")
    .bind(idea.id)
    .run();

  const chapters = ideaChapters(body, idea.title);
  const seen = new Set<string>();
  for (const chapter of chapters) {
    for (const url of extractUrls(chapter.markdown)) {
      seen.add(url);
      const sourceId = await upsertSource(env, url);
      await linkSource(env, sourceId, idea.id, { section: chapter.id });
    }
  }
  // Anything cited outside a section (a lead-in, for example) still counts.
  for (const url of extractUrls(body)) {
    if (seen.has(url)) continue;
    const sourceId = await upsertSource(env, url);
    await linkSource(env, sourceId, idea.id, {});
  }
}

/** Indexes the sources a single contribution cites. */
export async function syncContributionSources(
  env: Env,
  ideaId: string,
  contributionId: string,
  fields: { sourceUrl?: string; body?: string },
) {
  const urls = new Set<string>();
  const explicit = normaliseSourceUrl(fields.sourceUrl || '');
  if (explicit) urls.add(explicit);
  for (const url of extractUrls(fields.body || '')) urls.add(url);
  for (const url of urls) {
    const sourceId = await upsertSource(env, url);
    await linkSource(env, sourceId, ideaId, { contributionId });
  }
}

/** What an idea rests on, with where each source is cited. */
export async function listIdeaSources(env: Env, ideaId: string) {
  const rows = await env.DB.prepare(
    `SELECT s.id, s.url, s.host, s.status, s.last_checked,
            GROUP_CONCAT(DISTINCT l.section) AS sections,
            COUNT(DISTINCT l.contribution_id) AS contribution_citations
     FROM source_links l JOIN sources s ON s.id = l.source_id
     WHERE l.idea_id = ?
     GROUP BY s.id
     ORDER BY s.host ASC, s.url ASC`,
  )
    .bind(ideaId)
    .all<{
      id: string;
      url: string;
      host: string;
      status: number;
      last_checked: string;
      sections: string | null;
      contribution_citations: number;
    }>();
  return (rows.results || []).map((row) => ({
    ...row,
    sections: (row.sections || '').split(',').filter(Boolean),
    // COUNT counts the '' bucket too; only non-empty ids are real citations.
    contribution_citations: Math.max(0, row.contribution_citations - 1),
  }));
}

/** Reverse index: which ideas cite this source. */
export async function sourceCitations(env: Env, sourceId: string) {
  const source = await env.DB.prepare('SELECT id, url, host, status, last_checked FROM sources WHERE id = ?')
    .bind(sourceId)
    .first<{ id: string; url: string; host: string; status: number; last_checked: string }>();
  if (!source) return null;
  const rows = await env.DB.prepare(
    `SELECT l.idea_id, i.title, l.section, l.contribution_id
     FROM source_links l JOIN ideas i ON i.id = l.idea_id
     WHERE l.source_id = ? AND i.status != 'removed'
     ORDER BY i.title ASC`,
  )
    .bind(sourceId)
    .all<{ idea_id: string; title: string; section: string; contribution_id: string }>();
  return { source, citations: rows.results || [] };
}

/**
 * Checks the least-recently-checked sources and records the status.
 *
 * A research corpus decays silently otherwise: a citation that 404s still reads
 * as evidence. Bounded per run so the scheduled job stays cheap, and failures
 * are recorded rather than thrown — an unreachable host is a result, not an
 * error in the checker.
 */
export async function checkSources(env: Env, limit = 20) {
  const rows = await env.DB.prepare(
    `SELECT id, url FROM sources ORDER BY last_checked ASC, id ASC LIMIT ?`,
  )
    .bind(limit)
    .all<{ id: string; url: string }>();

  let checked = 0;
  let broken = 0;
  for (const row of rows.results || []) {
    let status = 0;
    try {
      // HEAD first: most hosts answer it and it avoids pulling the body.
      let response = await fetch(row.url, { method: 'HEAD', redirect: 'follow' });
      if (response.status === 405 || response.status === 501) {
        response = await fetch(row.url, { method: 'GET', redirect: 'follow' });
      }
      status = response.status;
    } catch {
      status = 0;
    }
    if (status === 0 || status >= 400) broken += 1;
    checked += 1;
    await env.DB.prepare('UPDATE sources SET status = ?, last_checked = CURRENT_TIMESTAMP WHERE id = ?')
      .bind(status, row.id)
      .run();
  }
  return { checked, broken };
}
