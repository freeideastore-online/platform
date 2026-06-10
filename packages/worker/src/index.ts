interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
}

type IdeaRow = {
  id: string;
  title: string;
  summary: string;
  stage: string;
  category: string;
  next_step: string;
  risk: string;
  created_by: string;
  status: string;
  pro_candidate: number;
  created_at: string;
  updated_at: string;
  support: number;
  trash: number;
  pivot: number;
  contribution_count: number;
};

const JSON_HEADERS = {
  'Content-Type': 'application/json;charset=UTF-8',
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
};

const SECURITY_HEADERS: Record<string, string> = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'SAMEORIGIN',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
};

function json(data: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: { ...JSON_HEADERS, ...SECURITY_HEADERS, ...(init.headers || {}) },
  });
}

function bad(message: string, status = 400) {
  return json({ error: message }, { status });
}

function id(prefix: string) {
  return `${prefix}-${crypto.randomUUID()}`;
}

function slug(input: string) {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}

async function bodyJson(request: Request) {
  try {
    return (await request.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
}

async function profileFor(request: Request, env: Env) {
  const raw = request.headers.get('x-idea-handle') || 'guest';
  const handle = slug(raw) || 'guest';
  const profileId = `profile-${handle}`;
  await env.DB.prepare(
    `INSERT OR IGNORE INTO profiles (id, handle, display_name, reputation, badges_json)
     VALUES (?, ?, ?, 0, '[]')`,
  )
    .bind(profileId, handle, handle.replace(/-/g, ' '))
    .run();
  return profileId;
}

async function listIdeas(env: Env) {
  const result = await env.DB.prepare(
    `SELECT
       i.*,
       COALESCE(SUM(CASE WHEN r.type = 'support' THEN 1 ELSE 0 END), 0) AS support,
       COALESCE(SUM(CASE WHEN r.type = 'trash' THEN 1 ELSE 0 END), 0) AS trash,
       COALESCE(SUM(CASE WHEN r.type = 'pivot' THEN 1 ELSE 0 END), 0) AS pivot,
       COUNT(DISTINCT c.id) AS contribution_count
     FROM ideas i
     LEFT JOIN reactions r ON r.idea_id = i.id
     LEFT JOIN contributions c ON c.idea_id = i.id
     WHERE i.status != 'removed'
     GROUP BY i.id
     ORDER BY i.updated_at DESC`,
  ).all<IdeaRow>();

  return result.results || [];
}

async function handleApi(request: Request, env: Env, url: URL) {
  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: JSON_HEADERS });
  }

  if (url.pathname === '/api/health') {
    const row = await env.DB.prepare('SELECT COUNT(*) AS count FROM ideas').first<{ count: number }>();
    return json({ ok: true, service: 'freeideastore', ideas: row?.count ?? 0 });
  }

  if (url.pathname === '/api/ideas' && request.method === 'GET') {
    return json({ ideas: await listIdeas(env) });
  }

  if (url.pathname === '/api/ideas' && request.method === 'POST') {
    const input = await bodyJson(request);
    const title = String(input.title || '').trim();
    const summary = String(input.summary || '').trim();
    if (title.length < 3 || summary.length < 10) return bad('title and summary are required');

    const ideaId = slug(title) || id('idea');
    const profileId = await profileFor(request, env);
    await env.DB.prepare(
      `INSERT INTO ideas (id, title, summary, stage, category, next_step, risk, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        ideaId,
        title.slice(0, 120),
        summary.slice(0, 1000),
        String(input.stage || 'raw').slice(0, 40),
        String(input.category || 'uncategorized').slice(0, 60),
        String(input.nextStep || '').slice(0, 500),
        String(input.risk || '').slice(0, 500),
        profileId,
      )
      .run();
    return json({ idea: ideaId }, { status: 201 });
  }

  const contributionMatch = url.pathname.match(/^\/api\/ideas\/([^/]+)\/contributions$/);
  if (contributionMatch && request.method === 'GET') {
    const rows = await env.DB.prepare(
      `SELECT c.id, c.kind, c.body, c.created_at, p.handle, p.display_name
       FROM contributions c JOIN profiles p ON p.id = c.profile_id
       WHERE c.idea_id = ?
       ORDER BY c.created_at DESC`,
    )
      .bind(contributionMatch[1])
      .all();
    return json({ contributions: rows.results || [] });
  }

  if (contributionMatch && request.method === 'POST') {
    const input = await bodyJson(request);
    const body = String(input.body || '').trim();
    const kind = String(input.kind || 'comment').trim();
    if (body.length < 3) return bad('contribution body is required');
    const profileId = await profileFor(request, env);
    await env.DB.prepare(
      'INSERT INTO contributions (id, idea_id, profile_id, kind, body) VALUES (?, ?, ?, ?, ?)',
    )
      .bind(id('contribution'), contributionMatch[1], profileId, kind.slice(0, 40), body.slice(0, 2000))
      .run();
    await env.DB.prepare('UPDATE ideas SET updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .bind(contributionMatch[1])
      .run();
    return json({ ok: true }, { status: 201 });
  }

  const reactionMatch = url.pathname.match(/^\/api\/ideas\/([^/]+)\/reactions$/);
  if (reactionMatch && request.method === 'POST') {
    const input = await bodyJson(request);
    const type = String(input.type || '').trim();
    if (!['support', 'trash', 'pivot'].includes(type)) return bad('reaction type must be support, trash, or pivot');
    const profileId = await profileFor(request, env);
    await env.DB.prepare('INSERT OR IGNORE INTO reactions (id, idea_id, profile_id, type) VALUES (?, ?, ?, ?)')
      .bind(id('reaction'), reactionMatch[1], profileId, type)
      .run();
    return json({ ok: true }, { status: 201 });
  }

  if (url.pathname === '/api/profiles' && request.method === 'GET') {
    const rows = await env.DB.prepare(
      `SELECT p.id, p.handle, p.display_name, p.bio, p.reputation, p.badges_json,
        COUNT(DISTINCT c.id) AS contributions
       FROM profiles p
       LEFT JOIN contributions c ON c.profile_id = p.id
       GROUP BY p.id
       ORDER BY p.reputation DESC, contributions DESC
       LIMIT 50`,
    ).all();
    return json({ profiles: rows.results || [] });
  }

  return bad('not found', 404);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname.startsWith('/api/')) {
      try {
        return await handleApi(request, env, url);
      } catch (error) {
        return json({ error: error instanceof Error ? error.message : 'internal error' }, { status: 500 });
      }
    }

    const response = await env.ASSETS.fetch(request);
    const headers = new Headers(response.headers);
    for (const [key, value] of Object.entries(SECURITY_HEADERS)) headers.set(key, value);
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  },
};

