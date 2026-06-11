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

type AuthUser = {
  handle: string;
  displayName: string;
  provider: string;
  avatarUrl: string | null;
};

type ContributorRow = {
  id: string;
  handle: string;
  display_name: string;
  bio?: string;
  reputation: number;
  badges_json?: string;
  idea_count: number;
  contribution_count: number;
  reaction_count: number;
};

const JSON_HEADERS = {
  'Content-Type': 'application/json;charset=UTF-8',
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
};

const SECURITY_HEADERS: Record<string, string> = {
  'Content-Security-Policy':
    "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data: https:; connect-src 'self'; frame-ancestors 'self'; base-uri 'self'; form-action 'self'",
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'SAMEORIGIN',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
};

const IDEA_STAGES = new Set(['raw', 'critique', 'researched', 'pivot', 'prototype', 'built']);
const IDEA_VISIBILITY = new Set(['public', 'unlisted']);
const AUTH_PREFIX = '/.fis/auth';
const SESSION_COOKIE_NAME = '__Host-fis_session';
const NONCE_COOKIE_NAME = '__Host-fis_auth_nonce';
const AUTH_API_BASE = 'https://api.freeappstore.online';
const AUTH_APP_ID = 'freeideastore';
const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;
const NONCE_TTL_SECONDS = 10 * 60;
const AUTH_PROVIDERS = new Set(['github', 'google']);
const HIDDEN_CONTRIBUTOR_HANDLES = "'system','risk-finder','pivot-maker','evidence-hunter','cloudflare-smoke'";

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

function readCookie(header: string | null, name: string) {
  if (!header) return null;
  for (const part of header.split(';')) {
    const [rawName, ...rawValue] = part.trim().split('=');
    if (rawName !== name) continue;
    try {
      return decodeURIComponent(rawValue.join('='));
    } catch {
      return null;
    }
  }
  return null;
}

function sameOriginPath(baseUrl: URL, raw: string | null) {
  if (!raw) return '/';
  try {
    const parsed = new URL(raw, baseUrl.origin);
    if (parsed.origin !== baseUrl.origin) return '/';
    if (parsed.pathname === AUTH_PREFIX || parsed.pathname.startsWith(`${AUTH_PREFIX}/`)) return '/';
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return '/';
  }
}

function cookie(name: string, value: string, maxAge: number) {
  return [
    `${name}=${encodeURIComponent(value)}`,
    `Max-Age=${maxAge}`,
    'Path=/',
    'Secure',
    'HttpOnly',
    'SameSite=Lax',
  ].join('; ');
}

function clearCookie(name: string) {
  return `${name}=; Max-Age=0; Path=/; Secure; HttpOnly; SameSite=Lax`;
}

function redirect(location: string, status: 302 | 303, cookies: string[] = []) {
  const headers = new Headers({ Location: location, 'Cache-Control': 'no-store' });
  for (const item of cookies) headers.append('Set-Cookie', item);
  return new Response(null, { status, headers });
}

function methodNotAllowed(allow: string) {
  return new Response('Method not allowed', {
    status: 405,
    headers: { ...SECURITY_HEADERS, Allow: allow, 'Cache-Control': 'no-store' },
  });
}

function isSameOriginMutation(request: Request) {
  const url = new URL(request.url);
  const origin = request.headers.get('Origin');
  if (origin && origin !== url.origin) return false;
  const fetchSite = request.headers.get('Sec-Fetch-Site');
  if (fetchSite && fetchSite !== 'same-origin' && fetchSite !== 'none') return false;
  return true;
}

function normalizeAuthUser(payload: unknown): AuthUser | null {
  const data = (payload || {}) as Record<string, unknown>;
  const user = ((data.user || data.profile || data.account || data) || {}) as Record<string, unknown>;
  const email = String(user.email || '');
  const rawHandle = String(user.handle || user.login || user.username || email.split('@')[0] || user.name || '');
  const handle = slug(rawHandle);
  if (!handle) return null;
  return {
    handle,
    displayName: String(user.displayName || user.display_name || user.name || rawHandle).trim() || handle,
    provider: String(user.provider || data.provider || 'auth'),
    avatarUrl: String(user.avatarUrl || user.avatar_url || user.picture || '').trim() || null,
  };
}

async function fetchAuthPayload(token: string) {
  const response = await fetch(`${AUTH_API_BASE}/v1/auth/me`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const text = await response.text();
  let body: unknown = text;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { error: text };
  }
  return { response, body };
}

async function authUserFor(request: Request) {
  const token = readCookie(request.headers.get('Cookie'), SESSION_COOKIE_NAME);
  if (!token) return null;
  try {
    const { response, body } = await fetchAuthPayload(token);
    if (!response.ok) return null;
    return normalizeAuthUser(body);
  } catch {
    return null;
  }
}

async function profileFor(request: Request, env: Env) {
  const authUser = await authUserFor(request);
  const raw = authUser?.handle || request.headers.get('x-idea-handle') || 'guest';
  const handle = slug(raw) || 'guest';
  const profileId = `profile-${handle}`;
  await env.DB.prepare(
    `INSERT OR IGNORE INTO profiles (id, handle, display_name, reputation, badges_json)
     VALUES (?, ?, ?, 0, '[]')`,
  )
    .bind(profileId, handle, authUser?.displayName || handle.replace(/-/g, ' '))
    .run();
  return profileId;
}

async function handleAuth(request: Request, url: URL) {
  if (!url.pathname.startsWith(`${AUTH_PREFIX}/`) && url.pathname !== AUTH_PREFIX) return null;

  if (url.pathname === `${AUTH_PREFIX}/start`) {
    if (request.method !== 'GET') return methodNotAllowed('GET');
    const provider = url.searchParams.get('provider') || 'github';
    if (!AUTH_PROVIDERS.has(provider)) return new Response('unknown provider', { status: 404, headers: SECURITY_HEADERS });
    const returnPath = sameOriginPath(url, url.searchParams.get('return_to') || '/console/');
    const nonce = crypto.randomUUID();
    const callback = new URL(`${AUTH_PREFIX}/callback`, url.origin);
    callback.searchParams.set('return_to', returnPath);
    callback.searchParams.set('nonce', nonce);
    const start = new URL(`/v1/auth/${provider}/start`, AUTH_API_BASE);
    start.searchParams.set('app_id', AUTH_APP_ID);
    start.searchParams.set('return_to', callback.toString());
    start.searchParams.set('response_mode', 'query');
    return redirect(start.toString(), 302, [cookie(NONCE_COOKIE_NAME, nonce, NONCE_TTL_SECONDS)]);
  }

  if (url.pathname === `${AUTH_PREFIX}/callback`) {
    if (request.method !== 'GET') return methodNotAllowed('GET');
    const returnPath = sameOriginPath(url, url.searchParams.get('return_to') || '/console/');
    const nonce = url.searchParams.get('nonce');
    const storedNonce = readCookie(request.headers.get('Cookie'), NONCE_COOKIE_NAME);
    if (!nonce || nonce !== storedNonce) return redirect(`${url.origin}${returnPath}#auth_error=invalid_state`, 303, [clearCookie(NONCE_COOKIE_NAME)]);
    const session = url.searchParams.get('session') || url.searchParams.get('fas_session');
    if (!session) return redirect(`${url.origin}${returnPath}#auth_error=missing_session`, 303, [clearCookie(NONCE_COOKIE_NAME)]);
    const { response } = await fetchAuthPayload(session);
    if (!response.ok) return redirect(`${url.origin}${returnPath}#auth_error=invalid_session`, 303, [clearCookie(NONCE_COOKIE_NAME)]);
    return redirect(`${url.origin}${returnPath}`, 303, [
      cookie(SESSION_COOKIE_NAME, session, SESSION_TTL_SECONDS),
      clearCookie(NONCE_COOKIE_NAME),
    ]);
  }

  if (url.pathname === `${AUTH_PREFIX}/me`) {
    if (request.method !== 'GET') return methodNotAllowed('GET');
    const token = readCookie(request.headers.get('Cookie'), SESSION_COOKIE_NAME);
    if (!token) return json({ error: 'not signed in' }, { status: 401 });
    const { response, body } = await fetchAuthPayload(token);
    const authUser = response.ok ? normalizeAuthUser(body) : null;
    const headers: Record<string, string> = response.ok ? {} : { 'Set-Cookie': clearCookie(SESSION_COOKIE_NAME) };
    return json(authUser ? { user: authUser } : body, { status: response.status, headers });
  }

  if (url.pathname === `${AUTH_PREFIX}/logout`) {
    if (request.method !== 'POST') return methodNotAllowed('POST');
    if (!isSameOriginMutation(request)) return new Response('Forbidden', { status: 403, headers: SECURITY_HEADERS });
    return new Response(null, { status: 204, headers: { 'Set-Cookie': clearCookie(SESSION_COOKIE_NAME), 'Cache-Control': 'no-store' } });
  }

  return new Response('Not found', { status: 404, headers: SECURITY_HEADERS });
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
  let listType: 'ul' | 'ol' | null = null;

  const closeList = () => {
    if (listType) {
      html.push(`</${listType}>`);
      listType = null;
    }
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      closeList();
      continue;
    }
    const heading = trimmed.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      closeList();
      const tag = heading[1].length <= 2 ? 'h2' : 'h3';
      html.push(`<${tag} id="${escapeHtml(slug(heading[2]) || 'section')}">${escapeHtml(heading[2])}</${tag}>`);
      continue;
    }
    const listItem = trimmed.match(/^[-*]\s+(.+)$/);
    if (listItem) {
      if (listType !== 'ul') {
        closeList();
        html.push('<ul>');
        listType = 'ul';
      }
      html.push(`<li>${escapeHtml(listItem[1])}</li>`);
      continue;
    }
    const orderedItem = trimmed.match(/^\d+\.\s+(.+)$/);
    if (orderedItem) {
      if (listType !== 'ol') {
        closeList();
        html.push('<ol>');
        listType = 'ol';
      }
      html.push(`<li>${escapeHtml(orderedItem[1])}</li>`);
      continue;
    }
    closeList();
    html.push(`<p>${escapeHtml(trimmed)}</p>`);
  }
  closeList();
  return html.join('\n');
}

function markdownHeadings(markdown: string) {
  return markdown
    .split(/\r?\n/)
    .map((line) => line.trim().match(/^#{1,3}\s+(.+)$/)?.[1])
    .filter((title): title is string => Boolean(title))
    .map((title) => ({ title, id: slug(title) || 'section' }));
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

async function listContributors(env: Env) {
  const rows = await env.DB.prepare(
    `SELECT
       p.id,
       p.handle,
       p.display_name,
       p.bio,
       p.reputation,
       p.badges_json,
       COUNT(DISTINCT i.id) AS idea_count,
       COUNT(DISTINCT c.id) AS contribution_count,
       COUNT(DISTINCT r.id) AS reaction_count
     FROM profiles p
     LEFT JOIN ideas i ON i.created_by = p.id AND i.status != 'removed'
     LEFT JOIN contributions c ON c.profile_id = p.id
     LEFT JOIN reactions r ON r.profile_id = p.id
     WHERE p.handle NOT IN (${HIDDEN_CONTRIBUTOR_HANDLES})
     GROUP BY p.id
     ORDER BY p.reputation DESC, contribution_count DESC, idea_count DESC, p.handle ASC
     LIMIT 100`,
  ).all<ContributorRow>();
  return rows.results || [];
}

async function contributorByHandle(env: Env, handle: string) {
  return env.DB.prepare(
    `SELECT
       p.id,
       p.handle,
       p.display_name,
       p.bio,
       p.reputation,
       p.badges_json,
       COUNT(DISTINCT i.id) AS idea_count,
       COUNT(DISTINCT c.id) AS contribution_count,
       COUNT(DISTINCT r.id) AS reaction_count
     FROM profiles p
     LEFT JOIN ideas i ON i.created_by = p.id AND i.status != 'removed'
     LEFT JOIN contributions c ON c.profile_id = p.id
     LEFT JOIN reactions r ON r.profile_id = p.id
     WHERE p.handle = ? AND p.handle NOT IN (${HIDDEN_CONTRIBUTOR_HANDLES})
     GROUP BY p.id`,
  )
    .bind(handle)
    .first<ContributorRow>();
}

function parseBadges(value: unknown) {
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    return Array.isArray(parsed) ? parsed.map((item) => String(item)).slice(0, 12) : [];
  } catch {
    return [];
  }
}

function initials(value: string) {
  const parts = value
    .replace(/[^a-z0-9 -]/gi, '')
    .split(/[\s-]+/)
    .filter(Boolean);
  return (parts[0]?.[0] || 'U').toUpperCase() + (parts[1]?.[0] || '').toUpperCase();
}

function profileStrength(person: ContributorRow) {
  return Math.min(
    100,
    Math.round(
      Number(person.reputation || 0) * 0.24 +
        Number(person.contribution_count || 0) * 16 +
        Number(person.idea_count || 0) * 10 +
        Number(person.reaction_count || 0) * 5,
    ),
  );
}

function formatDate(value: unknown) {
  const time = Date.parse(String(value || ''));
  if (!Number.isFinite(time)) return '';
  return new Date(time).toLocaleDateString('en-AU', { year: 'numeric', month: 'short', day: 'numeric' });
}

function renderMix(rows: Array<Record<string, unknown>>, labelKey: string, valueKey: string) {
  const total = rows.reduce((sum, row) => sum + Number(row[valueKey] || 0), 0);
  if (!total) return '<p class="empty">No signal mix yet.</p>';
  return rows
    .map((row) => {
      const label = String(row[labelKey] || 'unknown');
      const count = Number(row[valueKey] || 0);
      const pct = Math.max(4, Math.round((count / total) * 100));
      return `<div class="mix-row"><div><strong>${escapeHtml(label)}</strong><span>${escapeHtml(count)} event${count === 1 ? '' : 's'}</span></div><i style="width:${pct}%"></i></div>`;
    })
    .join('');
}

function accountAvatar(user: AuthUser, size = 40) {
  const dimension = `${size}px`;
  if (user.avatarUrl) {
    return `<img src="${escapeHtml(user.avatarUrl)}" alt="${escapeHtml(user.handle)}" width="${escapeHtml(size)}" height="${escapeHtml(size)}">`;
  }
  return `<span style="width:${dimension};height:${dimension}">${escapeHtml(initials(user.displayName || user.handle))}</span>`;
}

function renderContributorShell(title: string, body: string, request: Request) {
  return new Response(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>${escapeHtml(title)} - FreeIdeaStore</title>
<meta name="description" content="FreeIdeaStore contributor reputation, ideas, critiques, support, pivots, and research activity.">
<link rel="canonical" href="${escapeHtml(new URL(request.url).origin)}${escapeHtml(new URL(request.url).pathname)}">
<link rel="icon" type="image/svg+xml" href="/favicon.svg">
<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,700;9..144,800&family=Manrope:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<style>
*{box-sizing:border-box;margin:0;padding:0}:root{--accent:#0891b2;--gold:#f59e0b;--paper:#f7faf9;--panel:#fff;--ink:#102027;--muted:#5d6f78;--line:#d8e3e6}
body{background:var(--paper);color:var(--ink);font-family:Manrope,system-ui,sans-serif;line-height:1.5}a{color:inherit;text-decoration:none}
header{position:sticky;top:0;z-index:10;display:flex;align-items:center;gap:1rem;border-bottom:1px solid var(--line);background:rgba(255,255,255,.94);padding:.7rem 1.25rem;backdrop-filter:blur(14px)}
.brand{display:flex;align-items:center;gap:.6rem;font-weight:800}.mark{display:grid;height:34px;width:34px;place-items:center;border-radius:8px;background:#102027;color:#67e8f9;font-weight:900}.brand span:last-child{font-family:Fraunces,serif}nav{margin-left:auto;display:flex;gap:.9rem;color:var(--muted);font-size:.8rem;font-weight:800}
.shell{max-width:1120px;margin:0 auto;padding:2rem 1.25rem}.eyebrow{color:var(--accent);font-size:.72rem;font-weight:900;letter-spacing:.12em;text-transform:uppercase}h1{font-family:Fraunces,serif;font-size:clamp(2.1rem,5vw,4.2rem);line-height:.98;margin:.45rem 0 1rem}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:.85rem}.profile-grid{display:grid;grid-template-columns:minmax(0,1fr) 330px;gap:1rem;align-items:start}.card,.panel,.hero-card{border:1px solid var(--line);border-radius:8px;background:var(--panel);padding:1rem;box-shadow:0 10px 22px rgba(16,32,39,.04)}.hero-card{display:grid;grid-template-columns:88px 1fr;gap:1rem;align-items:center;margin-bottom:1rem}.avatar{display:grid;width:88px;height:88px;place-items:center;border-radius:50%;background:#102027;color:#67e8f9;font-size:1.8rem;font-weight:900;box-shadow:inset 0 -7px 0 rgba(245,158,11,.9)}.card h2,.panel h2{font-size:1rem}.profile-title{display:flex;flex-wrap:wrap;align-items:center;gap:.5rem}.profile-title h1{margin:.1rem 0;font-size:clamp(2rem,4vw,3.5rem)}.muted{color:var(--muted);font-size:.88rem}.meta{display:flex;flex-wrap:wrap;gap:.35rem;margin:.65rem 0}.pill{border:1px solid var(--line);border-radius:999px;background:#ecfeff;color:#155e75;font-size:.68rem;font-weight:900;padding:.22rem .48rem;text-transform:uppercase}.pill.gold{background:#fffbeb;color:#92400e}.stats{display:grid;grid-template-columns:repeat(3,1fr);gap:.45rem;margin-top:.8rem}.stat{border-left:3px solid var(--line);padding-left:.55rem}.stat strong{display:block;font-size:1.05rem}.stat span{color:var(--muted);font-size:.7rem;font-weight:800}.score{display:grid;gap:.35rem}.score strong{font-size:2rem}.meter{height:10px;border-radius:999px;background:#e6f3f5;overflow:hidden}.meter i{display:block;height:100%;border-radius:999px;background:linear-gradient(90deg,var(--accent),var(--gold))}.list{display:grid;gap:.55rem;margin-top:1rem}.item{border:1px solid var(--line);border-radius:8px;background:#fbfdfd;padding:.75rem}.item strong{display:block}.item span,.item time{display:block;color:var(--muted);font-size:.78rem;margin-top:.2rem}.button{display:inline-flex;border:1px solid var(--accent);border-radius:8px;background:var(--accent);color:white;padding:.55rem .7rem;font-size:.78rem;font-weight:900;margin-top:.8rem}.empty{color:var(--muted);font-size:.85rem}.mix{display:grid;gap:.55rem;margin-top:.75rem}.mix-row{display:grid;gap:.32rem}.mix-row div{display:flex;justify-content:space-between;gap:.75rem;font-size:.78rem}.mix-row span{color:var(--muted)}.mix-row i{display:block;height:8px;border-radius:999px;background:var(--accent)}@media(max-width:860px){nav{display:none}.profile-grid{grid-template-columns:1fr}.hero-card{grid-template-columns:64px 1fr}.avatar{width:64px;height:64px;font-size:1.25rem}}@media(max-width:760px){.stats{grid-template-columns:1fr}}
</style>
</head>
<body><header><a href="/" class="brand"><span class="mark">FI</span><span>FreeIdeaStore</span></a><nav><a href="/#ideas">Ideas</a><a href="/contributors/">Contributors</a><a href="/console/">Console</a><a href="https://proideastore.online">ProIdeaStore</a></nav></header><main class="shell">${body}</main></body></html>`, {
    headers: { ...SECURITY_HEADERS, 'Content-Type': 'text/html;charset=UTF-8', 'Cache-Control': 'public, max-age=60' },
  });
}

async function renderContributorsPage(env: Env, request: Request) {
  const contributors = await listContributors(env);
  const cards = contributors
    .map((person) => {
      const badges = parseBadges(person.badges_json);
      const strength = profileStrength(person);
      return `<article class="card">
        <div class="profile-title"><div class="avatar" style="width:48px;height:48px;font-size:1rem">${escapeHtml(initials(person.display_name))}</div><h2><a href="/contributors/${escapeHtml(person.handle)}/">${escapeHtml(person.display_name)}</a></h2></div>
        <div class="meta"><span class="pill">@${escapeHtml(person.handle)}</span><span class="pill gold">${escapeHtml(strength)} strength</span>${badges.map((badge) => `<span class="pill">${escapeHtml(badge)}</span>`).join('')}</div>
        <p>${escapeHtml(person.bio || 'Contributor reputation grows when ideas get sharper, safer, or honestly trashed.')}</p>
        <div class="stats"><div class="stat"><strong>${escapeHtml(person.idea_count)}</strong><span>ideas</span></div><div class="stat"><strong>${escapeHtml(person.contribution_count)}</strong><span>notes</span></div><div class="stat"><strong>${escapeHtml(person.reaction_count)}</strong><span>signals</span></div></div>
      </article>`;
    })
    .join('');
  return renderContributorShell(
    'Contributors',
    `<div class="eyebrow">People behind the ideas</div><h1>Contributor reputation.</h1>${
      cards
        ? `<section class="grid">${cards}</section>`
        : '<section class="panel"><h2>No public contributors yet.</h2><p class="muted">Real profiles appear here after signed-in people create ideas, add evidence, support, trash, or pivot work.</p><a class="button" href="/console/">Open console</a></section>'
    }`,
    request,
  );
}

async function renderContributorPage(env: Env, request: Request, handle: string) {
  const person = await contributorByHandle(env, handle);
  if (!person) return new Response('Contributor not found', { status: 404, headers: SECURITY_HEADERS });
  const ideas = await env.DB.prepare(
    `SELECT id, title, summary, stage, category, updated_at
     FROM ideas
     WHERE created_by = ? AND status != 'removed'
     ORDER BY updated_at DESC
     LIMIT 30`,
  )
    .bind(person.id)
    .all<Record<string, string>>();
  const contributions = await env.DB.prepare(
    `SELECT c.kind, c.body, c.created_at, i.id AS idea_id, i.title AS idea_title
     FROM contributions c
     JOIN ideas i ON i.id = c.idea_id
     WHERE c.profile_id = ?
     ORDER BY c.created_at DESC
     LIMIT 40`,
  )
    .bind(person.id)
    .all<Record<string, string>>();
  const contributionMix = await env.DB.prepare(
    `SELECT kind, COUNT(*) AS count
     FROM contributions
     WHERE profile_id = ?
     GROUP BY kind
     ORDER BY count DESC, kind ASC`,
  )
    .bind(person.id)
    .all<Record<string, unknown>>();
  const reactionMix = await env.DB.prepare(
    `SELECT type, COUNT(*) AS count
     FROM reactions
     WHERE profile_id = ?
     GROUP BY type
     ORDER BY count DESC, type ASC`,
  )
    .bind(person.id)
    .all<Record<string, unknown>>();
  const badges = parseBadges(person.badges_json);
  const strength = profileStrength(person);
  return renderContributorShell(
    person.display_name,
    `<section class="hero-card">
      <div class="avatar">${escapeHtml(initials(person.display_name))}</div>
      <div>
        <div class="eyebrow">Contributor profile</div>
        <div class="profile-title"><h1>${escapeHtml(person.display_name)}</h1><span class="pill gold">${escapeHtml(strength)} strength</span></div>
        <div class="meta"><span class="pill">@${escapeHtml(person.handle)}</span>${badges.map((badge) => `<span class="pill">${escapeHtml(badge)}</span>`).join('')}</div>
        <p class="muted">${escapeHtml(person.bio || 'This profile records idea creation, critique, evidence, pivots, support signals, and visible product judgment.')}</p>
      </div>
    </section>
    <section class="profile-grid">
      <div>
        <section class="panel">
          <h2>Public work</h2>
          <div class="stats"><div class="stat"><strong>${escapeHtml(person.idea_count)}</strong><span>ideas created</span></div><div class="stat"><strong>${escapeHtml(person.contribution_count)}</strong><span>contributions</span></div><div class="stat"><strong>${escapeHtml(person.reaction_count)}</strong><span>support/trash/pivot signals</span></div></div>
        </section>
        <section class="panel" style="margin-top:1rem"><h2>Ideas created</h2><div class="list">${(ideas.results || []).map((idea) => `<a class="item" href="/ideas/${escapeHtml(idea.id)}/"><strong>${escapeHtml(idea.title)}</strong><span>${escapeHtml(idea.stage)} / ${escapeHtml(idea.category)} - ${escapeHtml(idea.summary)}</span><time>${escapeHtml(formatDate(idea.updated_at))}</time></a>`).join('') || '<p class="empty">No ideas created yet.</p>'}</div></section>
        <section class="panel" style="margin-top:1rem"><h2>Recent contributions</h2><div class="list">${(contributions.results || []).map((item) => `<a class="item" href="/ideas/${escapeHtml(item.idea_id)}/"><strong>${escapeHtml(item.kind)} on ${escapeHtml(item.idea_title)}</strong><span>${escapeHtml(item.body)}</span><time>${escapeHtml(formatDate(item.created_at))}</time></a>`).join('') || '<p class="empty">No contributions yet.</p>'}</div></section>
      </div>
      <aside>
        <section class="panel score"><h2>Profile strength</h2><strong>${escapeHtml(strength)}%</strong><div class="meter"><i style="width:${escapeHtml(strength)}%"></i></div><p class="muted">Weighted from reputation, useful notes, ideas created, and store signals.</p></section>
        <section class="panel" style="margin-top:1rem"><h2>Contribution mix</h2><div class="mix">${renderMix(contributionMix.results || [], 'kind', 'count')}</div></section>
        <section class="panel" style="margin-top:1rem"><h2>Signal mix</h2><div class="mix">${renderMix(reactionMix.results || [], 'type', 'count')}</div></section>
        <section class="panel" style="margin-top:1rem"><h2>Best fit</h2><p class="muted">Invite this person when an idea needs ${person.contribution_count ? 'evidence, critique, risk naming, or a sharper pivot' : 'first useful feedback and lightweight validation'}.</p><a class="button" href="/console/">Create an idea</a></section>
      </aside>
    </section>`,
    request,
  );
}

async function renderAccountPage(env: Env, request: Request) {
  const user = await authUserFor(request);
  const profile = user ? await contributorByHandle(env, user.handle) : null;
  const publicUrl = user ? `/contributors/${escapeHtml(user.handle)}/` : '/contributors/';
  return new Response(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>Profile - FreeIdeaStore</title>
<meta name="description" content="Manage your FreeIdeaStore account, public profile, appearance, and sign-in state.">
<link rel="canonical" href="${escapeHtml(new URL(request.url).origin)}/profile/">
<link rel="icon" type="image/svg+xml" href="/favicon.svg">
<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,700;9..144,800&family=Manrope:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<style>
*{box-sizing:border-box;margin:0;padding:0}:root{--accent:#0891b2;--gold:#f59e0b;--paper:#f7faf9;--panel:#fff;--ink:#102027;--muted:#5d6f78;--line:#d8e3e6;--bad:#dc2626}body{background:var(--paper);color:var(--ink);font-family:Manrope,system-ui,sans-serif;line-height:1.5}a{color:inherit;text-decoration:none}button{font:inherit}header{position:sticky;top:0;z-index:10;display:flex;align-items:center;gap:1rem;border-bottom:1px solid var(--line);background:rgba(255,255,255,.94);padding:.7rem 1.25rem;backdrop-filter:blur(14px)}.brand{display:flex;align-items:center;gap:.6rem;font-weight:800}.mark{display:grid;height:34px;width:34px;place-items:center;border-radius:8px;background:#102027;color:#67e8f9;font-weight:900}.brand span:last-child{font-family:Fraunces,serif}nav{margin-left:auto;display:flex;align-items:center;gap:.9rem;color:var(--muted);font-size:.8rem;font-weight:800}.account-avatar{display:inline-grid;width:36px;height:36px;place-items:center;border:2px solid var(--line);border-radius:50%;overflow:hidden;background:white}.account-avatar img{width:100%;height:100%;object-fit:cover}.account-avatar span{display:grid;place-items:center;border-radius:50%;background:#102027;color:#67e8f9;font-weight:900}.shell{max-width:560px;margin:0 auto;padding:2rem 1.25rem}.identity{display:flex;gap:1rem;align-items:center;margin-bottom:1.5rem}.avatar-large{display:grid;width:72px;height:72px;place-items:center;border-radius:50%;overflow:hidden;background:#102027;color:#67e8f9;font-size:1.5rem;font-weight:900;box-shadow:inset 0 -6px 0 rgba(245,158,11,.9)}.avatar-large img{width:100%;height:100%;object-fit:cover}h1{font-family:Fraunces,serif;font-size:clamp(2rem,5vw,3.2rem);line-height:1}.muted{color:var(--muted);font-size:.88rem}.panel{border:1px solid var(--line);border-radius:8px;background:white;padding:1rem;margin-bottom:1rem;box-shadow:0 10px 22px rgba(16,32,39,.04)}.panel h2{font-size:.95rem;margin-bottom:.75rem}.row{display:flex;justify-content:space-between;gap:1rem;border-top:1px solid var(--line);padding:.7rem 0}.row:first-of-type{border-top:0}.row span{color:var(--muted);font-size:.85rem}.button{display:inline-flex;align-items:center;justify-content:center;border:1px solid var(--accent);border-radius:8px;background:var(--accent);color:white;cursor:pointer;padding:.62rem .85rem;font-weight:900}.button.secondary{background:white;color:var(--accent)}.button.danger{border-color:var(--bad);background:white;color:var(--bad)}.seg{display:flex;gap:.5rem;flex-wrap:wrap}.seg button{border:1px solid var(--line);border-radius:8px;background:white;color:var(--ink);cursor:pointer;padding:.5rem .65rem;font-weight:800}.seg button.active{border-color:var(--accent);background:#ecfeff;color:#155e75}.danger{border-color:#fecaca}.actions{display:flex;gap:.55rem;flex-wrap:wrap}@media(max-width:760px){nav a:not(.account-avatar){display:none}}
</style>
</head>
<body>
<header><a href="/" class="brand"><span class="mark">FI</span><span>FreeIdeaStore</span></a><nav><a href="/#ideas">Ideas</a><a href="/contributors/">Contributors</a><a href="/console/">Console</a>${user ? `<a class="account-avatar" href="/profile/" aria-label="Profile">${accountAvatar(user, 36)}</a>` : `<a href="/console/">Sign in</a>`}</nav></header>
<main class="shell">
  ${
    user
      ? `<section class="identity"><div class="avatar-large">${accountAvatar(user, 72)}</div><div><h1>${escapeHtml(user.displayName)}</h1><p class="muted">@${escapeHtml(user.handle)} / ${escapeHtml(user.provider)} account</p></div></section>
        <section class="panel"><h2>Public profile</h2><div class="row"><strong>Profile page</strong><span>${publicUrl}</span></div><div class="row"><strong>Ideas</strong><span>${escapeHtml(profile?.idea_count ?? 0)}</span></div><div class="row"><strong>Contributions</strong><span>${escapeHtml(profile?.contribution_count ?? 0)}</span></div><div class="actions"><a class="button" href="${publicUrl}">Open public profile</a><a class="button secondary" href="/console/">Create idea</a></div></section>
        <section class="panel"><h2>Appearance</h2><p class="muted" style="margin-bottom:.75rem">Stored on this browser.</p><div class="seg" id="theme-controls"><button data-theme="system">System</button><button data-theme="light">Light</button><button data-theme="dark">Dark</button></div></section>
        <section class="panel"><h2>Account</h2><button class="button secondary" id="logout" type="button">Sign out</button></section>
        <section class="panel danger"><h2>Danger zone</h2><p class="muted" style="margin-bottom:.75rem">Account deletion must be handled by the shared FreeAppStore identity service. This store will not fake-delete shared identity data.</p><button class="button danger" type="button" disabled>Delete account unavailable here</button></section>`
      : `<section class="panel"><h1>Profile</h1><p class="muted" style="margin:1rem 0">Sign in to view your profile.</p><div class="actions"><a class="button" href="${AUTH_PREFIX}/start?provider=github&return_to=/profile/">Sign in with GitHub</a><a class="button secondary" href="${AUTH_PREFIX}/start?provider=google&return_to=/profile/">Sign in with Google</a></div></section>`
  }
</main>
<script>
const storedTheme = localStorage.getItem('fis:theme') || 'system';
document.querySelectorAll('[data-theme]').forEach((button) => {
  button.classList.toggle('active', button.dataset.theme === storedTheme);
  button.addEventListener('click', () => {
    localStorage.setItem('fis:theme', button.dataset.theme);
    document.querySelectorAll('[data-theme]').forEach((item) => item.classList.toggle('active', item === button));
  });
});
document.querySelector('#logout')?.addEventListener('click', async () => {
  await fetch('${AUTH_PREFIX}/logout', { method: 'POST' });
  location.href = '/';
});
</script>
</body></html>`, {
    headers: { ...SECURITY_HEADERS, 'Content-Type': 'text/html;charset=UTF-8', 'Cache-Control': 'no-store' },
  });
}

function renderConsolePage(request: Request) {
  const origin = new URL(request.url).origin;
  return new Response(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>Console - FreeIdeaStore</title>
<meta name="description" content="Create, draft, and attribute new FreeIdeaStore ideas with GitHub or Google sign-in.">
<link rel="canonical" href="${escapeHtml(origin)}/console/">
<link rel="icon" type="image/svg+xml" href="/favicon.svg">
<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,700;9..144,800&family=Manrope:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<style>
*{box-sizing:border-box;margin:0;padding:0}:root{--accent:#0891b2;--gold:#f59e0b;--paper:#f7faf9;--panel:#fff;--ink:#102027;--muted:#5d6f78;--line:#d8e3e6;--bad:#dc2626}
body{background:var(--paper);color:var(--ink);font-family:Manrope,system-ui,sans-serif;line-height:1.5}a{color:inherit;text-decoration:none}button,input,textarea,select{font:inherit}
header{position:sticky;top:0;z-index:10;display:flex;align-items:center;gap:1rem;border-bottom:1px solid var(--line);background:rgba(255,255,255,.94);padding:.7rem 1.25rem;backdrop-filter:blur(14px)}.brand{display:flex;align-items:center;gap:.6rem;font-weight:800}.mark{display:grid;height:34px;width:34px;place-items:center;border-radius:8px;background:#102027;color:#67e8f9;font-weight:900}.brand span:last-child{font-family:Fraunces,serif}nav{margin-left:auto;display:flex;align-items:center;gap:.9rem;color:var(--muted);font-size:.8rem;font-weight:800}.account-avatar{display:inline-grid;width:36px;height:36px;place-items:center;border:2px solid var(--line);border-radius:50%;overflow:hidden;background:white}.account-avatar img{width:100%;height:100%;object-fit:cover}.account-avatar span{display:grid;width:100%;height:100%;place-items:center;border-radius:50%;background:#102027;color:#67e8f9;font-weight:900}
.shell{max-width:1120px;margin:0 auto;padding:2rem 1.25rem}.eyebrow{color:var(--accent);font-size:.72rem;font-weight:900;letter-spacing:.12em;text-transform:uppercase}h1{font-family:Fraunces,serif;font-size:clamp(2.1rem,5vw,4.4rem);line-height:.98;margin:.45rem 0 1rem}.layout{display:grid;grid-template-columns:minmax(0,1fr) 330px;gap:1rem;align-items:start}.panel{border:1px solid var(--line);border-radius:8px;background:var(--panel);padding:1rem;box-shadow:0 10px 22px rgba(16,32,39,.04)}.panel h2{font-size:1rem;margin-bottom:.6rem}.muted{color:var(--muted);font-size:.86rem}.auth{display:grid;gap:.5rem}.button{display:inline-flex;justify-content:center;align-items:center;border:1px solid var(--accent);border-radius:8px;background:var(--accent);color:white;cursor:pointer;padding:.65rem .85rem;font-weight:900}.button.secondary{background:white;color:var(--accent)}.button.danger{border-color:var(--bad);background:white;color:var(--bad)}form{display:grid;gap:.75rem}label{display:grid;gap:.3rem;color:var(--muted);font-size:.78rem;font-weight:900;text-transform:uppercase}input,textarea,select{width:100%;border:1px solid var(--line);border-radius:8px;background:white;color:var(--ink);padding:.65rem}textarea{min-height:120px;resize:vertical}.split{display:grid;grid-template-columns:1fr 1fr;gap:.75rem}.status{border:1px solid var(--line);border-radius:8px;background:#fbfdfd;color:var(--muted);padding:.75rem;font-size:.84rem;margin-top:.75rem}.status.ok{border-color:#99f6e4;color:#115e59}.status.err{border-color:#fecaca;color:#991b1b}@media(max-width:840px){.layout{grid-template-columns:1fr}nav{display:none}.split{grid-template-columns:1fr}}
</style>
</head>
<body>
<header><a href="/" class="brand"><span class="mark">FI</span><span>FreeIdeaStore</span></a><nav><a href="/#ideas">Ideas</a><a href="/contributors/">Contributors</a><a href="/console/">Console</a><span id="account-slot"></span><a href="https://proideastore.online">ProIdeaStore</a></nav></header>
<main class="shell">
  <div class="eyebrow">Creation console</div><h1>Put an idea into the refinery.</h1>
  <div class="layout">
    <section class="panel">
      <form id="idea-form">
        <label>Title<input name="title" required minlength="3" maxlength="120" placeholder="Example: Local repair marketplace"></label>
        <label>Summary<textarea name="summary" required minlength="10" maxlength="1000" placeholder="Who has the problem, what hurts, and why this may be worth exploring?"></textarea></label>
        <div class="split">
          <label>Stage<select name="stage"><option>raw</option><option>critique</option><option>researched</option><option>pivot</option><option>prototype</option><option>built</option></select></label>
          <label>Category<input name="category" maxlength="60" placeholder="platform, finance, local-services"></label>
        </div>
        <label>Preview<textarea name="preview" maxlength="1000" placeholder="Short public card preview or current signal."></textarea></label>
        <label>Next step<input name="nextStep" maxlength="500" placeholder="Cheapest validation step."></label>
        <label>Risk<input name="risk" maxlength="500" placeholder="Main reason this could fail."></label>
        <label>Body markdown<textarea name="body" maxlength="24000" placeholder="## Snapshot&#10;## Brainstorming Log&#10;## Research Notes&#10;## Prototype Plan"></textarea></label>
        <label id="guest-label">Guest handle<input name="handle" maxlength="40" placeholder="only used when not signed in"></label>
        <button class="button" type="submit">Create idea</button>
      </form>
      <div id="status" class="status">Drafts are attributed to your signed-in profile when available.</div>
    </section>
    <aside class="panel">
      <h2>Session</h2>
      <p id="session" class="muted">Checking sign-in...</p>
      <div class="auth" id="auth-actions">
        <a class="button" href="${AUTH_PREFIX}/start?provider=github&return_to=/console/">Sign in with GitHub</a>
        <a class="button secondary" href="${AUTH_PREFIX}/start?provider=google&return_to=/console/">Sign in with Google</a>
      </div>
    </aside>
  </div>
</main>
<script>
const form = document.querySelector('#idea-form');
const statusBox = document.querySelector('#status');
const sessionBox = document.querySelector('#session');
const actions = document.querySelector('#auth-actions');
const guestLabel = document.querySelector('#guest-label');
const accountSlot = document.querySelector('#account-slot');
let signedInUser = null;
function setStatus(message, kind = '') { statusBox.className = 'status ' + kind; statusBox.textContent = message; }
function initials(value) {
  return String(value || 'U').split(/[\\s-]+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase() || 'U';
}
function avatarLink(user) {
  const inner = user.avatarUrl ? '<img src="' + user.avatarUrl.replaceAll('"', '&quot;') + '" alt="' + user.handle.replaceAll('"', '&quot;') + '">' : '<span>' + initials(user.displayName || user.handle) + '</span>';
  return '<a class="account-avatar" href="/profile/" aria-label="Profile">' + inner + '</a>';
}
async function loadSession() {
  const response = await fetch('${AUTH_PREFIX}/me').catch(() => null);
  if (!response || !response.ok) {
    sessionBox.textContent = 'Not signed in. You can test with a guest handle, but public attribution should use GitHub or Google.';
    accountSlot.innerHTML = '<a href="${AUTH_PREFIX}/start?provider=github&return_to=/console/">Sign in</a>';
    return;
  }
  const data = await response.json();
  signedInUser = data.user;
  sessionBox.textContent = 'Signed in as @' + signedInUser.handle + ' via ' + signedInUser.provider + '.';
  accountSlot.innerHTML = avatarLink(signedInUser);
  guestLabel.style.display = 'none';
  actions.innerHTML = '<button class="button danger" id="logout" type="button">Sign out</button>';
  document.querySelector('#logout').addEventListener('click', async () => {
    await fetch('${AUTH_PREFIX}/logout', { method: 'POST' });
    location.reload();
  });
}
form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(form).entries());
  const headers = { 'content-type': 'application/json' };
  if (!signedInUser && data.handle) headers['x-idea-handle'] = data.handle;
  const response = await fetch('/api/ideas', { method: 'POST', headers, body: JSON.stringify(data) });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) return setStatus(result.error || 'Could not create idea.', 'err');
  setStatus('Idea created. Opening the public page...', 'ok');
  location.href = result.url;
});
loadSession();
</script>
</body></html>`, {
    headers: { ...SECURITY_HEADERS, 'Content-Type': 'text/html;charset=UTF-8', 'Cache-Control': 'no-store' },
  });
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
  const headings = markdownHeadings(body);
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
:root{--accent:#0891b2;--accent-dark:#155e75;--gold:#f59e0b;--paper:#f7faf9;--panel:#fff;--ink:#102027;--muted:#5d6f78;--line:#d8e3e6;--good:#16a34a;--bad:#dc2626}
body{background:var(--paper);color:var(--ink);font-family:Manrope,system-ui,sans-serif;line-height:1.55}
a{color:inherit;text-decoration:none}
header{position:sticky;top:0;z-index:10;display:flex;align-items:center;gap:1rem;border-bottom:1px solid var(--line);background:rgba(255,255,255,.94);padding:.7rem 1.25rem;backdrop-filter:blur(14px)}
.brand{display:flex;align-items:center;gap:.6rem;font-weight:800}.logo{display:grid;height:34px;width:34px;place-items:center;border-radius:8px;background:#102027;color:#67e8f9;box-shadow:inset 0 -4px 0 rgba(245,158,11,.9);font-weight:900}.brand span:last-child{font-family:Fraunces,serif}
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
.side{display:grid;gap:.85rem}.side h2{font-size:.82rem;text-transform:uppercase;color:var(--muted);letter-spacing:.1em}.side div{border-left:3px solid var(--line);padding-left:.65rem}.side strong{display:block;font-size:.74rem;text-transform:uppercase}.side span{display:block;color:var(--muted);font-size:.82rem}.toc{display:grid;gap:.28rem}.toc a{color:var(--accent-dark);font-size:.78rem;font-weight:800}.actions{display:flex;gap:.5rem;flex-wrap:wrap}.button{border:1px solid var(--accent);border-radius:8px;background:var(--accent);color:white;padding:.58rem .75rem;font-size:.78rem;font-weight:900}.button.secondary{background:white;color:var(--accent-dark)}
@media(max-width:820px){nav{display:none}.layout{grid-template-columns:1fr}}
</style>
</head>
<body>
<header><a href="/" class="brand"><span class="logo">FI</span><span>FreeIdeaStore</span></a><nav><a href="/#ideas">Ideas</a><a href="/contributors/">Contributors</a><a href="/console/">Console</a><a href="https://proideastore.online">ProIdeaStore</a></nav></header>
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
      ${headings.length ? `<div><strong>Sections</strong><span class="toc">${headings.map((heading) => `<a href="#${escapeHtml(heading.id)}">${escapeHtml(heading.title)}</a>`).join('')}</span></div>` : ''}
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

  if (url.pathname === '/api/session' && request.method === 'GET') {
    const user = await authUserFor(request);
    return user ? json({ user }) : json({ error: 'not signed in' }, { status: 401 });
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
    return json({ profiles: await listContributors(env) });
  }

  if (url.pathname === '/api/contributors' && request.method === 'GET') {
    return json({ contributors: await listContributors(env) });
  }

  const contributorMatch = url.pathname.match(/^\/api\/contributors\/([^/]+)$/);
  if (contributorMatch && request.method === 'GET') {
    const handle = pathId(contributorMatch[1]);
    if (!handle) return bad('invalid contributor handle', 400);
    const contributor = await contributorByHandle(env, handle);
    if (!contributor) return bad('contributor not found', 404);
    return json({ contributor, url: `/contributors/${contributor.handle}/` });
  }

  return bad('not found', 404);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    const authResponse = await handleAuth(request, url);
    if (authResponse) return authResponse;

    if (url.pathname.startsWith('/api/')) {
      try {
        return await handleApi(request, env, url);
      } catch (error) {
        return json({ error: error instanceof Error ? error.message : 'internal error' }, { status: 500 });
      }
    }

    const ideaSectionMatch = url.pathname.match(/^\/ideas\/([^/]+)\/([^/]+)\/?$/);
    if (ideaSectionMatch) {
      const ideaId = pathId(ideaSectionMatch[1]);
      const sectionId = pathId(ideaSectionMatch[2]);
      if (!ideaId || !sectionId) return new Response('Idea not found', { status: 404, headers: SECURITY_HEADERS });
      return Response.redirect(`${url.origin}/ideas/${ideaId}/#${sectionId}`, 302);
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

    if (url.pathname === '/console' || url.pathname === '/console/') {
      return renderConsolePage(request);
    }

    if (url.pathname === '/contributors' || url.pathname === '/contributors/') {
      try {
        return await renderContributorsPage(env, request);
      } catch (error) {
        return json({ error: error instanceof Error ? error.message : 'internal error' }, { status: 500 });
      }
    }

    if (url.pathname === '/profile' || url.pathname === '/profile/') {
      try {
        return await renderAccountPage(env, request);
      } catch (error) {
        return json({ error: error instanceof Error ? error.message : 'internal error' }, { status: 500 });
      }
    }

    const contributorPageMatch = url.pathname.match(/^\/(?:contributors|users)\/([^/]+)\/?$/);
    if (contributorPageMatch) {
      try {
        const handle = pathId(contributorPageMatch[1]);
        if (!handle) return new Response('Contributor not found', { status: 404, headers: SECURITY_HEADERS });
        return await renderContributorPage(env, request, handle);
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
