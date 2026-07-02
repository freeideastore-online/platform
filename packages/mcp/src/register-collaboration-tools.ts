import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { fisApi } from "./fis-api.js";
import { CONTRIBUTION_KINDS, REACTION_TYPES, STAGES, text, type Env, type McpProps } from "./mcp-types.js";

export function registerCollaborationTools(server: McpServer, env: Env, getProps: () => McpProps) {
  server.tool(
    "create_free_idea",
    "Create a cheap FreeIdeaStore idea page through the Worker API. This writes one D1 row and, when configured, one R2 body object.",
    {
      title: z.string().min(2).max(80).describe("Short, specific idea title. Maximum 80 characters — long titles break the page layout. Use the subtitle or summary for detail."),
      summary: z.string().min(10),
      stage: z.enum(STAGES).optional(),
      category: z.string().optional(),
      signal: z.string().optional(),
      preview: z.string().optional(),
      next_step: z.string().optional(),
      risk: z.string().optional(),
      body: z.string().optional().describe("Optional markdown body for the idea page."),
      source_url: z.string().optional(),
      contributor_handle: z.string().optional().describe("Optional profile handle to attribute the created idea through the current API fallback."),
    },
    async (input) => {
      const props = getProps();
      const publicBase = env.PUBLIC_BASE || "https://freeideastore.online";
      const body = input.body || [
        "## Snapshot",
        input.summary,
        "",
        "## Current signal",
        input.signal || input.preview || "No signal has been added yet.",
        "",
        "## Next step",
        input.next_step || "Define the cheapest useful validation step.",
        "",
        "## Risk",
        input.risk || "Main risk not yet identified.",
        "",
        "## How to help",
        "- Add evidence from public sources.",
        "- Name a risk or reason to trash it.",
        "- Suggest a sharper customer, wedge, or pivot.",
      ].join("\n");
      const res = await fisApi<{ idea: string; url: string }>(env, "/api/ideas", {
        method: "POST",
        body: JSON.stringify({
          title: input.title,
          summary: input.summary,
          stage: input.stage || "raw",
          category: input.category || "uncategorized",
          signal: input.signal || "",
          preview: input.preview || input.summary,
          nextStep: input.next_step || "",
          risk: input.risk || "",
          body,
          source_url: input.source_url || "",
        }),
        contributorHandle: input.contributor_handle,
        token: props.token,
      });
      if (!res.ok || "error" in res.data) {
        return text(`Error creating free idea (${res.status}): ${"error" in res.data ? res.data.error : "unknown error"}`);
      }
      return text(JSON.stringify({
        idea: res.data.idea,
        url: `${publicBase}${res.data.url}`,
        storage: "D1 metadata plus optional R2 body/render cache",
        proPath: "Call promote_to_pro_candidate when this deserves a curated ProIdeaStore dossier.",
      }, null, 2));
    },
  );

  server.tool(
    "derive_idea",
    "Fork a new FreeIdeaStore idea from an existing one. Seeds the new idea with the parent's body as a starting draft, links it back to the parent, and credits the source. Use this to take an idea in a different direction instead of editing someone else's canonical page — you own the derived idea and can publish_idea_update on it.",
    {
      idea_id: z.string().min(2).describe("The parent idea to derive from."),
      title: z.string().min(3).max(80).optional().describe("Title for the fork. Defaults to the parent title plus '(derived)'."),
      summary: z.string().min(10).max(1000).optional(),
      body: z.string().max(24000).optional().describe("Optional replacement body. Defaults to a copy of the parent body."),
      stage: z.enum(STAGES).optional(),
      category: z.string().max(60).optional(),
      contributor_handle: z.string().optional().describe("Optional profile handle to attribute the derived idea. This handle owns the fork."),
    },
    async (input) => {
      const props = getProps();
      const publicBase = env.PUBLIC_BASE || "https://freeideastore.online";
      const payload: Record<string, unknown> = {
        title: input.title,
        summary: input.summary,
        body: input.body,
        stage: input.stage,
        category: input.category,
      };
      for (const [key, value] of Object.entries(payload)) {
        if (value === undefined) delete payload[key];
      }
      const res = await fisApi<{ idea: string; url: string; parent: string; parentUrl: string }>(
        env,
        `/api/ideas/${encodeURIComponent(input.idea_id)}/derive`,
        {
          method: "POST",
          body: JSON.stringify(payload),
          contributorHandle: input.contributor_handle,
          token: props.token,
        },
      );
      if (!res.ok || "error" in res.data) {
        return text(`Error deriving idea (${res.status}): ${"error" in res.data ? res.data.error : "unknown error"}`);
      }
      return text(JSON.stringify({
        ok: true,
        idea: res.data.idea,
        url: `${publicBase}${res.data.url}`,
        derived_from: res.data.parent,
        parent_url: `${publicBase}${res.data.parentUrl}`,
        owner: input.contributor_handle || "fis-mcp",
        note: "New idea forked from the parent. You own this derived idea — iterate on it with publish_idea_update. The parent page now links to it.",
      }, null, 2));
    },
  );

  server.tool(
    "add_idea_contribution",
    "Add a signed contribution to an existing FreeIdeaStore idea: evidence, risk, pivot, refinement, prototype note, or kill signal.",
    {
      idea_id: z.string().min(2),
      kind: z.enum(CONTRIBUTION_KINDS).optional(),
      body: z.string().min(3).max(2000),
      contributor_handle: z.string().optional().describe("Optional profile handle to attribute the contribution through the current API fallback."),
    },
    async (input) => {
      const props = getProps();
      if (!props.token) {
        return text("Error adding contribution: authentication required. Connect through MCP OAuth first.");
      }
      const res = await fisApi<{ ok: boolean }>(env, `/api/ideas/${encodeURIComponent(input.idea_id)}/contributions`, {
        method: "POST",
        body: JSON.stringify({
          kind: input.kind || "comment",
          body: input.body,
        }),
        contributorHandle: input.contributor_handle,
        token: props.token,
      });
      if (!res.ok || "error" in res.data) {
        return text(`Error adding contribution (${res.status}): ${"error" in res.data ? res.data.error : "unknown error"}`);
      }
      return text(JSON.stringify({
        ok: true,
        idea: input.idea_id,
        kind: input.kind || "comment",
        attribution: input.contributor_handle || "fis-mcp",
        note: "Contribution added. This records refinement history; it does not rewrite the canonical idea body.",
      }, null, 2));
    },
  );

  server.tool(
    "propose_idea_refinement",
    "Record a structured refinement proposal for an existing idea without overwriting the canonical idea page.",
    {
      idea_id: z.string().min(2),
      section: z.enum(["snapshot", "signal", "next_step", "risk", "research", "design", "prototype", "validation", "body"]),
      proposal: z.string().min(10).max(1600),
      rationale: z.string().optional(),
      contributor_handle: z.string().optional().describe("Optional profile handle to attribute the refinement through the current API fallback."),
    },
    async (input) => {
      const props = getProps();
      if (!props.token) {
        return text("Error proposing refinement: authentication required. Connect through MCP OAuth first.");
      }
      const body = [
        `Section: ${input.section}`,
        "",
        "Proposal:",
        input.proposal,
        ...(input.rationale ? ["", "Rationale:", input.rationale] : []),
      ].join("\n");
      const res = await fisApi<{ ok: boolean }>(env, `/api/ideas/${encodeURIComponent(input.idea_id)}/contributions`, {
        method: "POST",
        body: JSON.stringify({ kind: "refinement", body }),
        contributorHandle: input.contributor_handle,
        token: props.token,
      });
      if (!res.ok || "error" in res.data) {
        return text(`Error proposing refinement (${res.status}): ${"error" in res.data ? res.data.error : "unknown error"}`);
      }
      return text(JSON.stringify({
        ok: true,
        idea: input.idea_id,
        section: input.section,
        attribution: input.contributor_handle || "fis-mcp",
        note: "Refinement proposal recorded as a contribution. A later admin/editor flow can merge it into the canonical body.",
      }, null, 2));
    },
  );

  server.tool(
    "react_to_idea",
    "Add a support, trash, or pivot signal to an existing FreeIdeaStore idea.",
    {
      idea_id: z.string().min(2),
      type: z.enum(REACTION_TYPES),
      contributor_handle: z.string().optional().describe("Optional profile handle to attribute the reaction through the current API fallback."),
    },
    async (input) => {
      const props = getProps();
      if (!props.token) {
        return text("Error reacting to idea: authentication required. Connect through MCP OAuth first.");
      }
      const res = await fisApi<{ ok: boolean }>(env, `/api/ideas/${encodeURIComponent(input.idea_id)}/reactions`, {
        method: "POST",
        body: JSON.stringify({ type: input.type }),
        contributorHandle: input.contributor_handle,
        token: props.token,
      });
      if (!res.ok || "error" in res.data) {
        return text(`Error reacting to idea (${res.status}): ${"error" in res.data ? res.data.error : "unknown error"}`);
      }
      return text(JSON.stringify({
        ok: true,
        idea: input.idea_id,
        type: input.type,
        attribution: input.contributor_handle || "fis-mcp",
      }, null, 2));
    },
  );
}
