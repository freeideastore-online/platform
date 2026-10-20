import type { Env } from './types';

/**
 * Where an idea's canonical body is stored, and how a write commits to it
 * without overwriting a write it did not see (#106).
 *
 * Two things made concurrent writes lose content:
 *
 * 1. Every write was read-modify-write with no version check, so two writes
 *    that read the same body both committed, and the second won outright.
 * 2. Every write put its body to the same R2 key, `ideas/<id>/body.md`. Even a
 *    write that lost a version check would already have replaced the winner's
 *    object, because the object is written before the row.
 *
 * So each version of a body goes to an object of its own, and the row is swung
 * to it only if the row is still at the version the write read. The losing
 * write's object is discarded; the winner's is never touched.
 */

/** How many times a write is re-applied to a fresh read before it gives up. */
export const BODY_WRITE_ATTEMPTS = 3;

/** Where one stored version of a body lives: an object, or inline in the row. */
export type StoredBody = { bodyMd: string; bodyKey: string };

/** A fresh, never-reused object key for one version of an idea's body. */
export function bodyObjectKey(ideaId: string) {
  return `ideas/${ideaId}/body/${crypto.randomUUID()}.md`;
}

/**
 * Was this key written by `bodyObjectKey()`? Those objects are written once and
 * never again, so once a version is superseded its object is a faithful,
 * permanent copy of that version — and the revision recording it can point at
 * it instead of copying it. The legacy shared key `ideas/<id>/body.md` was
 * overwritten in place, so it never qualifies.
 */
export function isImmutableBodyKey(ideaId: string, key: string | null | undefined): key is string {
  return Boolean(key && key.startsWith(`ideas/${ideaId}/body/`));
}

/**
 * Writes a body to an object of its own, or inline when R2 is unbound or
 * refuses the write — the same fallback every write path already had.
 */
export async function storeBody(env: Env, ideaId: string, body: string): Promise<StoredBody> {
  if (!body || !env.IDEA_BUCKET) return { bodyMd: body, bodyKey: '' };
  const key = bodyObjectKey(ideaId);
  try {
    await env.IDEA_BUCKET.put(key, body, { httpMetadata: { contentType: 'text/markdown;charset=UTF-8' } });
    return { bodyMd: '', bodyKey: key };
  } catch {
    return { bodyMd: body, bodyKey: '' };
  }
}

/** Removes a stored body nobody will reference — the loser of a race. */
export async function discardStoredBody(env: Env, stored: StoredBody) {
  if (!stored.bodyKey || !env.IDEA_BUCKET) return;
  await env.IDEA_BUCKET.delete(stored.bodyKey).catch(() => undefined);
}

/**
 * Swings the idea row to a stored body if, and only if, the row is still at
 * `expectedVersion`, and bumps the version. Returns the new version, or null
 * when another write committed first — in which case nothing was changed.
 */
export async function commitBody(
  env: Env,
  ideaId: string,
  expectedVersion: number,
  stored: StoredBody,
  metrics: { words: number; chapters: number },
): Promise<number | null> {
  const result = await env.DB.prepare(
    `UPDATE ideas
     SET body_md = ?, body_key = ?, body_words = ?, chapter_count = ?,
         body_version = body_version + 1,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = ? AND body_version = ?`,
  )
    .bind(stored.bodyMd, stored.bodyKey, metrics.words, metrics.chapters, ideaId, expectedVersion)
    .run();
  // Fail closed: a result that does not say a row changed is not a commit.
  return (result?.meta?.changes ?? 0) > 0 ? expectedVersion + 1 : null;
}
