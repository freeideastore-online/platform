interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  IDEA_BUCKET?: R2Bucket;
}

type IdeaRow = {
  id: string;
  title: string;
  summary: string;
  preview?: string;
  signal?: string;
  body_md?: string;
  body_key?: string;
  render_key?: string;
  source_url?: string;
  visibility?: string;
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
  'Content-Security-Policy':
    "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; frame-ancestors 'self'; base-uri 'self'; form-action 'self'",
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'SAMEORIGIN',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
};

const IDEA_STAGES = new Set(['raw', 'critique', 'researched', 'pivot', 'prototype', 'built']);
const IDEA_VISIBILITY = new Set(['public', 'unlisted']);

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

function pathId(input: string) {
  try {
    const decoded = decodeURIComponent(input);
    return /^[a-z0-9][a-z0-9-]{0,80}$/.test(decoded) ? decoded : '';
  } catch {
    return '';
  }
}

function escapeHtml(value: unknown) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function clampInt(value: string | null, fallback: number, min: number, max: number) {
  if (value === null || value.trim() === '') return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(parsed)));
}

function enumValue(value: unknown, allowed: Set<string>, fallback: string) {
  const normalized = slug(String(value || ''));
  return allowed.has(normalized) ? normalized : fallback;
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

async function uniqueIdeaId(env: Env, title: string) {
  const base = slug(title) || id('idea');
  const existing = await env.DB.prepare('SELECT id FROM ideas WHERE id = ?').bind(base).first<{ id: string }>();
  if (!existing) return base;
  return `${base.slice(0, 54)}-${crypto.randomUUID().slice(0, 8)}`;
}

async function listIdeas(env: Env, options: { stage?: string; limit?: number }) {
  const stage = options.stage || 'all';
  const limit = options.limit || 60;
  const result = await env.DB.prepare(
    `WITH recent AS (
       SELECT
         id,
         title,
         summary,
         preview,
         signal,
         source_url,
         visibility,
         stage,
         category,
         next_step,
         risk,
         created_by,
         status,
         pro_candidate,
         created_at,
         updated_at
       FROM ideas
       WHERE status != 'removed'
         AND (? = 'all' OR stage = ?)
       ORDER BY updated_at DESC
       LIMIT ?
     )
     SELECT
       recent.*,
       COUNT(DISTINCT CASE WHEN r.type = 'support' THEN r.id END) AS support,
       COUNT(DISTINCT CASE WHEN r.type = 'trash' THEN r.id END) AS trash,
       COUNT(DISTINCT CASE WHEN r.type = 'pivot' THEN r.id END) AS pivot,
       COUNT(DISTINCT c.id) AS contribution_count
     FROM recent
     LEFT JOIN reactions r ON r.idea_id = recent.id
     LEFT JOIN contributions c ON c.idea_id = recent.id
     GROUP BY recent.id
     ORDER BY recent.updated_at DESC`,
  )
    .bind(stage, stage, limit)
    .all<IdeaRow>();

  return result.results || [];
}

async function ideaById(env: Env, ideaId: string) {
  return env.DB.prepare(
    `SELECT
       i.*,
       COUNT(DISTINCT CASE WHEN r.type = 'support' THEN r.id END) AS support,
       COUNT(DISTINCT CASE WHEN r.type = 'trash' THEN r.id END) AS trash,
       COUNT(DISTINCT CASE WHEN r.type = 'pivot' THEN r.id END) AS pivot,
       COUNT(DISTINCT c.id) AS contribution_count
     FROM ideas i
     LEFT JOIN reactions r ON r.idea_id = i.id
     LEFT JOIN contributions c ON c.idea_id = i.id
     WHERE i.id = ? AND i.status != 'removed'
     GROUP BY i.id`,
  )
    .bind(ideaId)
    .first<IdeaRow>();
}

function markdownToHtml(markdown: string) {
  const lines = markdown.split(/\r?\n/);
  const html: string[] = [];
  let inList = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      if (inList) {
        html.push('</ul>');
        inList = false;
      }
      continue;
    }
    const heading = trimmed.match(/^(#{2,3})\s+(.+)$/);
    if (heading) {
      if (inList) {
        html.push('</ul>');
        inList = false;
      }
      const tag = heading[1].length === 2 ? 'h2' : 'h3';
      html.push(`<${tag}>${escapeHtml(heading[2])}</${tag}>`);
      continue;
    }
    const listItem = trimmed.match(/^[-*]\s+(.+)$/);
    if (listItem) {
      if (!inList) {
        html.push('<ul>');
        inList = true;
      }
      html.push(`<li>${escapeHtml(listItem[1])}</li>`);
      continue;
    }
    if (inList) {
      html.push('</ul>');
      inList = false;
    }
    html.push(`<p>${escapeHtml(trimmed)}</p>`);
  }
  if (inList) html.push('</ul>');
  return html.join('\n');
}

function defaultIdeaBody(idea: IdeaRow) {
  return [
    `## Snapshot`,
    idea.summary,
    ``,
    `## Current signal`,
    idea.signal || idea.preview || 'No signal has been added yet.',
    ``,
    `## Next step`,
    idea.next_step || 'Define the cheapest validation step.',
    ``,
    `## Risk`,
    idea.risk || 'Main risk not yet identified.',
    ``,
    `## How to help`,
    `- Add evidence from public sources.`,
    `- Name a risk or reason to trash it.`,
    `- Suggest a sharper customer, wedge, or pivot.`,
  ].join('\n');
}

async function ideaBody(env: Env, idea: IdeaRow) {
  if (idea.body_key && env.IDEA_BUCKET) {
    const object = await env.IDEA_BUCKET.get(idea.body_key);
    if (object) return object.text();
  }
  return idea.body_md || defaultIdeaBody(idea);
}

async function renderIdeaPage(env: Env, request: Request, ideaId: string) {
  const idea = await ideaById(env, ideaId);
  if (!idea) return new Response('Idea not found', { status: 404, headers: SECURITY_HEADERS });

  if (idea.render_key && env.IDEA_BUCKET) {
    const cached = await env.IDEA_BUCKET.get(idea.render_key);
    if (cached) {
      const headers = new Headers(SECURITY_HEADERS);
      headers.set('Content-Type', 'text/html;charset=UTF-8');
      headers.set('Cache-Control', 'public, max-age=120');
      return new Response(cached.body, { headers });
    }
  }

  const body = await ideaBody(env, idea);
  const page = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>${escapeHtml(idea.title)} - FreeIdeaStore</title>
<meta name="description" content="${escapeHtml(idea.summary)}">
<link rel="canonical" href="${escapeHtml(new URL(request.url).origin)}/ideas/${escapeHtml(idea.id)}/">
<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,700;9..144,800&family=Manrope:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<style>
*{box-sizing:border-box;margin:0;padding:0}
:root{--accent:#0ea5e9;--accent-dark:#0369a1;--paper:#f8fafc;--panel:#fff;--ink:#111827;--muted:#64748b;--line:#dbe3ef;--good:#16a34a;--bad:#dc2626}
body{background:var(--paper);color:var(--ink);font-family:Manrope,system-ui,sans-serif;line-height:1.55}
a{color:inherit;text-decoration:none}
header{position:sticky;top:0;z-index:10;display:flex;align-items:center;gap:1rem;border-bottom:1px solid var(--line);background:rgba(255,255,255,.94);padding:.7rem 1.25rem;backdrop-filter:blur(14px)}
.brand{display:flex;align-items:center;gap:.6rem;font-weight:800}.logo{display:grid;height:34px;width:34px;place-items:center;border-radius:8px;background:var(--accent);color:white}.brand span:last-child{font-family:Fraunces,serif}
nav{margin-left:auto;display:flex;gap:.9rem;color:var(--muted);font-size:.8rem;font-weight:800}
.shell{max-width:1040px;margin:0 auto;padding:2rem 1.25rem}
.crumb{color:var(--accent-dark);font-size:.75rem;font-weight:900;text-transform:uppercase;letter-spacing:.1em}
h1{font-family:Fraunces,serif;font-size:clamp(2.1rem,5.8vw,4.5rem);line-height:.96;margin:.45rem 0 .8rem;letter-spacing:0}
.lead{max-width:760px;color:var(--muted);font-size:1rem}
.meta{display:flex;flex-wrap:wrap;gap:.45rem;margin:1rem 0 1.35rem}
.pill{border:1px solid var(--line);border-radius:999px;background:var(--panel);color:var(--muted);font-size:.72rem;font-weight:900;padding:.32rem .62rem;text-transform:uppercase}
.layout{display:grid;grid-template-columns:minmax(0,1fr) 300px;gap:1rem;align-items:start}
.doc,.side{border:1px solid var(--line);border-radius:8px;background:var(--panel);padding:1rem;box-shadow:0 10px 24px rgba(15,23,42,.04)}
.doc h2{font-family:Fraunces,serif;font-size:1.45rem;margin:1rem 0 .35rem}.doc h2:first-child{margin-top:0}.doc h3{font-size:1rem;margin:.9rem 0 .3rem}.doc p,.doc li{color:#334155;font-size:.92rem}.doc ul{padding-left:1.2rem;display:grid;gap:.25rem;margin:.35rem 0}
.side{display:grid;gap:.85rem}.side h2{font-size:.82rem;text-transform:uppercase;color:var(--muted);letter-spacing:.1em}.side div{border-left:3px solid var(--line);padding-left:.65rem}.side strong{display:block;font-size:.74rem;text-transform:uppercase}.side span{display:block;color:var(--muted);font-size:.82rem}.actions{display:flex;gap:.5rem;flex-wrap:wrap}.button{border:1px solid var(--accent);border-radius:8px;background:var(--accent);color:white;padding:.58rem .75rem;font-size:.78rem;font-weight:900}.button.secondary{background:white;color:var(--accent-dark)}
@media(max-width:820px){nav{display:none}.layout{grid-template-columns:1fr}}
</style>
</head>
<body>
<header><a href="/" class="brand"><span class="logo">I</span><span>FreeIdeaStore</span></a><nav><a href="/#ideas">Ideas</a><a href="https://proideastore.serge-the-dev.workers.dev">ProIdeaStore</a></nav></header>
<main class="shell">
  <div class="crumb">Cheap public idea page</div>
  <h1>${escapeHtml(idea.title)}</h1>
  <p class="lead">${escapeHtml(idea.summary)}</p>
  <div class="meta">
    <span class="pill">${escapeHtml(idea.stage)}</span>
    <span class="pill">${escapeHtml(idea.category)}</span>
    <span class="pill">${idea.pro_candidate ? 'pro candidate' : 'free idea'}</span>
  </div>
  <div class="layout">
    <article class="doc">${markdownToHtml(body)}</article>
    <aside class="side">
      <h2>Store signals</h2>
      <div><strong>Support</strong><span>${escapeHtml(idea.support)} supports / ${escapeHtml(idea.trash)} trash / ${escapeHtml(idea.pivot)} pivots</span></div>
      <div><strong>Contributions</strong><span>${escapeHtml(idea.contribution_count)} notes, critiques, risks, or evidence links</span></div>
      <div><strong>Next step</strong><span>${escapeHtml(idea.next_step || 'Needs a next validation step.')}</span></div>
      <div><strong>Risk</strong><span>${escapeHtml(idea.risk || 'Risk not yet named.')}</span></div>
      <div class="actions"><a class="button" href="/#ideas">Back to store</a><a class="button secondary" href="/api/ideas/${escapeHtml(idea.id)}">JSON</a></div>
    </aside>
  </div>
</main>
</body>
</html>`;

  if (idea.render_key && env.IDEA_BUCKET) {
    await env.IDEA_BUCKET.put(idea.render_key, page, {
      httpMetadata: { contentType: 'text/html;charset=UTF-8' },
    });
  }

  return new Response(page, {
    headers: {
      ...SECURITY_HEADERS,
      'Content-Type': 'text/html;charset=UTF-8',
      'Cache-Control': 'public, max-age=60',
    },
  });
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
    return json({
      ideas: await listIdeas(env, {
        stage: url.searchParams.get('stage') || 'all',
        limit: clampInt(url.searchParams.get('limit'), 60, 1, 100),
      }),
    });
  }

  if (url.pathname === '/api/ideas' && request.method === 'POST') {
    const input = await bodyJson(request);
    const title = String(input.title || '').trim();
    const summary = String(input.summary || '').trim();
    if (title.length < 3 || summary.length < 10) return bad('title and summary are required');

    const ideaId = await uniqueIdeaId(env, title);
    const profileId = await profileFor(request, env);
    const body = String(input.body || input.body_md || '').trim().slice(0, 24000);
    const bodyKey = `ideas/${ideaId}/body.md`;
    const renderKey = `ideas/${ideaId}/rendered.html`;
    if (body && env.IDEA_BUCKET) {
      await env.IDEA_BUCKET.put(bodyKey, body, {
        httpMetadata: { contentType: 'text/markdown;charset=UTF-8' },
      });
    }
    await env.DB.prepare(
      `INSERT INTO ideas
       (id, title, summary, preview, signal, body_md, body_key, render_key, source_url, visibility, stage, category, next_step, risk, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        ideaId,
        title.slice(0, 120),
        summary.slice(0, 1000),
        String(input.preview || '').slice(0, 1000),
        String(input.signal || '').slice(0, 1000),
        env.IDEA_BUCKET ? '' : body,
        env.IDEA_BUCKET && body ? bodyKey : '',
        env.IDEA_BUCKET && body ? renderKey : '',
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

  const ideaMatch = url.pathname.match(/^\/api\/ideas\/([^/]+)$/);
  if (ideaMatch && request.method === 'GET') {
    const ideaId = pathId(ideaMatch[1]);
    if (!ideaId) return bad('invalid idea id', 400);
    const idea = await ideaById(env, ideaId);
    if (!idea) return bad('idea not found', 404);
    return json({ idea, body: await ideaBody(env, idea), url: `/ideas/${idea.id}/` });
  }

  const promoteMatch = url.pathname.match(/^\/api\/ideas\/([^/]+)\/promote$/);
  if (promoteMatch && request.method === 'POST') {
    const ideaId = pathId(promoteMatch[1]);
    if (!ideaId) return bad('invalid idea id', 400);
    const idea = await ideaById(env, ideaId);
    if (!idea) return bad('idea not found', 404);
    await env.DB.prepare(
      `UPDATE ideas
       SET pro_candidate = 1, stage = CASE WHEN stage = 'raw' THEN 'researched' ELSE stage END, updated_at = CURRENT_TIMESTAMP
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

  const contributionMatch = url.pathname.match(/^\/api\/ideas\/([^/]+)\/contributions$/);
  if (contributionMatch && request.method === 'GET') {
    const ideaId = pathId(contributionMatch[1]);
    if (!ideaId) return bad('invalid idea id', 400);
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
    const ideaId = pathId(contributionMatch[1]);
    if (!ideaId) return bad('invalid idea id', 400);
    if (!(await ideaById(env, ideaId))) return bad('idea not found', 404);
    const input = await bodyJson(request);
    const body = String(input.body || '').trim();
    const kind = String(input.kind || 'comment').trim();
    if (body.length < 3) return bad('contribution body is required');
    const profileId = await profileFor(request, env);
    await env.DB.prepare(
      'INSERT INTO contributions (id, idea_id, profile_id, kind, body) VALUES (?, ?, ?, ?, ?)',
    )
      .bind(id('contribution'), ideaId, profileId, kind.slice(0, 40), body.slice(0, 2000))
      .run();
    await env.DB.prepare('UPDATE ideas SET updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .bind(ideaId)
      .run();
    return json({ ok: true }, { status: 201 });
  }

  const reactionMatch = url.pathname.match(/^\/api\/ideas\/([^/]+)\/reactions$/);
  if (reactionMatch && request.method === 'POST') {
    const ideaId = pathId(reactionMatch[1]);
    if (!ideaId) return bad('invalid idea id', 400);
    if (!(await ideaById(env, ideaId))) return bad('idea not found', 404);
    const input = await bodyJson(request);
    const type = String(input.type || '').trim();
    if (!['support', 'trash', 'pivot'].includes(type)) return bad('reaction type must be support, trash, or pivot');
    const profileId = await profileFor(request, env);
    await env.DB.prepare('INSERT OR IGNORE INTO reactions (id, idea_id, profile_id, type) VALUES (?, ?, ?, ?)')
      .bind(id('reaction'), ideaId, profileId, type)
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

    const ideaPageMatch = url.pathname.match(/^\/ideas\/([^/]+)\/?$/);
    if (ideaPageMatch) {
      try {
        const ideaId = pathId(ideaPageMatch[1]);
        if (!ideaId) return new Response('Idea not found', { status: 404, headers: SECURITY_HEADERS });
        return await renderIdeaPage(env, request, ideaId);
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
