import { authUserFor, profileFor } from './auth';
import { contributorByHandle, ideaBody, ideaById, uniqueIdeaId } from './data';
import { bad, bodyJson, enumValue, json, pathId } from './http';
import type { Env } from './types';

const IDEA_STAGES = new Set(['raw', 'shaping', 'researching', 'validating', 'prototyping', 'launched', 'pivot', 'parked']);
const IDEA_VISIBILITY = new Set(['public', 'unlisted']);

export async function createIdea(request: Request, env: Env) {
  const input = await bodyJson(request);
  const title = String(input.title || '').trim();
  const summary = String(input.summary || '').trim();
  if (title.length < 3 || summary.length < 10) return bad('title and summary are required');
  if (title.length > 80) return bad('title must be 80 characters or fewer — use summary for detail');

  const ideaId = await uniqueIdeaId(env, title);
  const profileId = await profileFor(request, env);
  const body = String(input.body || input.body_md || '').trim().slice(0, 24000);
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
     (id, title, summary, preview, signal, body_md, body_key, render_key, source_url, visibility, stage, category, next_step, risk, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      ideaId,
      title.slice(0, 80),
      summary.slice(0, 1000),
      String(input.preview || '').slice(0, 1000),
      String(input.signal || '').slice(0, 1000),
      storedInR2 ? '' : body,
      storedInR2 ? bodyKey : '',
      storedInR2 ? renderKey : '',
      String(input.sourceUrl || input.source_url || '').slice(0, 500),
      enumValue(input.visibility, IDEA_VISIBILITY, 'public'),
      enumValue(input.stage, IDEA_STAGES, 'raw'),
      String(input.category || 'uncategorized').slice(0, 60),
      String(input.nextStep || '').slice(0, 500),
      String(input.risk || '').slice(0, 500),
      profileId,
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
  const seedBody = String(bodyOverride ?? (await ideaBody(env, parent))).slice(0, 24000);
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
  const parentPath = `/ideas/${parent.id}/`;
  await env.DB.prepare(
    `INSERT INTO ideas
     (id, title, summary, preview, signal, body_md, body_key, render_key, source_url, visibility, stage, category, next_step, risk, created_by, parent_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      ideaId,
      title.slice(0, 80),
      summary.slice(0, 1000),
      String(input.preview || parent.preview || summary).slice(0, 1000),
      String(input.signal || '').slice(0, 1000),
      storedInR2 ? '' : seedBody,
      storedInR2 ? bodyKey : '',
      storedInR2 ? renderKey : '',
      String(input.sourceUrl || input.source_url || `${new URL(request.url).origin}${parentPath}`).slice(0, 500),
      enumValue(input.visibility, IDEA_VISIBILITY, 'public'),
      enumValue(input.stage, IDEA_STAGES, 'raw'),
      String(input.category || parent.category || 'uncategorized').slice(0, 60),
      String(input.nextStep || input.next_step || '').slice(0, 500),
      String(input.risk || '').slice(0, 500),
      profileId,
      parent.id,
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
  const body = typeof bodyInput === 'string' ? bodyInput.trim().slice(0, 24000) : await ideaBody(env, idea);
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
         updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
  )
    .bind(
      String(input.title || idea.title).trim().slice(0, 80),
      String(input.summary || idea.summary).trim().slice(0, 1000),
      String(input.preview ?? idea.preview ?? '').slice(0, 1000),
      String(input.signal ?? idea.signal ?? '').slice(0, 1000),
      storedInR2 ? '' : body,
      storedInR2 ? bodyKey : '',
      storedInR2 ? renderKey : '',
      String(input.sourceUrl || input.source_url || idea.source_url || '').slice(0, 500),
      enumValue(input.visibility ?? idea.visibility, IDEA_VISIBILITY, 'public'),
      enumValue(input.stage ?? idea.stage, IDEA_STAGES, idea.stage || 'raw'),
      String(input.category || idea.category || 'uncategorized').slice(0, 60),
      String(input.nextStep || input.next_step || idea.next_step || '').slice(0, 500),
      String(input.risk || idea.risk || '').slice(0, 500),
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
