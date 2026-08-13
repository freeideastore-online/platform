import MarkdownIt from 'markdown-it';
import { escapeHtml, slug } from './http';
import type { IdeaRow } from './types';

/**
 * Idea bodies are CommonMark, rendered by markdown-it.
 *
 * This replaced a hand-rolled line renderer that supported only headings,
 * lists, `**bold**`, links and images. Everything else — `*italic*`, `code`,
 * blockquotes, tables — reached the page as literal punctuation.
 *
 * The parser is configured to keep the security posture of the old renderer,
 * which escaped everything it did not explicitly emit:
 *
 * - `html: false` escapes raw HTML in the source instead of passing it through,
 *   so agent- and contributor-authored bodies cannot inject markup. This is why
 *   markdown-it is used rather than marked, which passes raw HTML through and
 *   would need a DOM sanitizer.
 * - `validateLink` allows only http(s), so `javascript:` / `data:` URLs never
 *   become links.
 * - `breaks: true` keeps a single newline as a line break. Existing idea bodies
 *   were written under the old renderer, where every line was its own
 *   paragraph; strict CommonMark would silently merge those into run-on
 *   paragraphs.
 *
 * Heading ids come from `slug()` on the raw heading source, which is what
 * `markdownHeadings()` below also does — the two must agree or every in-page
 * anchor and the Signals table of contents breaks.
 */
const md = new MarkdownIt({
  html: false,
  linkify: true,
  breaks: true,
  typographer: false,
});

const HTTP_URL = /^https?:\/\//i;
const HTTPS_URL = /^https:\/\//i;

md.validateLink = (url) => HTTP_URL.test(url.trim());

/** `#`/`##` render as h2 and anything deeper as h3, matching the page styles. */
function headingTag(tag: string) {
  return tag === 'h1' || tag === 'h2' ? 'h2' : 'h3';
}

md.renderer.rules.heading_open = (tokens, idx) => {
  const title = tokens[idx + 1]?.content || '';
  return `<${headingTag(tokens[idx]?.tag || 'h2')} id="${escapeHtml(slug(title) || 'section')}">`;
};

md.renderer.rules.heading_close = (tokens, idx) => `</${headingTag(tokens[idx]?.tag || 'h2')}>`;

md.renderer.rules.link_open = (tokens, idx, options, _env, self) => {
  const token = tokens[idx];
  token?.attrSet('target', '_blank');
  token?.attrSet('rel', 'noopener noreferrer');
  return self.renderToken(tokens, idx, options);
};

md.renderer.rules.image = (tokens, idx, options, _env, self) => {
  const token = tokens[idx];
  if (!token) return '';
  const src = token.attrGet('src') || '';
  const alt = token.content || '';
  // Non-https images degrade to their alt text rather than loading over http.
  if (!HTTPS_URL.test(src)) return escapeHtml(alt);
  token.attrSet('alt', alt);
  token.attrSet('loading', 'lazy');
  token.attrSet('style', 'max-width:100%;height:auto;border-radius:8px;margin:.5rem 0');
  return self.renderToken(tokens, idx, options);
};

export function markdownToHtml(markdown: string) {
  return md.render(markdown || '');
}

/**
 * Styles for the elements the parser can now emit. The previous renderer could
 * only produce headings, paragraphs, lists, links and images, so the book pages
 * had no rules for blockquotes, code, tables or rules.
 */
export const MARKDOWN_CSS = `
.chapter-body a{color:var(--accent-strong);font-weight:700;text-decoration:underline;text-underline-offset:2px}
.chapter-body em{font-style:italic}.chapter-body del{opacity:.7}
.chapter-body blockquote{border-left:4px solid var(--accent);border-radius:0 8px 8px 0;background:var(--panel-alt);margin:.95rem 0;padding:.7rem .95rem;max-width:760px}
.chapter-body blockquote>*:first-child{margin-top:0}.chapter-body blockquote>*:last-child{margin-bottom:0}
.chapter-body code{border:1px solid var(--line);border-radius:4px;background:var(--mark);padding:.08em .34em;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.88em;overflow-wrap:anywhere}
.chapter-body pre{border:1px solid var(--line);border-radius:8px;background:var(--panel-alt);margin:.95rem 0;padding:.85rem;max-width:100%;overflow-x:auto}
.chapter-body pre code{border:0;border-radius:0;background:none;padding:0;font-size:.84rem;line-height:1.55}
.chapter-body table{display:block;border-collapse:collapse;margin:.95rem 0;max-width:100%;overflow-x:auto;font-size:.88rem}
.chapter-body th,.chapter-body td{border:1px solid var(--line);padding:.5rem .6rem;text-align:left;vertical-align:top}
.chapter-body th{background:var(--panel-alt);font-weight:900}
.chapter-body hr{border:0;border-top:1px solid var(--line);margin:1.4rem 0}
.chapter-body img{max-width:100%;height:auto}
`;

/**
 * Markdown reduced to readable prose, for excerpts and previews. Walking the
 * token stream drops syntax the old regex stripper left behind — single
 * asterisks, backticks, blockquote markers.
 */
function plainText(markdown: string) {
  const parts: string[] = [];

  const walk = (tokens: ReturnType<typeof md.parse>) => {
    for (const token of tokens) {
      if (token.type === 'text' || token.type === 'code_inline') {
        parts.push(token.content);
      } else if (token.type === 'softbreak' || token.type === 'hardbreak') {
        parts.push(' ');
      } else if (token.type === 'fence' || token.type === 'code_block') {
        parts.push(token.content);
      } else if (token.children?.length) {
        walk(token.children);
      }
      if (token.block) parts.push(' ');
    }
  };

  // Headings are shown separately from the excerpt, so drop them first.
  walk(md.parse(markdown.replace(/^#{1,6}\s+.+$/gm, ''), {}));
  return parts.join('').replace(/\s+/g, ' ').trim();
}

export type IdeaChapter = {
  id: string;
  title: string;
  markdown: string;
  excerpt: string;
  aliases: string[];
};

/**
 * When a document earns chapter URLs.
 *
 * Splitting used to happen on heading count alone, so every `##` became a page
 * regardless of size. Measured across all 11 published ideas, mean words per
 * chapter ran 38-185 — no chapter filled a laptop viewport, and the idea home
 * page (which renders the whole body inline) already showed 103% of the
 * combined chapter content. Pagination was navigation over content the reader
 * could already scroll.
 *
 * A chapter has to carry enough to stand alone, and there have to be enough of
 * them to be worth paging through. Below either bar the idea is one page with an
 * in-page table of contents.
 *
 * A total-word gate was dropped once documents started growing: at 3 chapters
 * averaging 300 words it was already implied, and it was the redundant half. The
 * per-chapter floor is what decides whether a chapter deserves a URL — the idea
 * that first motivated this now clears 3,168 words but averages 226 per chapter,
 * and thin chapters are exactly what the gate exists to catch.
 */
export const PUBLICATION_POLICY = {
  minMeanChapterWords: 300,
  minChapters: 3,
} as const;

/**
 * The size a chapter should be to earn its own page.
 *
 * This is topic-based authoring: a page is one topic that completely answers one
 * question, not a formatting unit. The band below is where that tradition lands
 * — Wikipedia's WP:SIZERULE divides above ~8,000 words of readable prose and
 * declines to divide below ~1,500 on length alone; technical book chapters run
 * 3,000–8,000; documentation pages run 500–3,000 with an in-page table of
 * contents. A research chapter sits at the lower end of that because it is read
 * to be checked rather than read straight through.
 *
 * Both edges matter, and only having one is how the corpus got where it is:
 *
 * - Without a FLOOR, chapters become paragraphs. Every idea in the store
 *   currently averages 78–255 words per chapter, so the entire corpus is a
 *   paragraph-per-page waiting to happen.
 * - Without a CEILING, a chapter grows without limit and the reader gets one
 *   endless page.
 *
 * Depth below chapter level belongs in `###` sub-sections, which render as
 * in-page anchors. Never paginate below a chapter — that is what turns reading
 * into navigating between paragraphs.
 *
 * A document grows by chapters getting deeper and then SPLITTING at the ceiling,
 * never by adding more thin chapters. That is what makes depth unbounded (#16)
 * without fragmenting it.
 */
export const CHAPTER_SIZE = {
  /** Below this a chapter cannot stand alone — merge it into a neighbour. */
  floorWords: 500,
  /** The band a chapter should live in. */
  targetMinWords: 800,
  targetMaxWords: 3000,
  /** Above this a chapter has become two topics — split it. */
  ceilingWords: 4000,
} as const;

export type ChapterVerdict = 'merge' | 'thin' | 'ok' | 'split';

/**
 * Per-chapter sizing, so the shape of a document is a fact rather than an
 * impression. `isPaginated` only reports a MEAN, which hides the distribution
 * that actually matters: a document can clear the mean while half its chapters
 * are paragraphs.
 */
export function chapterHealth(markdown: string, documentTitle = '') {
  return ideaChapters(markdown, documentTitle).map((chapter) => {
    const words = chapterBodyWords(chapter.markdown);
    return { id: chapter.id, title: chapter.title, words, verdict: chapterVerdict(words) };
  });
}

/**
 * `chapter.markdown` carries its own `## Title` line. Counting that would
 * credit every chapter with its heading, which flatters the shortest ones most
 * — exactly the chapters this is meant to catch.
 */
function chapterBodyWords(chapterMarkdown: string) {
  return wordCount(chapterMarkdown.replace(/^##[^\n]*\n?/, ''));
}

/**
 * The single place a word count becomes a verdict, so every surface that shows
 * one — chapterHealth(), ideaSectionList(), the usage block on writes — agrees
 * about the same chapter.
 */
function chapterVerdict(words: number): ChapterVerdict {
  if (words < CHAPTER_SIZE.floorWords) return 'merge';
  if (words < CHAPTER_SIZE.targetMinWords) return 'thin';
  if (words > CHAPTER_SIZE.ceilingWords) return 'split';
  return 'ok';
}

/**
 * Metrics stored on the idea row so the catalog can evaluate
 * PUBLICATION_POLICY exactly. Bodies live in R2, so SQL cannot measure the
 * document itself — it reads these columns instead of guessing from text.
 *
 * `belowFloor`/`aboveCeiling` are the chapterHealth() distribution reduced to
 * two numbers, so a write response can carry the diagnosis without carrying a
 * row per chapter. They are counts of verdicts, not a second opinion: `merge`
 * is a chapter that cannot stand alone, `split` one that has become two topics.
 * `words` and `chapters` are unchanged — the catalog columns read them.
 */
export function documentMetrics(markdown: string, documentTitle = '') {
  const health = chapterHealth(markdown, documentTitle);
  return {
    words: wordCount(markdown),
    chapters: health.length,
    belowFloor: health.filter((chapter) => chapter.verdict === 'merge').length,
    aboveCeiling: health.filter((chapter) => chapter.verdict === 'split').length,
  };
}

function wordCount(text: string) {
  const trimmed = text.trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}

/**
 * True when the document is substantial enough to publish as chapter pages.
 * `has_publication` in the catalog and the book navigation must both use this,
 * or the store advertises a publication that does not exist.
 */
export function isPaginated(markdown: string, documentTitle = '') {
  const chapters = ideaChapters(markdown, documentTitle);
  if (chapters.length < PUBLICATION_POLICY.minChapters) return false;
  const total = wordCount(markdown);
  return Math.floor(total / chapters.length) >= PUBLICATION_POLICY.minMeanChapterWords;
}

export function markdownHeadings(markdown: string) {
  return markdown
    .split(/\r?\n/)
    .map((line) => line.trim().match(/^#{1,3}\s+(.+)$/)?.[1])
    .filter((title): title is string => Boolean(title))
    .map((title) => ({ title, id: slug(title) || 'section' }));
}

export function chapterId(title: string) {
  const normalized = title.toLowerCase();
  if (normalized.includes('competitor') || normalized.includes('similar service')) return 'competitors';
  if (normalized.includes('regulation') || normalized.includes('site constraint')) return 'regulation';
  if (normalized.includes('prototype')) return 'prototype';
  if (normalized.includes('validation')) return 'validation';
  if (normalized.includes('open question')) return 'open-questions';
  if (normalized.includes('how to help') || normalized.includes('contribute')) return 'contribute';
  if (normalized.includes('current thesis')) return 'thesis';
  return slug(title) || 'section';
}

function excerpt(markdown: string) {
  return plainText(markdown).slice(0, 180);
}

type SectionRange = {
  title: string;
  /** Index of the heading line itself. */
  headingLine: number;
  /** First content line, just after the heading. */
  contentStart: number;
  /** Exclusive end of the content — the next section's heading, or EOF. */
  contentEnd: number;
};

/**
 * Line boundaries of every section, by the same rules chapter splitting uses:
 * `###` and deeper belong to the section above, a leading `#` repeating the
 * document title is not a section, and content before the first heading is a
 * lead-in.
 *
 * Chapter listing and section editing both build on this, so the two cannot
 * disagree about where a section begins and ends.
 */
function sectionRanges(markdown: string, documentTitle = ''): SectionRange[] {
  const lines = markdown.split(/\r?\n/);
  const ranges: SectionRange[] = [];
  let sawHeading = false;
  let sawContentBeforeFirstHeading = false;

  lines.forEach((line, index) => {
    const heading = line.trim().match(/^(#{1,3})\s+(.+)$/);
    if (!heading) {
      if (!sawHeading && line.trim()) sawContentBeforeFirstHeading = true;
      return;
    }
    const level = (heading[1] || '').length;
    const title = (heading[2] || '').trim();
    if (level > 2) return;
    if (
      level === 1 &&
      documentTitle &&
      !sawHeading &&
      !sawContentBeforeFirstHeading &&
      slug(title) === slug(documentTitle)
    ) {
      return;
    }
    const previous = ranges[ranges.length - 1];
    if (previous) previous.contentEnd = index;
    ranges.push({ title, headingLine: index, contentStart: index + 1, contentEnd: lines.length });
    sawHeading = true;
  });

  return ranges;
}

export function ideaChapters(markdown: string, documentTitle = ''): IdeaChapter[] {
  const lines = markdown.split(/\r?\n/);
  const ranges = sectionRanges(markdown, documentTitle);

  /**
   * Every id and alias handed out so far.
   *
   * `chapterId()` maps titles onto canonical ids by keyword, so two headings
   * can want the same one — "Prototype plan" and "Prototype risks" both wanted
   * `/prototype/`. The second chapter used to be listed in the sidebar with a
   * link that opened the first, with no error anywhere.
   */
  const claimed = new Set<string>();

  const chapters = ranges.map((range) => {
    const body = lines.slice(range.contentStart, range.contentEnd).join('\n').trim();
    const canonical = chapterId(range.title);
    // `slug()` truncates at 64 chars, so long titles can collide here too.
    const rawSlug = slug(range.title) || canonical;

    // The first chapter to claim an id keeps it, so already-published URLs
    // never move. Later collisions fall back to their own slug, then to a
    // numbered suffix.
    const preferred = [canonical, rawSlug];
    let id = preferred.find((candidate) => !claimed.has(candidate));
    if (!id) {
      let n = 2;
      while (claimed.has(`${rawSlug}-${n}`)) n += 1;
      id = `${rawSlug}-${n}`;
    }
    // Only advertise the aliases no earlier chapter already answers to.
    const aliases = [id, ...preferred.filter((candidate) => candidate !== id && !claimed.has(candidate))];
    for (const alias of aliases) claimed.add(alias);

    return {
      id,
      title: range.title,
      markdown: `## ${range.title}\n\n${body}`.trim(),
      excerpt: excerpt(body) || 'Open this chapter.',
      aliases: Array.from(new Set(aliases)),
    };
  });

  return chapters.length ? chapters : [{
    id: 'snapshot',
    title: 'Snapshot',
    markdown,
    excerpt: excerpt(markdown) || 'Open this idea.',
    aliases: ['snapshot'],
  }];
}

export function ideaChapterById(chapters: IdeaChapter[], rawChapterId: string) {
  return chapters.find((chapter) => chapter.aliases.includes(rawChapterId));
}

/**
 * Locates a section for editing. Section ids are the chapter ids, so the URL a
 * reader sees and the handle an agent writes through are the same string.
 * Returns null for the synthetic single-chapter fallback, which has no heading
 * to splice around.
 */
function findSection(markdown: string, sectionId: string, documentTitle: string) {
  const ranges = sectionRanges(markdown, documentTitle);
  const chapters = ideaChapters(markdown, documentTitle);
  if (chapters.length !== ranges.length) return null;
  const index = chapters.findIndex((chapter) => chapter.aliases.includes(sectionId));
  const range = ranges[index];
  const chapter = chapters[index];
  return range && chapter ? { range, chapter } : null;
}

/**
 * Section titles, ids and sizing, for callers deciding what to read or write.
 *
 * `verdict` is the whole point of listing words at all: `words: 52` only means
 * something next to the floor it misses. Without it an author sees a list of
 * numbers and no diagnosis, which is how a 74-chapter document shipped with
 * most of its chapters below the floor.
 */
export function ideaSectionList(markdown: string, documentTitle = '') {
  return ideaChapters(markdown, documentTitle).map((chapter) => ({
    id: chapter.id,
    title: chapter.title,
    // Unchanged: this counts the heading, and callers depend on the number.
    words: wordCount(chapter.markdown),
    // The verdict uses the heading-stripped count chapterHealth() uses, so a
    // row here can never disagree with the health of the same chapter.
    verdict: chapterVerdict(chapterBodyWords(chapter.markdown)),
  }));
}

/** One section's markdown, heading included. Null when the section is unknown. */
export function readIdeaSection(markdown: string, sectionId: string, documentTitle = '') {
  return findSection(markdown, sectionId, documentTitle)?.chapter.markdown ?? null;
}

/**
 * Replaces one section's content, leaving the rest of the document byte-identical.
 *
 * This is what makes deep documents workable: rewriting a section previously
 * meant sending the whole document back, which cost O(document) tokens per edit
 * and had to fit in one request. Null when the section is unknown.
 */
export function replaceIdeaSection(
  markdown: string,
  sectionId: string,
  content: string,
  documentTitle = '',
): string | null {
  const found = findSection(markdown, sectionId, documentTitle);
  if (!found) return null;
  const lines = markdown.split(/\r?\n/);
  const body = content.trim();
  // The replaced region always takes the same shape, so repeated edits do not
  // accumulate blank lines.
  const region = body ? ['', ...body.split(/\r?\n/), ''] : [''];
  return [
    ...lines.slice(0, found.range.contentStart),
    ...region,
    ...lines.slice(found.range.contentEnd),
  ].join('\n');
}

/** Adds to the end of a section — the shape research accumulation actually takes. */
export function appendToIdeaSection(
  markdown: string,
  sectionId: string,
  content: string,
  documentTitle = '',
): string | null {
  const found = findSection(markdown, sectionId, documentTitle);
  if (!found) return null;
  const lines = markdown.split(/\r?\n/);
  const existing = lines.slice(found.range.contentStart, found.range.contentEnd).join('\n').trim();
  const addition = content.trim();
  if (!addition) return markdown;
  return replaceIdeaSection(
    markdown,
    sectionId,
    existing ? `${existing}\n\n${addition}` : addition,
    documentTitle,
  );
}

/**
 * Structural edits: adding, renaming, moving, merging and removing sections.
 *
 * Without these, growing or reshaping a document still meant resending the whole
 * body — the O(document) path section writes were built to remove. Restructuring
 * is exactly what thin documents need, so it should be the cheap operation, not
 * the expensive one.
 *
 * Every one returns new markdown, or null when the referenced section does not
 * exist, so callers fail loudly rather than writing a document they did not mean.
 */

/** Trailing blank lines are normalised so repeated edits do not accumulate them. */
function joinBlocks(before: string[], block: string[], after: string[]) {
  const out = [...before];
  if (out.length && out[out.length - 1]?.trim()) out.push('');
  out.push(...block);
  if (after.length && after[0]?.trim()) out.push('');
  out.push(...after);
  return out.join('\n');
}

function sectionBlockLines(title: string, content: string, level = 2) {
  const body = content.trim();
  const heading = `${'#'.repeat(level)} ${title.trim()}`;
  return body ? [heading, '', ...body.split(/\r?\n/)] : [heading];
}

/**
 * Inserts a new section. Without `after`/`before` it goes at the end, which is
 * where a document usually grows.
 */
export function addIdeaSection(
  markdown: string,
  title: string,
  content: string,
  options: { after?: string; before?: string; documentTitle?: string } = {},
): string | null {
  if (!title.trim()) return null;
  const documentTitle = options.documentTitle || '';
  const lines = markdown.split(/\r?\n/);
  const block = sectionBlockLines(title, content);

  let at = lines.length;
  if (options.after) {
    const anchor = findSection(markdown, options.after, documentTitle);
    if (!anchor) return null;
    at = anchor.range.contentEnd;
  } else if (options.before) {
    const anchor = findSection(markdown, options.before, documentTitle);
    if (!anchor) return null;
    at = anchor.range.headingLine;
  }
  return joinBlocks(lines.slice(0, at), block, lines.slice(at));
}

/**
 * Renames a section, keeping its content and heading level.
 *
 * The id is derived from the title, so renaming MOVES the section's URL. That is
 * inherent to slug-derived ids; callers should expect the old chapter URL to stop
 * resolving.
 */
export function renameIdeaSection(
  markdown: string,
  sectionId: string,
  newTitle: string,
  documentTitle = '',
): string | null {
  if (!newTitle.trim()) return null;
  const found = findSection(markdown, sectionId, documentTitle);
  if (!found) return null;
  const lines = markdown.split(/\r?\n/);
  const current = lines[found.range.headingLine] || '';
  const level = (current.trim().match(/^(#{1,2})/)?.[1] || '##').length;
  lines[found.range.headingLine] = `${'#'.repeat(level)} ${newTitle.trim()}`;
  return lines.join('\n');
}

/** Removes a section and its content. Recoverable through revisions. */
export function removeIdeaSection(
  markdown: string,
  sectionId: string,
  documentTitle = '',
): string | null {
  const found = findSection(markdown, sectionId, documentTitle);
  if (!found) return null;
  const lines = markdown.split(/\r?\n/);
  return [...lines.slice(0, found.range.headingLine), ...lines.slice(found.range.contentEnd)]
    .join('\n')
    .replace(/\n{3,}/g, '\n\n');
}

/** Moves a section relative to another, for reordering toward a spine. */
export function moveIdeaSection(
  markdown: string,
  sectionId: string,
  options: { after?: string; before?: string; documentTitle?: string } = {},
): string | null {
  const documentTitle = options.documentTitle || '';
  const found = findSection(markdown, sectionId, documentTitle);
  if (!found) return null;
  if (options.after === sectionId || options.before === sectionId) return markdown;

  const lines = markdown.split(/\r?\n/);
  const block = lines.slice(found.range.headingLine, found.range.contentEnd);
  const withoutBlock = [
    ...lines.slice(0, found.range.headingLine),
    ...lines.slice(found.range.contentEnd),
  ].join('\n');

  // Resolve the anchor against the document *after* removal, so the insertion
  // point is not computed from indices the removal has already shifted.
  const anchorId = options.after || options.before;
  if (!anchorId) return joinBlocks(withoutBlock.split(/\r?\n/), block, []);
  const anchor = findSection(withoutBlock, anchorId, documentTitle);
  if (!anchor) return null;
  const remaining = withoutBlock.split(/\r?\n/);
  const at = options.after ? anchor.range.contentEnd : anchor.range.headingLine;
  return joinBlocks(remaining.slice(0, at), block, remaining.slice(at));
}

/**
 * Folds one section's content into another and removes the source. This is how
 * a document with many thin sections becomes one with fewer substantial ones.
 */
export function mergeIdeaSections(
  markdown: string,
  fromSectionId: string,
  intoSectionId: string,
  documentTitle = '',
): string | null {
  if (fromSectionId === intoSectionId) return null;
  const from = findSection(markdown, fromSectionId, documentTitle);
  const into = findSection(markdown, intoSectionId, documentTitle);
  if (!from || !into) return null;

  const lines = markdown.split(/\r?\n/);
  const fromBody = lines.slice(from.range.contentStart, from.range.contentEnd).join('\n').trim();
  const intoBody = lines.slice(into.range.contentStart, into.range.contentEnd).join('\n').trim();
  // Append first, then remove: the merged text has to exist before the source
  // section goes, or a failure mid-way would lose it.
  const merged = replaceIdeaSection(
    markdown,
    intoSectionId,
    intoBody ? `${intoBody}\n\n${fromBody}`.trim() : fromBody,
    documentTitle,
  );
  if (merged === null) return null;
  return removeIdeaSection(merged, fromSectionId, documentTitle);
}

export function defaultIdeaBody(idea: IdeaRow) {
  return [
    `## Snapshot`,
    idea.summary,
    ``,
    `## Current signal`,
    idea.signal || idea.preview || 'No signal has been added yet.',
    ``,
    `## Next step`,
    idea.next_step || 'Define the cheapest validation step.',
    ``,
    `## Risk`,
    idea.risk || 'Main risk not yet identified.',
    ``,
    `## How to help`,
    `- Add evidence from public sources.`,
    `- Name a risk or reason to trash it.`,
    `- Suggest a sharper customer, wedge, or pivot.`,
  ].join('\n');
}
