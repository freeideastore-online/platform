import { CHAPTERS } from "./idea-skills.js";
import type { Env } from "./mcp-types.js";

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 72);
}

function dynamicChapterId(title: string) {
  const normalized = title.toLowerCase();
  if (normalized.includes("competitor") || normalized.includes("similar service")) return "competitors";
  if (normalized.includes("regulation") || normalized.includes("site constraint")) return "regulation";
  if (normalized.includes("prototype")) return "prototype";
  if (normalized.includes("validation")) return "validation";
  if (normalized.includes("open question")) return "open-questions";
  if (normalized.includes("how to help") || normalized.includes("contribute")) return "contribute";
  if (normalized.includes("current thesis")) return "thesis";
  return slugify(title) || "section";
}

function dynamicIdeaBookMarkdown(input: {
  title: string;
  summary: string;
  stage: string;
  category: string;
}) {
  const { title, summary, stage, category } = input;
  const sections = CHAPTERS.map(([chapterTitle, prompt]) => `## ${chapterTitle}\n\n${prompt}`).join("\n\n");
  return `# ${title}

${summary}

Stage: ${stage}
Category: ${category}

${sections}
`;
}

export function dynamicIdeaBookPreview(input: {
  slug: string;
  title: string;
  summary: string;
  stage: string;
  category: string;
  publicBase: string;
}) {
  const markdown = dynamicIdeaBookMarkdown(input);
  const chapters = CHAPTERS.map(([title], index) => {
    const id = dynamicChapterId(title);
    return {
      index: index + 1,
      title,
      id,
      url: `${input.publicBase}/ideas/${input.slug}/${id}/`,
    };
  });
  return {
    slug: input.slug,
    publishing_model: "dynamic-worker-markdown",
    rule: "Store this markdown as the canonical idea body. The FreeIdeaStore Worker renders HTML and chapter URLs at request time. Do not create per-idea repos, Zensical projects, generated static assets, or fallback files for free ideas.",
    idea_url: `${input.publicBase}/ideas/${input.slug}/`,
    chapters,
    canonical_body_markdown: markdown,
  };
}

export async function fisApi<T>(
  env: Env,
  path: string,
  init?: RequestInit & { contributorHandle?: string; token?: string },
): Promise<{ ok: boolean; status: number; data: T | { error: string } }> {
  const base = env.FIS_API_BASE || env.PUBLIC_BASE || "https://freeideastore.online";
  const contributorHandle = init?.contributorHandle || "fis-mcp";
  const token = init?.token;
  const { contributorHandle: _contributorHandle, token: _token, ...requestInit } = init || {};
  const res = await fetch(`${base}${path}`, {
    ...requestInit,
    headers: {
      "Content-Type": "application/json",
      "x-idea-handle": contributorHandle,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...requestInit.headers,
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
