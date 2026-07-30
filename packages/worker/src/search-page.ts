import { escapeHtml, htmlResponse } from './http';
import { search } from './search';
import { NAV_SCRIPT, NAV_TOGGLE, navCss } from './site-nav';
import { THEME_BOOT, THEME_CSS, THEME_SCRIPT } from './theme';
import type { Env } from './types';

/**
 * Snippets come from FTS5 with `<mark>` around the matched terms, so they cannot
 * be escaped wholesale. Escape everything, then restore just those tags.
 */
function renderSnippet(snippet: string) {
  return escapeHtml(snippet)
    .replaceAll('&lt;mark&gt;', '<mark>')
    .replaceAll('&lt;/mark&gt;', '</mark>');
}

export async function renderSearchPage(env: Env, request: Request) {
  const url = new URL(request.url);
  const query = (url.searchParams.get('q') || '').slice(0, 200);
  const result = query ? await search(env, query, { limit: 30 }) : { hits: [] };

  const rows = result.hits
    .map((hit) => {
      const href =
        hit.kind === 'research'
          ? `/ideas/${escapeHtml(hit.idea_id)}/#contribution-${escapeHtml(hit.ref)}`
          : `/ideas/${escapeHtml(hit.idea_id)}/#${escapeHtml(hit.ref)}`;
      const where = hit.kind === 'research' ? 'research entry' : `section ${hit.ref}`;
      return `<li class="hit${(hit as { superseded?: boolean }).superseded ? ' is-superseded' : ''}">
        <a class="hit-title" href="${href}">${escapeHtml(hit.title)}</a>
        <span class="hit-where">${escapeHtml(hit.idea_title || hit.idea_id)} · ${escapeHtml(where)}${
          (hit as { superseded?: boolean }).superseded ? ' · superseded' : ''
        }</span>
        <p class="hit-snippet">${renderSnippet(hit.snippet || '')}</p>
      </li>`;
    })
    .join('\n      ');

  const summary = query
    ? `${result.hits.length} ${result.hits.length === 1 ? 'result' : 'results'} for “${escapeHtml(query)}”`
    : 'Search across every idea document and its research record.';

  return htmlResponse(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>${query ? `${escapeHtml(query)} — Search` : 'Search'} - FreeIdeaStore</title>
<meta name="description" content="Search FreeIdeaStore idea documents and research entries.">
<meta name="robots" content="noindex">
<link rel="icon" type="image/svg+xml" href="/favicon.svg">
<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,700;9..144,800&family=Manrope:wght@400;500;600;700;800&display=swap" rel="stylesheet">
${THEME_BOOT}
<style>
${THEME_CSS}
*{box-sizing:border-box;margin:0;padding:0}
body{background:var(--page);color:var(--ink);font-family:Manrope,system-ui,sans-serif;line-height:1.6}
a{color:inherit;text-decoration:none}
header{position:sticky;top:0;z-index:10;display:flex;align-items:center;gap:1rem;border-bottom:1px solid var(--line);background:var(--topbar-bg);padding:.7rem 1.25rem;backdrop-filter:blur(14px)}
.brand{display:flex;align-items:center;gap:.6rem;font-weight:900;margin-right:auto}.logo{display:grid;height:34px;width:34px;place-items:center;border-radius:8px;background:#102027;color:#67e8f9;box-shadow:inset 0 -4px 0 rgba(245,158,11,.9)}
nav{display:flex;align-items:center;gap:.9rem;color:var(--muted);font-size:.8rem;font-weight:800}
.shell{max-width:860px;margin:0 auto;padding:2rem 1.25rem 4rem}
h1{font-family:Fraunces,serif;font-size:clamp(1.8rem,4vw,2.8rem);line-height:1.05;margin-bottom:.75rem}
.search-form{display:flex;gap:.5rem;margin:1rem 0 1.25rem}
.search-form input{flex:1 1 auto;min-width:0;border:1px solid var(--line);border-radius:8px;background:var(--panel);color:var(--ink);font:inherit;padding:.7rem .8rem}
.search-form input:focus{border-color:var(--accent);outline:2px solid var(--mark)}
.search-form button{border:1px solid var(--accent);border-radius:8px;background:var(--accent);color:#fff;cursor:pointer;font:inherit;font-weight:900;padding:.7rem 1rem}
.summary{color:var(--muted);font-size:.88rem;margin-bottom:1rem}
.hits{display:grid;gap:.6rem;list-style:none}
.hit{border:1px solid var(--line);border-radius:8px;background:var(--panel);padding:.8rem .9rem}
.hit-title{display:block;color:var(--accent-strong);font-size:.95rem;font-weight:900}
.hit.is-superseded .hit-title{color:var(--muted);text-decoration:line-through}
.hit-where{display:block;color:var(--muted);font-size:.74rem;font-weight:800;text-transform:uppercase;letter-spacing:.04em;margin-top:.15rem}
.hit-snippet{color:var(--muted);font-size:.86rem;margin-top:.45rem}
.hit-snippet mark{background:var(--mark);color:var(--accent-strong);font-weight:900;padding:0 .1rem}
.empty{border:1px dashed var(--line);border-radius:8px;color:var(--muted);padding:1rem;font-size:.9rem}
${navCss(760)}
</style>
</head>
<body>
<header>
  <a href="/" class="brand"><span class="logo">FI</span><span>FreeIdeaStore</span></a>
  <nav id="site-nav" class="site-nav"><a href="/#ideas">Ideas</a><a href="/docs/">Docs</a><a href="/skills/">Skills</a><a href="/contributors/">Contributors</a><a href="/search">Search</a><a href="/console/">Console</a></nav>
  <button class="theme-toggle" type="button" aria-label="Toggle theme">&#9790;</button>
  ${NAV_TOGGLE}
</header>
<main class="shell">
  <h1>Search</h1>
  <form class="search-form" method="get" action="/search" role="search">
    <input type="search" name="q" value="${escapeHtml(query)}" placeholder="Claims, sources, risks, corrections…" aria-label="Search ideas and research" autofocus>
    <button type="submit">Search</button>
  </form>
  <p class="summary">${summary}</p>
  ${
    query && !result.hits.length
      ? '<p class="empty">Nothing matched. Research entries and document sections are both indexed, so try a phrase from the text itself.</p>'
      : ''
  }
  ${result.hits.length ? `<ul class="hits">\n      ${rows}\n      </ul>` : ''}
</main>
${THEME_SCRIPT}
${NAV_SCRIPT}
</body>
</html>`);
}
