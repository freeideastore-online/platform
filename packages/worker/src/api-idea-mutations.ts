import { authUserFor, profileFor } from './auth';
import { contributorByHandle, ideaBody, ideaById, uniqueIdeaId } from './data';
import { bad, enumValue, FIELD_LIMITS, json, pathId, readJsonBody, slug, tooLong } from './http';
import {
  addIdeaSection,
  appendToIdeaSection,
  CHAPTER_SIZE,
  demoteHeadings,
  documentMetrics,
  mergeIdeaSections,
  moveIdeaSection,
  ideaSectionList,
  removeIdeaSection,
  renameIdeaSection,
  replaceIdeaSection,
} from './markdown';
import {
  listRefinements,
  markRefinementResolved,
  proposalText,
  refinementById,
  RESOLUTION_VALUES,
} from './refinements';
import { recordRevision, revisionBody, revisionById, type RevisionSource } from './revisions';
import { indexDocument, removeIdeaFromIndex } from './search';
import { syncDocumentSources } from './sources';
import type { Env, IdeaRow } from './types';

const IDEA_STAGES = new Set(['raw', 'shaping', 'researching', 'validating', 'prototyping', 'launched', 'pivot', 'parked']);
const IDEA_VISIBILITY = new Set(['public', 'unlisted']);

/**
 * Opt-in: push the supplied content below chapter level so the whole block
 * lands as ONE chapter.
 *
 * Off by default, because turning it on for everyone would re-level content
 * already written against the contract and move published chapter URLs. It has
 * to be asked for, which is the point — the caller who is writing a whole source
 * file into a section is the one who knows it is one chapter.
 */
function demoteRequested(input: Record<string, unknown>) {
  return input.demote_headings === true || input.demoteHeadings === true;
}

/**
 * How much of THIS write's content the budget can actually take.
 *
 * The naive answer — `FIELD_LIMITS.body - current.length` — is right only for
 * an append, because only an append leaves every character of the current
 * document in place. A `patch_idea_section` replace and a section merge also
 * FREE the outgoing section, so the allowance is measured against what the
 * write keeps, not against what the document held before it. Telling a replace
 * it "may add at most N more" when it is dropping a 40,000-character section
 * asks the author to trim content they never had to trim.
 *
 * `resulting` already reflects everything the write frees, so the outgoing
 * length never has to be threaded through the call sites:
 *
 *   allowance = incoming.length - (resulting.length - LIMIT)
 *
 * For an append that reduces to `LIMIT - current.length` (less the blank line
 * the join inserts). For a replace it reduces to `LIMIT - (current.length -
 * outgoing.length)`, which is the number the author needs. For a merge, where
 * nothing is contributed and content only moves, the write cannot grow the
 * document at all — so it can only overflow a document that was already over,
 * and `incoming` is absent and the message says so.
 */
function overflowAdvice(
  resulting: string,
  options: { current?: string; incoming?: string },
): string {
  const excess = resulting.length - FIELD_LIMITS.body;
  if (options.incoming !== undefined) {
    const allowance = Math.max(0, options.incoming.length - excess);
    return (
      `this write may contribute at most ${allowance} of its ${options.incoming.length} characters` +
      ` — ${excess} too many once what the document keeps is counted`
    );
  }
  if (options.current !== undefined && resulting.length <= options.current.length) {
    // A merge, move or removal: it did not grow the document, so the document
    // was already over budget before this edit and trimming this edit is not
    // the fix.
    return (
      `this edit does not grow the document — it is already ${options.current.length} characters` +
      ` and must lose at least ${options.current.length - FIELD_LIMITS.body}`
    );
  }
  return `trim at least ${excess} characters`;
}

/**
 * The free-tier document budget, checked in one place.
 *
 * Both ceilings are enforced here so a document cannot pass one write path and
 * fail another: creating, deriving, publishing, writing a section and applying
 * a refinement all end up with the same document, so they all owe the same
 * answer. Rejects, never truncates — see the note above FIELD_LIMITS; a silent
 * `.slice()` once destroyed the tail of four contributions.
 *
 * `current` is the document as it stands and `incoming` is the content this
 * write is contributing; only incremental writes pass them. A whole-document
 * publish replaces everything, so the actionable number there is simply how
 * much to trim. Reporting the wrong one is the failure in #46 — three agents
 * each had to overflow once and subtract from the error string to discover
 * ~41,800 characters of headroom.
 */
export function documentOverflow(
  body: string,
  title = '',
  options: { current?: string; incoming?: string } = {},
): string | null {
  if (body.length > FIELD_LIMITS.body) {
    return (
      `body is ${body.length} characters; the free limit is ${FIELD_LIMITS.body}` +
      ` (${overflowAdvice(body, options)})` +
      ' — move the overflow into a derived annex document, or take the document to Pro'
    );
  }
  const { chapters } = documentMetrics(body, title);
  if (chapters > FIELD_LIMITS.chapters) {
    return (
      `document would have ${chapters} chapters; the free limit is ${FIELD_LIMITS.chapters}` +
      ` — merge chapters under the ${CHAPTER_SIZE.floorWords}-word floor, or move a run of them` +
      ' into a derived annex document'
    );
  }
  return null;
}

/**
 * What the author could not see until a write failed: both budgets, what is
 * spent, what is left, and how many chapters are the wrong size. Returned by
 * every write that changes the document, so headroom is knowable before the
 * write that would overflow it rather than only after (#46), and a document
 * drifting into paragraph-per-page announces itself (#45). Exported because the
 * READ paths return it too — an author's first call of a session is a read, and
 * a second implementation of this block for them would be a second opinion.
 */
export type DocumentUsage = ReturnType<typeof documentUsage>;

export function documentUsage(
  body: string,
  metrics: { chapters: number; belowFloor: number; aboveCeiling: number },
) {
  return {
    chars: body.length,
    chars_remaining: Math.max(0, FIELD_LIMITS.body - body.length),
    chapters: metrics.chapters,
    chapters_remaining: Math.max(0, FIELD_LIMITS.chapters - metrics.chapters),
    below_floor: metrics.belowFloor,
    above_ceiling: metrics.aboveCeiling,
  };
}

export async function createIdea(request: Request, env: Env) {
  const parsedBody = await readJsonBody(request);
  if (!parsedBody.ok) return parsedBody.response;
  const input = parsedBody.data;
  const title = String(input.title || '').trim();
  const summary = String(input.summary || '').trim();
  if (title.length < 3 || summary.length < 10) return bad('title and summary are required');
  if (title.length > 80) return bad('title must be 80 characters or fewer — use summary for detail');

  const body = String(input.body || input.body_md || '').trim();
  const preview = String(input.preview || '');
  const signal = String(input.signal || '');
  const sourceUrl = String(input.sourceUrl || input.source_url || '');
  const category = String(input.category || 'uncategorized');
  const nextStep = String(input.nextStep || '');
  const risk = String(input.risk || '');
  const overflow = tooLong([
    ['summary', summary, FIELD_LIMITS.summary],
    ['preview', preview, FIELD_LIMITS.preview],
    ['signal', signal, FIELD_LIMITS.signal],
    ['source URL', sourceUrl, FIELD_LIMITS.sourceUrl],
    ['category', category, FIELD_LIMITS.category],
    ['next step', nextStep, FIELD_LIMITS.nextStep],
    ['risk', risk, FIELD_LIMITS.risk],
  ]);
  if (overflow) return bad(overflow);
  const budget = documentOverflow(body, title);
  if (budget) return bad(budget);

  const metrics = documentMetrics(body, title);
  const ideaId = await uniqueIdeaId(env, title);
  const profileId = await profileFor(request, env);
  const bodyKey = `ideas/${ideaId}/body.md`;
  let storedInR2 = false;
  if (body && env.IDEA_BUCKET) {
    try {
      await env.IDEA_BUCKET.put(bodyKey, body, {
        httpMetadata: { contentType: 'text/markdown;charset=UTF-8' },
      });
      storedInR2 = true;
    } catch {
      // Fall back to storing body inline in D1 if R2 write fails.
    }
  }
  await env.DB.prepare(
    `INSERT INTO ideas
     (id, title, summary, preview, signal, body_md, body_key, source_url, visibility, stage, category, next_step, risk, created_by, body_words, chapter_count)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      ideaId,
      title,
      summary,
      preview,
      signal,
      storedInR2 ? '' : body,
      storedInR2 ? bodyKey : '',
      sourceUrl,
      enumValue(input.visibility, IDEA_VISIBILITY, 'public'),
      enumValue(input.stage, IDEA_STAGES, 'raw'),
      category,
      nextStep,
      risk,
      profileId,
      metrics.words,
      metrics.chapters,
    )
    .run();
  return json({ idea: ideaId, url: `/ideas/${ideaId}/` }, { status: 201 });
}

export async function deriveIdea(request: Request, env: Env, rawParentId: string) {
  const parentId = pathId(rawParentId);
  if (!parentId) return bad('invalid idea id', 400);
  const parent = await ideaById(env, parentId);
  if (!parent) return bad('idea not found', 404);

  const parsedBody = await readJsonBody(request);
  if (!parsedBody.ok) return parsedBody.response;
  const input = parsedBody.data;
  const title = String(input.title || `${parent.title} (derived)`).trim();
  if (title.length < 3) return bad('title is required');
  if (title.length > 80) return bad('title must be 80 characters or fewer — use summary for detail');
  const summary = String(input.summary || parent.summary).trim();
  if (summary.length < 10) return bad('summary is required');

  const profileId = await profileFor(request, env);
  const ideaId = await uniqueIdeaId(env, title);
  // Seed the fork with the parent body unless a non-empty override is supplied.
  // (`??` alone would keep an explicit empty string and make a blank fork.)
  const bodyOverride = typeof input.body === 'string' && input.body.trim() ? input.body : null;
  const seedBody = String(bodyOverride ?? (await ideaBody(env, parent)));
  const parentPath = `/ideas/${parent.id}/`;
  const preview = String(input.preview || parent.preview || summary);
  const signal = String(input.signal || '');
  const sourceUrl = String(
    input.sourceUrl || input.source_url || `${new URL(request.url).origin}${parentPath}`,
  );
  const category = String(input.category || parent.category || 'uncategorized');
  const nextStep = String(input.nextStep || input.next_step || '');
  const risk = String(input.risk || '');
  const overflow = tooLong([
    ['summary', summary, FIELD_LIMITS.summary],
    ['preview', preview, FIELD_LIMITS.preview],
    ['signal', signal, FIELD_LIMITS.signal],
    ['source URL', sourceUrl, FIELD_LIMITS.sourceUrl],
    ['category', category, FIELD_LIMITS.category],
    ['next step', nextStep, FIELD_LIMITS.nextStep],
    ['risk', risk, FIELD_LIMITS.risk],
  ]);
  if (overflow) return bad(overflow);
  // A fork inherits the parent document, so an over-budget parent is caught
  // here rather than at the fork's first section write.
  const budget = documentOverflow(seedBody, title);
  if (budget) return bad(budget);
  const metrics = documentMetrics(seedBody, title);
  const bodyKey = `ideas/${ideaId}/body.md`;
  let storedInR2 = false;
  if (seedBody && env.IDEA_BUCKET) {
    try {
      await env.IDEA_BUCKET.put(bodyKey, seedBody, { httpMetadata: { contentType: 'text/markdown;charset=UTF-8' } });
      storedInR2 = true;
    } catch {
      // Fall back to storing body inline in D1 if R2 write fails.
    }
  }
  await env.DB.prepare(
    `INSERT INTO ideas
     (id, title, summary, preview, signal, body_md, body_key, source_url, visibility, stage, category, next_step, risk, created_by, parent_id, body_words, chapter_count)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      ideaId,
      title,
      summary,
      preview,
      signal,
      storedInR2 ? '' : seedBody,
      storedInR2 ? bodyKey : '',
      sourceUrl,
      enumValue(input.visibility, IDEA_VISIBILITY, 'public'),
      enumValue(input.stage, IDEA_STAGES, 'raw'),
      category,
      nextStep,
      risk,
      profileId,
      parent.id,
      metrics.words,
      metrics.chapters,
    )
    .run();
  return json({ idea: ideaId, url: `/ideas/${ideaId}/`, parent: parent.id, parentUrl: parentPath }, { status: 201 });
}

export async function deleteIdea(request: Request, env: Env, rawIdeaId: string) {
  const ideaId = pathId(rawIdeaId);
  if (!ideaId) return bad('invalid idea id', 400);
  const user = await authUserFor(request, env);
  if (!user) return json({ error: 'authentication required' }, { status: 401 });
  const profile = await contributorByHandle(env, user.handle);
  if (!profile) return json({ error: 'profile not found' }, { status: 403 });
  const idea = await ideaById(env, ideaId);
  if (!idea) return bad('idea not found', 404);
  if (idea.created_by !== profile.id) return json({ error: 'only the idea owner can delete this idea' }, { status: 403 });

  const parsedBody = await readJsonBody(request);
  if (!parsedBody.ok) return parsedBody.response;
  const input = parsedBody.data;
  const confirmTitle = String(input.confirmTitle || input.confirm_title || '').trim();
  if (!confirmTitle || (confirmTitle !== idea.title && confirmTitle !== idea.id)) {
    return bad('confirmation does not match idea title or id — send confirmTitle or confirm_title', 400);
  }

  await env.DB.prepare(
    `UPDATE ideas
     SET status = 'removed',
         updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
  )
    .bind(idea.id)
    .run();
  if (env.IDEA_BUCKET) {
    const bodyKey = idea.body_key || `ideas/${idea.id}/body.md`;
    await env.IDEA_BUCKET.delete(bodyKey).catch(() => undefined);
  }
  await removeIdeaFromIndex(env, idea.id);
  return json({ ok: true, idea: idea.id, status: 'removed' });
}

/**
 * Owner-only guard shared by the canonical write paths.
 * Returns the idea on success, or the Response to send back.
 */
async function ownedIdea(request: Request, env: Env, rawIdeaId: string): Promise<Response | IdeaRow> {
  const ideaId = pathId(rawIdeaId);
  if (!ideaId) return bad('invalid idea id', 400);
  const user = await authUserFor(request, env);
  if (!user) return json({ error: 'authentication required' }, { status: 401 });
  const profile = await contributorByHandle(env, user.handle);
  if (!profile) return json({ error: 'profile not found' }, { status: 403 });
  const idea = await ideaById(env, ideaId);
  if (!idea) return bad('idea not found', 404);
  if (idea.created_by !== profile.id) {
    return json({ error: 'only the idea owner can update the canonical document' }, { status: 403 });
  }
  return idea;
}

/**
 * Rebuilds the derived indexes for a document whose body has already committed.
 *
 * Everything here is derived: search rows and the source registry are functions
 * of the document, and the document is durable by the time this runs. So a
 * failure here must not fail the request. It used to: the two calls were awaited
 * bare on the far side of the `UPDATE`, and between them they issued one
 * subrequest per statement — 447 of them on the live `cellar-door-cycling`
 * document — so a D1 error or a subrequest ceiling turned a write that had
 * landed into a generic 500 (#71, and the leading explanation for #51).
 *
 * That is the expensive kind of failure: the obvious response to a 500 is to
 * retry, and retrying a merge that already applied is not safe. A stale index is
 * cheap by comparison — the next write to the document rebuilds it.
 *
 * It stays awaited rather than deferred to `ctx.waitUntil`. Callers read their
 * own writes: `list_idea_sources`, `/api/search` and the sources page are all
 * routinely hit immediately after an edit, and deferring the index would make
 * those reads race. Batching is what removes the cost; the guard is what removes
 * the failure mode.
 */
async function reindexAfterWrite(env: Env, idea: IdeaRow, body: string): Promise<boolean> {
  try {
    await syncDocumentSources(env, idea, body);
    await indexDocument(env, idea, body);
    return true;
  } catch (error) {
    // Logged, not swallowed: the index silently drifting is its own bug.
    console.error('post-commit reindex failed', idea.id, String(error));
    return false;
  }
}

/**
 * What a write says about an index it could not rebuild.
 *
 * Absent on the happy path, so a healthy response keeps its shape. When it is
 * present the caller can tell "the write did not happen" from "the write
 * happened and the index did not" — the exact ambiguity #51 is about — without
 * having to read a 500 and guess.
 */
function indexWarning(reindexed: boolean) {
  return reindexed
    ? {}
    : {
        reindexed: false,
        warning:
          'the document was saved; search and the source registry could not be updated and will catch up on the next write',
      };
}

/**
 * Persists a canonical body: R2 when bound, inline otherwise, and refreshes the
 * stored metrics the catalog reads.
 */
async function writeCanonicalBody(
  env: Env,
  idea: IdeaRow,
  body: string,
  title: string,
  revision: { previousBody: string; authorProfileId?: string; source: RevisionSource; section?: string; reason?: string },
) {
  // Snapshot what is about to be replaced, before replacing it. An unchanged
  // body is not a revision.
  let revisionId: string | null = null;
  if (revision.previousBody !== body) {
    revisionId = await recordRevision(env, idea, revision.previousBody, {
      authorProfileId: revision.authorProfileId,
      source: revision.source,
      section: revision.section,
      reason: revision.reason,
    });
  }
  const metrics = documentMetrics(body, title);
  const bodyKey = idea.body_key || `ideas/${idea.id}/body.md`;
  let storedInR2 = false;
  if (env.IDEA_BUCKET) {
    try {
      await env.IDEA_BUCKET.put(bodyKey, body, {
        httpMetadata: { contentType: 'text/markdown;charset=UTF-8' },
      });
      storedInR2 = true;
    } catch {
      // Fall back to storing the body inline in D1 if the R2 write fails.
    }
  }
  await env.DB.prepare(
    `UPDATE ideas
     SET body_md = ?, body_key = ?, body_words = ?, chapter_count = ?,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
  )
    .bind(
      storedInR2 ? '' : body,
      storedInR2 ? bodyKey : '',
      metrics.words,
      metrics.chapters,
      idea.id,
    )
    .run();
  // Re-index after the write so the registry and search reflect what is
  // published — but never at the cost of the write itself. See reindexAfterWrite.
  const reindexed = await reindexAfterWrite(env, idea, body);
  // Every canonical write reports the budget from the metrics it already
  // computed, so no two write paths can disagree about what is left.
  return { ...metrics, usage: documentUsage(body, metrics), revisionId, reindexed };
}

/**
 * Rewrites or extends a single section.
 *
 * Deepening a document used to require sending the whole thing back through
 * `publish_idea_update`, which cost O(document) tokens per edit and had to fit
 * in one request. That is why research accumulated as ten separate "RESEARCH LOG
 * n/10" contributions instead of landing in the document.
 */
export async function updateIdeaSection(
  request: Request,
  env: Env,
  rawIdeaId: string,
  rawSectionId: string,
  mode: 'replace' | 'append',
) {
  const sectionId = pathId(rawSectionId);
  if (!sectionId) return bad('invalid section id', 400);
  const owned = await ownedIdea(request, env, rawIdeaId);
  if (owned instanceof Response) return owned;
  const idea = owned;

  const parsedBody = await readJsonBody(request);
  if (!parsedBody.ok) return parsedBody.response;
  const input = parsedBody.data;
  const supplied = String(input.content ?? input.markdown ?? input.body ?? '');
  if (!supplied.trim()) return bad('section content is required');
  // Demote before anything measures the content: the budget accounting below
  // has to weigh what is actually written, and the demotion adds characters.
  const content = demoteRequested(input) ? demoteHeadings(supplied) : supplied;

  const current = await ideaBody(env, idea);
  const next =
    mode === 'append'
      ? appendToIdeaSection(current, sectionId, content, idea.title)
      : replaceIdeaSection(current, sectionId, content, idea.title);
  if (next === null) {
    return bad(
      `unknown section "${sectionId}" — read /api/ideas/${idea.id}/sections for the current list`,
      404,
    );
  }

  // `content` is what this write contributes; a replace also frees the section
  // it overwrites, and passing both is what lets the error account for it.
  const budget = documentOverflow(next, idea.title, { current, incoming: content });
  if (budget) return bad(budget);

  const result = await writeCanonicalBody(env, idea, next, idea.title, {
    previousBody: current,
    authorProfileId: idea.created_by,
    source: mode === 'append' ? 'section-append' : 'section-replace',
    section: sectionId,
    reason: String(input.reason || ''),
  });
  return json({
    ok: true,
    idea: idea.id,
    section: sectionId,
    mode,
    words: result.words,
    chapters: result.chapters,
    usage: result.usage,
    url: `/ideas/${idea.id}/`,
    ...indexWarning(result.reindexed),
  });
}

export async function updateIdea(request: Request, env: Env, rawIdeaId: string) {
  const ideaId = pathId(rawIdeaId);
  if (!ideaId) return bad('invalid idea id', 400);
  const user = await authUserFor(request, env);
  if (!user) return json({ error: 'authentication required' }, { status: 401 });
  const profile = await contributorByHandle(env, user.handle);
  if (!profile) return json({ error: 'profile not found' }, { status: 403 });
  const idea = await ideaById(env, ideaId);
  if (!idea) return bad('idea not found', 404);
  if (idea.created_by !== profile.id) return json({ error: 'only the idea owner can update the canonical document' }, { status: 403 });

  const parsedBody = await readJsonBody(request);
  if (!parsedBody.ok) return parsedBody.response;
  const input = parsedBody.data;
  const bodyInput = input.body ?? input.body_md;
  // Omitting `body` is a metadata-only update: every field the caller did send
  // is written and the canonical document is left exactly as it was. Without
  // this a document that had grown too large to resend could never have its own
  // summary corrected again (#33), which is the same trap section writes were
  // added to escape — the body scaled and the fields describing it did not.
  const bodyProvided = typeof bodyInput === 'string';
  const previousBody = await ideaBody(env, idea);
  const body = bodyProvided ? bodyInput.trim() : previousBody;
  const title = String(input.title || idea.title).trim();
  const summary = String(input.summary || idea.summary).trim();
  const preview = String(input.preview ?? idea.preview ?? '');
  const signal = String(input.signal ?? idea.signal ?? '');
  const sourceUrl = String(input.sourceUrl || input.source_url || idea.source_url || '');
  const category = String(input.category || idea.category || 'uncategorized');
  const nextStep = String(input.nextStep || input.next_step || idea.next_step || '');
  const risk = String(input.risk || idea.risk || '');
  if (title.length > FIELD_LIMITS.title) {
    return bad('title must be 80 characters or fewer — use summary for detail');
  }
  const overflow = tooLong([
    ['summary', summary, FIELD_LIMITS.summary],
    ['preview', preview, FIELD_LIMITS.preview],
    ['signal', signal, FIELD_LIMITS.signal],
    // The body is deliberately absent from this list. `documentOverflow` below
    // supersedes it: it checks the character cap AND the chapter cap, and its
    // message carries the remaining headroom and the overflow path. Both guards
    // are gated on `bodyProvided` for the same reason — measuring a document
    // nobody is rewriting would make an over-cap document permanently
    // unmaintainable, which is #33.
    ['source URL', sourceUrl, FIELD_LIMITS.sourceUrl],
    ['category', category, FIELD_LIMITS.category],
    ['next step', nextStep, FIELD_LIMITS.nextStep],
    ['risk', risk, FIELD_LIMITS.risk],
  ]);
  if (overflow) return bad(overflow);
  // Only check the document budget when the document is actually being
  // written. When `body` is omitted this call is a metadata-only update and
  // `body` is just the stored document read back — measuring THAT against the
  // cap would make a document which is already at or over the limit
  // permanently undescribable, which is the whole complaint in #33.
  //
  // A publish replaces the whole document, so no `current` — the actionable
  // number is what to trim, not what may still be added.
  if (bodyProvided) {
    const budget = documentOverflow(body, title);
    if (budget) return bad(budget);
  }
  const metrics = documentMetrics(body, title);
  // publish_idea_update replaces the whole document; keep what it replaced.
  if (bodyProvided && body !== previousBody) {
    await recordRevision(env, idea, previousBody, {
      authorProfileId: profile.id,
      source: 'update',
      reason: String(input.reason || ''),
    });
  }
  const bodyKey = idea.body_key || `ideas/${idea.id}/body.md`;
  let storedInR2 = false;
  // A metadata-only update does not touch object storage at all. Rewriting the
  // document with a copy of itself would be a no-op at best, and at worst — when
  // the R2 object is missing and `ideaBody` has fallen back to a placeholder —
  // would overwrite a document with that placeholder for the sake of editing a
  // one-line summary.
  if (bodyProvided && env.IDEA_BUCKET) {
    try {
      await env.IDEA_BUCKET.put(bodyKey, body, {
        httpMetadata: { contentType: 'text/markdown;charset=UTF-8' },
      });
      storedInR2 = true;
    } catch {
      // Fall back to storing body inline in D1 if R2 write fails.
    }
  }
  // Where the body lives, and how big it is, are the document's business. On a
  // metadata-only update they carry over untouched rather than being recomputed.
  const bodyColumns = bodyProvided
    ? {
        bodyMd: storedInR2 ? '' : body,
        bodyKey: storedInR2 ? bodyKey : '',
        words: metrics.words,
        chapters: metrics.chapters,
      }
    : {
        bodyMd: idea.body_md ?? '',
        bodyKey: idea.body_key ?? '',
        words: idea.body_words ?? metrics.words,
        chapters: idea.chapter_count ?? metrics.chapters,
      };

  await env.DB.prepare(
    `UPDATE ideas
     SET title = ?,
         summary = ?,
         preview = ?,
         signal = ?,
         body_md = ?,
         body_key = ?,
         source_url = ?,
         visibility = ?,
         stage = ?,
         category = ?,
         next_step = ?,
         risk = ?,
         body_words = ?,
         chapter_count = ?,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
  )
    .bind(
      title,
      summary,
      preview,
      signal,
      bodyColumns.bodyMd,
      bodyColumns.bodyKey,
      sourceUrl,
      enumValue(input.visibility ?? idea.visibility, IDEA_VISIBILITY, 'public'),
      enumValue(input.stage ?? idea.stage, IDEA_STAGES, idea.stage || 'raw'),
      category,
      nextStep,
      risk,
      bodyColumns.words,
      bodyColumns.chapters,
      idea.id,
    )
    .run();

  const reindexed = await reindexAfterWrite(env, idea, body);
  return json({
    ok: true,
    idea: idea.id,
    usage: documentUsage(body, metrics),
    url: `/ideas/${idea.id}/`,
    ...indexWarning(reindexed),
  });
}

export async function promoteIdea(request: Request, env: Env, rawIdeaId: string) {
  const ideaId = pathId(rawIdeaId);
  if (!ideaId) return bad('invalid idea id', 400);
  const user = await authUserFor(request, env);
  if (!user) return json({ error: 'authentication required' }, { status: 401 });
  const profile = await contributorByHandle(env, user.handle);
  if (!profile) return json({ error: 'profile not found' }, { status: 403 });
  const idea = await ideaById(env, ideaId);
  if (!idea) return bad('idea not found', 404);
  if (idea.created_by !== profile.id) return json({ error: 'only the idea owner can promote this idea' }, { status: 403 });
  await env.DB.prepare(
    `UPDATE ideas
     SET pro_candidate = 1, stage = CASE WHEN stage = 'raw' THEN 'researching' ELSE stage END, updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
  )
    .bind(idea.id)
    .run();
  return json({
    ok: true,
    proCandidate: idea.id,
    proDossierDraft: {
      sourceIdeaId: idea.id,
      title: idea.title,
      summary: idea.summary,
      buyer: '',
      evidence: idea.signal || idea.preview || '',
      missing: idea.risk || 'Diligence gap not yet named.',
      assets: ['free idea page', 'contributor history'],
    },
  });
}

/**
 * Restores a past revision as the current document.
 *
 * The restore is itself a canonical write, so the state it replaces is
 * snapshotted too — reverting is undoable.
 */
export async function revertIdeaToRevision(
  request: Request,
  env: Env,
  rawIdeaId: string,
  rawRevisionId: string,
) {
  const owned = await ownedIdea(request, env, rawIdeaId);
  if (owned instanceof Response) return owned;
  const idea = owned;

  const revision = await revisionById(env, idea.id, rawRevisionId);
  if (!revision) return bad('revision not found', 404);
  const body = await revisionBody(env, revision);
  if (!body.trim()) return bad('revision has no stored body', 409);

  const current = await ideaBody(env, idea);
  if (current === body) {
    return json({ ok: true, idea: idea.id, revision: revision.id, note: 'already at this revision' });
  }

  const metrics = await writeCanonicalBody(env, idea, body, idea.title, {
    previousBody: current,
    authorProfileId: idea.created_by,
    source: 'revert',
    reason: `revert to ${revision.id}`,
  });
  return json({
    ok: true,
    idea: idea.id,
    revision: revision.id,
    words: metrics.words,
    chapters: metrics.chapters,
    url: `/ideas/${idea.id}/`,
    ...indexWarning(metrics.reindexed),
  });
}

/**
 * Applies a queued refinement to its target section and closes it.
 *
 * The platform does not try to merge prose on the author's behalf: pass
 * `content` to control the exact wording. Without it the proposal text is
 * appended verbatim, which is the honest default — it is what the proposer
 * wrote. Either way the resolution records the revision it produced, so the
 * queue and document history are linked.
 */
export async function applyRefinement(
  request: Request,
  env: Env,
  rawIdeaId: string,
  rawContributionId: string,
) {
  const owned = await ownedIdea(request, env, rawIdeaId);
  if (owned instanceof Response) return owned;
  const idea = owned;

  const refinement = await refinementById(env, idea.id, rawContributionId);
  if (!refinement) return bad('refinement not found on this idea', 404);
  if (refinement.status) {
    return bad(`refinement is already ${refinement.status}`, 409);
  }

  const parsedBody = await readJsonBody(request);
  if (!parsedBody.ok) return parsedBody.response;
  const input = parsedBody.data;
  const section = String(input.section || refinement.section || '').trim();
  if (!section) {
    return bad('no target section — the proposal does not name one, so pass `section`');
  }
  const mode = String(input.mode || 'append') === 'replace' ? 'replace' : 'append';
  const content = String(input.content || proposalText(String(refinement.body || ''))).trim();
  if (!content) return bad('nothing to apply: the proposal is empty');

  const current = await ideaBody(env, idea);
  const next =
    mode === 'replace'
      ? replaceIdeaSection(current, section, content, idea.title)
      : appendToIdeaSection(current, section, content, idea.title);
  if (next === null) {
    return bad(
      `unknown section "${section}" — read /api/ideas/${idea.id}/sections for the current list`,
      404,
    );
  }

  const budget = documentOverflow(next, idea.title, { current, incoming: content });
  if (budget) return bad(budget);

  const result = await writeCanonicalBody(env, idea, next, idea.title, {
    previousBody: current,
    authorProfileId: idea.created_by,
    source: mode === 'replace' ? 'section-replace' : 'section-append',
    section,
    reason: `applied refinement ${refinement.id}`,
  });
  await markRefinementResolved(
    env,
    refinement.id,
    'applied',
    String(input.note || ''),
    result.revisionId || '',
  );

  return json({
    ok: true,
    idea: idea.id,
    refinement: refinement.id,
    section,
    mode,
    revision: result.revisionId,
    words: result.words,
    usage: result.usage,
    url: `/ideas/${idea.id}/`,
    ...indexWarning(result.reindexed),
  });
}

/**
 * Closes a refinement without applying it, so the queue drains and the record
 * says why rather than leaving a proposal open forever.
 */
export async function resolveRefinement(
  request: Request,
  env: Env,
  rawIdeaId: string,
  rawContributionId: string,
) {
  const owned = await ownedIdea(request, env, rawIdeaId);
  if (owned instanceof Response) return owned;
  const idea = owned;

  const refinement = await refinementById(env, idea.id, rawContributionId);
  if (!refinement) return bad('refinement not found on this idea', 404);
  if (refinement.status) return bad(`refinement is already ${refinement.status}`, 409);

  const parsedBody = await readJsonBody(request);
  if (!parsedBody.ok) return parsedBody.response;
  const input = parsedBody.data;
  const status = String(input.status || '').trim().toLowerCase();
  if (status === 'applied') {
    return bad('use the apply endpoint to mark a refinement applied, so it is tied to a revision');
  }
  if (!RESOLUTION_VALUES.has(status)) {
    return bad(`status must be one of ${[...RESOLUTION_VALUES].join(', ')}`);
  }
  const reason = String(input.reason || '').trim();
  if (!reason) return bad('a reason is required so the record says why');

  await markRefinementResolved(env, refinement.id, status, reason);
  return json({ ok: true, idea: idea.id, refinement: refinement.id, status, reason });
}

export async function handleListRefinements(env: Env, rawIdeaId: string, url: URL) {
  const ideaId = pathId(rawIdeaId);
  if (!ideaId) return bad('invalid idea id', 400);
  const idea = await ideaById(env, ideaId);
  if (!idea) return bad('idea not found', 404);
  const scopeParam = url.searchParams.get('status') || 'open';
  const scope = scopeParam === 'resolved' || scopeParam === 'all' ? scopeParam : 'open';
  return json({ idea: idea.id, status: scope, refinements: await listRefinements(env, idea.id, scope) });
}

/**
 * Applies a structural edit and persists it as a canonical write.
 *
 * Structure changes are ordinary canonical writes, so revisions make them
 * recoverable and sources/search re-index automatically. `compute` returns null
 * when a referenced section does not exist, which becomes a 404 rather than a
 * silently wrong document.
 */
async function writeStructuralEdit(
  request: Request,
  env: Env,
  rawIdeaId: string,
  reason: string,
  compute: (body: string, idea: IdeaRow, input: Record<string, unknown>) => string | null,
) {
  const owned = await ownedIdea(request, env, rawIdeaId);
  if (owned instanceof Response) return owned;
  const idea = owned;

  const parsedBody = await readJsonBody(request);
  if (!parsedBody.ok) return parsedBody.response;
  const input = parsedBody.data;

  const current = await ideaBody(env, idea);
  const next = compute(current, idea, input);
  if (next === null) {
    return bad(
      `structural edit could not be applied — read /api/ideas/${idea.id}/sections for the current list`,
      404,
    );
  }
  // Only `add section` contributes author text; a merge, move, rename or
  // removal reshapes what is already there, and passing an empty `incoming` for
  // those would advertise an allowance of zero on a write that adds nothing.
  const incoming = typeof input.content === 'string' && input.content ? input.content : undefined;
  const budget = documentOverflow(next, idea.title, { current, incoming });
  if (budget) return bad(budget);
  if (next === current) {
    return json({ ok: true, idea: idea.id, note: 'no change' });
  }

  const result = await writeCanonicalBody(env, idea, next, idea.title, {
    previousBody: current,
    authorProfileId: idea.created_by,
    source: 'section-structure',
    reason,
  });
  return json({
    ok: true,
    idea: idea.id,
    revision: result.revisionId,
    sections: ideaSectionList(next, idea.title),
    usage: result.usage,
    url: `/ideas/${idea.id}/`,
    ...indexWarning(result.reindexed),
  });
}

export function createIdeaSection(request: Request, env: Env, rawIdeaId: string) {
  return writeStructuralEdit(request, env, rawIdeaId, 'add section', (body, idea, input) => {
    const title = String(input.title || '').trim();
    if (!title) return null;
    const supplied = String(input.content || '');
    return addIdeaSection(body, title, demoteRequested(input) ? demoteHeadings(supplied) : supplied, {
      after: String(input.after || '') || undefined,
      before: String(input.before || '') || undefined,
      documentTitle: idea.title,
    });
  });
}

/** Rename and/or move in one call, since restructuring usually does both. */
export function editIdeaSection(request: Request, env: Env, rawIdeaId: string, rawSectionId: string) {
  return writeStructuralEdit(request, env, rawIdeaId, `edit section ${rawSectionId}`, (body, idea, input) => {
    const sectionId = pathId(rawSectionId);
    if (!sectionId) return null;
    let next: string | null = body;
    const title = String(input.title || '').trim();
    if (title) {
      next = renameIdeaSection(next, sectionId, title, idea.title);
      if (next === null) return null;
    }
    const after = String(input.after || '').trim();
    const before = String(input.before || '').trim();
    if (after || before) {
      // A rename changes the id, so move the section under its new handle.
      const movedId = title ? slug(title) || sectionId : sectionId;
      next = moveIdeaSection(next, movedId, {
        after: after || undefined,
        before: before || undefined,
        documentTitle: idea.title,
      });
    }
    return next;
  });
}

export function deleteIdeaSection(request: Request, env: Env, rawIdeaId: string, rawSectionId: string) {
  return writeStructuralEdit(request, env, rawIdeaId, `remove section ${rawSectionId}`, (body, idea) => {
    const sectionId = pathId(rawSectionId);
    return sectionId ? removeIdeaSection(body, sectionId, idea.title) : null;
  });
}

export function mergeIdeaSection(request: Request, env: Env, rawIdeaId: string, rawSectionId: string) {
  return writeStructuralEdit(request, env, rawIdeaId, `merge section ${rawSectionId}`, (body, idea, input) => {
    const from = pathId(rawSectionId);
    const into = String(input.into || '').trim();
    return from && into ? mergeIdeaSections(body, from, into, idea.title) : null;
  });
}
