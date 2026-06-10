import { describe, expect, it } from 'vitest';
import worker from './index';

type QueryHandler = {
  all?: (binds: unknown[]) => unknown;
  first?: (binds: unknown[]) => unknown;
  run?: (binds: unknown[]) => unknown;
};

class FakeStatement {
  private binds: unknown[] = [];

  constructor(private readonly handler: QueryHandler) {}

  bind(...values: unknown[]) {
    this.binds = values;
    return this;
  }

  all() {
    return Promise.resolve(this.handler.all?.(this.binds) ?? { results: [] });
  }

  first<T>() {
    return Promise.resolve((this.handler.first?.(this.binds) ?? null) as T | null);
  }

  run() {
    return Promise.resolve(this.handler.run?.(this.binds) ?? { success: true });
  }
}

class FakeD1 {
  inserts: unknown[][] = [];
  promoted: string[] = [];
  listQuery = '';
  listBinds: unknown[] = [];
  private readonly ideas = new Map<string, Record<string, unknown>>();

  constructor() {
    this.ideas.set('asx-filings-analyst', {
      id: 'asx-filings-analyst',
      title: 'ASX Filings Analyst',
      summary: 'Public reports, valuation screens, source-backed weekly watchlist.',
      preview: 'Weekly public-data research assistant.',
      signal: 'Validate with 10 Australian retail investors.',
      body_md: '## Snapshot\nPublic reports and filings.\n\n## Risk\nAccidental financial advice.',
      body_key: '',
      render_key: '',
      source_url: '',
      visibility: 'public',
      stage: 'researched',
      category: 'finance',
      next_step: 'Validate with 10 Australian retail investors.',
      risk: 'Market data licensing and accidental financial advice.',
      created_by: 'profile-system',
      status: 'active',
      pro_candidate: 1,
      created_at: '2026-06-10 00:00:00',
      updated_at: '2026-06-10 00:00:00',
      support: 2,
      trash: 0,
      pivot: 0,
      contribution_count: 2,
    });
  }

  prepare(sql: string) {
    if (sql.includes('SELECT COUNT(*) AS count FROM ideas')) {
      return new FakeStatement({ first: () => ({ count: this.ideas.size }) });
    }
    if (sql.includes('SELECT id FROM ideas WHERE id = ?')) {
      return new FakeStatement({ first: ([id]) => (this.ideas.has(String(id)) ? { id } : null) });
    }
    if (sql.includes('WITH recent AS')) {
      this.listQuery = sql;
      return new FakeStatement({
        all: (binds) => {
          this.listBinds = binds;
          return {
            results: Array.from(this.ideas.values()).map(({ body_md, body_key, render_key, ...idea }) => idea),
          };
        },
      });
    }
    if (sql.includes('FROM ideas i') && sql.includes('WHERE i.id = ?')) {
      return new FakeStatement({ first: ([id]) => this.ideas.get(String(id)) ?? null });
    }
    if (sql.includes('INSERT OR IGNORE INTO profiles')) {
      return new FakeStatement({});
    }
    if (sql.includes('INSERT INTO ideas')) {
      return new FakeStatement({
        run: (binds) => {
          this.inserts.push(binds);
          const [
            id,
            title,
            summary,
            preview,
            signal,
            body_md,
            body_key,
            render_key,
            source_url,
            visibility,
            stage,
            category,
            next_step,
            risk,
            created_by,
          ] = binds;
          this.ideas.set(String(id), {
            id,
            title,
            summary,
            preview,
            signal,
            body_md,
            body_key,
            render_key,
            source_url,
            visibility,
            stage,
            category,
            next_step,
            risk,
            created_by,
            status: 'active',
            pro_candidate: 0,
            created_at: '2026-06-10 00:00:00',
            updated_at: '2026-06-10 00:00:00',
            support: 0,
            trash: 0,
            pivot: 0,
            contribution_count: 0,
          });
        },
      });
    }
    if (sql.includes('UPDATE ideas') && sql.includes('pro_candidate = 1')) {
      return new FakeStatement({
        run: ([id]) => {
          this.promoted.push(String(id));
          const idea = this.ideas.get(String(id));
          if (idea) idea.pro_candidate = 1;
        },
      });
    }
    return new FakeStatement({});
  }
}

function env(db = new FakeD1()) {
  return {
    DB: db,
    ASSETS: { fetch: () => Promise.resolve(new Response('asset fallback', { status: 404 })) },
  } as unknown as Parameters<typeof worker.fetch>[1] & { DB: FakeD1 };
}

describe('FreeIdeaStore worker', () => {
  it('returns a lightweight idea list without body storage fields', async () => {
    const testEnv = env();
    const response = await worker.fetch(new Request('https://fis.test/api/ideas'), testEnv);
    const data = (await response.json()) as { ideas: Array<Record<string, unknown>> };

    expect(response.status).toBe(200);
    expect(testEnv.DB.listQuery).not.toContain('body_md');
    expect(testEnv.DB.listBinds).toEqual(['all', 'all', 60]);
    expect(data.ideas[0]).toMatchObject({ id: 'asx-filings-analyst', title: 'ASX Filings Analyst' });
    expect(data.ideas[0]).not.toHaveProperty('body_md');
    expect(data.ideas[0]).not.toHaveProperty('body_key');
    expect(data.ideas[0]).not.toHaveProperty('render_key');
  });

  it('renders dynamic idea pages from DB-backed markdown', async () => {
    const response = await worker.fetch(new Request('https://fis.test/ideas/asx-filings-analyst/'), env());
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/html');
    expect(response.headers.get('content-security-policy')).toContain("default-src 'self'");
    expect(html).toContain('Cheap public idea page');
    expect(html).toContain('ASX Filings Analyst');
    expect(html).toContain('Public reports and filings.');
    expect(html).toContain('2 supports / 0 trash / 0 pivots');
  });

  it('creates a D1-backed free idea and promotes it to a pro candidate', async () => {
    const testEnv = env();
    const create = await worker.fetch(
      new Request('https://fis.test/api/ideas', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-idea-handle': 'tester' },
        body: JSON.stringify({
          title: 'Cheap Storage Test',
          summary: 'A test idea that proves cheap storage without static book files.',
          preview: 'Cheap page.',
          signal: 'The list endpoint stays small.',
          body: '## Snapshot\nStored in D1 for this test.',
        }),
      }),
      testEnv,
    );
    const created = (await create.json()) as { idea: string; url: string };
    const promote = await worker.fetch(new Request(`https://fis.test/api/ideas/${created.idea}/promote`, { method: 'POST' }), testEnv);
    const promoted = (await promote.json()) as { ok: boolean; proDossierDraft: { sourceIdeaId: string } };

    expect(create.status).toBe(201);
    expect(created).toEqual({ idea: 'cheap-storage-test', url: '/ideas/cheap-storage-test/' });
    expect(testEnv.DB.inserts[0][5]).toBe('## Snapshot\nStored in D1 for this test.');
    expect(promote.status).toBe(200);
    expect(promoted.ok).toBe(true);
    expect(promoted.proDossierDraft.sourceIdeaId).toBe('cheap-storage-test');
  });

  it('rejects invalid ids and writes to missing ideas', async () => {
    const invalid = await worker.fetch(new Request('https://fis.test/api/ideas/not%2Fvalid'), env());
    const missingReaction = await worker.fetch(
      new Request('https://fis.test/api/ideas/missing-idea/reactions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ type: 'support' }),
      }),
      env(),
    );

    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toEqual({ error: 'invalid idea id' });
    expect(missingReaction.status).toBe(404);
    expect(await missingReaction.json()).toEqual({ error: 'idea not found' });
  });
});
