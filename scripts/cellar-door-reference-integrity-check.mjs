#!/usr/bin/env node

import { readFile } from "node:fs/promises";

const DEFAULT_IDEA =
  "cellar-door-cycling-a-roving-support-van-for-wine-country-weeken";
const DEFAULT_BASE = "https://freeideastore.online";

const LEGAL_SECTION_CONTEXT =
  /\b(StGB|StVG|BGB|Pauschalreise|Fahruntüchtigkeit|Geldbuße|Straftat|s 139A)\b/;

const STALE_COORDINATE_PATTERNS = [
  {
    id: "audit-status-section-number",
    pattern: /\*\*Complete\*\* — §[13]\b/g,
    hint: "Audit status rows should name the audit/chapter, not old source sections.",
  },
  {
    id: "old-audit-chapter-coordinate",
    pattern: /\*\*Audit And Corrections\*\* chapter §7\.[13]\s+[SM]-[\w/]+/g,
    hint: "The old §7 findings now live in the Cross-file consistency audit chapter.",
  },
  {
    id: "bare-audit-coordinate",
    pattern: /\bAudit And Corrections §\d+(?:\.\d+)?(?:\s+[SM]-[\w/]+)?/g,
    hint: "Bare Audit And Corrections coordinates do not resolve after the split.",
  },
  {
    id: "old-international-synthesis-coordinate",
    pattern: /\*\*International Synthesis — an index, not a conclusion\*\* §\d+(?:\.\d+)?/g,
    hint: "International Synthesis source sections became separate chapters.",
  },
  {
    id: "this-same-document-coordinate",
    pattern: /§\d+(?:\.\d+)? of this same document/g,
    hint: "After pagination, source section numbers need chapter names.",
  },
  {
    id: "generic-this-file-folder",
    pattern: /\bthis (?:file|folder)\b/gi,
    hint: "Published prose should say chapter, book, scan, or corpus.",
  },
];

function parseArgs(argv) {
  const options = { idea: DEFAULT_IDEA, base: DEFAULT_BASE };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--idea") options.idea = requiredValue(argv, ++i, arg);
    else if (arg === "--base") options.base = requiredValue(argv, ++i, arg);
    else if (arg === "--body") options.bodyPath = requiredValue(argv, ++i, arg);
    else usage(`unknown argument: ${arg}`);
  }
  return options;
}

function requiredValue(argv, index, arg) {
  const value = argv[index];
  if (!value || value.startsWith("--")) usage(`${arg} requires a value`);
  return value;
}

function usage(message) {
  if (message) console.error(message);
  console.error(
    "Usage: node scripts/cellar-door-reference-integrity-check.mjs [--body BODY.md] [--idea ID] [--base URL]",
  );
  process.exit(2);
}

async function fetchJson(options, apiPath, search = {}) {
  const url = new URL(apiPath, options.base);
  for (const [key, value] of Object.entries(search)) url.searchParams.set(key, value);
  const response = await fetch(url);
  const text = await response.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`GET ${url} returned non-JSON: ${text.slice(0, 120)}`);
  }
  if (!response.ok) {
    throw new Error(`GET ${url} failed: HTTP ${response.status} ${data.error || ""}`.trim());
  }
  return data;
}

async function bodyFor(options) {
  if (options.bodyPath) return readFile(options.bodyPath, "utf8");
  const data = await fetchJson(options, `/api/ideas/${options.idea}`, { body: "full" });
  if (!data.body || typeof data.body !== "string") {
    throw new Error("idea API returned no markdown body");
  }
  return data.body;
}

function lineNumberAt(body, index) {
  return body.slice(0, index).split(/\r?\n/).length;
}

function excerptAt(body, index, length) {
  const start = Math.max(0, index - 90);
  const end = Math.min(body.length, index + length + 120);
  return body.slice(start, end).replace(/\s+/g, " ").trim();
}

function findAll(body, pattern) {
  return [...body.matchAll(pattern)].map((match) => ({
    line: lineNumberAt(body, match.index || 0),
    match: match[0],
    excerpt: excerptAt(body, match.index || 0, match[0].length),
  }));
}

function parseChapters(body) {
  const chapters = [];
  let current = null;
  for (const [index, line] of body.split(/\r?\n/).entries()) {
    const chapter = line.match(/^(#{1,2})\s+(.+)/);
    if (chapter) {
      current = {
        title: chapter[2].trim(),
        line: index + 1,
        anchors: new Set(),
      };
      chapters.push(current);
      continue;
    }
    const subheading = line.match(/^#{3,6}\s+(.+)/);
    if (subheading && current) {
      const section = subheading[1].match(/^(\d+(?:\.\d+)?)/)?.[1];
      if (section) current.anchors.add(section);
    }
  }
  return chapters;
}

function chapterAt(chapters, line) {
  let found = chapters[0] || null;
  for (const chapter of chapters) {
    if (chapter.line > line) break;
    found = chapter;
  }
  return found;
}

function sectionRefs(body, chapters) {
  const residuals = [];
  const lines = body.split(/\r?\n/);
  for (const [index, line] of lines.entries()) {
    const lineNo = index + 1;
    if (LEGAL_SECTION_CONTEXT.test(line)) continue;
    const chapter = chapterAt(chapters, lineNo);
    for (const match of line.matchAll(/§(\d+(?:\.\d+)?)(?:\s+[A-Z]-[\w/]+)?/g)) {
      const section = match[1];
      const base = section.split(".").slice(0, 2).join(".");
      const hasLocalAnchor =
        chapter?.anchors.has(section) ||
        chapter?.anchors.has(base) ||
        (section.includes(".") && chapter?.anchors.has(section.split(".")[0]));
      const hasReaderCue =
        /\b(chapter|above|below|subsection|finding|objection)\b/i.test(line) ||
        /\*\*[^*]+\*\*/.test(line);
      if (!hasLocalAnchor && !hasReaderCue) {
        residuals.push({
          line: lineNo,
          match: match[0],
          chapter: chapter?.title || "",
          excerpt: line.trim(),
        });
      }
    }
  }
  return residuals;
}

function chapterReferenceResiduals(body, chapters) {
  const byTitle = new Map(chapters.map((chapter) => [chapter.title, chapter]));
  const residuals = [];
  const pattern = /\*\*([^*]+)\*\* chapter §(\d+(?:\.\d+)?)(?:\s+[A-Z]-[\w/]+)?/g;
  for (const match of body.matchAll(pattern)) {
    const title = match[1].trim();
    const section = match[2];
    const chapter = byTitle.get(title);
    const base = section.split(".").slice(0, 2).join(".");
    if (!chapter || !(chapter.anchors.has(section) || chapter.anchors.has(base))) {
      residuals.push({
        line: lineNumberAt(body, match.index || 0),
        match: match[0],
        excerpt: excerptAt(body, match.index || 0, match[0].length),
      });
    }
  }
  return residuals;
}

const options = parseArgs(process.argv.slice(2));
const body = await bodyFor(options);
const chapters = parseChapters(body);

const checks = {
  backticked_file_codes: findAll(body, /`0[0-9]`/g),
  markdown_filenames: findAll(body, /(?:`[^`\n]+\.md`|\b[\w./-]+\.md\b)/g),
  dead_in_page_anchor_links: findAll(body, /\]\(#[^)]+\)/g),
  stale_coordinates: STALE_COORDINATE_PATTERNS.flatMap((entry) =>
    findAll(body, entry.pattern).map((residual) => ({
      ...residual,
      kind: entry.id,
      hint: entry.hint,
    })),
  ),
  chapter_section_mismatches: chapterReferenceResiduals(body, chapters),
  unresolved_section_refs: sectionRefs(body, chapters),
};

const errors = Object.entries(checks).flatMap(([kind, residuals]) =>
  residuals.map((residual) => ({ kind, ...residual })),
);

const summary = {
  idea: options.idea,
  source: options.bodyPath || `${options.base}/api/ideas/${options.idea}?body=full`,
  chapters: chapters.length,
  residual_counts: Object.fromEntries(
    Object.entries(checks).map(([kind, residuals]) => [kind, residuals.length]),
  ),
  ok: errors.length === 0,
  errors,
};

console.log(JSON.stringify(summary, null, 2));
if (errors.length) process.exit(1);
