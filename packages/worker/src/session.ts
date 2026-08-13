// FIS-issued session tokens: base64url(payload) + '.' + base64url(HMAC-SHA256).
//
// Until now FreeIdeaStore issued nothing. `auth.ts` stored a FreeAppStore token
// verbatim in the session cookie and asked api.freeappstore.online who the user
// was on every request, which is why a FreeAppStore key rotation could take FIS
// sign-in down (see #34, #39). This module is the mint half FIS never had.
//
// The wire format matches what packages/mcp already verifies, so one token works
// for both the site and the MCP server. Per the workspace no-cross-store-deps
// rule the MCP copy stays a vendored duplicate rather than an import; #37 aligns
// it with this file.
//
// Deliberately NOT a JWT. There is no header and no `alg` field, so there is no
// algorithm to confuse: the verifier can only ever compute HMAC-SHA256, and a
// token claiming `alg: none` is just a malformed payload. The cost is that this
// is not interoperable with off-the-shelf JWT libraries, which nothing here needs.
//
// Sessions are stateless — the signature is the proof, and there is no sessions
// table to read on every request. That is what keeps verification a few
// microseconds of local work instead of a round trip. The tradeoff is that a
// token cannot be revoked before `exp`; if revocation is ever needed it wants a
// deny-list keyed on `uid` plus an issued-at floor, not a lookup on the hot path.

export interface SessionPayload {
  /** Stable identity id — `identities.id`, not the handle, which can change. */
  uid: string;
  roles?: string[];
  /** Seconds since epoch. */
  iat: number;
  /** Seconds since epoch. */
  exp: number;
}

/** Matches the cookie lifetime auth.ts has always used. */
export const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;

export interface MintOptions {
  roles?: string[];
  ttlSeconds?: number;
  /** Seconds since epoch; injectable so tests need no clock control. */
  now?: number;
}

export async function mintSession(
  uid: string,
  signingKey: string,
  options: MintOptions = {},
): Promise<string> {
  if (!uid) throw new Error('mintSession: uid is required');
  if (!signingKey) throw new Error('mintSession: signingKey is required');
  const now = options.now ?? Math.floor(Date.now() / 1000);
  const payload: SessionPayload = {
    uid,
    ...(options.roles?.length ? { roles: options.roles } : {}),
    iat: now,
    exp: now + (options.ttlSeconds ?? SESSION_TTL_SECONDS),
  };
  const body = b64urlEncode(JSON.stringify(payload));
  return `${body}.${await hmac(body, signingKey)}`;
}

export async function verifySession(
  token: string,
  signingKey: string,
  options: { now?: number } = {},
): Promise<SessionPayload | null> {
  if (!token || !signingKey) return null;
  const dot = token.lastIndexOf('.');
  if (dot < 0) return null;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  // Signature first: never parse attacker-controlled JSON we have not authenticated.
  if (!timingSafeEqual(sig, await hmac(body, signingKey))) return null;
  let payload: SessionPayload;
  try {
    payload = JSON.parse(b64urlDecode(body)) as SessionPayload;
  } catch {
    return null;
  }
  if (typeof payload?.uid !== 'string' || !payload.uid) return null;
  if (typeof payload.exp !== 'number') return null;
  if (payload.exp < (options.now ?? Math.floor(Date.now() / 1000))) return null;
  return payload;
}

async function hmac(data: string, keyMaterial: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(keyMaterial),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data));
  return b64urlBytes(new Uint8Array(sig));
}

function b64urlBytes(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlEncode(value: string): string {
  return b64urlBytes(new TextEncoder().encode(value));
}

function b64urlDecode(value: string): string {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((value.length + 3) % 4);
  return new TextDecoder().decode(Uint8Array.from(atob(padded), (c) => c.charCodeAt(0)));
}

// Compares in time independent of where the first difference falls. A plain ===
// returns early on the first mismatched byte, which leaks enough timing to let a
// caller search for a valid signature one byte at a time.
function timingSafeEqual(a: string, b: string): boolean {
  const maxLen = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i = 0; i < maxLen; i += 1) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}
