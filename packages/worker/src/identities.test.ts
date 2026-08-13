import { describe, expect, it } from 'vitest';
import { authorizeUrl, isProviderId, type ProviderProfile } from './oauth-providers';
import { authUserFromIdentity, identityById, upsertIdentity } from './identities';
import type { Env, IdentityRow } from './types';

// Minimal D1 stand-in: enough to exercise the identity queries without a real
// database. Matching on the SQL text is crude, but it keeps the fake honest —
// change a query and the test fails rather than silently passing.
type FakeProfile = { id: string; handle: string; claim_email: string | null; created_at: string };

function fakeEnv() {
  const identities: IdentityRow[] = [];
  const profiles: FakeProfile[] = [];

  const run = (sql: string, args: unknown[]) => {
    const q = sql.replace(/\s+/g, ' ').trim();
    if (q.startsWith('SELECT * FROM identities WHERE id =')) {
      return identities.find((r) => r.id === args[0]) ?? null;
    }
    if (q.startsWith('SELECT * FROM identities WHERE provider =')) {
      return identities.find((r) => r.provider === args[0] && r.provider_user_id === args[1]) ?? null;
    }
    // The availability probe (#42). This answers from exactly the tables the
    // query names, and is deliberately looser than the rest of the fake.
    //
    // Being strict here would make the takeover test un-discriminating in the
    // worst way: revert `availableHandle` to its old identities-only probe and
    // a strict matcher throws `unexpected SQL`, so the test goes red without
    // ever exercising the behaviour it claims to prove — it would be red for a
    // one-table query and red for a takeover alike, and could not tell them
    // apart. Answering truthfully from whichever tables are named means the
    // reverted query runs, reports the legacy handle free, and the assertion
    // fails on the stranger walking onto `simon`, which is the actual claim.
    if (/^SELECT 1 FROM (identities|profiles) WHERE handle =/.test(q)) {
      const held =
        (q.includes('FROM identities') && identities.some((r) => r.handle === args[0])) ||
        (q.includes('FROM profiles') && profiles.some((p) => p.handle === args[args.length - 1]));
      return held ? { 1: 1 } : null;
    }
    if (q.startsWith('SELECT p.handle FROM profiles p WHERE p.claim_email =')) {
      // NOT EXISTS against identities is part of the query, not an afterthought:
      // the fake has to enforce it or the test proving a claim is single-use
      // would pass against a lookup that had quietly dropped the condition.
      const match = profiles
        .filter(
          (p) => p.claim_email === args[0] && !identities.some((i) => i.handle === p.handle),
        )
        .sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id))[0];
      return match ? { handle: match.handle } : null;
    }
    if (q.startsWith('SELECT handle FROM identities WHERE email =')) {
      // email_verified = 1 is part of the query, not an afterthought: the fake
      // has to enforce it or the test proving unverified addresses do not link
      // would pass against a lookup that had quietly dropped the condition.
      const match = identities
        .filter((r) => r.email === args[0] && r.email_verified === 1)
        .sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id))[0];
      return match ? { handle: match.handle } : null;
    }
    if (q.startsWith('UPDATE identities SET display_name')) {
      const row = identities.find((r) => r.id === args[4]);
      if (row) {
        row.display_name = args[0] as string;
        row.avatar_url = args[1] as string | null;
        row.email = args[2] as string | null;
        row.email_verified = args[3] as number;
      }
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
        // Insertion order stands in for wall-clock: identities created later in
        // a test sort later, which is what the oldest-match tie-break needs.
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
      prepare(sql: string) {
        return {
          bind(...args: unknown[]) {
            return {
              first: async () => run(sql, args),
              run: async () => run(sql, args),
            };
          },
        };
      },
    },
  } as unknown as Env;

  /**
   * A pre-cutover contributor: a `profiles` row with work under it and no
   * identity behind it, exactly what the FreeAppStore era left in the database.
   * `claimEmail` is the address an operator has recorded as the owner's, and is
   * null for the profiles nobody has established an owner for.
   */
  const seedLegacyProfile = (handle: string, claimEmail: string | null = null) => {
    profiles.push({
      id: `profile-${handle}`,
      handle,
      claim_email: claimEmail,
      created_at: String(profiles.length).padStart(4, '0'),
    });
  };

  return { env, identities, profiles, seedLegacyProfile };
}

const github = (id: string, handle: string): ProviderProfile => ({
  provider: 'github',
  providerUserId: id,
  handle,
  displayName: handle,
  avatarUrl: null,
  email: null,
  emailVerified: false,
});

const google = (id: string, handle: string): ProviderProfile => ({
  provider: 'google',
  providerUserId: id,
  handle,
  displayName: handle,
  avatarUrl: null,
  email: null,
  emailVerified: false,
});

const verified = (profile: ProviderProfile, email: string): ProviderProfile => ({
  ...profile,
  email,
  emailVerified: true,
});

describe('identity upsert', () => {
  it('creates an identity and claims the matching profile', async () => {
    const { env, profiles } = fakeEnv();
    const row = await upsertIdentity(env, github('1', 'alice'));
    expect(row.handle).toBe('alice');
    expect(row.provider).toBe('github');
    expect(profiles.map((p) => p.id)).toEqual(['profile-alice']);
  });

  it('returns the same identity on repeat sign-in', async () => {
    const { env, identities } = fakeEnv();
    const first = await upsertIdentity(env, github('1', 'alice'));
    const second = await upsertIdentity(env, github('1', 'alice'));
    expect(second.id).toBe(first.id);
    expect(identities).toHaveLength(1);
  });

  it('keeps the handle when the provider login changes', async () => {
    // Renaming on GitHub must not strand the contributor's history, which is
    // keyed on profile-<handle>. Matching is on the immutable provider id.
    const { env } = fakeEnv();
    const first = await upsertIdentity(env, github('1', 'alice'));
    const renamed = await upsertIdentity(env, { ...github('1', 'alice-new'), displayName: 'Alice New' });
    expect(renamed.id).toBe(first.id);
    expect(renamed.handle).toBe('alice');
    expect(renamed.display_name).toBe('Alice New');
  });

  it('does not let a second person take an existing handle', async () => {
    // Two different GitHub accounts that slug to the same handle. Sharing it
    // would merge two people's contributions under one profile.
    const { env } = fakeEnv();
    const alice = await upsertIdentity(env, github('1', 'alice'));
    const impostor = await upsertIdentity(env, github('2', 'alice'));
    expect(impostor.id).not.toBe(alice.id);
    expect(impostor.handle).toBe('alice-github');
    expect(impostor.handle).not.toBe(alice.handle);
  });

  it('falls back to counting when the qualified handle is also taken', async () => {
    const { env } = fakeEnv();
    await upsertIdentity(env, github('1', 'alice'));
    await upsertIdentity(env, github('2', 'alice'));
    const third = await upsertIdentity(env, github('3', 'alice'));
    expect(third.handle).toBe('alice-2');
  });

  it('separates identities from different providers with the same id', async () => {
    const { env } = fakeEnv();
    const gh = await upsertIdentity(env, github('1', 'alice'));
    const goog = await upsertIdentity(env, { ...google('1', 'bob'), displayName: 'Bob' });
    expect(goog.id).not.toBe(gh.id);
    expect(goog.provider).toBe('google');
  });

  it('round-trips through identityById and authUserFromIdentity', async () => {
    const { env } = fakeEnv();
    const row = await upsertIdentity(env, { ...github('1', 'alice'), displayName: 'Alice', avatarUrl: 'https://x/a.png' });
    const found = await identityById(env, row.id);
    expect(found).not.toBeNull();
    expect(authUserFromIdentity(found as IdentityRow)).toEqual({
      handle: 'alice',
      displayName: 'Alice',
      provider: 'github',
      avatarUrl: 'https://x/a.png',
    });
  });
});

describe('account linking on a verified email', () => {
  it('lands both providers on one handle and one profile', async () => {
    // The #40 scenario: the same human signs in with GitHub, then with Google.
    // The Google handle derives from the email local part and would otherwise
    // mint a second, empty contributor profile.
    const { env, identities, profiles } = fakeEnv();
    const gh = await upsertIdentity(env, verified(github('1', 'serge-ivo'), 'serge@example.com'));
    const goog = await upsertIdentity(
      env,
      verified(google('sub-1', 'serge-the-dev'), 'serge@example.com'),
    );
    expect(goog.id).not.toBe(gh.id);
    expect(goog.handle).toBe('serge-ivo');
    expect(identities).toHaveLength(2);
    // One profile, so contributions from either sign-in attribute to the same
    // contributor page. A second row here is exactly the data loss in #40.
    expect(profiles.map((p) => p.id)).toEqual(['profile-serge-ivo']);
  });

  it('does NOT link an unverified email', async () => {
    // The whole security argument. If this passes by linking, anyone can take
    // over any account by putting its address on a throwaway provider account.
    const { env, profiles } = fakeEnv();
    const alice = await upsertIdentity(env, verified(github('1', 'alice'), 'alice@example.com'));
    const attacker = await upsertIdentity(env, {
      ...google('sub-666', 'mallory'),
      email: 'alice@example.com',
      emailVerified: false,
    });
    expect(attacker.handle).toBe('mallory');
    expect(attacker.handle).not.toBe(alice.handle);
    expect(profiles.map((p) => p.handle)).toEqual(['alice', 'mallory']);
  });

  it('does NOT link to a stored identity whose email was never verified', async () => {
    // The other half of the same condition: the *stored* row must be verified
    // too, not just the incoming profile.
    const { env } = fakeEnv();
    await upsertIdentity(env, {
      ...github('1', 'alice'),
      email: 'alice@example.com',
      emailVerified: false,
    });
    const later = await upsertIdentity(env, verified(google('sub-1', 'bob'), 'alice@example.com'));
    expect(later.handle).toBe('bob');
  });

  it('still varies the handle for two people with no email match', async () => {
    // Linking must not weaken the collision guard: different verified addresses
    // are positive evidence these are different people.
    const { env } = fakeEnv();
    const alice = await upsertIdentity(env, verified(github('1', 'alice'), 'alice@example.com'));
    const other = await upsertIdentity(env, verified(github('2', 'alice'), 'other@example.com'));
    expect(other.id).not.toBe(alice.id);
    expect(other.handle).toBe('alice-github');
  });

  it('keeps a returning identity on its own handle even when an email match exists', async () => {
    // (provider, provider_user_id) wins. Otherwise a person who changed their
    // verified address to one someone else already holds would be silently
    // moved onto that person's profile on their next sign-in.
    const { env } = fakeEnv();
    const alice = await upsertIdentity(env, verified(github('1', 'alice'), 'alice@example.com'));
    const bob = await upsertIdentity(env, verified(google('sub-2', 'bob'), 'bob@example.com'));
    const bobAgain = await upsertIdentity(env, verified(google('sub-2', 'bob'), 'alice@example.com'));
    expect(bobAgain.id).toBe(bob.id);
    expect(bobAgain.handle).toBe('bob');
    expect(bobAgain.handle).not.toBe(alice.handle);
  });

  it('adopts the oldest linkable identity when several match', async () => {
    const { env } = fakeEnv();
    const first = await upsertIdentity(env, verified(github('1', 'alice'), 'alice@example.com'));
    await upsertIdentity(env, verified(github('2', 'alice-two'), 'alice@example.com'));
    const third = await upsertIdentity(env, verified(google('sub-3', 'zzz'), 'alice@example.com'));
    expect(third.handle).toBe(first.handle);
  });

  it('backfills the email of a pre-linking identity on the next sign-in', async () => {
    // Rows created before 0017 carry no email, so they cannot be linked to until
    // their owner signs in again — this is what makes that sign-in count.
    const { env } = fakeEnv();
    await upsertIdentity(env, github('1', 'alice'));
    const back = await upsertIdentity(env, verified(github('1', 'alice'), 'alice@example.com'));
    expect(back.email).toBe('alice@example.com');
    expect(back.email_verified).toBe(1);
    const goog = await upsertIdentity(env, verified(google('sub-1', 'bob'), 'alice@example.com'));
    expect(goog.handle).toBe('alice');
  });
});

describe('an unclaimed legacy profile is not up for grabs (#42)', () => {
  it('does NOT hand a stranger a legacy handle that matches their login', async () => {
    // The defect. `simon` has a profiles row from before the cutover and no
    // identity row, so the old availability probe — which read `identities`
    // only — reported the handle free. The stranger was issued it, and the
    // INSERT OR IGNORE then adopted profile-simon rather than creating one, so
    // ownedIdea (created_by vs contributorByHandle) handed over Simon's ideas.
    const { env, seedLegacyProfile, profiles } = fakeEnv();
    seedLegacyProfile('simon');

    const stranger = await upsertIdentity(env, github('999', 'simon'));

    expect(stranger.handle).not.toBe('simon');
    expect(stranger.handle).toBe('simon-github');
    // And the legacy row is untouched: still exactly one profile called `simon`,
    // and the stranger got a new one of their own. If this array ever contains
    // one entry, the identity is sharing Simon's profile and the bug is back.
    expect(profiles.map((p) => p.handle)).toEqual(['simon', 'simon-github']);
  });

  it('does NOT hand it over on the counting fallback either', async () => {
    // The provider-qualified handle is the second guess, not a safe one: if a
    // legacy `simon-github` profile also exists, the loop must keep going
    // rather than settle on it.
    const { env, seedLegacyProfile } = fakeEnv();
    seedLegacyProfile('simon');
    seedLegacyProfile('simon-github');
    seedLegacyProfile('simon-2');

    const stranger = await upsertIdentity(env, github('999', 'simon'));

    expect(stranger.handle).toBe('simon-3');
  });

  it('does NOT let a verified email alone claim a profile with no recorded claim', async () => {
    // Reserving the handle is not conditional on the attacker being anonymous.
    // A perfectly verified Google address is still no evidence of a connection
    // to a profile that has no claim_email recorded against it.
    const { env, seedLegacyProfile } = fakeEnv();
    seedLegacyProfile('fis-mcp');

    const stranger = await upsertIdentity(
      env,
      verified(google('sub-999', 'fis-mcp'), 'mallory@example.com'),
    );

    expect(stranger.handle).toBe('fis-mcp-google');
  });

  it('does NOT match a claim_email the provider has not verified', async () => {
    // The same boundary linkedHandle draws. An unverified address is a string
    // the account holder typed, so it proves nothing and must not open the door.
    const { env, seedLegacyProfile } = fakeEnv();
    seedLegacyProfile('simon', 'simon@example.com');

    const impostor = await upsertIdentity(env, {
      ...google('sub-666', 'simon'),
      email: 'simon@example.com',
      emailVerified: false,
    });

    expect(impostor.handle).toBe('simon-google');
  });

  it('lets the real owner bind to their own profile on their first sign-in', async () => {
    // The door in the wall. An operator recorded Simon's verified address
    // against the legacy profile; his first sign-in under the new flow adopts
    // it, so profile-simon — and the ideas filed under it — stay his.
    const { env, seedLegacyProfile, profiles } = fakeEnv();
    seedLegacyProfile('simon', 'simon@example.com');

    const simon = await upsertIdentity(
      env,
      verified(github('7', 'simon-renamed-on-github'), 'simon@example.com'),
    );

    expect(simon.handle).toBe('simon');
    // No second profile: he rejoined the existing row rather than being handed
    // an empty one, which is the whole point of the migration path.
    expect(profiles.map((p) => p.handle)).toEqual(['simon']);
  });

  it('spends the claim once — a second account on the same address does not follow him in', async () => {
    // Once an identity holds the handle the profile has an owner who signs in,
    // so the NOT EXISTS closes the door behind him. A second provider account
    // on the same *verified* address is Simon's own and is caught earlier, by
    // linkedHandle; this asserts the claim path itself does not fire twice.
    const { env, seedLegacyProfile } = fakeEnv();
    seedLegacyProfile('simon', 'simon@example.com');
    await upsertIdentity(env, verified(github('7', 'simon'), 'simon@example.com'));

    // A different address that an operator has NOT recorded — so no linkedHandle
    // match either, and nothing left to adopt.
    const other = await upsertIdentity(env, verified(google('sub-8', 'simon'), 'nope@example.com'));

    expect(other.handle).toBe('simon-google');
  });

  it('leaves an ordinary new signup completely unaffected', async () => {
    // The common case must not pay for any of this: a fresh login that collides
    // with nothing still gets the plain handle and a profile of its own.
    const { env, seedLegacyProfile, profiles } = fakeEnv();
    seedLegacyProfile('simon');
    seedLegacyProfile('fis-mcp');

    const newcomer = await upsertIdentity(env, verified(github('3', 'dana'), 'dana@example.com'));

    expect(newcomer.handle).toBe('dana');
    expect(profiles.map((p) => p.handle)).toContain('dana');
  });

  it('still reserves a handle held only by an identity', async () => {
    // The original guard has to survive the change: a live contributor with no
    // profile row yet (identities are written first) is still protected.
    const { env } = fakeEnv();
    const alice = await upsertIdentity(env, github('1', 'alice'));
    const second = await upsertIdentity(env, github('2', 'alice'));

    expect(second.handle).toBe('alice-github');
    expect(second.id).not.toBe(alice.id);
  });
});

describe('provider authorize URLs', () => {
  const credentials = { clientId: 'client-123', clientSecret: 'secret' };
  const redirect = 'https://freeideastore.online/.fis/auth/callback/github';

  it('builds a GitHub URL with the minimum scopes', () => {
    const url = new URL(authorizeUrl('github', credentials, redirect, 'state-1'));
    expect(url.origin + url.pathname).toBe('https://github.com/login/oauth/authorize');
    expect(url.searchParams.get('client_id')).toBe('client-123');
    expect(url.searchParams.get('redirect_uri')).toBe(redirect);
    expect(url.searchParams.get('state')).toBe('state-1');
    expect(url.searchParams.get('scope')).toBe('read:user user:email');
  });

  it('builds a Google URL with response_type and an account chooser', () => {
    const url = new URL(authorizeUrl('google', credentials, redirect, 'state-1'));
    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('prompt')).toBe('select_account');
    // Non-sensitive scopes only — this is what let the consent screen publish
    // without a verification review.
    expect(url.searchParams.get('scope')).toBe('openid email profile');
  });

  it('never puts the client secret in the authorize URL', () => {
    for (const provider of ['github', 'google'] as const) {
      expect(authorizeUrl(provider, credentials, redirect, 'state-1')).not.toContain('secret');
    }
  });

  it('recognises only the two supported providers', () => {
    expect(isProviderId('github')).toBe(true);
    expect(isProviderId('google')).toBe(true);
    expect(isProviderId('facebook')).toBe(false);
    expect(isProviderId(null)).toBe(false);
  });
});

describe('a provider hiccup must not erase a stored verified email', () => {
  it('keeps the stored address when the provider returns none', async () => {
    // githubVerifiedEmail returns null on a rate limit or 5xx. Clearing the row
    // on that would un-link the account and re-open #40 days later, silently.
    const { env } = fakeEnv();
    const linked = await upsertIdentity(env, verified(github('1', 'alice'), 'alice@example.com'));
    expect(linked.email).toBe('alice@example.com');

    const afterHiccup = await upsertIdentity(env, github('1', 'alice'));
    expect(afterHiccup.email).toBe('alice@example.com');
    expect(afterHiccup.email_verified).toBe(1);

    // Still linkable: a Google sign-in on the same address joins the profile.
    const goog = await upsertIdentity(env, verified(google('9', 'alice-other'), 'alice@example.com'));
    expect(goog.handle).toBe('alice');
  });

  it('still records an address the first time one arrives', async () => {
    const { env } = fakeEnv();
    await upsertIdentity(env, github('1', 'alice'));
    const withEmail = await upsertIdentity(env, verified(github('1', 'alice'), 'alice@example.com'));
    expect(withEmail.email).toBe('alice@example.com');
    expect(withEmail.email_verified).toBe(1);
  });
});
