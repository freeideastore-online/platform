import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const docsDir = path.join(root, 'docs');
const ideasDir = path.join(docsDir, 'ideas');
const outDir = path.join(root, 'store', 'ideas');

const escapeHtml = (value) =>
  String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');

function parseMarkdown(source) {
  const frontmatter = {};
  let body = source.trim();
  if (body.startsWith('---')) {
    const end = body.indexOf('\n---', 3);
    if (end !== -1) {
      const raw = body.slice(3, end).trim();
      body = body.slice(end + 4).trim();
      for (const line of raw.split('\n')) {
        const [key, ...rest] = line.split(':');
        if (key && rest.length) frontmatter[key.trim()] = rest.join(':').trim().replace(/^"|"$/g, '');
      }
    }
  }
  return { frontmatter, body };
}

function inlineMarkdown(value) {
  return escapeHtml(value)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, href) => {
      const safeHref = href.startsWith('http') || href.startsWith('/') || href.startsWith('../') ? href : '#';
      return `<a href="${escapeHtml(safeHref)}">${label}</a>`;
    });
}

function renderMarkdown(markdown) {
  const lines = markdown.split(/\r?\n/);
  const html = [];
  let listOpen = false;
  let orderedOpen = false;

  const closeLists = () => {
    if (listOpen) {
      html.push('</ul>');
      listOpen = false;
    }
    if (orderedOpen) {
      html.push('</ol>');
      orderedOpen = false;
    }
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      closeLists();
      continue;
    }
    if (trimmed.startsWith('### ')) {
      closeLists();
      html.push(`<h3>${inlineMarkdown(trimmed.slice(4))}</h3>`);
    } else if (trimmed.startsWith('## ')) {
      closeLists();
      html.push(`<h2>${inlineMarkdown(trimmed.slice(3))}</h2>`);
    } else if (trimmed.startsWith('# ')) {
      closeLists();
      html.push(`<h1>${inlineMarkdown(trimmed.slice(2))}</h1>`);
    } else if (trimmed.startsWith('- ')) {
      if (orderedOpen) {
        html.push('</ol>');
        orderedOpen = false;
      }
      if (!listOpen) {
        html.push('<ul>');
        listOpen = true;
      }
      html.push(`<li>${inlineMarkdown(trimmed.slice(2))}</li>`);
    } else if (/^\d+\.\s/.test(trimmed)) {
      if (listOpen) {
        html.push('</ul>');
        listOpen = false;
      }
      if (!orderedOpen) {
        html.push('<ol>');
        orderedOpen = true;
      }
      html.push(`<li>${inlineMarkdown(trimmed.replace(/^\d+\.\s/, ''))}</li>`);
    } else {
      closeLists();
      html.push(`<p>${inlineMarkdown(trimmed)}</p>`);
    }
  }
  closeLists();
  return html.join('\n');
}

async function readIdea(slug) {
  const source = await readFile(path.join(ideasDir, slug, 'index.md'), 'utf8');
  const parsed = parseMarkdown(source);
  return {
    slug,
    title: parsed.frontmatter.title || slug,
    summary: parsed.frontmatter.summary || '',
    stage: parsed.frontmatter.stage || 'raw',
    category: parsed.frontmatter.category || 'uncategorized',
    html: renderMarkdown(parsed.body),
  };
}

function page({ title, summary, content, ideas, currentSlug = '' }) {
  const links = ideas
    .map((idea) => {
      const href = currentSlug ? `../${idea.slug}/` : `${idea.slug}/`;
      const active = idea.slug === currentSlug ? ' active' : '';
      return `<a class="doc-link${active}" href="${href}"><span>${escapeHtml(idea.title)}</span><small>${escapeHtml(idea.stage)}</small></a>`;
    })
    .join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>${escapeHtml(title)} - FreeIdeaStore Project Docs</title>
<meta name="description" content="${escapeHtml(summary)}">
<link rel="icon" type="image/svg+xml" href="${currentSlug ? '../../favicon.svg' : '../favicon.svg'}">
<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,700;9..144,800&family=Manrope:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<style>
*{box-sizing:border-box;margin:0;padding:0}
:root{--paper:#f7f8fb;--panel:#fff;--ink:#101827;--muted:#5f6b7a;--line:#dce3ed;--accent:#0ea5e9;--accent-dark:#075985;--mark:#ecfeff}
body{background:var(--paper);color:var(--ink);font-family:Manrope,system-ui,sans-serif;line-height:1.62}
a{color:inherit;text-decoration:none}
.shell{display:grid;grid-template-columns:290px minmax(0,1fr);min-height:100vh}
aside{border-right:1px solid var(--line);background:#fff;padding:1rem;position:sticky;top:0;height:100vh;overflow:auto}
.brand{display:flex;align-items:center;gap:.65rem;margin-bottom:1rem;font-weight:900}
.logo{display:grid;width:34px;height:34px;place-items:center;border-radius:8px;background:linear-gradient(135deg,#38bdf8,#0ea5e9);color:#fff}
.store-link{display:inline-flex;border:1px solid var(--line);border-radius:8px;padding:.55rem .7rem;color:var(--accent-dark);font-size:.78rem;font-weight:900;margin-bottom:1rem}
.nav-title{color:var(--muted);font-size:.7rem;text-transform:uppercase;font-weight:900;letter-spacing:.12em;margin:.4rem 0}
.doc-list{display:grid;gap:.4rem}
.doc-link{display:grid;gap:.15rem;border:1px solid transparent;border-radius:8px;padding:.58rem .62rem}
.doc-link:hover,.doc-link.active{background:var(--mark);border-color:#bae6fd}
.doc-link span{font-size:.82rem;font-weight:900}
.doc-link small{color:var(--muted);font-size:.68rem;text-transform:uppercase;font-weight:800}
main{padding:2rem 1.25rem 4rem}
.article{max-width:850px;margin:0 auto}
.crumb{color:var(--accent-dark);font-size:.75rem;font-weight:900;text-transform:uppercase;letter-spacing:.1em;margin-bottom:.75rem}
h1{font-family:Fraunces,serif;font-size:clamp(2.1rem,5vw,4.4rem);line-height:.96;letter-spacing:0;margin-bottom:1rem}
h2{font-family:Fraunces,serif;font-size:1.65rem;margin:2rem 0 .55rem;padding-top:.4rem;border-top:1px solid var(--line)}
h3{font-size:1.05rem;margin:1.4rem 0 .35rem}
p{color:#253244;margin:.75rem 0}
ul,ol{display:grid;gap:.42rem;margin:.7rem 0 .95rem 1.25rem;color:#253244}
li::marker{color:var(--accent-dark);font-weight:900}
.summary{border-left:4px solid var(--accent);background:#fff;padding:.9rem 1rem;border-radius:0 8px 8px 0;color:var(--muted);font-weight:700;margin-bottom:1.2rem}
.meta{display:flex;flex-wrap:wrap;gap:.45rem;margin-bottom:1.2rem}
.pill{border:1px solid var(--line);border-radius:999px;background:#fff;padding:.32rem .62rem;color:var(--muted);font-size:.72rem;font-weight:900;text-transform:uppercase}
footer{max-width:850px;margin:2rem auto 0;border-top:1px solid var(--line);padding-top:1rem;color:var(--muted);font-size:.78rem}
@media(max-width:860px){.shell{grid-template-columns:1fr}aside{position:relative;height:auto;border-right:0;border-bottom:1px solid var(--line)}main{padding-top:1.35rem}.doc-list{grid-template-columns:repeat(auto-fit,minmax(210px,1fr))}}
</style>
</head>
<body>
<div class="shell">
  <aside>
    <a class="brand" href="${currentSlug ? '../' : './'}"><span class="logo">I</span><span>FreeIdeaStore Docs</span></a>
    <a class="store-link" href="${currentSlug ? '../../' : '../'}">Back to store</a>
    <div class="nav-title">Idea docs</div>
    <nav class="doc-list">${links}</nav>
  </aside>
  <main>
    <article class="article">
      <div class="crumb">Project docs</div>
      ${content}
    </article>
    <footer>FreeIdeaStore project docs are working documents. Strong ideas can graduate into ProIdeaStore dossiers.</footer>
  </main>
</div>
</body>
</html>`;
}

const slugs = (await readdir(ideasDir, { withFileTypes: true }))
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();
const ideas = await Promise.all(slugs.map(readIdea));

await mkdir(outDir, { recursive: true });
const indexParsed = parseMarkdown(await readFile(path.join(docsDir, 'index.md'), 'utf8'));
const indexContent = `${renderMarkdown(indexParsed.body)}
<h2>Idea Index</h2>
<ul>
${ideas.map((idea) => `<li><a href="${idea.slug}/"><strong>${escapeHtml(idea.title)}</strong></a> - ${escapeHtml(idea.summary)}</li>`).join('\n')}
</ul>`;
await writeFile(
  path.join(outDir, 'index.html'),
  page({
    title: indexParsed.frontmatter.title || 'FreeIdeaStore Project Docs',
    summary: indexParsed.frontmatter.summary || '',
    content: indexContent,
    ideas,
  }),
);

for (const idea of ideas) {
  const ideaOut = path.join(outDir, idea.slug);
  await mkdir(ideaOut, { recursive: true });
  const content = `<div class="summary">${escapeHtml(idea.summary)}</div>
<div class="meta"><span class="pill">${escapeHtml(idea.stage)}</span><span class="pill">${escapeHtml(idea.category)}</span></div>
${idea.html}`;
  await writeFile(
    path.join(ideaOut, 'index.html'),
    page({ title: idea.title, summary: idea.summary, content, ideas, currentSlug: idea.slug }),
  );
}

console.log(`Built ${ideas.length + 1} FreeIdeaStore docs pages into ${path.relative(root, outDir)}`);
