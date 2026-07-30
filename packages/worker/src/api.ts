import { authUserFor, hasBearerAuth, isApiMutation, isSameOriginMutation, registeredProfileFor } from './auth';
import {
  applyRefinement,
  createIdea,
  deleteIdea,
  deriveIdea,
  handleListRefinements,
  promoteIdea,
  resolveRefinement,
  revertIdeaToRevision,
  updateIdea,
  updateIdeaSection,
} from './api-idea-mutations';
import { contributorByHandle, contributionsByIdea, contributionsByProfile, ideaBody, ideaById, ideasByProfile, listContributors, listIdeas } from './data';
import { bad, bodyJson, clampInt, FIELD_LIMITS, id, json, JSON_HEADERS, pathId, SECURITY_HEADERS, tooLong } from './http';
import { ideaSectionList, readIdeaSection } from './markdown';
import { CONFIDENCE_VALUES, normaliseKind, PROVENANCE_VALUES } from './idea-research';
import { REFINEMENT_KIND } from './refinements';
import { diffSummary, listRevisions, revisionBody, revisionById } from './revisions';
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
  return json({ contributions: await contributionsByIdea(env, ideaId) });
}

async function handleGetSections(env: Env, ideaParam: string) {
  const ideaId = pathId(ideaParam);
  if (!ideaId) return bad('invalid idea id', 400);
  const idea = await ideaById(env, ideaId);
  if (!idea) return bad('idea not found', 404);
  const body = await ideaBody(env, idea);
  return json({ idea: idea.id, sections: ideaSectionList(body, idea.title) });
}

async function handleGetSection(env: Env, ideaParam: string, sectionParam: string) {
  const ideaId = pathId(ideaParam);
  const sectionId = pathId(sectionParam);
  if (!ideaId) return bad('invalid idea id', 400);
  if (!sectionId) return bad('invalid section id', 400);
  const idea = await ideaById(env, ideaId);
  if (!idea) return bad('idea not found', 404);
  const body = await ideaBody(env, idea);
  const markdown = readIdeaSection(body, sectionId, idea.title);
  if (markdown === null) {
    return bad(`unknown section "${sectionId}" — read /api/ideas/${idea.id}/sections for the current list`, 404);
  }
  return json({ idea: idea.id, section: sectionId, markdown });
}


async function handleGetRevisions(env: Env, ideaParam: string, url: URL) {
  const ideaId = pathId(ideaParam);
  if (!ideaId) return bad('invalid idea id', 400);
  const idea = await ideaById(env, ideaId);
  if (!idea) return bad('idea not found', 404);
  const limit = clampInt(url.searchParams.get('limit'), 50, 1, 200);
  return json({ idea: idea.id, revisions: await listRevisions(env, idea.id, limit) });
}

async function handleGetRevision(env: Env, ideaParam: string, revisionParam: string) {
  const ideaId = pathId(ideaParam);
  if (!ideaId) return bad('invalid idea id', 400);
  const idea = await ideaById(env, ideaId);
  if (!idea) return bad('idea not found', 404);
  const revision = await revisionById(env, idea.id, revisionParam);
  if (!revision) return bad('revision not found', 404);
  return json({ idea: idea.id, revision, markdown: await revisionBody(env, revision) });
}

/** What a revision changed, relative to the document as it stands now. */
async function handleGetRevisionDiff(env: Env, ideaParam: string, revisionParam: string) {
  const ideaId = pathId(ideaParam);
  if (!ideaId) return bad('invalid idea id', 400);
  const idea = await ideaById(env, ideaId);
  if (!idea) return bad('idea not found', 404);
  const revision = await revisionById(env, idea.id, revisionParam);
  if (!revision) return bad('revision not found', 404);
  const before = await revisionBody(env, revision);
  const after = await ideaBody(env, idea);
  return json({ idea: idea.id, revision: revision.id, from: 'revision', to: 'current', ...diffSummary(before, after) });
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

  // Typed research fields. All optional — a plain comment supplies none of them.
  const claim = String(input.claim || '').trim();
  const sourceUrl = String(input.sourceUrl || input.source_url || '').trim();
  const accessedAt = String(input.accessedAt || input.accessed_at || '').trim();
  const provenance = String(input.provenance || '').trim().toLowerCase();
  const confidence = String(input.confidence || '').trim().toLowerCase();
  const supersedes = String(input.supersedes || '').trim();
  // Refinements name the section they target, so the queue can route the write.
  const section = String(input.section || '').trim();

  const overflow = tooLong([
    ['contribution body', body, FIELD_LIMITS.contribution],
    ['contribution kind', kind, FIELD_LIMITS.contributionKind],
    ['claim', claim, FIELD_LIMITS.claim],
    ['source URL', sourceUrl, FIELD_LIMITS.sourceUrl],
  ]);
  if (overflow) return bad(overflow);

  if (provenance && !PROVENANCE_VALUES.has(provenance)) {
    return bad(`provenance must be one of ${[...PROVENANCE_VALUES].join(', ')}`);
  }
  if (confidence && !CONFIDENCE_VALUES.has(confidence)) {
    return bad(`confidence must be one of ${[...CONFIDENCE_VALUES].join(', ')}`);
  }
  // A source that cannot be opened is not a source.
  if (sourceUrl && !/^https?:\/\//i.test(sourceUrl)) {
    return bad('source URL must be an http(s) URL');
  }
  if (accessedAt && !/^\d{4}-\d{2}-\d{2}$/.test(accessedAt)) {
    return bad('accessed date must be YYYY-MM-DD');
  }
  // A refinement whose target section does not exist can never be applied, so it
  // would sit in the queue forever — exactly the failure the queue was built to
  // fix. Validate at propose time rather than at apply time.
  if (section && normaliseKind(kind) === REFINEMENT_KIND) {
    const idea = await ideaById(env, ideaId);
    const sections = idea ? ideaSectionList(await ideaBody(env, idea), idea.title) : [];
    if (!sections.some((candidate) => candidate.id === section)) {
      return bad(
        `unknown section "${section}" — valid sections are ${sections.map((candidate) => candidate.id).join(', ')}`,
        400,
      );
    }
  }

  // Superseding an entry that does not exist would silently orphan the link.
  if (supersedes) {
    const target = await env.DB.prepare('SELECT id FROM contributions WHERE id = ? AND idea_id = ?')
      .bind(supersedes, ideaId)
      .first<{ id: string }>();
    if (!target) return bad('supersedes must reference an existing contribution on this idea', 404);
  }

  await env.DB.prepare(
    `INSERT INTO contributions
     (id, idea_id, profile_id, kind, body, claim, source_url, accessed_at, provenance, confidence, supersedes, section)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id('contribution'),
      ideaId,
      registered.profileId,
      kind,
      body,
      claim,
      sourceUrl,
      accessedAt,
      provenance,
      confidence,
      supersedes,
      section,
    )
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
    pattern: /^\/api\/ideas\/([^/]+)\/refinements$/,
    methods: {
      GET: (_, env, url, match) => handleListRefinements(env, match![1] || '', url),
    },
  },
  {
    pattern: /^\/api\/ideas\/([^/]+)\/refinements\/([^/]+)\/apply$/,
    methods: {
      POST: (request, env, __, match) => applyRefinement(request, env, match![1] || '', match![2] || ''),
    },
  },
  {
    pattern: /^\/api\/ideas\/([^/]+)\/refinements\/([^/]+)\/resolve$/,
    methods: {
      POST: (request, env, __, match) => resolveRefinement(request, env, match![1] || '', match![2] || ''),
    },
  },
  {
    pattern: /^\/api\/ideas\/([^/]+)\/revisions$/,
    methods: {
      GET: (_, env, url, match) => handleGetRevisions(env, match![1] || '', url),
    },
  },
  {
    pattern: /^\/api\/ideas\/([^/]+)\/revisions\/([^/]+)$/,
    methods: {
      GET: (_, env, __, match) => handleGetRevision(env, match![1] || '', match![2] || ''),
    },
  },
  {
    pattern: /^\/api\/ideas\/([^/]+)\/revisions\/([^/]+)\/diff$/,
    methods: {
      GET: (_, env, __, match) => handleGetRevisionDiff(env, match![1] || '', match![2] || ''),
    },
  },
  {
    pattern: /^\/api\/ideas\/([^/]+)\/revisions\/([^/]+)\/revert$/,
    methods: {
      POST: (request, env, __, match) => revertIdeaToRevision(request, env, match![1] || '', match![2] || ''),
    },
  },
  {
    pattern: /^\/api\/ideas\/([^/]+)\/sections$/,
    methods: {
      GET: (_, env, __, match) => handleGetSections(env, match![1] || ''),
    },
  },
  {
    pattern: /^\/api\/ideas\/([^/]+)\/sections\/([^/]+)$/,
    methods: {
      GET: (_, env, __, match) => handleGetSection(env, match![1] || '', match![2] || ''),
      // PUT replaces a section, POST extends it.
      PUT: (request, env, __, match) => updateIdeaSection(request, env, match![1] || '', match![2] || '', 'replace'),
      POST: (request, env, __, match) => updateIdeaSection(request, env, match![1] || '', match![2] || '', 'append'),
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
