/**
 * Turning the `Authorization` header on an MCP request into an identity — and,
 * when it cannot, saying *which* way it failed.
 *
 * #26. This used to answer one question ("did a bearer token arrive?") and
 * treat every other outcome as "no identity". An access token that had aged out
 * therefore fell through the OAuth lookup and was handed onward as if it were a
 * FIS session token, so the first *write* of the session failed somewhere deep
 * in the API with nothing tying it back to the expiry. Distinguishing the cases
 * here is what lets the worker answer an expired token with a 401 that carries
 * a re-authorization URL, instead of a tool error that carries advice for a
 * problem the caller does not have.
 */

import { resolveOAuthToken, type OAuthStore } from "./oauth-provider.js";
import { inspectSession } from "./session.js";
import type { Env, McpProps } from "./mcp-types.js";

function decodeUid(token: string): string | undefined {
  try {
    const b64 = token.split(".")[0]?.replace(/-/g, "+").replace(/_/g, "/") || "";
    const json = JSON.parse(atob(b64.padEnd(b64.length + ((4 - (b64.length % 4)) % 4), "=")));
    return typeof json.uid === "string" ? json.uid : undefined;
  } catch {
    return undefined;
  }
}

/**
 * What the `Authorization` header on this request turned out to be.
 *
 * - `none` — nobody presented a token. The client has not connected yet.
 * - `ok` — a live credential; `props` carries the identity behind it.
 * - `expired` — a credential this server recognises the *shape* of, whose life
 *   is over. The one case where re-authorizing is the whole answer.
 * - `invalid` — a token this server cannot verify at all.
 */
export type TokenStatus = "none" | "ok" | "expired" | "invalid";

export interface RequestAuth {
  props: McpProps;
  status: TokenStatus;
}

/**
 * Should this request be answered with a 401 that carries a re-auth route, and
 * what should it say happened?
 *
 * `none` is deliberately not here: a request with no token at all is a client
 * that has not connected yet, and it is handled further down where the standard
 * OAuth challenge belongs. The two cases below are the ones where a credential
 * *was* presented — telling those apart from "you are not signed in" is what
 * turns an unexplained mid-migration write failure into an actionable error.
 */
export function challengeFor(status: TokenStatus): "expired" | "invalid" | undefined {
  return status === "expired" || status === "invalid" ? status : undefined;
}

/**
 * An access token minted by `/token` is an opaque UUID. A FIS session token is
 * `base64url(payload).base64url(signature)`. A bearer with no dot in it can
 * therefore only be the former, which matters because the two fail differently:
 * a missing mapping for an opaque token means it expired, while a session token
 * carries its own expiry and can be checked directly.
 */
function isOpaqueAccessToken(bearer: string): boolean {
  return !bearer.includes(".");
}

export async function authenticateRequest(request: Request, env: Env): Promise<RequestAuth> {
  const header = request.headers.get("Authorization") || "";
  if (!header.startsWith("Bearer ")) return { props: {}, status: "none" };
  const bearer = header.slice(7).trim();
  if (!bearer) return { props: {}, status: "none" };

  const mapped = await resolveOAuthToken(bearer, oauthStore(env));
  // The mapping is written with the access token's own TTL, so a miss on an
  // opaque token is an expiry (or a revocation), not an invitation to try the
  // string as something else.
  if (!mapped && isOpaqueAccessToken(bearer)) return { props: {}, status: "expired" };

  const token = mapped ?? bearer;

  if (env.SESSION_SIGNING_KEY) {
    const check = await inspectSession(token, env.SESSION_SIGNING_KEY);
    if (!check.ok) return { props: {}, status: check.reason === "expired" ? "expired" : "invalid" };
    return {
      // `exp` comes off a payload whose signature has just been checked, so it
      // is safe to publish to callers as the session's real deadline.
      props: { userId: check.payload.uid, token, expiresAt: check.payload.exp },
      status: "ok",
    };
  }

  // No signing key configured: sessions cannot be verified here, so nothing can
  // be claimed about expiry either. Behave as this file always did.
  return { props: { userId: decodeUid(token), token }, status: "ok" };
}

type OAuthObject = {
  oauthGet(key: string): Promise<string | null>;
  oauthPut(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
  oauthDelete(key: string): Promise<void>;
};

function oauthObject(env: Env): OAuthObject {
  const id = env.MCP_OBJECT.idFromName("oauth");
  return env.MCP_OBJECT.get(id) as unknown as OAuthObject;
}

export function oauthStore(env: Env): OAuthStore {
  const object = oauthObject(env);
  return {
    get: (key) => object.oauthGet(key),
    put: (key, value, options) => object.oauthPut(key, value, options),
    delete: (key) => object.oauthDelete(key),
  };
}
