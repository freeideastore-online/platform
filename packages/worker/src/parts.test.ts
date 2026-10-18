import { describe, expect, it } from 'vitest';
import { chapterRedirectPlan } from './chapter-redirects';
import { documentOverflow } from './api-idea-mutations';
import { chapterRail } from './chapter-rail';
import { FIELD_LIMITS } from './http';
import {
  addIdeaSection,
  chapterGroups,
  chapterHealth,
  documentMetrics,
  ideaChapters,
  ideaParts,
  ideaSectionList,
  isPaginated,
  mergeIdeaSections,
  moveIdeaSection,
  readIdeaSection,
  regroupedChapters,
  removeIdeaSection,
  renameIdeaSection,
  replaceIdeaSection,
  setIdeaSectionKind,
} from './markdown';

/**
 * Parts: the level between the document and the chapter (#63).
 */
const TITLE = 'Cellar Door Cycling';
const words = (n: number, stem = 'word') => Array.from({ length: n }, (_, i) => `${stem}${i}`).join(' ');

const book = [
  `# ${TITLE}`,
  '',
  '## Snapshot',
  words(400, 'c1w'),
  '',
  '# Regional evidence',
  'Nine regions, one question.',
  '',
  '## Barossa',
  words(400, 'c2w'),
  '',
  '## McLaren Vale',
  words(400, 'c3w'),
  '',
  '# Financials',
  '',
  '## Unit economics',
  words(400, 'c4w'),
].join('\n');

const ids = (markdown: string) => ideaSectionList(markdown, TITLE).map((row) => row.id);

describe('parts are navigation, not chapters', () => {
  it('excludes parts from the chapter count and reports them beside it', () => {
    const metrics = documentMetrics(book, TITLE);
    expect(metrics.chapters).toBe(4);
    expect(metrics.parts).toBe(2);
  });

  it('never gives a part a size verdict', () => {
    // A part heading with no intro is 0 words; counted as a chapter it would be
    // flagged as the worst chapter in every document that has one.
    expect(chapterHealth(book, TITLE).map((row) => row.id)).toEqual([
      'snapshot',
      'barossa',
      'mclaren-vale',
      'unit-economics',
    ]);
    expect(documentMetrics(book, TITLE).belowFloor).toBe(4);
  });

  it('does not let parts push a document at the chapter cap over it', () => {
    const chapters = Array.from({ length: FIELD_LIMITS.chapters }, (_, i) =>
      `${i % 10 === 0 ? `# Part ${i / 10 + 1}\n\n` : ''}## Chapter ${i + 1}\nBody.`,
    ).join('\n\n');

    expect(documentMetrics(chapters, TITLE)).toMatchObject({ chapters: 100, parts: 10 });
    expect(documentOverflow(chapters, TITLE)).toBeNull();
  });

  it('decides pagination on chapters alone', () => {
    // 4 chapters averaging well over 300 words: parts neither help nor hurt.
    expect(isPaginated(book, TITLE)).toBe(true);
    const unparted = book.replace('# Regional evidence\nNine regions, one question.\n', '').replace('# Financials\n', '');
    expect(isPaginated(unparted, TITLE)).toBe(true);
  });
});

describe('ideaSectionList', () => {
  it('lists parts and chapters in document order with kind and part', () => {
    expect(ideaSectionList(book, TITLE).map(({ id, kind, ...rest }) => ({
      id,
      kind,
      part: 'part' in rest ? rest.part : undefined,
      chapters: 'chapters' in rest ? rest.chapters : undefined,
    }))).toEqual([
      { id: 'snapshot', kind: 'chapter', part: null, chapters: undefined },
      { id: 'regional-evidence', kind: 'part', part: undefined, chapters: 2 },
      { id: 'barossa', kind: 'chapter', part: 'regional-evidence', chapters: undefined },
      { id: 'mclaren-vale', kind: 'chapter', part: 'regional-evidence', chapters: undefined },
      { id: 'financials', kind: 'part', part: undefined, chapters: 1 },
      { id: 'unit-economics', kind: 'chapter', part: 'financials', chapters: undefined },
    ]);
    expect(ideaSectionList(book, TITLE)[1]).toMatchObject({ words: 4, verdict: null });
  });
});

describe('reading and writing a part', () => {
  it('reads a part as its heading and intro', () => {
    expect(readIdeaSection(book, 'regional-evidence', TITLE)).toBe('# Regional evidence\n\nNine regions, one question.');
  });

  it('replaces a part intro without touching its chapters', () => {
    const next = String(replaceIdeaSection(book, 'regional-evidence', 'A new framing.', TITLE));
    expect(ideaParts(next, TITLE)[0]).toMatchObject({ intro: 'A new framing.', chapterIds: ['barossa', 'mclaren-vale'] });
    expect(ids(next)).toEqual(ids(book));
  });

  it('renames a part at its own level', () => {
    const next = String(renameIdeaSection(book, 'financials', 'Money', TITLE));
    expect(next).toContain('\n# Money\n');
    expect(ideaParts(next, TITLE).map((part) => part.id)).toEqual(['regional-evidence', 'money']);
  });
});

describe('structural edits with parts', () => {
  it('adds a part with kind: part, regrouping the chapters after it', () => {
    const next = String(addIdeaSection(book, 'Field notes', 'Ride reports.', {
      kind: 'part',
      before: 'mclaren-vale',
      documentTitle: TITLE,
    }));
    expect(next).toContain('# Field notes\n\nRide reports.');
    expect(regroupedChapters(book, next, TITLE)).toEqual([
      { chapter_id: 'mclaren-vale', from_part: 'regional-evidence', to_part: 'field-notes' },
    ]);
  });

  it('adds a chapter into a part with part:, at the end of that part', () => {
    const next = String(addIdeaSection(book, 'Clare Valley', 'Body.', { part: 'regional-evidence', documentTitle: TITLE }));
    expect(ideaParts(next, TITLE)[0]?.chapterIds).toEqual(['barossa', 'mclaren-vale', 'clare-valley']);
  });

  it('treats after: <part> as after the whole part', () => {
    const next = String(addIdeaSection(book, 'Interlude', 'Body.', { after: 'regional-evidence', documentTitle: TITLE }));
    expect(ids(next)).toEqual([
      'snapshot',
      'regional-evidence',
      'barossa',
      'mclaren-vale',
      'interlude',
      'financials',
      'unit-economics',
    ]);
    // Still inside the part it follows: it sits before the next `#`.
    expect(ideaChapters(next, TITLE).find((chapter) => chapter.id === 'interlude')?.part).toBe('regional-evidence');
  });

  it('refuses to put a part inside a part', () => {
    expect(addIdeaSection(book, 'Nested', '', { kind: 'part', part: 'financials', documentTitle: TITLE })).toBeNull();
    expect(addIdeaSection(book, 'Lost', '', { part: 'barossa', documentTitle: TITLE })).toBeNull();
  });

  it('promotes a chapter to a part and reports the regrouping', () => {
    const next = String(setIdeaSectionKind(book, 'barossa', 'part', TITLE));
    expect(ideaParts(next, TITLE).map((part) => [part.id, part.chapterIds])).toEqual([
      ['regional-evidence', []],
      ['barossa', ['mclaren-vale']],
      ['financials', ['unit-economics']],
    ]);
    expect(regroupedChapters(book, next, TITLE)).toEqual([
      { chapter_id: 'mclaren-vale', from_part: 'regional-evidence', to_part: 'barossa' },
    ]);
  });

  it('demotes a part to a chapter, its intro becoming the chapter body', () => {
    const next = String(setIdeaSectionKind(book, 'regional-evidence', 'chapter', TITLE));
    expect(readIdeaSection(next, 'regional-evidence', TITLE)).toBe('## Regional evidence\n\nNine regions, one question.');
    expect(ideaChapters(next, TITLE).find((chapter) => chapter.id === 'barossa')?.part).toBeUndefined();
  });

  it('removes a part heading and intro but keeps its chapters', () => {
    const next = String(removeIdeaSection(book, 'regional-evidence', TITLE));
    expect(next).not.toContain('Nine regions');
    expect(ideaChapters(next, TITLE).map((chapter) => chapter.id)).toEqual([
      'snapshot',
      'barossa',
      'mclaren-vale',
      'unit-economics',
    ]);
  });

  it('moves a part with every chapter it groups', () => {
    const next = String(moveIdeaSection(book, 'financials', { before: 'regional-evidence', documentTitle: TITLE }));
    expect(ids(next)).toEqual([
      'snapshot',
      'financials',
      'unit-economics',
      'regional-evidence',
      'barossa',
      'mclaren-vale',
    ]);
  });

  it('moves a chapter into a part with part:', () => {
    const next = String(moveIdeaSection(book, 'snapshot', { part: 'financials', documentTitle: TITLE }));
    expect(ideaParts(next, TITLE)[1]?.chapterIds).toEqual(['unit-economics', 'snapshot']);
  });

  it('cannot move a part into one of its own chapters', () => {
    expect(moveIdeaSection(book, 'regional-evidence', { after: 'barossa', documentTitle: TITLE })).toBeNull();
  });

  it('merges chapters only', () => {
    expect(mergeIdeaSections(book, 'regional-evidence', 'barossa', TITLE)).toBeNull();
    expect(mergeIdeaSections(book, 'barossa', 'financials', TITLE)).toBeNull();
    expect(mergeIdeaSections(book, 'mclaren-vale', 'barossa', TITLE)).not.toBeNull();
  });
});

describe('chapter rail', () => {
  it('groups chapters under their parts and opens only the active part', () => {
    const chapters = ideaChapters(book, TITLE);
    const parts = ideaParts(book, TITLE);
    expect(chapterGroups(chapters, parts).map((group) => [group.part?.id ?? null, group.chapters.length])).toEqual([
      [null, 1],
      ['regional-evidence', 2],
      ['financials', 1],
    ]);

    const html = chapterRail('cellar-door', chapters, parts, { activeId: 'unit-economics' });
    expect(html).toContain('<details class="part-group"><summary class="part-title"><span>Regional evidence</span><small>2</small>');
    expect(html).toContain('<details class="part-group" open><summary class="part-title"><span>Financials</span>');
    // Ordinals run across parts.
    expect(html).toContain('<b>4</b><span>Unit economics</span>');
  });
});

describe('chapter redirects for parts', () => {
  it('sends a chapter promoted to a part to the first chapter of that part', () => {
    const promoted = String(setIdeaSectionKind(book, 'barossa', 'part', TITLE));
    const plan = chapterRedirectPlan(book, promoted, TITLE);
    expect(plan.upserts).toContainEqual({ oldId: 'barossa', chapterId: 'mclaren-vale' });
  });

  it('301s the chapter the part rule retired from an unchanged body', () => {
    const live = [
      '# RequirementsBase — Competitive Market Research (GRC / compliance-automation / control-mapping)',
      'Thirty words of framing.',
      '',
      '## The core finding',
      'Body.',
    ].join('\n');
    const plan = chapterRedirectPlan(live, live, 'RequirementsBase — MCP-native regulatory gap-analysis agent', undefined, {
      legacyPrevious: true,
    });
    expect(plan.upserts).toEqual([
      { oldId: 'requirementsbase-competitive-market-research-grc-compliance-auto', chapterId: 'the-core-finding' },
    ]);
  });
});
