import { describe, expect, it } from 'vitest';
import { mintSession, SESSION_TTL_SECONDS, verifySession } from './session';

const KEY = 'a'.repeat(64);
const OTHER_KEY = 'b'.repeat(64);
const NOW = 1_786_526_521;

describe('FIS session tokens', () => {
  it('round-trips a minted token', async () => {
    const token = await mintSession('identity-1', KEY, { now: NOW });
    const payload = await verifySession(token, KEY, { now: NOW });
    expect(payload?.uid).toBe('identity-1');
    expect(payload?.iat).toBe(NOW);
    expect(payload?.exp).toBe(NOW + SESSION_TTL_SECONDS);
  });

  it('carries roles when given, and omits the field when not', async () => {
    const withRoles = await mintSession('identity-1', KEY, { roles: ['admin'], now: NOW });
    expect((await verifySession(withRoles, KEY, { now: NOW }))?.roles).toEqual(['admin']);
    const without = await mintSession('identity-1', KEY, { now: NOW });
    expect((await verifySession(without, KEY, { now: NOW }))?.roles).toBeUndefined();
  });

  it('produces the two-part shape packages/mcp already verifies', async () => {
    const token = await mintSession('identity-1', KEY, { now: NOW });
    const parts = token.split('.');
    expect(parts).toHaveLength(2);
    // 32 raw bytes of HMAC-SHA256, base64url with padding stripped.
    expect(parts[1]).toHaveLength(43);
    expect(token).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  });

  it('rejects a token signed with a different key', async () => {
    const token = await mintSession('identity-1', OTHER_KEY, { now: NOW });
    // This is exactly the #34 failure: a valid, unexpired token from the wrong signer.
    expect(await verifySession(token, KEY, { now: NOW })).toBeNull();
  });

  it('rejects a tampered payload', async () => {
    const token = await mintSession('identity-1', KEY, { now: NOW });
    const [, sig] = token.split('.');
    const forged = btoa(JSON.stringify({ uid: 'admin', iat: NOW, exp: NOW + 60 }))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    expect(await verifySession(`${forged}.${sig}`, KEY, { now: NOW })).toBeNull();
  });

  it('rejects an expired token', async () => {
    const token = await mintSession('identity-1', KEY, { ttlSeconds: 60, now: NOW });
    expect(await verifySession(token, KEY, { now: NOW + 59 })).not.toBeNull();
    expect(await verifySession(token, KEY, { now: NOW + 61 })).toBeNull();
  });

  it('rejects malformed input rather than throwing', async () => {
    for (const bad of ['', 'no-dot', '.', 'a.b', 'not-base64!.sig']) {
      expect(await verifySession(bad, KEY, { now: NOW })).toBeNull();
    }
  });

  it('rejects a correctly signed token with no uid', async () => {
    // Signature valid, contents useless — verify must not hand back a session
    // that no identity row can be found for.
    const body = btoa(JSON.stringify({ iat: NOW, exp: NOW + 60 }))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(KEY),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    );
    const raw = new Uint8Array(
      await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body)),
    );
    let bin = '';
    for (const b of raw) bin += String.fromCharCode(b);
    const sig = btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    expect(await verifySession(`${body}.${sig}`, KEY, { now: NOW })).toBeNull();
  });

  it('requires a signing key on both halves', async () => {
    await expect(mintSession('identity-1', '', { now: NOW })).rejects.toThrow();
    const token = await mintSession('identity-1', KEY, { now: NOW });
    expect(await verifySession(token, '', { now: NOW })).toBeNull();
  });

  it('survives non-ASCII display data in the payload', async () => {
    // b64urlDecode must decode UTF-8, not latin1 — atob alone would mangle this.
    const token = await mintSession('idéntity-ü-1', KEY, { now: NOW });
    expect((await verifySession(token, KEY, { now: NOW }))?.uid).toBe('idéntity-ü-1');
  });
});
