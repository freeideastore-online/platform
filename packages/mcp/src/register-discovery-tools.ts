import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { fisApi } from "./fis-api.js";
import { text, type Env, type McpProps } from "./mcp-types.js";

/**
 * Lookup tools over indexes the platform already builds (#65).
 *
 * Every canonical write rebuilds two per-chapter indexes over the document it
 * just wrote: `indexDocument()` puts one FTS row per chapter into
 * `search_index` keyed by `ref = chapter.id`, and `syncDocumentSources()` links
 * every URL to the chapter it appears in. Both are served — `/api/search`,
 * `/api/ideas/:id/sources`, `/api/sources/:id` — and until now no MCP tool
 * called any of them, so the agent building the corpus was the only party that
 * could not query it.
 *
 * What that cost is on the record: fourteen agents writing into one document in
 * parallel (#50) answered "is there already a chapter about this?" by listing
 * every section and reading titles — the O(document) read #47 measures — and
 * still produced 74 near-duplicate chapters (#48). The index they needed was
 * rebuilt on each of their own writes.
 *
 * These are deliberately thin. The ranking, the snippet, the citation join and
 * the decay status all belong to the Worker; a second implementation here would
 * be a second opinion about what the corpus contains.
 */
export function registerDiscoveryTools(server: McpServer, env: Env, getProps: () => McpProps) {
  server.tool(
    "search_ideas",
    "Full-text search across idea chapters and research entries. Call this BEFORE adding a chapter or a source, to find what the corpus already says instead of duplicating it. Each hit carries idea_id, kind, ref, title and a snippet — `ref` on a `section` hit is exactly the `section` argument read_idea_section takes, so a result is directly actionable. Far cheaper than list_idea_sections plus title-reading, and it searches the text rather than the headings.",
    {
      query: z.string().min(2).max(200).describe("Search terms. FTS5 syntax; ordinary words work."),
      idea_id: z.string().min(2).optional().describe("Restrict to one idea's chapters and research. Omit to search the whole corpus."),
      limit: z.number().int().min(1).max(50).optional().describe("Maximum hits. Defaults to 20."),
    },
    async (input) => {
      const params = new URLSearchParams({ q: input.query });
      if (input.idea_id) params.set("idea", input.idea_id);
      if (input.limit) params.set("limit", String(input.limit));
      const res = await fisApi<Record<string, unknown>>(env, `/api/search?${params.toString()}`, {
        token: getProps().token,
      });
      if (!res.ok || "error" in res.data) {
        return text(`Error searching ideas (${res.status}): ${"error" in res.data ? res.data.error : "unknown error"}`);
      }
      return text(JSON.stringify(res.data, null, 2));
    },
  );

  server.tool(
    "list_idea_sources",
    "List every URL an idea's document and research cite, with the sections citing each one and the link-check `status` and `last_checked`. This answers 'what does this document currently rest on' and 'has this URL already been cited' without reading the document, and it is the only way an author sees citation decay — a source that 404s still reads as evidence in the text.",
    {
      idea_id: z.string().min(2),
    },
    async (input) => {
      const res = await fisApi<Record<string, unknown>>(
        env,
        `/api/ideas/${encodeURIComponent(input.idea_id)}/sources`,
        { token: getProps().token },
      );
      if (!res.ok || "error" in res.data) {
        return text(`Error listing idea sources (${res.status}): ${"error" in res.data ? res.data.error : "unknown error"}`);
      }
      return text(JSON.stringify(res.data, null, 2));
    },
  );

  server.tool(
    "get_source",
    "Read one source and everything that cites it, across every idea. The reverse of list_idea_sources: given a source id from that list, this returns the URL's link-check status plus each idea, section and contribution citing it — which is how you tell whether a claim rests on one page in one chapter or on a source the corpus leans on repeatedly.",
    {
      source_id: z.string().min(2).describe("Source id from list_idea_sources."),
    },
    async (input) => {
      const res = await fisApi<Record<string, unknown>>(
        env,
        `/api/sources/${encodeURIComponent(input.source_id)}`,
        { token: getProps().token },
      );
      if (!res.ok || "error" in res.data) {
        return text(`Error reading source (${res.status}): ${"error" in res.data ? res.data.error : "unknown error"}`);
      }
      return text(JSON.stringify(res.data, null, 2));
    },
  );
}
