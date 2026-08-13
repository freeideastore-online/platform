import { describe, expect, it } from 'vitest';
import { extractUrls, normaliseSourceUrl, syncDocumentSources } from './sources';
import type { Env, IdeaRow } from './types';

/**
 * A D1 stub that counts round trips.
 *
 * The point of the batching work is the number of subrequests a single write
 * costs, so the stub makes that number observable: every `.run()`, `.all()` and
 * `.batch()` is one round trip, exactly as it is against real D1.
 */
class CountingD1 {
  roundTrips = 0;
  readonly registry = new Map<string, string>();
  readonly links: Array<{ sourceId: string; ideaId: string; section: string; contributionId: string }> = [];

  prepare(sql: string) {
    return new CountingStatement(sql, this);
  }

  batch(statements: CountingStatement[]) {
    this.roundTrips += 1;
    for (const statement of statements) this.apply(statement);
    return Promise.resolve(statements.map(() => ({ success: true })));
  }

  apply(statement: CountingStatement) {
    const { sql, binds } = statement;
    if (sql.includes('INSERT OR IGNORE INTO sources')) {
      const [sourceId, url] = binds as [string, string];
      if (!this.registry.has(url)) this.registry.set(url, sourceId);
      return;
    }
    if (sql.includes('INSERT OR IGNORE INTO source_links')) {
      const [, sourceId, ideaId, section, contributionId] = binds as [string, string, string, string, string];
      const duplicate = this.links.some(
        (link) =>
          link.sourceId === sourceId &&
          link.ideaId === ideaId &&
          link.section === section &&
          link.contributionId === contributionId,
      );
      if (!duplicate) this.links.push({ sourceId, ideaId, section, contributionId });
      return;
    }
    if (sql.includes('DELETE FROM source_links')) {
      const [ideaId] = binds as [string];
      for (let index = this.links.length - 1; index >= 0; index -= 1) {
        const link = this.links[index];
        if (link && link.ideaId === ideaId && link.contributionId === '') this.links.splice(index, 1);
      }
    }
  }

  select(statement: CountingStatement) {
    if (!statement.sql.includes('SELECT id, url FROM sources WHERE url IN')) return [];
    // D1 rejects a statement with more than 100 bound parameters, so a
    // read-back that is not chunked is a production failure, not a slow query.
    expect(statement.binds.length).toBeLessThanOrEqual(100);
    return [...this.registry]
      .filter(([url]) => statement.binds.includes(url))
      .map(([url, id]) => ({ id, url }));
  }
}

class CountingStatement {
  binds: unknown[] = [];

  constructor(
    readonly sql: string,
    private readonly db: CountingD1,
  ) {}

  bind(...binds: unknown[]) {
    this.binds = binds;
    return this;
  }

  run() {
    this.db.roundTrips += 1;
    this.db.apply(this);
    return Promise.resolve({ success: true });
  }

  all() {
    this.db.roundTrips += 1;
    return Promise.resolve({ results: this.db.select(this) });
  }

  first() {
    this.db.roundTrips += 1;
    return Promise.resolve(this.db.select(this)[0] ?? null);
  }
}

function stubEnv(db: CountingD1) {
  return { DB: db } as unknown as Env;
}

const IDEA = { id: 'cellar-door-cycling', title: 'Cellar Door Cycling' } as IdeaRow;

describe('normaliseSourceUrl', () => {
  it('treats the same source cited different ways as one url', () => {
    const canonical = normaliseSourceUrl('https://www.iso.org/standard/63406.html');

    expect(normaliseSourceUrl('https://WWW.ISO.ORG/standard/63406.html')).toBe(canonical);
    expect(normaliseSourceUrl('https://www.iso.org/standard/63406.html#scope')).toBe(canonical);
    expect(normaliseSourceUrl('https://www.iso.org/standard/63406.html?utm_source=newsletter')).toBe(canonical);
    expect(normaliseSourceUrl('https://www.iso.org/standard/63406.html?fbclid=abc')).toBe(canonical);
  });

  it('drops a bare trailing slash but keeps meaningful query strings', () => {
    expect(normaliseSourceUrl('https://matrixify.app/docs/')).toBe('https://matrixify.app/docs');
    // A query that is not tracking is part of the identity of the page.
    expect(normaliseSourceUrl('https://example.com/search?q=tiles')).toBe('https://example.com/search?q=tiles');
  });

  it('does not merge genuinely different pages', () => {
    expect(normaliseSourceUrl('https://example.com/a')).not.toBe(normaliseSourceUrl('https://example.com/b'));
    // Path case can be significant, so it is left alone.
    expect(normaliseSourceUrl('https://example.com/Docs')).not.toBe(normaliseSourceUrl('https://example.com/docs'));
  });

  it('rejects anything that is not an http(s) url', () => {
    expect(normaliseSourceUrl('javascript:alert(1)')).toBeNull();
    expect(normaliseSourceUrl('mailto:someone@example.com')).toBeNull();
    expect(normaliseSourceUrl('not a url')).toBeNull();
    expect(normaliseSourceUrl('')).toBeNull();
  });
});

describe('extractUrls', () => {
  it('finds markdown links and bare urls, deduped', () => {
    const urls = extractUrls([
      'See [ISO 13006](https://www.iso.org/standard/63406.html) for the grouping.',
      'Bare: https://matrixify.app/ and again https://matrixify.app/.',
      'Repeat of the standard: https://www.iso.org/standard/63406.html#scope',
    ].join('\n'));

    expect(urls).toContain('https://www.iso.org/standard/63406.html');
    expect(urls).toContain('https://matrixify.app/');
    // The fragment variant normalises onto the same source, so no duplicate.
    expect(urls).toHaveLength(2);
  });

  it('does not take trailing sentence punctuation as part of the url', () => {
    expect(extractUrls('Source: https://example.com/path.')).toEqual(['https://example.com/path']);
    expect(extractUrls('(see https://example.com/path)')).toEqual(['https://example.com/path']);
  });

  it('ignores non-http links', () => {
    expect(extractUrls('[bad](javascript:alert(1)) and mailto:a@b.com')).toEqual([]);
  });
});

describe('syncDocumentSources', () => {
  it('records one link per section a source is cited in, and one registry row per source', async () => {
    const db = new CountingD1();
    await syncDocumentSources(
      stubEnv(db),
      IDEA,
      [
        '## Snapshot',
        'Grouping comes from [ISO 13006](https://www.iso.org/standard/63406.html).',
        '',
        '## Research',
        'The standard again https://www.iso.org/standard/63406.html#scope and https://matrixify.app/.',
      ].join('\n'),
    );

    // One row per distinct source, however many times it is cited.
    expect([...db.registry.keys()].sort()).toEqual([
      'https://matrixify.app/',
      'https://www.iso.org/standard/63406.html',
    ]);
    // …but a link per place it is cited, so the sources page can say where.
    const iso = db.registry.get('https://www.iso.org/standard/63406.html');
    expect(db.links.filter((link) => link.sourceId === iso).map((link) => link.section).sort()).toEqual([
      'research',
      'snapshot',
    ]);
    expect(db.links).toHaveLength(3);
  });

  it('registers a large document in a bounded number of round trips', async () => {
    // The shape of the live cellar-door-cycling document: 64 chapters citing
    // 120 distinct sources 127 times between them.
    const urls = Array.from({ length: 120 }, (_, index) => `https://example.com/source-${index}`);
    const body = Array.from({ length: 64 }, (_, chapter) => {
      const cited = urls.slice(chapter * 2, chapter * 2 + 2);
      // The last chapters re-cite earlier sources, which is what makes
      // occurrences outnumber distinct sources.
      const repeats = chapter >= 60 ? urls.slice(0, 2) : [];
      return [`## Chapter ${chapter}`, ...[...cited, ...repeats].map((url) => `See ${url} for detail.`)].join('\n');
    }).join('\n\n');

    const db = new CountingD1();
    await syncDocumentSources(stubEnv(db), IDEA, body);

    expect(db.registry.size).toBe(120);
    expect(db.links.length).toBeGreaterThan(120);
    // Before batching this was 1 delete + 3 statements per citation = 382
    // sequential subrequests, every one of them after the body had committed.
    expect(db.roundTrips).toBeLessThanOrEqual(8);
  });

  it("clears a document's links when it stops citing anything", async () => {
    const db = new CountingD1();
    await syncDocumentSources(stubEnv(db), IDEA, '## Snapshot\nCite https://example.com/gone');
    expect(db.links).toHaveLength(1);

    await syncDocumentSources(stubEnv(db), IDEA, '## Snapshot\nNothing cited any more.');
    expect(db.links).toHaveLength(0);
  });
});
