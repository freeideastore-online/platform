#!/usr/bin/env node
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const endpoint =
  process.env.MCP_URL ||
  process.argv.slice(2).find((arg) => arg !== "--") ||
  "https://mcp.freeideastore.online/mcp";
const bearerToken = process.env.MCP_BEARER_TOKEN || "";

function textFrom(result) {
  return result.content
    ?.filter((item) => item.type === "text")
    .map((item) => item.text)
    .join("\n") ?? "";
}

async function main() {
  const requiredTools = [
    "add_idea_contribution",
    "apply_idea_skill",
    "create_free_idea",
    "delete_idea",
    "dry_run_dynamic_idea_book",
    "free_idea_template",
    "get_idea",
    "get_idea_skill",
    "list_idea_skills",
    "my_activity",
    "my_ideas",
    "dynamic_idea_book_template",
    "promote_to_pro_candidate",
    "propose_idea_refinement",
    "publish_idea_update",
    "react_to_idea",
  ].sort();

  if (!bearerToken && endpoint.startsWith("https://")) {
    const base = new URL(endpoint);
    const origin = `${base.protocol}//${base.host}`;
    const [health, root] = await Promise.all([
      fetch(`${origin}/health`),
      fetch(origin),
    ]);
    if (!health.ok) throw new Error(`MCP health failed ${health.status}: ${await health.text()}`);
    if (!root.ok) throw new Error(`MCP root failed ${root.status}: ${await root.text()}`);
    const healthJson = await health.json();
    const rootText = await root.text();
    for (const tool of requiredTools) {
      if (!rootText.includes(tool)) throw new Error(`Missing published MCP tool in root description: ${tool}`);
    }
    console.log(JSON.stringify({
      ok: true,
      endpoint,
      mode: "published-http-surface",
      tools: healthJson.tools,
      checks: ["health", "root-tool-list"],
    }, null, 2));
    return;
  }

  const client = new Client({ name: "fis-smoke-agent", version: "0.1.0" });
  const transport = new StreamableHTTPClientTransport(new URL(endpoint), bearerToken
    ? { requestInit: { headers: { Authorization: `Bearer ${bearerToken}` } } }
    : undefined);
  await client.connect(transport);

  const listed = await client.listTools();
  const toolNames = listed.tools.map((tool) => tool.name).sort();

  for (const tool of requiredTools) {
    if (!toolNames.includes(tool)) throw new Error(`Missing MCP tool: ${tool}`);
  }

  const template = await client.callTool({ name: "free_idea_template", arguments: {} });
  const templateText = textFrom(template);
  if (!templateText.includes("snapshot") || !templateText.includes("next_step")) {
    throw new Error("free_idea_template did not return the expected one-page sections");
  }

  const existingIdea = await client.callTool({
    name: "get_idea",
    arguments: { idea_id: "asx-filings-analyst", include_contributions: true },
  });
  const existingIdeaText = textFrom(existingIdea);
  if (!existingIdeaText.includes("ASX Filings Analyst")) {
    throw new Error("get_idea did not read the ASX Filings Analyst idea");
  }

  const bookPreview = await client.callTool({
    name: "dry_run_dynamic_idea_book",
    arguments: {
      title: "Smoke Test Idea",
      summary: "A non-writing MCP smoke test for the dynamic idea publication preview path.",
      stage: "researched",
      category: "platform",
    },
  });
  const bookPreviewText = textFrom(bookPreview);
  if (!bookPreviewText.includes("dynamic-worker-markdown") || !bookPreviewText.includes("/ideas/smoke-test-idea/research/")) {
    throw new Error("dry_run_dynamic_idea_book did not include the expected dynamic research chapter");
  }

  await client.close();
  console.log(
    JSON.stringify(
      {
        ok: true,
        endpoint,
        tools: toolNames,
        checks: ["listTools", "free_idea_template", "get_idea", "dry_run_dynamic_idea_book"],
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : error);
  process.exit(1);
});
