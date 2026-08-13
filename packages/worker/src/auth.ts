import { json, slug, SECURITY_HEADERS } from './http';
import type { AuthUser, Env } from './types';
import { mintSession, SESSION_TTL_SECONDS, verifySession } from './session';
import { authUserFromIdentity, identityById, upsertIdentity } from './identities';
import {
  authorizeUrl,
  isProviderId,
  profileFromCode,
  type ProviderCredentials,
  type ProviderId,
} from './oauth-providers';

export const AUTH_PREFIX = '/.fis/auth';
const SESSION_COOKIE_NAME = '__Host-fis_session';
const NONCE_COOKIE_NAME = '__Host-fis_auth_nonce';
// FreeAppStore fallback. FIS used to have no identity of its own and borrowed
// this one wholesale; it stays only so sessions issued before the cutover keep
// working, and #38 deletes it. Nothing new should route through here.
const AUTH_API_BASE = 'https://api.freeappstore.online';
const AUTH_APP_ID = 'freeideastore';
const NONCE_TTL_SECONDS = 10 * 60;
const AUTH_PROVIDERS = new Set(['github', 'google']);

function credentialsFor(env: Env, provider: ProviderId): ProviderCredentials | null {
  const clientId = provider === 'github' ? env.GH_OAUTH_CLIENT_ID : env.GOOGLE_CLIENT_ID;
  const clientSecret = provider === 'github' ? env.GH_OAUTH_CLIENT_SECRET : env.GOOGLE_CLIENT_SECRET;
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

/**
 * FIS can only run its own flow once it has both halves of a provider client and
 * a key to sign sessions with. Where it cannot, sign-in falls back to the
 * FreeAppStore path rather than failing — which is what keeps a half-configured
 * deploy from locking everyone out.
 */
function nativeCredentials(env: Env, provider: ProviderId): ProviderCredentials | null {
  return env.SESSION_SIGNING_KEY ? credentialsFor(env, provider) : null;
}

function callbackUri(url: URL, provider: ProviderId): string {
  // Must match the registered redirect URI byte for byte — both providers reject
  // anything else, so the return path cannot be smuggled in as a query param.
  // It travels in the state cookie instead.
  return `${url.origin}${AUTH_PREFIX}/callback/${provider}`;
}

function readCookie(header: string | null, name: string) {
  if (!header) return null;
  for (const part of header.split(';')) {
    const [rawName, ...rawValue] = part.trim().split('=');
    if (rawName !== name) continue;
    try {
      return decodeURIComponent(rawValue.join('='));
    } catch {
      return null;
    }
  }
  return null;
}

function sameOriginPath(baseUrl: URL, raw: string | null) {
  if (!raw) return '/';
  try {
    const parsed = new URL(raw, baseUrl.origin);
    if (parsed.origin !== baseUrl.origin) return '/';
    if (parsed.pathname === AUTH_PREFIX || parsed.pathname.startsWith(`${AUTH_PREFIX}/`)) return '/';
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return '/';
  }
}

function cookie(name: string, value: string, maxAge: number) {
  return [
    `${name}=${encodeURIComponent(value)}`,
    `Max-Age=${maxAge}`,
    'Path=/',
    'Secure',
    'HttpOnly',
    'SameSite=Lax',
  ].join('; ');
}

function clearCookie(name: string) {
  return `${name}=; Max-Age=0; Path=/; Secure; HttpOnly; SameSite=Lax`;
}

function redirect(location: string, status: 302 | 303, cookies: string[] = []) {
  const headers = new Headers({ Location: location, 'Cache-Control': 'no-store' });
  for (const item of cookies) headers.append('Set-Cookie', item);
  return new Response(null, { status, headers });
}

function methodNotAllowed(allow: string) {
  return new Response('Method not allowed', {
    status: 405,
    headers: { ...SECURITY_HEADERS, Allow: allow, 'Cache-Control': 'no-store' },
  });
}

export function isSameOriginMutation(request: Request) {
  const url = new URL(request.url);
  const origin = request.headers.get('Origin');
  if (origin && origin !== url.origin) return false;
  const fetchSite = request.headers.get('Sec-Fetch-Site');
  if (fetchSite && fetchSite !== 'same-origin' && fetchSite !== 'none') return false;
  return true;
}

function normalizeAuthUser(payload: unknown): AuthUser | null {
  const data = (payload || {}) as Record<string, unknown>;
  const user = ((data.user || data.profile || data.account || data) || {}) as Record<string, unknown>;
  const email = String(user.email || '');
  const rawHandle = String(user.handle || user.login || user.username || email.split('@')[0] || user.name || '');
  const handle = slug(rawHandle);
  if (!handle) return null;
  return {
    handle,
    displayName: String(user.displayName || user.display_name || user.name || rawHandle).trim() || handle,
    provider: String(user.provider || data.provider || 'auth'),
    avatarUrl: String(user.avatarUrl || user.avatar_url || user.picture || '').trim() || null,
  };
}

async function fetchAuthPayload(token: string) {
  const response = await fetch(`${AUTH_API_BASE}/v1/auth/me`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const text = await response.text();
  let body: unknown = text;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { error: text };
  }
  return { response, body };
}

function authTokenFor(request: Request) {
  const authorization = request.headers.get('Authorization') || '';
  if (authorization.toLowerCase().startsWith('bearer ')) return authorization.slice(7).trim();
  return readCookie(request.headers.get('Cookie'), SESSION_COOKIE_NAME);
}

export async function authUserFor(request: Request, env?: Env) {
  const token = authTokenFor(request);
  if (!token) return null;
  // FIS-issued sessions verify locally — no network call, and no dependency on
  // another store being reachable. Tokens minted before the cutover fail this
  // check harmlessly and fall through to the FreeAppStore path below.
  if (env?.SESSION_SIGNING_KEY) {
    const payload = await verifySession(token, env.SESSION_SIGNING_KEY);
    if (payload) {
      const identity = await identityById(env, payload.uid);
      return identity ? authUserFromIdentity(identity) : null;
    }
  }
  try {
    const { response, body } = await fetchAuthPayload(token);
    if (!response.ok) return null;
    return normalizeAuthUser(body);
  } catch {
    return null;
  }
}

export function hasBearerAuth(request: Request) {
  return (request.headers.get('Authorization') || '').toLowerCase().startsWith('bearer ');
}

export function isApiMutation(request: Request) {
  return ['POST', 'PATCH', 'PUT', 'DELETE'].includes(request.method);
}

export async function profileFor(request: Request, env: Env) {
  const authUser = await authUserFor(request, env);
  // Only trust x-idea-handle when unauthenticated (anonymous idea creation).
  // When authenticated, always use the verified handle to prevent attribution spoofing.
  const raw = authUser?.handle || request.headers.get('x-idea-handle') || 'guest';
  const handle = slug(raw) || 'guest';
  const profileId = `profile-${handle}`;
  await env.DB.prepare(
    `INSERT OR IGNORE INTO profiles (id, handle, display_name, reputation, badges_json)
     VALUES (?, ?, ?, 0, '[]')`,
  )
    .bind(profileId, handle, authUser?.displayName || handle.replace(/-/g, ' '))
    .run();
  return profileId;
}

export async function registeredProfileFor(request: Request, env: Env) {
  const authUser = await authUserFor(request, env);
  if (!authUser) return null;
  const profileId = `profile-${authUser.handle}`;
  await env.DB.prepare(
    `INSERT OR IGNORE INTO profiles (id, handle, display_name, reputation, badges_json)
     VALUES (?, ?, ?, 0, '[]')`,
  )
    .bind(profileId, authUser.handle, authUser.displayName || authUser.handle.replace(/-/g, ' '))
    .run();
  return { authUser, profileId };
}

export async function handleAuth(request: Request, url: URL, env?: Env) {
  if (!url.pathname.startsWith(`${AUTH_PREFIX}/`) && url.pathname !== AUTH_PREFIX) return null;

  if (url.pathname === `${AUTH_PREFIX}/start`) {
    if (request.method !== 'GET') return methodNotAllowed('GET');
    const provider = url.searchParams.get('provider') || 'github';
    if (!AUTH_PROVIDERS.has(provider)) return new Response('unknown provider', { status: 404, headers: SECURITY_HEADERS });
    const returnPath = sameOriginPath(url, url.searchParams.get('return_to') || '/console/');
    const nonce = crypto.randomUUID();

    const credentials = env && isProviderId(provider) ? nativeCredentials(env, provider) : null;
    if (credentials && isProviderId(provider)) {
      // The return path rides in the cookie, not the redirect URI, which has to
      // match the provider's registration exactly.
      return redirect(
        authorizeUrl(provider, credentials, callbackUri(url, provider), nonce),
        302,
        [cookie(NONCE_COOKIE_NAME, `${nonce}|${returnPath}`, NONCE_TTL_SECONDS)],
      );
    }

    const callback = new URL(`${AUTH_PREFIX}/callback`, url.origin);
    callback.searchParams.set('return_to', returnPath);
    callback.searchParams.set('nonce', nonce);
    const start = new URL(`/v1/auth/${provider}/start`, AUTH_API_BASE);
    start.searchParams.set('app_id', AUTH_APP_ID);
    start.searchParams.set('return_to', callback.toString());
    start.searchParams.set('response_mode', 'query');
    return redirect(start.toString(), 302, [cookie(NONCE_COOKIE_NAME, nonce, NONCE_TTL_SECONDS)]);
  }

  const nativeCallback = url.pathname.startsWith(`${AUTH_PREFIX}/callback/`)
    ? url.pathname.slice(`${AUTH_PREFIX}/callback/`.length)
    : null;
  if (nativeCallback !== null) {
    if (request.method !== 'GET') return methodNotAllowed('GET');
    if (!isProviderId(nativeCallback)) return new Response('unknown provider', { status: 404, headers: SECURITY_HEADERS });
    const credentials = env ? nativeCredentials(env, nativeCallback) : null;
    if (!credentials || !env?.SESSION_SIGNING_KEY) {
      return new Response('sign-in is not configured', { status: 503, headers: SECURITY_HEADERS });
    }

    const stored = readCookie(request.headers.get('Cookie'), NONCE_COOKIE_NAME) || '';
    const separator = stored.indexOf('|');
    const expected = separator < 0 ? stored : stored.slice(0, separator);
    const returnPath = sameOriginPath(url, separator < 0 ? '/console/' : stored.slice(separator + 1));
    const state = url.searchParams.get('state');
    // Reject before spending a code exchange on a request we already distrust.
    if (!expected || !state || state !== expected) {
      return redirect(`${url.origin}${returnPath}#auth_error=invalid_state`, 303, [clearCookie(NONCE_COOKIE_NAME)]);
    }

    const code = url.searchParams.get('code');
    if (!code) {
      // The user declined consent, or the provider refused. Either way this is
      // an ordinary outcome, not an error worth a stack trace.
      return redirect(`${url.origin}${returnPath}#auth_error=denied`, 303, [clearCookie(NONCE_COOKIE_NAME)]);
    }

    const profile = await profileFromCode(nativeCallback, credentials, code, callbackUri(url, nativeCallback));
    if (!profile) {
      return redirect(`${url.origin}${returnPath}#auth_error=provider_error`, 303, [clearCookie(NONCE_COOKIE_NAME)]);
    }

    const identity = await upsertIdentity(env, profile);
    const session = await mintSession(identity.id, env.SESSION_SIGNING_KEY);
    return redirect(`${url.origin}${returnPath}`, 303, [
      cookie(SESSION_COOKIE_NAME, session, SESSION_TTL_SECONDS),
      clearCookie(NONCE_COOKIE_NAME),
    ]);
  }

  if (url.pathname === `${AUTH_PREFIX}/callback`) {
    if (request.method !== 'GET') return methodNotAllowed('GET');
    const returnPath = sameOriginPath(url, url.searchParams.get('return_to') || '/console/');
    const nonce = url.searchParams.get('nonce');
    const storedNonce = readCookie(request.headers.get('Cookie'), NONCE_COOKIE_NAME);
    if (!nonce || nonce !== storedNonce) return redirect(`${url.origin}${returnPath}#auth_error=invalid_state`, 303, [clearCookie(NONCE_COOKIE_NAME)]);
    const session = url.searchParams.get('session') || url.searchParams.get('fas_session');
    if (!session) return redirect(`${url.origin}${returnPath}#auth_error=missing_session`, 303, [clearCookie(NONCE_COOKIE_NAME)]);
    const { response } = await fetchAuthPayload(session);
    if (!response.ok) return redirect(`${url.origin}${returnPath}#auth_error=invalid_session`, 303, [clearCookie(NONCE_COOKIE_NAME)]);
    return redirect(`${url.origin}${returnPath}`, 303, [
      cookie(SESSION_COOKIE_NAME, session, SESSION_TTL_SECONDS),
      clearCookie(NONCE_COOKIE_NAME),
    ]);
  }

  if (url.pathname === `${AUTH_PREFIX}/me`) {
    if (request.method !== 'GET') return methodNotAllowed('GET');
    const token = readCookie(request.headers.get('Cookie'), SESSION_COOKIE_NAME);
    if (!token) return json({ error: 'not signed in' }, { status: 401 });
    const authUser = await authUserFor(request, env);
    if (authUser) return json({ user: authUser });
    // Clear the cookie so a token that no longer resolves — expired, or issued
    // by the old FreeAppStore path after cutover — does not keep being retried.
    return json({ error: 'not signed in' }, { status: 401, headers: { 'Set-Cookie': clearCookie(SESSION_COOKIE_NAME) } });
  }

  if (url.pathname === `${AUTH_PREFIX}/logout`) {
    if (request.method !== 'POST') return methodNotAllowed('POST');
    if (!isSameOriginMutation(request)) return new Response('Forbidden', { status: 403, headers: SECURITY_HEADERS });
    return new Response(null, { status: 204, headers: { 'Set-Cookie': clearCookie(SESSION_COOKIE_NAME), 'Cache-Control': 'no-store' } });
  }

  return new Response('Not found', { status: 404, headers: SECURITY_HEADERS });
}
