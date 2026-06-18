#!/usr/bin/env node
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const manifest = JSON.parse(await readFile(new URL("store/skills/manifest.json", root), "utf8"));
const indexHtml = await readFile(new URL("store/skills/index.html", root), "utf8");
const mcpSkillRegistry = [
  await readFile(new URL("packages/mcp/src/idea-skill-catalog.ts", root), "utf8"),
  await readFile(new URL("packages/mcp/src/idea-skills.ts", root), "utf8"),
].join("\n");
const mcpSkillTools = await readFile(new URL("packages/mcp/src/register-skill-tools.ts", root), "utf8");
const discovery = JSON.parse(await readFile(new URL("store/.well-known/mcp.json", root), "utf8"));

const ids = new Set();
const errors = [];

for (const skill of manifest.skills || []) {
  if (!skill.id || !skill.title || !skill.path) errors.push(`Skill is missing id/title/path: ${JSON.stringify(skill)}`);
  if (ids.has(skill.id)) errors.push(`Duplicate skill id: ${skill.id}`);
  ids.add(skill.id);

  const path = skill.path.startsWith("/") ? `store${skill.path}` : skill.path;
  let markdown = "";
  try {
    markdown = await readFile(new URL(path, root), "utf8");
  } catch {
    errors.push(`Missing markdown file for ${skill.id}: ${skill.path}`);
  }
  if (markdown && !markdown.includes(`# ${skill.title}`)) errors.push(`Markdown title mismatch for ${skill.id}`);
  if (!indexHtml.includes(skill.title)) errors.push(`Skills page does not publish title: ${skill.title}`);
  if (!mcpSkillRegistry.includes(`"${skill.id}"`)) errors.push(`MCP registry does not include skill id: ${skill.id}`);
}

for (const tool of ["list_idea_skills", "get_idea_skill", "apply_idea_skill"]) {
  if (!mcpSkillTools.includes(`"${tool}"`)) errors.push(`MCP source is missing tool: ${tool}`);
  const listed = discovery.servers?.[0]?.tools?.some((item) => item.name === tool);
  if (!listed) errors.push(`MCP discovery manifest is missing tool: ${tool}`);
}

if (errors.length) {
  console.error(errors.map((error) => `- ${error}`).join("\n"));
  process.exit(1);
}

console.log(JSON.stringify({ ok: true, skills: ids.size }, null, 2));
