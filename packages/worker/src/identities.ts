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
 * Pick a handle for a brand-new identity that no one has proven a claim to.
 *
 * A handle is free only when NEITHER table holds it. Checking `identities`
 * alone was #42: a pre-cutover contributor has a `profiles` row and no identity
 * row until they sign in again, so their handle read as free, and the first
 * stranger whose login slugged to it was issued the handle — after which the
 * `INSERT OR IGNORE INTO profiles` below adopted their profile row and
 * `ownedIdea` handed over their ideas, because authorization follows the
 * handle. Reading both tables is what makes "unclaimed" mean unclaimed rather
 * than merely "no identity row yet".
 *
 * This function no longer has any way to return a handle someone else's work
 * hangs off, which means it can no longer perform the migration either. That is
 * deliberate: rejoining an existing profile is now exclusively the job of the
 * two proof-carrying lookups `upsertIdentity` runs first — `linkedHandle` for a
 * verified email shared with an existing identity, `claimableProfileHandle` for
 * a verified email recorded against the legacy profile. By the time control
 * reaches here there is no evidence connecting this account to anything, and
 * the only safe answer is a handle nothing else owns.
 */
async function availableHandle(env: Env, profile: ProviderProfile): Promise<string> {
  const taken = async (handle: string) =>
    Boolean(
      await env.DB.prepare(
        `SELECT 1 FROM identities WHERE handle = ?
         UNION ALL
         SELECT 1 FROM profiles WHERE handle = ?`,
      )
        .bind(handle, handle)
        .first(),
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
 * The handle of a legacy profile this person has a recorded claim to, or null.
 *
 * This is the door in the wall `availableHandle` now puts around every existing
 * profile (#42, migration 0018). Reserving legacy handles stops a stranger
 * walking onto one; without a way back in it would also strand the genuine
 * pre-cutover contributor on `alice-github`, detached from the ideas and
 * contributions filed under `profile-alice`. So a profile with no identity
 * behind it is adoptable — but only by an identity that arrives carrying the
 * verified address an operator has already recorded against it.
 *
 * The security argument is `linkedHandle`'s, unchanged: BOTH sides must be
 * trustworthy. `profiles.claim_email` is written by a human who established who
 * the owner is, never derived from a handle or a login; and the incoming
 * address must be one the *provider* asserts is verified, which is checked here
 * and again by the caller. Drop either half and this becomes a more convenient
 * version of the takeover it exists to prevent.
 *
 * `NOT EXISTS (... identities ...)` is the third condition and it is what makes
 * the claim single-use. Once an identity holds the handle, the profile has an
 * owner who signs in, and any later address match is a different person — or
 * the same person's second provider account, which `linkedHandle` has already
 * handled by then, because `upsertIdentity` runs it first.
 */
async function claimableProfileHandle(
  env: Env,
  profile: ProviderProfile,
): Promise<string | null> {
  if (!profile.emailVerified || !profile.email) return null;
  const match = await env.DB.prepare(
    `SELECT p.handle FROM profiles p
     WHERE p.claim_email = ?
       AND NOT EXISTS (SELECT 1 FROM identities i WHERE i.handle = p.handle)
     ORDER BY p.created_at ASC, p.id ASC LIMIT 1`,
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
    // Only positive information overwrites the stored address. `githubProfile`
    // yields a null email whenever GET /user/emails fails — a rate limit, a 5xx,
    // a revoked user:email scope — and letting that clear a verified address
    // would un-link the account on one unlucky sign-in, so the next sign-in with
    // the other provider would mint a second empty profile. That is exactly the
    // failure #40 exists to prevent, arriving silently and days later.
    const incomingIsUsable = profile.emailVerified && Boolean(profile.email);
    const nextEmail = incomingIsUsable ? profile.email : existing.email ?? null;
    const nextVerified = incomingIsUsable ? 1 : existing.email_verified ?? 0;
    if (
      existing.display_name !== profile.displayName ||
      (existing.avatar_url ?? null) !== profile.avatarUrl ||
      (existing.email ?? null) !== nextEmail ||
      (existing.email_verified ?? 0) !== nextVerified
    ) {
      await env.DB.prepare(
        `UPDATE identities SET display_name = ?, avatar_url = ?, email = ?, email_verified = ?,
           updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
      )
        .bind(profile.displayName, profile.avatarUrl, nextEmail, nextVerified, existing.id)
        .run();
      return {
        ...existing,
        display_name: profile.displayName,
        avatar_url: profile.avatarUrl,
        email: nextEmail,
        email_verified: nextVerified,
      };
    }
    return existing;
  }

  // Three lookups, in descending order of how strong the evidence is that this
  // new account belongs to someone already here. Only the first two may return
  // a handle that other work hangs off, and both demand a verified email; the
  // third can only ever return a handle nothing owns. `availableHandle` cannot
  // do the adopting itself, because it varies the handle precisely to keep two
  // *people* apart, which is the opposite question.
  const handle =
    (await linkedHandle(env, profile)) ??
    (await claimableProfileHandle(env, profile)) ??
    (await availableHandle(env, profile));
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
  //
  // Which branch above chose the handle decides which of those two things this
  // statement does, and that is now the only control over it. A handle from
  // `availableHandle` is held by neither table, so this inserts a fresh row. A
  // handle from `linkedHandle` or `claimableProfileHandle` is held by a row
  // that already exists, so this ignores and the identity joins it. Before #42
  // `availableHandle` could also land on an occupied handle, and this same
  // statement then silently handed a stranger someone else's profile.
  await env.DB.prepare(
    `INSERT OR IGNORE INTO profiles (id, handle, display_name, reputation, badges_json)
     VALUES (?, ?, ?, 0, '[]')`,
  )
    .bind(`profile-${handle}`, handle, profile.displayName || handle.replace(/-/g, ' '))
    .run();

  return (await identityById(env, id)) as IdentityRow;
}
