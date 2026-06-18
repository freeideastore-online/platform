import { contributorByHandle, contributionsByProfile, ideasByProfile } from './data';
import { AUTH_PREFIX, authUserFor } from './auth';
import { THEME_BOOT, THEME_CSS, THEME_SCRIPT } from './theme';
import type { AuthUser, Env } from './types';

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

function initials(value: string) {
  const parts = value
    .replace(/[^a-z0-9 -]/gi, '')
    .split(/[\s-]+/)
    .filter(Boolean);
  return (parts[0]?.[0] || 'U').toUpperCase() + (parts[1]?.[0] || '').toUpperCase();
}

function formatDate(value: unknown) {
  const time = Date.parse(String(value || ''));
  if (!Number.isFinite(time)) return '';
  return new Date(time).toLocaleDateString('en-AU', { year: 'numeric', month: 'short', day: 'numeric' });
}

function accountAvatar(user: AuthUser, size = 40) {
  const dimension = `${size}px`;
  if (user.avatarUrl) {
    return `<img src="${escapeHtml(user.avatarUrl)}" alt="${escapeHtml(user.handle)}" width="${escapeHtml(size)}" height="${escapeHtml(size)}">`;
  }
  return `<span style="width:${dimension};height:${dimension}">${escapeHtml(initials(user.displayName || user.handle))}</span>`;
}

export async function renderAccountPage(env: Env, request: Request) {
  const user = await authUserFor(request);
  const profile = user ? await contributorByHandle(env, user.handle) : null;
  const myIdeas = profile ? await ideasByProfile(env, profile.id) : [];
  const myContributions = profile ? await contributionsByProfile(env, profile.id, 12) : [];
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
${THEME_BOOT}
<style>
${THEME_CSS}
*{box-sizing:border-box;margin:0;padding:0}body{font-family:Manrope,system-ui,sans-serif;line-height:1.5}a{color:inherit;text-decoration:none}button{font:inherit}header{position:sticky;top:0;z-index:10;display:flex;align-items:center;gap:1rem;border-bottom:1px solid var(--line);background:var(--topbar-bg);padding:.7rem 1.25rem;backdrop-filter:blur(14px)}.brand{display:flex;align-items:center;gap:.6rem;font-weight:800;margin-right:auto}.mark{display:grid;height:34px;width:34px;place-items:center;border-radius:8px;background:#102027;color:#67e8f9;font-weight:900}.brand span:last-child{font-family:Fraunces,serif}nav{display:flex;align-items:center;gap:.9rem;color:var(--muted);font-size:.8rem;font-weight:800}.account-avatar{display:inline-grid;width:36px;height:36px;place-items:center;border:2px solid var(--line);border-radius:50%;overflow:hidden;background:white}.account-avatar img{width:100%;height:100%;object-fit:cover}.account-avatar span{display:grid;place-items:center;border-radius:50%;background:#102027;color:#67e8f9;font-weight:900}.shell{max-width:760px;margin:0 auto;padding:2rem 1.25rem}.identity{display:flex;gap:1rem;align-items:center;margin-bottom:1.5rem}.avatar-large{display:grid;width:72px;height:72px;place-items:center;border-radius:50%;overflow:hidden;background:#102027;color:#67e8f9;font-size:1.5rem;font-weight:900;box-shadow:inset 0 -6px 0 rgba(245,158,11,.9)}.avatar-large img{width:100%;height:100%;object-fit:cover}h1{font-family:Fraunces,serif;font-size:clamp(2rem,5vw,3.2rem);line-height:1}.muted{color:var(--muted);font-size:.88rem}.panel{border:1px solid var(--line);border-radius:8px;background:white;padding:1rem;margin-bottom:1rem;box-shadow:0 10px 22px rgba(16,32,39,.04)}.panel h2{font-size:.95rem;margin-bottom:.75rem}.row{display:flex;justify-content:space-between;gap:1rem;border-top:1px solid var(--line);padding:.7rem 0}.row:first-of-type{border-top:0}.row span{color:var(--muted);font-size:.85rem}.idea-list{display:grid;gap:.55rem}.idea-item{display:grid;gap:.18rem;border:1px solid var(--line);border-radius:8px;background:#fbfdfd;padding:.75rem}.idea-item strong{font-size:.95rem}.idea-item span,.idea-item time{color:var(--muted);font-size:.8rem}.pill{justify-self:start;border:1px solid var(--line);border-radius:999px;background:#ecfeff;color:#155e75;font-size:.66rem;font-weight:900;padding:.18rem .45rem;text-transform:uppercase}.button{display:inline-flex;align-items:center;justify-content:center;border:1px solid var(--accent);border-radius:8px;background:var(--accent);color:white;cursor:pointer;padding:.62rem .85rem;font-weight:900}.button.secondary{background:white;color:var(--accent)}.button.danger{border-color:var(--bad);background:white;color:var(--bad)}.seg{display:flex;gap:.5rem;flex-wrap:wrap}.seg button{border:1px solid var(--line);border-radius:8px;background:white;color:var(--ink);cursor:pointer;padding:.5rem .65rem;font-weight:800}.seg button.active{border-color:var(--accent);background:#ecfeff;color:#155e75}.danger{border-color:#fecaca}.actions{display:flex;gap:.55rem;flex-wrap:wrap}.panel-head{display:flex;justify-content:space-between;gap:1rem;align-items:center;margin-bottom:.75rem}.panel-head h2{margin:0}.small-link{color:var(--accent);font-size:.78rem;font-weight:900}@media(max-width:760px){nav a:not(.account-avatar){display:none}.panel-head{align-items:flex-start;flex-direction:column}}
</style>
</head>
<body>
<header><a href="/" class="brand"><span class="mark">FI</span><span>FreeIdeaStore</span></a><nav><a href="/#ideas">Ideas</a><a href="/docs/">Docs</a><a href="/skills/">Skills</a><a href="/contributors/">Contributors</a><a href="/console/">Console</a>${user ? `<a class="account-avatar" href="/profile/" aria-label="Profile">${accountAvatar(user, 36)}</a>` : `<a href="/console/">Sign in</a>`}</nav><button class="theme-toggle" type="button" aria-label="Toggle theme">&#9790;</button></header>
<main class="shell">
  ${
    user
      ? `<section class="identity"><div class="avatar-large">${accountAvatar(user, 72)}</div><div><h1>${escapeHtml(user.displayName)}</h1><p class="muted">@${escapeHtml(user.handle)} / ${escapeHtml(user.provider)} account</p></div></section>
        <section class="panel"><h2>Public profile</h2><div class="row"><strong>Profile page</strong><span>${publicUrl}</span></div><div class="row"><strong>Ideas</strong><span>${escapeHtml(profile?.idea_count ?? 0)}</span></div><div class="row"><strong>Contributions</strong><span>${escapeHtml(profile?.contribution_count ?? 0)}</span></div><div class="actions"><a class="button" href="${publicUrl}">Open public profile</a><a class="button secondary" href="/console/">Create idea</a></div></section>
        <section class="panel"><div class="panel-head"><h2>My ideas</h2><a class="small-link" href="/api/me/ideas">JSON</a></div><div class="idea-list">${myIdeas.map((idea) => `<a class="idea-item" href="/ideas/${escapeHtml(idea.id)}/"><strong>${escapeHtml(idea.title)}</strong><span>${escapeHtml(idea.stage)} / ${escapeHtml(idea.category)} - ${escapeHtml(idea.summary)}</span><time>${escapeHtml(formatDate(idea.updated_at))}</time>${idea.pro_candidate ? '<em class="pill">Pro candidate</em>' : ''}</a>`).join('') || '<p class="muted">No ideas created from this account yet.</p>'}</div></section>
        <section class="panel"><div class="panel-head"><h2>My recent contributions</h2><a class="small-link" href="/api/me/activity">JSON</a></div><div class="idea-list">${myContributions.map((item) => `<a class="idea-item" href="/ideas/${escapeHtml(item.idea_id)}/"><strong>${escapeHtml(item.kind)} on ${escapeHtml(item.idea_title)}</strong><span>${escapeHtml(item.body)}</span><time>${escapeHtml(formatDate(item.created_at))}</time></a>`).join('') || '<p class="muted">No contributions from this account yet.</p>'}</div></section>
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
  button.onclick = () => {
    localStorage.setItem('fis:theme', button.dataset.theme);
    document.querySelectorAll('[data-theme]').forEach((item) => item.classList.toggle('active', item === button));
  };
});
const logout = document.querySelector('#logout');
if (logout) logout.onclick = async () => {
  await fetch('${AUTH_PREFIX}/logout', { method: 'POST' });
  location.href = '/';
};
</script>
${THEME_SCRIPT}
</body></html>`, {
    headers: { ...SECURITY_HEADERS, 'Content-Type': 'text/html;charset=UTF-8', 'Cache-Control': 'no-store' },
  });
}

