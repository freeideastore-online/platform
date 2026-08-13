import { brandHead, brandLockup } from './brand';
import { AUTH_PREFIX } from './auth';
import { contributionCount, contributionsByIdea, derivedIdeas, ideaBody, ideaById } from './data';
import { escapeHtml, FIELD_LIMITS, htmlResponse, SECURITY_HEADERS } from './http';
import { ideaDiagram } from './idea-diagrams';
import { sourcesSection } from './idea-sources-section';
import { ideaHomeScripts } from './idea-home-scripts';
import { ideaHomeStyles } from './idea-home-styles';
import { RESEARCH_PAGE_SIZE, RESEARCH_RENDER_CAP, researchSection, splitContributions } from './idea-research';
import { openRefinementCount } from './refinements';
import { listIdeaSources } from './sources';
import { ideaChapters, isPaginated, markdownHeadings, markdownToHtml } from './markdown';
import { readerSettingsBootScript } from './reader-settings';
import { NAV_SCRIPT, NAV_TOGGLE } from './site-nav';
import type { Env } from './types';

export async function renderIdeaPage(env: Env, request: Request, ideaId: string) {
  const idea = await ideaById(env, ideaId);
  if (!idea) return new Response('Idea not found', { status: 404, headers: SECURITY_HEADERS });

  const body = await ideaBody(env, idea);
  const parent = idea.parent_id
    ? await env.DB.prepare("SELECT id, title FROM ideas WHERE id = ? AND status != 'removed'")
        .bind(idea.parent_id)
        .first<{ id: string; title: string }>()
    : null;
  const derived = await derivedIdeas(env, idea.id);
  // The research record is paged: bodies are inlined, so rendering all of them
  // grows the page without bound as an idea deepens.
  const researchParam = new URL(request.url).searchParams.get('research') || '1';
  const showAllResearch = researchParam === 'all';
  const researchPage = showAllResearch ? 1 : Math.max(1, Number.parseInt(researchParam, 10) || 1);
  // Page over research kinds only. Paging over all contributions and then
  // filtering would make the pager count one thing and show another, and would
  // make the comment count depend on which page you were looking at.
  const researchTotal = await contributionCount(env, idea.id, true);
  const commentTotal = (await contributionCount(env, idea.id)) - researchTotal;
  const contributions = await contributionsByIdea(
    env,
    idea.id,
    showAllResearch ? RESEARCH_RENDER_CAP : RESEARCH_PAGE_SIZE,
    showAllResearch ? 0 : (researchPage - 1) * RESEARCH_PAGE_SIZE,
    true,
  );
  const { research } = splitContributions(contributions);
  // A queued proposal that nobody can see never gets merged.
  const pendingRefinements = await openRefinementCount(env, idea.id);
  // What the idea rests on, gathered from the document and its research.
  const sources = await listIdeaSources(env, idea.id);
  const headings = markdownHeadings(body);
  const chapters = ideaChapters(body, idea.title);
  // Short documents read as one page: the body is rendered inline below, so
  // chapter pages would only re-present content the reader can already scroll.
  const paginated = isPaginated(body, idea.title);
  // A paginated document already lists its chapters as links above. Rendering
  // the whole body here as well re-presents every chapter on the index page —
  // measured at 103% of the combined chapter content — and makes this page grow
  // without bound as the document deepens, since the entire markdown is parsed
  // and emitted on every request. Show only the preamble: whatever precedes the
  // first chapter heading, which is where a document's framing lives.
  //
  // This is what makes FIELD_LIMITS.body safe to raise. Render cost, not
  // storage, is the real ceiling on document size.
  const inlineBody = paginated ? (body.split(/^## /m)[0] ?? '').trim() : body;
  // The Sections rail links in-page anchors, which only exist for the markdown
  // actually rendered on this page. Once the body is not inlined those anchors
  // point at nothing, so a paginated document has to link its chapter pages
  // instead.
  const sectionLinks = paginated
    ? chapters
        .map((chapter) => `<a href="/ideas/${escapeHtml(idea.id)}/${escapeHtml(chapter.id)}/">${escapeHtml(chapter.title)}</a>`)
        .join('')
    : headings.map((heading) => `<a href="#${escapeHtml(heading.id)}">${escapeHtml(heading.title)}</a>`).join('');
  const chapterLinks = chapters.map((chapter, index) => `<a class="chapter-link" data-title="${escapeHtml(chapter.title)} ${escapeHtml(chapter.excerpt)}" href="/ideas/${escapeHtml(idea.id)}/${escapeHtml(chapter.id)}/"><b>${index + 1}</b><span>${escapeHtml(chapter.title)}</span></a>`).join('');
  const page = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>${escapeHtml(idea.title)} - FreeIdeaStore</title>
${brandHead()}
<meta name="description" content="${escapeHtml(idea.summary)}">
<link rel="canonical" href="${escapeHtml(new URL(request.url).origin)}/ideas/${escapeHtml(idea.id)}/">
<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,700;9..144,800&family=Manrope:wght@400;500;600;700;800&display=swap" rel="stylesheet">
${readerSettingsBootScript()}
${ideaHomeStyles()}
</head>
<body>
<header class="book-topbar">
  <div class="top-brand">${brandLockup({ compact: true })}<a href="/ideas/${escapeHtml(idea.id)}/" aria-label="${escapeHtml(idea.title)}"><strong>${escapeHtml(idea.title)}</strong></a></div>
  <nav id="site-nav" class="topbar-nav site-nav"><a href="/">Ideas</a><a href="/docs/">Docs</a><a href="/skills/">Skills</a><a href="/contributors/">Contributors</a><a href="/search">Search</a></nav>
  <button class="theme-toggle" type="button" data-reader-theme-toggle aria-label="Toggle theme" title="Toggle theme">&#9790;</button>
  ${NAV_TOGGLE}
</header>
${
  paginated
    ? `<details class="mobile-book-nav">
  <summary>Chapters</summary>
  <nav class="chapter-list">${chapterLinks}</nav>
</details>`
    : ''
}
<div class="book-shell${paginated ? '' : ' single-page'}">
  ${
    paginated
      ? `<aside class="book-sidebar">
    <div class="book-search"><input id="book-filter" type="search" placeholder="Filter chapters" aria-label="Filter chapters"></div>
    <div class="nav-title"><span>Chapters</span><span>${chapters.length}</span></div>
    <nav class="chapter-list" id="chapter-list">${chapterLinks}</nav>
  </aside>`
      : ''
  }
  <main class="content-wrap">
    <article class="article">
      <h1>${escapeHtml(idea.title)}</h1>
      <div class="summary">${escapeHtml(idea.summary)}</div>
      <div class="meta"><span class="pill">${escapeHtml(idea.stage)}</span><span class="pill">${escapeHtml(idea.category)}</span><span class="pill">${idea.pro_candidate ? 'pro candidate' : 'free idea'}</span></div>
      ${parent ? `<p class="crumb">Derived from <a href="/ideas/${escapeHtml(parent.id)}/">${escapeHtml(parent.title)}</a></p>` : ''}
      ${ideaDiagram(idea.id)}
      ${inlineBody ? `<div class="chapter-body">${markdownToHtml(inlineBody)}</div>` : ''}
    </article>
    ${researchSection(contributions, idea.id, {
      page: researchPage,
      pageSize: RESEARCH_PAGE_SIZE,
      total: researchTotal,
      showAll: showAllResearch,
    })}
    ${sourcesSection(sources)}
    <section class="comments" id="comments" data-idea-id="${escapeHtml(idea.id)}">
      <h2>Comments</h2>
      <div id="comment-list" class="comment-list"><p class="comment-empty">Loading comments...</p></div>
      <p id="comment-auth" class="auth-callout"><a href="${AUTH_PREFIX}/start?provider=github&return_to=/ideas/${escapeHtml(idea.id)}/">Sign in with GitHub</a> or <a href="${AUTH_PREFIX}/start?provider=google&return_to=/ideas/${escapeHtml(idea.id)}/">Google</a> to comment and react.</p>
      <form id="comment-form" class="comment-form">
        <label>Comment<textarea name="body" required minlength="3" maxlength="${FIELD_LIMITS.contribution}" placeholder="Add a useful comment, question, critique, or note."></textarea></label>
        <button class="button" type="submit">Post comment</button>
        <p id="comment-status" class="comment-status">Sign in to post public comments.</p>
      </form>
    </section>
  </main>
  <aside class="toc-rail">
    <div class="toc-title">Signals</div>
    <div class="signal-box">
      <div><strong>Sections</strong><nav class="toc-box">${sectionLinks}${researchTotal ? '<a href="#research">Research &amp; evidence</a>' : ''}${sources.length ? '<a href="#sources">Sources</a>' : ''}<a href="#comments">Comments</a></nav></div>
      <div><strong>Reactions</strong><span><span id="support-count">${escapeHtml(idea.support)}</span> supports / <span id="trash-count">${escapeHtml(idea.trash)}</span> trash / <span id="pivot-count">${escapeHtml(idea.pivot)}</span> pivots</span><div class="reaction-buttons" aria-label="React to idea"><button class="react-button" type="button" data-reaction="support">&#128077; Support</button><button class="react-button" type="button" data-reaction="trash">&#128465; Trash</button><button class="react-button" type="button" data-reaction="pivot">&#128260; Pivot</button></div><p id="reaction-status" class="reaction-status">Sign in to react.</p></div>
      <div><strong>Contributions</strong><span>${researchTotal ? `<a href="#research">${researchTotal} research ${researchTotal === 1 ? 'entry' : 'entries'}</a>` : 'No research entries yet'} / <a href="#comments">${commentTotal} ${commentTotal === 1 ? 'comment' : 'comments'}</a></span></div>
      ${pendingRefinements ? `<div><strong>Awaiting merge</strong><span><a href="#research">${pendingRefinements} proposed ${pendingRefinements === 1 ? 'refinement' : 'refinements'}</a> not yet in the document</span></div>` : ''}
      <div><strong>Next step</strong><span>${escapeHtml(idea.next_step || 'Needs a next validation step.')}</span></div>
      <div><strong>Risk</strong><span>${escapeHtml(idea.risk || 'Risk not yet named.')}</span></div>
      ${derived.length ? `<div><strong>Derived ideas</strong><nav class="toc-box">${derived.map((child) => `<a href="/ideas/${escapeHtml(child.id)}/">${escapeHtml(child.title)}</a>`).join('')}</nav></div>` : ''}
      <div class="actions"><a class="button" href="/#ideas">Back to store</a><a class="button secondary" href="/api/ideas/${escapeHtml(idea.id)}">JSON</a></div>
    </div>
  </aside>
</div>
${ideaHomeScripts(idea.id)}
${NAV_SCRIPT}
</body>
</html>`;

  return htmlResponse(page);
}
