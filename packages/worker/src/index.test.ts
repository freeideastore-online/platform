import { afterEach, describe, expect, it, vi } from 'vitest';
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
  removed: string[] = [];
  reactions: unknown[][] = [];
  listQuery = '';
  listBinds: unknown[] = [];
  private readonly ideas = new Map<string, Record<string, unknown>>();
  private readonly profiles = new Map<string, Record<string, unknown>>();
  private readonly contributions: Array<Record<string, unknown>> = [];

  constructor() {
    this.profiles.set('profile-system', {
      id: 'profile-system',
      handle: 'system',
      display_name: 'System',
      reputation: 0,
      badges_json: '[]',
    });
    this.profiles.set('profile-serge-the-dev', {
      id: 'profile-serge-the-dev',
      handle: 'serge-the-dev',
      display_name: 'Serge The Dev',
      reputation: 20,
      badges_json: '[]',
    });
    this.contributions.push(
      {
        id: 'contribution-comment-1',
        idea_id: 'asx-filings-analyst',
        profile_id: 'profile-serge-the-dev',
        kind: 'comment',
        body: 'This needs strong disclaimers before anyone treats it as advice.',
        created_at: '2026-06-11 03:00:00',
      },
      {
        id: 'contribution-evidence-1',
        idea_id: 'asx-filings-analyst',
        profile_id: 'profile-system',
        kind: 'evidence',
        body: 'Seed evidence note.',
        created_at: '2026-06-10 03:00:00',
      },
    );
    this.ideas.set('asx-filings-analyst', {
      id: 'asx-filings-analyst',
      title: 'ASX Filings Analyst',
      summary: 'Public reports, valuation screens, source-backed weekly watchlist.',
      preview: 'Weekly public-data research assistant.',
      signal: 'Validate with 10 Australian retail investors.',
      body_md:
        '# Snapshot\nPublic reports and filings.\n\n## Design Sketch\n### Workflow\n1. Review filings.\n2. Cite sources.\n\n### Source Trail\nKeep every product and reference clickable.\n\n## Risk\nAccidental financial advice.',
      body_key: '',
      render_key: '',
      source_url: '',
      visibility: 'public',
      stage: 'researching',
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
    this.ideas.set('serge-idea-lab', {
      id: 'serge-idea-lab',
      title: 'Serge Idea Lab',
      summary: 'A signed-in user workspace for refining early ideas.',
      preview: 'Account-owned idea workspace.',
      signal: 'Signed-in profile should see this idea.',
      body_md: '## Snapshot\nOwned by the signed-in account.',
      body_key: '',
      render_key: '',
      source_url: '',
      visibility: 'public',
      stage: 'prototyping',
      category: 'platform',
      next_step: 'Use it from the profile page.',
      risk: 'Ownership views can drift if auth is guessed.',
      created_by: 'profile-serge-the-dev',
      status: 'active',
      pro_candidate: 0,
      created_at: '2026-06-10 00:00:00',
      updated_at: '2026-06-11 00:00:00',
      support: 0,
      trash: 0,
      pivot: 0,
      contribution_count: 0,
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
            results: Array.from(this.ideas.values())
              .filter((idea) => idea.status !== 'removed')
              .map(({ body_md, body_key, render_key, ...idea }) => ({
                ...idea,
                has_publication: body_key || String(body_md || '').includes('## ') ? 1 : 0,
              })),
          };
        },
      });
    }
    if (sql.includes('FROM profiles p') && sql.includes('LEFT JOIN ideas i') && !sql.includes('p.handle = ?')) {
      return new FakeStatement({
        all: () => ({
          results: [
            {
              id: 'profile-serge-the-dev',
              handle: 'serge-the-dev',
              display_name: 'Serge The Dev',
              bio: '',
              reputation: 20,
              badges_json: '[]',
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
        first: ([handle]) => {
          if (handle === 'risk-finder') return null;
          const profile = Array.from(this.profiles.values()).find((item) => item.handle === handle);
          return profile
            ? {
                ...profile,
                bio: '',
                idea_count: 0,
                contribution_count: 3,
                reaction_count: 2,
              }
            : null;
        },
      });
    }
    if (sql.includes('SELECT id, title, summary, stage, category, updated_at, pro_candidate') && sql.includes('WHERE created_by = ?')) {
      return new FakeStatement({
        all: ([profileId, limit]) => ({
          results: Array.from(this.ideas.values())
            .filter((idea) => idea.created_by === profileId && idea.status !== 'removed')
            .slice(0, Number(limit || 500))
            .map(({ id, title, summary, stage, category, updated_at, pro_candidate }) => ({
              id,
              title,
              summary,
              stage,
              category,
              updated_at,
              pro_candidate,
            })),
        }),
      });
    }
    if (sql.includes('SELECT c.kind, c.body, c.created_at, i.id AS idea_id, i.title AS idea_title')) {
      return new FakeStatement({
        all: ([profileId]) =>
          profileId === 'profile-serge-the-dev'
            ? {
                results: [
                  {
                    kind: 'refinement',
                    body: 'Make the owner view first-class.',
                    created_at: '2026-06-11 00:00:00',
                    idea_id: 'asx-filings-analyst',
                    idea_title: 'ASX Filings Analyst',
                  },
                ],
              }
            : { results: [] },
      });
    }
    if (sql.includes('FROM ideas i') && sql.includes('WHERE i.id = ?')) {
      return new FakeStatement({
        first: ([id]) => {
          const idea = this.ideas.get(String(id));
          return idea && idea.status !== 'removed' ? idea : null;
        },
      });
    }
    if (sql.includes('INSERT OR IGNORE INTO profiles')) {
      return new FakeStatement({
        run: ([id, handle, displayName]) => {
          if (!this.profiles.has(String(id))) {
            this.profiles.set(String(id), {
              id,
              handle,
              display_name: displayName,
              reputation: 0,
              badges_json: '[]',
            });
          }
        },
      });
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
    if (sql.includes('UPDATE ideas') && sql.includes('SET title = ?')) {
      return new FakeStatement({
        run: (binds) => {
          const [
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
            id,
          ] = binds;
          const idea = this.ideas.get(String(id));
          if (!idea) return;
          Object.assign(idea, {
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
            updated_at: '2026-06-11 01:00:00',
          });
        },
      });
    }
    if (sql.includes("SET status = 'removed'")) {
      return new FakeStatement({
        run: ([id]) => {
          this.removed.push(String(id));
          const idea = this.ideas.get(String(id));
          if (idea) {
            idea.status = 'removed';
            idea.updated_at = '2026-06-11 02:00:00';
          }
        },
      });
    }
    if (sql.includes('SELECT c.id, c.kind, c.body, c.created_at, p.handle, p.display_name')) {
      return new FakeStatement({
        all: ([ideaId]) => ({
          results: this.contributions
            .filter((item) => item.idea_id === ideaId)
            .map((item) => {
              const profile = this.profiles.get(String(item.profile_id)) || {};
              return {
                id: item.id,
                kind: item.kind,
                body: item.body,
                created_at: item.created_at,
                handle: profile.handle || 'guest',
                display_name: profile.display_name || profile.handle || 'Guest',
              };
            }),
        }),
      });
    }
    if (sql.includes('INSERT INTO contributions')) {
      return new FakeStatement({
        run: ([id, ideaId, profileId, kind, body]) => {
          this.contributions.unshift({
            id,
            idea_id: ideaId,
            profile_id: profileId,
            kind,
            body,
            created_at: '2026-06-11 04:00:00',
          });
          const idea = this.ideas.get(String(ideaId));
          if (idea) idea.contribution_count = Number(idea.contribution_count || 0) + 1;
        },
      });
    }
    if (sql.includes('INSERT OR IGNORE INTO reactions')) {
      return new FakeStatement({
        run: (binds) => {
          this.reactions.push(binds);
          const [, ideaId, , type] = binds;
          const idea = this.ideas.get(String(ideaId));
          if (idea && typeof type === 'string') idea[type] = Number(idea[type] || 0) + 1;
        },
      });
    }
    if (sql.includes('UPDATE ideas SET updated_at = CURRENT_TIMESTAMP')) {
      return new FakeStatement({
        run: ([id]) => {
          const idea = this.ideas.get(String(id));
          if (idea) idea.updated_at = '2026-06-11 04:00:00';
        },
      });
    }
    return new FakeStatement({});
  }
}

function mockSignedInSerge() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      new Response(
        JSON.stringify({
          user: {
            handle: 'serge-the-dev',
            displayName: 'Serge The Dev',
            provider: 'github',
            avatarUrl: 'https://example.com/avatar.png',
          },
        }),
        { headers: { 'content-type': 'application/json' } },
      ),
    ),
  );
}

function env(db = new FakeD1(), assetResponse = new Response('asset fallback', { status: 404 })) {
  return {
    DB: db,
    ASSETS: { fetch: () => Promise.resolve(assetResponse.clone()) },
  } as unknown as Parameters<typeof worker.fetch>[1] & { DB: FakeD1 };
}

describe('FreeIdeaStore worker', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns a lightweight idea list without body storage fields', async () => {
    const testEnv = env();
    const response = await worker.fetch(new Request('https://fis.test/api/ideas'), testEnv);
    const data = (await response.json()) as { ideas: Array<Record<string, unknown>> };

    expect(response.status).toBe(200);
    expect(testEnv.DB.listBinds).toEqual(['all', 'all', 60]);
    expect(data.ideas[0]).toMatchObject({ id: 'asx-filings-analyst', title: 'ASX Filings Analyst' });
    expect(data.ideas[0]).toMatchObject({ has_publication: 1 });
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
    expect(html).toContain('ASX Filings Analyst');
    expect(html).toContain('Public reports and filings.');
    expect(html).toContain('class="book-topbar"');
    expect(html).toContain('class="book-sidebar"');
    expect(html).toContain('class="mobile-book-nav"');
    expect(html).not.toContain('<small>FreeIdeaStore book</small>');
    expect(html).not.toContain('Idea book overview');
    expect(html).not.toContain('<small>Review filings. Cite sources.</small>');
    expect(html).toContain('data-reader-theme-option="dark"');
    expect(html).toContain('data-reader-size-option="xlarge"');
    expect(html).toContain('href="#design-sketch"');
    expect(html).toContain('<h2 id="design-sketch">Design Sketch</h2>');
    expect(html).toContain('<ol>');
    expect(html).toContain('<li>Review filings.</li>');
    expect(html).toContain('<strong>Reactions</strong>');
    expect(html).toContain('data-reaction="support"');
    expect(html).toContain('data-reaction="trash"');
    expect(html).toContain('data-reaction="pivot"');
    expect(html).toContain('<section class="comments" id="comments"');
    expect(html).toContain('Post comment');
    expect(html).toContain('const ideaId = "asx-filings-analyst"');
    expect(html).toContain('/contributions');
  });

  it('links from dynamic idea pages to Worker-rendered book chapters', async () => {
    const response = await worker.fetch(new Request('https://fis.test/ideas/asx-filings-analyst/'), env());
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(html).toContain('Start reading');
    expect(html).toContain('href="/ideas/asx-filings-analyst/snapshot/"');
  });

  it('does not turn an MCP-style document title into a duplicate idea-book chapter', async () => {
    const testEnv = env();
    const create = await worker.fetch(
      new Request('https://fis.test/api/ideas', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-idea-handle': 'tester' },
        body: JSON.stringify({
          title: 'MCP Book Idea',
          summary: 'A test idea using the canonical MCP dynamic book markdown shape.',
          body: '# MCP Book Idea\n\nStage: raw\nCategory: platform\n\n## Snapshot\nThis is the first real chapter.\n\n## Research\nThis is the second chapter.',
        }),
      }),
      testEnv,
    );
    const ideaPage = await worker.fetch(new Request('https://fis.test/ideas/mcp-book-idea/'), testEnv);
    const html = await ideaPage.text();
    const chapter = await worker.fetch(new Request('https://fis.test/ideas/mcp-book-idea/snapshot/'), testEnv);
    const chapterHtml = await chapter.text();

    expect(create.status).toBe(201);
    expect(ideaPage.status).toBe(200);
    expect(html).toContain('href="/ideas/mcp-book-idea/snapshot/"');
    expect(html).toContain('href="/ideas/mcp-book-idea/research/"');
    expect(html).not.toContain('href="/ideas/mcp-book-idea/mcp-book-idea/"');
    expect(chapter.status).toBe(200);
    expect(chapterHtml).toContain('<h1>Snapshot</h1>');
    expect(chapterHtml).toContain('Chapter 1 of 2');
  });

  it('renders all publication chapters through the dynamic Worker publisher', async () => {
    const response = await worker.fetch(new Request('https://fis.test/ideas/asx-filings-analyst/design-sketch/'), env());
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/html');
    expect(html).toContain('class="book-topbar"');
    expect(html).not.toContain('aria-label="Publication actions"');
    expect(html).not.toContain('class="top-actions"');
    expect(html).not.toContain('>Current chapter</a>');
    expect(html).not.toContain('<small>FreeIdeaStore book</small>');
    expect(html).toContain('<h1>Design Sketch</h1>');
    expect(html).toContain('Chapter 2 of 3');
    expect(html).toContain('class="mobile-page-toc"');
    expect(html).toContain('<h3 id="workflow">Workflow</h3>');
    expect(html).toContain('<h3 id="source-trail">Source Trail</h3>');
    expect(html).toContain('href="#workflow"');
    expect(html).toContain('href="#source-trail"');
    expect(html).toContain('Review filings.');
    expect(html).toContain('class="book-sidebar"');
    expect(html).not.toContain('<small>Review filings. Cite sources.</small>');
    expect(html).toContain('aria-label="Filter chapters"');
    expect(html).toContain('aria-label="Reader settings"');
    expect(html).toContain('fis:reader-size');
    expect(html).toContain('On this page');
    expect(html).toContain('<small>Previous</small>Snapshot');
    expect(html).toContain('<small>Next</small>Risk');
    expect(html).not.toContain('Dynamic FreeIdeaStore idea book');
  });

  it('renders the idea publication catalog dynamically instead of using static generated assets', async () => {
    const response = await worker.fetch(
      new Request('https://fis.test/ideas/'),
      env(new FakeD1(), new Response('old static idea catalog should not be used', { status: 200 })),
    );
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(html).toContain('Dynamic publications');
    expect(html).toContain('No per-idea GitHub docs, generated static assets, or legacy fallback renderer.');
    expect(html).toContain('ASX Filings Analyst');
    expect(html).not.toContain('old static idea catalog should not be used');
  });

  it('renders contributor directory and console surfaces', async () => {
    const contributors = await worker.fetch(new Request('https://fis.test/contributors/'), env());
    const contributorHtml = await contributors.text();
    const consolePage = await worker.fetch(new Request('https://fis.test/console/'), env());
    const consoleHtml = await consolePage.text();

    expect(contributors.status).toBe(200);
    expect(contributorHtml).toContain('Contributor reputation.');
    expect(contributorHtml).toContain('Serge The Dev');
    expect(contributorHtml).not.toContain('Risk Finder');
    expect(consolePage.status).toBe(200);
    expect(consoleHtml).toContain('Create idea');
    expect(consoleHtml).toContain('My ideas');
    expect(consoleHtml).toContain('id="my-ideas-list"');
    expect(consoleHtml).toContain('/api/me/activity?idea_limit=100&contribution_limit=10');
    expect(consoleHtml).toContain('id="account-slot"');
    expect(consoleHtml).toContain('Sign in with GitHub');
  });

  it('renders signed-out account profile controls', async () => {
    const response = await worker.fetch(new Request('https://fis.test/profile/'), env());
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(html).toContain('Sign in to view your profile.');
    expect(html).toContain('Sign in with GitHub');
    expect(html).toContain('Sign in with Google');
  });

  it('renders signed-in account-owned ideas and contributions', async () => {
    mockSignedInSerge();
    const response = await worker.fetch(
      new Request('https://fis.test/profile/', {
        headers: { Cookie: '__Host-fis_session=session-1' },
      }),
      env(),
    );
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(html).toContain('Serge The Dev');
    expect(html).toContain('My ideas');
    expect(html).toContain('Serge Idea Lab');
    expect(html).toContain('My recent contributions');
    expect(html).toContain('Make the owner view first-class.');
    expect(html).toContain('/api/me/ideas');
  });

  it('returns signed-in account-owned ideas through the API', async () => {
    mockSignedInSerge();
    const response = await worker.fetch(
      new Request('https://fis.test/api/me/ideas', {
        headers: { Cookie: '__Host-fis_session=session-1' },
      }),
      env(),
    );
    const data = (await response.json()) as { user: { handle: string }; ideas: Array<{ id: string }> };

    expect(response.status).toBe(200);
    expect(data.user.handle).toBe('serge-the-dev');
    expect(data.ideas.map((idea) => idea.id)).toEqual(['serge-idea-lab']);
  });

  it('accepts bearer auth for MCP and API user attribution', async () => {
    mockSignedInSerge();
    const testEnv = env();
    const session = await worker.fetch(
      new Request('https://fis.test/api/session', {
        headers: { Authorization: 'Bearer fas-session-token' },
      }),
      testEnv,
    );
    const create = await worker.fetch(
      new Request('https://fis.test/api/ideas', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer fas-session-token',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          title: 'Bearer Owned Idea',
          summary: 'This idea should be attributed to the bearer-authenticated profile.',
        }),
      }),
      testEnv,
    );

    expect(session.status).toBe(200);
    await expect(session.json()).resolves.toMatchObject({ user: { handle: 'serge-the-dev' } });
    expect(create.status).toBe(201);
    expect(testEnv.DB.inserts.at(-1)?.[14]).toBe('profile-serge-the-dev');
  });

  it('blocks cross-site browser mutations while allowing bearer agent mutations', async () => {
    mockSignedInSerge();
    const blocked = await worker.fetch(
      new Request('https://fis.test/api/ideas', {
        method: 'POST',
        headers: {
          Origin: 'https://evil.example',
          Cookie: '__Host-fis_session=session-1',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          title: 'Cross Site Idea',
          summary: 'This browser-cookie mutation should be blocked.',
        }),
      }),
      env(),
    );
    const allowed = await worker.fetch(
      new Request('https://fis.test/api/ideas', {
        method: 'POST',
        headers: {
          Origin: 'https://evil.example',
          Authorization: 'Bearer fas-session-token',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          title: 'Bearer Cross Origin Idea',
          summary: 'Bearer-authenticated agent calls are allowed without browser origin trust.',
        }),
      }),
      env(),
    );

    expect(blocked.status).toBe(403);
    expect(await blocked.text()).toBe('Forbidden');
    expect(allowed.status).toBe(201);
  });

  it('lets the authenticated owner update the canonical idea document', async () => {
    mockSignedInSerge();
    const testEnv = env();
    const update = await worker.fetch(
      new Request('https://fis.test/api/ideas/serge-idea-lab', {
        method: 'PATCH',
        headers: {
          Authorization: 'Bearer fas-session-token',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          summary: 'A richer public document for refining and publishing early ideas.',
          stage: 'researching',
          category: 'platform',
          next_step: 'Use MCP to elaborate the public idea document.',
          risk: 'Agents may overwrite useful nuance without preserving history.',
          body: '## Snapshot\nThe idea is now more complete.\n\n## Research\nCollect real user examples.',
        }),
      }),
      testEnv,
    );
    const read = await worker.fetch(new Request('https://fis.test/api/ideas/serge-idea-lab'), testEnv);
    const data = (await read.json()) as { idea: { stage: string; next_step: string }; body: string };

    expect(update.status).toBe(200);
    await expect(update.json()).resolves.toEqual({ ok: true, idea: 'serge-idea-lab', url: '/ideas/serge-idea-lab/' });
    expect(data.idea.stage).toBe('researching');
    expect(data.idea.next_step).toBe('Use MCP to elaborate the public idea document.');
    expect(data.body).toContain('## Research');
  });

  it('requires sign-in for blog-style comments on ideas', async () => {
    const response = await worker.fetch(
      new Request('https://fis.test/api/ideas/asx-filings-analyst/contributions', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-idea-handle': 'comment-tester',
        },
        body: JSON.stringify({
          kind: 'comment',
          body: 'Guest comments should not be accepted.',
        }),
      }),
      env(),
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: 'sign in required to comment or contribute' });
  });

  it('supports registered-user blog-style comments on ideas', async () => {
    mockSignedInSerge();
    const testEnv = env();
    const create = await worker.fetch(
      new Request('https://fis.test/api/ideas/asx-filings-analyst/contributions', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer fas-session-token',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          kind: 'comment',
          body: 'Could this start as a weekly manually curated watchlist?',
        }),
      }),
      testEnv,
    );
    const list = await worker.fetch(new Request('https://fis.test/api/ideas/asx-filings-analyst/contributions'), testEnv);
    const data = (await list.json()) as {
      contributions: Array<{ kind: string; body: string; handle: string; display_name: string }>;
    };

    expect(create.status).toBe(201);
    await expect(create.json()).resolves.toEqual({ ok: true });
    expect(data.contributions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'comment',
          body: 'Could this start as a weekly manually curated watchlist?',
          handle: 'serge-the-dev',
        }),
      ]),
    );
  });

  it('requires sign-in for idea reactions and stores registered reactions', async () => {
    const guest = await worker.fetch(
      new Request('https://fis.test/api/ideas/asx-filings-analyst/reactions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ type: 'support' }),
      }),
      env(),
    );

    mockSignedInSerge();
    const testEnv = env();
    const registered = await worker.fetch(
      new Request('https://fis.test/api/ideas/asx-filings-analyst/reactions', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer fas-session-token',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ type: 'support' }),
      }),
      testEnv,
    );

    expect(guest.status).toBe(401);
    await expect(guest.json()).resolves.toEqual({ error: 'sign in required to react to ideas' });
    expect(registered.status).toBe(201);
    await expect(registered.json()).resolves.toEqual({ ok: true, type: 'support' });
    expect(testEnv.DB.reactions.at(-1)?.[2]).toBe('profile-serge-the-dev');
  });

  it('blocks non-owners from updating canonical idea documents', async () => {
    mockSignedInSerge();
    const response = await worker.fetch(
      new Request('https://fis.test/api/ideas/asx-filings-analyst', {
        method: 'PATCH',
        headers: {
          Authorization: 'Bearer fas-session-token',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ body: '## Snapshot\nShould not overwrite system idea.' }),
      }),
      env(),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: 'only the idea owner can update the canonical document' });
  });

  it('lets the authenticated owner soft-delete an idea', async () => {
    mockSignedInSerge();
    const testEnv = env();
    const deleted = await worker.fetch(
      new Request('https://fis.test/api/ideas/serge-idea-lab', {
        method: 'DELETE',
        headers: {
          Authorization: 'Bearer fas-session-token',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ confirm_title: 'Serge Idea Lab' }),
      }),
      testEnv,
    );
    const read = await worker.fetch(new Request('https://fis.test/api/ideas/serge-idea-lab'), testEnv);
    const list = await worker.fetch(new Request('https://fis.test/api/ideas'), testEnv);
    const listData = (await list.json()) as { ideas: Array<{ id: string }> };

    expect(deleted.status).toBe(200);
    await expect(deleted.json()).resolves.toEqual({ ok: true, idea: 'serge-idea-lab', status: 'removed' });
    expect(testEnv.DB.removed).toEqual(['serge-idea-lab']);
    expect(read.status).toBe(404);
    expect(listData.ideas.map((idea) => idea.id)).not.toContain('serge-idea-lab');
  });

  it('blocks non-owners from deleting ideas', async () => {
    mockSignedInSerge();
    const response = await worker.fetch(
      new Request('https://fis.test/api/ideas/asx-filings-analyst', {
        method: 'DELETE',
        headers: {
          Authorization: 'Bearer fas-session-token',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ confirm_title: 'ASX Filings Analyst' }),
      }),
      env(),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: 'only the idea owner can delete this idea' });
  });

  it('renders rich user profile pages with public work sections', async () => {
    const response = await worker.fetch(new Request('https://fis.test/users/serge-the-dev/'), env());
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(html).toContain('Serge The Dev');
    expect(html).toContain('Profile strength');
    expect(html).toContain('Contribution mix');
    expect(html).toContain('Best fit');
  });

  it('does not expose removed seed contributor profiles', async () => {
    const response = await worker.fetch(new Request('https://fis.test/users/risk-finder/'), env());

    expect(response.status).toBe(404);
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

  it('creates a D1-backed free idea without static book files', async () => {
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

    expect(create.status).toBe(201);
    expect(created).toEqual({ idea: 'cheap-storage-test', url: '/ideas/cheap-storage-test/' });
    expect(testEnv.DB.inserts[0]?.[5]).toBe('## Snapshot\nStored in D1 for this test.');
  });

  it('requires the authenticated owner to promote an idea to a pro candidate', async () => {
    const guest = await worker.fetch(new Request('https://fis.test/api/ideas/serge-idea-lab/promote', { method: 'POST' }), env());

    mockSignedInSerge();
    const testEnv = env();
    const owned = await worker.fetch(
      new Request('https://fis.test/api/ideas/serge-idea-lab/promote', {
        method: 'POST',
        headers: { Authorization: 'Bearer fas-session-token' },
      }),
      testEnv,
    );
    const promoted = (await owned.json()) as { ok: boolean; proDossierDraft: { sourceIdeaId: string } };
    const nonOwner = await worker.fetch(
      new Request('https://fis.test/api/ideas/asx-filings-analyst/promote', {
        method: 'POST',
        headers: { Authorization: 'Bearer fas-session-token' },
      }),
      testEnv,
    );

    expect(guest.status).toBe(401);
    await expect(guest.json()).resolves.toEqual({ error: 'authentication required' });
    expect(owned.status).toBe(200);
    expect(promoted.ok).toBe(true);
    expect(promoted.proDossierDraft.sourceIdeaId).toBe('serge-idea-lab');
    expect(testEnv.DB.promoted).toEqual(['serge-idea-lab']);
    expect(nonOwner.status).toBe(403);
    await expect(nonOwner.json()).resolves.toEqual({ error: 'only the idea owner can promote this idea' });
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
