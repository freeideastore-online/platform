import { id } from './http';
import { documentMetrics } from './markdown';
import type { Env, IdeaRow } from './types';

export type RevisionRow = {
  id: string;
  idea_id: string;
  body_md?: string;
  body_key?: string;
  body_words: number;
  chapter_count: number;
  author_profile_id: string;
  source: string;
  section: string;
  reason: string;
  created_at: string;
};

/** What kind of write produced a revision. */
export type RevisionSource =
  | 'update'
  | 'section-replace'
  | 'section-append'
  | 'section-structure'
  | 'revert';

/**
 * Records the document being replaced, before it is overwritten.
 *
 * Snapshotting the *previous* body rather than the new one means the state
 * before any write is always recoverable, including the first write to a
 * document that had no history. The live row stays the head of the timeline.
 *
 * Never throws: losing a revision must not fail the write the author asked for.
 * Returns the revision id, or null if nothing was recorded.
 */
export async function recordRevision(
  env: Env,
  idea: IdeaRow,
  previousBody: string,
  options: { authorProfileId?: string; source: RevisionSource; section?: string; reason?: string },
): Promise<string | null> {
  if (!previousBody.trim()) return null;
  const revisionId = id('revision');
  const metrics = documentMetrics(previousBody, idea.title);
  const bodyKey = `ideas/${idea.id}/revisions/${revisionId}.md`;
  let storedInR2 = false;
  try {
    if (env.IDEA_BUCKET) {
      await env.IDEA_BUCKET.put(bodyKey, previousBody, {
        httpMetadata: { contentType: 'text/markdown;charset=UTF-8' },
      });
      storedInR2 = true;
    }
    await env.DB.prepare(
      `INSERT INTO idea_revisions
       (id, idea_id, body_md, body_key, body_words, chapter_count, author_profile_id, source, section, reason)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        revisionId,
        idea.id,
        storedInR2 ? '' : previousBody,
        storedInR2 ? bodyKey : '',
        metrics.words,
        metrics.chapters,
        options.authorProfileId || '',
        options.source,
        options.section || '',
        options.reason || '',
      )
      .run();
    return revisionId;
  } catch {
    // A failed snapshot must not block the author's write.
    return null;
  }
}

export async function listRevisions(env: Env, ideaId: string, limit = 50) {
  const rows = await env.DB.prepare(
    `SELECT r.id, r.idea_id, r.body_words, r.chapter_count, r.source, r.section, r.reason, r.created_at,
            p.handle, p.display_name
     FROM idea_revisions r
     LEFT JOIN profiles p ON p.id = r.author_profile_id
     WHERE r.idea_id = ?
     ORDER BY r.created_at DESC, r.id DESC
     LIMIT ?`,
  )
    .bind(ideaId, limit)
    .all<RevisionRow & { handle?: string; display_name?: string }>();
  return rows.results || [];
}

export async function revisionById(env: Env, ideaId: string, revisionId: string) {
  return env.DB.prepare('SELECT * FROM idea_revisions WHERE id = ? AND idea_id = ?')
    .bind(revisionId, ideaId)
    .first<RevisionRow>();
}

/** The revision's markdown, from R2 when that is where it went. */
export async function revisionBody(env: Env, revision: RevisionRow) {
  if (revision.body_key && env.IDEA_BUCKET) {
    const object = await env.IDEA_BUCKET.get(revision.body_key);
    if (object) return object.text();
  }
  return revision.body_md || '';
}

export type DiffLine = { type: 'context' | 'added' | 'removed'; text: string };

/**
 * Line diff over an LCS table, so unchanged lines are recognised as unchanged
 * rather than reported as a delete plus an insert. Documents here are thousands
 * of lines at most, which the quadratic table handles comfortably.
 */
export function diffLines(before: string, after: string): DiffLine[] {
  const a = before.split(/\r?\n/);
  const b = after.split(/\r?\n/);
  // lengths[i][j] = LCS length of a[i..] and b[j..]
  const lengths: number[][] = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      const row = lengths[i];
      const nextRow = lengths[i + 1];
      if (!row || !nextRow) continue;
      row[j] = a[i] === b[j] ? (nextRow[j + 1] ?? 0) + 1 : Math.max(nextRow[j] ?? 0, row[j + 1] ?? 0);
    }
  }

  const diff: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      diff.push({ type: 'context', text: a[i] ?? '' });
      i += 1;
      j += 1;
      continue;
    }
    const down = lengths[i + 1]?.[j] ?? 0;
    const right = lengths[i]?.[j + 1] ?? 0;
    if (down >= right) {
      diff.push({ type: 'removed', text: a[i] ?? '' });
      i += 1;
    } else {
      diff.push({ type: 'added', text: b[j] ?? '' });
      j += 1;
    }
  }
  while (i < a.length) {
    diff.push({ type: 'removed', text: a[i] ?? '' });
    i += 1;
  }
  while (j < b.length) {
    diff.push({ type: 'added', text: b[j] ?? '' });
    j += 1;
  }
  return diff;
}

export function diffSummary(before: string, after: string) {
  const lines = diffLines(before, after);
  return {
    added: lines.filter((line) => line.type === 'added').length,
    removed: lines.filter((line) => line.type === 'removed').length,
    // Context lines are dropped from the payload; callers wanting the full text
    // can read both revisions.
    changes: lines.filter((line) => line.type !== 'context'),
  };
}
