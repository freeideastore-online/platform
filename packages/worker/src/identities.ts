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
 * profile. It is only varied when another *identity* already holds it, which —
 * by the time this runs — means a different person: `upsertIdentity` calls this
 * only after the verified-email link found nothing, so the two accounts have no
 * evidence connecting them and sharing a handle would merge two people's work.
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
 * The handle of an identity already proven to belong to the same human, or null.
 *
 * This is the account-linking rule (#40), and it is deliberately the narrowest
 * one that solves the problem. Signing in with GitHub and with Google gave one
 * person two contributor profiles, because a handle is minted per provider
 * account. The only evidence two provider accounts are the same person that we
 * can act on without asking the person is a shared email address that BOTH
 * providers verified.
 *
 * Verification is the entire security boundary. `email_verified = 1` is on both
 * sides of this comparison: the stored row's flag and, at the call site, the
 * incoming profile's. Drop either half and the feature becomes an account
 * takeover — register a throwaway Google account, set the display email to
 * somebody else's, sign in, and inherit their handle, their profile, their
 * ideas and their contributions. Nothing else about this function is as
 * important as that, including the case where it is over-strict and a real
 * person ends up with two profiles they must ask a human to merge.
 *
 * Oldest match wins, so a person who somehow accrued several linkable
 * identities converges on the profile that has been accumulating work longest
 * rather than on whichever row the database happens to return first.
 */
async function linkedHandle(env: Env, profile: ProviderProfile): Promise<string | null> {
  if (!profile.emailVerified || !profile.email) return null;
  const match = await env.DB.prepare(
    `SELECT handle FROM identities
     WHERE email = ? AND email_verified = 1
     ORDER BY created_at ASC, id ASC LIMIT 1`,
  )
    .bind(profile.email)
    .first<{ handle: string }>();
  return match?.handle ?? null;
}

/**
 * Find the identity for a provider profile, creating it on first sign-in.
 *
 * Matching is on (provider, provider_user_id) — the provider's immutable id —
 * so someone who renames their GitHub account still resolves to the same row
 * and keeps their handle. Only when that misses does the verified-email link
 * run; a returning user's own row always wins over any email match, which is
 * what stops a shared or re-issued address from moving an established identity
 * onto a different profile.
 */
export async function upsertIdentity(env: Env, profile: ProviderProfile): Promise<IdentityRow> {
  const existing = await env.DB.prepare(
    'SELECT * FROM identities WHERE provider = ? AND provider_user_id = ?',
  )
    .bind(profile.provider, profile.providerUserId)
    .first<IdentityRow>();

  if (existing) {
    // Display name, avatar and email are the provider's to change; the handle is
    // not. Refreshing the email also backfills rows created before 0017, which
    // is the only way those ever become linkable — the access token that could
    // have read the address was never stored.
    const emailVerified = profile.emailVerified ? 1 : 0;
    if (
      existing.display_name !== profile.displayName ||
      (existing.avatar_url ?? null) !== profile.avatarUrl ||
      (existing.email ?? null) !== profile.email ||
      (existing.email_verified ?? 0) !== emailVerified
    ) {
      await env.DB.prepare(
        `UPDATE identities SET display_name = ?, avatar_url = ?, email = ?, email_verified = ?,
           updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
      )
        .bind(profile.displayName, profile.avatarUrl, profile.email, emailVerified, existing.id)
        .run();
      return {
        ...existing,
        display_name: profile.displayName,
        avatar_url: profile.avatarUrl,
        email: profile.email,
        email_verified: emailVerified,
      };
    }
    return existing;
  }

  // Adopt the handle of an identity already proven to be the same person, and
  // only mint a fresh one when there is no such proof. `availableHandle` cannot
  // do this itself: it varies the handle precisely to keep two *people* apart,
  // which is the opposite question.
  const handle = (await linkedHandle(env, profile)) ?? (await availableHandle(env, profile));
  const id = `identity-${crypto.randomUUID()}`;
  await env.DB.prepare(
    `INSERT INTO identities (id, provider, provider_user_id, handle, display_name, avatar_url, email, email_verified)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      profile.provider,
      profile.providerUserId,
      handle,
      profile.displayName,
      profile.avatarUrl,
      profile.email,
      profile.emailVerified ? 1 : 0,
    )
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
