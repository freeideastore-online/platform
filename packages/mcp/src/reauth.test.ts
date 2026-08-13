import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { describe, expect, it } from "vitest";
import type { ZodTypeAny } from "zod";
import { AUTH_PROPS_KEY, PAIRING_CODE_KEY, SessionAuth, type AuthStorage } from "./do-auth.js";
import { authenticateRequest, challengeFor } from "./mcp-auth.js";
import type { Env, McpProps, TextResult } from "./mcp-types.js";
import { createAuthChallenge, handleOAuthRoute, type OAuthStore } from "./oauth-provider.js";
import { registerAuthTools, type AuthControls } from "./register-auth-tools.js";
import {
  completePairing,
  newPairingCode,
  normalizePairingCode,
  readPairing,
  reauthorizeUrl,
  redeemPairing,
  secondsUntil,
  startPairing,
} from "./reauth.js";
import { mintSession, verifySession, MCP_SESSION_TTL_SECONDS } from "./session.js";
import { registerAllTools, toolNames } from "./tool-registry.js";

/**
 * #26, the three asks the rehydration fix did not cover.
 *
 * The incident these cases stand for: a migration wrote fifteen chapter shells
 * reading `(chapter loading)`, lost its authorization, and had no way to get it
 * back from inside the session — so the shells stayed on a live public page
 * until a human intervened. What follows checks the three things that would
 * have changed that: a tool pair to recover with, a URL in the error that says
 * where to go, and a readable expiry so the run is not started at all when
 * there is not enough time left to finish it.
 */

const ISSUER = "https://mcp.freeideastore.online";
const SIGNING_KEY = "test-signing-key";
const UID = "identity-42";

/** The shared OAuth record store, as a map. */
function makeStore(): OAuthStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
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

// ---------------------------------------------------------------------------
// Ask 3: the expiry a caller can read before it commits to a long run.
// ---------------------------------------------------------------------------

describe("reading how much authorization is left (#26 ask 3)", () => {
  it("reports the seconds remaining on a credential", () => {
    const now = 1_700_000_000_000;
    expect(secondsUntil(1_700_000_000 + 3600, now)).toBe(3600);
  });

  it("floors at zero rather than counting backwards past the expiry", () => {
    const now = 1_700_000_000_000;
    expect(secondsUntil(1_700_000_000 - 500, now)).toBe(0);
  });

  it("says nothing rather than guessing when no expiry is known", () => {
    expect(secondsUntil(undefined)).toBeNull();
  });
});

describe("the edge reads the expiry off the token (#26 ask 3)", () => {
  function env(store: { data: Map<string, string> }, signingKey: string | undefined = SIGNING_KEY): Env {
    const object = {
      oauthGet: async (key: string) => store.data.get(key) ?? null,
      oauthPut: async (key: string, value: string) => {
        store.data.set(key, value);
      },
      oauthDelete: async (key: string) => {
        store.data.delete(key);
      },
    };
    return {
      SESSION_SIGNING_KEY: signingKey,
      MCP_OBJECT: {
        idFromName: () => "oauth-id",
        get: () => object,
      },
    } as unknown as Env;
  }

  const bearer = (token: string) => new Request(`${ISSUER}/mcp`, { headers: { Authorization: `Bearer ${token}` } });

  it("hands tools a verified identity and the moment it stops working", async () => {
    const store = makeStore();
    const session = await mintSession(UID, SIGNING_KEY, { ttlSeconds: 3600 });
    store.data.set("token:access-token-1", session);

    const auth = await authenticateRequest(bearer("access-token-1"), env(store));

    expect(auth.status).toBe("ok");
    expect(auth.props.userId).toBe(UID);
    // The whole point of ask 3: a number a caller can compare against the work
    // it is about to start. Before this it was simply not on the request.
    expect(secondsUntil(auth.props.expiresAt)).toBeGreaterThan(3500);
    expect(secondsUntil(auth.props.expiresAt)).toBeLessThanOrEqual(3600);
  });

  it("calls an access token with no mapping expired, instead of passing it on as a session", async () => {
    // This is the shape of the original failure. The store lookup missed, the
    // opaque token was handed onward as if it were a FIS session token, and the
    // first WRITE of the session failed inside the API with nothing connecting
    // it back to an expiry.
    const auth = await authenticateRequest(bearer("6f1e6a2c-0000-4000-8000-000000000000"), env(makeStore()));

    expect(auth.status).toBe("expired");
    expect(auth.props).toEqual({});
  });

  it("calls a session token past its exp expired", async () => {
    const store = makeStore();
    const dead = await mintSession(UID, SIGNING_KEY, { ttlSeconds: 60, now: Math.floor(Date.now() / 1000) - 3600 });

    const auth = await authenticateRequest(bearer(dead), env(store));

    expect(auth.status).toBe("expired");
  });

  it("separates a token it cannot verify from one that ran out", async () => {
    const store = makeStore();
    const foreign = await mintSession(UID, "some-other-workers-key", { ttlSeconds: 3600 });

    expect((await authenticateRequest(bearer(foreign), env(store))).status).toBe("invalid");
  });

  it("reports no token at all as its own case", async () => {
    const auth = await authenticateRequest(new Request(`${ISSUER}/mcp`), env(makeStore()));

    expect(auth.status).toBe("none");
  });

  it("turns a rejected credential into a challenge, and leaves the other two alone", () => {
    // A token that was presented and did not work gets the 401 with the way
    // back in it. A request carrying no token is the client's ordinary OAuth
    // handshake and must keep going down the existing path.
    expect(challengeFor("expired")).toBe("expired");
    expect(challengeFor("invalid")).toBe("invalid");
    expect(challengeFor("none")).toBeUndefined();
    expect(challengeFor("ok")).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Ask 2: the way back, carried by the error that named the problem.
// ---------------------------------------------------------------------------

describe("the 401 body carries the fix, not only the problem (#26 ask 2)", () => {
  const body = async (res: Response) => JSON.parse(await res.text());

  it("names the re-authorization page an expired caller should open", async () => {
    const res = createAuthChallenge({ issuer: ISSUER }, "invalid_token", "expired");
    const payload = await body(res);

    expect(res.status).toBe(401);
    expect(payload.reauthorize_url).toBe(`${ISSUER}/reauthorize`);
    expect(payload.error_description).toContain("expired");
    // The in-band route, for the case where the client has NOT withdrawn tools.
    expect(payload.recovery).toContain("authenticate");
    expect(payload.recovery).toContain("complete_authentication");
  });

  it("does not call a caller who never signed in expired", async () => {
    const payload = await body(createAuthChallenge({ issuer: ISSUER }));

    expect(payload.error_description).not.toContain("expired");
    expect(payload.reauthorize_url).toBe(`${ISSUER}/reauthorize`);
  });

  it("keeps the WWW-Authenticate header MCP clients drive their own OAuth from", () => {
    const res = createAuthChallenge({ issuer: ISSUER }, "invalid_token", "expired");

    expect(res.headers.get("WWW-Authenticate")).toContain(
      `resource_metadata="${ISSUER}/.well-known/oauth-protected-resource/mcp"`,
    );
    expect(res.headers.get("WWW-Authenticate")).toContain('error="invalid_token"');
  });
});

// ---------------------------------------------------------------------------
// The browser half of the pairing.
// ---------------------------------------------------------------------------

describe("pairing records", () => {
  it("mints codes a human can read off a screen and type back", () => {
    const code = newPairingCode();

    expect(code).toMatch(/^FIS-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
    // The four characters people confuse are absent by construction.
    expect(code.slice(4)).not.toMatch(/[IO01]/);
    expect(new Set(Array.from({ length: 50 }, () => newPairingCode())).size).toBe(50);
  });

  it("accepts the code however the user hands it back", () => {
    expect(normalizePairingCode("fis-abcd-efgh-jkmn")).toBe("FIS-ABCD-EFGH-JKMN");
    expect(normalizePairingCode("  FIS-ABCD-EFGH-JKMN  ")).toBe("FIS-ABCD-EFGH-JKMN");
    expect(normalizePairingCode("https://mcp.freeideastore.online/reauthorize?code=FIS-ABCD-EFGH-JKMN")).toBe(
      "FIS-ABCD-EFGH-JKMN",
    );
    expect(normalizePairingCode(undefined)).toBeUndefined();
    expect(normalizePairingCode("   ")).toBeUndefined();
  });

  it("is single use: the second redemption of a code gets nothing", async () => {
    const store = makeStore();
    const code = await startPairing(store);
    await completePairing(store, code, { session: "session-token", uid: UID, expiresAt: 999 });

    expect(await redeemPairing(store, code)).toEqual({ session: "session-token", uid: UID, expiresAt: 999 });
    expect(await redeemPairing(store, code)).toBeNull();
    expect(await readPairing(store, code)).toBeNull();
  });

  it("refuses to hand over an identity nobody has signed in for yet", async () => {
    const store = makeStore();
    const code = await startPairing(store);

    expect((await readPairing(store, code))?.status).toBe("pending");
    expect(await redeemPairing(store, code)).toBeNull();
  });

  it("builds a re-authorization URL that works with and without a code", () => {
    expect(reauthorizeUrl(ISSUER)).toBe(`${ISSUER}/reauthorize`);
    expect(reauthorizeUrl(ISSUER, "FIS-ABCD-EFGH-JKMN")).toBe(`${ISSUER}/reauthorize?code=FIS-ABCD-EFGH-JKMN`);
  });
});

describe("the /reauthorize browser flow (#26 ask 1 and 2)", () => {
  const nonceOf = (html: string) => new URL(html.match(/href="([^"]*authorize\/continue[^"]*)"/)![1]!).searchParams.get("nonce")!;

  it("works with no code at all, which is the case an expired token leaves behind", async () => {
    // When the token dies outright the MCP client withdraws the server's tools,
    // so no `authenticate` call can have produced a code. This entry point is
    // the one the 401 body points at, and it has to stand alone.
    const store = makeStore();

    const res = (await handleOAuthRoute(new Request(`${ISSUER}/reauthorize`), config(store)))!;
    const html = await res.text();

    expect(res.status).toBe(200);
    expect(html).toContain("Sign back in to FreeIdeaStore MCP");
    expect(html).toContain("Continue with GitHub");
    expect(res.headers.get("Set-Cookie")).toContain("fis_mcp_oauth_inflight=");
    // It minted its own pairing to attach the sign-in to.
    expect([...store.data.keys()].filter((key) => key.startsWith("pair:"))).toHaveLength(1);
  });

  it("adopts the code an agent already handed the user, rather than minting a second one", async () => {
    const store = makeStore();
    const code = await startPairing(store);

    await handleOAuthRoute(new Request(`${ISSUER}/reauthorize?code=${code}`), config(store));

    expect([...store.data.keys()].filter((key) => key.startsWith("pair:"))).toEqual([`pair:${code}`]);
  });

  it("says so plainly when the link has aged out", async () => {
    const res = (await handleOAuthRoute(new Request(`${ISSUER}/reauthorize?code=FIS-DEAD-DEAD-DEAD`), config(makeStore())))!;

    expect(res.status).toBe(400);
    expect(await res.text()).toContain("expired");
  });

  it("attaches a usable session to the pairing once the user signs in", async () => {
    const store = makeStore();
    const started = (await handleOAuthRoute(new Request(`${ISSUER}/reauthorize`), config(store)))!;
    const nonce = nonceOf(await started.text());
    const code = [...store.data.keys()].find((key) => key.startsWith("pair:"))!.slice("pair:".length);

    const handoff = await mintSession(UID, SIGNING_KEY, { ttlSeconds: 300 });
    const res = (await handleOAuthRoute(
      new Request(`${ISSUER}/oauth/callback?nonce=${nonce}&fis_session=${handoff}`, {
        headers: { Cookie: `fis_mcp_oauth_inflight=${nonce}` },
      }),
      config(store),
    ))!;
    const html = await res.text();

    expect(res.status).toBe(200);
    // The code is printed, because the human may be the only one holding it.
    expect(html).toContain(code);
    expect(html).toContain("complete_authentication");

    const record = await readPairing(store, code);
    expect(record?.status).toBe("ready");
    expect(record?.uid).toBe(UID);
    // Not the site's short-lived handoff token — a session minted for the same
    // lifetime as the authorization it restores.
    expect(record?.session).not.toBe(handoff);
    expect(await verifySession(record!.session!, SIGNING_KEY)).toMatchObject({ uid: UID });
    expect(secondsUntil(record?.expiresAt)).toBeGreaterThan(MCP_SESSION_TTL_SECONDS - 60);
  });

  it("still refuses a callback that did not start in this browser", async () => {
    // The pairing flow reuses the nonce/cookie binding, so it must not be a way
    // around it: without the cookie an attacker's nonce could collect a victim's
    // sign-in.
    const store = makeStore();
    const started = (await handleOAuthRoute(new Request(`${ISSUER}/reauthorize`), config(store)))!;
    const nonce = nonceOf(await started.text());
    const handoff = await mintSession(UID, SIGNING_KEY, { ttlSeconds: 300 });

    const res = (await handleOAuthRoute(
      new Request(`${ISSUER}/oauth/callback?nonce=${nonce}&fis_session=${handoff}`),
      config(store),
    ))!;

    expect(res.status).toBe(400);
    const code = [...store.data.keys()].find((key) => key.startsWith("pair:"))!.slice("pair:".length);
    expect((await readPairing(store, code))?.status).toBe("pending");
  });

  it("leaves the ordinary OAuth code exchange alone", async () => {
    // /reauthorize is an addition, not a replacement: a real MCP client still
    // gets an authorization code redirected to its registered redirect_uri.
    const store = makeStore();
    const nonce = "nonce-1";
    store.data.set(
      `authreq:${nonce}`,
      JSON.stringify({ clientId: "client-1", redirectUri: "http://127.0.0.1:9876/callback", codeChallenge: "abc", state: "s" }),
    );
    const handoff = await mintSession(UID, SIGNING_KEY, { ttlSeconds: 300 });

    const res = (await handleOAuthRoute(
      new Request(`${ISSUER}/oauth/callback?nonce=${nonce}&fis_session=${handoff}`, {
        headers: { Cookie: `fis_mcp_oauth_inflight=${nonce}` },
      }),
      config(store),
    ))!;

    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toContain("http://127.0.0.1:9876/callback?code=");
  });
});

// ---------------------------------------------------------------------------
// Ask 1: the tool pair.
// ---------------------------------------------------------------------------

type Handler = (input: Record<string, unknown>) => Promise<TextResult>;

/** Durable Object storage, minus the object — the same fake shape do-auth uses. */
class FakeStorage implements AuthStorage {
  readonly data = new Map<string, unknown>();
  async get<T>(key: string): Promise<T | undefined> {
    return this.data.get(key) as T | undefined;
  }
  async put(key: string, value: unknown): Promise<void> {
    this.data.set(key, value);
  }
}

/** A session Durable Object, reduced to what the two auth tools may do to it. */
function harness(initial?: McpProps) {
  const store = makeStore();
  const storage = new FakeStorage();
  const auth = new SessionAuth(storage);
  const handlers: Record<string, Handler> = {};
  const schemas: Record<string, Record<string, ZodTypeAny>> = {};
  const descriptions: Record<string, string> = {};

  const controls: AuthControls = {
    issuer: ISSUER,
    store,
    current: () => auth.current(),
    adopt: async (props) => {
      await auth.set(props);
    },
    beginPairing: (code) => auth.beginPairing(code),
    pendingPairing: () => auth.pendingPairing(),
    clearPairing: () => auth.clearPairing(),
  };

  const server = {
    tool: (name: string, description: string, schema: Record<string, ZodTypeAny>, handler: Handler) => {
      handlers[name] = handler;
      schemas[name] = schema;
      descriptions[name] = description;
    },
  } as unknown as McpServer;

  registerAuthTools(server, {} as Env, () => auth.current(), controls);

  return {
    store,
    storage,
    auth,
    schemas,
    descriptions,
    ready: initial ? auth.set(initial) : Promise.resolve(true),
    call: async (tool: string, input: Record<string, unknown> = {}) =>
      JSON.parse((await handlers[tool]!(input)).content[0]!.text) as Record<string, unknown>,
  };
}

const live = (ttlSeconds: number): McpProps => ({
  userId: UID,
  token: "fis-session-token",
  expiresAt: Math.floor(Date.now() / 1000) + ttlSeconds,
});

describe("authenticate (#26 ask 1 and 3)", () => {
  it("reports the expiry of a healthy session instead of starting a sign-in", async () => {
    const h = harness(live(6 * 3600));
    await h.ready;

    const out = await h.call("authenticate");

    expect(out.authenticated).toBe(true);
    expect(out.user_id).toBe(UID);
    expect(out.expires_in_seconds).toBeGreaterThan(6 * 3600 - 60);
    expect(String(out.expires_at)).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(out.renew_recommended).toBe(false);
    expect(out.authorization_url).toBeUndefined();
  });

  it("tells a caller to renew first when there is not enough time to finish a long run", async () => {
    // The whole of ask 3: fifteen chapter writes started with ten minutes left
    // is the incident. The tool has to say so before, not after.
    const h = harness(live(600));
    await h.ready;

    const out = await h.call("authenticate");

    expect(out.renew_recommended).toBe(true);
    expect(String(out.next_step)).toContain("force");
  });

  it("starts a sign-in when there is no identity, and remembers it against the session", async () => {
    const h = harness();

    const out = await h.call("authenticate");

    expect(out.authenticated).toBe(false);
    expect(out.pairing_code).toMatch(/^FIS-/);
    expect(out.authorization_url).toBe(`${ISSUER}/reauthorize?code=${out.pairing_code}`);
    expect((await readPairing(h.store, String(out.pairing_code)))?.status).toBe("pending");
    // Written to Durable Object storage, because the human going off to a
    // browser is exactly the idle gap that gets the object evicted.
    expect(h.storage.data.get(PAIRING_CODE_KEY)).toBe(out.pairing_code);
  });

  it("renews on request even though the session is still signed in", async () => {
    const h = harness(live(600));
    await h.ready;

    const out = await h.call("authenticate", { force: true });

    expect(out.pairing_code).toMatch(/^FIS-/);
    expect(out.authorization_url).toContain("/reauthorize?code=");
  });

  it("tells the caller to check the account before writing", async () => {
    // Near-identical handles across GitHub and Google (serge-ivo / serge-ivy)
    // produced a silent wrong-account state during the original incident.
    const h = harness();

    expect(String((await h.call("authenticate")).next_step)).toContain("user_id");
  });
});

describe("complete_authentication (#26 ask 1)", () => {
  async function signIn(h: ReturnType<typeof harness>, code: string) {
    await completePairing(h.store, code, {
      session: "recovered-session-token",
      uid: UID,
      expiresAt: Math.floor(Date.now() / 1000) + MCP_SESSION_TTL_SECONDS,
    });
  }

  it("restores writes to a session that had lost them, with no arguments", async () => {
    const h = harness();
    const started = await h.call("authenticate");
    await signIn(h, String(started.pairing_code));

    const out = await h.call("complete_authentication");

    expect(out.authenticated).toBe(true);
    expect(out.user_id).toBe(UID);
    expect(out.expires_in_seconds).toBeGreaterThan(MCP_SESSION_TTL_SECONDS - 60);
    // Bound to the session the way the worker binds it, so the recovered
    // identity survives the next hibernation as well.
    expect(h.auth.current().token).toBe("recovered-session-token");
    expect(h.storage.data.get(AUTH_PROPS_KEY)).toMatchObject({ token: "recovered-session-token", userId: UID });
  });

  it("accepts a code read back by a user who started at the reauthorize page", async () => {
    const h = harness();
    const code = await startPairing(h.store);
    await signIn(h, code);

    const out = await h.call("complete_authentication", { pairing_code: code.toLowerCase() });

    expect(out.authenticated).toBe(true);
    expect(h.auth.current().userId).toBe(UID);
  });

  it("says the sign-in is not finished rather than failing, so the agent can wait", async () => {
    const h = harness();
    const started = await h.call("authenticate");

    const out = await h.call("complete_authentication");

    expect(out.authenticated).toBe(false);
    expect(out.status).toBe("waiting_for_sign_in");
    expect(out.authorization_url).toContain(String(started.pairing_code));
    expect(h.auth.current()).toEqual({});
  });

  it("refuses a code this session did not start", async () => {
    // The code is a live write credential between sign-in and redemption.
    // Redeeming somebody else's would move their identity onto this session.
    const h = harness();
    await h.call("authenticate");
    const otherSessionsCode = await startPairing(h.store);
    await signIn(h, otherSessionsCode);

    const out = await h.call("complete_authentication", { pairing_code: otherSessionsCode });

    expect(String(out.error)).toContain("not started by this session");
    expect(h.auth.current()).toEqual({});
  });

  it("cannot be replayed", async () => {
    const h = harness();
    const started = await h.call("authenticate");
    await signIn(h, String(started.pairing_code));
    await h.call("complete_authentication");

    const out = await h.call("complete_authentication");

    expect(out.authenticated).toBeUndefined();
    expect(String(out.error)).toContain("No sign-in is in progress");
  });

  it("points at authenticate when nothing is in progress", async () => {
    const out = await harness().call("complete_authentication");

    expect(String(out.next_step)).toContain("authenticate");
  });

  it("gives up on an expired pairing instead of waiting forever", async () => {
    const h = harness();
    const started = await h.call("authenticate");
    // Pairings carry a TTL in the store; expiry is the record disappearing.
    h.store.data.delete(`pair:${started.pairing_code}`);

    const out = await h.call("complete_authentication");

    expect(String(out.error)).toContain("expired");
    expect(await h.auth.pendingPairing()).toBeUndefined();
  });
});

describe("the pair is reachable the way every other tool is", () => {
  it("is advertised, because a tool nobody can see is a tool nobody calls", () => {
    // #72's rule: registration is the single source of the advertised list, so
    // these two arrive on every surface that reads it.
    expect(toolNames()).toContain("authenticate");
    expect(toolNames()).toContain("complete_authentication");
  });

  it("is wired through registerAllTools with controls that can write identity", async () => {
    const handlers: Record<string, Handler> = {};
    const server = {
      tool: (name: string, _d: string, _s: unknown, handler: Handler) => {
        handlers[name] = handler;
      },
    } as unknown as McpServer;
    const storage = new FakeStorage();
    const auth = new SessionAuth(storage);
    const store = makeStore();

    registerAllTools(server, {} as Env, () => auth.current(), {
      issuer: ISSUER,
      store,
      current: () => auth.current(),
      adopt: (props) => auth.set(props).then(() => undefined),
      beginPairing: (code) => auth.beginPairing(code),
      pendingPairing: () => auth.pendingPairing(),
      clearPairing: () => auth.clearPairing(),
    });

    const started = JSON.parse((await handlers.authenticate!({})).content[0]!.text);
    expect(started.pairing_code).toMatch(/^FIS-/);
    expect(await readPairing(store, started.pairing_code)).not.toBeNull();
  });

  it("degrades to an explanation when the Durable Object cannot back it", async () => {
    // `collectToolNames` registers with no controls at all. The handlers must
    // still exist and must not throw, or reading the tool list would crash.
    const handlers: Record<string, Handler> = {};
    const server = {
      tool: (name: string, _d: string, _s: unknown, handler: Handler) => {
        handlers[name] = handler;
      },
    } as unknown as McpServer;
    registerAuthTools(server, {} as Env, () => ({}));

    for (const tool of ["authenticate", "complete_authentication"]) {
      const out = JSON.parse((await handlers[tool]!({})).content[0]!.text);
      expect(String(out.error)).toContain("unavailable");
    }
  });
});

describe("pairing codes survive the hibernation that made them necessary", () => {
  it("is still redeemable after the Durable Object is evicted mid-sign-in", async () => {
    // The human is in a browser choosing a provider. That pause is precisely
    // what gets the object evicted — the failure mode this whole issue is about.
    const storage = new FakeStorage();
    const store = makeStore();
    const code = await startPairing(store);

    await new SessionAuth(storage).beginPairing(code);

    const woken = new SessionAuth(storage);
    expect(await woken.pendingPairing()).toBe(code);
  });

  it("forgets a pairing once it is spent", async () => {
    const storage = new FakeStorage();
    const auth = new SessionAuth(storage);
    await auth.beginPairing("FIS-ABCD-EFGH-JKMN");

    await auth.clearPairing();

    expect(await auth.pendingPairing()).toBeUndefined();
    expect(await new SessionAuth(storage).pendingPairing()).toBeUndefined();
  });
});
