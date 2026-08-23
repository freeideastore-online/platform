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

export const UNWRITTEN_CHAPTER_EXCERPT = 'This chapter is not yet written.';
const LEGACY_CHAPTER_LOADING = '(chapter loading)';

export function isUnwrittenChapterBody(markdown: string) {
  const trimmed = markdown.trim();
  if (!trimmed) return true;
  const unstyled = trimmed.replace(/^[*_]+|[*_]+$/g, '').trim().toLowerCase();
  return unstyled === LEGACY_CHAPTER_LOADING || unstyled === 'chapter loading';
}

/**
 * When a document earns chapter URLs.
 *
 * Splitting used to happen on heading count alone, so every `##` became a page
 * regardless of size. Measured across all 11 published ideas, mean words per
 * chapter ran 38-185 — no chapter filled a laptop viewport, and the idea home
 * page (which then inlined the whole body, and now inlines only the lead-in)
 * already showed 103% of the combined chapter content. Pagination was
 * navigation over content the reader could already scroll.
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

/**
 * In-page table of contents entries: every heading the renderer emits.
 *
 * The range is `#{1,6}` and not `#{1,3}` because `headingTag()` renders ANY
 * heading — `####` included — and `heading_open` stamps it with a `slug()` id.
 * A narrower range here produces a heading that is on the page, carries a
 * working anchor, and is missing from the navigation beside it (#75). Matching
 * what the renderer emits is the only range that cannot drift out of agreement
 * with it.
 *
 * `demoteHeadings()` is what makes that concrete rather than academic: demoting
 * a `#`-topped source file shifts by two levels, so its `###` sub-headings land
 * at `#####`. At `#{1,4}` those would render and never appear in a chapter's
 * table of contents — the same bug one level down.
 *
 * The list is deliberately flat. `headingTag()` collapses everything below `##`
 * to `h3`, so below chapter level there is no rendered depth for a TOC to
 * mirror; a level on each entry would describe a hierarchy the page does not
 * have.
 */
export function markdownHeadings(markdown: string) {
  return markdown
    .split(/\r?\n/)
    .map((line) => line.trim().match(/^#{1,6}\s+(.+)$/)?.[1])
    .filter((title): title is string => Boolean(title))
    .map((title) => ({ title, id: slug(title) || 'section' }));
}

/** The shallowest level at which a heading is NOT a chapter — see `sectionRanges()`. */
const SUBHEADING_LEVEL = 3;

/** `#######` is not a heading in CommonMark, so this is where demotion stops. */
const MAX_HEADING_LEVEL = 6;

/**
 * The same lines `sectionRanges()` treats as headings, with their indentation,
 * hashes, gap and title kept apart so a level can be rewritten in place.
 *
 * It deliberately mirrors `sectionRanges()`' `line.trim().match(/^(#{1,3})\s+(.+)$/)`
 * rather than markdown-it's notion of a heading: a demotion exists to stop the
 * CHAPTER PARSER splitting, so it has to move exactly the lines that parser
 * would split on. That includes an indented `  ## Heading`, and it includes a
 * `## Heading` line inside a fenced code block — which splits a chapter today,
 * fence or no fence, because `sectionRanges()` scans lines and knows nothing
 * about fences.
 */
const HEADING_LINE = /^(\s*)(#{1,6})(\s+)(\S.*)$/;

/**
 * Shifts every heading in a block of content deep enough that none of it can
 * become a chapter — so a whole source file lands as ONE chapter.
 *
 * This is the missing half of the contract stated on `sectionRanges()`. Because
 * BOTH `#` and `##` create sibling chapters, a caller writing a research file
 * into a section had no way to say "this is one chapter": a migration that
 * intended 15 chapters produced 74 (#48), and the demote-the-`##`s workaround
 * four separate agents converged on was wrong by half — it left every `#`
 * splitting the chapter anyway.
 *
 * The shift is uniform and derived from the SHALLOWEST heading present, so the
 * source document's own hierarchy survives intact:
 *
 * - a `#`-topped file shifts by two — `#`→`###`, `##`→`####`, `###`→`#####`
 * - a `##`-topped file shifts by one — `##`→`###`, `###`→`####`
 * - a file already topped at `###` or deeper is returned untouched, so the flag
 *   is a no-op on content that was already safe
 *
 * A fixed one-level shift would be the same half-right answer as the workaround:
 * it would leave a `#` at `##`, still a chapter.
 *
 * Nothing is pushed past `######`, which is the deepest heading CommonMark has.
 * `markdownHeadings()` spans the whole range for this reason — every level a
 * demotion can produce still reaches the chapter's in-page table of contents.
 */
export function demoteHeadings(content: string) {
  const lines = content.split(/\r?\n/);
  const headings = lines.map((line) => line.match(HEADING_LINE));
  const levels = headings
    .filter((match): match is RegExpMatchArray => Boolean(match))
    .map((match) => (match[2] || '').length);

  // `Math.min()` over no headings is `Infinity`, so content with nothing to
  // move leaves by the same door as content that is already deep enough.
  // Returning `content` itself rather than a re-joined copy is what keeps a
  // CRLF document byte-identical when the demotion is a no-op.
  const shift = SUBHEADING_LEVEL - Math.min(...levels);
  if (shift <= 0) return content;

  return lines
    .map((line, index) => {
      const match = headings[index];
      if (!match) return line;
      const level = Math.min(MAX_HEADING_LEVEL, (match[2] || '').length + shift);
      return `${match[1]}${'#'.repeat(level)}${match[3]}${match[4]}`;
    })
    .join('\n');
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
 * Line boundaries of every section. This function is the single place the
 * chapter rule lives; chapter listing, section editing and the idea page's
 * lead-in all build on it, so the three cannot disagree about where a section
 * begins and ends.
 *
 * THE CONTRACT — `#` AND `##` BOTH CREATE SIBLING CHAPTERS. `###` DOES NOT.
 *
 * The level is read and then thrown away: `headingTag()` renders `#` and `##`
 * identically as `<h2>`, and `ideaChapters()` re-emits every chapter as
 * `` `## ${title}` `` whatever level it was written at. So the two are not
 * distinguishable in the output either, which is why `read_idea_section` on a
 * `#`-headed chapter hands back a `##` heading.
 *
 * There is exactly ONE case in which a `#` is not a chapter: it is the very
 * first thing in the document — before any other heading and before any
 * non-blank content — and its slug equals the slug of the idea's own title.
 * That one is the document title, already rendered as the page's `<h1>`. Every
 * other `#` becomes a chapter, a peer of every `##`, including:
 *
 * - a leading `#` whose text differs from the idea's title. Two published
 *   documents have exactly this and their first chapter IS that `#`, so any
 *   change here is a URL-breaking migration for them, not a no-op (#48).
 * - a `#` that repeats the title but appears later in the document.
 * - a leading `#` in a document parsed with no `documentTitle`.
 *
 * The line is `.trim()`ed before matching, so leading whitespace does not
 * protect a heading: `  ## Heading` and a tab-indented `\t## Heading` are both
 * chapters. Nothing here is fence-aware either — a `## Heading` line inside a
 * fenced code block splits the chapter.
 *
 * Depth below chapter level belongs in `###`, which renders as an in-page
 * anchor rather than a URL. `demoteHeadings()` is how a caller pushes a whole
 * source file below the chapter line so it lands as one chapter instead of
 * shattering into siblings.
 *
 * Content before the first chapter heading is a lead-in, not a section — see
 * `ideaPreamble()`.
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
    // Only `###` and deeper are absorbed into the section above. `#` falls
    // through to the title check below and is otherwise a chapter like `##`.
    if (level > 2) return;
    // The one non-chapter `#`: the document's own title, at the very top.
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

/**
 * The lead-in: everything before the first chapter heading. This is a
 * document's framing, and on a paginated idea page it is the only body prose
 * the index renders — the chapters themselves live on their own URLs.
 *
 * It is derived from `sectionRanges()` for the reason stated above that
 * function: a second heading parser is a second opinion, and the two disagreeing
 * is a bug, not a difference in taste. A `body.split(/^## /m)` would treat
 * `# Chapter` before the first `##`, or an indented `  ## Chapter`, as lead-in
 * while `sectionRanges()` treats both as chapters — so such a chapter would be
 * inlined here AND served as its own page, which is exactly the duplication
 * chapter pagination exists to remove.
 */
export function ideaPreamble(markdown: string, documentTitle = '') {
  const lines = markdown.split(/\r?\n/);
  const ranges = sectionRanges(markdown, documentTitle);
  const first = ranges[0];
  const preamble = lines.slice(0, first ? first.headingLine : lines.length);

  // `sectionRanges()` skips a leading `# Document Title` — it is the page's own
  // <h1>, not a chapter. It must not come back as lead-in prose either.
  const firstContent = preamble.findIndex((line) => line.trim());
  const repeatedTitle =
    documentTitle && firstContent >= 0
      ? (preamble[firstContent] || '').trim().match(/^#\s+(.+)$/)
      : null;
  if (repeatedTitle && slug((repeatedTitle[1] || '').trim()) === slug(documentTitle)) {
    preamble.splice(firstContent, 1);
  }

  return preamble.join('\n').trim();
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
      excerpt: isUnwrittenChapterBody(body) ? UNWRITTEN_CHAPTER_EXCERPT : excerpt(body) || 'Open this chapter.',
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

function ideaChapterBody(chapter: IdeaChapter) {
  return chapter.markdown.replace(/^##[^\n]*(?:\n\n?)?/, '');
}

export function visibleIdeaChapters(markdown: string, documentTitle = ''): IdeaChapter[] {
  return ideaChapters(markdown, documentTitle).filter(
    (chapter) => !isUnwrittenChapterBody(ideaChapterBody(chapter)),
  );
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
 *
 * `words` is the heading-stripped body count — the same number the verdict is
 * computed from, via the same chapterBodyWords(). It used to be
 * `wordCount(chapter.markdown)`, which counted the `## Title` line, so one row
 * reported a chapter's size and its health using two different measures: on the
 * 64-chapter cellar-door document that inflated the corpus by 584 words, and
 * told authors "505 words" beside "verdict: merge" with no way to reconcile the
 * two (#74). The floor is the authority, and the floor does not count headings.
 * The only caller was the `list_idea_sections` serialiser, which passes the
 * field straight through.
 *
 * It is chapterHealth() rather than a second walk over the same chapters
 * because two copies of "count a chapter" are what let the number and the
 * verdict drift apart in the first place.
 */
export function ideaSectionList(markdown: string, documentTitle = '') {
  return chapterHealth(markdown, documentTitle);
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
