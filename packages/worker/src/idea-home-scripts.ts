import { AUTH_PREFIX } from './auth';
import { readerSettingsScript } from './reader-settings';

export function ideaHomeScripts(ideaId: string): string {
  return `<script>
const ideaId = ${JSON.stringify(ideaId)};
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
  // Only conversation lands here. Evidence, risks, pivots and refinements are
  // rendered server-side in the "Research & evidence" section above.
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
// Research entries are collapsed <details>. A shared link to one would otherwise
// scroll to a closed box and look broken, so open whatever the fragment targets.
function openTargetedResearch() {
  const hash = window.location.hash.slice(1);
  if (!hash) return;
  const target = document.getElementById(hash);
  if (!target) return;
  const item = target.closest ? target.closest('details') : null;
  if (item) {
    item.open = true;
    item.scrollIntoView({ block: 'start' });
  }
}
window.addEventListener('hashchange', openTargetedResearch);
openTargetedResearch();

loadCommentSession();
loadComments();
</script>
${readerSettingsScript()}`;
}
