import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { fisApi } from "./fis-api.js";
import { text, type Env, type McpProps } from "./mcp-types.js";

export function registerAccountTools(server: McpServer, env: Env, getProps: () => McpProps) {
  server.tool(
    "get_idea",
    "Read a FreeIdeaStore idea body, metadata, and optionally its contribution history.",
    {
      idea_id: z.string().min(2),
      include_contributions: z.boolean().optional(),
    },
    async (input) => {
      const props = getProps();
      const publicBase = env.PUBLIC_BASE || "https://freeideastore.online";
      const ideaRes = await fisApi<{ idea: Record<string, unknown>; body: string; url: string }>(
        env,
        `/api/ideas/${encodeURIComponent(input.idea_id)}`,
        { token: props.token },
      );
      if (!ideaRes.ok || "error" in ideaRes.data) {
        return text(`Error reading idea (${ideaRes.status}): ${"error" in ideaRes.data ? ideaRes.data.error : "unknown error"}`);
      }

      let contributions: unknown[] = [];
      if (input.include_contributions) {
        const contributionRes = await fisApi<{ contributions: unknown[] }>(
          env,
          `/api/ideas/${encodeURIComponent(input.idea_id)}/contributions`,
          { token: props.token },
        );
        if (!contributionRes.ok || "error" in contributionRes.data) {
          return text(`Error reading contributions (${contributionRes.status}): ${"error" in contributionRes.data ? contributionRes.data.error : "unknown error"}`);
        }
        contributions = contributionRes.data.contributions;
      }

      return text(JSON.stringify({
        ...ideaRes.data,
        url: `${publicBase}${ideaRes.data.url}`,
        contributions,
      }, null, 2));
    },
  );

  server.tool(
    "my_ideas",
    "List FreeIdeaStore ideas created by the authenticated MCP user.",
    {
      limit: z.number().int().min(1).max(1000).optional(),
    },
    async (input) => {
      const props = getProps();
      if (!props.token) {
        return text("Error listing my ideas: authentication required. Connect through MCP OAuth first.");
      }
      const publicBase = env.PUBLIC_BASE || "https://freeideastore.online";
      const limit = input.limit || 500;
      const res = await fisApi<{ user: Record<string, unknown>; ideas: Array<Record<string, unknown>> }>(
        env,
        `/api/me/ideas?limit=${encodeURIComponent(String(limit))}`,
        { token: props.token },
      );
      if (!res.ok || "error" in res.data) {
        return text(`Error listing my ideas (${res.status}): ${"error" in res.data ? res.data.error : "unknown error"}`);
      }
      return text(JSON.stringify({
        ...res.data,
        ideas: res.data.ideas.map((idea) => ({
          ...idea,
          url: `${publicBase}/ideas/${idea.id}/`,
        })),
      }, null, 2));
    },
  );

  server.tool(
    "my_activity",
    "List FreeIdeaStore ideas and contributions attached to the authenticated MCP user.",
    {
      idea_limit: z.number().int().min(1).max(1000).optional(),
      contribution_limit: z.number().int().min(1).max(500).optional(),
    },
    async (input) => {
      const props = getProps();
      if (!props.token) {
        return text("Error listing my activity: authentication required. Connect through MCP OAuth first.");
      }
      const params = new URLSearchParams({
        idea_limit: String(input.idea_limit || 100),
        contribution_limit: String(input.contribution_limit || 100),
      });
      const publicBase = env.PUBLIC_BASE || "https://freeideastore.online";
      const res = await fisApi<{
        user: Record<string, unknown>;
        ideas: Array<Record<string, unknown>>;
        contributions: Array<Record<string, unknown>>;
      }>(
        env,
        `/api/me/activity?${params.toString()}`,
        { token: props.token },
      );
      if (!res.ok || "error" in res.data) {
        return text(`Error listing my activity (${res.status}): ${"error" in res.data ? res.data.error : "unknown error"}`);
      }
      return text(JSON.stringify({
        ...res.data,
        ideas: res.data.ideas.map((idea) => ({
          ...idea,
          url: `${publicBase}/ideas/${idea.id}/`,
        })),
      }, null, 2));
    },
  );
}
