import { describe, expect, it } from 'vitest';
import type { ProviderProfile } from './oauth-providers';
import { upsertIdentity } from './identities';
import type { Env, IdentityRow } from './types';

// #40: a legacy profile claim recorded AFTER the contributor has already signed
// in still has to bind on their next sign-in.
//
// This file has its own D1 stand-in rather than sharing `identities.test.ts`'s,
// because it has to express a state that one cannot: an identity minted onto a
// fresh handle first, then an operator writing `claim_email` against the legacy
// profile afterwards. That ordering is the entire defect — the version of this
// code that only consulted the claim on the insert branch handled the reverse
// order correctly and this one not at all — so the fake has to model the write
// as a separate, later step, and has to model `UPDATE identities SET handle`.
//
// Where the fake is loose it is loose on purpose, and the reason is the same one
// recorded in `identities.test.ts`: a matcher strict enough to throw on the
// pre-fix SQL would make every test here red whether the behaviour regressed or
// merely the query text changed, and a test that cannot tell those apart proves
// nothing. The UPDATE branch is therefore parsed from the SET list rather than
// read positionally, so reverting the fix runs the old four-column statement,
// leaves the handle alone, and fails on the assertion that names the behaviour.
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
    if (/^SELECT 1 FROM (identities|profiles) WHERE handle =/.test(q)) {
      const held =
        (q.includes('FROM identities') && identities.some((r) => r.handle === args[0])) ||
        (q.includes('FROM profiles') && profiles.some((p) => p.handle === args[args.length - 1]));
      return held ? { 1: 1 } : null;
    }
    if (q.startsWith('SELECT p.handle FROM profiles p WHERE p.claim_email =')) {
      // The NOT EXISTS is honoured only when the query actually asks for it.
      //
      // Enforcing it unconditionally would be the vacuous-test trap: the test
      // asserting a claim cannot pull a profile away from an identity that
      // already signs in as it would keep passing against a query that had
      // quietly dropped the condition, because the fake was supplying the
      // safety the code no longer did. Reading it off the SQL means deleting
      // the clause makes that test go red on the takeover it describes.
      const claimIsSingleUse = q.includes('NOT EXISTS');
      const match = profiles
        .filter(
          (p) =>
            p.claim_email === args[0] &&
            (!claimIsSingleUse || !identities.some((i) => i.handle === p.handle)),
        )
        .sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id))[0];
      return match ? { handle: match.handle } : null;
    }
    if (q.startsWith('SELECT handle FROM identities WHERE email =')) {
      // Same rule for the same reason: `email_verified = 1` is honoured only
      // when the query asks for it, so dropping it fails a test rather than
      // being invisibly compensated for here.
      const requiresVerified = q.includes('email_verified = 1');
      const match = identities
        .filter((r) => r.email === args[0] && (!requiresVerified || r.email_verified === 1))
        .sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id))[0];
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
      if (row) {
        columns.forEach((column, index) => {
          (row as unknown as Record<string, unknown>)[column] = args[index];
        });
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

  /** A pre-cutover contributor: a profile row with work under it, no identity. */
  const seedLegacyProfile = (handle: string) => {
    profiles.push({
      id: `profile-${handle}`,
      handle,
      claim_email: null,
      created_at: String(profiles.length).padStart(4, '0'),
    });
  };

  /**
   * The operator action from AUTH.md, as a separate later step:
   *
   *   UPDATE profiles SET claim_email = '...' WHERE handle = '...';
   *
   * Deliberately not folded into `seedLegacyProfile`. Keeping it separate is
   * what lets a test place it after a sign-in has already happened, which is the
   * ordering #40 is about.
   */
  const recordClaim = (handle: string, email: string) => {
    const profile = profiles.find((p) => p.handle === handle);
    if (!profile) throw new Error(`no profile ${handle}`);
    profile.claim_email = email;
  };

  return { env, identities, profiles, seedLegacyProfile, recordClaim };
}

const account = (
  provider: 'github' | 'google',
  id: string,
  handle: string,
  email: string | null = null,
  emailVerified = false,
): ProviderProfile => ({
  provider,
  providerUserId: id,
  handle,
  displayName: handle,
  avatarUrl: null,
  email,
  emailVerified,
});

const verified = (profile: ProviderProfile, email: string): ProviderProfile => ({
  ...profile,
  email,
  emailVerified: true,
});

describe('a claim recorded after the sign-in still binds (#40)', () => {
  it('reunites a contributor stranded on a fresh handle with their legacy profile', async () => {
    // The exact production sequence from #40. `serge-ivy` is the pre-cutover
    // profile carrying 27 contributions; the Google account slugs to
    // `serge-the-dev` because Google has no username and the email local part is
    // all there is to derive from. Nothing connects the two at sign-in time, so
    // the contributor lands on an empty profile — and only then does anyone
    // notice and establish who they are.
    const { env, seedLegacyProfile, recordClaim } = fakeEnv();
    seedLegacyProfile('serge-ivy');

    const first = await upsertIdentity(
      env,
      verified(account('google', 'sub-1', 'serge-the-dev'), 'serge.the.dev@gmail.com'),
    );
    expect(first.handle).toBe('serge-the-dev');

    recordClaim('serge-ivy', 'serge.the.dev@gmail.com');

    const second = await upsertIdentity(
      env,
      verified(account('google', 'sub-1', 'serge-the-dev'), 'serge.the.dev@gmail.com'),
    );

    // Same identity row — the provider id still matches — now pointing at the
    // profile the work hangs off.
    expect(second.id).toBe(first.id);
    expect(second.handle).toBe('serge-ivy');
  });

  it('binds on the GitHub path too, not just Google', async () => {
    // The claim lookup is provider-agnostic and must stay that way; #40 was
    // filed against Google only because GitHub's login happened to survive the
    // cutover unchanged, not because the mechanism differs.
    const { env, seedLegacyProfile, recordClaim } = fakeEnv();
    seedLegacyProfile('simon');
    await upsertIdentity(env, verified(account('github', '7', 'simon-renamed'), 'simon@example.com'));
    recordClaim('simon', 'simon@example.com');

    const back = await upsertIdentity(
      env,
      verified(account('github', '7', 'simon-renamed'), 'simon@example.com'),
    );

    expect(back.handle).toBe('simon');
  });

  it('does not mint a second identity row or a second profile when it binds', async () => {
    // Rejoining must be a move, not a fork: two identity rows for one provider
    // account would give the person two handles again, which is the failure the
    // whole handle-stability design exists to prevent.
    const { env, seedLegacyProfile, recordClaim, identities, profiles } = fakeEnv();
    seedLegacyProfile('serge-ivy');
    await upsertIdentity(
      env,
      verified(account('google', 'sub-1', 'serge-the-dev'), 'serge.the.dev@gmail.com'),
    );
    recordClaim('serge-ivy', 'serge.the.dev@gmail.com');
    await upsertIdentity(
      env,
      verified(account('google', 'sub-1', 'serge-the-dev'), 'serge.the.dev@gmail.com'),
    );

    expect(identities).toHaveLength(1);
    expect(identities[0]?.handle).toBe('serge-ivy');
    expect(profiles.map((p) => p.handle).sort()).toEqual(['serge-ivy', 'serge-the-dev']);
  });

  it('survives a provider hiccup that cost the address on the first sign-in', async () => {
    // `githubProfile` yields a null email whenever GET /user/emails fails, so a
    // rate limit at the wrong moment used to close the claim window for good:
    // the identity was minted with no address, and the claim was never consulted
    // again. Re-checking on every sign-in is what makes that recoverable.
    const { env, seedLegacyProfile, recordClaim } = fakeEnv();
    seedLegacyProfile('simon');
    recordClaim('simon', 'simon@example.com');

    const hiccup = await upsertIdentity(env, account('github', '7', 'simon-renamed'));
    expect(hiccup.handle).toBe('simon-renamed');

    const recovered = await upsertIdentity(
      env,
      verified(account('github', '7', 'simon-renamed'), 'simon@example.com'),
    );

    expect(recovered.handle).toBe('simon');
  });
});

describe('re-checking the claim does not reopen the #42 takeover', () => {
  it('does NOT let an unverified address move an identity onto a claimed profile', async () => {
    // Verification is the whole security boundary. Anyone can type
    // simon@example.com into a throwaway Google account; only the provider can
    // say it is theirs.
    const { env, seedLegacyProfile, recordClaim } = fakeEnv();
    seedLegacyProfile('simon');
    await upsertIdentity(env, account('google', 'sub-9', 'mallory'));
    recordClaim('simon', 'simon@example.com');

    const mallory = await upsertIdentity(
      env,
      account('google', 'sub-9', 'mallory', 'simon@example.com', false),
    );

    expect(mallory.handle).toBe('mallory');
  });

  it('does NOT move an identity onto a profile with no recorded claim', async () => {
    // A verified address alone proves nothing about a legacy profile. Without an
    // operator having written `claim_email`, the profile stays reserved — this
    // is the reservation rule #42 established, and re-checking must not erode it.
    const { env, seedLegacyProfile } = fakeEnv();
    seedLegacyProfile('simon');
    await upsertIdentity(env, verified(account('google', 'sub-9', 'mallory'), 'mallory@example.com'));

    const again = await upsertIdentity(
      env,
      verified(account('google', 'sub-9', 'mallory'), 'mallory@example.com'),
    );

    expect(again.handle).toBe('mallory');
  });

  it('does NOT pull a profile away from an identity that already signs in as it', async () => {
    // The NOT EXISTS is what bounds the blast radius of re-checking: a claim can
    // only ever point at a profile nobody signs in as. Even an operator writing
    // the wrong address cannot hand over a profile with a live owner.
    const { env, recordClaim, identities } = fakeEnv();
    const owner = await upsertIdentity(
      env,
      verified(account('github', '1', 'alice'), 'alice@example.com'),
    );
    await upsertIdentity(env, verified(account('google', 'sub-2', 'mallory'), 'mallory@example.com'));
    recordClaim('alice', 'mallory@example.com');

    const mallory = await upsertIdentity(
      env,
      verified(account('google', 'sub-2', 'mallory'), 'mallory@example.com'),
    );

    expect(mallory.handle).toBe('mallory');
    expect(identities.find((r) => r.id === owner.id)?.handle).toBe('alice');
  });

  it('still reserves an unclaimed legacy handle against a stranger whose login matches', async () => {
    // The #42 regression guard, restated on this path: `availableHandle` must
    // keep reading both tables. If it ever goes back to probing `identities`
    // alone, a first-time sign-in whose login slugs to `simon` walks onto the
    // legacy profile and inherits its ideas.
    const { env, seedLegacyProfile } = fakeEnv();
    seedLegacyProfile('simon');

    const stranger = await upsertIdentity(
      env,
      verified(account('github', '99', 'simon'), 'stranger@example.com'),
    );

    expect(stranger.handle).toBe('simon-github');
  });

  it('leaves an ordinary returning sign-in on its own handle', async () => {
    // The common case pays nothing: no claim anywhere, so the extra lookup
    // returns null and the handle is exactly what it was.
    const { env } = fakeEnv();
    const first = await upsertIdentity(env, verified(account('github', '1', 'dana'), 'dana@example.com'));
    const second = await upsertIdentity(
      env,
      verified(account('github', '1', 'dana'), 'dana@example.com'),
    );

    expect(second.id).toBe(first.id);
    expect(second.handle).toBe('dana');
  });

  it('does NOT re-run the verified-email link for a returning identity', async () => {
    // The asymmetry between the two email lookups. `linkedHandle` needs no human
    // in the loop, so re-running it would let a newly-verified or re-issued
    // address move an established identity onto someone else's profile with
    // nobody having decided that was right. Only the operator-authorized claim
    // may move a handle that already exists.
    const { env } = fakeEnv();
    await upsertIdentity(env, verified(account('github', '1', 'alice'), 'shared@example.com'));
    // Signs in first with no address of its own, so it gets its own handle.
    const other = await upsertIdentity(env, account('google', 'sub-2', 'bob'));
    expect(other.handle).toBe('bob');

    // Now the same address turns up verified on the returning Google account.
    const returning = await upsertIdentity(
      env,
      verified(account('google', 'sub-2', 'bob'), 'shared@example.com'),
    );

    expect(returning.handle).toBe('bob');
  });
});
