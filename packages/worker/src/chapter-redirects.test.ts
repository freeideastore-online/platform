import { describe, expect, it } from 'vitest';
import { syncChapterRedirects } from './chapter-redirects';
import type { Env } from './types';

/**
 * A D1 stand-in that enforces the one limit this module tripped over: at most
 * 100 bound parameters per statement. Everything else is a no-op.
 */
function boundedDb() {
  const statements: Array<{ sql: string; binds: unknown[] }> = [];
  const db = {
    prepare(sql: string) {
      const statement = { sql, binds: [] as unknown[] };
      statements.push(statement);
      const handle = {
        bind(...values: unknown[]) {
          if (values.length > 100) throw new Error(`too many SQL variables: ${values.length}`);
          statement.binds = values;
          return handle;
        },
        run: async () => ({ success: true }),
        all: async () => ({ results: [] }),
        first: async () => null,
      };
      return handle;
    },
  };
  return { env: { DB: db } as unknown as Env, statements };
}

describe('syncChapterRedirects', () => {
  it('stays under D1’s 100-parameter limit at the chapter cap (#104)', async () => {
    // Titles whose canonical id differs from their slug give each chapter two
    // aliases: 100 chapters → 200 live aliases.
    const body = Array.from({ length: 100 }, (_, i) => `## Competitor ${i + 1}\nBody ${i}.`).join('\n\n');
    const { env, statements } = boundedDb();

    await expect(syncChapterRedirects(env, 'idea', '', body, 'Doc')).resolves.toBeUndefined();
    expect(Math.max(...statements.map((statement) => statement.binds.length))).toBeLessThanOrEqual(100);
  });
});
