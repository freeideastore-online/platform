import { describe, expect, it } from 'vitest';
import { authorizeUrl, isProviderId, type ProviderProfile } from './oauth-providers';
import { authUserFromIdentity, identityById, upsertIdentity } from './identities';
import type { Env, IdentityRow } from './types';

// Minimal D1 stand-in: enough to exercise the identity queries without a real
// database. Matching on the SQL text is crude, but it keeps the fake honest —
// change a query and the test fails rather than silently passing.
function fakeEnv() {
  const identities: IdentityRow[] = [];
  const profiles: { id: string; handle: string }[] = [];

  const run = (sql: string, args: unknown[]) => {
    const q = sql.replace(/\s+/g, ' ').trim();
    if (q.startsWith('SELECT * FROM identities WHERE id =')) {
      return identities.find((r) => r.id === args[0]) ?? null;
    }
    if (q.startsWith('SELECT * FROM identities WHERE provider =')) {
      return identities.find((r) => r.provider === args[0] && r.provider_user_id === args[1]) ?? null;
    }
    if (q.startsWith('SELECT 1 FROM identities WHERE handle =')) {
      return identities.some((r) => r.handle === args[0]) ? { 1: 1 } : null;
    }
    if (q.startsWith('UPDATE identities SET display_name')) {
      const row = identities.find((r) => r.id === args[2]);
      if (row) {
        row.display_name = args[0] as string;
        row.avatar_url = args[1] as string | null;
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
        created_at: 'now',
        updated_at: 'now',
      });
      return null;
    }
    if (q.startsWith('INSERT OR IGNORE INTO profiles')) {
      if (!profiles.some((p) => p.handle === args[1])) {
        profiles.push({ id: args[0] as string, handle: args[1] as string });
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

  return { env, identities, profiles };
}

const github = (id: string, handle: string): ProviderProfile => ({
  provider: 'github',
  providerUserId: id,
  handle,
  displayName: handle,
  avatarUrl: null,
});

describe('identity upsert', () => {
  it('creates an identity and claims the matching profile', async () => {
    const { env, profiles } = fakeEnv();
    const row = await upsertIdentity(env, github('1', 'alice'));
    expect(row.handle).toBe('alice');
    expect(row.provider).toBe('github');
    expect(profiles).toEqual([{ id: 'profile-alice', handle: 'alice' }]);
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
    const google = await upsertIdentity(env, {
      provider: 'google',
      providerUserId: '1',
      handle: 'bob',
      displayName: 'Bob',
      avatarUrl: null,
    });
    expect(google.id).not.toBe(gh.id);
    expect(google.provider).toBe('google');
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
