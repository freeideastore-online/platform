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
      body: z.string().min(20).max(200000).describe("Complete markdown document to publish on the public idea page. Bodies are stored in R2, so depth is not limited by the database."),
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

  server.tool(
    "list_idea_sections",
    "List the sections of an idea document with their ids and word counts. Start here before reading or writing a section — the ids are the same handles the public chapter URLs use.",
    {
      idea_id: z.string().min(2),
    },
    async (input) => {
      const res = await fisApi<{ idea: string; sections: Array<{ id: string; title: string; words: number }> }>(
        env,
        `/api/ideas/${encodeURIComponent(input.idea_id)}/sections`,
        { token: getProps().token },
      );
      if (!res.ok || "error" in res.data) {
        return text(`Error listing sections (${res.status}): ${"error" in res.data ? res.data.error : "unknown error"}`);
      }
      return text(JSON.stringify(res.data, null, 2));
    },
  );

  server.tool(
    "read_idea_section",
    "Read one section of an idea document. Use this instead of get_idea when revising a single section — it avoids pulling the whole document into context.",
    {
      idea_id: z.string().min(2),
      section: z.string().min(1).describe("Section id from list_idea_sections."),
    },
    async (input) => {
      const res = await fisApi<{ markdown: string }>(
        env,
        `/api/ideas/${encodeURIComponent(input.idea_id)}/sections/${encodeURIComponent(input.section)}`,
        { token: getProps().token },
      );
      if (!res.ok || "error" in res.data) {
        return text(`Error reading section (${res.status}): ${"error" in res.data ? res.data.error : "unknown error"}`);
      }
      return text(JSON.stringify(res.data, null, 2));
    },
  );

  server.tool(
    "patch_idea_section",
    "Replace the content of one section of the authenticated owner's idea document, leaving the rest byte-identical. Prefer this over publish_idea_update when revising part of a document — publish_idea_update requires resending the whole thing.",
    {
      idea_id: z.string().min(2),
      section: z.string().min(1).describe("Section id from list_idea_sections."),
      content: z.string().min(1).max(200000).describe("Replacement markdown for the section body. Do not repeat the section heading."),
    },
    async (input) => {
      const props = getProps();
      if (!props.token) {
        return text("Error patching section: authentication required. Connect through MCP OAuth first.");
      }
      const res = await fisApi<Record<string, unknown>>(
        env,
        `/api/ideas/${encodeURIComponent(input.idea_id)}/sections/${encodeURIComponent(input.section)}`,
        { method: "PUT", body: JSON.stringify({ content: input.content }), token: props.token },
      );
      if (!res.ok || "error" in res.data) {
        return text(`Error patching section (${res.status}): ${"error" in res.data ? res.data.error : "unknown error"}`);
      }
      return text(JSON.stringify(res.data, null, 2));
    },
  );

  server.tool(
    "append_to_idea_section",
    "Add markdown to the end of one section of the authenticated owner's idea document. This is the natural shape for accumulating research into the canonical document rather than leaving it in contribution history.",
    {
      idea_id: z.string().min(2),
      section: z.string().min(1).describe("Section id from list_idea_sections."),
      content: z.string().min(1).max(200000).describe("Markdown to append to the section body."),
    },
    async (input) => {
      const props = getProps();
      if (!props.token) {
        return text("Error appending to section: authentication required. Connect through MCP OAuth first.");
      }
      const res = await fisApi<Record<string, unknown>>(
        env,
        `/api/ideas/${encodeURIComponent(input.idea_id)}/sections/${encodeURIComponent(input.section)}`,
        { method: "POST", body: JSON.stringify({ content: input.content }), token: props.token },
      );
      if (!res.ok || "error" in res.data) {
        return text(`Error appending to section (${res.status}): ${"error" in res.data ? res.data.error : "unknown error"}`);
      }
      return text(JSON.stringify(res.data, null, 2));
    },
  );
}
