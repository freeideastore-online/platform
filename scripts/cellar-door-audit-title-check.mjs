#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import path from "node:path";

const DEFAULT_IDEA =
  "cellar-door-cycling-a-roving-support-van-for-wine-country-weeken";
const DEFAULT_BASE = "https://freeideastore.online";
const DEFAULT_SOURCE_DIR = "/Users/serge-ivo/dev/ideas/cellar-door-cycling";

const RENAMED_SECTIONS = [
  {
    oldTitle: "7. Cross-file consistency audit — the synthesis is the weak point",
    newTitle: "Cross-file consistency audit — the synthesis is the weak point",
    oldId: "7-cross-file-consistency-audit-the-synthesis-is-the-weak-point",
    newId: "cross-file-consistency-audit-the-synthesis-is-the-weak-point",
  },
  {
    oldTitle: "8. Consolidated priority actions — all three audits",
    newTitle: "Consolidated priority actions — all three audits",
    oldId: "8-consolidated-priority-actions-all-three-audits",
    newId: "consolidated-priority-actions-all-three-audits",
  },
];

const MERGED_BY_59 = [
  "8b. Corrections applied, and the one deletion",
  "9. Overall verdict",
];

function parseArgs(argv) {
  const options = {
    idea: DEFAULT_IDEA,
    base: DEFAULT_BASE,
    sourceDir: DEFAULT_SOURCE_DIR,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--idea") options.idea = requiredValue(argv, ++i, arg);
    else if (arg === "--base") options.base = requiredValue(argv, ++i, arg);
    else if (arg === "--source-dir")
      options.sourceDir = requiredValue(argv, ++i, arg);
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
    "Usage: node scripts/cellar-door-audit-title-check.mjs [--idea ID] [--base URL] [--source-dir DIR]",
  );
  process.exit(2);
}

async function fetchJson(options, apiPath) {
  const response = await fetch(new URL(apiPath, options.base));
  const text = await response.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`GET ${apiPath} returned non-JSON: ${text.slice(0, 80)}`);
  }
  if (!response.ok) {
    throw new Error(`GET ${apiPath} failed: HTTP ${response.status} ${data.error || ""}`.trim());
  }
  return data;
}

async function fetchRedirect(options, chapterId) {
  const response = await fetch(
    new URL(`/ideas/${options.idea}/${chapterId}/`, options.base),
    { redirect: "manual" },
  );
  return {
    status: response.status,
    location: response.headers.get("location"),
  };
}

function fail(errors, condition, message) {
  if (!condition) errors.push(message);
}

const options = parseArgs(process.argv.slice(2));
const errors = [];
const sourcePath = path.join(
  options.sourceDir,
  "research/07-audit-and-corrections.md",
);
const source = await readFile(sourcePath, "utf8");
const sourceNumberedHeadings = source
  .split(/\r?\n/)
  .filter((line) => /^## [0-9]/.test(line));

for (const section of RENAMED_SECTIONS) {
  fail(
    errors,
    !source.includes(`## ${section.oldTitle}`),
    `source still contains old heading: ${section.oldTitle}`,
  );
  fail(
    errors,
    source.includes(`## ${section.newTitle}`),
    `source is missing new heading: ${section.newTitle}`,
  );
}

const sectionsData = await fetchJson(options, `/api/ideas/${options.idea}/sections`);
const sections = sectionsData.sections || [];
const sectionByTitle = new Map(sections.map((section) => [section.title, section]));
const redirects = [];

for (const section of RENAMED_SECTIONS) {
  const oldSection = sectionByTitle.get(section.oldTitle);
  const newSection = sectionByTitle.get(section.newTitle);
  fail(errors, !oldSection, `live section still contains old title: ${section.oldTitle}`);
  fail(errors, Boolean(newSection), `live section is missing new title: ${section.newTitle}`);
  if (newSection) {
    fail(
      errors,
      newSection.id === section.newId,
      `live section ${section.newTitle} has id ${newSection.id}, expected ${section.newId}`,
    );
  }

  const apiSection = await fetchJson(
    options,
    `/api/ideas/${options.idea}/sections/${section.oldId}`,
  );
  fail(
    errors,
    apiSection.section === section.newId,
    `old API section ${section.oldId} resolves to ${apiSection.section}, expected ${section.newId}`,
  );

  const redirect = await fetchRedirect(options, section.oldId);
  redirects.push({ old_id: section.oldId, ...redirect });
  fail(
    errors,
    redirect.status === 301 &&
      typeof redirect.location === "string" &&
      redirect.location.endsWith(`/${section.newId}/`),
    `old public URL ${section.oldId} did not 301 to ${section.newId}`,
  );
}

for (const title of MERGED_BY_59) {
  fail(errors, !sectionByTitle.has(title), `#59-merged section still exists: ${title}`);
}

const summary = {
  idea: options.idea,
  source: sourcePath,
  source_numbered_headings: sourceNumberedHeadings,
  renamed_sections: RENAMED_SECTIONS.map(({ oldTitle, newTitle, oldId, newId }) => ({
    old_title: oldTitle,
    new_title: newTitle,
    old_id: oldId,
    new_id: newId,
  })),
  redirects,
  chapters: sections.length,
  ok: errors.length === 0,
  errors,
};

console.log(JSON.stringify(summary, null, 2));
if (errors.length) process.exit(1);
