import { afterEach, describe, expect, it, vi } from 'vitest';
import { createIdea, deleteIdea, deriveIdea, updateIdea, updateIdeaSection } from './api-idea-mutations';
import type { Env } from './types';

/**
 * `render_key` is gone — these tests are the reason it stays gone.
 *
 * From migration 0002 until #70 the write paths computed
 * `ideas/<id>/rendered.html`, stored it on four INSERT/UPDATE statements and
 * `IDEA_BUCKET.delete()`d it on three more. No code ever `put()` that object and
 * no code ever read it, so every write paid a cache invalidation for a cache
 * that did not exist.
 *
 * A column with a plausible name is exactly the kind of thing a later reader
 * re-derives a feature from, so the assertions below are about the SQL and the
 * R2 traffic the write paths actually emit, not about the source text: a
 * reinstated render cache fails here whatever it is called.
 */

type Handler = {
  all?: (binds: unknown[]) => unknown;
  first?: (binds: unknown[]) => unknown;
  run?: (binds: unknown[]) => unknown;
};

class Statement {
  private binds: unknown[] = [];

  constructor(
    private readonly db: RecordingD1,
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

const IDEA = {
  id: 'asx-filings-analyst',
  title: 'ASX Filings Analyst',
  summary: 'Public reports, valuation screens, source-backed weekly watchlist.',
  preview: '',
  signal: '',
  body_md: '## Snapshot\nPublic reports and filings.\n\n## Risk\nAccidental advice.\n',
  body_key: '',
  source_url: '',
  visibility: 'public',
  stage: 'researching',
  category: 'finance',
  next_step: '',
  risk: '',
  created_by: 'profile-serge-the-dev',
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

const PROFILE = { id: 'profile-serge-the-dev', handle: 'serge-the-dev', display_name: 'Serge The Dev' };

/**
 * Records every statement the write path prepares and answers only the reads a
 * mutation needs. Everything else returns empty, which is enough: the
 * post-commit reindex is guarded and a stale index is not what is under test.
 */
class RecordingD1 {
  statements: Array<{ sql: string; binds: unknown[] }> = [];

  prepare(sql: string) {
    const handler: Handler = {};
    if (sql.includes('FROM ideas i') && sql.includes('WHERE i.id = ?')) {
      handler.first = () => ({ ...IDEA });
    } else if (sql.includes('FROM profiles p') && sql.includes('WHERE p.handle = ?')) {
      handler.first = () => ({ ...PROFILE });
    }
    return new Statement(this, sql, handler);
  }

  batch() {
    return Promise.resolve([]);
  }

  /** Every statement issued, as one lower-cased blob, for absence assertions. */
  get sqlText() {
    return this.statements.map((statement) => statement.sql).join('\n').toLowerCase();
  }

  /** The single statement matching `fragment` — throws rather than returning undefined. */
  only(fragment: string) {
    const found = this.statements.filter((statement) => statement.sql.includes(fragment));
    if (found.length !== 1) throw new Error(`expected exactly one statement matching ${fragment}, got ${found.length}`);
    return found[0]!;
  }
}

/** Minimal R2 stand-in that records which keys are written and deleted. */
class RecordingR2 {
  objects = new Map<string, string>();
  written: string[] = [];
  deleted: string[] = [];

  put(key: string, value: string) {
    this.written.push(key);
    this.objects.set(key, value);
    return Promise.resolve({ key });
  }

  get(key: string) {
    const value = this.objects.get(key);
    return Promise.resolve(value === undefined ? null : { text: () => Promise.resolve(value) });
  }

  delete(key: string) {
    this.deleted.push(key);
    return Promise.resolve();
  }
}

function fakeEnv() {
  const DB = new RecordingD1();
  const IDEA_BUCKET = new RecordingR2();
  return { DB, IDEA_BUCKET, env: { DB, IDEA_BUCKET } as unknown as Env };
}

function post(url: string, body: unknown, headers: Record<string, string> = {}) {
  return new Request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

function signedIn() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      new Response(
        JSON.stringify({
          user: { handle: 'serge-the-dev', displayName: 'Serge The Dev', provider: 'github', avatarUrl: null },
        }),
        { headers: { 'content-type': 'application/json' } },
      ),
    ),
  );
  return { Authorization: 'Bearer test-session-token' };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('render_key is gone from the write paths (#70)', () => {
  it('creating an idea stores the body object and no rendered-HTML object', async () => {
    const { DB, IDEA_BUCKET, env } = fakeEnv();
    const response = await createIdea(
      post('https://fis.test/api/ideas', {
        title: 'Cheap Idea Pages',
        summary: 'A document that should cost exactly one object to store.',
        body: '## Snapshot\nOne object, not two.\n',
      }, { 'x-idea-handle': 'serge-the-dev' }),
      env,
    );

    expect(response.status).toBe(201);
    const { idea } = (await response.json()) as { idea: string };
    expect(IDEA_BUCKET.written).toEqual([`ideas/${idea}/body.md`]);
    expect(IDEA_BUCKET.deleted).toEqual([]);

    const insert = DB.only('INSERT INTO ideas');
    expect(insert.sql).not.toMatch(/render_key/);
    // Column count and bind count must agree, or a removed column silently
    // shifts every value after it into the wrong column.
    const columns = (insert.sql.match(/\(([^)]*)\)\s*VALUES/)?.[1] || '').split(',').length;
    expect(insert.binds).toHaveLength(columns);
  });

  it('deriving an idea stores the body object and no rendered-HTML object', async () => {
    const { DB, IDEA_BUCKET, env } = fakeEnv();
    const response = await deriveIdea(
      post('https://fis.test/api/ideas/asx-filings-analyst/derive', {
        title: 'ASX Filings Analyst for Small Caps',
        summary: 'A small-cap-focused fork of the ASX filings research assistant.',
      }, { 'x-idea-handle': 'forker' }),
      env,
      'asx-filings-analyst',
    );

    expect(response.status).toBe(201);
    const { idea } = (await response.json()) as { idea: string };
    expect(IDEA_BUCKET.written).toEqual([`ideas/${idea}/body.md`]);
    expect(IDEA_BUCKET.deleted).toEqual([]);
    expect(DB.only('INSERT INTO ideas').sql).not.toMatch(/render_key/);
  });

  it('a section write invalidates nothing — there is no cache to invalidate', async () => {
    const { DB, IDEA_BUCKET, env } = fakeEnv();
    const headers = signedIn();
    const response = await updateIdeaSection(
      post('https://fis.test/api/ideas/asx-filings-analyst/sections/risk', { content: 'Licensing exposure.' }, headers),
      env,
      'asx-filings-analyst',
      'risk',
      'replace',
    );

    expect(response.status).toBe(200);
    expect(IDEA_BUCKET.written).toContain('ideas/asx-filings-analyst/body.md');
    // The whole point of #70: three write paths used to spend an R2 delete here.
    expect(IDEA_BUCKET.deleted).toEqual([]);
    const update = DB.only('SET body_md = ?');
    expect(update.sql).not.toMatch(/render_key/);
    expect(update.binds).toHaveLength((update.sql.match(/= \?/g) || []).length);
  });

  it('publishing a whole document invalidates nothing', async () => {
    const { DB, IDEA_BUCKET, env } = fakeEnv();
    const headers = signedIn();
    const response = await updateIdea(
      post('https://fis.test/api/ideas/asx-filings-analyst', { body: '## Snapshot\nRewritten in full.\n' }, headers),
      env,
      'asx-filings-analyst',
    );

    expect(response.status).toBe(200);
    expect(IDEA_BUCKET.deleted).toEqual([]);
    const update = DB.only('SET title = ?');
    expect(update.sql).not.toMatch(/render_key/);
    expect(update.binds).toHaveLength((update.sql.match(/= \?/g) || []).length);
  });

  it('deleting an idea removes the body object and nothing else', async () => {
    const { IDEA_BUCKET, env } = fakeEnv();
    const headers = signedIn();
    const response = await deleteIdea(
      post('https://fis.test/api/ideas/asx-filings-analyst/delete', { confirmTitle: IDEA.title }, headers),
      env,
      'asx-filings-analyst',
    );

    expect(response.status).toBe(200);
    expect(IDEA_BUCKET.deleted).toEqual(['ideas/asx-filings-analyst/body.md']);
  });

  it('no statement or object any write path touches names a render key', async () => {
    const { DB, IDEA_BUCKET, env } = fakeEnv();
    const headers = signedIn();
    await createIdea(
      post('https://fis.test/api/ideas', {
        title: 'Trace Sweep',
        summary: 'Every write path, checked for the phantom column in one place.',
        body: '## Snapshot\nSweep.\n',
      }, { 'x-idea-handle': 'serge-the-dev' }),
      env,
    );
    await deriveIdea(
      post('https://fis.test/api/ideas/asx-filings-analyst/derive', {
        title: 'Trace Sweep Fork',
        summary: 'A fork used only to sweep the derive write path for render keys.',
      }, headers),
      env,
      'asx-filings-analyst',
    );
    await updateIdeaSection(
      post('https://fis.test/api/ideas/asx-filings-analyst/sections/risk', { content: 'Swept.' }, headers),
      env,
      'asx-filings-analyst',
      'risk',
      'append',
    );
    await updateIdea(
      post('https://fis.test/api/ideas/asx-filings-analyst', { summary: 'Metadata-only sweep of the update path.' }, headers),
      env,
      'asx-filings-analyst',
    );
    await deleteIdea(
      post('https://fis.test/api/ideas/asx-filings-analyst/delete', { confirmTitle: IDEA.title }, headers),
      env,
      'asx-filings-analyst',
    );

    expect(DB.statements.length).toBeGreaterThan(5);
    expect(DB.sqlText).toContain('body_key');
    expect(DB.sqlText).not.toContain('render_key');

    // Revision snapshots are also R2 objects, so this is "nothing rendered",
    // not "nothing but the body".
    const keys = [...IDEA_BUCKET.written, ...IDEA_BUCKET.deleted];
    expect(keys).toContain('ideas/asx-filings-analyst/body.md');
    expect(keys.filter((key) => key.includes('render') || key.endsWith('.html'))).toEqual([]);
  });
});
