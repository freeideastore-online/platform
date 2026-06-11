import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const booksRoot = path.join(root, 'idea-books');
const storeDir = path.join(root, 'store');
const outRoot = path.join(storeDir, 'ideas');
const publicBase = 'https://freeideastore.online';

const chapterFiles = [
  'snapshot',
  'brainstorming',
  'problem-customer',
  'research',
  'design',
  'prototype',
  'validation',
  'open-questions',
  'contribute',
];

const escapeHtml = (value) =>
  String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');

function slugify(input) {
  return String(input)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 72);
}

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

function parseTomlValue(source, key) {
  const match = source.match(new RegExp(`^${key}\\s*=\\s*["']([^"']+)["']`, 'm'));
  return match?.[1] || '';
}

function inlineMarkdown(value) {
  return escapeHtml(value)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, href) => {
      const safeHref = href.startsWith('http') || href.startsWith('/') || href.startsWith('../') ? href : '#';
      return `<a href="${escapeHtml(safeHref)}">${escapeHtml(label)}</a>`;
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

async function readBook(slug) {
  const bookDir = path.join(booksRoot, slug);
  const docsDir = path.join(bookDir, 'docs');
  const toml = await readFile(path.join(bookDir, 'zensical.toml'), 'utf8');
  const index = parseMarkdown(await readFile(path.join(docsDir, 'index.md'), 'utf8'));
  const chapters = [];

  for (const file of chapterFiles) {
    const parsed = parseMarkdown(await readFile(path.join(docsDir, `${file}.md`), 'utf8'));
    const title = parsed.frontmatter.title || parsed.body.match(/^#\s+(.+)$/m)?.[1] || file;
    chapters.push({
      file,
      slug: slugify(title),
      title,
      summary: parsed.frontmatter.summary || index.frontmatter.summary || '',
      body: parsed.body,
      excerpt: parsed.body.replace(/^# .+$/m, '').replace(/\s+/g, ' ').trim().slice(0, 180),
    });
  }

  return {
    slug,
    siteName: parseTomlValue(toml, 'site_name') || index.frontmatter.title || slug,
    siteUrl: parseTomlValue(toml, 'site_url') || `${publicBase}/ideas/${slug}`,
    title: index.frontmatter.title || parseTomlValue(toml, 'site_name') || slug,
    summary: index.frontmatter.summary || parseTomlValue(toml, 'site_description') || '',
    stage: index.frontmatter.stage || 'raw',
    category: index.frontmatter.category || 'uncategorized',
    indexHtml: renderMarkdown(index.body),
    chapters,
  };
}

function css() {
  return `<style>
*{box-sizing:border-box;margin:0;padding:0}
:root{--paper:#f7f8fb;--panel:#fff;--ink:#101827;--muted:#5f6b7a;--line:#dce3ed;--accent:#0ea5e9;--accent-dark:#075985;--mark:#ecfeff}
body{background:var(--paper);color:var(--ink);font-family:Manrope,system-ui,sans-serif;line-height:1.62}
a{color:inherit;text-decoration:none}
.shell{display:grid;grid-template-columns:300px minmax(0,1fr);min-height:100vh}
aside{border-right:1px solid var(--line);background:#fff;padding:1rem;position:sticky;top:0;height:100vh;overflow:auto}
.brand{display:flex;align-items:center;gap:.65rem;margin-bottom:1rem;font-weight:900}
.logo{display:grid;width:34px;height:34px;place-items:center;border-radius:8px;background:linear-gradient(135deg,#38bdf8,#0ea5e9);color:#fff}
.store-link{display:inline-flex;border:1px solid var(--line);border-radius:8px;padding:.55rem .7rem;color:var(--accent-dark);font-size:.78rem;font-weight:900;margin:0 .45rem .75rem 0}
.nav-title{color:var(--muted);font-size:.7rem;text-transform:uppercase;font-weight:900;letter-spacing:.12em;margin:.55rem 0 .35rem}
.chapter-list{display:grid;gap:.4rem}
.chapter-link{display:grid;gap:.15rem;border:1px solid transparent;border-radius:8px;padding:.58rem .62rem}
.chapter-link:hover,.chapter-link.active{background:var(--mark);border-color:#bae6fd}
.chapter-link span{font-size:.82rem;font-weight:900}
.chapter-link small{color:var(--muted);font-size:.68rem;text-transform:uppercase;font-weight:800}
main{padding:2rem 1.25rem 4rem}
.article{max-width:900px;margin:0 auto}
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
.chapter-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:.75rem;margin-top:1rem}
.chapter-card{display:grid;gap:.45rem;border:1px solid var(--line);border-radius:8px;background:#fff;padding:.85rem;min-height:145px}
.chapter-card small{color:var(--accent-dark);font-size:.68rem;font-weight:900;text-transform:uppercase}
.chapter-card strong{font-size:.98rem}
.chapter-card span{color:var(--muted);font-size:.78rem}
.chapter-nav{display:flex;justify-content:space-between;gap:.75rem;border-top:1px solid var(--line);margin-top:2rem;padding-top:1rem}
.chapter-nav a{border:1px solid var(--line);border-radius:8px;background:#fff;padding:.62rem .75rem;color:var(--accent-dark);font-size:.78rem;font-weight:900}
footer{max-width:900px;margin:2rem auto 0;border-top:1px solid var(--line);padding-top:1rem;color:var(--muted);font-size:.78rem}
@media(max-width:860px){.shell{grid-template-columns:1fr}aside{position:relative;height:auto;border-right:0;border-bottom:1px solid var(--line)}main{padding-top:1.35rem}.chapter-list{grid-template-columns:repeat(auto-fit,minmax(210px,1fr))}}
</style>`;
}

function nav(book, currentSlug = '', depth = 1) {
  const storeHref = depth === 1 ? '../../' : '../../../';
  const bookHref = depth === 1 ? './' : '../';
  const chapterLinks = book.chapters
    .map((chapter, index) => {
      const href = depth === 1 ? `${chapter.slug}/` : `../${chapter.slug}/`;
      const active = chapter.slug === currentSlug ? ' active' : '';
      return `<a class="chapter-link${active}" href="${href}"><span>${escapeHtml(chapter.title)}</span><small>Chapter ${index + 1}</small></a>`;
    })
    .join('');
  return `<aside>
    <a class="brand" href="${bookHref}"><span class="logo">I</span><span>${escapeHtml(book.title)}</span></a>
    <a class="store-link" href="${storeHref}">Back to store</a>
    <a class="store-link" href="${bookHref}">Book home</a>
    <div class="nav-title">This book</div>
    <nav class="chapter-list">${chapterLinks}</nav>
  </aside>`;
}

function page({ book, title, summary, content, currentSlug = '', depth = 1 }) {
  const favicon = depth === 1 ? '../../favicon.svg' : '../../../favicon.svg';
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>${escapeHtml(title)} - ${escapeHtml(book.siteName)}</title>
<meta name="description" content="${escapeHtml(summary)}">
<link rel="canonical" href="${escapeHtml(book.siteUrl)}${currentSlug ? `/${currentSlug}` : ''}/">
<link rel="icon" type="image/svg+xml" href="${favicon}">
<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,700;9..144,800&family=Manrope:wght@400;500;600;700;800&display=swap" rel="stylesheet">
${css()}
</head>
<body>
<div class="shell">
  ${nav(book, currentSlug, depth)}
  <main>
    <article class="article">
      <div class="crumb">Independent Zensical idea book</div>
      ${content}
    </article>
    <footer>This is a standalone FreeIdeaStore idea book publication.</footer>
  </main>
</div>
</body>
</html>`;
}

function homeContent(book) {
  const cards = book.chapters
    .map(
      (chapter, index) => `<a class="chapter-card" href="${chapter.slug}/">
  <small>Chapter ${index + 1}</small>
  <strong>${escapeHtml(chapter.title)}</strong>
  <span>${escapeHtml(chapter.excerpt || 'Open this chapter.')}</span>
</a>`,
    )
    .join('');
  return `<div class="summary">${escapeHtml(book.summary)}</div>
<div class="meta"><span class="pill">${escapeHtml(book.stage)}</span><span class="pill">${escapeHtml(book.category)}</span><span class="pill">${book.chapters.length} chapters</span></div>
${book.indexHtml}
<h2>Book Chapters</h2>
<div class="chapter-grid">${cards}</div>`;
}

function chapterContent(book, chapter, index) {
  const previous = book.chapters[index - 1];
  const next = book.chapters[index + 1];
  return `<div class="meta"><span class="pill">${escapeHtml(book.title)}</span><span class="pill">Chapter ${index + 1}</span></div>
${renderMarkdown(chapter.body)}
<nav class="chapter-nav">
  ${previous ? `<a href="../${previous.slug}/">Previous: ${escapeHtml(previous.title)}</a>` : '<span></span>'}
  ${next ? `<a href="../${next.slug}/">Next: ${escapeHtml(next.title)}</a>` : '<span></span>'}
</nav>`;
}

function catalog(books) {
  const cards = books
    .map(
      (book) => `<a class="chapter-card" href="${book.slug}/">
  <small>${escapeHtml(book.stage)} / ${book.chapters.length} chapters</small>
  <strong>${escapeHtml(book.title)}</strong>
  <span>${escapeHtml(book.summary)}</span>
</a>`,
    )
    .join('');
  const fakeBook = {
    siteName: 'FreeIdeaStore Idea Books',
    siteUrl: `${publicBase}/ideas`,
    title: 'Idea Books',
    chapters: [],
  };
  return page({
    book: fakeBook,
    title: 'FreeIdeaStore Idea Books',
    summary: 'Catalog of independently published FreeIdeaStore idea books.',
    depth: 1,
    content: `<h1>FreeIdeaStore Idea Books</h1>
<p>Each card links to a separate idea book publication with its own Zensical config and source folder.</p>
<div class="chapter-grid">${cards}</div>`,
  }).replace('<nav class="chapter-list"></nav>', '<nav class="chapter-list"></nav>');
}

const entries = (await readdir(booksRoot, { withFileTypes: true })).filter((entry) => entry.isDirectory());
const books = (await Promise.all(entries.map((entry) => readBook(entry.name)))).sort((a, b) => a.slug.localeCompare(b.slug));

await rm(outRoot, { recursive: true, force: true });
await mkdir(outRoot, { recursive: true });
await writeFile(path.join(outRoot, 'index.html'), catalog(books));

const sitemapUrls = [`${publicBase}/`, `${publicBase}/ideas/`];
for (const book of books) {
  const bookOut = path.join(outRoot, book.slug);
  await mkdir(bookOut, { recursive: true });
  sitemapUrls.push(`${publicBase}/ideas/${book.slug}/`);
  await writeFile(
    path.join(bookOut, 'index.html'),
    page({ book, title: book.title, summary: book.summary, content: homeContent(book), depth: 1 }),
  );
  for (const [index, chapter] of book.chapters.entries()) {
    const chapterOut = path.join(bookOut, chapter.slug);
    await mkdir(chapterOut, { recursive: true });
    sitemapUrls.push(`${publicBase}/ideas/${book.slug}/${chapter.slug}/`);
    await writeFile(
      path.join(chapterOut, 'index.html'),
      page({
        book,
        title: `${book.title}: ${chapter.title}`,
        summary: chapter.summary,
        content: chapterContent(book, chapter, index),
        currentSlug: chapter.slug,
        depth: 2,
      }),
    );
  }
}

await writeFile(
  path.join(storeDir, 'sitemap.xml'),
  `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${sitemapUrls.map((url) => `  <url><loc>${url}</loc></url>`).join('\n')}
</urlset>
`,
);

const pageCount = books.reduce((total, book) => total + 1 + book.chapters.length, 1);
console.log(`Built ${books.length} independent idea books (${pageCount} pages) into ${path.relative(root, outRoot)}`);
