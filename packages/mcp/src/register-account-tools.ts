import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { fisApi } from "./fis-api.js";
import { text, type Env, type McpProps } from "./mcp-types.js";

/**
 * How much of the document `get_idea` returns. Mirrors the `body=` values
 * `GET /api/ideas/:id` accepts (`packages/worker/src/api.ts`); the tool defaults
 * to 'none' while the HTTP endpoint keeps 'full', because the browser fetch on
 * the idea page and the page's own JSON link are not the callers #66 is about.
 */
const BODY_VIEWS = ["none", "preamble", "full"] as const;

/**
 * Contributions returned per get_idea call when the caller does not say.
 * Matches the worker's own default for `/contributions?limit=`, and the render
 * page size the HTML research section uses.
 */
const CONTRIBUTIONS_PAGE_SIZE = 20;

export function registerAccountTools(server: McpServer, env: Env, getProps: () => McpProps) {
  server.tool(
    "get_idea",
    // The tool description is the ONLY migration notice an MCP client ever
    // sees, so it leads with the change rather than mentioning it (#66).
    "Read a FreeIdeaStore idea. Returns metadata, the chapter list and the document budget — NOT the document. Pass body: 'full' for the whole document, or body: 'preamble' for its lead-in only. This default changed: get_idea used to return the entire body, which on a large idea is hundreds of thousands of characters in one call. Check `usage.chars` in the response before asking for 'full', and prefer read_idea_section for one chapter.",
    {
      idea_id: z.string().min(2),
      body: z
        .enum(BODY_VIEWS)
        .optional()
        .describe(
          "How much of the document to return. Defaults to 'none' — metadata, the chapter list and `usage`, which is what a caller needs to decide what to read next. 'preamble' is the lead-in before the first chapter heading. 'full' is the entire canonical document and may be up to 1,000,000 characters. At 'none' the `body` key is present and null, never missing.",
        ),
      include_contributions: z.boolean().optional().describe("Include a page of contribution/research history. Off by default."),
      contributions_limit: z
        .number()
        .int()
        .min(1)
        .max(200)
        .optional()
        .describe(`Contributions per page. Defaults to ${CONTRIBUTIONS_PAGE_SIZE}. The response reports contributions_total, so a caller knows what it did not receive.`),
      contributions_offset: z.number().int().min(0).optional().describe("Offset into the contribution history. Defaults to 0."),
    },
    async (input) => {
      const props = getProps();
      const publicBase = env.PUBLIC_BASE || "https://freeideastore.online";
      // The view is applied SERVER-side. Dropping the field here instead would
      // still pull the whole document across the wire and only save the
      // caller's context, and 'preamble' would need a second markdown parser.
      const view = input.body || "none";
      const ideaRes = await fisApi<{
        idea: Record<string, unknown>;
        body: string | null;
        body_view: string;
        sections: Array<Record<string, unknown>>;
        usage: Record<string, number>;
        url: string;
      }>(
        env,
        `/api/ideas/${encodeURIComponent(input.idea_id)}?body=${view}`,
        { token: props.token },
      );
      if (!ideaRes.ok || "error" in ideaRes.data) {
        return text(`Error reading idea (${ideaRes.status}): ${"error" in ideaRes.data ? ideaRes.data.error : "unknown error"}`);
      }

      let contributions: unknown[] = [];
      let contributionPage: Record<string, unknown> = {};
      if (input.include_contributions) {
        // Paged. This call used to pass no limit at all, so an idea carrying 45
        // research entries of up to 8,000 characters each returned all of them
        // beside the body.
        const limit = input.contributions_limit || CONTRIBUTIONS_PAGE_SIZE;
        const offset = input.contributions_offset || 0;
        const contributionRes = await fisApi<{ contributions: unknown[]; total: number; limit: number; offset: number }>(
          env,
          `/api/ideas/${encodeURIComponent(input.idea_id)}/contributions?limit=${limit}&offset=${offset}`,
          { token: props.token },
        );
        if (!contributionRes.ok || "error" in contributionRes.data) {
          return text(`Error reading contributions (${contributionRes.status}): ${"error" in contributionRes.data ? contributionRes.data.error : "unknown error"}`);
        }
        contributions = contributionRes.data.contributions;
        contributionPage = {
          contributions_total: contributionRes.data.total,
          contributions_limit: limit,
          contributions_offset: offset,
        };
      }

      return text(JSON.stringify({
        ...ideaRes.data,
        url: `${publicBase}${ideaRes.data.url}`,
        contributions,
        ...contributionPage,
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
