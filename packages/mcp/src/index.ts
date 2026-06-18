import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createAuthChallenge, handleOAuthRoute } from "./oauth-provider.js";
import { TOOL_COUNT } from "./idea-skills.js";
import { authenticateRequest, oauthStore } from "./mcp-auth.js";
import type { Env, McpProps } from "./mcp-types.js";
import { registerAccountTools } from "./register-account-tools.js";
import { registerCollaborationTools } from "./register-collaboration-tools.js";
import { registerPublishingTools } from "./register-publishing-tools.js";
import { registerSkillTools } from "./register-skill-tools.js";

const ROOT_TEXT =
  "FreeIdeaStore MCP Server\n\n" +
  "Connect: npx mcp-remote https://mcp.freeideastore.online/mcp\n\n" +
  "Tools: free_idea_template, list_idea_skills, get_idea_skill, apply_idea_skill, get_idea, my_ideas, my_activity, create_free_idea, add_idea_contribution, propose_idea_refinement, publish_idea_update, delete_idea, react_to_idea, promote_to_pro_candidate, dynamic_idea_book_template, dry_run_dynamic_idea_book\n\n" +
  "Auth: OAuth 2.1 via browser sign-in or Authorization: Bearer <FAS session token>.\n";

export class FisMcp extends McpAgent<Env, unknown, McpProps> {
  server = new McpServer({ name: "FreeIdeaStore", version: "0.1.0" });

  async setAuth(props: McpProps): Promise<void> {
    this.props = props;
    try {
      await (this as unknown as { ctx: { storage: { put(k: string, v: unknown): Promise<void> } } }).ctx.storage.put("props", props);
    } catch {
      // In-memory assignment is enough for the immediately following tool call.
    }
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
    const getProps = () => this.props || {};
    registerSkillTools(this.server, this.env);
    registerAccountTools(this.server, this.env, getProps);
    registerCollaborationTools(this.server, this.env, getProps);
    registerPublishingTools(this.server, this.env, getProps);
  }
}

async function handleMcpRequest(request: Request, env: Env, ctx: ExecutionContext, issuer: string) {
  const auth = await authenticateRequest(request, env);
  const sessionId = request.headers.get("mcp-session-id");
  if (auth.token && sessionId) {
    try {
      const id = env.MCP_OBJECT.idFromName(`streamable-http:${sessionId}`);
      const stub = env.MCP_OBJECT.get(id) as unknown as { setAuth(p: McpProps): Promise<void> };
      await stub.setAuth(auth);
    } catch {
      // Tool handlers will still fall back to unsigned/public behavior.
    }
  }
  if (!auth.token && request.method !== "OPTIONS" && env.SESSION_SIGNING_KEY) {
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
        fasAuthStart: `${env.API_BASE || "https://api.freeappstore.online"}/v1/auth/github/start`,
        store: oauthStore(env),
        sessionSigningKey: env.SESSION_SIGNING_KEY,
      });
      if (oauthRes) return oauthRes;
    }

    if (url.pathname === "/health") {
      return Response.json({ ok: true, service: "freeideastore-mcp", tools: TOOL_COUNT });
    }

    if (url.pathname === "/" || url.pathname === "") {
      return new Response(ROOT_TEXT, { headers: { "content-type": "text/plain; charset=utf-8" } });
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
