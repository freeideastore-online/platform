import { ideaBody, ideaById } from './data';
import { escapeHtml, htmlResponse, SECURITY_HEADERS } from './http';
import { ideaChapterById, ideaChapters, markdownHeadings, markdownToHtml } from './markdown';
import {
  readerSettingsBootScript,
  readerSettingsControls,
  readerSettingsCss,
  readerSettingsScript,
} from './reader-settings';
import type { Env } from './types';

export async function renderIdeaChapterPage(env: Env, request: Request, ideaId: string, requestedChapterId: string) {
  const idea = await ideaById(env, ideaId);
  if (!idea) return new Response('Idea not found', { status: 404, headers: SECURITY_HEADERS });

  const body = await ideaBody(env, idea);
  const chapters = ideaChapters(body, idea.title);
  const chapter = ideaChapterById(chapters, requestedChapterId);
  if (!chapter) return new Response('Idea chapter not found', { status: 404, headers: SECURITY_HEADERS });

  if (requestedChapterId !== chapter.id) {
    return Response.redirect(`${new URL(request.url).origin}/ideas/${idea.id}/${chapter.id}/`, 301);
  }

  const index = chapters.indexOf(chapter);
  const previous = chapters[index - 1];
  const next = chapters[index + 1];
  const canonical = `${new URL(request.url).origin}/ideas/${idea.id}/${chapter.id}/`;
  const chapterBody = chapter.markdown.replace(/^##\s+.+\n\n?/, '');
  const chapterToc = markdownHeadings(chapterBody);
  const chapterTocLinks = chapterToc.map((heading) => `<a href="#${escapeHtml(heading.id)}">${escapeHtml(heading.title)}</a>`).join('');
  const progress = Math.round(((index + 1) / chapters.length) * 100);
  const page = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>${escapeHtml(chapter.title)} - ${escapeHtml(idea.title)} - FreeIdeaStore</title>
<meta name="description" content="${escapeHtml(chapter.excerpt || idea.summary)}">
<link rel="canonical" href="${escapeHtml(canonical)}">
<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,700;9..144,800&family=Manrope:wght@400;500;600;700;800&display=swap" rel="stylesheet">
${readerSettingsBootScript()}
<style>
*{box-sizing:border-box;margin:0;padding:0}
:root{--page:#f8fafc;--panel:#fff;--panel-soft:#f1f7fb;--panel-alt:#fbfdfe;--topbar-bg:rgba(255,255,255,.95);--ink:#111827;--muted:#334155;--line:#cbd5e1;--accent:#0e7490;--accent-strong:#0f4c5c;--mark:#ecfeff;--body-text:#273646;--title-text:#263445;--strong-text:#17202a;--chapter-badge:#e2f3f7;--focus:#cffafe;--hover-line:#67c1d4;--progress-track:#e8eef4;--shadow:0 16px 36px rgba(15,23,42,.06)}
body{background:var(--page);color:var(--ink);font-family:Manrope,system-ui,sans-serif;line-height:1.68}
a{color:inherit;text-decoration:none}
.book-topbar{position:sticky;top:0;z-index:20;display:grid;grid-template-columns:minmax(0,1fr) auto;gap:.8rem;align-items:center;border-bottom:1px solid var(--line);background:var(--topbar-bg);padding:.6rem .95rem;backdrop-filter:blur(14px)}
.top-brand{display:flex;align-items:center;gap:.65rem;min-width:0;font-weight:900}.top-brand strong{display:block;max-width:min(60vw,540px);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.top-brand small{display:block;color:var(--muted);font-size:.68rem;font-weight:900;text-transform:uppercase;letter-spacing:.1em}
.book-shell{display:grid;grid-template-columns:292px minmax(0,1fr) 238px;min-height:calc(100vh - 58px)}
.book-sidebar{position:sticky;top:58px;height:calc(100vh - 58px);overflow:auto;border-right:1px solid var(--line);background:var(--panel);padding:1rem}
.logo{display:grid;flex:0 0 auto;width:34px;height:34px;place-items:center;border-radius:8px;background:#102027;color:#67e8f9;box-shadow:inset 0 -4px 0 rgba(245,158,11,.9)}
.sidebar-actions{display:flex;flex-wrap:wrap;gap:.45rem;margin-bottom:.85rem}.store-link{display:grid;width:38px;height:38px;place-items:center;border:1px solid var(--line);border-radius:8px;color:var(--accent-strong);font-size:1rem;font-weight:900;background:var(--panel)}
.book-search{position:relative;margin:.75rem 0}.book-search input{width:100%;border:1px solid var(--line);border-radius:8px;background:var(--panel-alt);color:var(--ink);font:inherit;font-size:.8rem;padding:.58rem .65rem}.book-search input:focus{border-color:var(--hover-line);outline:2px solid var(--focus)}
.nav-title{display:flex;justify-content:space-between;gap:.75rem;color:var(--title-text);font-size:.68rem;text-transform:uppercase;font-weight:900;letter-spacing:.12em;margin:.7rem 0 .42rem}.nav-title span:last-child{letter-spacing:0;text-transform:none}
.progress{height:6px;border-radius:999px;background:var(--progress-track);margin:.4rem 0 .8rem;overflow:hidden}.progress i{display:block;height:100%;background:linear-gradient(90deg,var(--accent),#f59e0b);width:${progress}%}
.chapter-list{display:grid;gap:.28rem}.chapter-link{display:grid;grid-template-columns:28px minmax(0,1fr);gap:.55rem;align-items:center;border:1px solid transparent;border-radius:8px;padding:.54rem .56rem;color:var(--strong-text)}.chapter-link:hover,.chapter-link.active{background:var(--mark);border-color:var(--hover-line)}.chapter-link b{display:grid;width:26px;height:26px;place-items:center;border-radius:999px;background:var(--chapter-badge);color:var(--accent-strong);font-size:.7rem}.chapter-link.active b{background:var(--accent);color:#fff}.chapter-link span{display:block;font-size:.82rem;font-weight:900;line-height:1.25}
.mobile-book-nav{display:none;border-bottom:1px solid var(--line);background:var(--panel);padding:.75rem 1rem}.mobile-book-nav summary{cursor:pointer;color:var(--accent-strong);font-weight:900}.mobile-book-nav .reader-controls{margin-top:.65rem}.mobile-book-nav .chapter-list{margin-top:.65rem;grid-template-columns:repeat(auto-fit,minmax(210px,1fr))}
.mobile-page-toc{display:none;border-bottom:1px solid var(--line);background:var(--panel-alt);padding:.7rem 1rem}.mobile-page-toc strong{display:block;color:var(--title-text);font-size:.68rem;font-weight:900;letter-spacing:.12em;text-transform:uppercase;margin-bottom:.45rem}.mobile-page-toc nav{display:flex;gap:.45rem;overflow-x:auto;overscroll-behavior-x:contain;padding-bottom:.15rem}.mobile-page-toc a{flex:0 0 auto;border:1px solid var(--line);border-radius:999px;background:var(--panel);color:var(--accent-strong);font-size:.75rem;font-weight:900;line-height:1.15;padding:.42rem .62rem;white-space:nowrap}.mobile-page-toc a:hover{border-color:var(--hover-line);background:var(--mark)}
.content-wrap{display:grid;grid-template-columns:minmax(0,920px);justify-content:center;padding:2.2rem 1.35rem 4rem}
.article{width:100%}.crumb{display:flex;flex-wrap:wrap;gap:.45rem;align-items:center;color:var(--accent-strong);font-size:.73rem;font-weight:900;text-transform:uppercase;letter-spacing:.09em;margin-bottom:.78rem}.crumb a{color:var(--accent-strong)}
h1{font-family:Fraunces,serif;font-size:clamp(1.6rem,3.5vw,2.8rem);line-height:1.08;letter-spacing:-.01em;margin-bottom:1rem;max-width:880px}
h2{font-family:Fraunces,serif;font-size:1.7rem;margin:1.55rem 0 .55rem;scroll-margin-top:1rem}h3{font-size:1.08rem;margin:1.35rem 0 .35rem;scroll-margin-top:1rem}
p{color:var(--body-text);margin:.78rem 0;max-width:760px}ul,ol{display:grid;gap:.42rem;margin:.78rem 0 1rem 1.25rem;color:var(--body-text);max-width:760px}li::marker{color:var(--accent-strong);font-weight:900}
.summary{border:1px solid var(--line);border-left:4px solid var(--accent);background:var(--panel);padding:1rem 1.05rem;border-radius:8px;color:var(--body-text);font-weight:800;box-shadow:var(--shadow);margin-bottom:1rem;max-width:820px}.meta{display:flex;flex-wrap:wrap;gap:.45rem;margin-bottom:1.25rem}.pill{border:1px solid var(--line);border-radius:999px;background:var(--panel);padding:.32rem .62rem;color:var(--title-text);font-size:.7rem;font-weight:900;text-transform:uppercase}
.chapter-body{background:var(--panel);border:1px solid var(--line);border-radius:8px;box-shadow:var(--shadow);padding:1.1rem 1.15rem}.chapter-body>*:first-child{margin-top:0}
.chapter-nav{display:grid;grid-template-columns:1fr 1fr;gap:.75rem;border-top:1px solid var(--line);margin-top:1.6rem;padding-top:1rem}.chapter-nav a,.chapter-nav span{min-height:70px;border:1px solid var(--line);border-radius:8px;background:var(--panel);padding:.7rem .8rem;color:var(--accent-strong);font-size:.78rem;font-weight:900}.chapter-nav a{display:grid;gap:.1rem}.chapter-nav small{color:var(--muted);font-size:.66rem;text-transform:uppercase}.chapter-nav .next{text-align:right}
.toc-rail{position:sticky;top:58px;height:calc(100vh - 58px);overflow:auto;border-left:1px solid var(--line);background:var(--panel-alt);padding:1.1rem .95rem}.toc-box{display:grid;gap:.32rem}.toc-title{color:var(--title-text);font-size:.68rem;font-weight:900;letter-spacing:.12em;text-transform:uppercase;margin-bottom:.35rem}.toc-box a{display:block;border-left:2px solid transparent;color:var(--title-text);font-size:.78rem;font-weight:900;line-height:1.35;padding:.28rem 0 .28rem .55rem}.toc-box a:hover{border-left-color:var(--accent);color:var(--accent-strong);background:var(--mark)}.toc-empty{color:var(--muted);font-size:.78rem}
footer{max-width:920px;margin:1.8rem auto 0;border-top:1px solid var(--line);padding-top:1rem;color:var(--muted);font-size:.78rem}
@media(max-width:1180px){.book-shell{grid-template-columns:280px minmax(0,1fr)}.toc-rail{display:none}.mobile-page-toc{display:block}}
@media(max-width:960px){.book-topbar{grid-template-columns:minmax(0,1fr) auto}.book-topbar>.reader-controls{grid-column:1/-1;justify-content:flex-start}}
@media(max-width:860px){.book-topbar{position:relative}.top-brand strong{max-width:min(55vw,280px)}.book-shell{display:block;min-height:0}.book-sidebar{display:none}.mobile-book-nav{display:block}.content-wrap{padding:1.3rem 1rem 3rem}.chapter-body{padding:.9rem}.chapter-nav{grid-template-columns:1fr}.chapter-nav .next{text-align:left}h1{font-size:clamp(1.4rem,5vw,2.2rem)}}
${readerSettingsCss()}
</style>
</head>
<body>
<header class="book-topbar">
  <div class="top-brand"><a href="/" class="logo" aria-label="Home">FI</a><a href="/ideas/${escapeHtml(idea.id)}/" aria-label="${escapeHtml(idea.title)}"><strong>${escapeHtml(idea.title)}</strong></a></div>
  ${readerSettingsControls()}
</header>
<details class="mobile-book-nav">
  <summary>Chapters</summary>
  ${readerSettingsControls()}
  <nav class="chapter-list">${chapters.map((item, chapterIndex) => `<a class="chapter-link${item.id === chapter.id ? ' active' : ''}" href="/ideas/${escapeHtml(idea.id)}/${escapeHtml(item.id)}/"><b>${chapterIndex + 1}</b><span>${escapeHtml(item.title)}</span></a>`).join('')}</nav>
</details>
${chapterTocLinks ? `<section class="mobile-page-toc" aria-label="On this page"><strong>On this page</strong><nav>${chapterTocLinks}</nav></section>` : ''}
<div class="book-shell">
  <aside class="book-sidebar">
    <div class="sidebar-actions"><a class="store-link" href="/#ideas" aria-label="Store" title="Store">&#8962;</a><a class="store-link" href="/ideas/${escapeHtml(idea.id)}/" aria-label="Idea home" title="Idea home">&#9673;</a><a class="store-link" href="/docs/idea-books/" aria-label="Docs" title="Docs">&#9636;</a></div>
    <div class="book-search"><input id="book-filter" type="search" placeholder="Filter chapters" aria-label="Filter chapters"></div>
    <div class="nav-title"><span>Chapters</span><span>${index + 1}/${chapters.length}</span></div>
    <div class="progress" aria-hidden="true"><i></i></div>
    <nav class="chapter-list" id="chapter-list">${chapters.map((item, chapterIndex) => `<a class="chapter-link${item.id === chapter.id ? ' active' : ''}" data-title="${escapeHtml(item.title)} ${escapeHtml(item.excerpt)}" href="/ideas/${escapeHtml(idea.id)}/${escapeHtml(item.id)}/"><b>${chapterIndex + 1}</b><span>${escapeHtml(item.title)}</span></a>`).join('')}</nav>
  </aside>
  <main class="content-wrap">
    <article class="article">
      <h1>${escapeHtml(chapter.title)}</h1>
      <div class="summary">${escapeHtml(chapter.excerpt || idea.summary)}</div>
      <div class="meta"><span class="pill">${escapeHtml(idea.title)}</span><span class="pill">${escapeHtml(idea.stage)}</span><span class="pill">Chapter ${index + 1} of ${chapters.length}</span></div>
      <div class="chapter-body">${markdownToHtml(chapterBody)}</div>
      <nav class="chapter-nav">
        ${previous ? `<a href="/ideas/${escapeHtml(idea.id)}/${escapeHtml(previous.id)}/"><small>Previous</small>${escapeHtml(previous.title)}</a>` : '<span></span>'}
        ${next ? `<a class="next" href="/ideas/${escapeHtml(idea.id)}/${escapeHtml(next.id)}/"><small>Next</small>${escapeHtml(next.title)}</a>` : '<span></span>'}
      </nav>
    </article>
  </main>
  <aside class="toc-rail">
    <div class="toc-title">On this page</div>
    <nav class="toc-box">${chapterTocLinks || '<p class="toc-empty">This chapter has no deeper sections yet.</p>'}</nav>
  </aside>
</div>
<script>
const filter = document.querySelector('#book-filter');
const chapterLinks = [...document.querySelectorAll('#chapter-list .chapter-link')];
if (filter) filter.oninput = () => {
  const query = filter.value.trim().toLowerCase();
  chapterLinks.forEach((link) => {
    link.hidden = query && !String(link.dataset.title || '').toLowerCase().includes(query);
  });
};
</script>
${readerSettingsScript()}
</body>
</html>`;

  return htmlResponse(page);
}
