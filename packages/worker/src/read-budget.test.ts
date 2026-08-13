import { describe, expect, it } from 'vitest';
import { handleApi } from './api';
import { FIELD_LIMITS } from './http';
import { ideaPreamble } from './markdown';
import type { Env } from './types';

/**
 * #46 and #66: what a READ tells the caller.
 *
 * A session's first call is a read, not a write. Until #46 neither read path
 * carried `usage`, so the only way to learn the document budget was to overflow
 * it and subtract from the error string. And until #66 `GET /api/ideas/:id`
 * returned the whole canonical body every time — 195,546 characters on one real
 * idea, against a 1,000,000-character ceiling.
 */

const TITLE = 'Cellar Door Cycling';

/** Words enough to put a chapter above CHAPTER_SIZE.floorWords. */
const prose = (words: number) => Array.from({ length: words }, (_, n) => `word${n}`).join(' ');

const BODY = [
  `# ${TITLE}`,
  '',
  'Lead-in prose that frames the document before any chapter starts.',
  '',
  '## Snapshot',
  '',
  prose(700),
  '',
  '## Risk',
  '',
  prose(700),
  '',
].join('\n');

/**
 * The smallest D1 that answers `ideaById()`. Every other statement returns
 * nothing, which is all these read paths need.
 */
function envFor(idea: Record<string, unknown> | null): Env {
  const statement = (sql: string) => ({
    bind: () => statement(sql),
    first: async () => (sql.includes('FROM ideas i') ? idea : null),
    all: async () => ({ results: [] }),
    run: async () => ({ success: true }),
  });
  return { DB: { prepare: (sql: string) => statement(sql) } } as unknown as Env;
}

const IDEA = {
  id: 'cellar-door-cycling',
  title: TITLE,
  summary: 'A cycling route between cellar doors.',
  status: 'published',
  body_md: BODY,
};

async function get(path: string, idea: Record<string, unknown> | null = IDEA) {
  const url = new URL(`https://fis.test${path}`);
  const response = await handleApi(new Request(url), envFor(idea), url);
  return { status: response.status, data: (await response.json()) as Record<string, any> };
}

describe('read paths carry the document budget (#46)', () => {
  it('returns usage on GET /api/ideas/:id', async () => {
    const { data } = await get('/api/ideas/cellar-door-cycling');

    expect(data.usage).toEqual({
      chars: BODY.length,
      chars_remaining: FIELD_LIMITS.body - BODY.length,
      chapters: 2,
      chapters_remaining: FIELD_LIMITS.chapters - 2,
      below_floor: 0,
      above_ceiling: 0,
    });
  });

  it('returns usage on GET /api/ideas/:id/sections', async () => {
    const { data } = await get('/api/ideas/cellar-door-cycling/sections');

    expect(data.sections.map((section: { id: string }) => section.id)).toEqual(['snapshot', 'risk']);
    expect(data.usage).toEqual({
      chars: BODY.length,
      chars_remaining: FIELD_LIMITS.body - BODY.length,
      chapters: 2,
      chapters_remaining: FIELD_LIMITS.chapters - 2,
      below_floor: 0,
      above_ceiling: 0,
    });
  });

  /**
   * The budget describes the DOCUMENT, not the slice this call returned.
   * Computing it from the trimmed body would report `chars: 63` on a 9,000
   * character document and tell the caller it has the whole budget left.
   */
  it('measures the whole document even when the caller asked for no body', async () => {
    const none = await get('/api/ideas/cellar-door-cycling?body=none');
    const full = await get('/api/ideas/cellar-door-cycling?body=full');

    expect(none.data.usage.chars).toBe(BODY.length);
    expect(none.data.usage).toEqual(full.data.usage);
  });
});

describe('GET /api/ideas/:id serves only the body that was asked for (#66)', () => {
  it('still returns the whole document by default, for the browser and the JSON link', async () => {
    const { data } = await get('/api/ideas/cellar-door-cycling');

    expect(data.body).toBe(BODY);
    expect(data.body_view).toBe('full');
  });

  it('returns body: null — present, not omitted — at body=none', async () => {
    const { data } = await get('/api/ideas/cellar-door-cycling?body=none');

    expect('body' in data).toBe(true);
    expect(data.body).toBeNull();
    expect(data.body_view).toBe('none');
  });

  it('returns the lead-in and nothing else at body=preamble', async () => {
    const { data } = await get('/api/ideas/cellar-door-cycling?body=preamble');

    expect(data.body).toBe(ideaPreamble(BODY, TITLE));
    expect(data.body).toContain('Lead-in prose that frames the document');
    // The chapters are the point: none of them may come back with the lead-in.
    expect(data.body).not.toContain('## Snapshot');
    expect(data.body).not.toContain('## Risk');
    expect(data.body!.length).toBeLessThan(BODY.length / 10);
  });

  it('lists the chapters at every view, so body=none is a usable answer', async () => {
    for (const view of ['none', 'preamble', 'full']) {
      const { data } = await get(`/api/ideas/cellar-door-cycling?body=${view}`);
      expect(data.sections.map((section: { id: string }) => section.id)).toEqual(['snapshot', 'risk']);
    }
  });

  /**
   * A typo that silently falls back to `full` returns the megabyte this
   * parameter exists to withhold.
   */
  it('rejects an unknown view instead of falling back to the whole document', async () => {
    const { status, data } = await get('/api/ideas/cellar-door-cycling?body=summary');

    expect(status).toBe(400);
    expect(data.error).toContain('body must be one of none, preamble, full');
    expect(JSON.stringify(data)).not.toContain('Snapshot');
  });

  it('still 404s an unknown idea', async () => {
    const { status } = await get('/api/ideas/no-such-idea', null);

    expect(status).toBe(404);
  });
});
