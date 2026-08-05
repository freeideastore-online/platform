import { describe, expect, it } from 'vitest';
import {
  appendToIdeaSection,
  chapterHealth,
  CHAPTER_SIZE,
  ideaChapterById,
  ideaChapters,
  ideaSectionList,
  markdownHeadings,
  markdownToHtml,
  readIdeaSection,
  addIdeaSection,
  mergeIdeaSections,
  moveIdeaSection,
  removeIdeaSection,
  renameIdeaSection,
  replaceIdeaSection,
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
