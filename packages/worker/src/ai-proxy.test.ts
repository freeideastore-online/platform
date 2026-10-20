import { afterEach, describe, expect, it, vi } from 'vitest';
import { AI_MAX_MESSAGE_CHARS, AI_MAX_MESSAGES, handleAiProxy } from './ai-proxy';
import { mintSession } from './session';
import type { Env } from './types';

/**
 * #109. `/api/ai/elaborate` was an open relay: no auth, no origin check, no
 * rate limit, and a caller-chosen model, through the store's AI Gateway.
 */

const SIGNING_KEY = 'test-signing-key';
const ORIGIN = 'https://freeideastore.online';

/** A limiter that admits `allow` requests per key, like the real binding. */
function limiter(allow: number) {
  const seen = new Map<string, number>();
  return {
    keys: seen,
    limit: async ({ key }: { key: string }) => {
      const used = (seen.get(key) ?? 0) + 1;
      seen.set(key, used);
      return { success: used <= allow };
    },
  };
}

function fakeEnv(options: { rateLimiter?: ReturnType<typeof limiter> | null } = {}) {
  const identity = { id: 'identity-serge', handle: 'serge-the-dev', display_name: 'Serge', provider: 'github' };
  return {
    SESSION_SIGNING_KEY: SIGNING_KEY,
    DB: {
      prepare: () => ({
        bind: (id: string) => ({ first: async () => (id === identity.id ? identity : null) }),
      }),
    },
    ...(options.rateLimiter === null ? {} : { AI_RATE_LIMITER: options.rateLimiter ?? limiter(100) }),
  } as unknown as Env;
}

const bearer = async () => `Bearer ${await mintSession('identity-serge', SIGNING_KEY)}`;
const cookie = async () => `__Host-fis_session=${await mintSession('identity-serge', SIGNING_KEY)}`;

function request(payload: Record<string, unknown>, headers: Record<string, string>) {
  return new Request(`${ORIGIN}/api/ai/elaborate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(payload),
  });
}

const PAYLOAD = { apiKey: 'sk-caller-own-key', provider: 'anthropic', messages: [{ role: 'user', content: 'An idea.' }] };

/** Stub the gateway; returns what it was asked for. */
function stubGateway() {
  const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    calls.push({ url, body: JSON.parse(String(init.body)) });
    return new Response('data: {}\n\n', { status: 200, headers: { 'content-type': 'text/event-stream' } });
  });
  return calls;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the AI proxy (#109)', () => {
  it('refuses an anonymous caller, before reaching the gateway', async () => {
    const calls = stubGateway();

    const response = await handleAiProxy(request(PAYLOAD, {}), fakeEnv());

    expect(response.status).toBe(401);
    expect(calls).toHaveLength(0);
  });

  it('refuses a cookie-authenticated request from another origin', async () => {
    // A cross-site page must not be able to spend a visitor's session.
    const calls = stubGateway();

    const response = await handleAiProxy(
      request(PAYLOAD, { Cookie: await cookie(), Origin: 'https://evil.example' }),
      fakeEnv(),
    );

    expect(response.status).toBe(403);
    expect(calls).toHaveLength(0);
  });

  it('serves a signed-in same-origin request with the configured model', async () => {
    const calls = stubGateway();

    const response = await handleAiProxy(request(PAYLOAD, { Cookie: await cookie(), Origin: ORIGIN }), fakeEnv());

    expect(response.status).toBe(200);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.body.model).toBe('claude-sonnet-4-5-20250514');
  });

  it('refuses a caller-chosen model', async () => {
    const calls = stubGateway();

    const response = await handleAiProxy(
      request({ ...PAYLOAD, model: 'some-expensive-model' }, { Authorization: await bearer() }),
      fakeEnv(),
    );

    expect(response.status).toBe(400);
    expect(((await response.json()) as { error: string }).error).toContain('unsupported model');
    expect(calls).toHaveLength(0);
  });

  it('rate-limits per identity', async () => {
    const calls = stubGateway();
    const rateLimiter = limiter(2);
    const env = fakeEnv({ rateLimiter });
    const auth = { Authorization: await bearer() };

    const statuses = [];
    for (let i = 0; i < 3; i += 1) statuses.push((await handleAiProxy(request(PAYLOAD, auth), env)).status);

    expect(statuses).toEqual([200, 200, 429]);
    expect(calls).toHaveLength(2);
    expect([...rateLimiter.keys.keys()]).toEqual(['identity-serge']);
  });

  it('fails closed when the rate limiter is not bound', async () => {
    const calls = stubGateway();

    const response = await handleAiProxy(request(PAYLOAD, { Authorization: await bearer() }), fakeEnv({ rateLimiter: null }));

    expect(response.status).toBe(503);
    expect(calls).toHaveLength(0);
  });

  it('bounds the messages it relays', async () => {
    const calls = stubGateway();
    const auth = { Authorization: await bearer() };
    const tooMany = Array.from({ length: AI_MAX_MESSAGES + 1 }, () => ({ role: 'user', content: 'x' }));
    const tooLong = [{ role: 'user', content: 'x'.repeat(AI_MAX_MESSAGE_CHARS + 1) }];

    const many = await handleAiProxy(request({ ...PAYLOAD, messages: tooMany }, auth), fakeEnv());
    const long = await handleAiProxy(request({ ...PAYLOAD, messages: tooLong }, auth), fakeEnv());

    expect([many.status, long.status]).toEqual([400, 400]);
    expect(calls).toHaveLength(0);
  });
});
