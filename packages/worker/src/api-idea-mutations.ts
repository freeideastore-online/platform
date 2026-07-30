import { authUserFor, profileFor } from './auth';
import { contributorByHandle, ideaBody, ideaById, uniqueIdeaId } from './data';
import { bad, bodyJson, enumValue, FIELD_LIMITS, json, pathId, tooLong } from './http';
import { appendToIdeaSection, documentMetrics, replaceIdeaSection } from './markdown';
import {
  listRefinements,
  markRefinementResolved,
  proposalText,
  refinementById,
  RESOLUTION_VALUES,
} from './refinements';
import { recordRevision, revisionBody, revisionById, type RevisionSource } from './revisions';
import type { Env, IdeaRow } from './types';

const IDEA_STAGES = new Set(['raw', 'shaping', 'researching', 'validating', 'prototyping', 'launched', 'pivot', 'parked']);
const IDEA_VISIBILITY = new Set(['public', 'unlisted']);

export async function createIdea(request: Request, env: Env) {
  const input = await bodyJson(request);
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
    ['body', body, FIELD_LIMITS.body],
    ['source URL', sourceUrl, FIELD_LIMITS.sourceUrl],
    ['category', category, FIELD_LIMITS.category],
    ['next step', nextStep, FIELD_LIMITS.nextStep],
    ['risk', risk, FIELD_LIMITS.risk],
  ]);
  if (overflow) return bad(overflow);

  const metrics = documentMetrics(body, title);
  const ideaId = await uniqueIdeaId(env, title);
  const profileId = await profileFor(request, env);
  const bodyKey = `ideas/${ideaId}/body.md`;
  const renderKey = `ideas/${ideaId}/rendered.html`;
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
     (id, title, summary, preview, signal, body_md, body_key, render_key, source_url, visibility, stage, category, next_step, risk, created_by, body_words, chapter_count)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      ideaId,
      title,
      summary,
      preview,
      signal,
      storedInR2 ? '' : body,
      storedInR2 ? bodyKey : '',
      storedInR2 ? renderKey : '',
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

  const input = await bodyJson(request);
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
    ['body', seedBody, FIELD_LIMITS.body],
    ['source URL', sourceUrl, FIELD_LIMITS.sourceUrl],
    ['category', category, FIELD_LIMITS.category],
    ['next step', nextStep, FIELD_LIMITS.nextStep],
    ['risk', risk, FIELD_LIMITS.risk],
  ]);
  if (overflow) return bad(overflow);
  const metrics = documentMetrics(seedBody, title);
  const bodyKey = `ideas/${ideaId}/body.md`;
  const renderKey = `ideas/${ideaId}/rendered.html`;
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
     (id, title, summary, preview, signal, body_md, body_key, render_key, source_url, visibility, stage, category, next_step, risk, created_by, parent_id, body_words, chapter_count)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      ideaId,
      title,
      summary,
      preview,
      signal,
      storedInR2 ? '' : seedBody,
      storedInR2 ? bodyKey : '',
      storedInR2 ? renderKey : '',
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
  const user = await authUserFor(request);
  if (!user) return json({ error: 'authentication required' }, { status: 401 });
  const profile = await contributorByHandle(env, user.handle);
  if (!profile) return json({ error: 'profile not found' }, { status: 403 });
  const idea = await ideaById(env, ideaId);
  if (!idea) return bad('idea not found', 404);
  if (idea.created_by !== profile.id) return json({ error: 'only the idea owner can delete this idea' }, { status: 403 });

  const input = await bodyJson(request);
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
    const renderKey = idea.render_key || `ideas/${idea.id}/rendered.html`;
    await Promise.all([
      env.IDEA_BUCKET.delete(bodyKey).catch(() => undefined),
      env.IDEA_BUCKET.delete(renderKey).catch(() => undefined),
    ]);
  }
  return json({ ok: true, idea: idea.id, status: 'removed' });
}

/**
 * Owner-only guard shared by the canonical write paths.
 * Returns the idea on success, or the Response to send back.
 */
async function ownedIdea(request: Request, env: Env, rawIdeaId: string): Promise<Response | IdeaRow> {
  const ideaId = pathId(rawIdeaId);
  if (!ideaId) return bad('invalid idea id', 400);
  const user = await authUserFor(request);
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
  const renderKey = idea.render_key || `ideas/${idea.id}/rendered.html`;
  let storedInR2 = false;
  if (env.IDEA_BUCKET) {
    try {
      await env.IDEA_BUCKET.put(bodyKey, body, {
        httpMetadata: { contentType: 'text/markdown;charset=UTF-8' },
      });
      storedInR2 = true;
      await env.IDEA_BUCKET.delete(renderKey).catch(() => undefined);
    } catch {
      // Fall back to storing the body inline in D1 if the R2 write fails.
    }
  }
  await env.DB.prepare(
    `UPDATE ideas
     SET body_md = ?, body_key = ?, render_key = ?, body_words = ?, chapter_count = ?,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
  )
    .bind(
      storedInR2 ? '' : body,
      storedInR2 ? bodyKey : '',
      storedInR2 ? renderKey : '',
      metrics.words,
      metrics.chapters,
      idea.id,
    )
    .run();
  return { ...metrics, revisionId };
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

  const input = await bodyJson(request);
  const content = String(input.content ?? input.markdown ?? input.body ?? '');
  if (!content.trim()) return bad('section content is required');

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

  const overflow = tooLong([['body', next, FIELD_LIMITS.body]]);
  if (overflow) return bad(overflow);

  const metrics = await writeCanonicalBody(env, idea, next, idea.title, {
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
    words: metrics.words,
    chapters: metrics.chapters,
    url: `/ideas/${idea.id}/`,
  });
}

export async function updateIdea(request: Request, env: Env, rawIdeaId: string) {
  const ideaId = pathId(rawIdeaId);
  if (!ideaId) return bad('invalid idea id', 400);
  const user = await authUserFor(request);
  if (!user) return json({ error: 'authentication required' }, { status: 401 });
  const profile = await contributorByHandle(env, user.handle);
  if (!profile) return json({ error: 'profile not found' }, { status: 403 });
  const idea = await ideaById(env, ideaId);
  if (!idea) return bad('idea not found', 404);
  if (idea.created_by !== profile.id) return json({ error: 'only the idea owner can update the canonical document' }, { status: 403 });

  const input = await bodyJson(request);
  const bodyInput = input.body ?? input.body_md;
  const previousBody = await ideaBody(env, idea);
  const body = typeof bodyInput === 'string' ? bodyInput.trim() : previousBody;
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
    ['body', body, FIELD_LIMITS.body],
    ['source URL', sourceUrl, FIELD_LIMITS.sourceUrl],
    ['category', category, FIELD_LIMITS.category],
    ['next step', nextStep, FIELD_LIMITS.nextStep],
    ['risk', risk, FIELD_LIMITS.risk],
  ]);
  if (overflow) return bad(overflow);
  const metrics = documentMetrics(body, title);
  // publish_idea_update replaces the whole document; keep what it replaced.
  if (body !== previousBody) {
    await recordRevision(env, idea, previousBody, {
      authorProfileId: profile.id,
      source: 'update',
      reason: String(input.reason || ''),
    });
  }
  const bodyKey = idea.body_key || `ideas/${idea.id}/body.md`;
  const renderKey = idea.render_key || `ideas/${idea.id}/rendered.html`;
  let storedInR2 = false;
  if (env.IDEA_BUCKET) {
    try {
      await env.IDEA_BUCKET.put(bodyKey, body, {
        httpMetadata: { contentType: 'text/markdown;charset=UTF-8' },
      });
      storedInR2 = true;
      await env.IDEA_BUCKET.delete(renderKey).catch(() => undefined);
    } catch {
      // Fall back to storing body inline in D1 if R2 write fails.
    }
  }

  await env.DB.prepare(
    `UPDATE ideas
     SET title = ?,
         summary = ?,
         preview = ?,
         signal = ?,
         body_md = ?,
         body_key = ?,
         render_key = ?,
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
      storedInR2 ? '' : body,
      storedInR2 ? bodyKey : '',
      storedInR2 ? renderKey : '',
      sourceUrl,
      enumValue(input.visibility ?? idea.visibility, IDEA_VISIBILITY, 'public'),
      enumValue(input.stage ?? idea.stage, IDEA_STAGES, idea.stage || 'raw'),
      category,
      nextStep,
      risk,
      metrics.words,
      metrics.chapters,
      idea.id,
    )
    .run();

  return json({ ok: true, idea: idea.id, url: `/ideas/${idea.id}/` });
}

export async function promoteIdea(request: Request, env: Env, rawIdeaId: string) {
  const ideaId = pathId(rawIdeaId);
  if (!ideaId) return bad('invalid idea id', 400);
  const user = await authUserFor(request);
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

  const input = await bodyJson(request);
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

  const overflow = tooLong([['body', next, FIELD_LIMITS.body]]);
  if (overflow) return bad(overflow);

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
    url: `/ideas/${idea.id}/`,
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

  const input = await bodyJson(request);
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
