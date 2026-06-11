/**
 * OAuth 2.1 provider for MCP servers.
 * Uses the shared FreeAppStore auth backend and stores OAuth access-token to
 * FAS session mappings in Workers KV.
 */

import { verifySession } from "./session.js";

export interface OAuthConfig {
  issuer: string;
  fasAuthStart: string;
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

  const clientRaw = await config.store.get(`client:${clientId}`);
  if (!clientRaw) return new Response("invalid client_id", { status: 400 });
  const client = JSON.parse(clientRaw) as { redirect_uris: string[] };
  if (!client.redirect_uris.includes(redirectUri)) {
    return new Response("redirect_uri not registered", { status: 400 });
  }

  const nonce = crypto.randomUUID();
  await config.store.put(
    `authreq:${nonce}`,
    JSON.stringify({ clientId, redirectUri, codeChallenge, state }),
    { expirationTtl: 600 },
  );

  const fasUrl = new URL(config.fasAuthStart);
  fasUrl.searchParams.set("response_mode", "query");
  fasUrl.searchParams.set("app_id", "mcp");
  const callbackUrl = new URL("/oauth/callback", config.issuer);
  callbackUrl.searchParams.set("nonce", nonce);
  fasUrl.searchParams.set("return_to", callbackUrl.toString());

  return Response.redirect(fasUrl.toString(), 302);
}

async function oauthCallback(request: Request, config: OAuthConfig): Promise<Response> {
  const url = new URL(request.url);
  const nonce = url.searchParams.get("nonce");
  const fasSession = url.searchParams.get("fas_session") || url.searchParams.get("session");

  if (!nonce || !fasSession) return new Response("missing nonce or fas_session", { status: 400 });

  const reqRaw = await config.store.get(`authreq:${nonce}`);
  if (!reqRaw) return new Response("invalid or expired nonce", { status: 400 });
  await config.store.delete(`authreq:${nonce}`);

  const payload = await verifySession(fasSession, config.sessionSigningKey);
  if (!payload) return new Response("invalid session", { status: 400 });

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
      fasSession,
      codeChallenge: authReq.codeChallenge,
      redirectUri: authReq.redirectUri,
      clientId: authReq.clientId,
    }),
    { expirationTtl: 600 },
  );

  const redirect = new URL(authReq.redirectUri);
  redirect.searchParams.set("code", code);
  if (authReq.state) redirect.searchParams.set("state", authReq.state);
  return Response.redirect(redirect.toString(), 302);
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
    fasSession: string;
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

  const accessToken = crypto.randomUUID();
  await config.store.put(`token:${accessToken}`, codeData.fasSession, {
    expirationTtl: 86_400,
  });

  return json({
    access_token: accessToken,
    token_type: "bearer",
    expires_in: 86_400,
  });
}
