import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { toolNames } from "./tool-registry.js";

const wrangler = readFileSync(new URL("../wrangler.toml", import.meta.url), "utf8");
const index = readFileSync(new URL("index.ts", import.meta.url), "utf8");
const ideaSkills = readFileSync(new URL("idea-skills.ts", import.meta.url), "utf8");
const ideaSkillCatalog = readFileSync(new URL("idea-skill-catalog.ts", import.meta.url), "utf8");
const skillTools = readFileSync(new URL("register-skill-tools.ts", import.meta.url), "utf8");
const publishingTools = readFileSync(new URL("register-publishing-tools.ts", import.meta.url), "utf8");
const collaborationTools = readFileSync(new URL("register-collaboration-tools.ts", import.meta.url), "utf8");

const repoFile = (path: string) => readFileSync(new URL(`../../../${path}`, import.meta.url), "utf8");
const manifest = repoFile("store/.well-known/mcp.json");
const mcpDoc = repoFile("platform-docs/mcp.md");
const llmsTxt = repoFile("store/llms.txt");
const readme = repoFile("README.md");

const registered = [...toolNames()].sort();

/** Snake_case identifiers that appear in prose and are fields, not tools. */
const NON_TOOL_IDENTIFIERS = new Set([
  "source_url",
  "next_step",
  "demote_headings",
  "idea_id",
  "section_id",
  "revision_id",
]);

/** Every snake_case identifier a document names, minus the known non-tools. */
function claimedToolNames(document: string): string[] {
  const tokens = document.match(/\b[a-z]+(?:_[a-z]+)+\b/g) || [];
  return [...new Set(tokens)].filter((token) => !NON_TOOL_IDENTIFIERS.has(token)).sort();
}

/** The bullet list under one `##` heading of a Markdown document. */
function bulletedNamesUnder(document: string, heading: string): string[] {
  const start = document.indexOf(`## ${heading}`);
  const rest = document.slice(start + heading.length);
  const end = rest.indexOf("\n## ");
  const section = end === -1 ? rest : rest.slice(0, end);
  return [...new Set([...section.matchAll(/^- `([a-z_]+)`/gm)].map((m) => m[1]))].sort();
}

describe("MCP deployment config", () => {
  it("keeps the canonical custom-domain route attached", () => {
    expect(wrangler).toContain('name = "freeideastore-mcp"');
    expect(wrangler).toContain("[[routes]]");
    expect(wrangler).toContain('pattern = "mcp.freeideastore.online"');
    expect(wrangler).toContain('zone_name = "freeideastore.online"');
    expect(wrangler).toContain("custom_domain = true");
  });

  it("points tools at the canonical FreeIdeaStore API and public site", () => {
    expect(wrangler).toContain('PUBLIC_BASE = "https://freeideastore.online"');
    expect(wrangler).toContain('FIS_API_BASE = "https://freeideastore.online"');
    expect(wrangler).toContain('FIS_AUTH_BASE = "https://freeideastore.online"');
  });

  it("takes identity from FreeIdeaStore alone", () => {
    // #34 was only fixable by touching a FreeAppStore worker. Nothing in this
    // package may name another store again — that dependency is the bug.
    expect(wrangler).not.toContain("freeappstore");
    expect(index).not.toContain("freeappstore");
    expect(index).toContain('const AUTH_START_PATH = "/.fis/auth/start"');
  });

  it("advertises the canonical skill and document publishing tools", () => {
    expect(skillTools).toContain('"list_idea_skills"');
    expect(skillTools).toContain('"get_idea_skill"');
    expect(skillTools).toContain('"apply_idea_skill"');
    expect(ideaSkillCatalog).toContain('"idea-flow-orchestrator"');
    expect(ideaSkillCatalog).toContain('"idea-document-architect"');
    expect(ideaSkillCatalog).toContain('"competitor-finder"');
    expect(ideaSkillCatalog).toContain('"validation-planner"');
    expect(ideaSkillCatalog).toContain('"prototype-planner"');
    expect(publishingTools).toContain('"publish_idea_update"');
    expect(publishingTools).toContain('"delete_idea"');
    // #33: the only tool that writes summary/title/stage must not demand the
    // whole body with them, or a document too large to resend has its metadata
    // frozen — wrong or not — for the rest of its life.
    expect(publishingTools).toMatch(/body: z\.string\(\)[^\n]*\.optional\(\)/);
    expect(publishingTools).toMatch(/title: z\.string\(\)[^\n]*\.optional\(\)/);
    expect(collaborationTools).toContain('"react_to_idea"');
    expect(skillTools).toContain('"dynamic_idea_book_template"');
    expect(skillTools).toContain('"dry_run_dynamic_idea_book"');
    expect(`${skillTools}${publishingTools}${collaborationTools}`).not.toContain(["dry_run", "proidea_book_export"].join("_"));
    expect(`${skillTools}${publishingTools}${collaborationTools}`).not.toContain("idea-books/${slug}");
  });

  /**
   * #72. The server registered 32 tools and advertised 17. Every section-write,
   * revision and refinement tool was missing from the surfaces an agent reads
   * before deciding what to call — which is the most plausible reason two KB
   * migrations reached for whole-document `publish_idea_update` writes.
   *
   * These four cases are the durable half of the fix. The one-time correction
   * would rot again; a test that reads the registrations cannot.
   */
  describe("the advertised tool list matches the registered one (#72)", () => {
    it("registers a non-trivial number of tools, so an empty read cannot pass", () => {
      // Every case below compares against `registered`. If the recorder in
      // tool-registry.ts silently stopped collecting, they would all pass on
      // two empty lists. Pin the floor so that failure is loud.
      expect(registered.length).toBeGreaterThanOrEqual(32);
      expect(new Set(registered).size).toBe(registered.length);
    });

    it("serves the list at / by reading the registrations, not by restating them", () => {
      // ROOT_TEXT is derived, so there is nothing here to drift — this case
      // exists to keep it that way. A literal list reintroduced in index.ts is
      // the exact regression #72 was.
      expect(index).toContain("toolNames().join(\", \")");
      expect(index).toContain("tools: toolCount()");
      expect(index).not.toMatch(/Tools: [a-z_]+, [a-z_]+/);
      expect(ideaSkills).not.toMatch(/TOOL_COUNT\s*=\s*\d+/);
    });

    it("lists every registered tool in the public discovery manifest", () => {
      const advertised = (JSON.parse(manifest) as { servers: { tools: { name: string }[] }[] })
        .servers.flatMap((server) => server.tools.map((tool) => tool.name))
        .sort();
      expect(advertised).toEqual(registered);
    });

    it("lists every registered tool in the platform docs", () => {
      expect(bulletedNamesUnder(mcpDoc, "Important Tools")).toEqual(registered);
    });

    it("states the true tool count wherever prose quotes one", () => {
      expect(mcpDoc).toContain(`All ${registered.length} tools the server registers`);
      expect(llmsTxt).toContain(`MCP tools: ${registered.length},`);
    });

    it("names no tool the server does not register", () => {
      // The other direction: `store/llms.txt` advertised `proidea_book_template`
      // and `dry_run_proidea_book_export`, neither of which has ever existed.
      for (const [surface, document] of [["store/llms.txt", llmsTxt], ["README.md", readme]] as const) {
        for (const claimed of claimedToolNames(document)) {
          expect(registered, `${surface} names a tool that is not registered: ${claimed}`).toContain(claimed);
        }
      }
    });
  });

  /**
   * #48. The three tools that write markdown into a section used to say only
   * "Do not repeat the section heading", which warns about ONE heading and is
   * silent about every other. Four agents independently concluded the store
   * splits on `##` — wrong by half, because a non-title `#` splits too — and a
   * migration that intended 15 chapters produced 74.
   */
  it("states the chapter heading contract on every section-write tool", () => {
    // The contract itself, and the escape hatch, stated once and shared.
    expect(publishingTools).toContain("`#` AND `##` both create sibling chapters");
    expect(publishingTools).toContain("`###` and deeper stay inside the chapter");
    expect(publishingTools).toContain("set demote_headings: true");

    // Each of the three `content` fields carries it, and each tool declares the
    // flag and forwards it to the API — a flag the schema advertises and the
    // request body drops is worse than no flag.
    const contentFields = publishingTools.match(/content: z\.string\(\)[^\n]*HEADING_CONTRACT/g) || [];
    expect(contentFields).toHaveLength(3);
    const declared = publishingTools.match(/demote_headings: z\.boolean\(\)\.optional\(\)/g) || [];
    expect(declared).toHaveLength(3);
    const forwarded = publishingTools.match(/demote_headings: input\.demote_headings/g) || [];
    expect(forwarded).toHaveLength(3);
  });
});
