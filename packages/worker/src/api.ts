import { authUserFor, hasBearerAuth, isApiMutation, isSameOriginMutation, registeredProfileFor } from './auth';
import { createIdea, deleteIdea, deriveIdea, promoteIdea, updateIdea } from './api-idea-mutations';
import { contributorByHandle, contributionsByProfile, ideaBody, ideaById, ideasByProfile, listContributors, listIdeas } from './data';
import { bad, bodyJson, clampInt, id, json, JSON_HEADERS, pathId, SECURITY_HEADERS } from './http';
import type { Env } from './types';

export async function handleApi(request: Request, env: Env, url: URL) {
  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: JSON_HEADERS });
  }
  if (isApiMutation(request) && !hasBearerAuth(request) && !isSameOriginMutation(request)) {
    return new Response('Forbidden', { status: 403, headers: SECURITY_HEADERS });
  }

  if (url.pathname === '/api/health') {
    const row = await env.DB.prepare('SELECT COUNT(*) AS count FROM ideas').first<{ count: number }>();
    return json({ ok: true, service: 'freeideastore', ideas: row?.count ?? 0 });
  }

  if (url.pathname === '/api/session' && request.method === 'GET') {
    const user = await authUserFor(request);
    return user ? json({ user }) : json({ error: 'not signed in' }, { status: 401 });
  }

  if (url.pathname === '/api/me/ideas' && request.method === 'GET') {
    const user = await authUserFor(request);
    if (!user) return json({ error: 'not signed in' }, { status: 401 });
    const profile = await contributorByHandle(env, user.handle);
    return json({
      user,
      ideas: profile ? await ideasByProfile(env, profile.id, clampInt(url.searchParams.get('limit'), 500, 1, 1000)) : [],
    });
  }

  if (url.pathname === '/api/me/activity' && request.method === 'GET') {
    const user = await authUserFor(request);
    if (!user) return json({ error: 'not signed in' }, { status: 401 });
    const profile = await contributorByHandle(env, user.handle);
    return json({
      user,
      ideas: profile ? await ideasByProfile(env, profile.id, clampInt(url.searchParams.get('idea_limit'), 100, 1, 1000)) : [],
      contributions: profile ? await contributionsByProfile(env, profile.id, clampInt(url.searchParams.get('contribution_limit'), 100, 1, 500)) : [],
    });
  }

  if (url.pathname === '/api/ideas' && request.method === 'GET') {
    return json({
      ideas: await listIdeas(env, {
        stage: url.searchParams.get('stage') || 'all',
        limit: clampInt(url.searchParams.get('limit'), 60, 1, 100),
      }),
    });
  }

  if (url.pathname === '/api/ideas' && request.method === 'POST') {
    return createIdea(request, env);
  }

  const ideaMatch = url.pathname.match(/^\/api\/ideas\/([^/]+)$/);
  if (ideaMatch && request.method === 'GET') {
    const ideaId = pathId(ideaMatch[1] || '');
    if (!ideaId) return bad('invalid idea id', 400);
    const idea = await ideaById(env, ideaId);
    if (!idea) return bad('idea not found', 404);
    return json({ idea, body: await ideaBody(env, idea), url: `/ideas/${idea.id}/` });
  }

  if (ideaMatch && request.method === 'DELETE') {
    return deleteIdea(request, env, ideaMatch[1] || '');
  }

  if (ideaMatch && (request.method === 'PATCH' || request.method === 'PUT')) {
    return updateIdea(request, env, ideaMatch[1] || '');
  }

  const deriveMatch = url.pathname.match(/^\/api\/ideas\/([^/]+)\/derive$/);
  if (deriveMatch && request.method === 'POST') {
    return deriveIdea(request, env, deriveMatch[1] || '');
  }

  const promoteMatch = url.pathname.match(/^\/api\/ideas\/([^/]+)\/promote$/);
  if (promoteMatch && request.method === 'POST') {
    return promoteIdea(request, env, promoteMatch[1] || '');
  }

  const contributionMatch = url.pathname.match(/^\/api\/ideas\/([^/]+)\/contributions$/);
  if (contributionMatch && request.method === 'GET') {
    const ideaId = pathId(contributionMatch[1] || '');
    if (!ideaId) return bad('invalid idea id', 400);
    if (!(await ideaById(env, ideaId))) return bad('idea not found', 404);
    const rows = await env.DB.prepare(
      `SELECT c.id, c.kind, c.body, c.created_at, p.handle, p.display_name
       FROM contributions c JOIN profiles p ON p.id = c.profile_id
       WHERE c.idea_id = ?
       ORDER BY c.created_at DESC`,
    )
      .bind(ideaId)
      .all();
    return json({ contributions: rows.results || [] });
  }

  if (contributionMatch && request.method === 'POST') {
    const ideaId = pathId(contributionMatch[1] || '');
    if (!ideaId) return bad('invalid idea id', 400);
    if (!(await ideaById(env, ideaId))) return bad('idea not found', 404);
    const registered = await registeredProfileFor(request, env);
    if (!registered) return json({ error: 'sign in required to comment or contribute' }, { status: 401 });
    const recentCount = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM contributions WHERE profile_id = ? AND created_at > datetime('now', '-1 minute')",
    ).bind(registered.profileId).first<{ n: number }>();
    if ((recentCount?.n ?? 0) >= 10) return json({ error: 'too many contributions — wait a minute' }, { status: 429 });
    const input = await bodyJson(request);
    const body = String(input.body || '').trim();
    const kind = String(input.kind || 'comment').trim();
    if (body.length < 3) return bad('contribution body is required');
    await env.DB.prepare(
      'INSERT INTO contributions (id, idea_id, profile_id, kind, body) VALUES (?, ?, ?, ?, ?)',
    )
      .bind(id('contribution'), ideaId, registered.profileId, kind.slice(0, 40), body.slice(0, 2000))
      .run();
    await env.DB.prepare('UPDATE ideas SET updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .bind(ideaId)
      .run();
    return json({ ok: true }, { status: 201 });
  }

  const reactionMatch = url.pathname.match(/^\/api\/ideas\/([^/]+)\/reactions$/);
  if (reactionMatch && request.method === 'POST') {
    const ideaId = pathId(reactionMatch[1] || '');
    if (!ideaId) return bad('invalid idea id', 400);
    if (!(await ideaById(env, ideaId))) return bad('idea not found', 404);
    const registered = await registeredProfileFor(request, env);
    if (!registered) return json({ error: 'sign in required to react to ideas' }, { status: 401 });
    const recentCount = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM reactions WHERE profile_id = ? AND created_at > datetime('now', '-1 minute')",
    ).bind(registered.profileId).first<{ n: number }>();
    if ((recentCount?.n ?? 0) >= 15) return json({ error: 'too many reactions — wait a minute' }, { status: 429 });
    const input = await bodyJson(request);
    const type = String(input.type || '').trim();
    if (!['support', 'trash', 'pivot'].includes(type)) return bad('reaction type must be support, trash, or pivot');
    await env.DB.prepare('INSERT OR IGNORE INTO reactions (id, idea_id, profile_id, type) VALUES (?, ?, ?, ?)')
      .bind(id('reaction'), ideaId, registered.profileId, type)
      .run();
    return json({ ok: true, type }, { status: 201 });
  }

  if (url.pathname === '/api/profiles' && request.method === 'GET') {
    return json({ profiles: await listContributors(env) });
  }

  if (url.pathname === '/api/contributors' && request.method === 'GET') {
    return json({ contributors: await listContributors(env) });
  }

  const contributorMatch = url.pathname.match(/^\/api\/contributors\/([^/]+)$/);
  if (contributorMatch && request.method === 'GET') {
    const handle = pathId(contributorMatch[1] || '');
    if (!handle) return bad('invalid contributor handle', 400);
    const contributor = await contributorByHandle(env, handle);
    if (!contributor) return bad('contributor not found', 404);
    return json({ contributor, url: `/contributors/${contributor.handle}/` });
  }

  return bad('not found', 404);
}
