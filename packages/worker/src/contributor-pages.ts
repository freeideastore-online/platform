import { contributorByHandle, contributionsByProfile, ideasByProfile, listContributors } from './data';
import type { ContributorRow, Env } from './types';

const SECURITY_HEADERS: Record<string, string> = {
  'Content-Security-Policy':
    "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data: https:; connect-src 'self'; frame-ancestors 'self'; base-uri 'self'; form-action 'self'",
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'SAMEORIGIN',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
};

function escapeHtml(value: unknown) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
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
<body><header><a href="/" class="brand"><span class="mark">FI</span><span>FreeIdeaStore</span></a><nav><a href="/#ideas">Ideas</a><a href="/about/">About</a><a href="/docs/">Docs</a><a href="/skills/">Skills</a><a href="/contributors/">Contributors</a><a href="/console/">Console</a><a href="https://proideastore.online">ProIdeaStore</a></nav></header><main class="shell">${body}</main></body></html>`, {
    headers: { ...SECURITY_HEADERS, 'Content-Type': 'text/html;charset=UTF-8', 'Cache-Control': 'public, max-age=60' },
  });
}

export async function renderContributorsPage(env: Env, request: Request) {
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

export async function renderContributorPage(env: Env, request: Request, handle: string) {
  const person = await contributorByHandle(env, handle);
  if (!person) return new Response('Contributor not found', { status: 404, headers: SECURITY_HEADERS });
  const ideas = await ideasByProfile(env, person.id, 30);
  const contributions = await contributionsByProfile(env, person.id, 40);
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
        <section class="panel" style="margin-top:1rem"><h2>Ideas created</h2><div class="list">${ideas.map((idea) => `<a class="item" href="/ideas/${escapeHtml(idea.id)}/"><strong>${escapeHtml(idea.title)}</strong><span>${escapeHtml(idea.stage)} / ${escapeHtml(idea.category)} - ${escapeHtml(idea.summary)}</span><time>${escapeHtml(formatDate(idea.updated_at))}</time></a>`).join('') || '<p class="empty">No ideas created yet.</p>'}</div></section>
        <section class="panel" style="margin-top:1rem"><h2>Recent contributions</h2><div class="list">${contributions.map((item) => `<a class="item" href="/ideas/${escapeHtml(item.idea_id)}/"><strong>${escapeHtml(item.kind)} on ${escapeHtml(item.idea_title)}</strong><span>${escapeHtml(item.body)}</span><time>${escapeHtml(formatDate(item.created_at))}</time></a>`).join('') || '<p class="empty">No contributions yet.</p>'}</div></section>
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
