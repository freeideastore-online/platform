import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { CHAPTERS } from "./idea-skills.js";
import { registerSkillTools } from "./register-skill-tools.js";
import type { Env, TextResult } from "./mcp-types.js";

function templateTool() {
  let schema: Record<string, z.ZodTypeAny> = {};
  let handler: (input: { archetype?: string }) => Promise<TextResult>;
  const server = { tool(name: string, _description: string, input: typeof schema, fn: typeof handler) {
    if (name === "dynamic_idea_book_template") { schema = input; handler = fn; }
  } } as unknown as McpServer;
  registerSkillTools(server, {} as Env);
  return async (input: Record<string, unknown>) => handler!(z.object(schema).parse(input));
}

describe("question-based book templates (#54)", () => {
  it("preserves the existing no-argument idea spine", async () => {
    const invoke = templateTool();
    const legacy = CHAPTERS.map(([title, prompt]) => `## ${title}\n${prompt}`).join("\n\n");
    expect((await invoke({})).content[0]).toEqual({ type: "text", text: legacy });
    expect(await invoke({ archetype: "idea" })).toEqual(await invoke({}));
  });

  it.each([
    ["research-annex", ["What was searched, and what could this method not see?", "What was found, per subject?", "What could not be established?"]],
    ["audit", ["What is the verdict?", "What is wrong, by severity?", "What was corrected?", "What was not checked?"]],
    ["financial-model", ["What is the headline number?", "What are the cost lines?", "What does the P&L look like?", "What breaks it?", "What is the verdict?"]],
  ])("returns the agreed questions for %s without numeric budgets", async (archetype, questions) => {
    const result = await templateTool()({ archetype });
    const output = (result.content[0] as { text: string }).text;
    for (const question of questions) expect(output).toContain(question);
    expect(output).toContain("one finding chapter per subject");
    expect(output).toContain("function alone");
    expect(output).toContain("diagnostics, never targets or chapter budgets");
    expect(output).not.toMatch(/\d/);
  });

  it("rejects an unknown archetype", async () => {
    await expect(templateTool()({ archetype: "invented" })).rejects.toThrow();
  });
});
