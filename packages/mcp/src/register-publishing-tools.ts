import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { fisApi } from "./fis-api.js";
import { STAGES, text, type Env, type McpProps } from "./mcp-types.js";

export function registerPublishingTools(server: McpServer, env: Env, getProps: () => McpProps) {
  server.tool(
    "publish_idea_update",
    "Replace the authenticated owner's canonical public idea document after refinement. Use get_idea first, preserve useful existing content, then publish the improved markdown.",
    {
      idea_id: z.string().min(2),
      body: z.string().min(20).max(24000).describe("Complete markdown document to publish on the public idea page."),
      summary: z.string().min(10).max(1000).optional(),
      stage: z.enum(STAGES).optional(),
      category: z.string().max(60).optional(),
      preview: z.string().max(1000).optional(),
      signal: z.string().max(1000).optional(),
      next_step: z.string().max(500).optional(),
      risk: z.string().max(500).optional(),
      source_url: z.string().max(500).optional(),
    },
    async (input) => {
      const props = getProps();
      if (!props.token) {
        return text("Error publishing idea update: authentication required. Connect through MCP OAuth first.");
      }
      const publicBase = env.PUBLIC_BASE || "https://freeideastore.online";
      const payload: Record<string, unknown> = {
        body: input.body,
        summary: input.summary,
        stage: input.stage,
        category: input.category,
        preview: input.preview,
        signal: input.signal,
        nextStep: input.next_step,
        risk: input.risk,
        source_url: input.source_url,
      };
      for (const [key, value] of Object.entries(payload)) {
        if (value === undefined) delete payload[key];
      }
      const res = await fisApi<{ ok: boolean; idea: string; url: string }>(
        env,
        `/api/ideas/${encodeURIComponent(input.idea_id)}`,
        {
          method: "PATCH",
          body: JSON.stringify(payload),
          token: props.token,
        },
      );
      if (!res.ok || "error" in res.data) {
        return text(`Error publishing idea update (${res.status}): ${"error" in res.data ? res.data.error : "unknown error"}`);
      }
      return text(JSON.stringify({
        ok: true,
        idea: res.data.idea,
        url: `${publicBase}${res.data.url}`,
        note: "Canonical public document updated. Use add_idea_contribution for evidence/comments that should stay in history instead of replacing the document.",
      }, null, 2));
    },
  );

  server.tool(
    "delete_idea",
    "Soft-delete an authenticated owner's FreeIdeaStore idea. This hides it from public pages, profile lists, and idea APIs while preserving audit history.",
    {
      idea_id: z.string().min(2),
      confirm_title: z.string().min(2).describe("The exact current idea title or idea id, used as an explicit delete confirmation."),
    },
    async (input) => {
      const props = getProps();
      if (!props.token) {
        return text("Error deleting idea: authentication required. Connect through MCP OAuth first.");
      }
      const res = await fisApi<{ ok: boolean; idea: string; status: string }>(
        env,
        `/api/ideas/${encodeURIComponent(input.idea_id)}`,
        {
          method: "DELETE",
          body: JSON.stringify({ confirm_title: input.confirm_title }),
          token: props.token,
        },
      );
      if (!res.ok || "error" in res.data) {
        return text(`Error deleting idea (${res.status}): ${"error" in res.data ? res.data.error : "unknown error"}`);
      }
      return text(JSON.stringify({
        ok: true,
        idea: res.data.idea,
        status: res.data.status,
        note: "Idea soft-deleted. It is hidden from public listing/profile/API reads; database history is preserved.",
      }, null, 2));
    },
  );

  server.tool(
    "promote_to_pro_candidate",
    "Mark an authenticated owner's FreeIdeaStore idea as a ProIdeaStore candidate and return a dossier draft payload.",
    {
      idea_id: z.string().min(2),
      contributor_handle: z.string().optional().describe("Deprecated for this tool. Promotion requires the authenticated owner session."),
    },
    async (input) => {
      const props = getProps();
      const res = await fisApi<Record<string, unknown>>(env, `/api/ideas/${encodeURIComponent(input.idea_id)}/promote`, {
        method: "POST",
        body: JSON.stringify({}),
        contributorHandle: input.contributor_handle,
        token: props.token,
      });
      if (!res.ok || "error" in res.data) {
        return text(`Error promoting idea (${res.status}): ${"error" in res.data ? res.data.error : "unknown error"}`);
      }
      return text(JSON.stringify(res.data, null, 2));
    },
  );
}
