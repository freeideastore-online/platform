#!/usr/bin/env node
import { writeFile } from "node:fs/promises";

const DEFAULT_IDEA =
  "cellar-door-cycling-a-roving-support-van-for-wine-country-weeken";
const DEFAULT_BASE = "https://freeideastore.online";

const DEMOTIONS = [
  {
    from: "Audit of the aggregator and shared-support research",
    into: "Audit And Corrections — read this before acting on any number",
  },
  {
    from: "4. Wine logistics — the clearest unoccupied ground",
    into: "3. How support is actually delivered — the four models, everywhere",
  },
];

const BARE_TITLES = new Set([
  "Gaps",
  "Honest gaps",
  "Gaps the researcher flagged",
  "What could not be established",
  "Price anchors",
  "Ruled out",
  "Ranked shortlist",
  "Closest things on earth",
  "Australian near misses",
  "Take rates, such as they are",
  "Not marketplaces — don't model them as channels",
  "Method and its limits",
  "How to read the evidence",
  "Minimum-numbers practice — and the conflict with OTA rules",
]);

function parseArgs(argv) {
  const options = { idea: DEFAULT_IDEA, base: DEFAULT_BASE, mode: "check" };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--idea") options.idea = requiredValue(argv, ++i, arg);
    else if (arg === "--base") options.base = requiredValue(argv, ++i, arg);
    else if (arg === "--write") {
      options.mode = "write";
      options.write = requiredValue(argv, ++i, arg);
    } else if (arg === "--check") options.mode = "check";
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
    "Usage: node scripts/cellar-door-chapter-merge-pass.mjs [--check] [--write OUTPUT.md] [--idea ID] [--base URL]",
  );
  process.exit(2);
}

async function fetchJson(options, path, search = {}) {
  const url = new URL(path, options.base);
  for (const [key, value] of Object.entries(search)) {
    url.searchParams.set(key, value);
  }
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`GET ${url} failed: HTTP ${response.status}`);
  }
  return response.json();
}

async function fetchBody(options) {
  const data = await fetchJson(options, `/api/ideas/${options.idea}`, {
    body: "full",
  });
  if (!data.body || typeof data.body !== "string") {
    throw new Error("idea response returned no markdown body");
  }
  return data.body;
}

function transformBody(body) {
  let next = body;
  const applied = [];
  for (const demotion of DEMOTIONS) {
    const from = `## ${demotion.from}`;
    const into = `## ${demotion.into}`;
    if (!next.includes(into)) {
      throw new Error(`missing target chapter: ${demotion.into}`);
    }
    const index = next.indexOf(from);
    if (index < 0) {
      applied.push({ ...demotion, changed: false });
      continue;
    }
    next = `${next.slice(0, index)}### ${demotion.from}${next.slice(
      index + from.length,
    )}`;
    applied.push({ ...demotion, changed: true });
  }
  return { body: next, applied };
}

function standaloneTitles(sections) {
  return sections
    .map((section) => section.title)
    .filter((title) => BARE_TITLES.has(title));
}

const options = parseArgs(process.argv.slice(2));

if (options.mode === "write") {
  const body = await fetchBody(options);
  const transformed = transformBody(body);
  await writeFile(options.write, transformed.body);
  console.log(
    JSON.stringify(
      {
        idea: options.idea,
        mode: "write",
        wrote: options.write,
        chars: transformed.body.length,
        applied: transformed.applied,
      },
      null,
      2,
    ),
  );
} else {
  const sectionsData = await fetchJson(
    options,
    `/api/ideas/${options.idea}/sections`,
  );
  const healthData = await fetchJson(
    options,
    `/api/ideas/${options.idea}/chapter-health`,
  );
  const belowFloor = healthData.health.filter((entry) => entry.words < 500);
  const nonSpineBelowFloor = belowFloor.filter(
    (entry) =>
      ![
        "overview",
        "people-and-problem",
        "proposed-solution",
        "model-and-distribution",
        "validation",
        "prototype",
        "evolution",
      ].includes(entry.id),
  );
  const bare = standaloneTitles(sectionsData.sections || []);
  const summary = {
    idea: options.idea,
    chapters: sectionsData.sections?.length,
    usage: sectionsData.usage,
    below_floor: belowFloor.map(({ id, title, words }) => ({
      id,
      title,
      words,
    })),
    non_spine_below_floor: nonSpineBelowFloor,
    bare_fragment_titles: bare,
  };
  console.log(JSON.stringify(summary, null, 2));
  if (nonSpineBelowFloor.length || bare.length) process.exit(1);
}
