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
    expect(wrangler).toContain('API_BASE = "https://api.freeappstore.online"');
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
    expect(index).toContain("publish_idea_update, delete_idea, react_to_idea");
    expect(collaborationTools).toContain('"react_to_idea"');
    expect(skillTools).toContain('"dynamic_idea_book_template"');
    expect(skillTools).toContain('"dry_run_dynamic_idea_book"');
    expect(`${skillTools}${publishingTools}${collaborationTools}`).not.toContain(["dry_run", "proidea_book_export"].join("_"));
    expect(`${skillTools}${publishingTools}${collaborationTools}`).not.toContain("idea-books/${slug}");
  });
});
