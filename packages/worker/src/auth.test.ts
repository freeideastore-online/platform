import { afterEach, describe, expect, it, vi } from 'vitest';
import { handleAuth } from './auth';
import { verifySession } from './session';
import type { Env, IdentityRow } from './types';

const SIGNING_KEY = 'test-signing-key';
const MCP_CALLBACK = 'https://mcp.freeideastore.online/oauth/callback?nonce=abc';

// Minimal D1 stand-in, in the shape identities.test.ts uses: enough to let a
// sign-in reach an identity row without a real database.
function fakeEnv(): Env {
  const identities: IdentityRow[] = [];

  const run = (sql: string, args: unknown[]) => {
    const q = sql.replace(/\s+/g, ' ').trim();
    if (q.startsWith('SELECT * FROM identities WHERE id =')) return identities.find((r) => r.id === args[0]) ?? null;
    if (q.startsWith('SELECT * FROM identities WHERE provider =')) {
      return identities.find((r) => r.provider === args[0] && r.provider_user_id === args[1]) ?? null;
    }
    if (q.startsWith('SELECT 1 FROM identities WHERE handle =')) {
      return identities.some((r) => r.handle === args[0]) ? { 1: 1 } : null;
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
    if (q.startsWith('UPDATE identities')) return null;
    if (q.startsWith('INSERT OR IGNORE INTO profiles')) return null;
    // Reads this fake has not been taught answer "nothing found", which is the
    // truthful answer for an empty database and keeps these tests about the
    // handoff rather than about identity storage — identities.test.ts owns that
    // and deliberately throws instead. Writes still throw, since a sign-in
    // silently not recording anything is exactly the kind of bug worth failing.
    if (q.startsWith('SELECT')) return null;
    throw new Error(`unexpected SQL: ${q}`);
  };

  return {
    DB: {
      prepare(sql: string) {
        return {
          bind(...args: unknown[]) {
            return { first: async () => run(sql, args), run: async () => run(sql, args) };
          },
        };
      },
    },
    SESSION_SIGNING_KEY: SIGNING_KEY,
    GH_OAUTH_CLIENT_ID: 'client-id',
    GH_OAUTH_CLIENT_SECRET: 'client-secret',
  } as unknown as Env;
}

/** Stub the GitHub calls profileFromCode makes, so a sign-in can run offline. */
function stubGitHub() {
  vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
    const target = String(input instanceof Request ? input.url : input);
    if (target.includes('login/oauth/access_token')) return Response.json({ access_token: 'provider-token' });
    if (target.includes('api.github.com/user/emails')) {
      return Response.json([{ email: 'alice@example.com', primary: true, verified: true }]);
    }
    if (target.includes('api.github.com/user')) {
      return Response.json({ id: 42, login: 'alice', name: 'Alice', email: 'alice@example.com' });
    }
    throw new Error(`unexpected fetch: ${target}`);
  });
}

function start(query: string, env: Env) {
  const url = new URL(`https://freeideastore.online/.fis/auth/start?${query}`);
  return handleAuth(new Request(url.toString()), url, env);
}

function callback(state: string, env: Env, cookie: string) {
  const url = new URL(`https://freeideastore.online/.fis/auth/callback/github?code=provider-code&state=${state}`);
  return handleAuth(new Request(url.toString(), { headers: { Cookie: cookie } }), url, env);
}

function nonceCookie(response: Response | null) {
  const raw = response?.headers.get('set-cookie') ?? '';
  const value = (raw.split(';')[0] ?? '').split('=').slice(1).join('=');
  return { header: `__Host-fis_auth_nonce=${value}`, state: decodeURIComponent(value).split('|')[0] ?? '' };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('cross-origin session handoff', () => {
  it('returns the session on the redirect for an allowlisted origin', async () => {
    stubGitHub();
    const env = fakeEnv();
    const started = await start(
      `provider=github&response_mode=query&return_to=${encodeURIComponent(MCP_CALLBACK)}`,
      env,
    );
    const { header, state } = nonceCookie(started);

    const done = await callback(state, env, header);
    const location = new URL(done?.headers.get('location') ?? '');

    expect(done?.status).toBe(303);
    expect(location.origin + location.pathname).toBe('https://mcp.freeideastore.online/oauth/callback');
    // The MCP server needs its own nonce back to find the request this belongs to.
    expect(location.searchParams.get('nonce')).toBe('abc');
    const session = location.searchParams.get('fis_session') ?? '';
    await expect(verifySession(session, SIGNING_KEY)).resolves.toMatchObject({ uid: expect.any(String) });
  });

  it('gives the handed-off token minutes, not the cookie session lifetime', async () => {
    // It is in a URL, and URLs end up in history and logs. Its only job is to
    // survive one redirect and be exchanged.
    stubGitHub();
    const env = fakeEnv();
    const started = await start(
      `provider=github&response_mode=query&return_to=${encodeURIComponent(MCP_CALLBACK)}`,
      env,
    );
    const { header, state } = nonceCookie(started);

    const done = await callback(state, env, header);
    const location = new URL(done?.headers.get('location') ?? '');
    const handed = await verifySession(location.searchParams.get('fis_session') ?? '', SIGNING_KEY);
    const cookieSession = (done?.headers.getSetCookie() ?? []).find((c) => c.startsWith('__Host-fis_session='));

    const lifetime = (handed?.exp ?? 0) - (handed?.iat ?? 0);
    expect(lifetime).toBeLessThanOrEqual(15 * 60);
    // The browser is still signed into the site itself, with a normal session.
    expect(cookieSession).toContain(`Max-Age=${30 * 24 * 60 * 60}`);
  });

  it('never sends a session to an origin that is not allowlisted', async () => {
    stubGitHub();
    const env = fakeEnv();
    const started = await start(
      `provider=github&response_mode=query&return_to=${encodeURIComponent('https://evil.example/steal')}`,
      env,
    );
    const { header, state } = nonceCookie(started);

    const done = await callback(state, env, header);
    const location = done?.headers.get('location') ?? '';

    // Clamped back to a path on this origin, exactly as before.
    expect(location).toBe('https://freeideastore.online/');
    expect(location).not.toContain('evil.example');
  });

  it('ignores an allowlisted origin unless the query handoff was asked for', async () => {
    const env = fakeEnv();
    const started = await start(`provider=github&return_to=${encodeURIComponent(MCP_CALLBACK)}`, env);

    // No response_mode=query, so this is an ordinary sign-in and the return
    // target is clamped like any other.
    expect(nonceCookie(started).header).not.toContain('mcp.freeideastore.online');
  });

  it('sends a failure to the handoff origin as a query param a server can read', async () => {
    // A fragment would be dropped by the browser before the MCP worker saw it,
    // so the flow would look like a silent hang instead of a refusal.
    stubGitHub();
    const env = fakeEnv();
    const started = await start(
      `provider=github&response_mode=query&return_to=${encodeURIComponent(MCP_CALLBACK)}`,
      env,
    );
    const { header } = nonceCookie(started);

    const done = await callback('not-the-nonce', env, header);
    const location = new URL(done?.headers.get('location') ?? '');

    expect(location.origin).toBe('https://mcp.freeideastore.online');
    expect(location.searchParams.get('auth_error')).toBe('invalid_state');
    expect(location.searchParams.get('fis_session')).toBeNull();
  });

  it('refuses a handoff it cannot mint for itself', async () => {
    // Without FIS credentials the fallback would hand back a FreeAppStore-signed
    // token, which is the cross-store coupling that broke MCP sign-in (#34).
    const env = { ...fakeEnv(), SESSION_SIGNING_KEY: undefined } as unknown as Env;
    const started = await start(
      `provider=github&response_mode=query&return_to=${encodeURIComponent(MCP_CALLBACK)}`,
      env,
    );

    expect(started?.status).toBe(503);
  });
});

describe('ordinary sign-in', () => {
  it('still returns to a same-origin path with only a cookie', async () => {
    stubGitHub();
    const env = fakeEnv();
    const started = await start('provider=github&return_to=/console/', env);
    const { header, state } = nonceCookie(started);

    const done = await callback(state, env, header);
    const cookies = done?.headers.getSetCookie() ?? [];

    expect(done?.headers.get('location')).toBe('https://freeideastore.online/console/');
    expect(cookies.some((c) => c.startsWith('__Host-fis_session='))).toBe(true);
  });
});
