import { afterEach, describe, expect, it, vi } from "vitest";
import { createAuthChallenge, handleOAuthRoute, resolveOAuthToken, type OAuthStore } from "./oauth-provider.js";
import { mintSession, verifySession } from "./session.js";

const ISSUER = "https://mcp.freeideastore.online";
const SIGNING_KEY = "test-key";

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

function config(store: OAuthStore) {
  return {
    issuer: ISSUER,
    authStartUrl: "https://freeideastore.online/.fis/auth/start",
    store,
    sessionSigningKey: SIGNING_KEY,
  };
}

const authRequest = JSON.stringify({
  clientId: "client-1",
  redirectUri: "http://127.0.0.1:9876/callback",
  codeChallenge: "abc",
  state: null,
});

describe("createAuthChallenge", () => {
  it("returns an MCP OAuth protected-resource challenge", () => {
    const res = createAuthChallenge({ issuer: ISSUER });

    expect(res.status).toBe(401);
    expect(res.headers.get("WWW-Authenticate")).toBe(
      `Bearer resource_metadata="${ISSUER}/.well-known/oauth-protected-resource/mcp"`,
    );
  });

  it("can mark invalid bearer tokens", () => {
    const res = createAuthChallenge({ issuer: ISSUER }, "invalid_token");

    expect(res.headers.get("WWW-Authenticate")).toContain('error="invalid_token"');
  });
});

describe("handleOAuthRoute", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("serves protected resource metadata for the MCP endpoint", async () => {
    const res = await handleOAuthRoute(
      new Request(`${ISSUER}/.well-known/oauth-protected-resource/mcp`),
      config(makeStore()),
    );

    expect(res?.status).toBe(200);
    await expect(res?.json()).resolves.toEqual({
      resource: `${ISSUER}/mcp`,
      authorization_servers: [ISSUER],
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
        `${ISSUER}/authorize?response_type=code&client_id=client-1&redirect_uri=http%3A%2F%2F127.0.0.1%3A9876%2Fcallback&code_challenge=abc&code_challenge_method=S256`,
      ),
      config(store),
    );

    expect(res?.status).toBe(200);
    expect(res?.headers.get("Location")).toBeNull();
    // The cookie carries the nonce, not a flag: /oauth/callback compares the two
    // so a nonce minted by somebody else cannot be redeemed in this browser.
    const nonce = /\/authorize\/continue\?nonce=([0-9a-f-]+)/.exec(await res!.clone().text())?.[1];
    expect(nonce).toBeTruthy();
    expect(res?.headers.get("Set-Cookie")).toContain(`fis_mcp_oauth_inflight=${nonce}`);
    expect(res?.headers.get("Set-Cookie")).toContain("HttpOnly");
    const html = await res!.text();
    expect(html).toContain("Connect FreeIdeaStore MCP");
    expect(html).toContain("Codex wants to use FreeIdeaStore MCP tools");
    expect(html).toContain("/authorize/continue?nonce=");
    expect(html).toContain("provider=github");
    expect(html).toContain("provider=google");
  });

  it("hands sign-in to FreeIdeaStore, not another store, once the user continues", async () => {
    const res = await handleOAuthRoute(
      new Request(`${ISSUER}/authorize/continue?nonce=nonce-1&provider=github`),
      config(makeStore({ "authreq:nonce-1": authRequest })),
    );

    expect(res?.status).toBe(302);
    const location = new URL(res?.headers.get("Location") ?? "");
    expect(location.origin + location.pathname).toBe("https://freeideastore.online/.fis/auth/start");
    expect(location.searchParams.get("provider")).toBe("github");
    // Without this the site would only set a cookie, which cannot cross origins
    // to reach this server.
    expect(location.searchParams.get("response_mode")).toBe("query");
    expect(location.searchParams.get("return_to")).toBe(`${ISSUER}/oauth/callback?nonce=nonce-1`);
  });

  it("selects the provider with a query param rather than a path", async () => {
    const res = await handleOAuthRoute(
      new Request(`${ISSUER}/authorize/continue?nonce=nonce-1&provider=google`),
      config(makeStore({ "authreq:nonce-1": authRequest })),
    );

    const location = new URL(res?.headers.get("Location") ?? "");
    expect(location.pathname).toBe("/.fis/auth/start");
    expect(location.searchParams.get("provider")).toBe("google");
  });

  it("lets a second authorization supersede an abandoned one", async () => {
    // This used to answer "already in progress" whenever the cookie was set,
    // which stranded anyone who abandoned an attempt until it aged out. The new
    // confirm page re-issues the cookie, so the older nonce simply stops being
    // redeemable.
    const store = makeStore({
      "client:client-1": JSON.stringify({ redirect_uris: ["http://127.0.0.1:9876/callback"] }),
    });

    const res = await handleOAuthRoute(
      new Request(
        `${ISSUER}/authorize?response_type=code&client_id=client-1&redirect_uri=http%3A%2F%2F127.0.0.1%3A9876%2Fcallback&code_challenge=abc&code_challenge_method=S256`,
        { headers: { Cookie: "fis_mcp_oauth_inflight=stale-nonce" } },
      ),
      config(store),
    );

    expect(res?.status).toBe(200);
    await expect(res?.clone().text()).resolves.toContain("Connect FreeIdeaStore MCP");
    expect(res?.headers.get("Set-Cookie")).not.toContain("stale-nonce");
  });

  it("refuses a nonce that did not start in this browser", async () => {
    // The account-takeover guard. An attacker registers their own client, calls
    // /authorize to mint a nonce bound to THEIR redirect_uri, then lures a
    // victim to the site's sign-in with return_to pointing here carrying that
    // nonce. Without this check the victim's session is redeemed against the
    // attacker's authorization request and the code lands on the attacker's
    // redirect_uri — a full account takeover for one click.
    const store = makeStore({ "authreq:attacker-nonce": authRequest });
    const session = await mintSession("victim-identity", SIGNING_KEY, { ttlSeconds: 300 });

    const res = await handleOAuthRoute(
      // The victim's browser carries no cookie for the attacker's nonce.
      new Request(`${ISSUER}/oauth/callback?nonce=attacker-nonce&fis_session=${session}`),
      config(store),
    );

    expect(res?.status).not.toBe(302);
    expect(res?.headers.get("Location")).toBeNull();
    // The authorization request must survive unconsumed rather than be spent.
    expect(await store.get("authreq:attacker-nonce")).not.toBeNull();
  });

  it("refuses a nonce that does not match the cookie it was issued with", async () => {
    const store = makeStore({ "authreq:nonce-1": authRequest, "authreq:other": authRequest });
    const session = await mintSession("identity-1", SIGNING_KEY, { ttlSeconds: 300 });

    const res = await handleOAuthRoute(
      new Request(`${ISSUER}/oauth/callback?nonce=nonce-1&fis_session=${session}`, {
        headers: { Cookie: `fis_mcp_oauth_inflight=other` },
      }),
      config(store),
    );

    expect(res?.status).not.toBe(302);
    expect(await store.get("authreq:nonce-1")).not.toBeNull();
  });

  it("rejects unsupported providers on the continue endpoint", async () => {
    const res = await handleOAuthRoute(
      new Request(`${ISSUER}/authorize/continue?nonce=nonce-1&provider=password`),
      config(makeStore({ "authreq:nonce-1": authRequest })),
    );

    expect(res?.status).toBe(400);
    await expect(res?.text()).resolves.toBe("unsupported provider");
  });
});

describe("oauth callback", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("issues an authorization code for a session FreeIdeaStore signed", async () => {
    const store = makeStore({ "authreq:nonce-1": authRequest });
    const session = await mintSession("identity-1", SIGNING_KEY, { ttlSeconds: 300 });

    const res = await handleOAuthRoute(
      new Request(`${ISSUER}/oauth/callback?nonce=nonce-1&fis_session=${session}`, {
        headers: { Cookie: `fis_mcp_oauth_inflight=nonce-1` },
      }),
      config(store),
    );

    expect(res?.status).toBe(302);
    const location = new URL(res?.headers.get("Location") ?? "");
    expect(location.origin + location.pathname).toBe("http://127.0.0.1:9876/callback");
    expect(location.searchParams.get("code")).toBeTruthy();
    // The nonce is single-use.
    await expect(store.get("authreq:nonce-1")).resolves.toBeNull();
  });

  it("still accepts the pre-cutover parameter names", async () => {
    for (const param of ["fas_session", "session"]) {
      const store = makeStore({ "authreq:nonce-1": authRequest });
      const session = await mintSession("identity-1", SIGNING_KEY, { ttlSeconds: 300 });

      const res = await handleOAuthRoute(
        new Request(`${ISSUER}/oauth/callback?nonce=nonce-1&${param}=${session}`, {
        headers: { Cookie: `fis_mcp_oauth_inflight=nonce-1` },
      }),
        config(store),
      );

      expect(res?.status).toBe(302);
    }
  });

  it("names the reason a session was refused instead of saying only 'invalid session'", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const valid = await mintSession("identity-1", SIGNING_KEY, { ttlSeconds: 300 });
    const expired = await mintSession("identity-1", SIGNING_KEY, { ttlSeconds: -10 });
    const foreign = await mintSession("identity-1", "some-other-stores-key");

    const expiredRes = await handleOAuthRoute(
      new Request(`${ISSUER}/oauth/callback?nonce=nonce-1&fis_session=${expired}`, {
        headers: { Cookie: `fis_mcp_oauth_inflight=nonce-1` },
      }),
      config(makeStore({ "authreq:nonce-1": authRequest })),
    );
    const foreignRes = await handleOAuthRoute(
      new Request(`${ISSUER}/oauth/callback?nonce=nonce-1&fis_session=${foreign}`, {
        headers: { Cookie: `fis_mcp_oauth_inflight=nonce-1` },
      }),
      config(makeStore({ "authreq:nonce-1": authRequest })),
    );
    const staleNonceRes = await handleOAuthRoute(
      new Request(`${ISSUER}/oauth/callback?nonce=gone&fis_session=${valid}`, {
        headers: { Cookie: `fis_mcp_oauth_inflight=gone` },
      }),
      config(makeStore()),
    );

    expect(expiredRes?.status).toBe(400);
    expect(foreignRes?.status).toBe(400);
    expect(staleNonceRes?.status).toBe(400);
    // The user gets a page, not four words of plain text (#34).
    expect(foreignRes?.headers.get("Content-Type")).toContain("text/html");
    await expect(foreignRes?.text()).resolves.toContain("FreeIdeaStore");
    // The operator gets the distinction the browser cannot show them.
    const logged = warn.mock.calls.map((call) => String(call[0]));
    expect(logged.some((line) => line.includes("expired"))).toBe(true);
    expect(logged.some((line) => line.includes("bad_signature"))).toBe(true);
    expect(logged.some((line) => line.includes("nonce"))).toBe(true);
  });

  it("reports a failure the site sends back on the redirect", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});

    const res = await handleOAuthRoute(
      new Request(`${ISSUER}/oauth/callback?nonce=nonce-1&auth_error=denied`, {
        headers: { Cookie: `fis_mcp_oauth_inflight=nonce-1` },
      }),
      config(makeStore({ "authreq:nonce-1": authRequest })),
    );

    expect(res?.status).toBe(400);
    await expect(res?.text()).resolves.toContain("declined");
  });

  it("clears the in-flight cookie on failure so a retry is not blocked", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});

    const res = await handleOAuthRoute(
      new Request(`${ISSUER}/oauth/callback?nonce=nonce-1`, {
        headers: { Cookie: `fis_mcp_oauth_inflight=nonce-1` },
      }),
      config(makeStore({ "authreq:nonce-1": authRequest })),
    );

    expect(res?.headers.get("Set-Cookie")).toContain("fis_mcp_oauth_inflight=; Max-Age=0");
  });
});

describe("token exchange", () => {
  async function codeFor(store: OAuthStore, verifier: string) {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
    const challenge = btoa(String.fromCharCode(...new Uint8Array(digest)))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    await store.put(
      "authreq:nonce-1",
      JSON.stringify({
        clientId: "client-1",
        redirectUri: "http://127.0.0.1:9876/callback",
        codeChallenge: challenge,
        state: null,
      }),
    );
    const session = await mintSession("identity-1", SIGNING_KEY, { ttlSeconds: 300 });
    const callback = await handleOAuthRoute(
      new Request(`${ISSUER}/oauth/callback?nonce=nonce-1&fis_session=${session}`, {
        headers: { Cookie: `fis_mcp_oauth_inflight=nonce-1` },
      }),
      config(store),
    );
    return new URL(callback?.headers.get("Location") ?? "").searchParams.get("code") ?? "";
  }

  it("exchanges a code for an access token backed by a fresh long-lived session", async () => {
    const store = makeStore();
    const verifier = "verifier-abcdefghijklmnopqrstuvwxyz";
    const code = await codeFor(store, verifier);

    const res = await handleOAuthRoute(
      new Request(`${ISSUER}/token`, {
        method: "POST",
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code,
          redirect_uri: "http://127.0.0.1:9876/callback",
          client_id: "client-1",
          code_verifier: verifier,
        }).toString(),
      }),
      config(store),
    );

    const body = (await res?.json()) as { access_token: string; expires_in: number };
    expect(res?.status).toBe(200);
    expect(body.expires_in).toBe(86_400);

    // The credential behind the access token must outlive the minutes-long token
    // the site handed over, or every tool call would fail shortly after sign-in.
    const stored = await resolveOAuthToken(body.access_token, store);
    const payload = await verifySession(stored ?? "", SIGNING_KEY);
    expect(payload?.uid).toBe("identity-1");
    expect((payload?.exp ?? 0) - Math.floor(Date.now() / 1000)).toBeGreaterThan(3600);
  });

  it("rejects a code redeemed with the wrong PKCE verifier", async () => {
    const store = makeStore();
    const code = await codeFor(store, "verifier-abcdefghijklmnopqrstuvwxyz");

    const res = await handleOAuthRoute(
      new Request(`${ISSUER}/token`, {
        method: "POST",
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code,
          redirect_uri: "http://127.0.0.1:9876/callback",
          client_id: "client-1",
          code_verifier: "not-the-verifier",
        }).toString(),
      }),
      config(store),
    );

    expect(res?.status).toBe(400);
    await expect(res?.json()).resolves.toMatchObject({ error: "invalid_grant" });
  });
});
