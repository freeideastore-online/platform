import { authUserFor, hasBearerAuth, isApiMutation, isSameOriginMutation, registeredProfileFor } from './auth';
import { createIdea, deleteIdea, deriveIdea, promoteIdea, updateIdea } from './api-idea-mutations';
import { contributorByHandle, contributionsByProfile, ideaBody, ideaById, ideasByProfile, listContributors, listIdeas } from './data';
import { bad, bodyJson, clampInt, id, json, JSON_HEADERS, pathId, SECURITY_HEADERS } from './http';
import type { Env } from './types';

async function handleHealth(env: Env) {
  const row = await env.DB.prepare('SELECT COUNT(*) AS count FROM ideas').first<{ count: number }>();
  return json({ ok: true, service: 'freeideastore', ideas: row?.count ?? 0 });
}

async function handleSession(request: Request) {
  const user = await authUserFor(request);
  return user ? json({ user }) : json({ error: 'not signed in' }, { status: 401 });
}

async function handleMeIdeas(request: Request, env: Env, url: URL) {
  const user = await authUserFor(request);
  if (!user) return json({ error: 'not signed in' }, { status: 401 });
  const profile = await contributorByHandle(env, user.handle);
  return json({
    user,
    ideas: profile ? await ideasByProfile(env, profile.id, clampInt(url.searchParams.get('limit'), 500, 1, 1000)) : [],
  });
}

async function handleMeActivity(request: Request, env: Env, url: URL) {
  const user = await authUserFor(request);
  if (!user) return json({ error: 'not signed in' }, { status: 401 });
  const profile = await contributorByHandle(env, user.handle);
  return json({
    user,
    ideas: profile ? await ideasByProfile(env, profile.id, clampInt(url.searchParams.get('idea_limit'), 100, 1, 1000)) : [],
    contributions: profile ? await contributionsByProfile(env, profile.id, clampInt(url.searchParams.get('contribution_limit'), 100, 1, 500)) : [],
  });
}

async function handleListIdeas(env: Env, url: URL) {
  return json({
    ideas: await listIdeas(env, {
      stage: url.searchParams.get('stage') || 'all',
      limit: clampInt(url.searchParams.get('limit'), 60, 1, 100),
    }),
  });
}

async function handleGetIdea(env: Env, ideaParam: string) {
  const ideaId = pathId(ideaParam);
  if (!ideaId) return bad('invalid idea id', 400);
  const idea = await ideaById(env, ideaId);
  if (!idea) return bad('idea not found', 404);
  return json({ idea, body: await ideaBody(env, idea), url: `/ideas/${idea.id}/` });
}

async function handleGetContributions(env: Env, ideaParam: string) {
  const ideaId = pathId(ideaParam);
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

async function handleCreateContribution(request: Request, env: Env, ideaParam: string) {
  const ideaId = pathId(ideaParam);
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

async function handleCreateReaction(request: Request, env: Env, ideaParam: string) {
  const ideaId = pathId(ideaParam);
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

async function handleListContributors(env: Env) {
  return json({ contributors: await listContributors(env) });
}

async function handleGetContributor(env: Env, handleParam: string) {
  const handle = pathId(handleParam);
  if (!handle) return bad('invalid contributor handle', 400);
  const contributor = await contributorByHandle(env, handle);
  if (!contributor) return bad('contributor not found', 404);
  return json({ contributor, url: `/contributors/${contributor.handle}/` });
}

type RouteHandler = (request: Request, env: Env, url: URL, match?: RegExpMatchArray) => Promise<Response>;

interface Route {
  pattern: RegExp;
  methods: Record<string, RouteHandler>;
}

const routes: Route[] = [
  {
    pattern: /^\/api\/health$/,
    methods: {
      GET: (_, env) => handleHealth(env),
    },
  },
  {
    pattern: /^\/api\/session$/,
    methods: {
      GET: (request) => handleSession(request),
    },
  },
  {
    pattern: /^\/api\/me\/ideas$/,
    methods: {
      GET: (request, env, url) => handleMeIdeas(request, env, url),
    },
  },
  {
    pattern: /^\/api\/me\/activity$/,
    methods: {
      GET: (request, env, url) => handleMeActivity(request, env, url),
    },
  },
  {
    pattern: /^\/api\/ideas$/,
    methods: {
      GET: (_, env, url) => handleListIdeas(env, url),
      POST: (request, env) => createIdea(request, env),
    },
  },
  {
    pattern: /^\/api\/ideas\/([^/]+)$/,
    methods: {
      GET: (_, env, __, match) => handleGetIdea(env, match![1] || ''),
      DELETE: (request, env, __, match) => deleteIdea(request, env, match![1] || ''),
      PATCH: (request, env, __, match) => updateIdea(request, env, match![1] || ''),
      PUT: (request, env, __, match) => updateIdea(request, env, match![1] || ''),
    },
  },
  {
    pattern: /^\/api\/ideas\/([^/]+)\/derive$/,
    methods: {
      POST: (request, env, __, match) => deriveIdea(request, env, match![1] || ''),
    },
  },
  {
    pattern: /^\/api\/ideas\/([^/]+)\/promote$/,
    methods: {
      POST: (request, env, __, match) => promoteIdea(request, env, match![1] || ''),
    },
  },
  {
    pattern: /^\/api\/ideas\/([^/]+)\/contributions$/,
    methods: {
      GET: (_, env, __, match) => handleGetContributions(env, match![1] || ''),
      POST: (request, env, __, match) => handleCreateContribution(request, env, match![1] || ''),
    },
  },
  {
    pattern: /^\/api\/ideas\/([^/]+)\/reactions$/,
    methods: {
      POST: (request, env, __, match) => handleCreateReaction(request, env, match![1] || ''),
    },
  },
  {
    pattern: /^\/api\/profiles$/,
    methods: {
      GET: (_, env) => handleListContributors(env),
    },
  },
  {
    pattern: /^\/api\/contributors$/,
    methods: {
      GET: (_, env) => handleListContributors(env),
    },
  },
  {
    pattern: /^\/api\/contributors\/([^/]+)$/,
    methods: {
      GET: (_, env, __, match) => handleGetContributor(env, match![1] || ''),
    },
  },
];

export async function handleApi(request: Request, env: Env, url: URL) {
  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: JSON_HEADERS });
  }
  if (isApiMutation(request) && !hasBearerAuth(request) && !isSameOriginMutation(request)) {
    return new Response('Forbidden', { status: 403, headers: SECURITY_HEADERS });
  }

  for (const route of routes) {
    const match = url.pathname.match(route.pattern);
    if (!match) continue;
    const handler = route.methods[request.method];
    if (!handler) continue;
    return handler(request, env, url, match);
  }

  return bad('not found', 404);
}
