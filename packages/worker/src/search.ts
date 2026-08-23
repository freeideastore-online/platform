import { runInBatches, type SizedStatement } from './d1';
import { visibleIdeaChapters } from './markdown';
import type { Env, IdeaRow } from './types';

export type SearchHit = {
  idea_id: string;
  idea_title?: string;
  kind: string;
  ref: string;
  title: string;
  snippet: string;
  rank: number;
};

/**
 * Turns user input into an FTS5 MATCH expression.
 *
 * FTS5 treats a lot of punctuation as syntax, so raw input can be a syntax error
 * rather than a search. Terms are extracted and quoted, which also makes a
 * multi-word query an AND of phrases instead of an accidental operator.
 *
 * Returns null when there is nothing searchable, so callers can answer "no
 * query" instead of running a match that throws.
 */
export function toMatchQuery(raw: string): string | null {
  const terms = String(raw || '')
    .toLowerCase()
    .match(/[\p{L}\p{N}][\p{L}\p{N}'-]*/gu);
  if (!terms?.length) return null;
  // Quote each term so FTS5 never reads it as an operator.
  return terms
    .slice(0, 12)
    .map((term) => `"${term.replace(/"/g, '')}"`)
    .join(' ');
}

/**
 * Replaces a document's section rows. Called after every canonical write.
 *
 * The clear and the rows that replace it go out batched: one statement per
 * chapter awaited on its own was one subrequest per chapter, which a 100-chapter
 * document turns into 101 sequential round trips on the far side of a commit
 * that has already happened.
 */
export async function indexDocument(env: Env, idea: IdeaRow, body: string) {
  const statements: SizedStatement[] = [
    {
      statement: env.DB.prepare("DELETE FROM search_index WHERE idea_id = ? AND kind = 'section'").bind(idea.id),
    },
  ];
  for (const chapter of visibleIdeaChapters(body, idea.title)) {
    statements.push({
      statement: env.DB.prepare(
        `INSERT INTO search_index (title, text, idea_id, kind, ref) VALUES (?, ?, ?, 'section', ?)`,
      ).bind(`${idea.title} — ${chapter.title}`, chapter.markdown, idea.id, chapter.id),
      // Each row carries the chapter's full markdown, so the batch is cut on
      // payload as well as on statement count.
      chars: chapter.markdown.length,
    });
  }
  return runInBatches(env.DB, statements);
}

/** Indexes one research entry. Claim and prose are both searchable. */
export async function indexContribution(
  env: Env,
  ideaId: string,
  contributionId: string,
  fields: { claim?: string; body?: string; kind?: string },
) {
  const title = fields.claim || fields.kind || 'contribution';
  await env.DB.prepare(
    `INSERT INTO search_index (title, text, idea_id, kind, ref) VALUES (?, ?, ?, 'research', ?)`,
  )
    .bind(title, `${fields.claim || ''}\n${fields.body || ''}`.trim(), ideaId, contributionId)
    .run();
}

export async function removeIdeaFromIndex(env: Env, ideaId: string) {
  await env.DB.prepare('DELETE FROM search_index WHERE idea_id = ?').bind(ideaId).run();
}

/**
 * Searches documents and research.
 *
 * Ranking starts from bm25 and then demotes entries the record has moved past:
 * a superseded research entry is still findable, but should not outrank the
 * correction that replaced it. Low-confidence entries are nudged down for the
 * same reason.
 */
export async function search(
  env: Env,
  rawQuery: string,
  options: { ideaId?: string; limit?: number } = {},
) {
  const match = toMatchQuery(rawQuery);
  if (!match) return { query: rawQuery, hits: [] as SearchHit[] };
  const limit = Math.min(Math.max(options.limit || 20, 1), 50);

  const rows = await env.DB.prepare(
    `SELECT s.idea_id, s.kind, s.ref, s.title,
            snippet(search_index, 1, '<mark>', '</mark>', '…', 14) AS snippet,
            bm25(search_index, 4.0, 1.0) AS rank,
            i.title AS idea_title,
            c.confidence AS confidence,
            (SELECT x.id FROM contributions x WHERE x.supersedes = s.ref LIMIT 1) AS superseded_by
     FROM search_index s
     JOIN ideas i ON i.id = s.idea_id AND i.status != 'removed'
     LEFT JOIN contributions c ON c.id = s.ref AND s.kind = 'research'
     WHERE search_index MATCH ?
       ${options.ideaId ? 'AND s.idea_id = ?' : ''}
     ORDER BY rank
     LIMIT ?`,
  )
    .bind(...(options.ideaId ? [match, options.ideaId, limit * 2] : [match, limit * 2]))
    .all<SearchHit & { confidence?: string; superseded_by?: string | null }>();

  const hits = (rows.results || [])
    .map((row) => {
      // bm25 returns negative numbers, more negative being a better match.
      let rank = row.rank;
      if (row.superseded_by) rank += 2;
      if (row.confidence === 'low') rank += 0.5;
      return { ...row, rank, superseded: Boolean(row.superseded_by) };
    })
    .sort((a, b) => a.rank - b.rank)
    .slice(0, limit);

  return { query: rawQuery, match, hits };
}
