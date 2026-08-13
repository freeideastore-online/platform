import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const wrangler = readFileSync(new URL("../wrangler.toml", import.meta.url), "utf8");
const index = readFileSync(new URL("index.ts", import.meta.url), "utf8");
const ideaSkills = readFileSync(new URL("idea-skills.ts", import.meta.url), "utf8");
const ideaSkillCatalog = readFileSync(new URL("idea-skill-catalog.ts", import.meta.url), "utf8");
const skillTools = readFileSync(new URL("register-skill-tools.ts", import.meta.url), "utf8");
const publishingTools = readFileSync(new URL("register-publishing-tools.ts", import.meta.url), "utf8");
const collaborationTools = readFileSync(new URL("register-collaboration-tools.ts", import.meta.url), "utf8");

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
    expect(ideaSkills).toContain("const TOOL_COUNT = 17");
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
    expect(index).toContain("publish_idea_update, delete_idea, react_to_idea");
    expect(collaborationTools).toContain('"react_to_idea"');
    expect(skillTools).toContain('"dynamic_idea_book_template"');
    expect(skillTools).toContain('"dry_run_dynamic_idea_book"');
    expect(`${skillTools}${publishingTools}${collaborationTools}`).not.toContain(["dry_run", "proidea_book_export"].join("_"));
    expect(`${skillTools}${publishingTools}${collaborationTools}`).not.toContain("idea-books/${slug}");
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
