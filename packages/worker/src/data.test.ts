import { describe, expect, it } from 'vitest';
import { contributionsByProfile } from './data';
import type { Env } from './types';

/** Captures the SQL a data helper sends; returns no rows. */
function capturingEnv() {
  const queries: string[] = [];
  const statement = { bind: () => statement, all: async () => ({ results: [] }), first: async () => null };
  const env = { DB: { prepare: (sql: string) => (queries.push(sql), statement) } } as unknown as Env;
  return { env, queries };
}

describe('contributionsByProfile', () => {
  it('leaves out contributions to removed ideas (#104)', async () => {
    // Every other profile query excludes removed ideas. This one fed the public
    // contributor page and the account page, so the titles of removed ideas
    // kept appearing there with links that answer 410.
    const { env, queries } = capturingEnv();

    await contributionsByProfile(env, 'profile-1');

    expect(queries[0]).toContain("i.status != 'removed'");
  });
});
