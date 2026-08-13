import { describe, expect, it } from 'vitest';
import { documentOverflow } from './api-idea-mutations';
import { FIELD_LIMITS, MAX_REQUEST_BYTES, MAX_REQUEST_CHARS } from './http';
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

  /**
   * MAX_REQUEST_CHARS was 1_000_000 while its own comment claimed to be
   * "comfortably above FIELD_LIMITS.body" — true when the body limit was
   * 200_000 and false the moment it became 1_000_000. At equal values the
   * largest document the body limit permits cannot be SENT, because JSON only
   * ever makes a payload longer, and the author gets a 413 naming a different
   * number than the one they were told to write to.
   */
  it('lets a whole document plus its JSON envelope through in one request', () => {
    expect(MAX_REQUEST_CHARS).toBeGreaterThan(FIELD_LIMITS.body);

    const wholeDocument = JSON.stringify({
      title: 'A Document At The Cap',
      reason: 'publish',
      body: 'a'.repeat(FIELD_LIMITS.body),
    });

    expect(wholeDocument.length).toBeLessThanOrEqual(MAX_REQUEST_CHARS);

    // Markdown is newline-dense and every newline escapes to two characters.
    // Even a document that is a quarter line breaks has to fit.
    const newlineDense = JSON.stringify({ body: 'abc\n'.repeat(FIELD_LIMITS.body / 4) });

    expect(newlineDense.length).toBeLessThanOrEqual(MAX_REQUEST_CHARS);
  });

  it('sizes the content-length pre-check in bytes, not characters', () => {
    // `content-length` counts UTF-8 bytes and MAX_REQUEST_CHARS counts UTF-16
    // code units. Comparing the two shrank the real ceiling for any document
    // containing `§`, `—` or `⚠️` — which research bodies are full of.
    expect(MAX_REQUEST_BYTES).toBeGreaterThanOrEqual(MAX_REQUEST_CHARS * 4);

    const multiByte = '§ — ⚠️ '.repeat(1000);
    const bytes = new TextEncoder().encode(multiByte).length;

    // The pre-check must never reject a payload the authoritative character
    // check would accept, so bytes-per-character has to be bounded by the
    // ratio the byte ceiling is built from.
    expect(bytes / multiByte.length).toBeLessThanOrEqual(MAX_REQUEST_BYTES / MAX_REQUEST_CHARS);
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

  /**
   * These assert the exact phrase and the exact number, not that some digit
   * appears somewhere. `toContain('100')` passed on every one of these messages
   * regardless of the arithmetic, because the message also names 1000000 and
   * 1000001 — a test that cannot fail is not a test.
   */
  it('tells the author how much of THIS write the budget can take, exactly', () => {
    // An append: nothing is freed, so the allowance is the plain headroom.
    const current = 'a'.repeat(FIELD_LIMITS.body - 100);
    const incoming = 'b'.repeat(150);
    const message = documentOverflow(current + incoming, 'Idea', { current, incoming });

    // The failure this prevents: four separate agents each had to overflow once
    // and subtract from the error string to discover the remaining headroom.
    expect(message).toContain('this write may contribute at most 100 of its 150 characters');
    expect(message).toContain('50 too many');
  });

  it('counts the section a replace frees, not only what the document already holds', () => {
    // The document is 100 characters from the cap, so the naive
    // `FIELD_LIMITS.body - current.length` answer is 100. But this write drops a
    // 500-character section on its way in, so 600 of its 900 characters fit.
    // Answering 100 tells the author to trim 800 characters they need not trim.
    const current = 'a'.repeat(FIELD_LIMITS.body - 100);
    const incoming = 'b'.repeat(900);
    const resulting = 'a'.repeat(current.length - 500) + incoming;

    expect(resulting.length).toBe(FIELD_LIMITS.body + 300);

    const message = documentOverflow(resulting, 'Idea', { current, incoming });

    expect(message).toContain('this write may contribute at most 600 of its 900 characters');
    expect(message).not.toContain('at most 100');
  });

  it('does not blame the write when a merge overflows a document that was already over', () => {
    // A merge folds one section into another: it can only shrink the document,
    // so there is nothing for the author to trim out of this edit.
    const current = 'a'.repeat(FIELD_LIMITS.body + 500);
    const message = documentOverflow('a'.repeat(FIELD_LIMITS.body + 400), 'Idea', { current });

    expect(message).toContain('this edit does not grow the document');
    expect(message).toContain(`already ${FIELD_LIMITS.body + 500} characters`);
    expect(message).toContain('must lose at least 500');
  });

  it('tells a whole-document publish what to trim, since it keeps nothing', () => {
    const message = documentOverflow('a'.repeat(FIELD_LIMITS.body + 4242), 'Idea');

    expect(message).toContain('trim at least 4242 characters');
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
