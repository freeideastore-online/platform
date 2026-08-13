import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { fisApi } from "./fis-api.js";
import { DOCUMENT_CHARS, DOCUMENT_LIMIT_NOTE, SECTION_CHARS, SECTION_LIMIT_NOTE } from "./limits.js";
import { STAGES, text, type Env, type McpProps } from "./mcp-types.js";

/**
 * The chapter contract, stated on every tool that writes markdown into a
 * section. Callers previously read only "do not repeat the section heading",
 * which warns about ONE heading and says nothing about the rest — a migration
 * that intended 15 chapters produced 74 (#48).
 */
const HEADING_CONTRACT =
  "Headings: `#` AND `##` both create sibling chapters, so every one of them splits this content into a separate chapter with its own URL. `###` and deeper stay inside the chapter as in-page anchors. Do not repeat the section heading. To write a whole source file as ONE chapter, set demote_headings: true rather than re-levelling by hand.";

const DEMOTE_HEADINGS =
  "Shift every heading in `content` below chapter level so the whole block lands as ONE chapter instead of splitting into siblings. The shift is uniform and taken from the shallowest heading present: a `#`-topped file moves two levels (`#`→`###`, `##`→`####`, `###`→`#####`), a `##`-topped file one (`##`→`###`). Content already topped at `###` is untouched. Nothing is pushed past `######`. Off by default.";

export function registerPublishingTools(server: McpServer, env: Env, getProps: () => McpProps) {
  server.tool(
    "publish_idea_update",
    "Update the authenticated owner's canonical public idea document and the fields describing it. Pass body to replace the whole document — call get_idea with body: 'full' first and preserve useful existing content. Omit body to correct metadata only (summary, title, stage, category, next_step, risk and the rest), leaving the document byte-identical; that is the right call on a document too large to resend.",
    {
      idea_id: z.string().min(2),
      // Optional since #33. Metadata used to be reachable only by resending the
      // entire document, so a document that had outgrown one tool call had its
      // summary, stage and category frozen for good — a catalog card describing
      // four annexes that no longer existed, with no way to correct the sentence.
      body: z.string().min(20).max(DOCUMENT_CHARS).optional().describe(`Complete markdown document to publish on the public idea page. Bodies are stored in R2, so depth is not limited by the database. ${DOCUMENT_LIMIT_NOTE} Omit to leave the existing document untouched and update only the metadata fields supplied.`),
      title: z.string().min(3).max(80).optional().describe("Document title. Keep it short — put detail in summary."),
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
        title: input.title,
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
      // Everything is optional now, so "update nothing" became expressible. Say
      // so rather than reporting a successful publish that changed nothing.
      if (Object.keys(payload).length === 0) {
        return text(
          "Error publishing idea update: nothing to update. Supply body to replace the document, or at least one metadata field (summary, title, stage, category, preview, signal, next_step, risk, source_url) to change it.",
        );
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
        note: input.body
          ? "Canonical public document updated. Use add_idea_contribution for evidence/comments that should stay in history instead of replacing the document."
          : "Metadata updated. The canonical document was not touched.",
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
    "List the sections of an idea document with their ids, word counts and size verdicts, plus `usage`: the document's character and chapter budget and what is left of it. Start here before reading or writing a section — the ids are the same handles the public chapter URLs use, and the headroom is knowable without attempting a write.",
    {
      idea_id: z.string().min(2),
    },
    async (input) => {
      const res = await fisApi<{
      idea: string;
      sections: Array<{ id: string; title: string; words: number }>;
      usage: Record<string, number | undefined>;
    }>(
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
      content: z.string().min(1).max(SECTION_CHARS).describe(`Replacement markdown for the section body. ${HEADING_CONTRACT} ${SECTION_LIMIT_NOTE}`),
      demote_headings: z.boolean().optional().describe(DEMOTE_HEADINGS),
    },
    async (input) => {
      const props = getProps();
      if (!props.token) {
        return text("Error patching section: authentication required. Connect through MCP OAuth first.");
      }
      const res = await fisApi<Record<string, unknown>>(
        env,
        `/api/ideas/${encodeURIComponent(input.idea_id)}/sections/${encodeURIComponent(input.section)}`,
        {
          method: "PUT",
          body: JSON.stringify({ content: input.content, demote_headings: input.demote_headings }),
          token: props.token,
        },
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
      content: z.string().min(1).max(SECTION_CHARS).describe(`Markdown to append to the section body. ${HEADING_CONTRACT} ${SECTION_LIMIT_NOTE}`),
      demote_headings: z.boolean().optional().describe(DEMOTE_HEADINGS),
    },
    async (input) => {
      const props = getProps();
      if (!props.token) {
        return text("Error appending to section: authentication required. Connect through MCP OAuth first.");
      }
      const res = await fisApi<Record<string, unknown>>(
        env,
        `/api/ideas/${encodeURIComponent(input.idea_id)}/sections/${encodeURIComponent(input.section)}`,
        {
          method: "POST",
          body: JSON.stringify({ content: input.content, demote_headings: input.demote_headings }),
          token: props.token,
        },
      );
      if (!res.ok || "error" in res.data) {
        return text(`Error appending to section (${res.status}): ${"error" in res.data ? res.data.error : "unknown error"}`);
      }
      return text(JSON.stringify(res.data, null, 2));
    },
  );

  server.tool(
    "list_idea_revisions",
    "List past versions of an idea document, newest first. Each entry records the document as it was BEFORE a write, so the state preceding any change is recoverable.",
    {
      idea_id: z.string().min(2),
      limit: z.number().int().min(1).max(200).optional(),
    },
    async (input) => {
      const query = input.limit ? `?limit=${input.limit}` : "";
      const res = await fisApi<Record<string, unknown>>(
        env,
        `/api/ideas/${encodeURIComponent(input.idea_id)}/revisions${query}`,
        { token: getProps().token },
      );
      if (!res.ok || "error" in res.data) {
        return text(`Error listing revisions (${res.status}): ${"error" in res.data ? res.data.error : "unknown error"}`);
      }
      return text(JSON.stringify(res.data, null, 2));
    },
  );

  server.tool(
    "read_idea_revision",
    "Read the full markdown of one past revision of an idea document.",
    {
      idea_id: z.string().min(2),
      revision_id: z.string().min(2),
    },
    async (input) => {
      const res = await fisApi<Record<string, unknown>>(
        env,
        `/api/ideas/${encodeURIComponent(input.idea_id)}/revisions/${encodeURIComponent(input.revision_id)}`,
        { token: getProps().token },
      );
      if (!res.ok || "error" in res.data) {
        return text(`Error reading revision (${res.status}): ${"error" in res.data ? res.data.error : "unknown error"}`);
      }
      return text(JSON.stringify(res.data, null, 2));
    },
  );

  server.tool(
    "diff_idea_revision",
    "Show what changed between a past revision and the current document, as added and removed lines. Cheaper than reading both versions in full.",
    {
      idea_id: z.string().min(2),
      revision_id: z.string().min(2),
    },
    async (input) => {
      const res = await fisApi<Record<string, unknown>>(
        env,
        `/api/ideas/${encodeURIComponent(input.idea_id)}/revisions/${encodeURIComponent(input.revision_id)}/diff`,
        { token: getProps().token },
      );
      if (!res.ok || "error" in res.data) {
        return text(`Error diffing revision (${res.status}): ${"error" in res.data ? res.data.error : "unknown error"}`);
      }
      return text(JSON.stringify(res.data, null, 2));
    },
  );

  server.tool(
    "revert_idea_to_revision",
    "Restore a past revision as the authenticated owner's current idea document. The state being replaced is itself recorded, so a revert can be undone.",
    {
      idea_id: z.string().min(2),
      revision_id: z.string().min(2),
    },
    async (input) => {
      const props = getProps();
      if (!props.token) {
        return text("Error reverting idea: authentication required. Connect through MCP OAuth first.");
      }
      const res = await fisApi<Record<string, unknown>>(
        env,
        `/api/ideas/${encodeURIComponent(input.idea_id)}/revisions/${encodeURIComponent(input.revision_id)}/revert`,
        { method: "POST", body: JSON.stringify({}), token: props.token },
      );
      if (!res.ok || "error" in res.data) {
        return text(`Error reverting idea (${res.status}): ${"error" in res.data ? res.data.error : "unknown error"}`);
      }
      return text(JSON.stringify(res.data, null, 2));
    },
  );

  server.tool(
    "list_pending_refinements",
    "List refinement proposals for an idea that have not been merged into the canonical document yet. Use this to find work waiting rather than reading every contribution.",
    {
      idea_id: z.string().min(2),
      status: z.enum(["open", "resolved", "all"]).optional().describe("Defaults to open."),
    },
    async (input) => {
      const query = input.status ? `?status=${input.status}` : "";
      const res = await fisApi<Record<string, unknown>>(
        env,
        `/api/ideas/${encodeURIComponent(input.idea_id)}/refinements${query}`,
        { token: getProps().token },
      );
      if (!res.ok || "error" in res.data) {
        return text(`Error listing refinements (${res.status}): ${"error" in res.data ? res.data.error : "unknown error"}`);
      }
      return text(JSON.stringify(res.data, null, 2));
    },
  );

  server.tool(
    "apply_refinement",
    "Merge a queued refinement into the authenticated owner's canonical document and close it. Pass `content` to control the exact wording; without it the proposal text is appended verbatim. The resolution records the revision it produced.",
    {
      idea_id: z.string().min(2),
      refinement_id: z.string().min(2),
      section: z.string().optional().describe("Target section id. Defaults to the section the proposal names."),
      mode: z.enum(["append", "replace"]).optional().describe("Defaults to append."),
      content: z.string().max(SECTION_CHARS).optional().describe(`Merged markdown to write. Defaults to the proposal text. ${SECTION_LIMIT_NOTE}`),
      note: z.string().max(1000).optional(),
    },
    async (input) => {
      const props = getProps();
      if (!props.token) {
        return text("Error applying refinement: authentication required. Connect through MCP OAuth first.");
      }
      const res = await fisApi<Record<string, unknown>>(
        env,
        `/api/ideas/${encodeURIComponent(input.idea_id)}/refinements/${encodeURIComponent(input.refinement_id)}/apply`,
        {
          method: "POST",
          body: JSON.stringify({
            section: input.section,
            mode: input.mode,
            content: input.content,
            note: input.note,
          }),
          token: props.token,
        },
      );
      if (!res.ok || "error" in res.data) {
        return text(`Error applying refinement (${res.status}): ${"error" in res.data ? res.data.error : "unknown error"}`);
      }
      return text(JSON.stringify(res.data, null, 2));
    },
  );

  server.tool(
    "resolve_refinement",
    "Close a refinement without merging it, recording why. Keeps the queue honest instead of leaving proposals open forever.",
    {
      idea_id: z.string().min(2),
      refinement_id: z.string().min(2),
      status: z.enum(["rejected", "superseded"]),
      reason: z.string().min(3).max(1000),
    },
    async (input) => {
      const props = getProps();
      if (!props.token) {
        return text("Error resolving refinement: authentication required. Connect through MCP OAuth first.");
      }
      const res = await fisApi<Record<string, unknown>>(
        env,
        `/api/ideas/${encodeURIComponent(input.idea_id)}/refinements/${encodeURIComponent(input.refinement_id)}/resolve`,
        {
          method: "POST",
          body: JSON.stringify({ status: input.status, reason: input.reason }),
          token: props.token,
        },
      );
      if (!res.ok || "error" in res.data) {
        return text(`Error resolving refinement (${res.status}): ${"error" in res.data ? res.data.error : "unknown error"}`);
      }
      return text(JSON.stringify(res.data, null, 2));
    },
  );

  server.tool(
    "add_idea_section",
    "Add a new section to the authenticated owner's idea document. Use this to grow a document's structure — patch_idea_section and append_to_idea_section only edit sections that already exist.",
    {
      idea_id: z.string().min(2),
      title: z.string().min(1).max(120),
      content: z.string().max(SECTION_CHARS).optional().describe(`Markdown for the new section's body. ${HEADING_CONTRACT} ${SECTION_LIMIT_NOTE}`),
      after: z.string().optional().describe("Section id to insert after. Defaults to the end of the document."),
      before: z.string().optional().describe("Section id to insert before."),
      demote_headings: z.boolean().optional().describe(DEMOTE_HEADINGS),
    },
    async (input) => {
      const props = getProps();
      if (!props.token) return text("Error adding section: authentication required. Connect through MCP OAuth first.");
      const res = await fisApi<Record<string, unknown>>(
        env,
        `/api/ideas/${encodeURIComponent(input.idea_id)}/sections`,
        {
          method: "POST",
          body: JSON.stringify({
            title: input.title,
            content: input.content,
            after: input.after,
            before: input.before,
            demote_headings: input.demote_headings,
          }),
          token: props.token,
        },
      );
      if (!res.ok || "error" in res.data) {
        return text(`Error adding section (${res.status}): ${"error" in res.data ? res.data.error : "unknown error"}`);
      }
      return text(JSON.stringify(res.data, null, 2));
    },
  );

  server.tool(
    "edit_idea_section",
    "Rename and/or move a section of the authenticated owner's idea document. Renaming changes the section id, so the old chapter URL stops resolving.",
    {
      idea_id: z.string().min(2),
      section: z.string().min(1),
      title: z.string().max(120).optional().describe("New title. Changes the section id."),
      after: z.string().optional().describe("Move to sit after this section id."),
      before: z.string().optional().describe("Move to sit before this section id."),
    },
    async (input) => {
      const props = getProps();
      if (!props.token) return text("Error editing section: authentication required. Connect through MCP OAuth first.");
      const res = await fisApi<Record<string, unknown>>(
        env,
        `/api/ideas/${encodeURIComponent(input.idea_id)}/sections/${encodeURIComponent(input.section)}`,
        {
          method: "PATCH",
          body: JSON.stringify({ title: input.title, after: input.after, before: input.before }),
          token: props.token,
        },
      );
      if (!res.ok || "error" in res.data) {
        return text(`Error editing section (${res.status}): ${"error" in res.data ? res.data.error : "unknown error"}`);
      }
      return text(JSON.stringify(res.data, null, 2));
    },
  );

  server.tool(
    "merge_idea_sections",
    "Fold one section's content into another and remove the source. This is how a document with many thin sections becomes one with fewer substantial ones.",
    {
      idea_id: z.string().min(2),
      from_section: z.string().min(1).describe("Section to fold in and remove."),
      into_section: z.string().min(1).describe("Section that receives the content."),
    },
    async (input) => {
      const props = getProps();
      if (!props.token) return text("Error merging sections: authentication required. Connect through MCP OAuth first.");
      const res = await fisApi<Record<string, unknown>>(
        env,
        `/api/ideas/${encodeURIComponent(input.idea_id)}/sections/${encodeURIComponent(input.from_section)}/merge`,
        { method: "POST", body: JSON.stringify({ into: input.into_section }), token: props.token },
      );
      if (!res.ok || "error" in res.data) {
        return text(`Error merging sections (${res.status}): ${"error" in res.data ? res.data.error : "unknown error"}`);
      }
      return text(JSON.stringify(res.data, null, 2));
    },
  );

  server.tool(
    "delete_idea_section",
    "Remove a section and its content from the authenticated owner's idea document. Recoverable through revisions.",
    {
      idea_id: z.string().min(2),
      section: z.string().min(1),
    },
    async (input) => {
      const props = getProps();
      if (!props.token) return text("Error deleting section: authentication required. Connect through MCP OAuth first.");
      const res = await fisApi<Record<string, unknown>>(
        env,
        `/api/ideas/${encodeURIComponent(input.idea_id)}/sections/${encodeURIComponent(input.section)}`,
        { method: "DELETE", body: JSON.stringify({}), token: props.token },
      );
      if (!res.ok || "error" in res.data) {
        return text(`Error deleting section (${res.status}): ${"error" in res.data ? res.data.error : "unknown error"}`);
      }
      return text(JSON.stringify(res.data, null, 2));
    },
  );
}
