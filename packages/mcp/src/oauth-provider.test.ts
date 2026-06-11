import { describe, expect, it } from "vitest";
import { createAuthChallenge, handleOAuthRoute, type OAuthStore } from "./oauth-provider.js";

function makeStore(seed: Record<string, string> = {}): OAuthStore {
  const data = new Map(Object.entries(seed));
  return {
    get: async (key) => data.get(key) ?? null,
    put: async (key, value) => {
      data.set(key, value);
    },
    delete: async (key) => {
      data.delete(key);
    },
  };
}

describe("createAuthChallenge", () => {
  it("returns an MCP OAuth protected-resource challenge", () => {
    const res = createAuthChallenge({ issuer: "https://freeideastore-mcp.serge-the-dev.workers.dev" });

    expect(res.status).toBe(401);
    expect(res.headers.get("WWW-Authenticate")).toBe(
      'Bearer resource_metadata="https://freeideastore-mcp.serge-the-dev.workers.dev/.well-known/oauth-protected-resource/mcp"',
    );
  });

  it("can mark invalid bearer tokens", () => {
    const res = createAuthChallenge({ issuer: "https://freeideastore-mcp.serge-the-dev.workers.dev" }, "invalid_token");

    expect(res.headers.get("WWW-Authenticate")).toContain('error="invalid_token"');
  });
});

describe("handleOAuthRoute", () => {
  it("serves protected resource metadata for the MCP endpoint", async () => {
    const res = await handleOAuthRoute(
      new Request("https://freeideastore-mcp.serge-the-dev.workers.dev/.well-known/oauth-protected-resource/mcp"),
      {
        issuer: "https://freeideastore-mcp.serge-the-dev.workers.dev",
        fasAuthStart: "https://api.freeappstore.online/v1/auth/github/start",
        store: makeStore(),
        sessionSigningKey: "test-key",
      },
    );

    expect(res?.status).toBe(200);
    await expect(res?.json()).resolves.toEqual({
      resource: "https://freeideastore-mcp.serge-the-dev.workers.dev/mcp",
      authorization_servers: ["https://freeideastore-mcp.serge-the-dev.workers.dev"],
    });
  });

  it("shows a branded browser authorization page before provider redirect", async () => {
    const store = makeStore({
      "client:client-1": JSON.stringify({
        redirect_uris: ["http://127.0.0.1:9876/callback"],
        client_name: "Codex",
      }),
    });

    const res = await handleOAuthRoute(
      new Request(
        "https://freeideastore-mcp.serge-the-dev.workers.dev/authorize?response_type=code&client_id=client-1&redirect_uri=http%3A%2F%2F127.0.0.1%3A9876%2Fcallback&code_challenge=abc&code_challenge_method=S256",
      ),
      {
        issuer: "https://freeideastore-mcp.serge-the-dev.workers.dev",
        fasAuthStart: "https://api.freeappstore.online/v1/auth/github/start",
        store,
        sessionSigningKey: "test-key",
      },
    );

    expect(res?.status).toBe(200);
    expect(res?.headers.get("Location")).toBeNull();
    expect(res?.headers.get("Set-Cookie")).toContain("fis_mcp_oauth_inflight=1");
    const html = await res!.text();
    expect(html).toContain("Connect FreeIdeaStore MCP");
    expect(html).toContain("Codex wants to use FreeIdeaStore MCP tools");
    expect(html).toContain("/authorize/continue?nonce=");
    expect(html).toContain("provider=github");
    expect(html).toContain("provider=google");
  });

  it("redirects to GitHub only after the user continues", async () => {
    const store = makeStore({
      "authreq:nonce-1": JSON.stringify({
        clientId: "client-1",
        redirectUri: "http://127.0.0.1:9876/callback",
        codeChallenge: "abc",
        state: null,
      }),
    });

    const res = await handleOAuthRoute(
      new Request("https://freeideastore-mcp.serge-the-dev.workers.dev/authorize/continue?nonce=nonce-1&provider=github"),
      {
        issuer: "https://freeideastore-mcp.serge-the-dev.workers.dev",
        fasAuthStart: "https://api.freeappstore.online/v1/auth/github/start",
        store,
        sessionSigningKey: "test-key",
      },
    );

    expect(res?.status).toBe(302);
    const location = res?.headers.get("Location") ?? "";
    expect(location).toContain("https://api.freeappstore.online/v1/auth/github/start");
    expect(location).toContain("response_mode=query");
    expect(location).toContain("app_id=mcp");
    expect(location).toContain("return_to=");
  });

  it("can redirect to Google when selected on the confirmation page", async () => {
    const store = makeStore({
      "authreq:nonce-1": JSON.stringify({
        clientId: "client-1",
        redirectUri: "http://127.0.0.1:9876/callback",
        codeChallenge: "abc",
        state: null,
      }),
    });

    const res = await handleOAuthRoute(
      new Request("https://freeideastore-mcp.serge-the-dev.workers.dev/authorize/continue?nonce=nonce-1&provider=google"),
      {
        issuer: "https://freeideastore-mcp.serge-the-dev.workers.dev",
        fasAuthStart: "https://api.freeappstore.online/v1/auth/github/start",
        store,
        sessionSigningKey: "test-key",
      },
    );

    expect(res?.status).toBe(302);
    const location = res?.headers.get("Location") ?? "";
    expect(location).toContain("https://api.freeappstore.online/v1/auth/google/start");
    expect(location).toContain("response_mode=query");
  });

  it("does not redirect duplicate browser authorization tabs to a provider", async () => {
    const store = makeStore({
      "client:client-1": JSON.stringify({ redirect_uris: ["http://127.0.0.1:9876/callback"] }),
    });

    const res = await handleOAuthRoute(
      new Request(
        "https://freeideastore-mcp.serge-the-dev.workers.dev/authorize?response_type=code&client_id=client-1&redirect_uri=http%3A%2F%2F127.0.0.1%3A9876%2Fcallback&code_challenge=abc&code_challenge_method=S256",
        { headers: { Cookie: "fis_mcp_oauth_inflight=1" } },
      ),
      {
        issuer: "https://freeideastore-mcp.serge-the-dev.workers.dev",
        fasAuthStart: "https://api.freeappstore.online/v1/auth/github/start",
        store,
        sessionSigningKey: "test-key",
      },
    );

    expect(res?.status).toBe(200);
    expect(res?.headers.get("Location")).toBeNull();
    await expect(res?.text()).resolves.toContain("already in progress");
  });

  it("rejects unsupported providers on the continue endpoint", async () => {
    const store = makeStore({
      "authreq:nonce-1": JSON.stringify({
        clientId: "client-1",
        redirectUri: "http://127.0.0.1:9876/callback",
        codeChallenge: "abc",
        state: null,
      }),
    });

    const res = await handleOAuthRoute(
      new Request("https://freeideastore-mcp.serge-the-dev.workers.dev/authorize/continue?nonce=nonce-1&provider=password"),
      {
        issuer: "https://freeideastore-mcp.serge-the-dev.workers.dev",
        fasAuthStart: "https://api.freeappstore.online/v1/auth/github/start",
        store,
        sessionSigningKey: "test-key",
      },
    );

    expect(res?.status).toBe(400);
    await expect(res?.text()).resolves.toBe("unsupported provider");
  });
});
