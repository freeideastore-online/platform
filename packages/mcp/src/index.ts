import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

interface Env {
  GITHUB_TOKEN?: string;
  GITHUB_ORG?: string;
  PLATFORM_REPO?: string;
  PUBLIC_BASE?: string;
  MCP_OBJECT: DurableObjectNamespace;
}

type TextResult = { content: { type: "text"; text: string }[] };
const text = (value: string): TextResult => ({ content: [{ type: "text", text: value }] });

const STAGES = ["raw", "critique", "researched", "pivot", "prototype", "built"] as const;

const CHAPTERS = [
  ["snapshot", "Snapshot", "What is the idea, who is it for, and what is the current maturity signal?"],
  ["brainstorming", "Brainstorming", "Raw thinking, variants, discarded angles, and why this idea deserves attention."],
  ["problem-customer", "Problem And Customer", "Customer, problem frequency, pain level, current workaround, and buyer/user split."],
  ["research", "Research", "Public sources, competitor notes, market signals, evidence requests, and unknowns."],
  ["design", "Design", "Workflow sketch, information architecture, UX notes, system shape, and edge cases."],
  ["prototype", "Prototype", "Smallest useful prototype, build scope, demo path, and test data required."],
  ["validation", "Validation", "How to prove, pivot, park, or trash the idea with the least effort."],
  ["open-questions", "Open Questions", "Questions that block confidence or need specialist input."],
  ["contribute", "Contribute", "Useful contribution prompts for researchers, builders, designers, operators, and critics."],
] as const;

function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 72);
}

function escapeToml(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}

function b64(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

function fromB64(value: string): string {
  const binary = atob(value.replace(/\n/g, ""));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

function chapterMarkdown(title: string, summary: string, prompt: string): string {
  return `---
title: ${title}
summary: ${summary}
---

# ${title}

${prompt}
`;
}

function ideaFiles(input: {
  slug: string;
  title: string;
  summary: string;
  stage: string;
  category: string;
  publicBase: string;
}): Map<string, string> {
  const { slug, title, summary, stage, category, publicBase } = input;
  const files = new Map<string, string>();
  files.set(
    `idea-books/${slug}/zensical.toml`,
    `[project]
site_name = "${escapeToml(title)}"
site_url = "${publicBase}/ideas/${slug}"
site_description = "${escapeToml(summary)}"
docs_dir = "docs"
site_dir = "../../store/ideas/${slug}"
copyright = "FreeIdeaStore"

[project.extra]
idea_slug = "${slug}"
stage = "${escapeToml(stage)}"
category = "${escapeToml(category)}"
homepage = "${publicBase}"

[project.theme]
variant = "modern"
`,
  );
  files.set(
    `idea-books/${slug}/docs/index.md`,
    `---
title: ${title}
summary: ${summary}
stage: ${stage}
category: ${category}
---

# ${title}

${summary}

This independent FreeIdeaStore idea book was scaffolded from the standard chapter spine. Replace placeholders with evidence, decisions, prototype notes, and contribution prompts as the idea matures.
`,
  );
  for (const [file, chapterTitle, prompt] of CHAPTERS) {
    files.set(`idea-books/${slug}/docs/${file}.md`, chapterMarkdown(chapterTitle, summary, prompt));
  }
  return files;
}

async function github(env: Env, path: string, init?: RequestInit): Promise<{ ok: boolean; status: number; text: string; data: unknown }> {
  if (!env.GITHUB_TOKEN) {
    return { ok: false, status: 0, text: "GITHUB_TOKEN is not configured", data: { error: "GITHUB_TOKEN is not configured" } };
  }
  const res = await fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      "Content-Type": "application/json",
      "User-Agent": "freeideastore-mcp",
      ...init?.headers,
    },
  });
  const raw = await res.text();
  let data: unknown = {};
  try {
    data = raw ? JSON.parse(raw) : {};
  } catch {
    data = { raw };
  }
  return { ok: res.ok, status: res.status, text: raw, data };
}

async function getRepoFile(env: Env, org: string, repo: string, filePath: string): Promise<{ content?: string; sha?: string; status: number; error?: string }> {
  const encoded = encodeURIComponent(filePath).replaceAll("%2F", "/");
  const res = await github(env, `/repos/${org}/${repo}/contents/${encoded}`);
  if (!res.ok) return { status: res.status, error: res.text };
  const data = res.data as { content?: string; sha?: string; type?: string };
  if (data.type !== "file" || !data.content) return { status: 400, error: `${filePath} is not a file` };
  return { status: res.status, content: fromB64(data.content), sha: data.sha };
}

async function putRepoFile(env: Env, org: string, repo: string, filePath: string, content: string, message: string): Promise<string> {
  const existing = await getRepoFile(env, org, repo, filePath);
  const encoded = encodeURIComponent(filePath).replaceAll("%2F", "/");
  const res = await github(env, `/repos/${org}/${repo}/contents/${encoded}`, {
    method: "PUT",
    body: JSON.stringify({
      message,
      content: b64(content),
      sha: existing.sha,
    }),
  });
  if (!res.ok) return `! ${filePath}: ${res.text}`;
  return `${existing.sha ? "Updated" : "Created"} ${filePath}`;
}

export class FisMcp extends McpAgent<Env> {
  server = new McpServer({ name: "FreeIdeaStore", version: "0.1.0" });

  async init() {
    this.server.tool(
      "idea_book_template",
      "Return the standard FreeIdeaStore idea-book chapter spine.",
      {},
      async () => text(CHAPTERS.map(([file, title]) => `- ${file}.md — ${title}`).join("\n")),
    );

    this.server.tool(
      "scaffold_idea_book",
      "Provision a new independent FreeIdeaStore idea book in the platform repo. With apply=false, returns the files without writing.",
      {
        title: z.string().min(2),
        summary: z.string().min(5),
        slug: z.string().optional(),
        stage: z.enum(STAGES).optional(),
        category: z.string().optional(),
        signal: z.string().optional(),
        preview: z.string().optional(),
        next_step: z.string().optional(),
        risk: z.string().optional(),
        docs_sections: z.array(z.string()).optional(),
        apply: z.boolean().optional().describe("Write to GitHub. Defaults to false."),
      },
      async (input) => {
        const org = this.env.GITHUB_ORG || "freeideastore-online";
        const repo = this.env.PLATFORM_REPO || "platform";
        const publicBase = this.env.PUBLIC_BASE || "https://freeideastore.serge-the-dev.workers.dev";
        const slug = slugify(input.slug || input.title);
        const stage = input.stage || "raw";
        const category = input.category || "uncategorized";
        const files = ideaFiles({ slug, title: input.title, summary: input.summary, stage, category, publicBase });
        const registryIdea = {
          id: slug,
          name: input.title,
          stage,
          category,
          signal: input.signal || input.summary,
          preview: input.preview || input.summary,
          docsUrl: `/ideas/${slug}/`,
          docsSections: (input.docs_sections?.length ? input.docs_sections : ["brainstorming", "research", "prototype"]).slice(0, 5),
          nextStep: input.next_step || "Define the first validation step.",
          contributors: 0,
          support: 0,
          risk: input.risk || "Main risk not yet identified.",
        };

        if (!input.apply) {
          return text(JSON.stringify({ slug, files: Object.fromEntries(files), registryIdea }, null, 2));
        }

        const existing = await getRepoFile(this.env, org, repo, `idea-books/${slug}/zensical.toml`);
        if (existing.status === 200) return text(`Error: idea book already exists: ${slug}`);

        const registryFile = await getRepoFile(this.env, org, repo, "store/registry.json");
        if (!registryFile.content) return text(`Error reading registry: ${registryFile.error || registryFile.status}`);
        const registry = JSON.parse(registryFile.content) as { ideas: Array<{ id: string }>; stages: string[]; categories: string[] };
        if (registry.ideas.some((idea) => idea.id === slug)) return text(`Error: registry already contains idea: ${slug}`);
        registry.ideas.push(registryIdea);
        if (!registry.stages.includes(stage)) registry.stages.push(stage);
        if (!registry.categories.includes(category)) registry.categories.push(category);
        files.set("store/registry.json", `${JSON.stringify(registry, null, 2)}\n`);

        const results: string[] = [];
        for (const [filePath, content] of files) {
          results.push(await putRepoFile(this.env, org, repo, filePath, content, `Scaffold idea book: ${slug}`));
        }
        return text([
          `Scaffolded ${slug} in ${org}/${repo}.`,
          `Book source: idea-books/${slug}/`,
          `Book URL after deploy: ${publicBase}/ideas/${slug}/`,
          "",
          results.join("\n"),
          "",
          "GitHub Actions will build/deploy if CF_DEPLOY_ENABLED and Cloudflare secrets are configured.",
        ].join("\n"));
      },
    );
  }
}

export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const url = new URL(request.url);
    if (url.pathname === "/health") {
      return Response.json({ ok: true, service: "freeideastore-mcp", tools: 2 });
    }
    if (url.pathname === "/mcp" || url.pathname.startsWith("/mcp/")) {
      return FisMcp.serve("/mcp").fetch(request, env, ctx);
    }
    return new Response("FreeIdeaStore MCP: use /mcp", { status: 404 });
  },
};
