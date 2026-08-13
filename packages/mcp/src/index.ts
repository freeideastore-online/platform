import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createAuthChallenge, handleOAuthRoute } from "./oauth-provider.js";
import { hasIdentity, SessionAuth, type AuthStorage } from "./do-auth.js";
import { authenticateRequest, challengeFor, oauthStore } from "./mcp-auth.js";
import { mintSession, verifySession } from "./session.js";
import type { Env, McpProps } from "./mcp-types.js";
import { registerAllTools, toolCount, toolNames } from "./tool-registry.js";
import type { AuthControls } from "./register-auth-tools.js";
import { mcpIssuer } from "./reauth.js";

/** Sign-in on the FreeIdeaStore site. FIS's own since #37 — see oauth-provider.ts. */
const AUTH_START_PATH = "/.fis/auth/start";

let rootTextCache: string | undefined;

/**
 * What an agent reads at `/` before it connects.
 *
 * The tool list is read out of the registrations rather than restated beside
 * them (#72). A hand-written copy went stale at 17 of 32 and stayed there,
 * hiding every section-write, revision and refinement tool from the agents most
 * likely to need them.
 */
function rootText(): string {
  return (rootTextCache ??=
    "FreeIdeaStore MCP Server\n\n" +
    "Connect: npx mcp-remote https://mcp.freeideastore.online/mcp\n\n" +
    `Tools (${toolCount()}): ${toolNames().join(", ")}\n\n` +
    "Auth: OAuth 2.1 via browser sign-in or Authorization: Bearer <FreeIdeaStore session token>.\n" +
    "Access tokens live 24 hours. Call the authenticate tool to read expires_at for the current\n" +
    "session before starting a long multi-write task, and to renew it without reconnecting.\n" +
    "Lost authorization mid-task? Open https://mcp.freeideastore.online/reauthorize in a browser.\n");
}

export class FisMcp extends McpAgent<Env, unknown, McpProps> {
  server = new McpServer({ name: "FreeIdeaStore", version: "0.1.0" });

  /**
   * This session's identity, persisted to Durable Object storage and read back
   * on every reconstruction of the object. Created lazily because `ctx` is only
   * available once the Durable Object has been constructed. See do-auth.ts for
   * why an in-memory-only copy is not enough (#26).
   */
  private auth?: SessionAuth;

  private sessionAuth(): SessionAuth {
    this.auth ??= new SessionAuth(
      (this as unknown as { ctx: { storage: AuthStorage } }).ctx.storage,
    );
    return this.auth;
  }

  async setAuth(props: McpProps): Promise<void> {
    this.props = props;
    await this.sessionAuth().set(props);
  }

  async oauthGet(key: string): Promise<string | null> {
    const stored = await (this as unknown as { ctx: { storage: { get<T>(k: string): Promise<T | undefined>; delete(k: string): Promise<void> } } }).ctx.storage.get<{ value: string; expiresAt?: number }>(`oauth:${key}`);
    if (!stored) return null;
    if (stored.expiresAt && stored.expiresAt <= Date.now()) {
      await (this as unknown as { ctx: { storage: { delete(k: string): Promise<void> } } }).ctx.storage.delete(`oauth:${key}`);
      return null;
    }
    return stored.value;
  }

  async oauthPut(key: string, value: string, options?: { expirationTtl?: number }): Promise<void> {
    const expiresAt = options?.expirationTtl ? Date.now() + options.expirationTtl * 1000 : undefined;
    await (this as unknown as { ctx: { storage: { put(k: string, v: unknown): Promise<void> } } }).ctx.storage.put(`oauth:${key}`, { value, expiresAt });
  }

  async oauthDelete(key: string): Promise<void> {
    await (this as unknown as { ctx: { storage: { delete(k: string): Promise<void> } } }).ctx.storage.delete(`oauth:${key}`);
  }

  async init() {
    // Runs on every construction of this Durable Object, including the one after
    // Cloudflare evicts an idle session — which is exactly when the in-memory
    // identity was lost, and exactly why the auth is read back here (#26).
    await this.sessionAuth().rehydrate();
    const getProps = () => {
      const restored = this.sessionAuth().current();
      return hasIdentity(restored) ? restored : this.props || {};
    };
    registerAllTools(this.server, this.env, getProps, this.authControls(getProps));
  }

  /**
   * What `authenticate` / `complete_authentication` are allowed to do to this
   * session. Every other tool only reads identity; these two replace it, and
   * they write it through the same storage-backed path the worker uses, so a
   * recovered identity survives the next hibernation as well (#26).
   */
  private authControls(getProps: () => McpProps): AuthControls {
    return {
      issuer: mcpIssuer(this.env),
      store: oauthStore(this.env),
      current: getProps,
      adopt: async (props) => {
        this.props = props;
        await this.sessionAuth().set(props);
      },
      beginPairing: (code) => this.sessionAuth().beginPairing(code),
      pendingPairing: () => this.sessionAuth().pendingPairing(),
      clearPairing: () => this.sessionAuth().clearPairing(),
    };
  }
}

async function handleMcpRequest(request: Request, env: Env, ctx: ExecutionContext, issuer: string) {
  const auth = await authenticateRequest(request, env);
  // A token that arrived and did not work is not the same as no token at all,
  // and answering it with "you are not signed in" is how an expiry used to
  // surface as an unexplained write failure several calls later. Say which one
  // it was, and put the way back into the body (#26).
  const rejected = challengeFor(auth.status);
  if (rejected) return createAuthChallenge({ issuer }, "invalid_token", rejected);
  const sessionId = request.headers.get("mcp-session-id");
  if (auth.props.token && sessionId) {
    try {
      const id = env.MCP_OBJECT.idFromName(`streamable-http:${sessionId}`);
      const stub = env.MCP_OBJECT.get(id) as unknown as { setAuth(p: McpProps): Promise<void> };
      await stub.setAuth(auth.props);
    } catch (error) {
      // Tool handlers fall back to unsigned/public behavior, which reads to the
      // caller as "you are not signed in" on a request that carried a valid
      // token. Say so in the log rather than letting it vanish (#26).
      console.error(
        `mcp: could not hand session auth to the session object (${error instanceof Error ? error.message : String(error)})`,
      );
    }
  }
  if (!auth.props.token && request.method !== "OPTIONS" && env.SESSION_SIGNING_KEY) {
    return createAuthChallenge({ issuer });
  }
  return FisMcp.serve("/mcp").fetch(request, env, ctx);
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const url = new URL(request.url);
    const issuer = `${url.protocol}//${url.host}`;

    if (env.SESSION_SIGNING_KEY) {
      const oauthRes = await handleOAuthRoute(request, {
        issuer,
        authStartUrl: `${env.FIS_AUTH_BASE || "https://freeideastore.online"}${AUTH_START_PATH}`,
        store: oauthStore(env),
        sessionSigningKey: env.SESSION_SIGNING_KEY,
      });
      if (oauthRes) return oauthRes;
    }

    if (url.pathname === "/health") {
      return Response.json({
        ok: true,
        service: "freeideastore-mcp",
        tools: toolCount(),
        auth: await authHealth(env),
      });
    }

    if (url.pathname === "/" || url.pathname === "") {
      if (isProtocolClient(request)) return wrongEndpoint();
      return new Response(rootText(), { headers: { "content-type": "text/plain; charset=utf-8" } });
    }

    if (url.pathname === "/mcp" || url.pathname.startsWith("/mcp/")) {
      return handleMcpRequest(request, env, ctx, issuer);
    }
    // Agents that start from the MCP host should still find the canonical
    // discovery manifest instead of hitting a dead end.
    if (url.pathname === "/.well-known/mcp.json") {
      return Response.redirect("https://freeideastore.online/.well-known/mcp.json", 302);
    }

    return new Response("FreeIdeaStore MCP: use /mcp", { status: 404 });
  },
};

/**
 * Can this worker actually sign and check a session with the key it was given?
 *
 * Mint a throwaway token and verify it. This catches a `SESSION_SIGNING_KEY`
 * that is absent, empty, or otherwise unusable — the difference between "OAuth
 * is off" and "OAuth is on but nothing can sign in", which is invisible from the
 * outside because both simply refuse the client.
 *
 * What it deliberately does not claim: it cannot detect the key *disagreeing*
 * with the site's, because both sides of the check use the same local value. The
 * cross-service version of that check is what #34 wanted, and it stopped being
 * expressible once identity moved in-store — sessions are now minted and
 * verified by workers that both take the key from FIS's own secret, so a drifted
 * copy shows up as a failed sign-in with a logged `bad_signature` reason rather
 * than as something a health endpoint can see.
 */
async function authHealth(env: Env): Promise<"ok" | "broken" | "disabled"> {
  if (!env.SESSION_SIGNING_KEY) return "disabled";
  try {
    const probe = await mintSession("health-probe", env.SESSION_SIGNING_KEY, { ttlSeconds: 60 });
    return (await verifySession(probe, env.SESSION_SIGNING_KEY)) ? "ok" : "broken";
  } catch {
    return "broken";
  }
}

/**
 * Is this an MCP protocol client rather than a person in a browser?
 *
 * A client pointed at the origin instead of `/mcp` asks for the event stream
 * with `GET / Accept: text/event-stream` (the legacy SSE transport), or POSTs
 * JSON-RPC. Answering either with 200 and a short non-stream body tells the
 * client "stream opened" and then drops it — and the spec-correct response to a
 * dropped stream is to reconnect, so it redials ~1/sec, forever. The flood is
 * invisible: every response is a 200, nothing throws, no AI tokens are spent,
 * nothing is written to storage, and the rate limiter only sees `tools/call`
 * traffic carrying an account, which a bare GET has neither of.
 *
 * OPTIONS and HEAD deliberately return false so CORS preflight is unaffected.
 */
function isProtocolClient(request: Request): boolean {
  if (request.method === "POST") return true;
  return (request.headers.get("accept") ?? "").includes("text/event-stream");
}

/** The JSON-RPC 405 the MCP spec requires from an endpoint with no stream to offer. */
function wrongEndpoint(): Response {
  return new Response(
    JSON.stringify({
      jsonrpc: "2.0",
      id: null,
      error: {
        code: -32000,
        message: "Method Not Allowed — the MCP endpoint is https://mcp.freeideastore.online/mcp",
      },
    }),
    { status: 405, headers: { "content-type": "application/json", allow: "GET, HEAD" } },
  );
}
