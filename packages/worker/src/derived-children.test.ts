import { describe, expect, it } from 'vitest';
import { derivedIdeas, DERIVED_CHILDREN_LIMIT, ideasByProfile } from './data';
import { renderIdeaPage } from './idea-home-page';
import type { Env } from './types';

/**
 * #80: a parent used to list `LIMIT 20` children `ORDER BY updated_at DESC` and
 * say nothing about it, so which children a parent showed rotated as its
 * children were edited; and `ideasByProfile` omitted `parent_id`, so a caller
 * reading its own ideas could not tell which were children of which.
 *
 * The projection and the ordering ARE the behaviour of these two functions, so
 * the assertions read the SQL they emit as well as the values they return.
 */

type Handler = {
  all?: (binds: unknown[]) => unknown;
  first?: (binds: unknown[]) => unknown;
  run?: (binds: unknown[]) => unknown;
};

class Statement {
  private binds: unknown[] = [];

  constructor(
    private readonly db: StubD1,
    private readonly sql: string,
    private readonly handler: Handler,
  ) {}

  bind(...values: unknown[]) {
    this.binds = values;
    return this;
  }

  private record() {
    this.db.statements.push({ sql: this.sql, binds: this.binds });
  }

  all() {
    this.record();
    return Promise.resolve(this.handler.all?.(this.binds) ?? { results: [] });
  }

  first<T>() {
    this.record();
    return Promise.resolve((this.handler.first?.(this.binds) ?? null) as T | null);
  }

  run() {
    this.record();
    return Promise.resolve(this.handler.run?.(this.binds) ?? { success: true });
  }
}

const PARENT = {
  id: 'asx-filings-analyst',
  title: 'ASX Filings Analyst',
  summary: 'Public reports, valuation screens, source-backed weekly watchlist.',
  preview: '',
  signal: '',
  body_md: '## Snapshot\nPublic reports and filings.\n',
  body_key: '',
  source_url: '',
  visibility: 'public',
  stage: 'researching',
  category: 'finance',
  next_step: '',
  risk: '',
  created_by: 'profile-system',
  parent_id: '',
  status: 'active',
  pro_candidate: 0,
  created_at: '2026-06-10 00:00:00',
  updated_at: '2026-06-10 00:00:00',
  support: 0,
  trash: 0,
  pivot: 0,
  contribution_count: 0,
};

/**
 * Answers the two derived-children queries from an in-memory child list and
 * returns nothing for everything else, so a page render exercises the rail
 * without a whole database behind it.
 */
class StubD1 {
  statements: Array<{ sql: string; binds: unknown[] }> = [];

  constructor(private readonly children: Array<{ id: string; title: string }> = []) {}

  prepare(sql: string) {
    const handler: Handler = {};
    if (sql.includes('SELECT COUNT(*) AS n FROM ideas') && sql.includes('parent_id = ?')) {
      handler.first = () => ({ n: this.children.length });
    } else if (sql.includes('SELECT id, title FROM ideas') && sql.includes('parent_id = ?')) {
      // Honours the statement's own LIMIT bind, so a test can tell a cap that
      // is applied from a cap that is merely written down.
      handler.all = ([, limit]) => ({ results: this.children.slice(0, Number(limit)) });
    } else if (sql.includes('FROM ideas i') && sql.includes('WHERE i.id = ?')) {
      handler.first = () => ({ ...PARENT });
    } else if (sql.includes('COUNT(*) AS n FROM contributions')) {
      handler.first = () => ({ n: 0 });
    }
    return new Statement(this, sql, handler);
  }

  batch() {
    return Promise.resolve([]);
  }

  /** The single statement matching `fragment` — throws rather than returning undefined. */
  only(fragment: string) {
    const found = this.statements.filter((statement) => statement.sql.includes(fragment));
    if (found.length !== 1) throw new Error(`expected exactly one statement matching ${fragment}, got ${found.length}`);
    return found[0]!;
  }
}

function child(index: number) {
  return { id: `annex-${index}`, title: `Annex ${index}` };
}

function envWith(children: Array<{ id: string; title: string }>) {
  const DB = new StubD1(children);
  return { DB, env: { DB } as unknown as Env };
}

function ideaPageRequest() {
  return new Request('https://fis.test/ideas/asx-filings-analyst/');
}

describe('derivedIdeas (#80)', () => {
  it('returns the total from a COUNT, not from the page it just read', async () => {
    const children = Array.from({ length: DERIVED_CHILDREN_LIMIT + 87 }, (_, index) => child(index));
    const { env } = envWith(children);

    const { children: page, total } = await derivedIdeas(env, 'asx-filings-analyst');

    expect(page).toHaveLength(DERIVED_CHILDREN_LIMIT);
    expect(total).toBe(DERIVED_CHILDREN_LIMIT + 87);
    // The failure mode being ruled out: inferring the total from the page,
    // which cannot tell "exactly at the cap" from "over it".
    expect(total).not.toBe(page.length);
  });

  it('binds the cap as a named constant rather than burying a literal in the SQL', async () => {
    const { DB, env } = envWith([child(0)]);

    await derivedIdeas(env, 'asx-filings-analyst');

    const listed = DB.only('SELECT id, title FROM ideas');
    expect(listed.binds).toEqual(['asx-filings-analyst', DERIVED_CHILDREN_LIMIT]);
    expect(listed.sql).toMatch(/LIMIT \?/);
    expect(listed.sql).not.toMatch(/LIMIT \d/);
  });

  it('orders children by creation, so the listed set does not rotate as children are edited', async () => {
    const { DB, env } = envWith([child(0)]);

    await derivedIdeas(env, 'asx-filings-analyst');

    const listed = DB.only('SELECT id, title FROM ideas');
    expect(listed.sql).toMatch(/ORDER BY\s+created_at ASC, id ASC/);
    // `updated_at DESC` is the bug: it made membership of the list a function
    // of edit recency, so editing any child reshuffled which twenty appeared.
    expect(listed.sql).not.toMatch(/updated_at/);
  });

  it('still excludes removed children from both the page and the total', async () => {
    const { DB, env } = envWith([child(0)]);

    await derivedIdeas(env, 'asx-filings-analyst');

    for (const fragment of ['SELECT id, title FROM ideas', 'SELECT COUNT(*) AS n FROM ideas']) {
      expect(DB.only(fragment).sql).toMatch(/status != 'removed'/);
    }
  });
});

describe('the Signals rail states what it is not showing (#80)', () => {
  it('says "Showing N of M" when the children are capped', async () => {
    const children = Array.from({ length: DERIVED_CHILDREN_LIMIT + 87 }, (_, index) => child(index));
    const { env } = envWith(children);

    const response = await renderIdeaPage(env, ideaPageRequest(), 'asx-filings-analyst');
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(html).toContain(`Showing ${DERIVED_CHILDREN_LIMIT} of ${DERIVED_CHILDREN_LIMIT + 87} derived ideas`);
    expect(html).toContain('/ideas/annex-0/');
    // The 21st annex used to be absent rather than truncated: the rail must not
    // claim the cap is the whole set.
    expect(html).not.toContain(`${DERIVED_CHILDREN_LIMIT} derived ideas<`);
  });

  it('states the plain total when nothing is truncated', async () => {
    const { env } = envWith([child(0), child(1), child(2)]);

    const response = await renderIdeaPage(env, ideaPageRequest(), 'asx-filings-analyst');
    const html = await response.text();

    expect(html).toContain('3 derived ideas');
    expect(html).not.toContain('Showing 3 of');
  });

  it('says "idea" rather than "ideas" for a single child', async () => {
    const { env } = envWith([child(0)]);

    const html = await (await renderIdeaPage(env, ideaPageRequest(), 'asx-filings-analyst')).text();

    expect(html).toContain('>1 derived idea<');
    expect(html).not.toContain('1 derived ideas');
  });

  it('renders no derived-ideas block at all when there are no children', async () => {
    const { env } = envWith([]);

    const html = await (await renderIdeaPage(env, ideaPageRequest(), 'asx-filings-analyst')).text();

    expect(html).not.toContain('Derived ideas');
    expect(html).not.toContain('derived idea');
  });
});

describe('ideasByProfile projects parent_id (#80)', () => {
  it('selects parent_id, so a caller can rebuild the tree it just built', async () => {
    const DB = new StubD1();
    const env = { DB } as unknown as Env;

    await ideasByProfile(env, 'profile-serge-the-dev', 30);

    const statement = DB.only('WHERE created_by = ?');
    const projection = statement.sql.slice(0, statement.sql.indexOf('FROM'));
    expect(projection).toMatch(/\bparent_id\b/);
    // Guards the shape of the assertion itself: `parent_id` appearing only in a
    // WHERE clause would not let a client see the tree.
    expect(projection).toMatch(/\bid\b/);
    expect(statement.binds).toEqual(['profile-serge-the-dev', 30]);
  });

  it('passes the column through to the caller for children and roots alike', async () => {
    class ProfileD1 extends StubD1 {
      prepare(sql: string) {
        if (sql.includes('WHERE created_by = ?')) {
          return new Statement(this, sql, {
            all: () => ({
              results: [
                { id: 'annex-0', title: 'Annex 0', parent_id: 'asx-filings-analyst' },
                { id: 'asx-filings-analyst', title: 'ASX Filings Analyst', parent_id: '' },
              ],
            }),
          });
        }
        return super.prepare(sql);
      }
    }
    const env = { DB: new ProfileD1() } as unknown as Env;

    const rows = await ideasByProfile(env, 'profile-serge-the-dev');

    expect(rows.map((row) => [row.id, row.parent_id])).toEqual([
      ['annex-0', 'asx-filings-analyst'],
      ['asx-filings-analyst', ''],
    ]);
  });
});
