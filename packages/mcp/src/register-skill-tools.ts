import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { applyIdeaSkill, CHAPTERS, FREE_IDEA_SECTIONS, IDEA_SKILL_IDS, IDEA_SKILLS, skillSummary } from "./idea-skills.js";
import { dynamicIdeaBookPreview, slugify } from "./fis-api.js";
import { STAGES, text, type Env } from "./mcp-types.js";

export function registerSkillTools(server: McpServer, env: Env) {
  server.tool(
    "free_idea_template",
    "Return the cheap FreeIdeaStore one-page idea template. This is the default for raw free ideas.",
    {},
    async () => text(FREE_IDEA_SECTIONS.map(([key, title, note]) => `- ${key}: ${title} — ${note}`).join("\n")),
  );

  server.tool(
    "list_idea_skills",
    "List the published FreeIdeaStore brainstorming and refinement skills agents should use before creating, critiquing, or publishing idea documents.",
    {},
    async () => text(JSON.stringify({
      skills: IDEA_SKILLS.map(skillSummary),
      publicUrl: `${env.PUBLIC_BASE || "https://freeideastore.online"}/skills/`,
    }, null, 2)),
  );

  server.tool(
    "get_idea_skill",
    "Fetch a full FreeIdeaStore idea skill/playbook by id.",
    {
      skill_id: z.enum(IDEA_SKILL_IDS),
    },
    async (input) => {
      const skill = IDEA_SKILLS.find((item) => item.id === input.skill_id);
      return text(JSON.stringify(skill, null, 2));
    },
  );

  server.tool(
    "apply_idea_skill",
    "Apply a FreeIdeaStore idea skill to the current user idea/context and return questions, a checklist, or a tool plan.",
    {
      skill_id: z.enum(IDEA_SKILL_IDS),
      context: z.string().min(3).max(4000),
      mode: z.enum(["questions", "checklist", "tool_plan"]).optional(),
    },
    async (input) => {
      const skill = IDEA_SKILLS.find((item) => item.id === input.skill_id);
      return text(JSON.stringify(applyIdeaSkill(skill!, input.context, input.mode || "questions"), null, 2));
    },
  );

  server.tool(
    "dynamic_idea_book_template",
    "Return the canonical Markdown heading spine used by dynamic FreeIdeaStore idea publications.",
    {},
    async () => text(CHAPTERS.map(([title, prompt]) => `## ${title}\n${prompt}`).join("\n\n")),
  );

  server.tool(
    "dry_run_dynamic_idea_book",
    "Preview the canonical Markdown and dynamic chapter URLs for a FreeIdeaStore idea. This does not write files.",
    {
      title: z.string().min(2),
      summary: z.string().min(10),
      slug: z.string().optional(),
      stage: z.enum(STAGES).optional(),
      category: z.string().optional(),
    },
    async (input) => {
      const publicBase = env.PUBLIC_BASE || "https://freeideastore.online";
      const slug = slugify(input.slug || input.title);
      return text(JSON.stringify(dynamicIdeaBookPreview({
        slug,
        title: input.title,
        summary: input.summary,
        stage: input.stage || "raw",
        category: input.category || "uncategorized",
        publicBase,
      }), null, 2));
    },
  );
}
