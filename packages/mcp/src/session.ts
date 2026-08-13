// FIS session tokens: base64url(payload) + "." + base64url(HMAC-SHA256).
//
// A vendored copy of packages/worker/src/session.ts, kept in step with it by
// hand. The workspace rule is vendor-don't-depend, and a Worker entrypoint has
// nothing to import from a sibling Worker anyway.
//
// Until #37 this file verified *FreeAppStore*-signed tokens with a copy of
// FreeAppStore's key, which is what broke in #34: the two workers' copies
// drifted and nothing in FIS could fix it. Both halves of the flow now sign with
// FIS's own SESSION_SIGNING_KEY.
//
// The mint half exists because the OAuth handoff token the site puts on the
// redirect URL lives for minutes, while the MCP access token issued in exchange
// for it lives for a day. Storing the handoff token as the account credential
// would strand every tool call five minutes after sign-in, so /token mints a
// fresh session for the same uid instead — see oauth-provider.ts.

export interface SessionPayload {
  /** Stable identity id — `identities.id` on the site, not the handle. */
  uid: string;
  roles?: string[];
  /** Seconds since epoch. */
  iat: number;
  /** Seconds since epoch. */
  exp: number;
}

/**
 * Why a token did not verify. Worth distinguishing because the two failures have
 * nothing in common operationally: `expired` is a user who waited too long and
 * should sign in again, `bad_signature` means the two workers disagree about the
 * signing key and no amount of retrying will help. #34 spent its whole diagnosis
 * budget on the fact that both surfaced as the same four words.
 */
export type SessionFailure = "malformed" | "bad_signature" | "expired";

export type SessionCheck =
  | { ok: true; payload: SessionPayload }
  | { ok: false; reason: SessionFailure };

export async function inspectSession(token: string, signingKey: string): Promise<SessionCheck> {
  if (!token || !signingKey) return { ok: false, reason: "malformed" };
  const dot = token.lastIndexOf(".");
  if (dot < 0) return { ok: false, reason: "malformed" };
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  // Signature first: never parse attacker-controlled JSON we have not authenticated.
  if (!timingSafeEqual(sig, await hmac(body, signingKey))) return { ok: false, reason: "bad_signature" };
  let payload: SessionPayload;
  try {
    payload = JSON.parse(b64urlDecode(body)) as SessionPayload;
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (typeof payload?.uid !== "string" || !payload.uid) return { ok: false, reason: "malformed" };
  if (typeof payload.exp !== "number") return { ok: false, reason: "malformed" };
  if (payload.exp < Math.floor(Date.now() / 1000)) return { ok: false, reason: "expired" };
  return { ok: true, payload };
}

export async function verifySession(token: string, signingKey: string): Promise<SessionPayload | null> {
  const result = await inspectSession(token, signingKey);
  return result.ok ? result.payload : null;
}

export interface MintOptions {
  roles?: string[];
  ttlSeconds?: number;
  /** Seconds since epoch; injectable so tests need no clock control. */
  now?: number;
}

/** Matches the MCP access-token lifetime, so credential and token expire together. */
export const MCP_SESSION_TTL_SECONDS = 86_400;

export async function mintSession(
  uid: string,
  signingKey: string,
  options: MintOptions = {},
): Promise<string> {
  if (!uid) throw new Error("mintSession: uid is required");
  if (!signingKey) throw new Error("mintSession: signingKey is required");
  const now = options.now ?? Math.floor(Date.now() / 1000);
  const payload: SessionPayload = {
    uid,
    ...(options.roles?.length ? { roles: options.roles } : {}),
    iat: now,
    exp: now + (options.ttlSeconds ?? MCP_SESSION_TTL_SECONDS),
  };
  const body = b64urlEncode(JSON.stringify(payload));
  return `${body}.${await hmac(body, signingKey)}`;
}

async function hmac(data: string, keyMaterial: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(keyMaterial),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
  return b64urlBytes(new Uint8Array(sig));
}

function b64urlBytes(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlEncode(value: string): string {
  return b64urlBytes(new TextEncoder().encode(value));
}

function b64urlDecode(s: string): string {
  const padded = s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4);
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
