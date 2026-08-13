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

// Origins that may receive a minted session on the redirect URL instead of in
// the cookie, when they ask for it with `response_mode=query`.
//
// The MCP server lives on mcp.freeideastore.online, a *different origin* from
// the site, so the `__Host-` cookie this file sets can never reach it — and a
// cookie is the only channel a browser offers apart from the URL itself. That
// leaves the redirect URL as the sole way to hand the MCP OAuth flow the session
// it just earned. FreeAppStore used to perform exactly this handoff for us
// (`response_mode=query` + `fas_session`); it now stays inside FIS (#37).
//
// A token in a URL is normally a mistake — URLs reach browser history, Referer
// headers and access logs. It is an acceptable tradeoff only because all three
// exposures are bounded here: the receiving endpoint exchanges the token for its
// own access token on arrival, the token is minted with a TTL of minutes rather
// than the cookie's 30 days, and nothing but an origin on this list can ever be
// sent one. Adding an entry is a security decision, not a config tweak.
const SESSION_HANDOFF_ORIGINS = new Set(['https://mcp.freeideastore.online']);
// Long enough to survive the redirect and the immediate exchange, short enough
// that a URL recovered from a log later is worthless.
const HANDOFF_TTL_SECONDS = 5 * 60;
const HANDOFF_SESSION_PARAM = 'fis_session';

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

/**
 * The absolute return target for a cross-origin session handoff, or null.
 *
 * Returning null is what routes everything else back through `sameOriginPath`,
 * so an ordinary sign-in is still clamped to a path on this origin and cannot be
 * pointed at an attacker's host. This is deliberately re-derived from the
 * allowlist at both ends of the flow rather than remembered as a flag: the
 * allowlist stays the only thing that can widen where a session may be sent.
 */
function handoffTarget(raw: string | null): URL | null {
  if (!raw) return null;
  try {
    const parsed = new URL(raw);
    return SESSION_HANDOFF_ORIGINS.has(parsed.origin) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Where to send the browser when sign-in does not complete.
 *
 * A same-origin return keeps the reason in the fragment: the console reads it
 * client-side and it never reaches a server or its logs. A handoff target is
 * another origin's *server* route, which cannot see a fragment at all, so there
 * the reason has to travel as a query parameter to be reported to the user.
 */
function authErrorUrl(url: URL, handoff: URL | null, returnPath: string, reason: string) {
  if (!handoff) return `${url.origin}${returnPath}#auth_error=${reason}`;
  const target = new URL(handoff.toString());
  target.searchParams.set('auth_error', reason);
  return target.toString();
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

/**
 * A handle an identity row already holds is a registered person's, and an
 * unauthenticated caller may not write as them.
 *
 * This is the `x-idea-handle` half of #42. `availableHandle` stops a stranger
 * being *issued* someone's handle at sign-in; nothing stopped a stranger simply
 * asserting one in a header on an anonymous idea or contribution, which files
 * the row under `profile-<them>` and puts it on their contributor page. It is
 * not the full takeover — `ownedIdea` requires a session and compares against
 * the caller's own verified handle, so no existing idea changes hands — but it
 * is the same mistake, a profile selected by a name anyone can type.
 */
async function handleIsRegistered(env: Env, handle: string) {
  return Boolean(
    await env.DB.prepare('SELECT 1 FROM identities WHERE handle = ?').bind(handle).first(),
  );
}

export async function profileFor(request: Request, env: Env) {
  const authUser = await authUserFor(request, env);
  // Only trust x-idea-handle when unauthenticated (anonymous idea creation).
  // When authenticated, always use the verified handle to prevent attribution spoofing.
  let handle: string;
  if (authUser) {
    handle = slug(authUser.handle) || 'guest';
  } else {
    const requested = slug(request.headers.get('x-idea-handle') || '');
    // Anonymous callers keep their own attribution handle, but fall back to
    // `guest` rather than borrowing a registered contributor's. Falling back
    // instead of erroring keeps the anonymous write path working — the MCP
    // client sends this header on every call, signed in or not.
    handle = requested && !(await handleIsRegistered(env, requested)) ? requested : 'guest';
  }
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
    const requestedReturn = url.searchParams.get('return_to');
    // Only an explicit `response_mode=query` opts into the URL handoff, so an
    // ordinary browser sign-in that happens to name an allowlisted origin still
    // gets a cookie and nothing else.
    const handoff = url.searchParams.get('response_mode') === 'query' ? handoffTarget(requestedReturn) : null;
    const returnTarget = handoff ? handoff.toString() : sameOriginPath(url, requestedReturn || '/console/');
    const nonce = crypto.randomUUID();

    const credentials = env && isProviderId(provider) ? nativeCredentials(env, provider) : null;
    if (credentials && isProviderId(provider)) {
      // The return target rides in the cookie, not the redirect URI, which has
      // to match the provider's registration exactly.
      return redirect(
        authorizeUrl(provider, credentials, callbackUri(url, provider), nonce),
        302,
        [cookie(NONCE_COOKIE_NAME, `${nonce}|${returnTarget}`, NONCE_TTL_SECONDS)],
      );
    }

    // Only the FIS-owned flow can honour a handoff. The FreeAppStore fallback
    // hands back a FreeAppStore-signed token, and passing one of those to
    // another FIS worker to verify is the exact cross-store key coupling that
    // broke MCP sign-in in #34. Failing loudly beats re-creating that bug.
    if (handoff) return new Response('sign-in is not configured', { status: 503, headers: SECURITY_HEADERS });

    const callback = new URL(`${AUTH_PREFIX}/callback`, url.origin);
    callback.searchParams.set('return_to', returnTarget);
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
    const storedReturn = separator < 0 ? '/console/' : stored.slice(separator + 1);
    const handoff = handoffTarget(storedReturn);
    const returnPath = handoff ? '/console/' : sameOriginPath(url, storedReturn);
    const fail = (reason: string) =>
      redirect(authErrorUrl(url, handoff, returnPath, reason), 303, [clearCookie(NONCE_COOKIE_NAME)]);
    const state = url.searchParams.get('state');
    // Reject before spending a code exchange on a request we already distrust.
    if (!expected || !state || state !== expected) return fail('invalid_state');

    const code = url.searchParams.get('code');
    // No code means the user declined consent, or the provider refused. Either
    // way this is an ordinary outcome, not an error worth a stack trace.
    if (!code) return fail('denied');

    const profile = await profileFromCode(nativeCallback, credentials, code, callbackUri(url, nativeCallback));
    if (!profile) return fail('provider_error');

    const identity = await upsertIdentity(env, profile);
    const cookies = [
      cookie(SESSION_COOKIE_NAME, await mintSession(identity.id, env.SESSION_SIGNING_KEY), SESSION_TTL_SECONDS),
      clearCookie(NONCE_COOKIE_NAME),
    ];
    if (handoff) {
      // A second, separately minted token — not the cookie's. The cookie has to
      // last a browsing session; this one only has to survive one redirect, so
      // it gets minutes. Signing into MCP still leaves the browser signed into
      // the site, which is why the cookie is set here too.
      const target = new URL(handoff.toString());
      const session = await mintSession(identity.id, env.SESSION_SIGNING_KEY, { ttlSeconds: HANDOFF_TTL_SECONDS });
      target.searchParams.set(HANDOFF_SESSION_PARAM, session);
      return redirect(target.toString(), 303, cookies);
    }
    return redirect(`${url.origin}${returnPath}`, 303, cookies);
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
