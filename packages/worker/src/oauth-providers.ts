// FIS's own OAuth against GitHub and Google.
//
// Previously auth.ts redirected to api.freeappstore.online and let FreeAppStore
// own the entire provider relationship — the providers had never heard of
// FreeIdeaStore. FIS now holds its own client registrations, so a FreeAppStore
// outage or key rotation can no longer take FIS sign-in down (#39).
//
// Authorization-code flow, exchanged server-side. There is no PKCE here because
// this is a confidential client: the secret lives in a Worker secret and never
// reaches the browser, which is the threat PKCE exists to cover for public
// clients. The `state` nonce is what protects the callback, and it is checked
// against an HttpOnly cookie rather than kept in memory, because Workers have no
// memory that survives between the two requests.

import { slug } from './http';

export type ProviderId = 'github' | 'google';

export const PROVIDER_IDS: ProviderId[] = ['github', 'google'];

export function isProviderId(value: string | null): value is ProviderId {
  return value === 'github' || value === 'google';
}

/** The profile shape both providers are normalized into. */
export type ProviderProfile = {
  provider: ProviderId;
  /**
   * The provider's immutable id — NOT the login or email. People change their
   * GitHub username and their email address, and providers reuse both; keying
   * on them eventually hands one person's account to somebody else.
   */
  providerUserId: string;
  handle: string;
  displayName: string;
  avatarUrl: string | null;
  /** Lower-cased, or null when the provider gave us nothing usable. */
  email: string | null;
  /**
   * Whether the *provider* asserts it owns this address, not whether it looks
   * well-formed. `upsertIdentity` links two provider accounts into one profile
   * on a matching email, so an unverified address here would let anyone claim
   * anyone's contributions by typing their address into a throwaway account.
   * Anything short of an explicit assertion from the provider is `false`.
   */
  emailVerified: boolean;
};

/** Lower-case and trim, so `Alice@Example.com` and `alice@example.com` link. */
function normalizeEmail(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const email = value.trim().toLowerCase();
  return email.includes('@') ? email : null;
}

export type ProviderCredentials = { clientId: string; clientSecret: string };

type ProviderConfig = {
  authorizeUrl: string;
  tokenUrl: string;
  scope: string;
};

const PROVIDERS: Record<ProviderId, ProviderConfig> = {
  github: {
    authorizeUrl: 'https://github.com/login/oauth/authorize',
    tokenUrl: 'https://github.com/login/oauth/access_token',
    // Minimum for identity. `user:email` is needed only because GitHub omits a
    // private email from /user, and we would otherwise have no handle fallback.
    scope: 'read:user user:email',
  },
  google: {
    authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    // All three are non-sensitive, which is why the consent screen could be
    // published without a verification review.
    scope: 'openid email profile',
  },
};

export function authorizeUrl(
  provider: ProviderId,
  credentials: ProviderCredentials,
  redirectUri: string,
  state: string,
): string {
  const config = PROVIDERS[provider];
  const url = new URL(config.authorizeUrl);
  url.searchParams.set('client_id', credentials.clientId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('scope', config.scope);
  url.searchParams.set('state', state);
  if (provider === 'google') {
    url.searchParams.set('response_type', 'code');
    // Without this Google withholds the account chooser from users with more
    // than one signed-in account, silently picking the first.
    url.searchParams.set('prompt', 'select_account');
  }
  return url.toString();
}

async function exchangeCode(
  provider: ProviderId,
  credentials: ProviderCredentials,
  code: string,
  redirectUri: string,
): Promise<string | null> {
  const body = new URLSearchParams({
    client_id: credentials.clientId,
    client_secret: credentials.clientSecret,
    code,
    redirect_uri: redirectUri,
    grant_type: 'authorization_code',
  });
  const response = await fetch(PROVIDERS[provider].tokenUrl, {
    method: 'POST',
    // GitHub defaults to a form-encoded response body unless asked otherwise.
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: body.toString(),
  });
  if (!response.ok) return null;
  const payload = (await response.json().catch(() => null)) as { access_token?: unknown } | null;
  const token = payload?.access_token;
  return typeof token === 'string' && token ? token : null;
}

/**
 * GitHub's verified primary address.
 *
 * /user reports `email: null` whenever the address is private, which is the
 * default for a lot of accounts, and it carries no verification flag either way.
 * /user/emails carries both, and the `user:email` scope we already request is
 * what buys access to it. Only the entry that is *both* primary and verified is
 * usable: a verified secondary address may be a work address the person shares
 * with colleagues, and an unverified one is just a string they typed.
 *
 * A failure here is not a sign-in failure — it costs linking, not access.
 */
async function githubVerifiedEmail(headers: Record<string, string>): Promise<string | null> {
  const response = await fetch('https://api.github.com/user/emails', { headers });
  if (!response.ok) return null;
  const list = (await response.json().catch(() => null)) as unknown;
  if (!Array.isArray(list)) return null;
  for (const entry of list as Record<string, unknown>[]) {
    if (entry?.primary === true && entry?.verified === true) {
      const email = normalizeEmail(entry.email);
      if (email) return email;
    }
  }
  return null;
}

async function githubProfile(token: string): Promise<ProviderProfile | null> {
  // A User-Agent is mandatory on the GitHub API; without one it returns 403.
  const headers = { Authorization: `Bearer ${token}`, 'User-Agent': 'freeideastore', Accept: 'application/vnd.github+json' };
  const response = await fetch('https://api.github.com/user', { headers });
  if (!response.ok) return null;
  const user = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  const id = user?.id;
  const login = typeof user?.login === 'string' ? user.login : '';
  if (id === undefined || id === null || !login) return null;
  const handle = slug(login);
  if (!handle) return null;
  // Note we do NOT fall back to `user.email` when this returns null. That field
  // is unverified as far as this response is concerned, and an address we cannot
  // prove is worse than no address at all — see ProviderProfile.emailVerified.
  const email = await githubVerifiedEmail(headers);
  return {
    provider: 'github',
    providerUserId: String(id),
    handle,
    displayName: (typeof user?.name === 'string' && user.name.trim()) || login,
    avatarUrl: typeof user?.avatar_url === 'string' ? user.avatar_url : null,
    email,
    emailVerified: email !== null,
  };
}

async function googleProfile(token: string): Promise<ProviderProfile | null> {
  const response = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) return null;
  const user = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  const sub = typeof user?.sub === 'string' ? user.sub : '';
  if (!sub) return null;
  // Google has no username, so the handle is slugged from the email local part.
  //
  // This was once described as keeping handles stable across the FreeAppStore
  // cutover. It does not, and #40 is the counterexample: FreeAppStore supplied a
  // handle of its own derived from the display name, so `Serge Ivy` had been
  // `serge-ivy` for a year, and `serge.the.dev@gmail.com` slugs to
  // `serge-the-dev`. The sign-in minted a second, empty profile and orphaned 27
  // contributions. The derivation below is a reasonable *default* for a brand-new
  // Google user and nothing more; what actually keeps a returning contributor on
  // their existing profile is the verified-email link in `upsertIdentity`, and
  // the handle picked here is only used when that finds no match.
  const email = normalizeEmail(user?.email);
  const name = typeof user?.name === 'string' ? user.name : '';
  const handle = slug((email ?? '').split('@')[0] || name);
  if (!handle) return null;
  return {
    provider: 'google',
    providerUserId: sub,
    handle,
    displayName: name.trim() || handle,
    avatarUrl: typeof user?.picture === 'string' ? user.picture : null,
    email,
    // Strictly `true`. Google sends this as a real boolean on OIDC userinfo, but
    // the string "true" has been seen from other OIDC surfaces, and a truthiness
    // check would also accept a non-empty string like "false".
    emailVerified: email !== null && user?.email_verified === true,
  };
}

/** Exchange the callback code for a normalized profile, or null if anything fails. */
export async function profileFromCode(
  provider: ProviderId,
  credentials: ProviderCredentials,
  code: string,
  redirectUri: string,
): Promise<ProviderProfile | null> {
  const token = await exchangeCode(provider, credentials, code, redirectUri);
  if (!token) return null;
  return provider === 'github' ? githubProfile(token) : googleProfile(token);
}
