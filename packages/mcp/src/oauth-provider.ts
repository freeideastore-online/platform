/**
 * OAuth 2.1 provider for MCP servers.
 *
 * Identity comes from the FreeIdeaStore site's own sign-in endpoint, and the
 * access tokens issued here are mapped to FIS sessions in the MCP Durable Object
 * store. Before #37 the identity source was FreeAppStore, which meant this
 * worker had to hold a copy of *another store's* HMAC key to verify what it was
 * handed — the coupling that broke sign-in in #34 and could not be repaired from
 * inside this repo.
 *
 * Everything else here is provider-agnostic: dynamic client registration, PKCE,
 * the nonce-keyed `authreq:` records and the code exchange were unaffected by
 * that change.
 */

import { inspectSession, mintSession, MCP_SESSION_TTL_SECONDS, type SessionFailure } from "./session.js";
import {
  AUTH_IN_FLIGHT_COOKIE,

  authConfirmPage,
  authErrorPage,
  authProvider,
  authStartRedirect,
} from "./oauth-pages.js";

export interface OAuthConfig {
  issuer: string;
  /** The site's `/.fis/auth/start`; the provider is chosen with a query param. */
  authStartUrl: string;
  store: OAuthStore;
  sessionSigningKey: string;
}

export interface OAuthStore {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
  delete(key: string): Promise<void>;
}

export function createAuthChallenge(config: Pick<OAuthConfig, "issuer">, error?: "invalid_token"): Response {
  const metadata = new URL("/.well-known/oauth-protected-resource/mcp", config.issuer);
  const params = [`resource_metadata="${metadata.toString()}"`];
  if (error) params.push(`error="${error}"`);
  return new Response("Authentication required", {
    status: 401,
    headers: {
      "WWW-Authenticate": `Bearer ${params.join(", ")}`,
      "Access-Control-Allow-Origin": "*",
    },
  });
}

export async function handleOAuthRoute(request: Request, config: OAuthConfig): Promise<Response | null> {
  const url = new URL(request.url);
  const path = url.pathname;

  if (request.method === "OPTIONS") {
    if (
      path.startsWith("/.well-known/") ||
      path === "/register" ||
      path === "/authorize" ||
      path === "/authorize/continue" ||
      path === "/oauth/callback" ||
      path === "/token"
    ) {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, Authorization",
        },
      });
    }
  }

  if (path === "/.well-known/oauth-protected-resource" || path === "/.well-known/oauth-protected-resource/mcp") {
    return json({
      resource: `${config.issuer}/mcp`,
      authorization_servers: [config.issuer],
    });
  }

  if (path === "/.well-known/oauth-authorization-server") {
    return json({
      issuer: config.issuer,
      authorization_endpoint: `${config.issuer}/authorize`,
      token_endpoint: `${config.issuer}/token`,
      registration_endpoint: `${config.issuer}/register`,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none"],
    });
  }

  if (path === "/register" && request.method === "POST") return register(request, config);
  if (path === "/authorize" && request.method === "GET") return authorize(request, config);
  if (path === "/authorize/continue" && request.method === "GET") return continueAuthorize(request, config);
  if (path === "/oauth/callback" && request.method === "GET") return oauthCallback(request, config);
  if (path === "/token" && request.method === "POST") return tokenExchange(request, config);
  return null;
}

export async function resolveOAuthToken(bearer: string, store: OAuthStore): Promise<string | null> {
  return store.get(`token:${bearer}`);
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    },
  });
}

function cookieValue(request: Request, name: string): string | null {
  const raw = request.headers.get("Cookie") ?? "";
  for (const part of raw.split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) return value.join("=") || "";
  }
  return null;
}

async function register(request: Request, config: OAuthConfig): Promise<Response> {
  const ip = request.headers.get("CF-Connecting-IP") ?? "unknown";
  const hour = Math.floor(Date.now() / 3_600_000);
  const rlKey = `rl:reg:${ip}:${hour}`;
  const count = parseInt((await config.store.get(rlKey)) ?? "0", 10);
  if (count >= 20) return json({ error: "rate_limit_exceeded" }, 429);
  await config.store.put(rlKey, String(count + 1), { expirationTtl: 3600 });

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return json({ error: "invalid_request" }, 400);
  }

  const redirectUris = body.redirect_uris;
  if (!Array.isArray(redirectUris) || redirectUris.length === 0) {
    return json({ error: "invalid_redirect_uri" }, 400);
  }

  const clientId = crypto.randomUUID();
  const client = {
    client_id: clientId,
    redirect_uris: redirectUris,
    client_name: body.client_name ?? null,
    grant_types: ["authorization_code"],
    response_types: ["code"],
    token_endpoint_auth_method: "none",
  };
  await config.store.put(`client:${clientId}`, JSON.stringify(client), {
    expirationTtl: 90 * 86_400,
  });

  return json(client, 201);
}

async function authorize(request: Request, config: OAuthConfig): Promise<Response> {
  const url = new URL(request.url);
  const responseType = url.searchParams.get("response_type");
  const clientId = url.searchParams.get("client_id");
  const redirectUri = url.searchParams.get("redirect_uri");
  const codeChallenge = url.searchParams.get("code_challenge");
  const codeChallengeMethod = url.searchParams.get("code_challenge_method");
  const state = url.searchParams.get("state");

  if (responseType !== "code") return new Response("unsupported_response_type", { status: 400 });
  if (!clientId || !redirectUri || !codeChallenge) {
    return new Response("missing client_id, redirect_uri, or code_challenge", { status: 400 });
  }
  if (codeChallengeMethod && codeChallengeMethod !== "S256") {
    return new Response("only S256 is supported", { status: 400 });
  }
  // Starting a second authorization simply supersedes the first: the confirm
  // page re-issues the cookie, so the older nonce can no longer be redeemed.
  // This used to answer with an "already in progress" page instead, which left
  // a user who abandoned one attempt locked out until the cookie aged out.
  const clientRaw = await config.store.get(`client:${clientId}`);
  if (!clientRaw) return new Response("invalid client_id", { status: 400 });
  const client = JSON.parse(clientRaw) as { redirect_uris: string[]; client_name?: string | null };
  if (!client.redirect_uris.includes(redirectUri)) {
    return new Response("redirect_uri not registered", { status: 400 });
  }

  const nonce = crypto.randomUUID();
  await config.store.put(
    `authreq:${nonce}`,
    JSON.stringify({ clientId, redirectUri, codeChallenge, state }),
    { expirationTtl: 600 },
  );

  return authConfirmPage(config, nonce, client.client_name ?? null);
}

async function continueAuthorize(request: Request, config: OAuthConfig): Promise<Response> {
  const url = new URL(request.url);
  const nonce = url.searchParams.get("nonce");
  const provider = authProvider(url.searchParams.get("provider"));
  if (!nonce) return new Response("missing nonce", { status: 400 });
  if (!provider) return new Response("unsupported provider", { status: 400 });

  const reqRaw = await config.store.get(`authreq:${nonce}`);
  if (!reqRaw) return new Response("invalid or expired nonce", { status: 400 });

  return Response.redirect(authStartRedirect(config, nonce, provider), 302);
}

/** What to tell the user for each way a handed-back session can fail to verify. */
const SESSION_FAILURE_ADVICE: Record<SessionFailure, string> = {
  expired: "The sign-in took too long to come back. Start the connection again from your MCP client.",
  bad_signature:
    "FreeIdeaStore signed you in, but this server could not confirm the result. That is a server-side configuration fault, not something you can fix by retrying — please report it.",
  malformed: "The sign-in result came back unreadable. Start the connection again from your MCP client.",
};

async function oauthCallback(request: Request, config: OAuthConfig): Promise<Response> {
  const url = new URL(request.url);
  const nonce = url.searchParams.get("nonce");
  // `fis_session` is what the site sends. `fas_session` and `session` are the
  // FreeAppStore-era names, kept so a sign-in already in flight across the
  // cutover completes instead of dead-ending (#37).
  const session =
    url.searchParams.get("fis_session") || url.searchParams.get("fas_session") || url.searchParams.get("session");
  // The site reports its own failures here, since a cross-origin redirect cannot
  // carry a fragment back to a server.
  const siteError = url.searchParams.get("auth_error");

  if (siteError) {
    console.warn(`mcp oauth callback: site reported auth_error=${siteError}`);
    return authErrorPage(
      "Sign-in did not complete",
      siteError === "denied"
        ? "You declined the sign-in, or the provider refused it. Start the connection again if that was not what you meant."
        : "FreeIdeaStore could not complete the sign-in. Start the connection again from your MCP client.",
    );
  }
  if (!nonce || !session) {
    console.warn(`mcp oauth callback: missing ${!nonce ? "nonce" : "session"} parameter`);
    return authErrorPage(
      "Sign-in did not complete",
      "The sign-in came back without everything this server needs. Start the connection again from your MCP client.",
    );
  }

  // The nonce alone proves nothing — it travels in a URL anyone can construct.
  // Only the browser that called /authorize holds the matching cookie, and
  // without this check a victim's session can be redeemed against an
  // attacker-created authorization request. See authInFlightCookie().
  if (cookieValue(request, AUTH_IN_FLIGHT_COOKIE) !== nonce) {
    console.warn("mcp oauth callback: nonce does not match the in-flight cookie");
    return authErrorPage(
      "This sign-in could not be verified",
      "The sign-in did not start in this browser. Start the connection again from your MCP client, and complete it in the window it opens.",
    );
  }

  const reqRaw = await config.store.get(`authreq:${nonce}`);
  if (!reqRaw) {
    console.warn("mcp oauth callback: nonce is unknown or expired");
    return authErrorPage(
      "This sign-in link has expired",
      "Authorization requests are only valid for ten minutes. Start the connection again from your MCP client.",
    );
  }
  await config.store.delete(`authreq:${nonce}`);

  const check = await inspectSession(session, config.sessionSigningKey);
  if (!check.ok) {
    // The reason is the whole point of this log line. #34 was slow to diagnose
    // because a key mismatch and an expiry were indistinguishable from outside,
    // and nothing was written down inside.
    console.warn(`mcp oauth callback: session rejected (${check.reason})`);
    return authErrorPage("Sign-in could not be verified", SESSION_FAILURE_ADVICE[check.reason]);
  }

  const authReq = JSON.parse(reqRaw) as {
    clientId: string;
    redirectUri: string;
    codeChallenge: string;
    state: string | null;
  };

  const code = crypto.randomUUID();
  await config.store.put(
    `code:${code}`,
    JSON.stringify({
      // The identity, not the token that carried it. The token from the site is
      // deliberately short-lived — it only has to survive one redirect — so the
      // durable credential behind the access token is minted at exchange time.
      uid: check.payload.uid,
      codeChallenge: authReq.codeChallenge,
      redirectUri: authReq.redirectUri,
      clientId: authReq.clientId,
    }),
    { expirationTtl: 600 },
  );

  const redirect = new URL(authReq.redirectUri);
  redirect.searchParams.set("code", code);
  if (authReq.state) redirect.searchParams.set("state", authReq.state);
  return new Response(null, {
    status: 302,
    headers: {
      Location: redirect.toString(),
      "Set-Cookie": `${AUTH_IN_FLIGHT_COOKIE}=; Max-Age=0; Path=/; Secure; HttpOnly; SameSite=Lax`,
    },
  });
}

async function tokenExchange(request: Request, config: OAuthConfig): Promise<Response> {
  let body: URLSearchParams;
  try {
    body = new URLSearchParams(await request.text());
  } catch {
    return json({ error: "invalid_request" }, 400);
  }

  if (body.get("grant_type") !== "authorization_code") return json({ error: "unsupported_grant_type" }, 400);

  const code = body.get("code");
  const redirectUri = body.get("redirect_uri");
  const clientId = body.get("client_id");
  const codeVerifier = body.get("code_verifier");

  if (!code || !redirectUri || !clientId || !codeVerifier) return json({ error: "invalid_request" }, 400);

  const codeRaw = await config.store.get(`code:${code}`);
  if (!codeRaw) return json({ error: "invalid_grant" }, 400);
  await config.store.delete(`code:${code}`);

  const codeData = JSON.parse(codeRaw) as {
    uid: string;
    codeChallenge: string;
    redirectUri: string;
    clientId: string;
  };

  if (codeData.redirectUri !== redirectUri || codeData.clientId !== clientId) return json({ error: "invalid_grant" }, 400);

  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(codeVerifier));
  const computed = btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

  if (computed !== codeData.codeChallenge) {
    return json({ error: "invalid_grant", error_description: "PKCE verification failed" }, 400);
  }

  // A code record written by the previous deploy carries no uid. Those are dead
  // ten minutes after a release at worst, and refusing one is a retryable error
  // for the client — minting from `undefined` would be a 500 instead.
  if (!codeData.uid) {
    console.warn("mcp token exchange: authorization code predates the identity cutover");
    return json({ error: "invalid_grant", error_description: "authorization code is no longer valid" }, 400);
  }

  // Mint the session the access token stands for, rather than storing the one
  // the site handed us: that one expires in minutes so the MCP client's tools
  // would start failing almost immediately, while this one is issued for the
  // same lifetime as the access token it sits behind. Both expire together, so
  // there is no window where a live access token maps to a dead credential.
  const session = await mintSession(codeData.uid, config.sessionSigningKey, {
    ttlSeconds: MCP_SESSION_TTL_SECONDS,
  });
  const accessToken = crypto.randomUUID();
  await config.store.put(`token:${accessToken}`, session, {
    expirationTtl: MCP_SESSION_TTL_SECONDS,
  });

  return json({
    access_token: accessToken,
    token_type: "bearer",
    expires_in: MCP_SESSION_TTL_SECONDS,
  });
}
