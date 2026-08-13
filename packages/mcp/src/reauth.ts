/**
 * Re-authorization pairing: getting a signed-in browser and a running MCP
 * session back together, without restarting the MCP connection.
 *
 * #26. A token that dies mid-task takes the whole authoring session with it.
 * The migration that produced fifteen `(chapter loading)` chapters on a live
 * page did not fail because re-authorizing is hard — it failed because there
 * was nothing in-band to reach for: no tool to call, no URL in the error, and
 * no way to have seen it coming.
 *
 * The OAuth flow in oauth-provider.ts cannot answer that on its own. It is a
 * *client* flow: the MCP client registers, holds the PKCE verifier, and swaps
 * the code at `/token`. Nothing the server can hand back mid-session lets an
 * agent complete that exchange, because the agent is not the party holding the
 * verifier.
 *
 * So this is the other half — a device-style pairing, of the shape the OAuth
 * device grant uses for input-constrained clients:
 *
 * 1. The agent (or the error body) produces a **pairing code** and a URL.
 * 2. A human opens the URL, signs in with GitHub or Google, and the callback
 *    attaches the freshly minted session to that code.
 * 3. The agent redeems the code through `complete_authentication`, and the
 *    identity is written into its own Durable Object storage — the same place
 *    the rehydration fix reads from, so it survives hibernation too.
 *
 * The code is the credential between steps 2 and 3, so it is generated from
 * `crypto.getRandomValues` (60 bits), single-use, and expires in fifteen
 * minutes whether or not anybody redeems it.
 */

import type { OAuthStore } from "./oauth-provider.js";
import type { Env } from "./mcp-types.js";

/** Where this server lives when nothing tells it otherwise. */
export const CANONICAL_ISSUER = "https://mcp.freeideastore.online";

/**
 * How long a pairing code is worth anything, in seconds.
 *
 * Long enough for a person to find the browser window, pick a provider and get
 * through a consent screen; short enough that a code left in a transcript is
 * dead by the time anyone reads the transcript.
 */
export const PAIRING_TTL_SECONDS = 900;

/**
 * No `I`, `O`, `0` or `1`: the code is read off a screen and typed back into a
 * chat window by a human, and those four are the pairs people get wrong.
 */
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const CODE_GROUPS = 3;
const CODE_GROUP_LENGTH = 4;

export interface PairingRecord {
  /** `pending` until a browser signs in against it, `ready` once one has. */
  status: "pending" | "ready";
  /** The FIS session minted for the identity that signed in. Only when ready. */
  session?: string;
  /** Stable identity id of whoever signed in. Only when ready. */
  uid?: string;
  /** Seconds since epoch, when the session above stops working. */
  expiresAt?: number;
}

function pairingKey(code: string): string {
  return `pair:${code}`;
}

/** `FIS-XXXX-XXXX-XXXX`, uppercase, from the unambiguous alphabet. */
export function newPairingCode(): string {
  const bytes = new Uint8Array(CODE_GROUPS * CODE_GROUP_LENGTH);
  crypto.getRandomValues(bytes);
  const chars = [...bytes].map((byte) => CODE_ALPHABET[byte % CODE_ALPHABET.length]);
  const groups: string[] = [];
  for (let i = 0; i < CODE_GROUPS; i += 1) {
    groups.push(chars.slice(i * CODE_GROUP_LENGTH, (i + 1) * CODE_GROUP_LENGTH).join(""));
  }
  return `FIS-${groups.join("-")}`;
}

/**
 * Accept what a human is likely to hand back.
 *
 * They may paste the code, the code in lower case, or the whole address bar —
 * `…/reauthorize?code=FIS-…` is on screen right next to it. All three name the
 * same pairing, and refusing two of them turns a recovery into a support
 * conversation.
 */
export function normalizePairingCode(raw: string | undefined | null): string | undefined {
  const value = raw?.trim();
  if (!value) return undefined;
  if (value.includes("://")) {
    try {
      const fromUrl = new URL(value).searchParams.get("code");
      return fromUrl ? fromUrl.trim().toUpperCase() : undefined;
    } catch {
      return undefined;
    }
  }
  return value.toUpperCase();
}

/** Open a pairing nobody has signed in against yet. Returns the code. */
export async function startPairing(store: OAuthStore): Promise<string> {
  const code = newPairingCode();
  await store.put(pairingKey(code), JSON.stringify({ status: "pending" } satisfies PairingRecord), {
    expirationTtl: PAIRING_TTL_SECONDS,
  });
  return code;
}

export async function readPairing(store: OAuthStore, code: string): Promise<PairingRecord | null> {
  const raw = await store.get(pairingKey(code));
  if (!raw) return null;
  try {
    const record = JSON.parse(raw) as PairingRecord;
    return record?.status === "pending" || record?.status === "ready" ? record : null;
  } catch {
    return null;
  }
}

/** Attach a signed-in identity to a pairing. Called from the OAuth callback. */
export async function completePairing(
  store: OAuthStore,
  code: string,
  identity: { session: string; uid: string; expiresAt: number },
): Promise<void> {
  await store.put(
    pairingKey(code),
    JSON.stringify({
      status: "ready",
      session: identity.session,
      uid: identity.uid,
      expiresAt: identity.expiresAt,
    } satisfies PairingRecord),
    { expirationTtl: PAIRING_TTL_SECONDS },
  );
}

/**
 * Take the identity out of a ready pairing, and burn the pairing.
 *
 * Single use on purpose: the code has been through a transcript and possibly a
 * chat window by now, and the session behind it is a live write credential.
 */
export async function redeemPairing(
  store: OAuthStore,
  code: string,
): Promise<{ session: string; uid: string; expiresAt: number } | null> {
  const record = await readPairing(store, code);
  if (!record || record.status !== "ready" || !record.session || !record.uid) return null;
  await store.delete(pairingKey(code));
  return { session: record.session, uid: record.uid, expiresAt: record.expiresAt ?? 0 };
}

/**
 * The page a human opens to sign this MCP session back in.
 *
 * Valid with no code at all — that form mints its own and shows it at the end,
 * which is what the URL in a 401 body has to be, since an expired token means
 * no tool call ever happened to produce a code.
 */
export function reauthorizeUrl(issuer: string, code?: string): string {
  const url = new URL("/reauthorize", issuer);
  if (code) url.searchParams.set("code", code);
  return url.toString();
}

/** This server's public origin, as the Durable Object sees it. */
export function mcpIssuer(env: Env): string {
  return env.MCP_ISSUER || CANONICAL_ISSUER;
}

/**
 * What a caller who has just been refused needs to know, in the body rather
 * than in a log nobody reads.
 *
 * The old 401 body was the two words "Authentication required": true, and
 * actionable by nobody. #26 asked for the fix to travel with the problem.
 */
export function reauthGuidance(issuer: string): {
  reauthorize_url: string;
  recovery: string;
} {
  return {
    reauthorize_url: reauthorizeUrl(issuer),
    recovery:
      "Call the `authenticate` tool to get a sign-in URL and a pairing code, have the user open the URL, then call `complete_authentication`. If the MCP client has withdrawn this server's tools, open the reauthorize_url above in a browser and give the pairing code it shows to your agent.",
  };
}

/** Seconds left on a credential, or null when nothing said when it expires. */
export function secondsUntil(expiresAt: number | undefined, now = Date.now()): number | null {
  if (typeof expiresAt !== "number" || !Number.isFinite(expiresAt)) return null;
  return Math.max(0, expiresAt - Math.floor(now / 1000));
}
