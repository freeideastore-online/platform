import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

interface Env {
  GITHUB_TOKEN?: string;
  GITHUB_ORG?: string;
  PLATFORM_REPO?: string;
  PUBLIC_BASE?: string;
  FIS_API_BASE?: string;
  MCP_OBJECT: DurableObjectNamespace;
}

type TextResult = { content: { type: "text"; text: string }[] };
const text = (value: string): TextResult => ({ content: [{ type: "text", text: value }] });

const STAGES = ["raw", "critique", "researched", "pivot", "prototype", "built"] as const;

const FREE_IDEA_SECTIONS = [
  ["snapshot", "Snapshot", "One paragraph describing the idea, user, and current maturity."],
  ["signal", "Current Signal", "Why it may be worth attention now."],
  ["next_step", "Next Step", "The cheapest useful validation step."],
  ["risk", "Risk", "The main reason this may fail or should be trashed."],
  ["help", "How To Help", "Prompts for evidence, critique, pivot, and prototype contributions."],
] as const;

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

async function fisApi<T>(env: Env, path: string, init?: RequestInit): Promise<{ ok: boolean; status: number; data: T | { error: string } }> {
  const base = env.FIS_API_BASE || env.PUBLIC_BASE || "https://freeideastore.online";
  const res = await fetch(`${base}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      "x-idea-handle": "fis-mcp",
      ...init?.headers,
    },
  });
  const raw = await res.text();
  let data: T | { error: string };
  try {
    data = raw ? JSON.parse(raw) : ({} as T);
  } catch {
    data = { error: raw || `HTTP ${res.status}` };
  }
  return { ok: res.ok, status: res.status, data };
}

export class FisMcp extends McpAgent<Env> {
  server = new McpServer({ name: "FreeIdeaStore", version: "0.1.0" });

  async init() {
    this.server.tool(
      "free_idea_template",
      "Return the cheap FreeIdeaStore one-page idea template. This is the default for raw free ideas.",
      {},
      async () => text(FREE_IDEA_SECTIONS.map(([key, title, note]) => `- ${key}: ${title} — ${note}`).join("\n")),
    );

    this.server.tool(
      "create_free_idea",
      "Create a cheap FreeIdeaStore idea page through the Worker API. This writes one D1 row and, when configured, one R2 body object.",
      {
        title: z.string().min(2),
        summary: z.string().min(10),
        stage: z.enum(STAGES).optional(),
        category: z.string().optional(),
        signal: z.string().optional(),
        preview: z.string().optional(),
        next_step: z.string().optional(),
        risk: z.string().optional(),
        body: z.string().optional().describe("Optional markdown body for the idea page."),
        source_url: z.string().optional(),
      },
      async (input) => {
        const publicBase = this.env.PUBLIC_BASE || "https://freeideastore.online";
        const body = input.body || [
          "## Snapshot",
          input.summary,
          "",
          "## Current signal",
          input.signal || input.preview || "No signal has been added yet.",
          "",
          "## Next step",
          input.next_step || "Define the cheapest useful validation step.",
          "",
          "## Risk",
          input.risk || "Main risk not yet identified.",
          "",
          "## How to help",
          "- Add evidence from public sources.",
          "- Name a risk or reason to trash it.",
          "- Suggest a sharper customer, wedge, or pivot.",
        ].join("\n");
        const res = await fisApi<{ idea: string; url: string }>(this.env, "/api/ideas", {
          method: "POST",
          body: JSON.stringify({
            title: input.title,
            summary: input.summary,
            stage: input.stage || "raw",
            category: input.category || "uncategorized",
            signal: input.signal || "",
            preview: input.preview || input.summary,
            nextStep: input.next_step || "",
            risk: input.risk || "",
            body,
            source_url: input.source_url || "",
          }),
        });
        if (!res.ok || "error" in res.data) {
          return text(`Error creating free idea (${res.status}): ${"error" in res.data ? res.data.error : "unknown error"}`);
        }
        return text(JSON.stringify({
          idea: res.data.idea,
          url: `${publicBase}${res.data.url}`,
          storage: "D1 metadata plus optional R2 body/render cache",
          proPath: "Call promote_to_pro_candidate when this deserves a curated ProIdeaStore dossier.",
        }, null, 2));
      },
    );

    this.server.tool(
      "promote_to_pro_candidate",
      "Mark a FreeIdeaStore idea as a ProIdeaStore candidate and return a dossier draft payload.",
      {
        idea_id: z.string().min(2),
      },
      async (input) => {
        const res = await fisApi<Record<string, unknown>>(this.env, `/api/ideas/${encodeURIComponent(input.idea_id)}/promote`, {
          method: "POST",
          body: JSON.stringify({}),
        });
        if (!res.ok || "error" in res.data) {
          return text(`Error promoting idea (${res.status}): ${"error" in res.data ? res.data.error : "unknown error"}`);
        }
        return text(JSON.stringify(res.data, null, 2));
      },
    );

    this.server.tool(
      "proidea_book_template",
      "Return the full ProIdeaStore/Zensical book spine used only after an idea graduates from the free store.",
      {},
      async () => text(CHAPTERS.map(([file, title]) => `- ${file}.md — ${title}`).join("\n")),
    );

    this.server.tool(
      "dry_run_proidea_book_export",
      "Dry-run a full Zensical-style book export for a promoted idea. This does not write GitHub files.",
      {
        title: z.string().min(2),
        summary: z.string().min(10),
        slug: z.string().optional(),
        stage: z.enum(STAGES).optional(),
        category: z.string().optional(),
      },
      async (input) => {
        const publicBase = this.env.PUBLIC_BASE || "https://freeideastore.online";
        const slug = slugify(input.slug || input.title);
        const files = ideaFiles({
          slug,
          title: input.title,
          summary: input.summary,
          stage: input.stage || "researched",
          category: input.category || "uncategorized",
          publicBase,
        });
        return text(JSON.stringify({
          slug,
          intent: "promotion/export only; do not use this for ordinary free ideas",
          files: Object.fromEntries(files),
        }, null, 2));
      },
    );
  }
}

export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const url = new URL(request.url);
    if (url.pathname === "/health") {
      return Response.json({ ok: true, service: "freeideastore-mcp", tools: 4 });
    }
    if (url.pathname === "/mcp" || url.pathname.startsWith("/mcp/")) {
      return FisMcp.serve("/mcp").fetch(request, env, ctx);
    }
    return new Response("FreeIdeaStore MCP: use /mcp", { status: 404 });
  },
};
