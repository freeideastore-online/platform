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
};

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
  return {
    provider: 'github',
    providerUserId: String(id),
    handle,
    displayName: (typeof user?.name === 'string' && user.name.trim()) || login,
    avatarUrl: typeof user?.avatar_url === 'string' ? user.avatar_url : null,
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
  // Google has no username. Derive the handle from the email local part, which
  // is what the FreeAppStore-era normalizeAuthUser did, so handles stay stable
  // for anyone who signed in before the cutover.
  const email = typeof user?.email === 'string' ? user.email : '';
  const name = typeof user?.name === 'string' ? user.name : '';
  const handle = slug(email.split('@')[0] || name);
  if (!handle) return null;
  return {
    provider: 'google',
    providerUserId: sub,
    handle,
    displayName: name.trim() || handle,
    avatarUrl: typeof user?.picture === 'string' ? user.picture : null,
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
