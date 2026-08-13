// Reading and writing FIS's own identity rows (migration 0016).
//
// The invariant that matters here is handle stability. `profiles.id` is
// 'profile-<handle>', and contributions and reactions reference it, so if a
// returning contributor is given a different handle their own history silently
// detaches from them. Every path below is written to preserve the handle a
// person already had.

import type { AuthUser, Env, IdentityRow } from './types';
import type { ProviderProfile } from './oauth-providers';

export function authUserFromIdentity(row: IdentityRow): AuthUser {
  return {
    handle: row.handle,
    displayName: row.display_name,
    provider: row.provider,
    avatarUrl: row.avatar_url ?? null,
  };
}

export async function identityById(env: Env, id: string): Promise<IdentityRow | null> {
  return env.DB.prepare('SELECT * FROM identities WHERE id = ?').bind(id).first<IdentityRow>();
}

/**
 * Pick a handle for a brand-new identity.
 *
 * The plain handle is preferred, because a contributor who was known as `alice`
 * in the FreeAppStore era must land back on `alice` and rejoin their existing
 * profile. It is only varied when another *identity* already holds it, which
 * means a different person — handles are unique in both tables, so silently
 * sharing one would merge two people's work.
 */
async function availableHandle(env: Env, profile: ProviderProfile): Promise<string> {
  const taken = async (handle: string) =>
    Boolean(
      await env.DB.prepare('SELECT 1 FROM identities WHERE handle = ?').bind(handle).first(),
    );
  if (!(await taken(profile.handle))) return profile.handle;
  // Qualify by provider before falling back to counting: `alice-github` says
  // something about who the account is, `alice-2` says nothing at all.
  const qualified = `${profile.handle}-${profile.provider}`;
  if (!(await taken(qualified))) return qualified;
  for (let n = 2; n < 50; n += 1) {
    const candidate = `${profile.handle}-${n}`;
    if (!(await taken(candidate))) return candidate;
  }
  throw new Error(`no free handle for ${profile.handle}`);
}

/**
 * Find the identity for a provider profile, creating it on first sign-in.
 *
 * Matching is on (provider, provider_user_id) — the provider's immutable id —
 * so someone who renames their GitHub account still resolves to the same row
 * and keeps their handle.
 */
export async function upsertIdentity(env: Env, profile: ProviderProfile): Promise<IdentityRow> {
  const existing = await env.DB.prepare(
    'SELECT * FROM identities WHERE provider = ? AND provider_user_id = ?',
  )
    .bind(profile.provider, profile.providerUserId)
    .first<IdentityRow>();

  if (existing) {
    // Display name and avatar are the provider's to change; the handle is not.
    if (existing.display_name !== profile.displayName || (existing.avatar_url ?? null) !== profile.avatarUrl) {
      await env.DB.prepare(
        `UPDATE identities SET display_name = ?, avatar_url = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
      )
        .bind(profile.displayName, profile.avatarUrl, existing.id)
        .run();
      return { ...existing, display_name: profile.displayName, avatar_url: profile.avatarUrl };
    }
    return existing;
  }

  const handle = await availableHandle(env, profile);
  const id = `identity-${crypto.randomUUID()}`;
  await env.DB.prepare(
    `INSERT INTO identities (id, provider, provider_user_id, handle, display_name, avatar_url)
     VALUES (?, ?, ?, ?, ?, ?)`,
  )
    .bind(id, profile.provider, profile.providerUserId, handle, profile.displayName, profile.avatarUrl)
    .run();

  // Make sure the profile row exists so the handle is claimed in both tables at
  // once. INSERT OR IGNORE means an existing FreeAppStore-era profile is adopted
  // rather than overwritten — that adoption is the whole migration path.
  await env.DB.prepare(
    `INSERT OR IGNORE INTO profiles (id, handle, display_name, reputation, badges_json)
     VALUES (?, ?, ?, 0, '[]')`,
  )
    .bind(`profile-${handle}`, handle, profile.displayName || handle.replace(/-/g, ' '))
    .run();

  return (await identityById(env, id)) as IdentityRow;
}
