import { describe, expect, it } from 'vitest';
import { handleApi } from './api';
import { DERIVED_CHILDREN_LIMIT } from './data';
import { renderIdeaChapterPage } from './idea-chapter-page';
import type { Env } from './types';

/**
 * #64: a derived annex is the prescribed overflow path, but no read path
 * returned a parent's children and chapter pages never linked to them. An
 * agent that sharded a corpus as the overflow error instructs could not
 * enumerate its shards, and a reader inside an annex had no route to the rest
 * of the work.
 */

type IdeaNode = { id: string; title: string; parent_id: string; status?: string };

const words = (count: number) => Array.from({ length: count }, (_, index) => `word${index}`).join(' ');

/** Three chapters of 320 words: over both PUBLICATION_POLICY floors, so the document paginates. */
const PAGINATED_BODY = ['Snapshot', 'Evidence', 'Risks'].map((title) => `## ${title}\n\n${words(320)}\n`).join('\n');

function row(node: IdeaNode) {
  return {
    summary: `${node.title} summary text.`,
    preview: '',
    signal: '',
    body_md: PAGINATED_BODY,
    body_key: '',
    source_url: '',
    visibility: 'public',
    stage: 'researching',
    category: 'research',
    next_step: '',
    risk: '',
    created_by: 'profile-system',
    status: 'active',
    pro_candidate: 0,
    created_at: '2026-08-01 00:00:00',
    updated_at: '2026-08-01 00:00:00',
    support: 0,
    trash: 0,
    pivot: 0,
    contribution_count: 0,
    ...node,
  };
}

/**
 * An in-memory idea tree answering the idea, parent and derived-children
 * queries. Children are listed in array order, which stands in for creation
 * order, and honour the LIMIT/OFFSET binds so paging is exercised for real.
 */
class TreeD1 {
  statements: Array<{ sql: string; binds: unknown[] }> = [];

  constructor(private readonly nodes: IdeaNode[]) {}

  private live(id: unknown) {
    return this.nodes.find((node) => node.id === id && node.status !== 'removed');
  }

  private children(parentId: unknown) {
    return this.nodes.filter((node) => node.parent_id === parentId && node.status !== 'removed');
  }

  prepare(sql: string) {
    let binds: unknown[] = [];
    const statement = {
      bind: (...values: unknown[]) => {
        binds = values;
        return statement;
      },
      first: async () => {
        this.statements.push({ sql, binds });
        if (sql.includes('COUNT(*) AS n FROM ideas') && sql.includes('parent_id = ?')) return { n: this.children(binds[0]).length };
        if (sql.includes('FROM ideas i')) {
          const node = sql.includes("status != 'removed'") ? this.live(binds[0]) : this.nodes.find((item) => item.id === binds[0]);
          return node ? row(node) : null;
        }
        if (sql.includes('SELECT id, title FROM ideas WHERE id = ?')) {
          const node = this.live(binds[0]);
          return node ? { id: node.id, title: node.title } : null;
        }
        return null;
      },
      all: async () => {
        this.statements.push({ sql, binds });
        if (sql.includes('SELECT id, title FROM ideas') && sql.includes('parent_id = ?')) {
          const [parentId, limit, offset] = binds as [string, number, number];
          const page = this.children(parentId).slice(offset, offset + limit);
          return { results: page.map(({ id, title }) => ({ id, title })) };
        }
        return { results: [] };
      },
      run: async () => ({ success: true }),
    };
    return statement;
  }
}

const TREE: IdeaNode[] = [
  { id: 'gapfill', title: 'Gapfill', parent_id: '' },
  { id: 'gapfill-annex-a', title: 'Annex A — Regional evidence', parent_id: 'gapfill' },
  { id: 'gapfill-annex-b', title: 'Annex B — Financial synthesis', parent_id: 'gapfill' },
  { id: 'gapfill-annex-c', title: 'Annex C — Sources', parent_id: 'gapfill' },
  { id: 'gapfill-annex-d', title: 'Annex D — Withdrawn', parent_id: 'gapfill', status: 'removed' },
  { id: 'standalone', title: 'Standalone', parent_id: '' },
];

function envFor(nodes: IdeaNode[] = TREE) {
  const DB = new TreeD1(nodes);
  return { DB, env: { DB } as unknown as Env };
}

async function getJson(env: Env, path: string) {
  const url = new URL(`https://fis.test${path}`);
  const response = await handleApi(new Request(url), env, url);
  return { status: response.status, body: (await response.json()) as Record<string, any> };
}

async function chapterHtml(env: Env, ideaId: string, chapterId = 'evidence') {
  const response = await renderIdeaChapterPage(env, new Request(`https://fis.test/ideas/${ideaId}/${chapterId}/`), ideaId, chapterId);
  expect(response.status).toBe(200);
  return response.text();
}

describe('GET /api/ideas/:id/derived (#64)', () => {
  it("returns a parent's live children oldest first, with total and a url each", async () => {
    const { env } = envFor();

    const { status, body } = await getJson(env, '/api/ideas/gapfill/derived');

    expect(status).toBe(200);
    expect(body.idea).toBe('gapfill');
    expect(body.parent_id).toBeNull();
    expect(body.children).toEqual([
      { id: 'gapfill-annex-a', title: 'Annex A — Regional evidence', url: '/ideas/gapfill-annex-a/' },
      { id: 'gapfill-annex-b', title: 'Annex B — Financial synthesis', url: '/ideas/gapfill-annex-b/' },
      { id: 'gapfill-annex-c', title: 'Annex C — Sources', url: '/ideas/gapfill-annex-c/' },
    ]);
    // The removed annex is in neither the page nor the count.
    expect(body.total).toBe(3);
    expect(body.limit).toBe(DERIVED_CHILDREN_LIMIT);
    expect(body.offset).toBe(0);
  });

  it('pages with limit and offset while total stays the whole set', async () => {
    const { env } = envFor();

    const first = await getJson(env, '/api/ideas/gapfill/derived?limit=2');
    const second = await getJson(env, '/api/ideas/gapfill/derived?limit=2&offset=2');

    expect(first.body.children.map((child: { id: string }) => child.id)).toEqual(['gapfill-annex-a', 'gapfill-annex-b']);
    expect(second.body.children.map((child: { id: string }) => child.id)).toEqual(['gapfill-annex-c']);
    expect(first.body.total).toBe(3);
    expect(second.body.total).toBe(3);
  });

  it("reports a child's own parent_id so a caller can walk up as well as down", async () => {
    const { env } = envFor();

    const { body } = await getJson(env, '/api/ideas/gapfill-annex-a/derived');

    expect(body.parent_id).toBe('gapfill');
    expect(body.children).toEqual([]);
    expect(body.total).toBe(0);
  });

  it('404s an unknown parent rather than answering with an empty list', async () => {
    const { env } = envFor();

    const { status, body } = await getJson(env, '/api/ideas/no-such-idea/derived');

    expect(status).toBe(404);
    expect(body.error).toBe('idea not found');
  });

  it('404s a removed parent', async () => {
    const { env } = envFor();

    expect((await getJson(env, '/api/ideas/gapfill-annex-d/derived')).status).toBe(404);
  });
});

describe('chapter pages navigate a derived annex set (#64)', () => {
  it("links an annex chapter back to its parent and lists every sibling annex", async () => {
    const { env } = envFor();

    const html = await chapterHtml(env, 'gapfill-annex-b');

    expect(html).toContain('<nav class="related-docs" aria-label="Related documents">');
    expect(html).toContain('<a class="related-link parent" href="/ideas/gapfill/" rel="up">Gapfill</a>');
    for (const sibling of ['gapfill-annex-a', 'gapfill-annex-c']) {
      expect(html).toContain(`href="/ideas/${sibling}/"`);
    }
    // The page's own annex is in the set, marked as the current one.
    expect(html).toContain('<a class="related-link active" href="/ideas/gapfill-annex-b/" aria-current="page">');
    expect(html).not.toContain('/ideas/gapfill-annex-d/');
  });

  it('puts the parent in the crumb above the chapter title', async () => {
    const { env } = envFor();

    const html = await chapterHtml(env, 'gapfill-annex-a');

    expect(html).toContain('<div class="crumb"><a href="/ideas/gapfill/">Gapfill</a>');
  });

  it("links a parent's chapter pages to the annexes derived from it", async () => {
    const { env } = envFor();

    const html = await chapterHtml(env, 'gapfill');

    expect(html).toContain('Derived annexes');
    for (const annex of ['gapfill-annex-a', 'gapfill-annex-b', 'gapfill-annex-c']) {
      expect(html).toContain(`href="/ideas/${annex}/"`);
    }
    expect(html).not.toContain('rel="up"');
    expect(html).not.toContain('<div class="crumb">');
  });

  it('renders the block in both the desktop sidebar and the mobile chapter menu', async () => {
    const { env } = envFor();

    const html = await chapterHtml(env, 'gapfill-annex-a');

    expect(html.split('<nav class="related-docs"').length - 1).toBe(2);
  });

  it('says how many annexes it is not showing when the set is over the cap', async () => {
    const annexes = Array.from({ length: DERIVED_CHILDREN_LIMIT + 5 }, (_, index) => ({
      id: `big-annex-${index}`,
      title: `Annex ${index}`,
      parent_id: 'big',
    }));
    const { env } = envFor([{ id: 'big', title: 'Big', parent_id: '' }, ...annexes]);

    const html = await chapterHtml(env, 'big-annex-0');

    expect(html).toContain(`Showing ${DERIVED_CHILDREN_LIMIT} of ${DERIVED_CHILDREN_LIMIT + 5}`);
  });

  it('renders no related-documents block for a document with no parent and no children', async () => {
    const { env } = envFor();

    const html = await chapterHtml(env, 'standalone');

    expect(html).not.toContain('related-docs"');
  });

  it('treats a removed parent as no parent, so the page never links to a 410', async () => {
    const { env } = envFor([
      { id: 'gone', title: 'Gone', parent_id: '', status: 'removed' },
      { id: 'orphan', title: 'Orphan', parent_id: 'gone' },
    ]);

    const html = await chapterHtml(env, 'orphan');

    expect(html).not.toContain('/ideas/gone/');
  });
});
