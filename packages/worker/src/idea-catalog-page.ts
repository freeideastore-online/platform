import { listIdeas } from './data';
import { escapeHtml, htmlResponse } from './http';
import { chapterId } from './markdown';
import type { Env } from './types';

export async function renderIdeasCatalogPage(env: Env, request: Request) {
  const ideas = await listIdeas(env, { stage: 'all', limit: 100 });
  const cards = ideas
    .map((idea) => {
      const firstChapter = chapterId('Snapshot');
      return `<a class="chapter-card" href="/ideas/${escapeHtml(idea.id)}/"><small>${escapeHtml(idea.stage)} / ${escapeHtml(idea.category)}</small><strong>${escapeHtml(idea.title)}</strong><span>${escapeHtml(idea.summary)}</span><em>First chapter: /ideas/${escapeHtml(idea.id)}/${escapeHtml(firstChapter)}/</em></a>`;
    })
    .join('');
  const page = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>Idea Publications - FreeIdeaStore</title>
<meta name="description" content="Dynamic FreeIdeaStore idea publications rendered from the platform database.">
<link rel="canonical" href="${escapeHtml(new URL(request.url).origin)}/ideas/">
<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,700;9..144,800&family=Manrope:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<style>
*{box-sizing:border-box;margin:0;padding:0}
:root{--paper:#f7f8fb;--panel:#fff;--ink:#101827;--muted:#5f6b7a;--line:#dce3ed;--accent:#0ea5e9;--accent-dark:#075985}
body{background:var(--paper);color:var(--ink);font-family:Manrope,system-ui,sans-serif;line-height:1.62}
a{color:inherit;text-decoration:none}
header{position:sticky;top:0;z-index:10;display:flex;align-items:center;gap:1rem;border-bottom:1px solid var(--line);background:rgba(255,255,255,.94);padding:.7rem 1.25rem;backdrop-filter:blur(14px)}
.brand{display:flex;align-items:center;gap:.6rem;font-weight:900}.logo{display:grid;height:34px;width:34px;place-items:center;border-radius:8px;background:#102027;color:#67e8f9;box-shadow:inset 0 -4px 0 rgba(245,158,11,.9)}
nav{margin-left:auto;display:flex;gap:.9rem;color:var(--muted);font-size:.8rem;font-weight:800}
.shell{max-width:1120px;margin:0 auto;padding:2rem 1.25rem 4rem}.crumb{color:var(--accent-dark);font-size:.75rem;font-weight:900;text-transform:uppercase;letter-spacing:.1em;margin-bottom:.75rem}
h1{font-family:Fraunces,serif;font-size:clamp(2.1rem,5vw,4.4rem);line-height:.96;margin-bottom:.75rem}.lead{max-width:760px;color:var(--muted)}
.chapter-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:.8rem;margin-top:1.3rem}.chapter-card{display:grid;gap:.4rem;border:1px solid var(--line);border-radius:8px;background:#fff;padding:.9rem;min-height:160px}.chapter-card small{color:var(--accent-dark);font-size:.68rem;font-weight:900;text-transform:uppercase}.chapter-card strong{font-size:1rem}.chapter-card span{color:var(--muted);font-size:.82rem}.chapter-card em{color:var(--muted);font-size:.72rem;font-style:normal;font-weight:800}
@media(max-width:820px){nav{display:none}.shell{padding-top:1.35rem}}
</style>
</head>
<body>
<header><a href="/" class="brand"><span class="logo">FI</span><span>FreeIdeaStore</span></a><nav><a href="/#ideas">Ideas</a><a href="/docs/">Docs</a><a href="/skills/">Skills</a><a href="/contributors/">Contributors</a><a href="/console/">Console</a></nav></header>
<main class="shell">
  <div class="crumb">Dynamic publications</div>
  <h1>Idea publications.</h1>
  <p class="lead">These pages are rendered by the FreeIdeaStore Worker from canonical idea documents in the platform database. No per-idea GitHub docs, generated static assets, or legacy fallback renderer.</p>
  <div class="chapter-grid">${cards}</div>
</main>
</body>
</html>`;
  return htmlResponse(page);
}
