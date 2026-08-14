import { afterEach, describe, expect, it, vi } from 'vitest';
import { authUserFor, handleAuth } from './auth';
import { updateIdea } from './api-idea-mutations';
import { upsertIdentity } from './identities';
import { mintSession } from './session';
import type { ProviderProfile } from './oauth-providers';
import type { Env, IdentityRow } from './types';

/**
 * #38: identity comes from FIS's own `identities` table and from nothing else.
 *
 * PR #85 closed the handle takeover on the identity path — `availableHandle`
 * reserves any handle either table holds, `claimableProfileHandle` is the only
 * way onto a legacy profile, and #91 made that claim bind for a returning
 * identity too. None of it was reachable from the second entrance:
 * `authUserFor` fell through to an external `/v1/auth/me`, slugged whatever
 * login came back, and returned that as the caller's handle with no identity row
 * anywhere in the story. Authorization follows the handle — `ownedIdea` resolves
 * `contributorByHandle(user.handle)` to `profile-<handle>` and compares it
 * against `ideas.created_by` — so a foreign account whose login slugged to
 * `simon` passed the owner check on `profile-simon`'s ideas.
 *
 * These tests are in two halves:
 *
 *  - the entrance is gone, and cannot come back unnoticed;
 *  - the guards it bypassed still hold now that it has gone.
 *
 * Every one of them was checked against the code it guards: reverting the
 * fallback, the reservation, or the claim re-check turns the relevant
 * assertions red on the real behaviour, not on an incidental crash. The failures
 * are recorded in the pull request.
 */

const SIGNING_KEY = 'test-signing-key';

/** Anything shaped like a token but not signed by this store: a pre-cutover session. */
const FOREIGN_TOKEN = 'eyJzdWIiOiJzaW1vbiJ9.not-a-signature-this-store-made';

const SIMON_IDENTITY: IdentityRow = {
  id: 'identity-simon',
  provider: 'github',
  provider_user_id: '9001',
  handle: 'simon',
  display_name: 'Simon',
  avatar_url: null,
  email: 'simon@example.com',
  email_verified: 1,
  created_at: '2026-07-01 09:19:36',
  updated_at: '2026-07-01 09:19:36',
};

/**
 * A database in the shape production is in: `profile-simon` owns an idea, and
 * whether an identity row stands behind that handle is the variable under test.
 *
 * The identity map is a parameter because that is precisely the difference the
 * removed path erased. Before #38 a caller could hold `simon` with the map
 * empty; now the map is the only source of a handle.
 */
function fakeEnv(identities: IdentityRow[] = []) {
  const byId = new Map(identities.map((row) => [row.id, row]));
  const statements: string[] = [];

  const run = (sql: string, args: unknown[]) => {
    const q = sql.replace(/\s+/g, ' ').trim();
    statements.push(q);
    if (q.startsWith('SELECT * FROM identities WHERE id =')) return byId.get(String(args[0])) ?? null;
    if (q.includes('FROM profiles p') && q.includes('WHERE p.handle = ?')) {
      // `contributorByHandle`. The profile row exists whatever the identities
      // table says — that is what makes a legacy profile a legacy profile.
      return args[0] === 'simon'
        ? { id: 'profile-simon', handle: 'simon', display_name: 'Simon', reputation: 0, badges_json: '[]' }
        : null;
    }
    if (q.includes('FROM ideas i') && q.includes('WHERE i.id = ?')) {
      return {
        id: 'requirements-base',
        title: 'Requirements Base',
        summary: 'Simon owns this.',
        body_md: '## Snapshot\nSimon wrote this.\n',
        body_key: '',
        stage: 'researching',
        category: 'research',
        next_step: '',
        risk: '',
        created_by: 'profile-simon',
        parent_id: '',
        status: 'active',
        pro_candidate: 0,
        created_at: '2026-07-01 09:19:36',
        updated_at: '2026-07-01 09:19:36',
        support: 0,
        trash: 0,
        pivot: 0,
        contribution_count: 0,
      };
    }
    // Anything else answers "nothing there", which is truthful for a database
    // holding one profile and one idea. Writes are not reached by these tests:
    // every one of them stops at or before the owner check.
    return null;
  };

  const env = {
    DB: {
      prepare(sql: string) {
        return {
          bind: (...args: unknown[]) => ({
            first: async () => run(sql, args),
            all: async () => ({ results: [] }),
            run: async () => run(sql, args),
          }),
          first: async () => run(sql, []),
          all: async () => ({ results: [] }),
          run: async () => run(sql, []),
        };
      },
    },
    SESSION_SIGNING_KEY: SIGNING_KEY,
  } as unknown as Env;

  return { env, statements };
}

/**
 * Fails the test if anything reaches the network.
 *
 * This is the assertion, not scaffolding. The removed code path was a `fetch` to
 * another store on every authenticated request, so "no outbound call happens" is
 * the behaviour, and it is also the latency claim #38 makes. Returning a
 * plausible auth payload instead of throwing is deliberate: it means restoring
 * the fallback does not crash here, it *succeeds* — and the tests below then
 * fail on the takeover they describe rather than on a stubbed-fetch error.
 */
function forbidNetwork() {
  const fetchSpy = vi.fn(async () =>
    Response.json({ user: { login: 'simon', name: 'Simon', provider: 'github' } }),
  );
  vi.stubGlobal('fetch', fetchSpy);
  return fetchSpy;
}

const patch = (token: string, body = '{"summary":"taken over"}') =>
  new Request('https://fis.test/api/ideas/requirements-base', {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body,
  });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('a session this store did not sign is nobody (#38)', () => {
  it('resolves a pre-cutover token to no user, without asking anyone else', async () => {
    const fetchSpy = forbidNetwork();
    const { env } = fakeEnv([SIMON_IDENTITY]);

    const user = await authUserFor(
      new Request('https://fis.test/api/me/ideas', {
        headers: { Authorization: `Bearer ${FOREIGN_TOKEN}` },
      }),
      env,
    );

    expect(user).toBeNull();
    // The whole dependency, in one assertion: FIS answers "who is this?" alone.
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('refuses a validly signed session whose identity row does not exist', async () => {
    // Signature and identity are two separate facts. A token minted for a row
    // that has since been deleted must not resolve to a handle derived from
    // anything else — there is nothing else left to derive one from.
    const { env } = fakeEnv([]);
    const token = await mintSession('identity-simon', SIGNING_KEY);

    const user = await authUserFor(
      new Request('https://fis.test/api/me/ideas', { headers: { Authorization: `Bearer ${token}` } }),
      env,
    );

    expect(user).toBeNull();
  });

  it('takes the handle from the identity row, never from the request', async () => {
    const { env } = fakeEnv([SIMON_IDENTITY]);
    const token = await mintSession('identity-simon', SIGNING_KEY);

    const user = await authUserFor(
      new Request('https://fis.test/api/me/ideas', {
        headers: { Authorization: `Bearer ${token}`, 'x-idea-handle': 'serge-ivo' },
      }),
      env,
    );

    expect(user).toMatchObject({ handle: 'simon', displayName: 'Simon', provider: 'github' });
  });
});

/**
 * The vector #85 flagged and could not close from its side, as behaviour.
 *
 * `profile-simon` is a real production row: one idea, no identity. The attacker
 * holds an account at the store FIS used to borrow identity from, whose login
 * slugs to `simon`.
 */
describe('the fallback takeover of an unclaimed legacy profile (#42)', () => {
  it('refuses the write, because the token resolves to nobody', async () => {
    forbidNetwork();
    const { env } = fakeEnv([]);

    const response = await updateIdea(patch(FOREIGN_TOKEN), env, 'requirements-base');

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: 'authentication required' });
  });

  it('still lets the identity that legitimately holds the handle through the owner check', async () => {
    // The control for the test above: the same request, the same profile, the
    // same idea — and a session FIS signed for the identity row that holds
    // `simon`. It gets past 401 and past the 403 owner check and stops at body
    // parsing, which is how this test proves the refusal above is about identity
    // and not about the fixture being unwritable.
    const { env } = fakeEnv([SIMON_IDENTITY]);
    const token = await mintSession('identity-simon', SIGNING_KEY);

    const response = await updateIdea(patch(token, 'not json at all'), env, 'requirements-base');

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: 'request body is not valid JSON' });
  });

  it('refuses a token signed with another store\'s key', async () => {
    // #34, as a test. The failure mode that started all of this was two workers
    // holding copies of one key; a token that verifies under any key but this
    // one must be worth nothing here.
    forbidNetwork();
    const { env } = fakeEnv([SIMON_IDENTITY]);
    const foreignlySigned = await mintSession('identity-simon', 'some-other-stores-key');

    const response = await updateIdea(patch(foreignlySigned), env, 'requirements-base');

    expect(response.status).toBe(401);
  });
});

describe('no route hands out or accepts a foreign session (#38)', () => {
  const auth = (path: string, env?: Env, init?: RequestInit) => {
    const url = new URL(`https://fis.test${path}`);
    return handleAuth(new Request(url.toString(), init), url, env);
  };

  it('has no unqualified callback that can write a token into the session cookie', async () => {
    // `/.fis/auth/callback` used to take `?session=`/`?fas_session=` off the
    // query string, ask the other store whether it was any good, and store it
    // verbatim in `__Host-fis_session`. Deleted, not disabled: the path is not
    // a route any more.
    const fetchSpy = forbidNetwork();
    const { env } = fakeEnv([SIMON_IDENTITY]);

    const response = await auth(
      `/.fis/auth/callback?nonce=n&session=${FOREIGN_TOKEN}&fas_session=${FOREIGN_TOKEN}&return_to=/console/`,
      env,
      { headers: { Cookie: '__Host-fis_auth_nonce=n' } },
    );

    expect(response?.status).toBe(404);
    expect(response?.headers.get('set-cookie')).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('refuses to start sign-in it cannot finish, instead of delegating it', async () => {
    // A deploy missing the provider client or the signing key used to redirect
    // to the other store's `/v1/auth/{provider}/start`. Now there is nowhere
    // else to send anyone.
    const { env } = fakeEnv([]);
    const unconfigured = { ...env, SESSION_SIGNING_KEY: undefined } as unknown as Env;

    const response = await auth('/.fis/auth/start?provider=github&return_to=/console/', unconfigured);

    expect(response?.status).toBe(503);
    expect(response?.headers.get('location')).toBeNull();
  });

  it('clears the cookie when a pre-cutover session no longer resolves', async () => {
    // Otherwise every page load for the next 30 days retries a token that can
    // never work again.
    const fetchSpy = forbidNetwork();
    const { env } = fakeEnv([SIMON_IDENTITY]);

    const response = await auth('/.fis/auth/me', env, {
      headers: { Cookie: `__Host-fis_session=${FOREIGN_TOKEN}` },
    });

    expect(response?.status).toBe(401);
    expect(response?.headers.get('set-cookie')).toContain('__Host-fis_session=; Max-Age=0');
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

/**
 * The other half: the guards the fallback bypassed have to still work now that
 * it is the only way in.
 *
 * This fake is the one from `identity-claims.test.ts`, trimmed to what these two
 * tests need and loose for the same recorded reason — it honours `NOT EXISTS`
 * and `email_verified = 1` only when the query asks for them, so deleting either
 * clause fails a test here instead of being invisibly compensated for.
 */
function identityEnv() {
  const identities: IdentityRow[] = [];
  const profiles: Array<{ id: string; handle: string; claim_email: string | null; created_at: string }> = [];

  const run = (sql: string, args: unknown[]) => {
    const q = sql.replace(/\s+/g, ' ').trim();
    if (q.startsWith('SELECT * FROM identities WHERE id =')) return identities.find((r) => r.id === args[0]) ?? null;
    if (q.startsWith('SELECT * FROM identities WHERE provider =')) {
      return identities.find((r) => r.provider === args[0] && r.provider_user_id === args[1]) ?? null;
    }
    if (/^SELECT 1 FROM (identities|profiles) WHERE handle =/.test(q)) {
      const held =
        (q.includes('FROM identities') && identities.some((r) => r.handle === args[0])) ||
        (q.includes('FROM profiles') && profiles.some((p) => p.handle === args[args.length - 1]));
      return held ? { 1: 1 } : null;
    }
    if (q.startsWith('SELECT p.handle FROM profiles p WHERE p.claim_email =')) {
      const singleUse = q.includes('NOT EXISTS');
      const match = profiles
        .filter(
          (p) => p.claim_email === args[0] && (!singleUse || !identities.some((i) => i.handle === p.handle)),
        )
        .sort((a, b) => a.created_at.localeCompare(b.created_at))[0];
      return match ? { handle: match.handle } : null;
    }
    if (q.startsWith('SELECT handle FROM identities WHERE email =')) {
      const requiresVerified = q.includes('email_verified = 1');
      const match = identities
        .filter((r) => r.email === args[0] && (!requiresVerified || r.email_verified === 1))
        .sort((a, b) => a.created_at.localeCompare(b.created_at))[0];
      return match ? { handle: match.handle } : null;
    }
    const update = /^UPDATE identities SET (.+) WHERE id = \?$/.exec(q);
    if (update?.[1]) {
      const columns = update[1]
        .split(',')
        .map((part) => part.trim())
        .filter((part) => part.endsWith('= ?'))
        .map((part) => part.slice(0, part.indexOf('=')).trim());
      const row = identities.find((r) => r.id === args[columns.length]);
      if (row) columns.forEach((column, index) => ((row as unknown as Record<string, unknown>)[column] = args[index]));
      return null;
    }
    if (q.startsWith('INSERT INTO identities')) {
      identities.push({
        id: args[0] as string,
        provider: args[1] as string,
        provider_user_id: args[2] as string,
        handle: args[3] as string,
        display_name: args[4] as string,
        avatar_url: args[5] as string | null,
        email: args[6] as string | null,
        email_verified: args[7] as number,
        created_at: String(identities.length).padStart(4, '0'),
        updated_at: 'now',
      });
      return null;
    }
    if (q.startsWith('INSERT OR IGNORE INTO profiles')) {
      if (!profiles.some((p) => p.handle === args[1])) {
        profiles.push({
          id: args[0] as string,
          handle: args[1] as string,
          claim_email: null,
          created_at: String(profiles.length).padStart(4, '0'),
        });
      }
      return null;
    }
    throw new Error(`unexpected SQL: ${q}`);
  };

  const env = {
    DB: {
      prepare: (sql: string) => ({
        bind: (...args: unknown[]) => ({
          first: async () => run(sql, args),
          run: async () => run(sql, args),
        }),
      }),
    },
    SESSION_SIGNING_KEY: SIGNING_KEY,
  } as unknown as Env;

  const seedLegacyProfile = (handle: string) =>
    profiles.push({
      id: `profile-${handle}`,
      handle,
      claim_email: null,
      created_at: String(profiles.length).padStart(4, '0'),
    });
  const recordClaim = (handle: string, email: string) => {
    const profile = profiles.find((p) => p.handle === handle);
    if (!profile) throw new Error(`no profile ${handle}`);
    profile.claim_email = email;
  };

  return { env, identities, seedLegacyProfile, recordClaim };
}

const account = (handle: string, id: string, email: string | null = null, emailVerified = false): ProviderProfile => ({
  provider: 'github',
  providerUserId: id,
  handle,
  displayName: handle,
  avatarUrl: null,
  email,
  emailVerified,
});

describe('the guards the fallback bypassed still hold (#85, #91)', () => {
  it('reserves a legacy profile against a stranger whose login slugs to it', async () => {
    // #85. `simon` and `fis-mcp` are profiles with work under them and no
    // identity; both are reserved by the `profiles` half of the availability
    // probe, so a new account is suffixed rather than handed the profile.
    const { env, seedLegacyProfile } = identityEnv();
    seedLegacyProfile('simon');
    seedLegacyProfile('fis-mcp');

    const stranger = await upsertIdentity(env, account('simon', 'gh-1'));
    const service = await upsertIdentity(env, account('fis-mcp', 'gh-2'));

    expect(stranger.handle).toBe('simon-github');
    expect(service.handle).toBe('fis-mcp-github');
  });

  it('will not let a verified email alone claim a profile nobody recorded a claim on', async () => {
    // The claim has to come from a human writing `claim_email`. An address the
    // provider vouches for is necessary and nowhere near sufficient.
    const { env, seedLegacyProfile } = identityEnv();
    seedLegacyProfile('simon');

    const mallory = await upsertIdentity(env, account('simon', 'gh-3', 'mallory@example.com', true));

    expect(mallory.handle).toBe('simon-github');
  });

  it('binds a claim recorded after the sign-in, on the next sign-in', async () => {
    // #91. The operator repair only ever happens after the contributor has
    // noticed their work is missing, i.e. after they already have an identity.
    const { env, seedLegacyProfile, recordClaim } = identityEnv();
    seedLegacyProfile('simon');

    const first = await upsertIdentity(env, account('simon-renamed', 'gh-4', 'simon@example.com', true));
    expect(first.handle).toBe('simon-renamed');

    recordClaim('simon', 'simon@example.com');
    const second = await upsertIdentity(env, account('simon-renamed', 'gh-4', 'simon@example.com', true));

    expect(second.id).toBe(first.id);
    expect(second.handle).toBe('simon');
  });

  it('will not bind a claim to an address the provider has not verified', async () => {
    const { env, seedLegacyProfile, recordClaim } = identityEnv();
    seedLegacyProfile('simon');
    recordClaim('simon', 'simon@example.com');

    // Same address, `emailVerified` false — anyone can type an email into a
    // provider profile, and that is the entire reason this flag exists.
    const mallory = await upsertIdentity(env, account('mallory', 'gh-5', 'simon@example.com', false));

    expect(mallory.handle).toBe('mallory');
  });
});
