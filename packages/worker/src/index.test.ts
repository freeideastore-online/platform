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
      body_md: '# Snapshot\nPublic reports and filings.\n\n## Design Sketch\n1. Review filings.\n2. Cite sources.\n\n## Risk\nAccidental financial advice.',
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
    if (sql.includes('FROM profiles p') && sql.includes('LEFT JOIN ideas i') && !sql.includes('WHERE p.handle')) {
      return new FakeStatement({
        all: () => ({
          results: [
            {
              id: 'profile-risk-finder',
              handle: 'risk-finder',
              display_name: 'Risk Finder',
              bio: '',
              reputation: 184,
              badges_json: '["risk-mapper"]',
              idea_count: 0,
              contribution_count: 3,
              reaction_count: 2,
            },
          ],
        }),
      });
    }
    if (sql.includes('FROM profiles p') && sql.includes('WHERE p.handle')) {
      return new FakeStatement({
        first: ([handle]) =>
          handle === 'risk-finder'
            ? {
                id: 'profile-risk-finder',
                handle: 'risk-finder',
                display_name: 'Risk Finder',
                bio: '',
                reputation: 184,
                badges_json: '["risk-mapper"]',
                idea_count: 0,
                contribution_count: 3,
                reaction_count: 2,
              }
            : null,
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
    expect(html).toContain('href="#design-sketch"');
    expect(html).toContain('<h2 id="design-sketch">Design Sketch</h2>');
    expect(html).toContain('<ol>');
    expect(html).toContain('<li>Review filings.</li>');
    expect(html).toContain('2 supports / 0 trash / 0 pivots');
  });

  it('redirects old chapter URLs to dynamic page section anchors', async () => {
    const response = await worker.fetch(new Request('https://fis.test/ideas/asx-filings-analyst/research-notes/'), env());

    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe('https://fis.test/ideas/asx-filings-analyst/#research-notes');
  });

  it('renders contributor directory and console surfaces', async () => {
    const contributors = await worker.fetch(new Request('https://fis.test/contributors/'), env());
    const contributorHtml = await contributors.text();
    const consolePage = await worker.fetch(new Request('https://fis.test/console/'), env());
    const consoleHtml = await consolePage.text();

    expect(contributors.status).toBe(200);
    expect(contributorHtml).toContain('Contributor reputation.');
    expect(contributorHtml).toContain('Risk Finder');
    expect(consolePage.status).toBe(200);
    expect(consoleHtml).toContain('Create idea');
    expect(consoleHtml).toContain('Sign in with GitHub');
  });

  it('renders rich user profile pages with public work sections', async () => {
    const response = await worker.fetch(new Request('https://fis.test/users/risk-finder/'), env());
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(html).toContain('Risk Finder');
    expect(html).toContain('Profile strength');
    expect(html).toContain('Contribution mix');
    expect(html).toContain('Best fit');
  });

  it('starts OAuth through the FreeAppStore auth API with a nonce cookie', async () => {
    const response = await worker.fetch(new Request('https://fis.test/.fis/auth/start?provider=github&return_to=/console/'), env());
    const location = response.headers.get('location') || '';

    expect(response.status).toBe(302);
    expect(location).toContain('https://api.freeappstore.online/v1/auth/github/start');
    expect(location).toContain('app_id=freeideastore');
    expect(location).toContain('response_mode=query');
    expect(response.headers.get('set-cookie')).toContain('__Host-fis_auth_nonce=');
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
