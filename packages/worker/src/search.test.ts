import { describe, expect, it } from 'vitest';
import { indexDocument, toMatchQuery } from './search';
import type { Env, IdeaRow } from './types';

/**
 * A D1 stub that counts round trips, so the cost of indexing a document is
 * something a test can assert on rather than something only production sees.
 */
class CountingD1 {
  roundTrips = 0;
  readonly rows: Array<{ sql: string; binds: unknown[] }> = [];

  prepare(sql: string) {
    const statement = { sql, binds: [] as unknown[] };
    const api = {
      statement,
      bind: (...binds: unknown[]) => {
        statement.binds = binds;
        return api;
      },
      run: () => {
        this.roundTrips += 1;
        this.rows.push(statement);
        return Promise.resolve({ success: true });
      },
    };
    return api;
  }

  batch(statements: Array<{ statement: { sql: string; binds: unknown[] } }>) {
    this.roundTrips += 1;
    for (const entry of statements) this.rows.push(entry.statement);
    return Promise.resolve(statements.map(() => ({ success: true })));
  }
}

function stubEnv(db: CountingD1) {
  return { DB: db } as unknown as Env;
}

const IDEA = { id: 'cellar-door-cycling', title: 'Cellar Door Cycling' } as IdeaRow;

describe('toMatchQuery', () => {
  it('quotes each term so user input cannot be read as FTS syntax', () => {
    // Bare punctuation like NOT/OR/parens is FTS5 syntax: unquoted it is a
    // syntax error rather than a search.
    expect(toMatchQuery('etim OR (matrixify')).toBe('"etim" "or" "matrixify"');
    expect(toMatchQuery('"quoted"')).toBe('"quoted"');
    expect(toMatchQuery('a -b')).toBe('"a" "b"');
  });

  it('keeps intra-word punctuation that belongs to the term', () => {
    expect(toMatchQuery("supplier's data")).toBe('"supplier\'s" "data"');
    expect(toMatchQuery('wood-look tiles')).toBe('"wood-look" "tiles"');
  });

  it('handles unicode and digits', () => {
    expect(toMatchQuery('ISO 13006')).toBe('"iso" "13006"');
    expect(toMatchQuery('café')).toBe('"café"');
  });

  it('returns null when there is nothing searchable', () => {
    expect(toMatchQuery('')).toBeNull();
    expect(toMatchQuery('   ')).toBeNull();
    expect(toMatchQuery('!!! ???')).toBeNull();
  });

  it('bounds the number of terms', () => {
    const many = Array.from({ length: 30 }, (_, index) => `term${index}`).join(' ');
    expect(toMatchQuery(many)?.split(' ')).toHaveLength(12);
  });
});

describe('indexDocument', () => {
  it('clears and rebuilds a document in a single round trip', async () => {
    // 64 chapters — the shape of the live cellar-door-cycling document, which
    // used to cost 65 sequential subrequests here.
    const body = Array.from(
      { length: 64 },
      (_, index) => `## Chapter ${index}\n\nProse for chapter ${index}.`,
    ).join('\n\n');

    const db = new CountingD1();
    const roundTrips = await indexDocument(stubEnv(db), IDEA, body);

    expect(roundTrips).toBe(1);
    expect(db.roundTrips).toBe(1);
    // The clear has to lead, or the rebuild deletes the rows it just wrote.
    expect(db.rows[0]?.sql).toContain('DELETE FROM search_index');
    expect(db.rows.filter((row) => row.sql.includes('INSERT INTO search_index'))).toHaveLength(64);
    // Each row is the chapter's own text, addressable by chapter id.
    expect(db.rows[1]?.binds[0]).toBe('Cellar Door Cycling — Chapter 0');
    expect(db.rows[1]?.binds[3]).toBe('chapter-0');
  });

  it('splits a document whose chapters are too large for one payload', async () => {
    // A million-character body is inside the cap, and a single batch carrying
    // all of it would be one enormous request rather than a cheap one.
    const body = Array.from(
      { length: 20 },
      (_, index) => `## Chapter ${index}\n\n${'word '.repeat(20_000)}`,
    ).join('\n\n');

    const db = new CountingD1();
    const roundTrips = await indexDocument(stubEnv(db), IDEA, body);

    expect(roundTrips).toBeGreaterThan(1);
    // Still a handful of round trips rather than one per chapter.
    expect(roundTrips).toBeLessThan(20);
    expect(db.rows.filter((row) => row.sql.includes('INSERT INTO search_index'))).toHaveLength(20);
  });
});
