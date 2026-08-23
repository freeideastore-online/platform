import { describe, expect, it } from 'vitest';
import {
  appendToIdeaSection,
  chapterHealth,
  CHAPTER_SIZE,
  defaultIdeaBody,
  demoteHeadings,
  documentMetrics,
  ideaChapterById,
  ideaChapters,
  ideaPreamble,
  ideaSectionList,
  isPaginated,
  markdownHeadings,
  markdownToHtml,
  readIdeaSection,
  addIdeaSection,
  mergeIdeaSections,
  moveIdeaSection,
  removeIdeaSection,
  renameIdeaSection,
  replaceIdeaSection,
  visibleIdeaChapters,
} from './markdown';

describe('markdownToHtml', () => {
  it('renders markdown links and bare URLs as safe new-tab links', () => {
    const html = markdownToHtml([
      'Use [StudentRide](https://studentride.com.au/) first.',
      '',
      '- Source: https://www.shebah.com.au/ride',
      '- Punctuated: https://example.com/path.',
      '',
      '**Shebah.** Check the provider page.',
    ].join('\n'));

    expect(html).toContain('<a href="https://studentride.com.au/" target="_blank" rel="noopener noreferrer">StudentRide</a>');
    expect(html).toContain('<a href="https://www.shebah.com.au/ride" target="_blank" rel="noopener noreferrer">https://www.shebah.com.au/ride</a>');
    expect(html).toContain('<a href="https://example.com/path" target="_blank" rel="noopener noreferrer">https://example.com/path</a>.');
    expect(html).toContain('<strong>Shebah.</strong>');
  });

  it('renders the inline syntax the previous line renderer emitted literally', () => {
    const html = markdownToHtml([
      'Crawl the *supplier website* and stamp each field `extracted` or `inferred`.',
      '',
      'Also _underscore italics_ and ~~struck out~~.',
    ].join('\n'));

    expect(html).toContain('<em>supplier website</em>');
    expect(html).toContain('<code>extracted</code>');
    expect(html).toContain('<code>inferred</code>');
    expect(html).toContain('<em>underscore italics</em>');
    expect(html).toContain('<s>struck out</s>');
    expect(html).not.toContain('*supplier website*');
    expect(html).not.toContain('`extracted`');
  });

  it('renders block syntax the previous renderer could not produce', () => {
    const html = markdownToHtml([
      '> **Status: scan complete.** The original thesis is dead.',
      '',
      '| Source | Trust |',
      '| --- | --- |',
      '| ERP | high |',
      '',
      '---',
      '',
      '```',
      'sku,price',
      '```',
    ].join('\n'));

    expect(html).toContain('<blockquote>');
    expect(html).toContain('<table>');
    expect(html).toContain('<td>ERP</td>');
    expect(html).toContain('<hr>');
    expect(html).toContain('<pre><code>sku,price');
  });

  it('maps headings to h2/h3 with slug ids that match markdownHeadings', () => {
    const source = ['# Snapshot', '', '## Design Sketch', '', '### Source Trail'].join('\n');
    const html = markdownToHtml(source);

    // h1 and h2 both collapse to h2; anything deeper becomes h3.
    expect(html).toContain('<h2 id="snapshot">Snapshot</h2>');
    expect(html).toContain('<h2 id="design-sketch">Design Sketch</h2>');
    expect(html).toContain('<h3 id="source-trail">Source Trail</h3>');

    // The table of contents links to these ids, so the two must agree.
    for (const heading of markdownHeadings(source)) {
      expect(html).toContain(`id="${heading.id}"`);
    }
  });

  it('keeps the escape-by-default posture for untrusted bodies', () => {
    const html = markdownToHtml([
      '<script>alert(1)</script>',
      '',
      '<img src=x onerror=alert(1)>',
      '',
      '[click](javascript:alert(1))',
      '',
      '[data](data:text/html,<script>alert(1)</script>)',
      '',
      '![http image](http://example.com/insecure.png)',
    ].join('\n'));

    // Raw HTML survives only as inert escaped text, never as live markup.
    expect(html).not.toContain('<script');
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    // Unsafe schemes never become links — no href is emitted at all.
    expect(html).not.toContain('href="javascript:');
    expect(html).not.toContain('href="data:');
    // Non-https images degrade to alt text.
    expect(html).not.toContain('<img src="http://');
    expect(html).toContain('http image');
  });

  it('keeps a single newline as a line break so existing bodies do not re-flow', () => {
    const html = markdownToHtml('First line.\nSecond line.');

    expect(html).toContain('<br>');
    expect(html).toContain('First line.');
    expect(html).toContain('Second line.');
  });
});

describe('section editing', () => {
  const doc = [
    '# Deep Idea',
    '',
    '> Lead-in that is not a section.',
    '',
    '## Snapshot',
    'The short version.',
    '',
    '## Research',
    'First finding.',
    '',
    '### Sources',
    'A sub-section that belongs to Research.',
    '',
    '## Risk',
    'The main risk.',
  ].join('\n');

  it('lists sections with the same ids the chapter URLs use', () => {
    const sections = ideaSectionList(doc, 'Deep Idea');

    expect(sections.map((section) => section.id)).toEqual(['snapshot', 'research', 'risk']);
    expect(ideaChapters(doc, 'Deep Idea').map((chapter) => chapter.id)).toEqual(
      sections.map((section) => section.id),
    );
    expect(sections[1]?.words).toBeGreaterThan(0);
  });

  it('reads one section without the rest of the document', () => {
    const section = readIdeaSection(doc, 'research', 'Deep Idea');

    expect(section).toContain('## Research');
    expect(section).toContain('First finding.');
    expect(section).toContain('### Sources');
    expect(section).not.toContain('The short version.');
    expect(section).not.toContain('The main risk.');
  });

  it('replaces a section and leaves everything else byte-identical', () => {
    const next = replaceIdeaSection(doc, 'research', 'Replaced entirely.', 'Deep Idea');

    expect(next).toContain('## Research\n\nReplaced entirely.');
    expect(next).not.toContain('First finding.');
    // The sub-section belonged to Research, so it goes with it.
    expect(next).not.toContain('### Sources');
    // Untouched sections and the lead-in survive exactly.
    expect(next).toContain('> Lead-in that is not a section.');
    expect(next).toContain('## Snapshot\nThe short version.');
    expect(next).toContain('## Risk\nThe main risk.');
    // Section ids are unchanged, so published URLs still resolve.
    expect(ideaSectionList(String(next), 'Deep Idea').map((s) => s.id)).toEqual(['snapshot', 'research', 'risk']);
  });

  it('appends to a section without disturbing what is there', () => {
    const next = appendToIdeaSection(doc, 'research', 'RESEARCH LOG 2: a later finding.', 'Deep Idea');

    expect(next).toContain('First finding.');
    expect(next).toContain('### Sources');
    expect(next).toContain('RESEARCH LOG 2: a later finding.');
    expect(next).toContain('## Risk\nThe main risk.');
  });

  it('does not accumulate blank lines across repeated edits', () => {
    let next: string | null = doc;
    for (let round = 0; round < 3; round += 1) {
      next = replaceIdeaSection(String(next), 'research', 'Stable content.', 'Deep Idea');
    }

    expect(next).not.toMatch(/\n{3,}/);
    expect(next).toContain('## Research\n\nStable content.\n\n## Risk');
  });

  it('returns null for an unknown section instead of corrupting the document', () => {
    expect(replaceIdeaSection(doc, 'nope', 'x', 'Deep Idea')).toBeNull();
    expect(appendToIdeaSection(doc, 'nope', 'x', 'Deep Idea')).toBeNull();
    expect(readIdeaSection(doc, 'nope', 'Deep Idea')).toBeNull();
  });

  it('addresses a section by its collision-suffixed id', () => {
    const collided = ['## Prototype plan', 'First.', '', '## Prototype risks', 'Second.'].join('\n');
    const ids = ideaSectionList(collided).map((section) => section.id);
    expect(ids).toEqual(['prototype', 'prototype-risks']);

    const next = appendToIdeaSection(collided, 'prototype-risks', 'Added to the second.');
    expect(next).toContain('## Prototype risks\n\nSecond.\n\nAdded to the second.');
    expect(next).toContain('## Prototype plan\nFirst.');
  });
});

describe('ideaChapters', () => {
  it('uses h2 headings as chapters and keeps h3 headings inside the chapter body', () => {
    const chapters = ideaChapters([
      '# Test Idea',
      '',
      'Intro should be ignored as document title only.',
      '',
      '## Overview',
      '',
      '### Snapshot',
      'The short version.',
      '',
      '### Status',
      'Researching.',
      '',
      '## Validation',
      '',
      '### Cheapest Test',
      'Run one interview.',
    ].join('\n'), 'Test Idea');

    expect(chapters.map((chapter) => chapter.title)).toEqual(['Overview', 'Validation']);
    expect(chapters[0]?.markdown).toContain('### Snapshot');
    expect(chapters[0]?.markdown).toContain('### Status');
    expect(chapters[1]?.markdown).toContain('### Cheapest Test');
  });

  it('does not turn content before the first heading into a chapter', () => {
    const chapters = ideaChapters([
      '> **Status: scan complete.** A lead-in, not a chapter.',
      '',
      '## Snapshot',
      'The short version.',
      '',
      '## Design notes',
      'How it works.',
    ].join('\n'));

    expect(chapters.map((chapter) => chapter.title)).toEqual(['Snapshot', 'Design notes']);
    expect(chapters.map((chapter) => chapter.id)).not.toContain('overview');
    // The first chapter is a real one, so the book starts on real content.
    expect(chapters[0]?.id).toBe('snapshot');
  });

  it('still produces one chapter for a document with no headings at all', () => {
    const chapters = ideaChapters('Just a paragraph, no headings anywhere.');

    expect(chapters).toHaveLength(1);
    expect(chapters[0]?.markdown).toContain('Just a paragraph');
  });

  it('gives colliding canonical ids distinct URLs instead of shadowing one', () => {
    const chapters = ideaChapters([
      '## Prototype plan',
      'Build the thin slice.',
      '',
      '## Prototype risks',
      'It may not hold up.',
      '',
      '## Validation approach',
      'Test the riskiest assumption.',
      '',
      '## Validation metrics',
      'Thresholds for success.',
    ].join('\n'));

    const ids = chapters.map((chapter) => chapter.id);
    expect(ids).toHaveLength(4);
    expect(new Set(ids).size).toBe(4);

    // The first claimant keeps the canonical id so published URLs do not move.
    expect(ids[0]).toBe('prototype');
    expect(ids[2]).toBe('validation');

    // Every chapter is reachable, and each URL resolves to its own chapter.
    for (const chapter of chapters) {
      expect(ideaChapterById(chapters, chapter.id)?.title).toBe(chapter.title);
    }
  });

  it('does not let an alias point at a chapter that did not claim it', () => {
    const chapters = ideaChapters([
      '## Prototype plan',
      'First.',
      '',
      '## Prototype',
      'Second wants the same canonical id and the same slug.',
    ].join('\n'));

    expect(chapters).toHaveLength(2);
    expect(chapters[0]?.id).toBe('prototype');
    expect(chapters[1]?.id).toBe('prototype-2');
    expect(chapters[1]?.aliases).not.toContain('prototype');
    expect(ideaChapterById(chapters, 'prototype')?.title).toBe('Prototype plan');
    expect(ideaChapterById(chapters, 'prototype-2')?.title).toBe('Prototype');
  });

  it('strips markdown syntax from chapter excerpts before truncating', () => {
    const chapters = ideaChapters([
      '## Current Options Map',
      '',
      'The current option map should be presented by suburb and school, not as one national answer.',
      '',
      '**School-managed transport.**',
      '',
      '[StudentRide](https://studentride.com.au/) can be relevant when a school already runs a managed bus service.',
    ].join('\n'));

    expect(chapters[0]?.excerpt).toContain('School-managed transport.');
    expect(chapters[0]?.excerpt).toContain('StudentRide');
    expect(chapters[0]?.excerpt).not.toContain('**');
    expect(chapters[0]?.excerpt).not.toContain('](https://');
  });

  it('filters unwritten chapters from the visible chapter list only', () => {
    const markdown = [
      '## Snapshot',
      'Ready to read.',
      '',
      '## Empty',
      '',
      '## Whitespace',
      '   ',
      '\t',
      '',
      '## Legacy placeholder',
      '**(chapter loading)**',
      '',
      '## New placeholder',
      '_chapter loading_',
    ].join('\n');

    expect(ideaChapters(markdown).map((chapter) => chapter.title)).toEqual([
      'Snapshot',
      'Empty',
      'Whitespace',
      'Legacy placeholder',
      'New placeholder',
    ]);
    expect(visibleIdeaChapters(markdown).map((chapter) => chapter.title)).toEqual(['Snapshot']);
  });
});

/**
 * THE CHAPTER HEADING CONTRACT, pinned.
 *
 * `sectionRanges()` is the single place the rule lives, and until #48 the rule
 * was undocumented and untested: no test asserted what a NON-title `#` does,
 * even though two published documents have one as their first chapter. Four
 * separate agents inferred "the store splits on `##`", which is wrong by half,
 * and a migration that intended 15 chapters produced 74.
 *
 * These are behaviour assertions, not aspirations. Nothing here may be
 * "corrected" without accepting that it moves live chapter URLs.
 */
describe('the chapter heading contract', () => {
  const titles = (markdown: string, documentTitle = '') =>
    ideaChapters(markdown, documentTitle).map((chapter) => chapter.title);

  it('makes a chapter of a non-title `#`, as a peer of every `##`', () => {
    const markdown = [
      '# A Source File Title',
      'Its opening paragraph.',
      '',
      '## Bottom line',
      'The finding.',
    ].join('\n');

    expect(titles(markdown, 'Something Else Entirely')).toEqual([
      'A Source File Title',
      'Bottom line',
    ]);
  });

  it('makes a chapter of a `#` that repeats the title but is not first', () => {
    const markdown = [
      '## Snapshot',
      'The short version.',
      '',
      '# Deep Idea',
      'A second pass over the same ground.',
    ].join('\n');

    // The skip is positional as well as textual: only the FIRST heading can be
    // the document title.
    expect(titles(markdown, 'Deep Idea')).toEqual(['Snapshot', 'Deep Idea']);
  });

  it('makes a chapter of a leading `#` when non-blank content precedes it', () => {
    const markdown = ['> Status: scan complete.', '', '# Deep Idea', 'Body.'].join('\n');

    expect(titles(markdown, 'Deep Idea')).toEqual(['Deep Idea']);
    // ...and the lead-in above it stays lead-in, so nothing is published twice.
    expect(ideaPreamble(markdown, 'Deep Idea')).toBe('> Status: scan complete.');
  });

  it('skips a leading `#` only when its slug is the document title', () => {
    const markdown = ['# Deep Idea', '', '## Snapshot', 'Body.'].join('\n');

    expect(titles(markdown, 'Deep Idea')).toEqual(['Snapshot']);
    // Slug equality, not string equality — punctuation and case do not matter.
    expect(titles(markdown, 'Deep  IDEA!')).toEqual(['Snapshot']);
    // Any other title, or no title at all, and the same line is a chapter.
    expect(titles(markdown, 'Another Idea')).toEqual(['Deep Idea', 'Snapshot']);
    expect(titles(markdown)).toEqual(['Deep Idea', 'Snapshot']);
  });

  it('keeps `###` and deeper inside the chapter above', () => {
    const markdown = [
      '## Research',
      'First finding.',
      '',
      '### Sources',
      'Where it came from.',
      '',
      '#### Method',
      'How it was gathered.',
    ].join('\n');

    expect(titles(markdown)).toEqual(['Research']);
    expect(ideaChapters(markdown)[0]?.markdown).toContain('### Sources');
    expect(ideaChapters(markdown)[0]?.markdown).toContain('#### Method');
  });

  it('does not let indentation protect a heading from becoming a chapter', () => {
    const markdown = [
      '## Plain',
      'Body.',
      '',
      '  ## Two spaces',
      'Body.',
      '',
      '\t## One tab',
      'Body.',
      '',
      '   # One hash, indented',
      'Body.',
    ].join('\n');

    // The line is `.trim()`ed before matching, so all four are chapters.
    expect(titles(markdown, 'Plain')).toEqual([
      'Plain',
      'Two spaces',
      'One tab',
      'One hash, indented',
    ]);
  });

  it('splits on a heading inside a fenced code block, because it scans lines', () => {
    const markdown = ['## Snapshot', 'Body.', '', '```', '## Not really a heading', '```'].join('\n');

    // Deliberate: `sectionRanges()` knows nothing about fences. This is why
    // `demoteHeadings()` moves fenced heading lines too — leaving them behind
    // would leave the chapter split.
    expect(titles(markdown)).toEqual(['Snapshot', 'Not really a heading']);
  });

  /**
   * The two published documents whose FIRST CHAPTER is a non-title `#`, read
   * off `GET /api/ideas/<id>/sections` on 2026-08-14. #48's acceptance
   * criterion is that their chapter set does not change, so the exact heading
   * and title pairs are pinned here rather than described in prose.
   */
  it('keeps the first chapter of the two live `#`-headed documents', () => {
    const requirementsBase = ideaChapters(
      [
        '# RequirementsBase — Competitive Market Research (GRC / compliance-automation / control-mapping)',
        'Body.',
        '',
        '## The core finding',
        'Body.',
      ].join('\n'),
      'RequirementsBase — MCP-native regulatory gap-analysis agent',
    );

    expect(requirementsBase.map((chapter) => chapter.id)).toEqual([
      'requirementsbase-competitive-market-research-grc-compliance-auto',
      'the-core-finding',
    ]);

    const tekToEsg = ideaChapters(
      ['# TEK-to-ESG Translator', 'Body.', '', '## The problem', 'Body.'].join('\n'),
      'TEK-to-ESG Translator — Indigenous-Governed Platform for Turning Traditional Knowledge into Corporate Disclosure',
    );

    expect(tekToEsg.map((chapter) => chapter.id)).toEqual(['tek-to-esg-translator', 'the-problem']);
  });
});

describe('markdownHeadings', () => {
  it('lists every heading the renderer emits, `####` and deeper included', () => {
    const source = [
      '# One',
      '',
      '## Two',
      '',
      '### Three',
      '',
      '#### Four',
      '',
      '##### Five',
      '',
      '###### Six',
    ].join('\n');
    const html = markdownToHtml(source);

    expect(markdownHeadings(source).map((heading) => heading.title)).toEqual([
      'One',
      'Two',
      'Three',
      'Four',
      'Five',
      'Six',
    ]);
    // Anything on the page carrying an anchor has to be reachable from the
    // table of contents beside it. A heading that renders but never navigates
    // is the bug in #75, and demotion is what makes it common.
    for (const heading of markdownHeadings(source)) {
      expect(html).toContain(`id="${heading.id}"`);
    }
  });

  it('does not invent a heading out of seven hashes', () => {
    // CommonMark stops at h6, so the table of contents has to as well.
    expect(markdownHeadings('####### Not a heading')).toEqual([]);
    expect(markdownToHtml('####### Not a heading')).not.toContain('<h');
  });
});

describe('demoteHeadings', () => {
  const sourceFile = [
    '# Precedent hunt: shared support vans',
    'Opening paragraph.',
    '',
    '## Bottom line',
    'The finding.',
    '',
    '### Closest things on earth',
    'Two of them.',
  ].join('\n');

  it('shifts a `#`-topped file by two levels, because one is not enough', () => {
    // A one-level shift is the workaround four agents converged on in #48. It
    // leaves the `#` at `##` — still a chapter — so it fixes nothing.
    expect(demoteHeadings(sourceFile).split('\n')).toEqual([
      '### Precedent hunt: shared support vans',
      'Opening paragraph.',
      '',
      '#### Bottom line',
      'The finding.',
      '',
      '##### Closest things on earth',
      'Two of them.',
    ]);
  });

  it('shifts a `##`-topped file by one, taking the shift from the shallowest', () => {
    const demoted = demoteHeadings(['## Bottom line', 'x', '', '### Detail', 'y'].join('\n'));

    // Whole lines, not `toContain`: `'#### Bottom line'` CONTAINS
    // `'### Bottom line'`, so a substring assertion here would pass under an
    // over-shift and prove nothing.
    expect(demoted.split('\n')).toEqual(['### Bottom line', 'x', '', '#### Detail', 'y']);
  });

  it('turns a file that would shatter into siblings into one chapter', () => {
    const doc = ['## Precedent hunt', 'Placeholder.', '', '## Next section', 'Body.'].join('\n');

    const shattered = replaceIdeaSection(doc, 'precedent-hunt', sourceFile);
    expect(ideaSectionList(String(shattered)).map((section) => section.id)).toEqual([
      'precedent-hunt',
      'precedent-hunt-shared-support-vans',
      'bottom-line',
      'next-section',
    ]);

    const single = replaceIdeaSection(doc, 'precedent-hunt', demoteHeadings(sourceFile));
    expect(ideaSectionList(String(single)).map((section) => section.id)).toEqual([
      'precedent-hunt',
      'next-section',
    ]);
    // Nothing was dropped — it all moved below the chapter line. Whole lines,
    // since `'#### X'` contains `'### X'`.
    const lines = String(single).split('\n');
    expect(lines).toContain('### Precedent hunt: shared support vans');
    expect(lines).toContain('#### Bottom line');
    expect(lines).toContain('##### Closest things on earth');
  });

  it('keeps every level a demotion produces in the in-page table of contents', () => {
    // This is the whole reason `markdownHeadings()` spans `#{1,6}`. At `#{1,3}`
    // only the first of these survives; at `#{1,4}` only the first two.
    expect(markdownHeadings(demoteHeadings(sourceFile)).map((heading) => heading.title)).toEqual([
      'Precedent hunt: shared support vans',
      'Bottom line',
      'Closest things on earth',
    ]);
  });

  it('leaves content that is already below chapter level untouched', () => {
    const safe = ['### Method', 'How.', '', '#### Detail', 'More.'].join('\n');

    // The flag is a no-op on content that could not have split anything, so a
    // caller can set it unconditionally on a bulk migration.
    expect(demoteHeadings(safe)).toBe(safe);
  });

  it('leaves content with no headings untouched, byte for byte', () => {
    // Byte for byte, CRLF included: the early return is what stops a rewrite
    // that has nothing to rewrite from silently re-joining the document on LF.
    const plain = 'Just a paragraph.\r\n\r\nAnd another.';

    expect(demoteHeadings(plain)).toBe(plain);
  });

  it('stops at `######`, which is the deepest heading there is', () => {
    const demoted = demoteHeadings(['# Top', '', '##### Deep', '', '###### Deeper'].join('\n'));

    expect(demoted).toContain('### Top');
    // 5 + 2 and 6 + 2 both clamp: `#######` renders as a paragraph, so pushing
    // past six would delete a heading rather than demote it.
    expect(demoted.split('\n')[2]).toBe('###### Deep');
    expect(demoted.split('\n')[4]).toBe('###### Deeper');
    expect(demoted).not.toMatch(/^#{7}/m);
  });

  it('moves the same lines the chapter parser splits on, indentation and fences included', () => {
    const demoted = demoteHeadings(
      ['  ## Indented', '', '```', '## Inside a fence', '```'].join('\n'),
    );

    // Both are chapters to `sectionRanges()`, so both have to move or the "one
    // chapter" guarantee is not a guarantee. Indentation is preserved.
    expect(demoted).toBe(['  ### Indented', '', '```', '### Inside a fence', '```'].join('\n'));
  });
});

/**
 * The lead-in is the ONLY body prose a paginated idea page renders, so what
 * counts as lead-in and what counts as a chapter has to be one decision. These
 * assert that `ideaPreamble()` and `ideaChapters()` partition the document:
 * every line is in exactly one of them, never both.
 */
describe('ideaPreamble', () => {
  it('returns the text before the first chapter', () => {
    const markdown = [
      '> **Status: scan complete.** A lead-in, not a chapter.',
      '',
      '## Snapshot',
      'The short version.',
    ].join('\n');

    expect(ideaPreamble(markdown)).toBe('> **Status: scan complete.** A lead-in, not a chapter.');
  });

  it('is empty for a template-built document, which opens on its first chapter', () => {
    // defaultIdeaBody() and the canonical spine both start with `## Snapshot`,
    // so this is the COMMON case, not an edge case — the idea page has to have
    // something else to show.
    const body = defaultIdeaBody({
      summary: 'A summary.',
      signal: 'A signal.',
      preview: '',
      next_step: 'A next step.',
      risk: 'A risk.',
    } as unknown as Parameters<typeof defaultIdeaBody>[0]);

    expect(ideaPreamble(body, 'Some Idea')).toBe('');
    expect(ideaChapters(body, 'Some Idea').length).toBeGreaterThan(1);
  });

  it('does not claim a `#`-headed chapter that ideaChapters() also claims', () => {
    // The bug this catches: a preamble derived from `body.split(/^## /m)` keeps
    // everything up to the first `##`, so a `#` chapter before it was rendered
    // inline on the idea page AND served as its own chapter page.
    const markdown = [
      '# Opening Chapter',
      'Single-hash chapters are chapters to sectionRanges().',
      '',
      '## Second Chapter',
      'And this one is obvious.',
    ].join('\n');

    expect(ideaChapters(markdown, 'Unrelated Title').map((chapter) => chapter.title)).toEqual([
      'Opening Chapter',
      'Second Chapter',
    ]);
    expect(ideaPreamble(markdown, 'Unrelated Title')).toBe('');
  });

  it('does not claim an indented chapter heading either', () => {
    const markdown = [
      '  ## Indented Chapter',
      'sectionRanges() trims the line before matching, so this is a chapter.',
      '',
      '## Plain Chapter',
      'Body.',
    ].join('\n');

    expect(ideaChapters(markdown).map((chapter) => chapter.title)).toEqual([
      'Indented Chapter',
      'Plain Chapter',
    ]);
    expect(ideaPreamble(markdown)).toBe('');
  });

  it('drops a leading `# Document Title`, which is the page heading and not prose', () => {
    const markdown = ['# Deep Idea', '', 'Real lead-in prose.', '', '## Snapshot', 'Body.'].join('\n');

    // ideaChapters() already ignores this heading; rendering it as lead-in
    // would put the title on the page twice.
    expect(ideaChapters(markdown, 'Deep Idea').map((chapter) => chapter.title)).toEqual(['Snapshot']);
    expect(ideaPreamble(markdown, 'Deep Idea')).toBe('Real lead-in prose.');
  });

  it('is the whole document when there are no chapter headings at all', () => {
    expect(ideaPreamble('Just a paragraph, no headings anywhere.')).toBe(
      'Just a paragraph, no headings anywhere.',
    );
  });
});

describe('structural section editing', () => {
  const doc = [
    '# Deep Idea',
    '',
    '> Lead-in.',
    '',
    '## Snapshot',
    'The short version.',
    '',
    '## Research',
    'First finding.',
    '',
    '## Risk',
    'The main risk.',
  ].join('\n');

  it('adds a section at the end by default', () => {
    const next = addIdeaSection(doc, 'Validation', 'The cheapest test.', { documentTitle: 'Deep Idea' });

    expect(ideaSectionList(String(next), 'Deep Idea').map((s) => s.id)).toEqual([
      'snapshot',
      'research',
      'risk',
      'validation',
    ]);
    expect(next).toContain('## Validation\n\nThe cheapest test.');
    // Existing sections and the lead-in are untouched.
    expect(next).toContain('> Lead-in.');
    expect(next).toContain('## Snapshot\nThe short version.');
  });

  it('adds a section at a chosen position', () => {
    const after = addIdeaSection(doc, 'Evidence', 'Sources.', { after: 'snapshot', documentTitle: 'Deep Idea' });
    const before = addIdeaSection(doc, 'Overview', 'Framing.', { before: 'snapshot', documentTitle: 'Deep Idea' });

    expect(ideaSectionList(String(after), 'Deep Idea').map((s) => s.id)).toEqual([
      'snapshot',
      'evidence',
      'research',
      'risk',
    ]);
    expect(ideaSectionList(String(before), 'Deep Idea').map((s) => s.id)[0]).toBe('overview');
  });

  it('renames a section, which moves its id', () => {
    const next = renameIdeaSection(doc, 'research', 'Context and evidence', 'Deep Idea');
    const ids = ideaSectionList(String(next), 'Deep Idea').map((s) => s.id);

    expect(ids).toEqual(['snapshot', 'context-and-evidence', 'risk']);
    // Content survives the rename.
    expect(next).toContain('## Context and evidence\nFirst finding.');
    expect(ids).not.toContain('research');
  });

  it('merges one section into another and drops the source', () => {
    const next = mergeIdeaSections(doc, 'risk', 'research', 'Deep Idea');
    const ids = ideaSectionList(String(next), 'Deep Idea').map((s) => s.id);

    expect(ids).toEqual(['snapshot', 'research']);
    // Both bodies survive, in order.
    expect(next).toContain('First finding.');
    expect(next).toContain('The main risk.');
    expect(String(next).indexOf('First finding.')).toBeLessThan(String(next).indexOf('The main risk.'));
  });

  it('moves a section without disturbing its content', () => {
    const next = moveIdeaSection(doc, 'risk', { before: 'research', documentTitle: 'Deep Idea' });

    expect(ideaSectionList(String(next), 'Deep Idea').map((s) => s.id)).toEqual([
      'snapshot',
      'risk',
      'research',
    ]);
    expect(next).toContain('## Risk\nThe main risk.');
    expect(next).toContain('## Research\nFirst finding.');
  });

  it('removes a section', () => {
    const next = removeIdeaSection(doc, 'research', 'Deep Idea');

    expect(ideaSectionList(String(next), 'Deep Idea').map((s) => s.id)).toEqual(['snapshot', 'risk']);
    expect(next).not.toContain('First finding.');
    expect(next).not.toMatch(/\n{3,}/);
  });

  it('returns null for an unknown section rather than writing a wrong document', () => {
    expect(addIdeaSection(doc, 'X', 'y', { after: 'nope', documentTitle: 'Deep Idea' })).toBeNull();
    expect(renameIdeaSection(doc, 'nope', 'X', 'Deep Idea')).toBeNull();
    expect(removeIdeaSection(doc, 'nope', 'Deep Idea')).toBeNull();
    expect(moveIdeaSection(doc, 'nope', { after: 'snapshot', documentTitle: 'Deep Idea' })).toBeNull();
    expect(mergeIdeaSections(doc, 'nope', 'snapshot', 'Deep Idea')).toBeNull();
    expect(mergeIdeaSections(doc, 'snapshot', 'snapshot', 'Deep Idea')).toBeNull();
    expect(addIdeaSection(doc, '   ', 'y', { documentTitle: 'Deep Idea' })).toBeNull();
  });

  it('keeps the document parseable after a chain of structural edits', () => {
    let next: string | null = doc;
    next = addIdeaSection(String(next), 'Validation', 'A test.', { documentTitle: 'Deep Idea' });
    next = moveIdeaSection(String(next), 'validation', { after: 'snapshot', documentTitle: 'Deep Idea' });
    next = renameIdeaSection(String(next), 'validation', 'Cheapest test', 'Deep Idea');
    next = mergeIdeaSections(String(next), 'risk', 'research', 'Deep Idea');

    expect(ideaSectionList(String(next), 'Deep Idea').map((s) => s.id)).toEqual([
      'snapshot',
      'cheapest-test',
      'research',
    ]);
    expect(next).not.toMatch(/\n{3,}/);
    expect(next).toContain('> Lead-in.');
  });
});

describe('chapterHealth', () => {
  const words = (n: number) => Array.from({ length: n }, (_, i) => `w${i}`).join(' ');
  const doc = (...chapters: Array<[string, number]>) =>
    chapters.map(([title, n]) => `## ${title}\n\n${words(n)}`).join('\n\n');

  it('calls a paragraph-sized chapter a merge candidate', () => {
    const [only] = chapterHealth(doc(['Thin', 226]));
    expect(only?.words).toBe(226);
    expect(only?.verdict).toBe('merge');
  });

  it('separates "too small to stand alone" from "merely under target"', () => {
    // Both are below target, but only one should be dissolved into a neighbour.
    // Collapsing these into a single "too short" would either destroy chapters
    // that just need writing, or leave paragraph-pages in place.
    const [merge, thin] = chapterHealth(doc(['Merge', 400], ['Thin', 700]));
    expect(merge?.verdict).toBe('merge');
    expect(thin?.verdict).toBe('thin');
  });

  it('calls an oversized chapter a split candidate', () => {
    const [big] = chapterHealth(doc(['Huge', CHAPTER_SIZE.ceilingWords + 1]));
    expect(big?.verdict).toBe('split');
  });

  it('accepts a chapter inside the band', () => {
    const [ok] = chapterHealth(doc(['Good', 1200]));
    expect(ok?.verdict).toBe('ok');
  });

  it('does not count the heading toward the body', () => {
    // A heading credited to the body flatters the shortest chapters most, which
    // are the ones this exists to catch.
    const [c] = chapterHealth(doc(['A Very Long Chapter Heading Indeed', 100]));
    expect(c?.words).toBe(100);
  });

  it('reports the distribution a mean would hide', () => {
    // isPaginated() only sees an average. A document can clear it while half its
    // chapters are paragraphs — which is the shape the corpus is actually in.
    const health = chapterHealth(doc(['Fat', 3000], ['Para', 100], ['Para2', 100]));
    expect(health.map((c) => c.verdict)).toEqual(['ok', 'merge', 'merge']);
  });
});

describe('ideaSectionList sizing', () => {
  const body = (n: number) => Array.from({ length: n }, (_, i) => `w${i}`).join(' ');
  const chapter = (title: string, n: number) => `## ${title}\n\n${body(n)}`;

  it('counts the body only, so a long heading cannot inflate the row', () => {
    // Ten title words plus the `##` marker: the eleven words this used to add.
    const title = 'Region New World NZ California Oregon South Africa Argentina Chile';
    const headingWords = `## ${title}`.trim().split(/\s+/).length;
    const [section] = ideaSectionList(chapter(title, 43), 'Idea');

    expect(headingWords).toBe(11);
    expect(section?.words).toBe(43);
    expect(section?.words).not.toBe(43 + headingWords);
  });

  it('reports the number the verdict was computed from, chapter for chapter', () => {
    const doc = [
      chapter('Prototype Or Pilot', 48),
      chapter('A Considerably Longer Chapter Heading Than Most', 900),
      chapter('Mid', 520),
    ].join('\n\n');

    expect(ideaSectionList(doc, 'Idea').map((s) => ({ title: s.title, words: s.words, verdict: s.verdict }))).toEqual([
      { title: 'Prototype Or Pilot', words: 48, verdict: 'merge' },
      { title: 'A Considerably Longer Chapter Heading Than Most', words: 900, verdict: 'ok' },
      { title: 'Mid', words: 520, verdict: 'thin' },
    ]);
    // Same numbers chapterHealth() reports for the same document, not merely
    // the same verdicts — the two measures used to differ by the heading (#74).
    // Trivially true while this delegates; it fails the moment anyone gives
    // ideaSectionList() its own copy of the count again, which is the bug.
    expect(ideaSectionList(doc, 'Idea').map((s) => [s.words, s.verdict])).toEqual(
      chapterHealth(doc, 'Idea').map((c) => [c.words, c.verdict]),
    );
  });

  it('does not let a heading carry a chapter across the floor', () => {
    const title = 'Aggregators And Shared Cost Support Models';
    const justUnder = ideaSectionList(chapter(title, CHAPTER_SIZE.floorWords - 1), 'Idea')[0];
    const atFloor = ideaSectionList(chapter(title, CHAPTER_SIZE.floorWords), 'Idea')[0];

    // The heading is 7 words, so the old count put both rows above the floor
    // while the verdict beside them was computed from the body.
    expect(justUnder?.words).toBe(CHAPTER_SIZE.floorWords - 1);
    expect(justUnder?.verdict).toBe('merge');
    expect(atFloor?.words).toBe(CHAPTER_SIZE.floorWords);
    expect(atFloor?.verdict).toBe('thin');
  });

  it('never prints a number on the wrong side of the floor from its own verdict', () => {
    const title = 'A Heading Long Enough To Move A Chapter Over The Floor';
    for (let n = CHAPTER_SIZE.floorWords - 12; n <= CHAPTER_SIZE.floorWords + 2; n += 1) {
      const [section] = ideaSectionList(chapter(title, n), 'Idea');
      expect(section?.words).toBe(n);
      expect(section?.verdict === 'merge').toBe(n < CHAPTER_SIZE.floorWords);
    }
  });

  it('still counts the whole document for the synthetic single-section fallback', () => {
    // No `##` heading anywhere, so ideaChapters() returns the `snapshot` stand-in
    // whose markdown IS the document. There is no chapter heading to strip.
    const [section] = ideaSectionList(`# Idea\n\n${body(12)}`, 'Idea');

    expect(section?.id).toBe('snapshot');
    expect(section?.words).toBe(14);
  });

  it('leaves the document-wide mean that decides pagination alone', () => {
    // PUBLICATION_POLICY is evaluated from documentMetrics().words / chapters,
    // which is a whole-document count including headings and lead-in. Three
    // chapters of 295 body words each clear the 300-word mean only because of
    // their headings. Narrowing the per-chapter count must not re-decide that
    // for documents nobody is editing (#73) — has_publication reads columns
    // written by documentMetrics(), not by ideaSectionList().
    const doc = [
      chapter('Support Models In The New World Regions', 295),
      chapter('Support Models In The Old World Regions', 295),
      chapter('Support Models Everywhere Else In The World', 295),
    ].join('\n\n');

    expect(documentMetrics(doc, 'Idea').words).toBe(3 * (295 + 8));
    expect(isPaginated(doc, 'Idea')).toBe(true);
    expect(ideaSectionList(doc, 'Idea').map((s) => s.words)).toEqual([295, 295, 295]);
  });
});
