import { AUTH_PREFIX } from './auth';
import { ideaBody, ideaById } from './data';
import { escapeHtml, htmlResponse, SECURITY_HEADERS } from './http';
import { ideaDiagram } from './idea-diagrams';
import { ideaChapters, markdownHeadings, markdownToHtml } from './markdown';
import {
  readerSettingsBootScript,
  readerSettingsControls,
  readerSettingsCss,
  readerSettingsScript,
} from './reader-settings';
import type { Env } from './types';

export async function renderIdeaPage(env: Env, request: Request, ideaId: string) {
  const idea = await ideaById(env, ideaId);
  if (!idea) return new Response('Idea not found', { status: 404, headers: SECURITY_HEADERS });

  const body = await ideaBody(env, idea);
  const headings = markdownHeadings(body);
  const chapters = ideaChapters(body, idea.title);
  const bookStartPath = `/ideas/${idea.id}/${chapters[0]?.id || 'snapshot'}/`;
  const chapterLinks = chapters.map((chapter, index) => `<a class="chapter-link" data-title="${escapeHtml(chapter.title)} ${escapeHtml(chapter.excerpt)}" href="/ideas/${escapeHtml(idea.id)}/${escapeHtml(chapter.id)}/"><b>${index + 1}</b><span>${escapeHtml(chapter.title)}</span></a>`).join('');
  const page = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>${escapeHtml(idea.title)} - FreeIdeaStore</title>
<meta name="description" content="${escapeHtml(idea.summary)}">
<link rel="canonical" href="${escapeHtml(new URL(request.url).origin)}/ideas/${escapeHtml(idea.id)}/">
<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,700;9..144,800&family=Manrope:wght@400;500;600;700;800&display=swap" rel="stylesheet">
${readerSettingsBootScript()}
<style>
*{box-sizing:border-box;margin:0;padding:0}
:root{--page:#f8fafc;--panel:#fff;--panel-alt:#fbfdfe;--topbar-bg:rgba(255,255,255,.95);--ink:#111827;--muted:#334155;--line:#cbd5e1;--accent:#0e7490;--accent-strong:#0f4c5c;--mark:#ecfeff;--bad:#dc2626;--body-text:#273646;--title-text:#263445;--strong-text:#17202a;--chapter-badge:#e2f3f7;--focus:#cffafe;--hover-line:#67c1d4;--shadow:0 16px 36px rgba(15,23,42,.06)}
body{background:var(--page);color:var(--ink);font-family:Manrope,system-ui,sans-serif;line-height:1.68}
a{color:inherit;text-decoration:none}
.book-topbar{position:sticky;top:0;z-index:20;display:grid;grid-template-columns:minmax(0,1fr) auto;gap:.8rem;align-items:center;border-bottom:1px solid var(--line);background:var(--topbar-bg);padding:.6rem .95rem;backdrop-filter:blur(14px)}
.top-brand{display:flex;align-items:center;gap:.65rem;min-width:0;font-weight:900}.top-brand strong{display:block;max-width:min(60vw,540px);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.top-brand small{display:block;color:var(--muted);font-size:.68rem;font-weight:900;text-transform:uppercase;letter-spacing:.1em}
.logo{display:grid;flex:0 0 auto;width:34px;height:34px;place-items:center;border-radius:8px;background:#102027;color:#67e8f9;box-shadow:inset 0 -4px 0 rgba(245,158,11,.9);font-weight:900}
.book-shell{display:grid;grid-template-columns:292px minmax(0,1fr) 300px;min-height:calc(100vh - 62px)}
.book-sidebar{position:sticky;top:62px;height:calc(100vh - 62px);overflow:auto;border-right:1px solid var(--line);background:var(--panel);padding:1rem}
.sidebar-actions{display:flex;flex-wrap:wrap;gap:.45rem;margin-bottom:.85rem}.store-link{display:grid;width:38px;height:38px;place-items:center;border:1px solid var(--line);border-radius:8px;color:var(--accent-strong);font-size:1rem;font-weight:900;background:var(--panel)}
.book-search{position:relative;margin:.75rem 0}.book-search input{width:100%;border:1px solid var(--line);border-radius:8px;background:var(--panel-alt);color:var(--ink);font:inherit;font-size:.8rem;padding:.58rem .65rem}.book-search input:focus{border-color:var(--hover-line);outline:2px solid var(--focus)}
.nav-title{display:flex;justify-content:space-between;gap:.75rem;color:var(--title-text);font-size:.68rem;text-transform:uppercase;font-weight:900;letter-spacing:.12em;margin:.7rem 0 .42rem}.chapter-list{display:grid;gap:.28rem}.chapter-link{display:grid;grid-template-columns:28px minmax(0,1fr);gap:.55rem;align-items:center;border:1px solid transparent;border-radius:8px;padding:.54rem .56rem;color:var(--strong-text)}.chapter-link:hover{background:var(--mark);border-color:var(--hover-line)}.chapter-link b{display:grid;width:26px;height:26px;place-items:center;border-radius:999px;background:var(--chapter-badge);color:var(--accent-strong);font-size:.7rem}.chapter-link span{display:block;font-size:.82rem;font-weight:900;line-height:1.25}
.mobile-book-nav{display:none;border-bottom:1px solid var(--line);background:var(--panel);padding:.75rem 1rem}.mobile-book-nav summary{cursor:pointer;color:var(--accent-strong);font-weight:900}.mobile-book-nav .reader-controls,.mobile-book-nav .sidebar-actions,.mobile-book-nav .chapter-list{margin-top:.65rem}.mobile-book-nav .chapter-list{grid-template-columns:repeat(auto-fit,minmax(210px,1fr))}
.content-wrap{display:grid;grid-template-columns:minmax(0,920px);justify-content:center;padding:2.2rem 1.35rem 4rem}.article{width:100%}.crumb{display:flex;flex-wrap:wrap;gap:.45rem;align-items:center;color:var(--accent-strong);font-size:.73rem;font-weight:900;text-transform:uppercase;letter-spacing:.09em;margin-bottom:.78rem}
h1{font-family:Fraunces,serif;font-size:clamp(1.6rem,3.5vw,2.8rem);line-height:1.08;letter-spacing:-.01em;margin-bottom:1rem;max-width:880px}h2{font-family:Fraunces,serif;font-size:1.7rem;margin:1.55rem 0 .55rem;scroll-margin-top:1rem}h3{font-size:1.08rem;margin:1.35rem 0 .35rem;scroll-margin-top:1rem}
p{color:var(--body-text);margin:.78rem 0;max-width:760px}ul,ol{display:grid;gap:.42rem;margin:.78rem 0 1rem 1.25rem;color:var(--body-text);max-width:760px}li::marker{color:var(--accent-strong);font-weight:900}
.summary{border:1px solid var(--line);border-left:4px solid var(--accent);background:var(--panel);padding:1rem 1.05rem;border-radius:8px;color:var(--body-text);font-weight:800;box-shadow:var(--shadow);margin-bottom:1rem;max-width:820px}.meta{display:flex;flex-wrap:wrap;gap:.45rem;margin-bottom:1.25rem}.pill{border:1px solid var(--line);border-radius:999px;background:var(--panel);padding:.32rem .62rem;color:var(--title-text);font-size:.7rem;font-weight:900;text-transform:uppercase}
.idea-diagram{background:var(--panel);border:1px solid var(--line);border-radius:12px;box-shadow:var(--shadow);padding:1.25rem;margin-bottom:1.25rem;max-width:820px;overflow-x:auto}.idea-diagram svg{display:block;max-width:100%;height:auto;margin:0 auto}.idea-diagram-label{color:var(--muted);font-size:.72rem;font-weight:900;text-transform:uppercase;letter-spacing:.08em;margin-bottom:.65rem}
.chapter-body,.comments{background:var(--panel);border:1px solid var(--line);border-radius:8px;box-shadow:var(--shadow);padding:1.1rem 1.15rem}.chapter-body>*:first-child{margin-top:0}
.toc-rail{position:sticky;top:62px;height:calc(100vh - 62px);overflow:auto;border-left:1px solid var(--line);background:var(--panel-alt);padding:1.1rem .95rem}.toc-title{color:var(--title-text);font-size:.68rem;font-weight:900;letter-spacing:.12em;text-transform:uppercase;margin-bottom:.35rem}.signal-box{display:grid;gap:.75rem}.signal-box>div{border-left:3px solid var(--line);padding-left:.65rem}.signal-box strong{display:block;color:var(--strong-text);font-size:.72rem;text-transform:uppercase}.signal-box span,.signal-box p{display:block;color:var(--muted);font-size:.82rem;margin:0}.toc-box{display:grid;gap:.32rem;margin-top:.32rem}.toc-box a{display:block;border-left:2px solid transparent;color:var(--title-text);font-size:.78rem;font-weight:900;line-height:1.35;padding:.28rem 0 .28rem .55rem}.toc-box a:hover{border-left-color:var(--accent);color:var(--accent-strong);background:var(--mark)}
.actions,.reaction-buttons{display:flex;gap:.5rem;flex-wrap:wrap}.button,.react-button{border:1px solid var(--accent);border-radius:8px;background:var(--accent);color:#fff;cursor:pointer;padding:.58rem .75rem;font-size:.78rem;font-weight:900}.button.secondary,.react-button{background:var(--panel);color:var(--accent-strong)}.react-button:disabled{cursor:not-allowed;opacity:.58}.reaction-status{color:var(--muted);font-size:.76rem;margin-top:.35rem}
.comments{margin-top:1rem}.comments h2{font-size:1.1rem;margin-bottom:.3rem}.comment-form{display:grid;gap:.6rem;border-top:1px solid var(--line);margin-top:.9rem;padding-top:.9rem}.comment-form label{display:grid;gap:.28rem;color:var(--muted);font-size:.74rem;font-weight:900;text-transform:uppercase}.comment-form textarea{width:100%;border:1px solid var(--line);border-radius:8px;background:var(--panel-alt);color:var(--ink);padding:.65rem;font:inherit;min-height:96px;resize:vertical}.comment-list{display:grid;gap:.65rem;margin-top:.9rem}.comment{border:1px solid var(--line);border-radius:8px;background:var(--panel-alt);padding:.75rem}.comment-head{display:flex;flex-wrap:wrap;gap:.4rem;align-items:center;color:var(--muted);font-size:.76rem}.comment-head strong{color:var(--ink)}.comment-kind{border:1px solid var(--line);border-radius:999px;background:var(--mark);color:var(--accent-strong);font-size:.65rem;font-weight:900;padding:.12rem .4rem;text-transform:uppercase}.comment p{color:var(--muted);font-size:.9rem;margin-top:.35rem;white-space:pre-wrap}.comment-status{color:var(--muted);font-size:.82rem;margin-top:.55rem}.comment-status.err{color:var(--bad)}.comment-empty,.auth-callout{border:1px dashed var(--line);border-radius:8px;color:var(--muted);padding:.8rem;font-size:.86rem}.auth-callout{display:none;margin-top:.8rem;background:var(--panel-alt)}.auth-callout a{color:var(--accent-strong);font-weight:900}
@media(max-width:1180px){.book-shell{grid-template-columns:280px minmax(0,1fr)}.toc-rail{display:none}}
@media(max-width:960px){.book-topbar{grid-template-columns:minmax(0,1fr) auto}.book-topbar>.reader-controls{grid-column:1/-1;justify-content:flex-start}}
@media(max-width:860px){.book-topbar{position:relative}.top-brand strong{max-width:min(55vw,280px)}.book-shell{display:block;min-height:0}.book-sidebar{display:none}.mobile-book-nav{display:block}.content-wrap{padding:1.3rem 1rem 3rem}.chapter-body,.comments{padding:.9rem}h1{font-size:clamp(1.4rem,5vw,2.2rem)}}
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
  <nav class="chapter-list">${chapterLinks}</nav>
</details>
<div class="book-shell">
  <aside class="book-sidebar">
    <div class="sidebar-actions"><a class="store-link" href="/#ideas" aria-label="Store" title="Store">&#8962;</a><a class="store-link" href="${escapeHtml(bookStartPath)}" aria-label="Start reading" title="Start reading">&#9654;</a><a class="store-link" href="/docs/idea-books/" aria-label="Docs" title="Docs">&#9636;</a></div>
    <div class="book-search"><input id="book-filter" type="search" placeholder="Filter chapters" aria-label="Filter chapters"></div>
    <div class="nav-title"><span>Chapters</span><span>${chapters.length}</span></div>
    <nav class="chapter-list" id="chapter-list">${chapterLinks}</nav>
  </aside>
  <main class="content-wrap">
    <article class="article">
      <h1>${escapeHtml(idea.title)}</h1>
      <div class="summary">${escapeHtml(idea.summary)}</div>
      <div class="meta"><span class="pill">${escapeHtml(idea.stage)}</span><span class="pill">${escapeHtml(idea.category)}</span><span class="pill">${idea.pro_candidate ? 'pro candidate' : 'free idea'}</span></div>
      ${ideaDiagram(idea.id)}
      <div class="chapter-body">${markdownToHtml(body)}</div>
    </article>
    <section class="comments" id="comments" data-idea-id="${escapeHtml(idea.id)}">
      <h2>Comments</h2>
      <div id="comment-list" class="comment-list"><p class="comment-empty">Loading comments...</p></div>
      <p id="comment-auth" class="auth-callout"><a href="${AUTH_PREFIX}/start?provider=github&return_to=/ideas/${escapeHtml(idea.id)}/">Sign in with GitHub</a> or <a href="${AUTH_PREFIX}/start?provider=google&return_to=/ideas/${escapeHtml(idea.id)}/">Google</a> to comment and react.</p>
      <form id="comment-form" class="comment-form">
        <label>Comment<textarea name="body" required minlength="3" maxlength="2000" placeholder="Add a useful comment, question, critique, or note."></textarea></label>
        <button class="button" type="submit">Post comment</button>
        <p id="comment-status" class="comment-status">Sign in to post public comments.</p>
      </form>
    </section>
  </main>
  <aside class="toc-rail">
    <div class="toc-title">Signals</div>
    <div class="signal-box">
      ${headings.length ? `<div><strong>Sections</strong><nav class="toc-box">${headings.map((heading) => `<a href="#${escapeHtml(heading.id)}">${escapeHtml(heading.title)}</a>`).join('')}</nav></div>` : ''}
      <div><strong>Reactions</strong><span><span id="support-count">${escapeHtml(idea.support)}</span> supports / <span id="trash-count">${escapeHtml(idea.trash)}</span> trash / <span id="pivot-count">${escapeHtml(idea.pivot)}</span> pivots</span><div class="reaction-buttons" aria-label="React to idea"><button class="react-button" type="button" data-reaction="support">&#128077; Support</button><button class="react-button" type="button" data-reaction="trash">&#128465; Trash</button><button class="react-button" type="button" data-reaction="pivot">&#128260; Pivot</button></div><p id="reaction-status" class="reaction-status">Sign in to react.</p></div>
      <div><strong>Contributions</strong><span>${escapeHtml(idea.contribution_count)} notes, critiques, risks, or evidence links</span></div>
      <div><strong>Next step</strong><span>${escapeHtml(idea.next_step || 'Needs a next validation step.')}</span></div>
      <div><strong>Risk</strong><span>${escapeHtml(idea.risk || 'Risk not yet named.')}</span></div>
      <div class="actions"><a class="button" href="/#ideas">Back to store</a><a class="button secondary" href="/api/ideas/${escapeHtml(idea.id)}">JSON</a></div>
    </div>
  </aside>
</div>
<script>
const ideaId = ${JSON.stringify(idea.id)};
const commentList = document.querySelector('#comment-list');
const commentForm = document.querySelector('#comment-form');
const commentStatus = document.querySelector('#comment-status');
const commentAuth = document.querySelector('#comment-auth');
const reactionStatus = document.querySelector('#reaction-status');
const reactionButtons = [...document.querySelectorAll('.react-button')];
const filter = document.querySelector('#book-filter');
const chapterLinks = [...document.querySelectorAll('#chapter-list .chapter-link')];
let signedInCommentUser = null;
if (filter) filter.oninput = () => {
  const query = filter.value.trim().toLowerCase();
  chapterLinks.forEach((link) => {
    link.hidden = query && !String(link.dataset.title || '').toLowerCase().includes(query);
  });
};
function commentDate(value) {
  const date = new Date(String(value || ''));
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString();
}
function emptyComment(message) {
  const empty = document.createElement('p');
  empty.className = 'comment-empty';
  empty.textContent = message;
  commentList.replaceChildren(empty);
}
function commentElement(item) {
  const article = document.createElement('article');
  article.className = 'comment';
  const head = document.createElement('div');
  head.className = 'comment-head';
  const author = document.createElement('strong');
  author.textContent = item.display_name || item.displayName || item.handle || 'Guest';
  const handle = document.createElement('span');
  handle.textContent = item.handle ? '@' + item.handle : 'guest';
  const kind = document.createElement('span');
  kind.className = 'comment-kind';
  kind.textContent = item.kind || 'comment';
  head.append(author, handle, kind);
  const timeText = commentDate(item.created_at);
  if (timeText) {
    const time = document.createElement('time');
    time.textContent = timeText;
    head.append(time);
  }
  const bodyEl = document.createElement('p');
  bodyEl.textContent = item.body || '';
  article.append(head, bodyEl);
  return article;
}
async function loadCommentSession() {
  const response = await fetch('${AUTH_PREFIX}/me', { credentials: 'same-origin' }).catch(() => null);
  if (!response || !response.ok) {
    commentForm.querySelector('button').disabled = true;
    reactionButtons.forEach((button) => button.disabled = true);
    commentAuth.style.display = 'block';
    return;
  }
  const data = await response.json().catch(() => ({}));
  signedInCommentUser = data.user || null;
  if (signedInCommentUser) {
    commentStatus.textContent = 'Posting as @' + signedInCommentUser.handle + '.';
    reactionStatus.textContent = 'Reacting as @' + signedInCommentUser.handle + '.';
    reactionButtons.forEach((button) => button.disabled = false);
  } else {
    commentForm.querySelector('button').disabled = true;
    reactionButtons.forEach((button) => button.disabled = true);
    commentAuth.style.display = 'block';
  }
}
async function loadComments() {
  const response = await fetch('/api/ideas/' + encodeURIComponent(ideaId) + '/contributions', { credentials: 'same-origin' }).catch(() => null);
  if (!response || !response.ok) {
    emptyComment('Could not load comments.');
    return;
  }
  const data = await response.json();
  const comments = (data.contributions || []).filter((item) => item.kind === 'comment');
  if (!comments.length) emptyComment('No comments yet. Be the first to sharpen this idea.');
  else commentList.replaceChildren(...comments.map(commentElement));
}
commentForm.onsubmit = async (event) => {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(commentForm).entries());
  if (!signedInCommentUser) {
    commentAuth.style.display = 'block';
    commentStatus.className = 'comment-status err';
    commentStatus.textContent = 'Sign in to post comments.';
    return;
  }
  commentForm.querySelector('button').disabled = true;
  commentStatus.className = 'comment-status';
  commentStatus.textContent = 'Posting comment...';
  const response = await fetch('/api/ideas/' + encodeURIComponent(ideaId) + '/contributions', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify({ kind: 'comment', body: data.body }),
  });
  const result = await response.json().catch(() => ({}));
  commentForm.querySelector('button').disabled = false;
  if (!response.ok) {
    commentStatus.className = 'comment-status err';
    commentStatus.textContent = result.error || 'Could not post comment.';
    return;
  }
  commentForm.reset();
  commentStatus.textContent = signedInCommentUser ? 'Comment posted as @' + signedInCommentUser.handle + '.' : 'Comment posted.';
  await loadComments();
};
reactionButtons.forEach((button) => {
  button.disabled = true;
  button.onclick = async () => {
    if (!signedInCommentUser) {
      commentAuth.style.display = 'block';
      reactionStatus.textContent = 'Sign in to react.';
      return;
    }
    const type = button.dataset.reaction;
    button.disabled = true;
    reactionStatus.textContent = 'Saving reaction...';
    const response = await fetch('/api/ideas/' + encodeURIComponent(ideaId) + '/reactions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ type }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      reactionStatus.textContent = result.error || 'Could not save reaction.';
      button.disabled = false;
      return;
    }
    const latest = await fetch('/api/ideas/' + encodeURIComponent(ideaId), { credentials: 'same-origin' }).then((item) => item.ok ? item.json() : null).catch(() => null);
    if (latest?.idea) {
      document.querySelector('#support-count').textContent = String(latest.idea.support || 0);
      document.querySelector('#trash-count').textContent = String(latest.idea.trash || 0);
      document.querySelector('#pivot-count').textContent = String(latest.idea.pivot || 0);
    }
    reactionStatus.textContent = 'Reaction saved.';
    reactionButtons.forEach((item) => item.disabled = false);
  };
});
loadCommentSession();
loadComments();
</script>
${readerSettingsScript()}
</body>
</html>`;

  return htmlResponse(page);
}
