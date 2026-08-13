import { describe, expect, it } from 'vitest';
import { documentOverflow } from './api-idea-mutations';
import { FIELD_LIMITS } from './http';
import { CHAPTER_SIZE, chapterHealth, documentMetrics, ideaSectionList } from './markdown';

/**
 * Average characters per word in this corpus, measured on the research bodies
 * the store actually holds (593,853 characters / 88,655 words = 6.7). 6.5 is the
 * conservative rounding — a lower figure implies MORE words per chapter, so
 * using it makes the coherence assertion below strictly harder to pass.
 */
const CHARS_PER_WORD = 6.5;

const chapter = (title: string, words: number) => `## ${title}\n${'word '.repeat(words).trim()}\n`;
const doc = (chapters: Array<[string, number]>) => chapters.map(([t, w]) => chapter(t, w)).join('\n');

describe('document limits are internally consistent', () => {
  /**
   * THE RULE. A character cap and a chapter cap together imply a mean chapter
   * size. If that implied mean falls below CHAPTER_SIZE.floorWords, an author
   * who spends the whole chapter allowance is FORCED into chapters that
   * chapterHealth() condemns as `merge` — the platform would be asking for
   * 800-word chapters on a budget that cannot pay for 500.
   *
   * This is not hypothetical: the previous pairing (200,000 chars, no chapter
   * cap) produced a real 74-chapter document averaging ~470 words per chapter,
   * and every one of those chapters was below the floor.
   *
   * Changing either number without the other reintroduces that bug, so the two
   * are asserted together here rather than documented and forgotten.
   */
  it('cannot demand more chapters than the character budget can fill to the floor', () => {
    const impliedMeanWords = FIELD_LIMITS.body / FIELD_LIMITS.chapters / CHARS_PER_WORD;

    expect(impliedMeanWords).toBeGreaterThanOrEqual(CHAPTER_SIZE.floorWords);
  });

  it('lands a full document inside the target band, not merely above the floor', () => {
    const impliedMeanWords = FIELD_LIMITS.body / FIELD_LIMITS.chapters / CHARS_PER_WORD;

    // Above targetMinWords means a document at both caps is made of chapters
    // chapterHealth() calls `ok`, never `thin`.
    expect(impliedMeanWords).toBeGreaterThanOrEqual(CHAPTER_SIZE.targetMinWords);
    expect(impliedMeanWords).toBeLessThanOrEqual(CHAPTER_SIZE.targetMaxWords);
  });
});

describe('documentOverflow', () => {
  it('accepts a document inside both caps', () => {
    expect(documentOverflow(doc([['One', 900], ['Two', 900], ['Three', 900]]), 'Idea')).toBeNull();
  });

  it('rejects a document over the chapter cap and names both numbers', () => {
    const tooMany = doc(
      Array.from({ length: FIELD_LIMITS.chapters + 1 }, (_, i) => [`Chapter ${i}`, 5] as [string, number]),
    );
    const message = documentOverflow(tooMany, 'Idea');

    expect(message).toContain(String(FIELD_LIMITS.chapters + 1));
    expect(message).toContain(String(FIELD_LIMITS.chapters));
  });

  it('tells the author how much room is left rather than only that they overflowed', () => {
    const current = 'a'.repeat(FIELD_LIMITS.body - 100);
    const message = documentOverflow('a'.repeat(FIELD_LIMITS.body + 1), 'Idea', { current });

    // The failure this prevents: four separate agents each had to overflow once
    // and subtract from the error string to discover the remaining headroom.
    expect(message).toContain('100');
  });
});

describe('chapter health is reportable, not just computable', () => {
  it('returns a verdict alongside every section', () => {
    const sections = ideaSectionList(doc([['Thin', 20], ['Solid', 1200]]), 'Idea');

    expect(sections.map((section) => section.verdict)).toEqual(['merge', 'ok']);
  });

  it('counts sub-floor and over-ceiling chapters on the document', () => {
    const metrics = documentMetrics(
      doc([['Thin', 20], ['Also thin', 30], ['Solid', 1200], ['Huge', CHAPTER_SIZE.ceilingWords + 50]]),
      'Idea',
    );

    expect(metrics.belowFloor).toBe(2);
    expect(metrics.aboveCeiling).toBe(1);
  });

  it('agrees with chapterHealth on the same document', () => {
    const markdown = doc([['Thin', 20], ['Solid', 1200]]);
    const verdicts = chapterHealth(markdown, 'Idea').map((entry) => entry.verdict);

    expect(verdicts).toEqual(ideaSectionList(markdown, 'Idea').map((section) => section.verdict));
  });
});
