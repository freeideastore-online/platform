import { describe, expect, it } from 'vitest';
import {
  contributionsByProfile,
  contributorByHandle,
  derivedIdeas,
  ideasByProfile,
  listContributors,
  listIdeas,
  parentIdea,
} from './data';
import { sourceCitations } from './sources';
import type { Env } from './types';

/** Captures the SQL a data helper sends; returns no rows. */
function capturingEnv() {
  const queries: string[] = [];
  const statement = { bind: () => statement, all: async () => ({ results: [] }), first: async () => ({ id: 's', url: 'u', host: 'h', status: 200, last_checked: '', n: 0 }) };
  const env = { DB: { prepare: (sql: string) => (queries.push(sql), statement) } } as unknown as Env;
  return { env, queries };
}

const PUBLIC = "visibility = 'public'";

describe('contributionsByProfile', () => {
  it('leaves out contributions to removed ideas (#104)', async () => {
    // Every other profile query excludes removed ideas. This one fed the public
    // contributor page and the account page, so the titles of removed ideas
    // kept appearing there with links that answer 410.
    const { env, queries } = capturingEnv();

    await contributionsByProfile(env, 'profile-1');

    expect(queries[0]).toContain("i.status != 'removed'");
  });

  it('leaves out contributions to unlisted ideas, unless asked for the owner’s own view (#108)', async () => {
    const publicView = capturingEnv();
    const ownView = capturingEnv();

    await contributionsByProfile(publicView.env, 'profile-1');
    await contributionsByProfile(ownView.env, 'profile-1', 100, { includeUnlisted: true });

    expect(publicView.queries[0]).toContain(`i.${PUBLIC}`);
    expect(ownView.queries[0]).not.toContain(PUBLIC);
  });
});

describe('every listing filters on visibility (#108)', () => {
  it.each([
    ['listIdeas', (env: Env) => listIdeas(env, { stage: 'all' })],
    ['derivedIdeas', (env: Env) => derivedIdeas(env, 'parent')],
    ['parentIdea', (env: Env) => parentIdea(env, 'parent')],
    ['listContributors', (env: Env) => listContributors(env)],
    ['contributorByHandle', (env: Env) => contributorByHandle(env, 'someone')],
    ['ideasByProfile', (env: Env) => ideasByProfile(env, 'profile-1')],
    ['sourceCitations', (env: Env) => sourceCitations(env, 'source-1')],
  ])('%s asks for public ideas only', async (_name, run) => {
    const { env, queries } = capturingEnv();

    await run(env);

    expect(queries.length).toBeGreaterThan(0);
    // Every statement that touches ideas carries the filter (the source lookup
    // that precedes sourceCitations' listing does not).
    const listing = queries.filter((sql) => /\bideas\b/.test(sql));
    expect(listing.length).toBeGreaterThan(0);
    for (const sql of listing) expect(sql).toContain(PUBLIC);
  });

  it('counts only public ideas in a contributor’s idea_count, so the number matches what the page lists', async () => {
    const list = capturingEnv();
    const one = capturingEnv();

    await listContributors(list.env);
    await contributorByHandle(one.env, 'someone');

    expect(list.queries[0]).toContain(`i.${PUBLIC}`);
    expect(one.queries[0]).toContain(`i.${PUBLIC}`);
  });

  it('lets the owner’s own list include unlisted ideas, and only when asked', async () => {
    const publicView = capturingEnv();
    const ownView = capturingEnv();

    await ideasByProfile(publicView.env, 'profile-1');
    await ideasByProfile(ownView.env, 'profile-1', 500, { includeUnlisted: true });

    expect(publicView.queries[0]).toContain(PUBLIC);
    expect(ownView.queries[0]).not.toContain(PUBLIC);
  });
});
