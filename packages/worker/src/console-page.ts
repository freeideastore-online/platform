const AUTH_PREFIX = '/.fis/auth';
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
function consoleScript() {
  return `
const form = document.querySelector('#idea-form');
const statusBox = document.querySelector('#status');
const sessionBox = document.querySelector('#session');
const actions = document.querySelector('#auth-actions');
const guestLabel = document.querySelector('#guest-label');
const accountSlot = document.querySelector('#account-slot');
const ownerWork = document.querySelector('#owner-work');
const myIdeasList = document.querySelector('#my-ideas-list');
const workSummary = document.querySelector('#work-summary');
const ideaCount = document.querySelector('#idea-count');
const refreshWork = document.querySelector('#refresh-work');
const submitButton = form.querySelector('button[type="submit"]');
let signedInUser = null;
let lastActivity = null;
function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
}
function setStatus(message, kind = '') {
  statusBox.className = 'status ' + kind;
  statusBox.textContent = message;
}
function initials(value) {
  return String(value || 'U').split(/[\\s-]+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase() || 'U';
}
function formatDate(value) {
  const date = new Date(String(value || ''));
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString();
}
function textNode(value) {
  return document.createTextNode(String(value || ''));
}
function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.append(textNode(text));
  return node;
}
function linkElement(href, className, text) {
  const link = element('a', className, text);
  link.href = href;
  return link;
}
function renderAvatarLink(user) {
  clear(accountSlot);
  const link = linkElement('/profile/', 'account-avatar', '');
  link.setAttribute('aria-label', 'Profile');
  if (user.avatarUrl) {
    const img = document.createElement('img');
    img.src = user.avatarUrl;
    img.alt = user.handle || 'Profile';
    link.append(img);
  } else {
    link.append(element('span', '', initials(user.displayName || user.handle)));
  }
  accountSlot.append(link);
}
function ideaCardElement(idea) {
  const meta = [idea.stage, idea.category].filter(Boolean).join(' / ');
  const date = formatDate(idea.updated_at);
  const card = element('div', 'idea-item', '');
  card.dataset.ideaId = idea.id || '';
  card.dataset.ideaTitle = idea.title || '';
  const link = linkElement('/ideas/' + encodeURIComponent(idea.id || '') + '/', '', '');
  link.append(element('strong', '', idea.title || 'Untitled idea'));
  link.append(element('span', '', meta || idea.summary || ''));
  if (date) link.append(element('time', '', 'Updated ' + date));
  card.append(link);
  if (signedInUser) {
    const button = element('button', 'button danger small delete-idea', 'Delete');
    button.type = 'button';
    button.dataset.ideaId = idea.id || '';
    button.dataset.ideaTitle = idea.title || '';
    card.append(button);
  }
  return card;
}
function miniContributionElement(item) {
  const link = linkElement('/ideas/' + encodeURIComponent(item.idea_id || '') + '/', 'mini-item', '');
  link.append(element('strong', '', item.kind || 'Contribution'));
  link.append(element('span', '', item.idea_title || 'Untitled idea'));
  return link;
}
function emptyState(text) {
  return element('p', 'empty-state', text);
}
function renderOwnerWork(activity) {
  const ideas = activity.ideas || [];
  const contributions = activity.contributions || [];
  ownerWork.className = '';
  clear(ownerWork);
  ownerWork.append(linkElement('/profile/', 'button secondary', 'Open profile'));
  const miniList = element('div', 'mini-list', '');
  if (ideas.length) ideas.slice(0, 5).forEach((idea) => miniList.append(ideaCardElement(idea)));
  else miniList.append(element('p', 'muted', 'No ideas created yet.'));
  contributions.slice(0, 3).forEach((item) => miniList.append(miniContributionElement(item)));
  ownerWork.append(miniList);
  ideaCount.textContent = String(ideas.length);
  clear(myIdeasList);
  if (!signedInUser) {
    workSummary.textContent = 'Sign in to load ideas attached to your account.';
    myIdeasList.append(emptyState('Not signed in. Guest ideas are public, but they are not attached to your account.'));
  } else if (ideas.length) {
    workSummary.textContent = 'Signed in as @' + signedInUser.handle + '. Newest account-owned ideas are shown first.';
    ideas.forEach((idea) => myIdeasList.append(ideaCardElement(idea)));
  } else {
    workSummary.textContent = 'Signed in as @' + signedInUser.handle + ', but no ideas are owned by this account yet.';
    myIdeasList.append(emptyState('No account-owned ideas yet. If you created one while signed out or under another handle, it will not appear here.'));
  }
}
async function loadAccountWork() {
  if (!signedInUser) {
    renderOwnerWork({ ideas: [], contributions: [] });
    return null;
  }
  workSummary.textContent = 'Loading ideas for @' + signedInUser.handle + '...';
  const activityResponse = await fetch('/api/me/activity?idea_limit=100&contribution_limit=10', { credentials: 'same-origin' }).catch(() => null);
  if (!activityResponse || !activityResponse.ok) {
    workSummary.textContent = 'Could not load account ideas. Refresh or sign in again.';
    clear(myIdeasList);
    myIdeasList.append(emptyState('The account check failed, so this list may be stale.'));
    ownerWork.textContent = 'Could not load recent account work.';
    return null;
  }
  lastActivity = await activityResponse.json();
  renderOwnerWork(lastActivity);
  return lastActivity;
}
async function loadSession() {
  const response = await fetch('${AUTH_PREFIX}/me', { credentials: 'same-origin' }).catch(() => null);
  if (!response || !response.ok) {
    sessionBox.textContent = 'Not signed in. You can test with a guest handle, but public attribution should use GitHub or Google.';
    clear(accountSlot);
    accountSlot.append(linkElement('${AUTH_PREFIX}/start?provider=github&return_to=/console/', '', 'Sign in'));
    renderOwnerWork({ ideas: [], contributions: [] });
    return;
  }
  const data = await response.json();
  signedInUser = data.user;
  sessionBox.textContent = 'Signed in as @' + signedInUser.handle + ' via ' + signedInUser.provider + '.';
  renderAvatarLink(signedInUser);
  guestLabel.style.display = 'none';
  clear(actions);
  const logout = element('button', 'button danger', 'Sign out');
  logout.type = 'button';
  logout.onclick = async () => {
    await fetch('${AUTH_PREFIX}/logout', { method: 'POST', credentials: 'same-origin' });
    location.reload();
  };
  actions.append(logout);
  await loadAccountWork();
}
refreshWork.onclick = () => loadAccountWork();
myIdeasList.onclick = async (event) => {
  const button = event.target.closest('.delete-idea');
  if (!button) return;
  const ideaId = button.dataset.ideaId || '';
  const title = button.dataset.ideaTitle || ideaId;
  if (!ideaId || !confirm('Delete "' + title + '" from FreeIdeaStore? This hides it from public pages and your profile.')) return;
  button.disabled = true;
  setStatus('Deleting idea...');
  const response = await fetch('/api/ideas/' + encodeURIComponent(ideaId), {
    method: 'DELETE',
    headers: { 'content-type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify({ confirm_title: title }),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    button.disabled = false;
    return setStatus(result.error || 'Could not delete idea.', 'err');
  }
  await loadAccountWork();
  setStatus('Idea deleted: ' + (result.idea || ideaId) + '.', 'ok');
};
form.onsubmit = async (event) => {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(form).entries());
  const headers = { 'content-type': 'application/json' };
  if (!signedInUser && data.handle) headers['x-idea-handle'] = data.handle;
  submitButton.disabled = true;
  setStatus('Creating idea...');
  const response = await fetch('/api/ideas', { method: 'POST', headers, credentials: 'same-origin', body: JSON.stringify(data) });
  const result = await response.json().catch(() => ({}));
  submitButton.disabled = false;
  if (!response.ok) return setStatus(result.error || 'Could not create idea.', 'err');
  form.reset();
  if (signedInUser) await loadAccountWork();
  const ownerText = signedInUser ? ' under @' + signedInUser.handle : ' as a guest idea';
  setStatus('Idea created' + ownerText + '.', 'ok');
  const inlineActions = element('div', 'inline-actions', '');
  inlineActions.append(linkElement(result.url || '/', 'button', 'Open idea'));
  const createAnother = element('button', 'button secondary', 'Create another');
  createAnother.type = 'button';
  createAnother.onclick = () => {
    form.querySelector('input[name="title"]').focus();
  };
  inlineActions.append(createAnother);
  statusBox.append(inlineActions);
};
loadSession();

// --- Tabs ---
const tabs = document.querySelectorAll('.tab');
tabs.forEach((tab) => tab.onclick = () => {
  tabs.forEach((t) => t.classList.remove('active'));
  tab.classList.add('active');
  document.querySelector('#tab-ai').classList.toggle('hidden', tab.dataset.tab !== 'ai');
  document.querySelector('#tab-manual').classList.toggle('hidden', tab.dataset.tab !== 'manual');
});

// --- AI Chat ---
const chatBox = document.querySelector('#chat-box');
const chatForm = document.querySelector('#chat-form');
const chatInput = document.querySelector('#chat-input');
const chatSend = document.querySelector('#chat-send');
const aiStatus = document.querySelector('#ai-status');
const aiKeyInput = document.querySelector('#ai-key');
const aiProviderSelect = document.querySelector('#ai-provider');
const aiModelInput = document.querySelector('#ai-model');
let chatMessages = [];
let streaming = false;

// Restore key from localStorage
aiKeyInput.value = localStorage.getItem('fis:ai-key') || '';
aiProviderSelect.value = localStorage.getItem('fis:ai-provider') || 'anthropic';
aiModelInput.value = localStorage.getItem('fis:ai-model') || '';
aiKeyInput.oninput = () => localStorage.setItem('fis:ai-key', aiKeyInput.value);
aiProviderSelect.onchange = () => localStorage.setItem('fis:ai-provider', aiProviderSelect.value);
aiModelInput.oninput = () => localStorage.setItem('fis:ai-model', aiModelInput.value);

function addChatMessage(role, content) {
  const msg = document.createElement('div');
  msg.className = 'chat-msg ' + role;
  msg.textContent = content;
  chatBox.append(msg);
  chatBox.scrollTop = chatBox.scrollHeight;
  return msg;
}

function tryParseIdeaJson(text) {
  const match = text.match(/\`\`\`json\\n?([\\s\\S]*?)\`\`\`/);
  if (!match) return null;
  try { return JSON.parse(match[1]); } catch { return null; }
}

function addPublishButton(ideaData) {
  const wrap = document.createElement('div');
  wrap.className = 'chat-publish';
  const btn = document.createElement('button');
  btn.className = 'button';
  btn.textContent = 'Publish this idea';
  btn.type = 'button';
  btn.onclick = async () => {
    btn.disabled = true;
    btn.textContent = 'Publishing...';
    const headers = { 'content-type': 'application/json' };
    if (!signedInUser && form.querySelector('[name=handle]')?.value) {
      headers['x-idea-handle'] = form.querySelector('[name=handle]').value;
    }
    const res = await fetch('/api/ideas', {
      method: 'POST', headers, credentials: 'same-origin',
      body: JSON.stringify(ideaData),
    });
    const result = await res.json().catch(() => ({}));
    if (!res.ok) {
      btn.disabled = false;
      btn.textContent = 'Publish this idea';
      aiStatus.className = 'status err';
      aiStatus.textContent = result.error || 'Could not create idea.';
      return;
    }
    btn.textContent = 'Published!';
    aiStatus.className = 'status ok';
    aiStatus.textContent = 'Idea created!';
    const link = document.createElement('a');
    link.className = 'button secondary';
    link.href = result.url || '/';
    link.textContent = 'Open idea';
    wrap.append(link);
    if (signedInUser) loadAccountWork();
  };
  wrap.append(btn);
  chatBox.append(wrap);
  chatBox.scrollTop = chatBox.scrollHeight;
}

async function streamChat(userMessage) {
  if (streaming) return;
  const apiKey = aiKeyInput.value.trim();
  if (!apiKey) {
    aiStatus.className = 'status err';
    aiStatus.textContent = 'Enter your API key above to use AI elaboration.';
    aiKeyInput.focus();
    return;
  }

  streaming = true;
  chatSend.disabled = true;
  chatSend.textContent = '...';

  addChatMessage('user', userMessage);
  chatMessages.push({ role: 'user', content: userMessage });

  const assistantMsg = addChatMessage('assistant', '');
  let fullText = '';

  try {
    const provider = aiProviderSelect.value;
    const model = aiModelInput.value.trim() || undefined;
    const res = await fetch('/api/ai/elaborate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ apiKey, provider, model, messages: chatMessages }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      assistantMsg.textContent = err.error || 'Error from AI provider.';
      assistantMsg.style.color = 'var(--bad)';
      streaming = false;
      chatSend.disabled = false;
      chatSend.textContent = 'Send';
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split('\\n');
      buf = lines.pop() || '';
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const data = line.slice(6).trim();
        if (data === '[DONE]') continue;
        try {
          const parsed = JSON.parse(data);
          // Anthropic format
          if (parsed.type === 'content_block_delta' && parsed.delta?.text) {
            fullText += parsed.delta.text;
          }
          // OpenAI format
          if (parsed.choices?.[0]?.delta?.content) {
            fullText += parsed.choices[0].delta.content;
          }
          assistantMsg.textContent = fullText;
          chatBox.scrollTop = chatBox.scrollHeight;
        } catch {}
      }
    }

    chatMessages.push({ role: 'assistant', content: fullText });

    // Check if the response contains a publishable idea JSON
    const ideaData = tryParseIdeaJson(fullText);
    if (ideaData && ideaData.title && ideaData.summary) {
      addPublishButton(ideaData);
      aiStatus.className = 'status ok';
      aiStatus.textContent = 'AI drafted an idea. Review it and click Publish, or keep chatting to refine.';
    } else {
      aiStatus.className = 'status';
      aiStatus.textContent = 'Keep the conversation going. When the AI has enough context, it will draft a publishable idea.';
    }
  } catch (err) {
    assistantMsg.textContent = 'Connection error: ' + (err.message || 'unknown');
    assistantMsg.style.color = 'var(--bad)';
  }

  streaming = false;
  chatSend.disabled = false;
  chatSend.textContent = 'Send';
}

chatForm.onsubmit = (e) => {
  e.preventDefault();
  const msg = chatInput.value.trim();
  if (!msg) return;
  chatInput.value = '';
  streamChat(msg);
};

chatInput.onkeydown = (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    chatForm.dispatchEvent(new Event('submit'));
  }
};
`;
}
export function renderConsolePage(request: Request) {
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
.shell{max-width:1120px;margin:0 auto;padding:1.5rem 1.25rem}.eyebrow{color:var(--accent);font-size:.72rem;font-weight:900;letter-spacing:.12em;text-transform:uppercase}h1{font-family:Fraunces,serif;font-size:clamp(2rem,4.6vw,3.9rem);line-height:1;margin:.35rem 0 1rem}.layout{display:grid;grid-template-columns:minmax(0,1fr) 330px;gap:1rem;align-items:start}.panel{border:1px solid var(--line);border-radius:8px;background:var(--panel);padding:1rem;box-shadow:0 10px 22px rgba(16,32,39,.04)}.panel h2{font-size:1rem;margin-bottom:.6rem}.panel-head{display:flex;align-items:center;justify-content:space-between;gap:.75rem;margin-bottom:.75rem}.panel-head h2{margin:0}.muted{color:var(--muted);font-size:.86rem}.auth{display:grid;gap:.5rem}.button{display:inline-flex;justify-content:center;align-items:center;border:1px solid var(--accent);border-radius:8px;background:var(--accent);color:white;cursor:pointer;padding:.65rem .85rem;font-weight:900}.button.secondary{background:white;color:var(--accent)}.button.danger{border-color:var(--bad);background:white;color:var(--bad)}.button.small{padding:.45rem .62rem;font-size:.76rem}button:disabled{cursor:not-allowed;opacity:.58}form{display:grid;gap:.75rem}label{display:grid;gap:.3rem;color:var(--muted);font-size:.78rem;font-weight:900;text-transform:uppercase}input,textarea,select{width:100%;border:1px solid var(--line);border-radius:8px;background:white;color:var(--ink);padding:.65rem}textarea{min-height:120px;resize:vertical}.split{display:grid;grid-template-columns:1fr 1fr;gap:.75rem}.status{border:1px solid var(--line);border-radius:8px;background:#fbfdfd;color:var(--muted);padding:.75rem;font-size:.84rem;margin-top:.75rem}.status.ok{border-color:#99f6e4;color:#115e59}.status.err{border-color:#fecaca;color:#991b1b}.work-panel{margin-bottom:1rem}.work-toolbar{display:flex;align-items:center;gap:.5rem}.count-pill{display:inline-flex;min-width:1.7rem;justify-content:center;border:1px solid var(--line);border-radius:999px;padding:.18rem .5rem;color:var(--muted);font-size:.72rem;font-weight:900}.idea-list,.mini-list{display:grid;gap:.55rem}.idea-item,.mini-item{display:grid;gap:.18rem;border:1px solid var(--line);border-radius:8px;background:#fbfdfd;padding:.75rem;text-align:left}.idea-item:hover,.mini-item:hover{border-color:#9ccbd5;background:#f4fbfc}.idea-item strong,.mini-item strong{font-size:.9rem}.idea-item span,.mini-item span{color:var(--muted);font-size:.78rem}.idea-item time{color:var(--muted);font-size:.72rem}.empty-state{border:1px dashed var(--line);border-radius:8px;padding:1rem;background:#fbfdfd;color:var(--muted);font-size:.86rem}.side-stack{display:grid;gap:1rem}.inline-actions{display:flex;flex-wrap:wrap;gap:.5rem;margin-top:.65rem}
.tabs{display:flex;gap:.35rem;margin-bottom:1rem}.tab{border:1px solid var(--line);border-radius:8px;background:var(--panel);color:var(--muted);cursor:pointer;padding:.55rem .85rem;font-size:.82rem;font-weight:800}.tab.active{border-color:var(--accent);background:var(--accent);color:white}.hidden{display:none!important}
.ai-setup{display:grid;gap:.65rem;margin-bottom:.75rem;padding-bottom:.75rem;border-bottom:1px solid var(--line)}
.chat-box{min-height:200px;max-height:480px;overflow-y:auto;display:grid;gap:.55rem;margin-bottom:.75rem;padding:.5rem 0}.chat-msg{border:1px solid var(--line);border-radius:10px;padding:.7rem .85rem;font-size:.88rem;line-height:1.55;max-width:92%;word-wrap:break-word;white-space:pre-wrap}.chat-msg.user{background:#ecfeff;border-color:#a5f3fc;justify-self:end}.chat-msg.assistant{background:var(--panel);justify-self:start}.chat-msg code{background:#f1f5f9;border-radius:4px;padding:.1rem .3rem;font-size:.82em}.chat-msg pre{background:#f1f5f9;border-radius:6px;padding:.6rem;overflow-x:auto;margin:.4rem 0;font-size:.8rem;white-space:pre-wrap}.chat-publish{margin-top:.5rem;display:flex;gap:.45rem;flex-wrap:wrap}
.chat-input-row{display:grid;grid-template-columns:1fr auto;gap:.5rem;align-items:end}.chat-input-row textarea{min-height:52px;resize:vertical}
@media(max-width:840px){.layout{grid-template-columns:1fr}nav{display:none}.split{grid-template-columns:1fr}.panel-head{align-items:flex-start;flex-direction:column}.work-toolbar{width:100%;justify-content:space-between}}
</style>
</head>
<body>
<header><a href="/" class="brand"><span class="mark">FI</span><span>FreeIdeaStore</span></a><nav><a href="/#ideas">Ideas</a><a href="/about/">About</a><a href="/docs/">Docs</a><a href="/skills/">Skills</a><a href="/contributors/">Contributors</a><a href="/console/">Console</a><span id="account-slot"></span><a href="https://proideastore.online">ProIdeaStore</a></nav></header>
<main class="shell">
  <div class="eyebrow">Creation console</div><h1>Put an idea into the refinery.</h1>
  <section class="panel work-panel">
    <div class="panel-head">
      <div>
        <h2>My ideas</h2>
        <p id="work-summary" class="muted">Checking the account attached to this browser...</p>
      </div>
      <div class="work-toolbar">
        <span id="idea-count" class="count-pill">0</span>
        <button class="button secondary small" id="refresh-work" type="button">Refresh</button>
        <a class="button secondary small" href="/profile/">Profile</a>
      </div>
    </div>
    <div id="my-ideas-list" class="idea-list"><p class="empty-state">Loading your account ideas...</p></div>
  </section>
  <div class="tabs" id="console-tabs">
    <button class="tab active" data-tab="ai">AI Elaboration</button>
    <button class="tab" data-tab="manual">Manual Form</button>
  </div>
  <div class="layout">
    <section class="panel" id="tab-ai">
      <div class="ai-setup" id="ai-setup">
        <label>API Key<input id="ai-key" type="password" placeholder="sk-... or anthropic key" autocomplete="off"></label>
        <div class="split">
          <label>Provider<select id="ai-provider"><option value="anthropic">Anthropic (Claude)</option><option value="openai">OpenAI</option></select></label>
          <label>Model<input id="ai-model" placeholder="auto (recommended)"></label>
        </div>
        <p class="muted">Your key is stored in your browser only. It is sent to the AI provider through Cloudflare AI Gateway — never stored on our servers.</p>
      </div>
      <div class="chat-box" id="chat-box"></div>
      <form id="chat-form" class="chat-input-row">
        <textarea id="chat-input" rows="2" placeholder="Describe your idea... e.g. 'An app that helps parents coordinate school transport for kids aged 5-10'" required></textarea>
        <button class="button" type="submit" id="chat-send">Send</button>
      </form>
      <div id="ai-status" class="status">Describe your idea and the AI will interview you, research it, and draft a publishable idea page.</div>
    </section>
    <section class="panel hidden" id="tab-manual">
      <div class="panel-head"><h2>New idea</h2></div>
      <form id="idea-form">
        <label>Title<input name="title" required minlength="3" maxlength="80" placeholder="Example: Local repair marketplace"></label>
        <label>Summary<textarea name="summary" required minlength="10" maxlength="1000" placeholder="Who has the problem, what hurts, and why this may be worth exploring?"></textarea></label>
        <div class="split">
          <label>Stage<select name="stage"><option>raw</option><option>shaping</option><option>researching</option><option>validating</option><option>prototyping</option><option>launched</option><option>pivot</option><option>parked</option></select></label>
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
    <aside class="side-stack">
      <section class="panel">
        <h2>Session</h2>
        <p id="session" class="muted">Checking sign-in...</p>
        <div class="auth" id="auth-actions">
          <a class="button" href="${AUTH_PREFIX}/start?provider=github&return_to=/console/">Sign in with GitHub</a>
          <a class="button secondary" href="${AUTH_PREFIX}/start?provider=google&return_to=/console/">Sign in with Google</a>
        </div>
      </section>
      <section class="panel">
        <h2>Your idea pipeline</h2>
        <div id="owner-work" class="muted">Sign in to see ideas and recent work attached to your account.</div>
      </section>
    </aside>
  </div>
</main>
<script>${consoleScript()}</script>
</body></html>`, {
    headers: { ...SECURITY_HEADERS, 'Content-Type': 'text/html;charset=UTF-8', 'Cache-Control': 'no-store' },
  });
}
