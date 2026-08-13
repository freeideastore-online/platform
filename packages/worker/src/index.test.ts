import { afterEach, describe, expect, it, vi } from 'vitest';
import worker from './index';
import { FIELD_LIMITS, MAX_REQUEST_CHARS } from './http';
import { RESEARCH_PAGE_SIZE, RESEARCH_RENDER_CAP, researchSection } from './idea-research';

/**
 * Filler prose for fixtures that need to clear PUBLICATION_POLICY. Chapter
 * pages only exist for documents long enough to be worth paging through, so a
 * fixture that tests chapter rendering has to be a realistic length.
 */
function filler(sentences: number) {
  return Array.from(
    { length: sentences },
    (_, index) => `Filler sentence ${index} covering public filings, valuation screens and source trails in detail.`,
  ).join(' ');
}

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
  /**
   * Statements whose SQL contains this string reject instead of running, so a
   * test can stand in for the D1 error or subrequest ceiling that #71 is about.
   */
  failOn: string | null = null;
  /** Round trips spent on batched writes. */
  batches = 0;
  private readonly ideas = new Map<string, Record<string, unknown>>();
  private readonly profiles = new Map<string, Record<string, unknown>>();
  private readonly contributions: Array<Record<string, unknown>> = [];
  readonly revisions: Array<Record<string, unknown>> = [];
  readonly sources: Array<Record<string, unknown>> = [];
  readonly searchIndex: Array<Record<string, unknown>> = [];
  readonly sourceLinks: Array<Record<string, unknown>> = [];

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
      // Long enough to earn chapter pages, so the chapter-rendering tests below
      // exercise the paginated path rather than the single-page fallback.
      body_md: [
        '## Snapshot',
        'Public reports and filings.',
        '',
        filler(55),
        '',
        '## Design Sketch',
        '### Workflow',
        '1. Review filings.',
        '2. Cite sources.',
        '',
        '### Source Trail',
        'Keep every product and reference clickable.',
        '',
        filler(55),
        '',
        '## Risk',
        'Accidental financial advice.',
        '',
        filler(55),
      ].join('\n'),
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

  /**
   * D1 runs a batch as one round trip, in order. The fake runs the statements
   * in order too, so a `DELETE` followed by the rows replacing it behaves the
   * way it does in production.
   */
  async batch(statements: FakeStatement[]) {
    this.batches += 1;
    const results = [];
    for (const statement of statements) results.push(await statement.run());
    return results;
  }

  prepare(sql: string) {
    if (this.failOn && sql.includes(this.failOn)) {
      return new FakeStatement({
        all: () => {
          throw new Error(`D1 unavailable for: ${sql}`);
        },
        first: () => {
          throw new Error(`D1 unavailable for: ${sql}`);
        },
        run: () => {
          throw new Error(`D1 unavailable for: ${sql}`);
        },
      });
    }
    if (sql.includes('SELECT COUNT(*) AS count FROM ideas')) {
      return new FakeStatement({ first: () => ({ count: this.ideas.size }) });
    }
    if (sql.includes('SELECT id FROM ideas WHERE id = ?')) {
      return new FakeStatement({ first: ([id]) => (this.ideas.has(String(id)) ? { id } : null) });
    }
    if (sql.includes('SELECT id, title FROM ideas WHERE parent_id = ?')) {
      return new FakeStatement({
        all: ([parentId]) => ({
          results: Array.from(this.ideas.values())
            .filter((idea) => idea.parent_id === parentId && idea.status !== 'removed')
            .map((idea) => ({ id: idea.id, title: idea.title })),
        }),
      });
    }
    if (sql.includes('SELECT id, title FROM ideas WHERE id = ?')) {
      return new FakeStatement({
        first: ([id]) => {
          const idea = this.ideas.get(String(id));
          return idea && idea.status !== 'removed' ? { id: idea.id, title: idea.title } : null;
        },
      });
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
                // Mirrors the has_publication SQL in data.ts: PUBLICATION_POLICY
                // evaluated from the stored metrics. Seeded rows have no stored
                // metrics, so derive them the way documentMetrics() would.
                has_publication: (() => {
                  const text = String(body_md || '');
                  const words = Number(idea.body_words) || (text.trim() ? text.trim().split(/\s+/).length : 0);
                  const chapters = Number(idea.chapter_count) || (text.match(/^## /gm) || []).length;
                  if (chapters < 3 || words < 2000) return 0;
                  return Math.floor(words / chapters) >= 300 ? 1 : 0;
                })(),
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
    if (sql.includes('INSERT INTO search_index')) {
      return new FakeStatement({
        run: ([title, text, ideaId, ref]) => {
          this.searchIndex.push({ title, text, idea_id: ideaId, kind: sql.includes("'section'") ? 'section' : 'research', ref });
        },
      });
    }
    if (sql.includes('DELETE FROM search_index')) {
      return new FakeStatement({
        run: ([ideaId]) => {
          const sectionsOnly = sql.includes("kind = 'section'");
          for (let index = this.searchIndex.length - 1; index >= 0; index -= 1) {
            const row = this.searchIndex[index];
            if (!row || row.idea_id !== ideaId) continue;
            if (sectionsOnly && row.kind !== 'section') continue;
            this.searchIndex.splice(index, 1);
          }
        },
      });
    }
    // FTS MATCH cannot be emulated faithfully; naive term containment is enough
    // to exercise the ranking, shaping and render paths around it.
    if (sql.includes('FROM search_index s')) {
      return new FakeStatement({
        all: (binds) => {
          const match = String(binds[0] || '');
          const terms = [...match.matchAll(/"([^"]+)"/g)].map((m) => m[1] || '');
          const ideaFilter = sql.includes('AND s.idea_id = ?') ? String(binds[1]) : '';
          const results = this.searchIndex
            .filter((row) => (ideaFilter ? row.idea_id === ideaFilter : true))
            .filter((row) => {
              const haystack = `${row.title} ${row.text}`.toLowerCase();
              return terms.length > 0 && terms.every((term) => haystack.includes(term));
            })
            .map((row, position) => {
              const contribution = this.contributions.find((item) => item.id === row.ref);
              const idea = this.ideas.get(String(row.idea_id));
              return {
                idea_id: row.idea_id,
                kind: row.kind,
                ref: row.ref,
                title: row.title,
                snippet: String(row.text).slice(0, 60),
                rank: -10 + position,
                idea_title: idea?.title || row.idea_id,
                confidence: contribution?.confidence || '',
                superseded_by:
                  this.contributions.find((item) => item.supersedes === row.ref)?.id ?? null,
              };
            });
          return { results };
        },
      });
    }
    if (sql.includes('INSERT OR IGNORE INTO sources')) {
      return new FakeStatement({
        run: ([sourceId, url, host]) => {
          if (!this.sources.some((source) => source.url === url)) {
            this.sources.push({ id: sourceId, url, host, status: 0, last_checked: '' });
          }
        },
      });
    }
    if (sql.includes('SELECT id, url FROM sources WHERE url IN')) {
      return new FakeStatement({
        all: (urls) => ({
          results: this.sources.filter((source) => urls.includes(source.url)).map((source) => ({
            id: source.id,
            url: source.url,
          })),
        }),
      });
    }
    if (sql.includes('INSERT OR IGNORE INTO source_links')) {
      return new FakeStatement({
        run: ([linkId, sourceId, ideaId, section, contributionId]) => {
          const exists = this.sourceLinks.some(
            (link) =>
              link.source_id === sourceId &&
              link.idea_id === ideaId &&
              link.section === section &&
              link.contribution_id === contributionId,
          );
          if (!exists) {
            this.sourceLinks.push({
              id: linkId,
              source_id: sourceId,
              idea_id: ideaId,
              section,
              contribution_id: contributionId,
            });
          }
        },
      });
    }
    if (sql.includes('DELETE FROM source_links')) {
      return new FakeStatement({
        run: ([ideaId]) => {
          for (let index = this.sourceLinks.length - 1; index >= 0; index -= 1) {
            const link = this.sourceLinks[index];
            if (link && link.idea_id === ideaId && link.contribution_id === '') {
              this.sourceLinks.splice(index, 1);
            }
          }
        },
      });
    }
    if (sql.includes('FROM source_links l JOIN sources s')) {
      return new FakeStatement({
        all: ([ideaId]) => {
          const grouped = new Map<string, Record<string, unknown>>();
          for (const link of this.sourceLinks.filter((item) => item.idea_id === ideaId)) {
            const source = this.sources.find((item) => item.id === link.source_id);
            if (!source) continue;
            const existing = grouped.get(String(source.id)) || {
              ...source,
              sections: [] as string[],
              contribution_citations: 1,
            };
            if (link.section) (existing.sections as string[]).push(String(link.section));
            if (link.contribution_id) {
              existing.contribution_citations = Number(existing.contribution_citations) + 1;
            }
            grouped.set(String(source.id), existing);
          }
          return {
            results: [...grouped.values()].map((row) => ({
              ...row,
              sections: (row.sections as string[]).join(','),
            })),
          };
        },
      });
    }
    if (sql.includes('INSERT INTO idea_revisions')) {
      const columns = (sql.match(/\(([^)]*)\)\s*VALUES/)?.[1] || '')
        .split(',')
        .map((column) => column.trim())
        .filter(Boolean);
      return new FakeStatement({
        run: (binds) => {
          const row: Record<string, unknown> = {};
          columns.forEach((column, index) => {
            row[column] = binds[index];
          });
          // Newest first, and ordering must be stable within a test run.
          this.revisions.unshift({ created_at: `2026-06-12 00:00:${String(this.revisions.length).padStart(2, '0')}`, ...row });
        },
      });
    }
    if (sql.includes('FROM idea_revisions r')) {
      return new FakeStatement({
        all: ([ideaId, limit]) => ({
          results: this.revisions
            .filter((revision) => revision.idea_id === ideaId)
            .slice(0, Number(limit || 50))
            .map((revision) => ({ ...revision, handle: 'serge-the-dev', display_name: 'Serge The Dev' })),
        }),
      });
    }
    if (sql.includes('FROM idea_revisions WHERE id = ?')) {
      return new FakeStatement({
        first: ([revisionId, ideaId]) =>
          this.revisions.find((revision) => revision.id === revisionId && revision.idea_id === ideaId) ?? null,
      });
    }
    if (sql.includes('INSERT INTO ideas')) {
      // Map binds by the statement's own column list. createIdea and deriveIdea
      // insert different column sets, so fixed positional destructuring silently
      // mis-assigns as soon as either statement changes.
      const columns = (sql.match(/\(([^)]*)\)\s*VALUES/)?.[1] || '')
        .split(',')
        .map((column) => column.trim())
        .filter(Boolean);
      return new FakeStatement({
        run: (binds) => {
          this.inserts.push(binds);
          const row: Record<string, unknown> = {};
          columns.forEach((column, index) => {
            row[column] = binds[index];
          });
          this.ideas.set(String(row.id), {
            parent_id: '',
            body_words: 0,
            chapter_count: 0,
            status: 'active',
            pro_candidate: 0,
            created_at: '2026-06-10 00:00:00',
            updated_at: '2026-06-10 00:00:00',
            support: 0,
            trash: 0,
            pivot: 0,
            contribution_count: 0,
            ...row,
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
    // Section writes update only the body columns (writeCanonicalBody).
    if (sql.includes('UPDATE ideas') && sql.includes('SET body_md = ?')) {
      return new FakeStatement({
        run: ([body_md, body_key, render_key, body_words, chapter_count, id]) => {
          const idea = this.ideas.get(String(id));
          if (!idea) return;
          Object.assign(idea, {
            body_md,
            body_key,
            render_key,
            body_words,
            chapter_count,
            updated_at: '2026-06-11 02:00:00',
          });
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
            body_words,
            chapter_count,
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
            body_words,
            chapter_count,
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
    // Matched on the FROM clause, not the select list: the column list grows
    // (migration 0012 added the typed research fields) and an exact-prefix match
    // silently stops matching, which reads as "no contributions" rather than a
    // broken fake.
    // The refinement queue query shares this FROM clause, so exclude it here or
    // the broader branch wins on order and drops the kind/status filters.
    if (sql.includes('FROM contributions c JOIN profiles p') && !sql.includes('c.kind = ?')) {
      return new FakeStatement({
        all: ([ideaId, limit, offset]) => ({
          results: this.contributions
            .filter((item) => item.idea_id === ideaId)
            // Mirrors the researchOnly filter, so the pager pages what it counts.
            .filter((item) => (sql.includes("c.kind != 'comment'") ? item.kind !== 'comment' : true))
            // Mirrors LIMIT ? OFFSET ? so paging is actually exercised.
            .slice(
              sql.includes('LIMIT ?') ? Number(offset || 0) : 0,
              sql.includes('LIMIT ?') ? Number(offset || 0) + Number(limit || 0) : undefined,
            )
            .map((item) => {
              const profile = this.profiles.get(String(item.profile_id)) || {};
              return {
                id: item.id,
                kind: item.kind,
                body: item.body,
                created_at: item.created_at,
                claim: item.claim || '',
                source_url: item.source_url || '',
                accessed_at: item.accessed_at || '',
                provenance: item.provenance || '',
                confidence: item.confidence || '',
                supersedes: item.supersedes || '',
                // Mirrors the correlated subquery in data.ts.
                superseded_by:
                  this.contributions.find((other) => other.supersedes === item.id)?.id ?? null,
                handle: profile.handle || 'guest',
                display_name: profile.display_name || profile.handle || 'Guest',
              };
            }),
        }),
      });
    }
    if (sql.includes('FROM contributions c JOIN profiles p') && sql.includes('c.kind = ?')) {
      return new FakeStatement({
        all: ([ideaId, kind]) => ({
          results: this.contributions
            .filter((item) => item.idea_id === ideaId && item.kind === kind)
            .filter((item) => {
              if (sql.includes("AND c.status = ''")) return !item.status;
              if (sql.includes("AND c.status != ''")) return Boolean(item.status);
              return true;
            })
            .map((item) => {
              const profile = this.profiles.get(String(item.profile_id)) || {};
              return {
                ...item,
                section: item.section || '',
                status: item.status || '',
                resolution: item.resolution || '',
                resolved_revision: item.resolved_revision || '',
                handle: profile.handle || 'guest',
                display_name: profile.display_name || profile.handle || 'Guest',
              };
            }),
        }),
      });
    }
    if (sql.includes('SELECT COUNT(*) AS n FROM contributions') && !sql.includes('kind = ?')) {
      return new FakeStatement({
        first: ([ideaId]) => ({
          n: this.contributions.filter(
            (item) =>
              item.idea_id === ideaId &&
              (sql.includes("kind != 'comment'") ? item.kind !== 'comment' : true),
          ).length,
        }),
      });
    }
    if (sql.includes('SELECT COUNT(*) AS n FROM contributions') && sql.includes('kind = ?')) {
      return new FakeStatement({
        first: ([ideaId, kind]) => ({
          n: this.contributions.filter(
            (item) => item.idea_id === ideaId && item.kind === kind && !item.status,
          ).length,
        }),
      });
    }
    if (sql.includes('FROM contributions WHERE id = ? AND idea_id = ? AND kind = ?')) {
      return new FakeStatement({
        first: ([contributionId, ideaId, kind]) => {
          const found = this.contributions.find(
            (item) => item.id === contributionId && item.idea_id === ideaId && item.kind === kind,
          );
          return found ? { ...found, section: found.section || '', status: found.status || '' } : null;
        },
      });
    }
    if (sql.includes('UPDATE contributions') && sql.includes('SET status = ?')) {
      return new FakeStatement({
        run: ([status, resolution, revisionId, contributionId]) => {
          const found = this.contributions.find((item) => item.id === contributionId);
          if (found) Object.assign(found, { status, resolution, resolved_revision: revisionId });
        },
      });
    }
    if (sql.includes('INSERT INTO contributions')) {
      const columns = (sql.match(/\(([^)]*)\)\s*VALUES/)?.[1] || '')
        .split(',')
        .map((column) => column.trim())
        .filter(Boolean);
      return new FakeStatement({
        run: (binds) => {
          const row: Record<string, unknown> = {};
          columns.forEach((column, index) => {
            row[column] = binds[index];
          });
          this.contributions.unshift({
            created_at: `2026-06-12 01:00:${String(this.contributions.length).padStart(2, '0')}`,
            ...row,
          });
          const idea = this.ideas.get(String(row.idea_id));
          if (idea) idea.contribution_count = Number(idea.contribution_count || 0) + 1;
        },
      });
    }
    if (sql.includes('SELECT id FROM contributions WHERE id = ?')) {
      return new FakeStatement({
        first: ([contributionId, ideaId]) => {
          const found = this.contributions.find(
            (item) => item.id === contributionId && item.idea_id === ideaId,
          );
          return found ? { id: found.id } : null;
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

/** Minimal R2 stand-in. `failWrites` exercises the inline fallback. */
class FakeR2 {
  objects = new Map<string, string>();
  deleted: string[] = [];

  constructor(private readonly failWrites = false) {}

  put(key: string, value: string) {
    if (this.failWrites) return Promise.reject(new Error('r2 unavailable'));
    this.objects.set(key, value);
    return Promise.resolve({ key });
  }

  get(key: string) {
    const value = this.objects.get(key);
    return Promise.resolve(value === undefined ? null : { text: () => Promise.resolve(value) });
  }

  delete(key: string) {
    this.deleted.push(key);
    this.objects.delete(key);
    return Promise.resolve();
  }
}

function env(
  db = new FakeD1(),
  assetResponse = new Response('asset fallback', { status: 404 }),
  bucket?: FakeR2,
) {
  return {
    DB: db,
    ASSETS: { fetch: () => Promise.resolve(assetResponse.clone()) },
    ...(bucket ? { IDEA_BUCKET: bucket } : {}),
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
    expect(html).toContain('theme-toggle');
    expect(html).toContain('data-theme');
    // This fixture is paginated, so the index links its chapters instead of
    // inlining them. Re-rendering the whole body here duplicated every chapter
    // on the index and made the page grow without bound with the document.
    expect(html).toContain('href="/ideas/asx-filings-analyst/design-sketch/"');
    expect(html).not.toContain('<h2 id="design-sketch">Design Sketch</h2>');
    expect(html).not.toContain('<li>Review filings.</li>');
    expect(html).toContain('<strong>Reactions</strong>');
    expect(html).toContain('data-reaction="support"');
    expect(html).toContain('data-reaction="trash"');
    expect(html).toContain('data-reaction="pivot"');
    expect(html).toContain('<section class="comments" id="comments"');
    expect(html).toContain('Post comment');
    expect(html).toContain('const ideaId = "asx-filings-analyst"');
    expect(html).toContain('/contributions');
  });

  it('renders chapter summaries when a paginated document has no lead-in to inline', async () => {
    // This fixture opens on `## Snapshot`, exactly like defaultIdeaBody() and
    // the canonical spine, so its lead-in is EMPTY — which is the normal case,
    // not an edge case. Left at that the landing page carried a summary line, a
    // diagram and a list of bare chapter titles, and not one sentence of the
    // document: nothing to read and nothing for a crawler to index.
    const response = await worker.fetch(new Request('https://fis.test/ideas/asx-filings-analyst/'), env());
    const html = await response.text();

    expect(html).toContain('<div class="chapter-body">');
    expect(html).toContain('This idea is published as 3 chapters.');
    expect(html).toContain('class="chapter-summaries"');
    // Each chapter's excerpt as visible prose, linked to the chapter page.
    expect(html).toContain(
      '<li><a href="/ideas/asx-filings-analyst/design-sketch/">Design Sketch</a> &mdash; Review filings. Cite sources.',
    );
    expect(html).toContain('Accidental financial advice.');
    // Prose, but still not the chapters themselves.
    expect(html).not.toContain('<h2 id="design-sketch">Design Sketch</h2>');
  });

  it('does not inline a `#`-headed chapter that also has its own chapter page', async () => {
    // A lead-in derived from `body.split(/^## /m)` keeps everything before the
    // first `##`, but sectionRanges() — which decides what gets a chapter URL —
    // treats a `#` heading as a chapter. So this chapter was rendered inline on
    // the index AND served at its own URL: the exact duplication chapter
    // pagination exists to remove. The lead-in comes from the same parser now.
    mockSignedInSerge();
    const testEnv = env();
    const update = await worker.fetch(
      new Request('https://fis.test/api/ideas/serge-idea-lab', {
        method: 'PATCH',
        headers: { Authorization: 'Bearer fas-session-token', 'content-type': 'application/json' },
        body: JSON.stringify({
          body: [
            '# Opening Chapter',
            filler(55),
            '',
            '## Second Chapter',
            filler(55),
            '',
            '## Third Chapter',
            filler(55),
          ].join('\n'),
        }),
      }),
      testEnv,
    );
    const page = await worker.fetch(new Request('https://fis.test/ideas/serge-idea-lab/'), testEnv);
    const html = await page.text();

    expect(update.status).toBe(200);
    expect(page.status).toBe(200);
    // It is a chapter: linked, with a page of its own.
    expect(html).toContain('href="/ideas/serge-idea-lab/opening-chapter/"');
    // And therefore NOT also inlined here.
    expect(html).not.toContain('<h2 id="opening-chapter">Opening Chapter</h2>');
    // With no lead-in left over, the index falls back to chapter summaries.
    expect(html).toContain('This idea is published as 3 chapters.');
  });

  it('renders non-comment contributions as a server-side research section', async () => {
    const response = await worker.fetch(new Request('https://fis.test/ideas/asx-filings-analyst/'), env());
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(html).toContain('<section class="research" id="research">');
    expect(html).toContain('Research &amp; evidence');
    expect(html).toContain('<span class="research-kind">evidence</span>');
    expect(html).toContain('Seed evidence note.');
    // The comment stays in the comment thread and is not duplicated into research.
    expect(html).not.toContain('<span class="research-kind">comment</span>');
    const researchOnly = html.slice(html.indexOf('id="research"'), html.indexOf('class="comments"'));
    expect(researchOnly).not.toContain('needs strong disclaimers');
  });

  it('counts research entries and comments separately in the signals rail', async () => {
    const response = await worker.fetch(new Request('https://fis.test/ideas/asx-filings-analyst/'), env());
    const html = await response.text();

    expect(html).toContain('<a href="#research">1 research entry</a>');
    expect(html).toContain('<a href="#comments">1 comment</a>');
    // The old label promised risks and evidence links the page never rendered.
    expect(html).not.toContain('notes, critiques, risks, or evidence links');
  });

  it('orders research entries oldest-first within a kind, and groups by kind', () => {
    // Rows arrive newest-first from D1; the section must reverse them per group
    // because the log reads forward and entries reference earlier ones.
    const rows = [
      { id: 'c3', kind: 'evidence', body: 'Newest evidence marker.', created_at: '2026-06-20 03:00:00', handle: 'a', display_name: 'A' },
      { id: 'c2', kind: 'risk', body: 'A risk.', created_at: '2026-06-10 03:00:00', handle: 'a', display_name: 'A' },
      { id: 'c1', kind: 'evidence', body: 'Oldest evidence marker.', created_at: '2026-06-01 03:00:00', handle: 'a', display_name: 'A' },
      { id: 'c0', kind: 'comment', body: 'Just chatter.', created_at: '2026-06-05 03:00:00', handle: 'a', display_name: 'A' },
    ];

    const html = researchSection(rows, 'demo-idea');

    expect(html.indexOf('Oldest evidence marker.')).toBeLessThan(html.indexOf('Newest evidence marker.'));
    // Evidence group precedes the risk group, per the fixed kind order.
    expect(html.indexOf('Newest evidence marker.')).toBeLessThan(html.indexOf('A risk.'));
    // Comments never appear in the research section.
    expect(html).not.toContain('Just chatter.');
    expect(html).toContain('3 recorded entries');
  });

  it('pages a long research record rather than hiding the remainder', () => {
    const page = Array.from({ length: RESEARCH_PAGE_SIZE }, (_, i) => ({
      id: `c${i}`,
      kind: 'evidence',
      body: `Entry ${i}.`,
      created_at: `2026-06-${String((i % 28) + 1).padStart(2, '0')} 03:00:00`,
      handle: 'a',
      display_name: 'A',
    }));

    const html = researchSection(page, 'demo-idea', {
      page: 2,
      pageSize: RESEARCH_PAGE_SIZE,
      total: 42,
      showAll: false,
    });

    // Says what it is showing rather than implying completeness...
    expect(html).toContain(`Showing ${RESEARCH_PAGE_SIZE} of 42 entries`);
    // ...and every page is a real, linkable URL.
    expect(html).toContain('?research=1#research');
    expect(html).toContain('?research=3#research');
    expect(html).toContain('?research=all#research');
    expect(html).toContain('Page 2 of 3');
  });

  it('offers a way back from the unpaged view', () => {
    const html = researchSection(
      [{ id: 'c1', kind: 'evidence', body: 'One.', created_at: '2026-06-01 03:00:00', handle: 'a', display_name: 'A' }],
      'demo-idea',
      { page: 1, pageSize: RESEARCH_PAGE_SIZE, total: 42, showAll: true },
    );

    expect(html).toContain('showing all 42 entries');
    expect(html).toContain('Back to paged view');
  });

  it('omits the pager when the whole record fits on one page', () => {
    const html = researchSection(
      [{ id: 'c1', kind: 'evidence', body: 'One.', created_at: '2026-06-01 03:00:00', handle: 'a', display_name: 'A' }],
      'demo-idea',
      { page: 1, pageSize: RESEARCH_PAGE_SIZE, total: 1, showAll: false },
    );

    expect(html).not.toContain('research-pager');
    expect(html).toContain('1 recorded entry');
  });

  it('opens a research entry targeted by the URL fragment', async () => {
    const html = await (await worker.fetch(new Request('https://fis.test/ideas/asx-filings-analyst/'), env())).text();

    // Each entry is individually addressable, and the script must open a
    // collapsed <details> the fragment points at — otherwise the link looks broken.
    expect(html).toContain('id="contribution-contribution-evidence-1"');
    expect(html).toContain('openTargetedResearch');
    expect(html).toContain("addEventListener('hashchange'");
  });

  it('omits the research section from an idea with no research contributions', async () => {
    const response = await worker.fetch(new Request('https://fis.test/ideas/serge-idea-lab/'), env());
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(html).not.toContain('id="research"');
    expect(html).toContain('No research entries yet');
  });

  it('links from dynamic idea pages to Worker-rendered book chapters', async () => {
    const response = await worker.fetch(new Request('https://fis.test/ideas/asx-filings-analyst/'), env());
    const html = await response.text();

    expect(response.status).toBe(200);
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
          // Long enough to earn chapter pages, so this still asserts on chapter URLs.
          body: [
            '# MCP Book Idea',
            '',
            'Stage: raw',
            'Category: platform',
            '',
            '## Snapshot',
            'This is the first real chapter.',
            filler(55),
            '',
            '## Research',
            'This is the second chapter.',
            filler(55),
            '',
            '## Risk',
            'This is the third chapter.',
            filler(55),
          ].join('\n'),
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
    expect(chapterHtml).toContain('Chapter 1 of 3');
  });

  it('stores a new idea body in R2 and reads it back for rendering', async () => {
    const bucket = new FakeR2();
    const testEnv = env(new FakeD1(), undefined, bucket);
    const create = await worker.fetch(
      new Request('https://fis.test/api/ideas', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-idea-handle': 'tester' },
        body: JSON.stringify({
          title: 'R2 Backed Idea',
          summary: 'Body should be written to the bucket, not the D1 column.',
          body: '## Snapshot\nStored in the bucket.',
        }),
      }),
      testEnv,
    );

    expect(create.status).toBe(201);
    expect(bucket.objects.get('ideas/r2-backed-idea/body.md')).toContain('Stored in the bucket.');

    // The page renders from R2, not from body_md.
    const page = await worker.fetch(new Request('https://fis.test/ideas/r2-backed-idea/'), testEnv);
    expect(await page.text()).toContain('Stored in the bucket.');
  });

  it('falls back to inline storage when the R2 write fails', async () => {
    const bucket = new FakeR2(true);
    const testEnv = env(new FakeD1(), undefined, bucket);
    const create = await worker.fetch(
      new Request('https://fis.test/api/ideas', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-idea-handle': 'tester' },
        body: JSON.stringify({
          title: 'Fallback Idea',
          summary: 'A failed bucket write must not lose the document.',
          body: '## Snapshot\nKept inline after the bucket write failed.',
        }),
      }),
      testEnv,
    );

    expect(create.status).toBe(201);
    expect(bucket.objects.size).toBe(0);
    const page = await worker.fetch(new Request('https://fis.test/ideas/fallback-idea/'), testEnv);
    expect(await page.text()).toContain('Kept inline after the bucket write failed.');
  });

  it('accepts a document far larger than the old 24k D1 ceiling', async () => {
    const bucket = new FakeR2();
    const testEnv = env(new FakeD1(), undefined, bucket);
    // ~40k chars: rejected outright before bodies moved to R2.
    const body = ['## Snapshot', filler(150), '', '## Research', filler(150), '', '## Risk', filler(150)].join('\n');
    expect(body.length).toBeGreaterThan(24000);

    const create = await worker.fetch(
      new Request('https://fis.test/api/ideas', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-idea-handle': 'tester' },
        body: JSON.stringify({ title: 'Deep Idea', summary: 'A genuinely deep research document.', body }),
      }),
      testEnv,
    );

    expect(create.status).toBe(201);
    expect(bucket.objects.get('ideas/deep-idea/body.md')?.length).toBe(body.length);

    // Deep enough to earn chapter pages, and the catalog agrees.
    const chapter = await worker.fetch(new Request('https://fis.test/ideas/deep-idea/research/'), testEnv);
    expect(chapter.status).toBe(200);
    const list = await worker.fetch(new Request('https://fis.test/api/ideas'), testEnv);
    const data = (await list.json()) as { ideas: Array<{ id: string; has_publication: number }> };
    expect(data.ideas.find((idea) => idea.id === 'deep-idea')?.has_publication).toBe(1);
  });

  /**
   * #33: a document could outgrow its own metadata. `publish_idea_update` was
   * the only writer of summary, stage, category and the rest, and it demanded
   * the whole body with them — so once a document was too large to resend, the
   * sentence describing it on the catalog card was frozen, wrong or not.
   */
  describe('metadata-only updates', () => {
    const DOCUMENT = ['## Snapshot', filler(60), '', '## Risk', filler(60)].join('\n');
    const headers = { Authorization: 'Bearer fis-session-token', 'content-type': 'application/json' };

    async function seeded() {
      mockSignedInSerge();
      const bucket = new FakeR2();
      const testEnv = env(new FakeD1(), undefined, bucket);
      await worker.fetch(
        new Request('https://fis.test/api/ideas/serge-idea-lab', {
          method: 'PATCH',
          headers,
          body: JSON.stringify({
            body: DOCUMENT,
            summary: 'Full measurements now live in four linked research annexes.',
          }),
        }),
        testEnv,
      );
      return { bucket, testEnv };
    }

    async function readIdea(testEnv: ReturnType<typeof env>) {
      const response = await worker.fetch(new Request('https://fis.test/api/ideas/serge-idea-lab'), testEnv);
      return (await response.json()) as {
        idea: Record<string, unknown>;
        body: string;
      };
    }

    it('leaves the document byte-identical when body is omitted', async () => {
      const { bucket, testEnv } = await seeded();
      const revisionsBefore = testEnv.DB.revisions.length;
      const bucketDeletesBefore = bucket.deleted.length;

      const response = await worker.fetch(
        new Request('https://fis.test/api/ideas/serge-idea-lab', {
          method: 'PATCH',
          headers,
          body: JSON.stringify({
            summary: 'The annexes were folded back into this document.',
            stage: 'validating',
            category: 'research',
          }),
        }),
        testEnv,
      );
      const after = await readIdea(testEnv);

      expect(response.status).toBe(200);
      // The whole point: the sentence on the catalog card is correctable.
      expect(after.idea.summary).toBe('The annexes were folded back into this document.');
      expect(after.idea.stage).toBe('validating');
      expect(after.idea.category).toBe('research');
      // And the document is untouched — not re-uploaded, not re-derived, not
      // re-measured, and not worth a revision of its own.
      expect(after.body).toBe(DOCUMENT);
      expect(bucket.objects.get('ideas/serge-idea-lab/body.md')).toBe(DOCUMENT);
      expect(after.idea.body_key).toBe('ideas/serge-idea-lab/body.md');
      expect(testEnv.DB.revisions).toHaveLength(revisionsBefore);
      // Object storage is not touched at all — the body is not re-uploaded and
      // the rendered cache behind it is not invalidated for a metadata edit.
      expect(bucket.deleted).toHaveLength(bucketDeletesBefore);
    });

    it('still replaces the document when body is sent alongside metadata', async () => {
      const { bucket, testEnv } = await seeded();
      const revisionsBefore = testEnv.DB.revisions.length;
      const rewritten = ['## Snapshot', filler(70), '', '## Risk', filler(70)].join('\n');

      const response = await worker.fetch(
        new Request('https://fis.test/api/ideas/serge-idea-lab', {
          method: 'PATCH',
          headers,
          body: JSON.stringify({ body: rewritten, summary: 'Rewritten in one call.' }),
        }),
        testEnv,
      );
      const after = await readIdea(testEnv);

      expect(response.status).toBe(200);
      expect(after.body).toBe(rewritten);
      expect(bucket.objects.get('ideas/serge-idea-lab/body.md')).toBe(rewritten);
      expect(after.idea.summary).toBe('Rewritten in one call.');
      // The replaced document is still recoverable.
      expect(testEnv.DB.revisions.length).toBe(revisionsBefore + 1);
    });

    it('does not overwrite a document with a placeholder when its object is missing', async () => {
      // `ideaBody` falls back to a generated stub when the R2 object cannot be
      // read. Writing that stub back because somebody edited a summary would
      // turn a retrievable outage into a destroyed document.
      const { bucket, testEnv } = await seeded();
      bucket.objects.clear();

      const response = await worker.fetch(
        new Request('https://fis.test/api/ideas/serge-idea-lab', {
          method: 'PATCH',
          headers,
          body: JSON.stringify({ summary: 'Editable even while the bucket is unhappy.' }),
        }),
        testEnv,
      );
      const after = await readIdea(testEnv);

      expect(response.status).toBe(200);
      expect(after.idea.summary).toBe('Editable even while the bucket is unhappy.');
      expect(bucket.objects.size).toBe(0);
      // The pointer to the real document survives, so restoring the object
      // restores the idea.
      expect(after.idea.body_key).toBe('ideas/serge-idea-lab/body.md');
      expect(after.idea.body_md).toBe('');
    });

    it('does not measure an untouched body against the body cap', async () => {
      // A document already past the cap must still be describable. Otherwise the
      // cap, whose job is to stop oversized writes, silently doubles as a
      // permanent ban on correcting the sentence that describes the document.
      const { bucket, testEnv } = await seeded();
      // Derived from the cap, never a literal. Pinned to 200_000 this fixture
      // stops being oversized the moment FIELD_LIMITS.body is raised — the
      // tiered-limits branch takes it to 1,000,000 — and the test would then
      // pass for the wrong reason while the guard it exists to prove was gone.
      const chunk = 'over the cap ';
      const oversized = `${DOCUMENT}\n\n${chunk.repeat(Math.ceil(FIELD_LIMITS.body / chunk.length) + 1)}`;
      expect(oversized.length).toBeGreaterThan(FIELD_LIMITS.body);
      bucket.objects.set('ideas/serge-idea-lab/body.md', oversized);

      const response = await worker.fetch(
        new Request('https://fis.test/api/ideas/serge-idea-lab', {
          method: 'PATCH',
          headers,
          body: JSON.stringify({ summary: 'Short field, enormous document.' }),
        }),
        testEnv,
      );
      const after = await readIdea(testEnv);

      expect(response.status).toBe(200);
      expect(after.idea.summary).toBe('Short field, enormous document.');
      expect(after.body).toBe(oversized);
    });
  });

  it('lists and reads sections without returning the whole document', async () => {
    const testEnv = env();
    const list = await worker.fetch(new Request('https://fis.test/api/ideas/asx-filings-analyst/sections'), testEnv);
    const listed = (await list.json()) as { sections: Array<{ id: string; title: string; words: number }> };

    expect(list.status).toBe(200);
    expect(listed.sections.map((section) => section.id)).toEqual(['snapshot', 'design-sketch', 'risk']);

    const read = await worker.fetch(
      new Request('https://fis.test/api/ideas/asx-filings-analyst/sections/risk'),
      testEnv,
    );
    const section = (await read.json()) as { markdown: string };

    expect(read.status).toBe(200);
    expect(section.markdown).toContain('Accidental financial advice.');
    // The point of the endpoint: other sections are not in the payload.
    expect(section.markdown).not.toContain('Public reports and filings.');
  });

  it('patches one section and leaves the rest of the document intact', async () => {
    mockSignedInSerge();
    const testEnv = env();
    const patch = await worker.fetch(
      new Request('https://fis.test/api/ideas/serge-idea-lab/sections/snapshot', {
        method: 'PUT',
        headers: { Authorization: 'Bearer fas-session-token', 'content-type': 'application/json' },
        body: JSON.stringify({ content: 'Rewritten snapshot only.' }),
      }),
      testEnv,
    );
    const read = await worker.fetch(new Request('https://fis.test/api/ideas/serge-idea-lab'), testEnv);
    const data = (await read.json()) as { body: string };

    expect(patch.status).toBe(200);
    await expect(patch.json()).resolves.toMatchObject({ ok: true, section: 'snapshot', mode: 'replace' });
    expect(data.body).toContain('Rewritten snapshot only.');
    expect(data.body).not.toContain('Owned by the signed-in account.');
  });

  it('appends to a section, which is how research should accumulate', async () => {
    mockSignedInSerge();
    const testEnv = env();
    const append = await worker.fetch(
      new Request('https://fis.test/api/ideas/serge-idea-lab/sections/snapshot', {
        method: 'POST',
        headers: { Authorization: 'Bearer fas-session-token', 'content-type': 'application/json' },
        body: JSON.stringify({ content: 'A later finding, appended.' }),
      }),
      testEnv,
    );
    const read = await worker.fetch(new Request('https://fis.test/api/ideas/serge-idea-lab'), testEnv);
    const data = (await read.json()) as { body: string };

    expect(append.status).toBe(200);
    // Both the original content and the addition survive.
    expect(data.body).toContain('Owned by the signed-in account.');
    expect(data.body).toContain('A later finding, appended.');
  });

  it('refuses a section write from someone who does not own the idea', async () => {
    mockSignedInSerge();
    const response = await worker.fetch(
      // asx-filings-analyst is owned by profile-system, not the signed-in user.
      new Request('https://fis.test/api/ideas/asx-filings-analyst/sections/risk', {
        method: 'PUT',
        headers: { Authorization: 'Bearer fas-session-token', 'content-type': 'application/json' },
        body: JSON.stringify({ content: 'Should not be written.' }),
      }),
      env(),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: 'only the idea owner can update the canonical document',
    });
  });

  it('rejects a write to an unknown section and points at the section list', async () => {
    mockSignedInSerge();
    const response = await worker.fetch(
      new Request('https://fis.test/api/ideas/serge-idea-lab/sections/not-a-section', {
        method: 'PUT',
        headers: { Authorization: 'Bearer fas-session-token', 'content-type': 'application/json' },
        body: JSON.stringify({ content: 'Nowhere to put this.' }),
      }),
      env(),
    );

    expect(response.status).toBe(404);
    const data = (await response.json()) as { error: string };
    expect(data.error).toContain('unknown section "not-a-section"');
    expect(data.error).toContain('/sections');
  });

  async function proposeRefinement(testEnv: ReturnType<typeof env>, ideaId: string, section: string) {
    const create = await worker.fetch(
      new Request(`https://fis.test/api/ideas/${ideaId}/contributions`, {
        method: 'POST',
        headers: { Authorization: 'Bearer fas-session-token', 'content-type': 'application/json' },
        body: JSON.stringify({
          kind: 'refinement',
          section,
          body: `Section: ${section}\n\nProposal:\nSharpen the wording here.\n\nRationale:\nIt reads vaguely.`,
        }),
      }),
      testEnv,
    );
    expect(create.status).toBe(201);
    const list = await worker.fetch(new Request(`https://fis.test/api/ideas/${ideaId}/refinements`), testEnv);
    const data = (await list.json()) as { refinements: Array<{ id: string; section: string; proposal: string }> };
    return data.refinements[0];
  }

  it('adds a section the document does not have yet', async () => {
    mockSignedInSerge();
    const testEnv = env();
    const add = await worker.fetch(
      new Request('https://fis.test/api/ideas/serge-idea-lab/sections', {
        method: 'POST',
        headers: { Authorization: 'Bearer fas-session-token', 'content-type': 'application/json' },
        body: JSON.stringify({ title: 'Validation', content: 'The cheapest test.' }),
      }),
      testEnv,
    );
    const data = (await add.json()) as { sections: Array<{ id: string }>; revision: string | null };
    const read = await worker.fetch(new Request('https://fis.test/api/ideas/serge-idea-lab'), testEnv);

    expect(add.status).toBe(200);
    expect(data.sections.map((section) => section.id)).toEqual(['snapshot', 'validation']);
    // A structural edit is a canonical write, so it is recoverable.
    expect(data.revision).toBeTruthy();
    expect((await read.json() as { body: string }).body).toContain('## Validation');
  });

  it('renames and moves a section in one call', async () => {
    mockSignedInSerge();
    const testEnv = env();
    const headers = { Authorization: 'Bearer fas-session-token', 'content-type': 'application/json' };
    await worker.fetch(
      new Request('https://fis.test/api/ideas/serge-idea-lab/sections', {
        method: 'POST',
        headers,
        body: JSON.stringify({ title: 'Risk', content: 'The main risk.' }),
      }),
      testEnv,
    );
    const edit = await worker.fetch(
      new Request('https://fis.test/api/ideas/serge-idea-lab/sections/risk', {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ title: 'Risks and constraints', before: 'snapshot' }),
      }),
      testEnv,
    );
    const data = (await edit.json()) as { sections: Array<{ id: string }> };

    expect(edit.status).toBe(200);
    // Renamed (so the id moved) and reordered in the same write.
    expect(data.sections.map((section) => section.id)).toEqual(['risks-and-constraints', 'snapshot']);
  });

  it('merges a thin section into another and removes the source', async () => {
    mockSignedInSerge();
    const testEnv = env();
    const headers = { Authorization: 'Bearer fas-session-token', 'content-type': 'application/json' };
    await worker.fetch(
      new Request('https://fis.test/api/ideas/serge-idea-lab/sections', {
        method: 'POST',
        headers,
        body: JSON.stringify({ title: 'Thin', content: 'A short thought.' }),
      }),
      testEnv,
    );
    const merge = await worker.fetch(
      new Request('https://fis.test/api/ideas/serge-idea-lab/sections/thin/merge', {
        method: 'POST',
        headers,
        body: JSON.stringify({ into: 'snapshot' }),
      }),
      testEnv,
    );
    const body = (await (await worker.fetch(new Request('https://fis.test/api/ideas/serge-idea-lab'), testEnv)).json()) as { body: string };

    expect(merge.status).toBe(200);
    expect((await merge.json() as { sections: Array<{ id: string }> }).sections.map((s) => s.id)).toEqual(['snapshot']);
    // Content survives the merge; only the heading goes.
    expect(body.body).toContain('A short thought.');
    expect(body.body).toContain('Owned by the signed-in account.');
    expect(body.body).not.toContain('## Thin');
  });

  it('deletes a section', async () => {
    mockSignedInSerge();
    const testEnv = env();
    const headers = { Authorization: 'Bearer fas-session-token', 'content-type': 'application/json' };
    await worker.fetch(
      new Request('https://fis.test/api/ideas/serge-idea-lab/sections', {
        method: 'POST',
        headers,
        body: JSON.stringify({ title: 'Scratch', content: 'Temporary.' }),
      }),
      testEnv,
    );
    const remove = await worker.fetch(
      new Request('https://fis.test/api/ideas/serge-idea-lab/sections/scratch', { method: 'DELETE', headers, body: '{}' }),
      testEnv,
    );

    expect(remove.status).toBe(200);
    expect((await remove.json() as { sections: Array<{ id: string }> }).sections.map((s) => s.id)).toEqual(['snapshot']);
  });

  it('404s a structural edit that references a section that is not there', async () => {
    mockSignedInSerge();
    const headers = { Authorization: 'Bearer fas-session-token', 'content-type': 'application/json' };
    const response = await worker.fetch(
      new Request('https://fis.test/api/ideas/serge-idea-lab/sections', {
        method: 'POST',
        headers,
        body: JSON.stringify({ title: 'X', content: 'y', after: 'not-a-section' }),
      }),
      env(),
    );

    expect(response.status).toBe(404);
    expect((await response.json() as { error: string }).error).toContain('/sections');
  });

  it('refuses a structural edit from someone who does not own the idea', async () => {
    mockSignedInSerge();
    const response = await worker.fetch(
      new Request('https://fis.test/api/ideas/asx-filings-analyst/sections', {
        method: 'POST',
        headers: { Authorization: 'Bearer fas-session-token', 'content-type': 'application/json' },
        body: JSON.stringify({ title: 'X', content: 'y' }),
      }),
      env(),
    );

    expect(response.status).toBe(403);
  });

  it('serves a requested page of the research record', async () => {
    mockSignedInSerge();
    const testEnv = env();
    const headers = { Authorization: 'Bearer fas-session-token', 'content-type': 'application/json' };
    // Enough entries to need a second page.
    for (let index = 0; index < RESEARCH_PAGE_SIZE + 3; index += 1) {
      await worker.fetch(
        new Request('https://fis.test/api/ideas/serge-idea-lab/contributions', {
          method: 'POST',
          headers,
          body: JSON.stringify({ kind: 'evidence', body: `Paged entry ${index}.` }),
        }),
        testEnv,
      );
    }

    const first = await (await worker.fetch(new Request('https://fis.test/ideas/serge-idea-lab/'), testEnv)).text();
    const second = await (
      await worker.fetch(new Request('https://fis.test/ideas/serge-idea-lab/?research=2'), testEnv)
    ).text();

    expect(first).toContain(`Showing ${RESEARCH_PAGE_SIZE} of ${RESEARCH_PAGE_SIZE + 3} entries`);
    expect(first).toContain('?research=2#research');
    expect(second).toContain('Page 2 of 2');
    // The two pages show different entries, so paging actually pages.
    expect(first).not.toEqual(second);
  });

  it('counts research and comments from the whole record, not the current page', async () => {
    mockSignedInSerge();
    const testEnv = env();
    const headers = { Authorization: 'Bearer fas-session-token', 'content-type': 'application/json' };
    // More research than one page holds, plus comments that must not be paged in.
    for (let index = 0; index < RESEARCH_PAGE_SIZE + 2; index += 1) {
      await worker.fetch(
        new Request('https://fis.test/api/ideas/serge-idea-lab/contributions', {
          method: 'POST',
          headers,
          body: JSON.stringify({ kind: 'evidence', body: `Counted entry ${index}.` }),
        }),
        testEnv,
      );
    }
    await worker.fetch(
      new Request('https://fis.test/api/ideas/serge-idea-lab/contributions', {
        method: 'POST',
        headers,
        body: JSON.stringify({ kind: 'comment', body: 'A comment, not research.' }),
      }),
      testEnv,
    );

    const html = await (await worker.fetch(new Request('https://fis.test/ideas/serge-idea-lab/'), testEnv)).text();

    // The pager compares like with like: research shown vs research total.
    expect(html).toContain(`Showing ${RESEARCH_PAGE_SIZE} of ${RESEARCH_PAGE_SIZE + 2} entries`);
    // Rail counts come from the whole record, so they do not shift per page.
    expect(html).toContain(`${RESEARCH_PAGE_SIZE + 2} research entries`);
    expect(html).toContain('1 comment');
    // The comment is not rendered as a research entry.
    expect(html).not.toContain('A comment, not research.');
  });

  it('pages the contributions API on request but stays unpaged by default', async () => {
    mockSignedInSerge();
    const testEnv = env();
    const headers = { Authorization: 'Bearer fas-session-token', 'content-type': 'application/json' };
    for (let index = 0; index < 5; index += 1) {
      await worker.fetch(
        new Request('https://fis.test/api/ideas/serge-idea-lab/contributions', {
          method: 'POST',
          headers,
          body: JSON.stringify({ kind: 'evidence', body: `API entry ${index}.` }),
        }),
        testEnv,
      );
    }

    const paged = await worker.fetch(
      new Request('https://fis.test/api/ideas/serge-idea-lab/contributions?limit=2&offset=2'),
      testEnv,
    );
    const data = (await paged.json()) as { contributions: unknown[]; total: number; limit: number; offset: number };
    const unpaged = await worker.fetch(
      new Request('https://fis.test/api/ideas/serge-idea-lab/contributions'),
      testEnv,
    );
    const all = (await unpaged.json()) as { contributions: unknown[]; total?: number };

    expect(data.contributions).toHaveLength(2);
    expect(data).toMatchObject({ total: 5, limit: 2, offset: 2 });
    // Existing callers get the whole set and no pager fields.
    expect(all.contributions).toHaveLength(5);
    expect(all.total).toBeUndefined();
  });

  it('recovers a deep link to an entry that is not on the current page', async () => {
    const html = await (await worker.fetch(new Request('https://fis.test/ideas/serge-idea-lab/'), env())).text();

    // Search links straight to #contribution-<id>; if that entry is on a later
    // page the anchor would be dead, so the page falls through to the full view.
    expect(html).toContain("hash.startsWith('#contribution-')");
    expect(html).toContain("url.searchParams.set('research', 'all')");
    // And it must not loop once already showing everything.
    expect(html).toContain("url.searchParams.get('research') === 'all'");
  });

  it('finds a claim across ideas and links to where it lives', async () => {
    mockSignedInSerge();
    const testEnv = env();
    await worker.fetch(
      new Request('https://fis.test/api/ideas/serge-idea-lab/contributions', {
        method: 'POST',
        headers: { Authorization: 'Bearer fas-session-token', 'content-type': 'application/json' },
        body: JSON.stringify({
          kind: 'evidence',
          claim: 'ETIM is free under Open Data Commons.',
          body: 'The taxonomy is an open standard with a public REST API.',
        }),
      }),
      testEnv,
    );
    const response = await worker.fetch(new Request('https://fis.test/api/search?q=etim'), testEnv);
    const data = (await response.json()) as {
      hits: Array<{ idea_id: string; kind: string; ref: string; title: string }>;
    };

    expect(response.status).toBe(200);
    expect(data.hits.length).toBeGreaterThan(0);
    expect(data.hits[0]).toMatchObject({ idea_id: 'serge-idea-lab', kind: 'research' });
    // The hit is addressable, so a result can be navigated to.
    expect(data.hits[0]?.ref).toBeTruthy();
  });

  it('indexes document sections, and drops them when the document changes', async () => {
    mockSignedInSerge();
    const testEnv = env();
    const headers = { Authorization: 'Bearer fas-session-token', 'content-type': 'application/json' };
    await worker.fetch(
      new Request('https://fis.test/api/ideas/serge-idea-lab', {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ body: '## Snapshot\nA distinctive phrase about porcelain grouping.' }),
      }),
      testEnv,
    );
    const found = await worker.fetch(new Request('https://fis.test/api/search?q=porcelain'), testEnv);
    expect((await found.json() as { hits: unknown[] }).hits).toHaveLength(1);

    await worker.fetch(
      new Request('https://fis.test/api/ideas/serge-idea-lab', {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ body: '## Snapshot\nCompletely different wording now.' }),
      }),
      testEnv,
    );
    const gone = await worker.fetch(new Request('https://fis.test/api/search?q=porcelain'), testEnv);
    expect((await gone.json() as { hits: unknown[] }).hits).toHaveLength(0);
  });

  it('ranks a superseded entry below the correction that replaced it', async () => {
    mockSignedInSerge();
    const testEnv = env();
    const headers = { Authorization: 'Bearer fas-session-token', 'content-type': 'application/json' };
    await worker.fetch(
      new Request('https://fis.test/api/ideas/serge-idea-lab/contributions', {
        method: 'POST',
        headers,
        body: JSON.stringify({ kind: 'evidence', claim: 'Matrixify is a direct competitor.', body: 'Distinctivetoken scan.' }),
      }),
      testEnv,
    );
    const list = await worker.fetch(new Request('https://fis.test/api/ideas/serge-idea-lab/contributions'), testEnv);
    const first = (await list.json() as { contributions: Array<{ id: string; claim?: string }> })
      .contributions.find((item) => item.claim?.startsWith('Matrixify is'));

    await worker.fetch(
      new Request('https://fis.test/api/ideas/serge-idea-lab/contributions', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          kind: 'evidence',
          claim: 'Matrixify was overstated.',
          body: 'Distinctivetoken correction.',
          supersedes: first?.id,
        }),
      }),
      testEnv,
    );
    const response = await worker.fetch(new Request('https://fis.test/api/search?q=distinctivetoken'), testEnv);
    const data = (await response.json()) as { hits: Array<{ ref: string; title: string }> };

    expect(data.hits).toHaveLength(2);
    // The correction outranks the entry it superseded, even though the fake
    // returns the superseded one first.
    expect(data.hits[0]?.title).toBe('Matrixify was overstated.');
  });

  it('renders a search page with highlighted snippets', async () => {
    mockSignedInSerge();
    const testEnv = env();
    await worker.fetch(
      new Request('https://fis.test/api/ideas/serge-idea-lab', {
        method: 'PATCH',
        headers: { Authorization: 'Bearer fas-session-token', 'content-type': 'application/json' },
        body: JSON.stringify({ body: '## Snapshot\nPorcelain grouping comes from the standard.' }),
      }),
      testEnv,
    );
    const page = await worker.fetch(new Request('https://fis.test/search?q=porcelain'), testEnv);
    const html = await page.text();
    const empty = await worker.fetch(new Request('https://fis.test/search'), testEnv);

    expect(page.status).toBe(200);
    expect(html).toContain('1 result for');
    expect(html).toContain('href="/ideas/serge-idea-lab/#snapshot"');
    // The form round-trips the query, escaped.
    expect(html).toContain('value="porcelain"');
    expect((await empty.text())).toContain('Search across every idea document');
  });

  it('does not let a search query inject markup through the snippet', async () => {
    mockSignedInSerge();
    const testEnv = env();
    await worker.fetch(
      new Request('https://fis.test/api/ideas/serge-idea-lab', {
        method: 'PATCH',
        headers: { Authorization: 'Bearer fas-session-token', 'content-type': 'application/json' },
        body: JSON.stringify({ body: '## Snapshot\nA <script>alert(1)</script> in the body.' }),
      }),
      testEnv,
    );
    const page = await worker.fetch(new Request('https://fis.test/search?q=%22%3Cimg%20onerror%3D%3E'), testEnv);
    const html = await page.text();

    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).not.toContain('<img onerror');
  });

  it('indexes the sources a document cites, per section', async () => {
    mockSignedInSerge();
    const testEnv = env();
    await worker.fetch(
      new Request('https://fis.test/api/ideas/serge-idea-lab', {
        method: 'PATCH',
        headers: { Authorization: 'Bearer fas-session-token', 'content-type': 'application/json' },
        body: JSON.stringify({
          body: [
            '## Snapshot',
            'Grouping comes from [ISO 13006](https://www.iso.org/standard/63406.html).',
            '',
            '## Research',
            'Bare cite https://matrixify.app/ and the standard again',
            'https://www.iso.org/standard/63406.html#scope for good measure.',
          ].join('\n'),
        }),
      }),
      testEnv,
    );
    const response = await worker.fetch(new Request('https://fis.test/api/ideas/serge-idea-lab/sources'), testEnv);
    const data = (await response.json()) as {
      sources: Array<{ url: string; host: string; sections: string[] }>;
    };

    expect(response.status).toBe(200);
    // The standard is cited twice, in two sections, but is one source.
    const iso = data.sources.find((source) => source.host === 'www.iso.org');
    expect(data.sources).toHaveLength(2);
    expect(iso?.url).toBe('https://www.iso.org/standard/63406.html');
    expect(iso?.sections.sort()).toEqual(['research', 'snapshot']);
  });

  it('stops listing a source once the document stops citing it', async () => {
    mockSignedInSerge();
    const testEnv = env();
    const headers = { Authorization: 'Bearer fas-session-token', 'content-type': 'application/json' };
    await worker.fetch(
      new Request('https://fis.test/api/ideas/serge-idea-lab', {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ body: '## Snapshot\nCite https://example.com/gone' }),
      }),
      testEnv,
    );
    await worker.fetch(
      new Request('https://fis.test/api/ideas/serge-idea-lab', {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ body: '## Snapshot\nNo citations any more.' }),
      }),
      testEnv,
    );
    const response = await worker.fetch(new Request('https://fis.test/api/ideas/serge-idea-lab/sources'), testEnv);
    const data = (await response.json()) as { sources: unknown[] };

    expect(data.sources).toHaveLength(0);
  });

  /**
   * #71: the re-index runs after the body has committed. If it can fail the
   * request, the caller sees a 500 for a write that landed — and the obvious
   * response to a 500 is a retry, which for a section merge is destructive.
   */
  describe('a post-commit re-index failure', () => {
    const headers = { Authorization: 'Bearer fas-session-token', 'content-type': 'application/json' };

    async function patchWhile(failOn: string, body: string) {
      mockSignedInSerge();
      const db = new FakeD1();
      const testEnv = env(db);
      db.failOn = failOn;
      const response = await worker.fetch(
        new Request('https://fis.test/api/ideas/serge-idea-lab', {
          method: 'PATCH',
          headers,
          body: JSON.stringify({ body }),
        }),
        testEnv,
      );
      db.failOn = null;
      const read = await worker.fetch(new Request('https://fis.test/api/ideas/serge-idea-lab'), testEnv);
      return { response, stored: ((await read.json()) as { body: string }).body };
    }

    it('does not fail the write when the search index cannot be rebuilt', async () => {
      const written = '## Snapshot\nA sentence that has to survive a broken index.';
      const { response, stored } = await patchWhile('INSERT INTO search_index', written);
      const data = (await response.json()) as { ok: boolean; reindexed?: boolean; warning?: string };

      expect(response.status).toBe(200);
      expect(data.ok).toBe(true);
      // The write is durable; the caller is told the index is not.
      expect(stored).toContain('has to survive a broken index');
      expect(data.reindexed).toBe(false);
      expect(data.warning).toContain('the document was saved');
    });

    it('does not fail the write when the source registry cannot be rebuilt', async () => {
      const written = '## Snapshot\nCite https://example.com/source for the claim.';
      const { response, stored } = await patchWhile('INSERT OR IGNORE INTO sources', written);

      expect(response.status).toBe(200);
      expect(stored).toContain('https://example.com/source');
      expect(((await response.json()) as { reindexed?: boolean }).reindexed).toBe(false);
    });

    it('does not fail a section merge, whose retry would be destructive', async () => {
      mockSignedInSerge();
      const db = new FakeD1();
      const testEnv = env(db);
      await worker.fetch(
        new Request('https://fis.test/api/ideas/serge-idea-lab', {
          method: 'PATCH',
          headers,
          body: JSON.stringify({ body: '## Findings\nThe finding.\n\n## Route Survey\nThe survey.' }),
        }),
        testEnv,
      );

      db.failOn = 'DELETE FROM search_index';
      const merge = await worker.fetch(
        new Request('https://fis.test/api/ideas/serge-idea-lab/sections/findings/merge', {
          method: 'POST',
          headers,
          body: JSON.stringify({ into: 'route-survey' }),
        }),
        testEnv,
      );
      db.failOn = null;
      const read = await worker.fetch(new Request('https://fis.test/api/ideas/serge-idea-lab'), testEnv);
      const stored = ((await read.json()) as { body: string }).body;

      expect(merge.status).toBe(200);
      // The merge applied, so the source section is gone: a retry would 404 at
      // best. The response has to say the write happened.
      expect(stored).not.toContain('## Findings');
      expect(stored).toContain('The finding.');
      expect(((await merge.json()) as { reindexed?: boolean }).reindexed).toBe(false);
    });
  });

  it('keeps a contribution citation even when the document drops the link', async () => {
    mockSignedInSerge();
    const testEnv = env();
    const headers = { Authorization: 'Bearer fas-session-token', 'content-type': 'application/json' };
    await worker.fetch(
      new Request('https://fis.test/api/ideas/serge-idea-lab/contributions', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          kind: 'evidence',
          body: 'Recorded from the standard.',
          source_url: 'https://www.iso.org/standard/63406.html',
        }),
      }),
      testEnv,
    );
    // A document rewrite re-indexes document links only; history keeps its own.
    await worker.fetch(
      new Request('https://fis.test/api/ideas/serge-idea-lab', {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ body: '## Snapshot\nNo citations in the document.' }),
      }),
      testEnv,
    );
    const response = await worker.fetch(new Request('https://fis.test/api/ideas/serge-idea-lab/sources'), testEnv);
    const data = (await response.json()) as {
      sources: Array<{ host: string; sections: string[]; contribution_citations: number }>;
    };

    expect(data.sources).toHaveLength(1);
    expect(data.sources[0]?.host).toBe('www.iso.org');
    expect(data.sources[0]?.sections).toEqual([]);
    expect(data.sources[0]?.contribution_citations).toBe(1);
  });

  it('renders the sources section on the idea page', async () => {
    mockSignedInSerge();
    const testEnv = env();
    await worker.fetch(
      new Request('https://fis.test/api/ideas/serge-idea-lab', {
        method: 'PATCH',
        headers: { Authorization: 'Bearer fas-session-token', 'content-type': 'application/json' },
        body: JSON.stringify({ body: '## Snapshot\nSee https://www.iso.org/standard/63406.html' }),
      }),
      testEnv,
    );
    const page = await worker.fetch(new Request('https://fis.test/ideas/serge-idea-lab/'), testEnv);
    const html = await page.text();

    expect(html).toContain('id="sources"');
    expect(html).toContain('www.iso.org');
    expect(html).toContain('1 distinct source');
    // And it is reachable from the Signals rail.
    expect(html).toContain('href="#sources"');
  });

  it('says what is wrong with a malformed request body', async () => {
    const notJson = await worker.fetch(
      new Request('https://fis.test/api/ideas', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-idea-handle': 'tester' },
        body: 'this is not json',
      }),
      env(),
    );
    const notObject = await worker.fetch(
      new Request('https://fis.test/api/ideas', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-idea-handle': 'tester' },
        body: '["an","array"]',
      }),
      env(),
    );

    // Previously both returned {} and surfaced as "title and summary are required".
    expect(notJson.status).toBe(400);
    await expect(notJson.json()).resolves.toEqual({ error: 'request body is not valid JSON' });
    expect(notObject.status).toBe(400);
    await expect(notObject.json()).resolves.toEqual({ error: 'request body must be a JSON object' });
  });

  it('rejects an oversized request body with 413, not a field error', async () => {
    const response = await worker.fetch(
      new Request('https://fis.test/api/ideas', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-idea-handle': 'tester' },
        body: JSON.stringify({
          title: 'Huge',
          summary: 'x'.repeat(20),
          body: 'y'.repeat(MAX_REQUEST_CHARS + 1),
        }),
      }),
      env(),
    );

    expect(response.status).toBe(413);
    expect((await response.json()) as { error: string }).toMatchObject({
      error: expect.stringContaining(`the limit is ${MAX_REQUEST_CHARS} characters`),
    });
  });

  it('rejects an over-budget document with 400 and the budget, not 413', async () => {
    // The request ceiling and the document ceiling are different limits with
    // different remedies. A document one character over the free cap fits in a
    // request comfortably, so the author must be told about the DOCUMENT budget
    // rather than being handed a transport error.
    mockSignedInSerge();
    const response = await worker.fetch(
      new Request('https://fis.test/api/ideas', {
        method: 'POST',
        headers: { Authorization: 'Bearer fas-session-token', 'content-type': 'application/json' },
        body: JSON.stringify({
          title: 'Over Budget',
          summary: 'A document one character past the free-tier character cap.',
          body: 'y'.repeat(FIELD_LIMITS.body + 1),
        }),
      }),
      env(),
    );

    expect(response.status).toBe(400);
    expect((await response.json()) as { error: string }).toMatchObject({
      error: expect.stringContaining('trim at least 1 characters'),
    });
  });

  it('still treats an absent body as no fields', async () => {
    mockSignedInSerge();
    // promote takes no fields; an empty body must not become an error.
    const response = await worker.fetch(
      new Request('https://fis.test/api/ideas/serge-idea-lab/promote', {
        method: 'POST',
        headers: { Authorization: 'Bearer fas-session-token' },
      }),
      env(),
    );

    expect(response.status).not.toBe(400);
  });

  it('refuses a refinement targeting a section the document does not have', async () => {
    mockSignedInSerge();
    const response = await worker.fetch(
      new Request('https://fis.test/api/ideas/serge-idea-lab/contributions', {
        method: 'POST',
        headers: { Authorization: 'Bearer fas-session-token', 'content-type': 'application/json' },
        // 'design' is an aspect, not one of this document's section ids.
        body: JSON.stringify({ kind: 'refinement', section: 'design', body: 'Proposal:\nSomething.' }),
      }),
      env(),
    );

    expect(response.status).toBe(400);
    const data = (await response.json()) as { error: string };
    expect(data.error).toContain('unknown section "design"');
    // The error lists what would work, so the caller can retry without guessing.
    expect(data.error).toContain('snapshot');
  });

  it('still accepts a refinement with no target, to be routed at apply time', async () => {
    mockSignedInSerge();
    const response = await worker.fetch(
      new Request('https://fis.test/api/ideas/serge-idea-lab/contributions', {
        method: 'POST',
        headers: { Authorization: 'Bearer fas-session-token', 'content-type': 'application/json' },
        body: JSON.stringify({ kind: 'refinement', body: 'Proposal:\nSomething general.' }),
      }),
      env(),
    );

    expect(response.status).toBe(201);
  });

  it('does not section-validate non-refinement contributions', async () => {
    mockSignedInSerge();
    const response = await worker.fetch(
      new Request('https://fis.test/api/ideas/serge-idea-lab/contributions', {
        method: 'POST',
        headers: { Authorization: 'Bearer fas-session-token', 'content-type': 'application/json' },
        body: JSON.stringify({ kind: 'evidence', section: 'design', body: 'A finding.' }),
      }),
      env(),
    );

    expect(response.status).toBe(201);
  });

  it('surfaces queued refinements instead of leaving them invisible', async () => {
    mockSignedInSerge();
    const testEnv = env();
    const refinement = await proposeRefinement(testEnv, 'serge-idea-lab', 'snapshot');

    expect(refinement?.section).toBe('snapshot');
    // The proposal text is extracted from the composed body.
    expect(refinement?.proposal).toBe('Sharpen the wording here.');

    const page = await worker.fetch(new Request('https://fis.test/ideas/serge-idea-lab/'), testEnv);
    const html = await page.text();
    expect(html).toContain('Awaiting merge');
    expect(html).toContain('1 proposed refinement');
    expect(html).toContain('research-tag pending');
  });

  it('applies a refinement into its target section and ties it to a revision', async () => {
    mockSignedInSerge();
    const testEnv = env();
    const refinement = await proposeRefinement(testEnv, 'serge-idea-lab', 'snapshot');

    const apply = await worker.fetch(
      new Request(`https://fis.test/api/ideas/serge-idea-lab/refinements/${refinement?.id}/apply`, {
        method: 'POST',
        headers: { Authorization: 'Bearer fas-session-token', 'content-type': 'application/json' },
        body: JSON.stringify({}),
      }),
      testEnv,
    );
    const applied = (await apply.json()) as { ok: boolean; section: string; revision: string | null };
    const read = await worker.fetch(new Request('https://fis.test/api/ideas/serge-idea-lab'), testEnv);
    const data = (await read.json()) as { body: string };

    expect(apply.status).toBe(200);
    expect(applied.section).toBe('snapshot');
    // The proposal text landed in the document...
    expect(data.body).toContain('Sharpen the wording here.');
    expect(data.body).toContain('Owned by the signed-in account.');
    // ...and the resolution points at the revision the write produced.
    expect(applied.revision).toBeTruthy();

    // The queue has drained.
    const open = await worker.fetch(new Request('https://fis.test/api/ideas/serge-idea-lab/refinements'), testEnv);
    expect((await open.json() as { refinements: unknown[] }).refinements).toHaveLength(0);
    const resolved = await worker.fetch(
      new Request('https://fis.test/api/ideas/serge-idea-lab/refinements?status=resolved'),
      testEnv,
    );
    const resolvedData = (await resolved.json()) as { refinements: Array<{ status: string; resolved_revision: string }> };
    expect(resolvedData.refinements[0]?.status).toBe('applied');
    expect(resolvedData.refinements[0]?.resolved_revision).toBe(applied.revision);
  });

  it('lets the author control the merged wording', async () => {
    mockSignedInSerge();
    const testEnv = env();
    const refinement = await proposeRefinement(testEnv, 'serge-idea-lab', 'snapshot');

    await worker.fetch(
      new Request(`https://fis.test/api/ideas/serge-idea-lab/refinements/${refinement?.id}/apply`, {
        method: 'POST',
        headers: { Authorization: 'Bearer fas-session-token', 'content-type': 'application/json' },
        body: JSON.stringify({ mode: 'replace', content: 'Rewritten in the maintainer voice.' }),
      }),
      testEnv,
    );
    const read = await worker.fetch(new Request('https://fis.test/api/ideas/serge-idea-lab'), testEnv);
    const data = (await read.json()) as { body: string };

    expect(data.body).toContain('Rewritten in the maintainer voice.');
    // `replace` was honoured, so the proposal's own words are not in the document.
    expect(data.body).not.toContain('Sharpen the wording here.');
  });

  it('refuses to apply the same refinement twice', async () => {
    mockSignedInSerge();
    const testEnv = env();
    const refinement = await proposeRefinement(testEnv, 'serge-idea-lab', 'snapshot');
    const path = `https://fis.test/api/ideas/serge-idea-lab/refinements/${refinement?.id}/apply`;
    const headers = { Authorization: 'Bearer fas-session-token', 'content-type': 'application/json' };

    await worker.fetch(new Request(path, { method: 'POST', headers, body: '{}' }), testEnv);
    const second = await worker.fetch(new Request(path, { method: 'POST', headers, body: '{}' }), testEnv);

    expect(second.status).toBe(409);
    expect((await second.json() as { error: string }).error).toContain('already applied');
  });

  it('closes a refinement without merging, but demands a reason', async () => {
    mockSignedInSerge();
    const testEnv = env();
    const refinement = await proposeRefinement(testEnv, 'serge-idea-lab', 'snapshot');
    const path = `https://fis.test/api/ideas/serge-idea-lab/refinements/${refinement?.id}/resolve`;
    const headers = { Authorization: 'Bearer fas-session-token', 'content-type': 'application/json' };

    const noReason = await worker.fetch(
      new Request(path, { method: 'POST', headers, body: JSON.stringify({ status: 'rejected' }) }),
      testEnv,
    );
    const viaResolve = await worker.fetch(
      new Request(path, { method: 'POST', headers, body: JSON.stringify({ status: 'applied', reason: 'x' }) }),
      testEnv,
    );
    const rejected = await worker.fetch(
      new Request(path, {
        method: 'POST',
        headers,
        body: JSON.stringify({ status: 'rejected', reason: 'Superseded by the deep market scan.' }),
      }),
      testEnv,
    );

    expect(noReason.status).toBe(400);
    // 'applied' must go through apply, so it is always tied to a revision.
    expect(viaResolve.status).toBe(400);
    expect((await viaResolve.json() as { error: string }).error).toContain('use the apply endpoint');
    expect(rejected.status).toBe(200);

    const open = await worker.fetch(new Request('https://fis.test/api/ideas/serge-idea-lab/refinements'), testEnv);
    expect((await open.json() as { refinements: unknown[] }).refinements).toHaveLength(0);
  });

  it('stores typed research fields and renders provenance on the page', async () => {
    mockSignedInSerge();
    const testEnv = env();
    const create = await worker.fetch(
      new Request('https://fis.test/api/ideas/asx-filings-analyst/contributions', {
        method: 'POST',
        headers: { Authorization: 'Bearer fas-session-token', 'content-type': 'application/json' },
        body: JSON.stringify({
          kind: 'evidence',
          claim: 'Porcelain is definitionally under 0.5% water absorption.',
          body: 'ISO 13006 ties absorption to group, so the value is derived rather than asked for.',
          source_url: 'https://www.iso.org/standard/63406.html',
          accessed_at: '2026-07-30',
          provenance: 'derived',
          confidence: 'high',
        }),
      }),
      testEnv,
    );
    const page = await worker.fetch(new Request('https://fis.test/ideas/asx-filings-analyst/'), testEnv);
    const html = await page.text();

    expect(create.status).toBe(201);
    // The claim becomes the headline, and provenance/confidence are visible.
    expect(html).toContain('Porcelain is definitionally under 0.5% water absorption.');
    expect(html).toContain('prov-derived');
    expect(html).toContain('conf-high');
    expect(html).toContain('href="https://www.iso.org/standard/63406.html"');
    expect(html).toContain('checked 2026-07-30');
  });

  it('rejects a provenance or confidence value outside the vocabulary', async () => {
    mockSignedInSerge();
    const badProvenance = await worker.fetch(
      new Request('https://fis.test/api/ideas/asx-filings-analyst/contributions', {
        method: 'POST',
        headers: { Authorization: 'Bearer fas-session-token', 'content-type': 'application/json' },
        body: JSON.stringify({ kind: 'evidence', body: 'A finding.', provenance: 'vibes' }),
      }),
      env(),
    );
    const badSource = await worker.fetch(
      new Request('https://fis.test/api/ideas/asx-filings-analyst/contributions', {
        method: 'POST',
        headers: { Authorization: 'Bearer fas-session-token', 'content-type': 'application/json' },
        body: JSON.stringify({ kind: 'evidence', body: 'A finding.', source_url: 'javascript:alert(1)' }),
      }),
      env(),
    );

    expect(badProvenance.status).toBe(400);
    expect((await badProvenance.json() as { error: string }).error).toContain('provenance must be one of');
    expect(badSource.status).toBe(400);
    expect((await badSource.json() as { error: string }).error).toContain('http(s)');
  });

  it('marks a corrected entry as superseded instead of showing peers', async () => {
    mockSignedInSerge();
    const testEnv = env();
    const first = await worker.fetch(
      new Request('https://fis.test/api/ideas/asx-filings-analyst/contributions', {
        method: 'POST',
        headers: { Authorization: 'Bearer fas-session-token', 'content-type': 'application/json' },
        body: JSON.stringify({ kind: 'evidence', claim: 'Matrixify is a direct competitor.', body: 'Initial scan.' }),
      }),
      testEnv,
    );
    expect(first.status).toBe(201);

    const list = await worker.fetch(
      new Request('https://fis.test/api/ideas/asx-filings-analyst/contributions'),
      testEnv,
    );
    const listed = (await list.json()) as { contributions: Array<{ id: string; claim?: string }> };
    const target = listed.contributions.find((item) => item.claim?.startsWith('Matrixify'));
    expect(target).toBeTruthy();

    const correction = await worker.fetch(
      new Request('https://fis.test/api/ideas/asx-filings-analyst/contributions', {
        method: 'POST',
        headers: { Authorization: 'Bearer fas-session-token', 'content-type': 'application/json' },
        body: JSON.stringify({
          kind: 'evidence',
          claim: 'Matrixify was overstated: no UI into the data.',
          body: 'Correction to the competitor scan.',
          supersedes: target?.id,
        }),
      }),
      testEnv,
    );
    const page = await worker.fetch(new Request('https://fis.test/ideas/asx-filings-analyst/'), testEnv);
    const html = await page.text();

    expect(correction.status).toBe(201);
    expect(html).toContain('is-superseded');
    expect(html).toContain('Corrected by');
    // Both remain readable — the record shows what was believed and what replaced it.
    expect(html).toContain('Matrixify is a direct competitor.');
    expect(html).toContain('Matrixify was overstated');
  });

  it('refuses to supersede a contribution that does not exist on this idea', async () => {
    mockSignedInSerge();
    const response = await worker.fetch(
      new Request('https://fis.test/api/ideas/asx-filings-analyst/contributions', {
        method: 'POST',
        headers: { Authorization: 'Bearer fas-session-token', 'content-type': 'application/json' },
        body: JSON.stringify({ kind: 'evidence', body: 'A finding.', supersedes: 'contribution-does-not-exist' }),
      }),
      env(),
    );

    expect(response.status).toBe(404);
    expect((await response.json() as { error: string }).error).toContain('supersedes must reference');
  });

  it('records the replaced document as a revision on a canonical update', async () => {
    mockSignedInSerge();
    const testEnv = env();
    const update = await worker.fetch(
      new Request('https://fis.test/api/ideas/serge-idea-lab', {
        method: 'PATCH',
        headers: { Authorization: 'Bearer fas-session-token', 'content-type': 'application/json' },
        body: JSON.stringify({ body: '## Snapshot\nA completely different document.' }),
      }),
      testEnv,
    );
    const list = await worker.fetch(new Request('https://fis.test/api/ideas/serge-idea-lab/revisions'), testEnv);
    const data = (await list.json()) as { revisions: Array<{ id: string; source: string }> };

    expect(update.status).toBe(200);
    expect(data.revisions).toHaveLength(1);
    expect(data.revisions[0]?.source).toBe('update');

    // The revision holds what was replaced, so the prior state is recoverable.
    const read = await worker.fetch(
      new Request(`https://fis.test/api/ideas/serge-idea-lab/revisions/${data.revisions[0]?.id}`),
      testEnv,
    );
    const revision = (await read.json()) as { markdown: string };
    expect(revision.markdown).toContain('Owned by the signed-in account.');
    expect(revision.markdown).not.toContain('A completely different document.');
  });

  it('records a revision for a section write too', async () => {
    mockSignedInSerge();
    const testEnv = env();
    await worker.fetch(
      new Request('https://fis.test/api/ideas/serge-idea-lab/sections/snapshot', {
        method: 'POST',
        headers: { Authorization: 'Bearer fas-session-token', 'content-type': 'application/json' },
        body: JSON.stringify({ content: 'Appended detail.' }),
      }),
      testEnv,
    );
    const list = await worker.fetch(new Request('https://fis.test/api/ideas/serge-idea-lab/revisions'), testEnv);
    const data = (await list.json()) as { revisions: Array<{ source: string; section: string }> };

    expect(data.revisions).toHaveLength(1);
    expect(data.revisions[0]).toMatchObject({ source: 'section-append', section: 'snapshot' });
  });

  it('does not record a revision when the body is unchanged', async () => {
    mockSignedInSerge();
    const testEnv = env();
    const update = await worker.fetch(
      new Request('https://fis.test/api/ideas/serge-idea-lab', {
        method: 'PATCH',
        headers: { Authorization: 'Bearer fas-session-token', 'content-type': 'application/json' },
        body: JSON.stringify({ stage: 'researching' }),
      }),
      testEnv,
    );
    const list = await worker.fetch(new Request('https://fis.test/api/ideas/serge-idea-lab/revisions'), testEnv);
    const data = (await list.json()) as { revisions: unknown[] };

    expect(update.status).toBe(200);
    expect(data.revisions).toHaveLength(0);
  });

  it('reverts to a revision, and the revert is itself undoable', async () => {
    mockSignedInSerge();
    const testEnv = env();
    const original = '## Snapshot\nOwned by the signed-in account.';

    await worker.fetch(
      new Request('https://fis.test/api/ideas/serge-idea-lab', {
        method: 'PATCH',
        headers: { Authorization: 'Bearer fas-session-token', 'content-type': 'application/json' },
        body: JSON.stringify({ body: '## Snapshot\nOverwritten by a parallel session.' }),
      }),
      testEnv,
    );
    const list = await worker.fetch(new Request('https://fis.test/api/ideas/serge-idea-lab/revisions'), testEnv);
    const { revisions } = (await list.json()) as { revisions: Array<{ id: string }> };

    const revert = await worker.fetch(
      new Request(`https://fis.test/api/ideas/serge-idea-lab/revisions/${revisions[0]?.id}/revert`, {
        method: 'POST',
        headers: { Authorization: 'Bearer fas-session-token', 'content-type': 'application/json' },
        body: '{}',
      }),
      testEnv,
    );
    const read = await worker.fetch(new Request('https://fis.test/api/ideas/serge-idea-lab'), testEnv);
    const data = (await read.json()) as { body: string };

    expect(revert.status).toBe(200);
    expect(data.body).toBe(original);

    // The overwrite that was undone is still on record.
    const after = await worker.fetch(new Request('https://fis.test/api/ideas/serge-idea-lab/revisions'), testEnv);
    const afterData = (await after.json()) as { revisions: Array<{ source: string }> };
    expect(afterData.revisions).toHaveLength(2);
    expect(afterData.revisions.some((revision) => revision.source === 'revert')).toBe(true);
  });

  it('reports what a revision changed as added and removed lines', async () => {
    mockSignedInSerge();
    const testEnv = env();
    await worker.fetch(
      new Request('https://fis.test/api/ideas/serge-idea-lab', {
        method: 'PATCH',
        headers: { Authorization: 'Bearer fas-session-token', 'content-type': 'application/json' },
        body: JSON.stringify({ body: '## Snapshot\nOwned by the signed-in account.\nPlus one new line.' }),
      }),
      testEnv,
    );
    const list = await worker.fetch(new Request('https://fis.test/api/ideas/serge-idea-lab/revisions'), testEnv);
    const { revisions } = (await list.json()) as { revisions: Array<{ id: string }> };
    const diff = await worker.fetch(
      new Request(`https://fis.test/api/ideas/serge-idea-lab/revisions/${revisions[0]?.id}/diff`),
      testEnv,
    );
    const data = (await diff.json()) as { added: number; removed: number; changes: Array<{ type: string; text: string }> };

    expect(diff.status).toBe(200);
    // One line added; the shared lines are recognised as unchanged.
    expect(data.added).toBe(1);
    expect(data.removed).toBe(0);
    expect(data.changes).toEqual([{ type: 'added', text: 'Plus one new line.' }]);
  });

  it('refuses a revert from someone who does not own the idea', async () => {
    mockSignedInSerge();
    const response = await worker.fetch(
      new Request('https://fis.test/api/ideas/asx-filings-analyst/revisions/whatever/revert', {
        method: 'POST',
        headers: { Authorization: 'Bearer fas-session-token', 'content-type': 'application/json' },
        body: '{}',
      }),
      env(),
    );

    expect(response.status).toBe(403);
  });

  it('renders a short idea as one page with no chapter navigation', async () => {
    // serge-idea-lab is a few lines long — far below PUBLICATION_POLICY.
    const response = await worker.fetch(new Request('https://fis.test/ideas/serge-idea-lab/'), env());
    const html = await response.text();

    expect(response.status).toBe(200);
    // No chapter sidebar, filter, or mobile chapter list...
    expect(html).not.toContain('class="book-sidebar"');
    expect(html).not.toContain('aria-label="Filter chapters"');
    expect(html).not.toContain('class="mobile-book-nav"');
    expect(html).toContain('single-page');
    // ...but the body and its in-page section links are still there.
    expect(html).toContain('Owned by the signed-in account.');
    expect(html).toContain('<strong>Sections</strong>');
  });

  it('sends chapter deep links on a short idea to the matching anchor', async () => {
    const response = await worker.fetch(new Request('https://fis.test/ideas/serge-idea-lab/snapshot/'), env());

    // 302 not 301: the document can grow past the threshold later.
    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe('https://fis.test/ideas/serge-idea-lab/#snapshot');
  });

  it('keeps chapter pages for a document long enough to earn them', async () => {
    const response = await worker.fetch(new Request('https://fis.test/ideas/asx-filings-analyst/snapshot/'), env());

    expect(response.status).toBe(200);
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
    expect(html).toContain('theme-toggle');
    expect(html).toContain('fis:reader-theme');
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
    // Writes now carry the document budget back to the author, so an agent can
    // see how much room is left instead of discovering the cap by hitting it.
    //
    // Asserted as a closed shape with REAL numbers. `expect.any(Number)` on
    // every field would have passed on a usage block that reported the wrong
    // document, the wrong limit, or subtracted in the wrong direction — which
    // is the entire thing this block exists to get right. The body written
    // above is 83 characters and two chapters, both far under CHAPTER_SIZE's
    // 500-word floor.
    await expect(update.json()).resolves.toEqual({
      ok: true,
      idea: 'serge-idea-lab',
      url: '/ideas/serge-idea-lab/',
      usage: {
        chars: 83,
        chars_remaining: FIELD_LIMITS.body - 83,
        chapters: 2,
        chapters_remaining: FIELD_LIMITS.chapters - 2,
        below_floor: 2,
        above_ceiling: 0,
      },
    });
    expect(data.idea.stage).toBe('researching');
    expect(data.idea.next_step).toBe('Use MCP to elaborate the public idea document.');
    expect(data.body).toContain('## Research');
  });

  it('lets metadata be edited on a document that is already over a document cap', async () => {
    // A document must never grow past the point where its own summary can be
    // corrected. Before this guard, a metadata-only update measured the
    // UNTOUCHED stored body against the caps, so any document at or over a
    // limit became permanently undescribable — the complaint in #33.
    //
    // The chapter cap is used rather than the character cap because it makes a
    // discriminating fixture cheap: 101 chapters is a few kilobytes, where an
    // over-length body would be a megabyte. On the unguarded code this request
    // returns 400 "document would have 101 chapters".
    mockSignedInSerge();
    const bucket = new FakeR2();
    const testEnv = env(new FakeD1(), undefined, bucket);
    // Seed a normal document first so `body_key` points into object storage,
    // then put the over-cap document behind that pointer. Writing it through
    // the API would be rejected by the very guard under test.
    await worker.fetch(
      new Request('https://fis.test/api/ideas/serge-idea-lab', {
        method: 'PATCH',
        headers: {
          Authorization: 'Bearer fas-session-token',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ body: '## Snapshot\nSmall for now.' }),
      }),
      testEnv,
    );
    const overCap = Array.from(
      { length: FIELD_LIMITS.chapters + 1 },
      (_, i) => `## Chapter ${i}\nSome prose.`,
    ).join('\n\n');
    bucket.objects.set('ideas/serge-idea-lab/body.md', overCap);

    const update = await worker.fetch(
      new Request('https://fis.test/api/ideas/serge-idea-lab', {
        method: 'PATCH',
        headers: {
          Authorization: 'Bearer fas-session-token',
          'content-type': 'application/json',
        },
        // No `body` key at all — this is the metadata-only path.
        body: JSON.stringify({ summary: 'Corrected summary on an oversized document.' }),
      }),
      testEnv,
    );

    expect(update.status).toBe(200);
    const read = await worker.fetch(new Request('https://fis.test/api/ideas/serge-idea-lab'), testEnv);
    const data = (await read.json()) as { idea: { summary: string }; body: string };
    expect(data.idea.summary).toBe('Corrected summary on an oversized document.');
    // The document itself must come through untouched.
    expect(data.body).toBe(overCap);
  });

  it('rejects an oversized contribution instead of silently truncating it', async () => {
    mockSignedInSerge();
    const testEnv = env();
    const body = 'x'.repeat(8001);
    const response = await worker.fetch(
      new Request('https://fis.test/api/ideas/asx-filings-analyst/contributions', {
        method: 'POST',
        headers: { Authorization: 'Bearer fas-session-token', 'content-type': 'application/json' },
        body: JSON.stringify({ kind: 'evidence', body }),
      }),
      testEnv,
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: 'contribution body is 8001 characters; the limit is 8000',
    });

    // Nothing was written, so no half-saved contribution is left behind.
    const list = await worker.fetch(new Request('https://fis.test/api/ideas/asx-filings-analyst/contributions'), testEnv);
    const data = (await list.json()) as { contributions: Array<{ body: string }> };
    expect(data.contributions.some((item) => item.body.startsWith('xxx'))).toBe(false);
  });

  it('stores a long contribution whole, up to the raised limit', async () => {
    mockSignedInSerge();
    const testEnv = env();
    // Previously anything over 2000 chars lost its tail without warning.
    const body = `${'e'.repeat(3000)}END`;
    const create = await worker.fetch(
      new Request('https://fis.test/api/ideas/asx-filings-analyst/contributions', {
        method: 'POST',
        headers: { Authorization: 'Bearer fas-session-token', 'content-type': 'application/json' },
        body: JSON.stringify({ kind: 'evidence', body }),
      }),
      testEnv,
    );
    const list = await worker.fetch(new Request('https://fis.test/api/ideas/asx-filings-analyst/contributions'), testEnv);
    const data = (await list.json()) as { contributions: Array<{ body: string }> };

    expect(create.status).toBe(201);
    const stored = data.contributions.find((item) => item.body.startsWith('eee'));
    expect(stored?.body).toHaveLength(3003);
    expect(stored?.body.endsWith('END')).toBe(true);
  });

  it('rejects oversized idea fields on update instead of truncating them', async () => {
    mockSignedInSerge();
    const response = await worker.fetch(
      new Request('https://fis.test/api/ideas/serge-idea-lab', {
        method: 'PATCH',
        headers: { Authorization: 'Bearer fas-session-token', 'content-type': 'application/json' },
        body: JSON.stringify({ nextStep: 'n'.repeat(501) }),
      }),
      env(),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: 'next step is 501 characters; the limit is 500',
    });
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

  it('derives a new idea that links back to its parent and seeds the parent body', async () => {
    const testEnv = env();
    const derive = await worker.fetch(
      new Request('https://fis.test/api/ideas/asx-filings-analyst/derive', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-idea-handle': 'forker' },
        body: JSON.stringify({ title: 'ASX Filings Analyst for Small Caps', summary: 'A small-cap-focused fork of the ASX filings research assistant.' }),
      }),
      testEnv,
    );
    const derived = (await derive.json()) as { idea: string; parent: string; parentUrl: string };

    const read = await worker.fetch(new Request(`https://fis.test/api/ideas/${derived.idea}`), testEnv);
    const readBody = (await read.json()) as { idea: { parent_id: string; created_by: string }; body: string };

    expect(derive.status).toBe(201);
    expect(derived.idea).toBe('asx-filings-analyst-for-small-caps');
    expect(derived.parent).toBe('asx-filings-analyst');
    expect(derived.parentUrl).toBe('/ideas/asx-filings-analyst/');
    expect(readBody.idea.parent_id).toBe('asx-filings-analyst');
    expect(readBody.idea.created_by).toBe('profile-forker');
    expect(readBody.body).toContain('Public reports and filings.');
  });

  it('renders the derivation links on both the parent and the fork', async () => {
    const testEnv = env();
    await worker.fetch(
      new Request('https://fis.test/api/ideas/asx-filings-analyst/derive', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-idea-handle': 'forker' },
        body: JSON.stringify({ title: 'ASX Filings Analyst for Small Caps', summary: 'A small-cap-focused fork of the ASX filings research assistant.' }),
      }),
      testEnv,
    );

    const child = await worker.fetch(new Request('https://fis.test/ideas/asx-filings-analyst-for-small-caps/'), testEnv);
    const childHtml = await child.text();
    const parent = await worker.fetch(new Request('https://fis.test/ideas/asx-filings-analyst/'), testEnv);
    const parentHtml = await parent.text();

    expect(childHtml).toContain('Derived from');
    expect(childHtml).toContain('/ideas/asx-filings-analyst/');
    expect(parentHtml).toContain('Derived ideas');
    expect(parentHtml).toContain('/ideas/asx-filings-analyst-for-small-caps/');
  });

  it('returns 404 when deriving from a missing idea', async () => {
    const derive = await worker.fetch(
      new Request('https://fis.test/api/ideas/no-such-idea-xyz/derive', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-idea-handle': 'forker' },
        body: JSON.stringify({ title: 'Fork of nothing', summary: 'This should fail because the parent does not exist.' }),
      }),
      env(),
    );
    expect(derive.status).toBe(404);
    await expect(derive.json()).resolves.toEqual({ error: 'idea not found' });
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

describe('mobile navigation', () => {
  const surfaces = [
    ['idea home', 'https://fis.test/ideas/asx-filings-analyst/'],
    ['idea chapter', 'https://fis.test/ideas/asx-filings-analyst/snapshot/'],
    ['idea catalog', 'https://fis.test/ideas/'],
    ['console', 'https://fis.test/console/'],
    ['contributors', 'https://fis.test/contributors/'],
    ['account', 'https://fis.test/profile/'],
  ] as const;

  for (const [name, url] of surfaces) {
    it(`gives the ${name} page a hamburger that opens the site nav`, async () => {
      const response = await worker.fetch(new Request(url), env());
      const html = await response.text();

      expect(response.status).toBe(200);
      // Button, the nav it controls, and the script that connects them.
      expect(html).toContain('class="nav-toggle"');
      expect(html).toContain('aria-controls="site-nav"');
      expect(html).toContain('id="site-nav"');
      expect(html).toContain('.site-nav.open{display:flex}');
      expect(html).toContain("document.querySelector('.nav-toggle')");
      // The nav must no longer simply vanish below the mobile breakpoint.
      expect(html).not.toContain('nav{display:none}');
      expect(html).not.toContain('.topbar-nav{display:none}');
      expect(html).not.toContain('nav a:not(.account-avatar){display:none}');
    });
  }

  it('keeps the account slot outside the drawer so signed-in state stays visible', async () => {
    const response = await worker.fetch(new Request('https://fis.test/console/'), env());
    const html = await response.text();

    expect(html).toContain('</nav><span id="account-slot"></span>');
  });
});

describe('branding', () => {
  it('serves one brand mark and favicon on every rendered page', async () => {
    // Worker-rendered routes only; '/' is a static asset served from store/.
    const paths = ['/ideas/', '/search', '/contributors/serge-the-dev/', '/ideas/asx-filings-analyst/'];
    for (const path of paths) {
      const html = await (await worker.fetch(new Request(`https://fis.test${path}`), env())).text();
      // The mark is a glyph, never the old "FI" initials — they are illegible at 16px.
      expect(html, `${path} mark`).toContain('class="brand-mark"');
      expect(html, `${path} initials`).not.toContain('>FI<');
      // Every page links the favicon. Idea and catalog pages previously did not.
      expect(html, `${path} favicon`).toContain('rel="icon" type="image/svg+xml" href="/favicon.svg"');
      expect(html, `${path} theme-color`).toContain('name="theme-color"');
    }
  });

  it('keeps the favicon artwork identical to the header mark', async () => {
    const { faviconSvg, brandMark } = await import('./brand');
    const shapes = (svg: string) => (svg.match(/d="[^"]+"|cx="\d+"/g) || []).sort();
    // Same paths in both, so the tab icon and the header can never drift apart.
    expect(shapes(faviconSvg())).toEqual(shapes(brandMark()));
  });
});
