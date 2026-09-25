#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const DEFAULT_IDEA =
  "cellar-door-cycling-a-roving-support-van-for-wine-country-weeken";
const DEFAULT_BASE = "https://freeideastore.online";
const DEFAULT_SOURCE_DIR = "/Users/serge-ivo/dev/ideas/cellar-door-cycling";

const SOURCE_FILES = [
  {
    file: "FINANCIALS.md",
    words: 12094,
    bytes: 77103,
    headings: { 1: 1, 2: 15, 3: 52 },
  },
  {
    file: "research/00-synthesis.md",
    words: 11520,
    bytes: 73792,
    headings: { 1: 1, 2: 14, 3: 35 },
  },
];

const EXPECTED_CHAPTERS = [
  ["5. ⚠️ Insurance — read this section before any other", 1478, "ok"],
  [
    "6. Season length — the 70-day assumption is arithmetically impossible",
    1207,
    "ok",
  ],
  ["7. Customer acquisition", 839, "ok"],
  [
    "8. Capacity — right on a good day, and it collapses on a bad one",
    1053,
    "ok",
  ],
  ["9–10. The numbers, sensitivity and scenarios", 1501, "ok"],
  ["11. Two structural alternatives", 876, "ok"],
  [
    "12–14. The three assumptions the model rests on, other verified items, and the verdict",
    1587,
    "ok",
  ],
  ["5–6. Who co-funds it, and the accommodation gap", 1231, "ok"],
  [
    "7. Price anchors — where the Australian numbers sit internationally",
    1257,
    "ok",
  ],
  ["8–9. Seasonality, and the legal and insurance risks", 1741, "ok"],
  ["10–11. Failures and exits, and the aggregator layer", 1532, "ok"],
  [
    "12. Shared-cost support models — what actually prices the shared van",
    1662,
    "ok",
  ],
  ["13–14. The ideas most worth copying, and the three cautions", 1842, "ok"],
];

const ORDER_ANCHORS = [
  "Financial Model And P&L — break-even, funding, and the insurance hole",
  ...EXPECTED_CHAPTERS.slice(0, 7).map(([title]) => title),
  "The Case Against — the critique and the wedge that survives it",
  "International Scan — method, evidence tags, and its limits",
  "International Synthesis — an index, not a conclusion",
  "2. The five numbers that matter most",
  "3. How support is actually delivered — the four models, everywhere",
  ...EXPECTED_CHAPTERS.slice(7).map(([title]) => title),
  "Region — France: Burgundy, Loire, Alsace, Bordeaux, Provence",
];

const REQUIRED_MARKERS = [
  "No broker, underwriting agency, comparison site or industry body in Australia",
  "The business does not reach EBITDA break-even within three years on this ramp.",
  "peak funding need is $240,000",
  "### 14. Verdict",
  "Will cellar doors co-fund it? No — but somebody else will",
  "Accommodation: the gap is real, and here is why it is empty",
  "### 8. Seasonality — nobody has solved winter",
  "The van may be a licensed passenger vehicle",
  "### 10. Failures and exits — the survival pattern",
  "Aggregators and marketplaces",
  "Six numbers that price the shared van",
  "### 14. The three cautions the evidence supports",
];

const FORBIDDEN_MARKERS = [
  "THE FINANCIAL MODEL IS TRUNCATED HERE",
  "§5 TO §14 ARE MISSING",
  "THE INTERNATIONAL SYNTHESIS IS TRUNCATED HERE",
  "Do not draw conclusions from the cost build-up above",
  "[Section 12](#12-the-three-assumptions-the-whole-model-rests-on)",
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
    "Usage: node scripts/cellar-door-financial-synthesis-check.mjs [--idea ID] [--base URL] [--source-dir DIR]",
  );
  process.exit(2);
}

async function fetchJson(options, apiPath, search = {}) {
  const url = new URL(apiPath, options.base);
  for (const [key, value] of Object.entries(search)) {
    url.searchParams.set(key, value);
  }
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`GET ${url} failed: HTTP ${response.status}`);
  }
  return response.json();
}

async function wcStats(sourcePath) {
  const { stdout } = await execFileAsync("wc", ["-w", "-c", sourcePath]);
  const [words, bytes] = stdout.trim().split(/\s+/, 3).map(Number);
  return { words, bytes };
}

function headingCounts(markdown) {
  const counts = { 1: 0, 2: 0, 3: 0 };
  for (const line of markdown.split(/\r?\n/)) {
    const match = line.match(/^(#{1,3})\s+[^#]/);
    if (match) counts[match[1].length] += 1;
  }
  return counts;
}

function fail(errors, condition, message) {
  if (!condition) errors.push(message);
}

const options = parseArgs(process.argv.slice(2));
const errors = [];

const sourceStats = [];
for (const expected of SOURCE_FILES) {
  const sourcePath = path.join(options.sourceDir, expected.file);
  const markdown = await readFile(sourcePath, "utf8");
  const stats = await wcStats(sourcePath);
  const actual = {
    file: expected.file,
    words: stats.words,
    bytes: stats.bytes,
    headings: headingCounts(markdown),
  };
  sourceStats.push(actual);
  fail(
    errors,
    actual.words === expected.words,
    `${expected.file} word count ${actual.words} !== ${expected.words}`,
  );
  fail(
    errors,
    actual.bytes === expected.bytes,
    `${expected.file} byte count ${actual.bytes} !== ${expected.bytes}`,
  );
  for (const level of [1, 2, 3]) {
    fail(
      errors,
      actual.headings[level] === expected.headings[level],
      `${expected.file} h${level} count ${actual.headings[level]} !== ${expected.headings[level]}`,
    );
  }
}

const [sectionsData, bodyData] = await Promise.all([
  fetchJson(options, `/api/ideas/${options.idea}/sections`),
  fetchJson(options, `/api/ideas/${options.idea}`, { body: "full" }),
]);

const sections = sectionsData.sections || [];
const body = String(bodyData.body || "");
const sectionByTitle = new Map(
  sections.map((section) => [section.title, section]),
);

fail(errors, sections.length === 74, `chapter count ${sections.length} !== 74`);
fail(
  errors,
  sectionsData.usage?.chapters === 74,
  `usage chapter count ${sectionsData.usage?.chapters} !== 74`,
);
fail(
  errors,
  sectionsData.usage?.chapters_remaining === 26,
  `chapters remaining ${sectionsData.usage?.chapters_remaining} !== 26`,
);
fail(
  errors,
  sectionsData.usage?.above_ceiling === 0,
  `above-ceiling chapters ${sectionsData.usage?.above_ceiling} !== 0`,
);

let previousPosition = -1;
for (const title of ORDER_ANCHORS) {
  const position = sections.findIndex((row) => row.title === title);
  fail(errors, position >= 0, `missing ordered chapter: ${title}`);
  fail(
    errors,
    position > previousPosition,
    `chapter out of order: ${title}`,
  );
  previousPosition = position;
}

for (const [title, words, verdict] of EXPECTED_CHAPTERS) {
  const section = sectionByTitle.get(title);
  fail(errors, Boolean(section), `missing #58 chapter: ${title}`);
  if (!section) continue;
  fail(
    errors,
    section.words === words,
    `${title} words ${section.words} !== ${words}`,
  );
  fail(
    errors,
    section.verdict === verdict,
    `${title} verdict ${section.verdict} !== ${verdict}`,
  );
  fail(
    errors,
    section.words >= 500 && section.words <= 4000,
    `${title} must stay inside floor/ceiling, got ${section.words}`,
  );
}

for (const marker of REQUIRED_MARKERS) {
  fail(errors, body.includes(marker), `missing content marker: ${marker}`);
}

for (const marker of FORBIDDEN_MARKERS) {
  fail(errors, !body.includes(marker), `forbidden marker still present: ${marker}`);
}

const expectedWords = EXPECTED_CHAPTERS.reduce(
  (sum, [, words]) => sum + words,
  0,
);

const summary = {
  idea: options.idea,
  source_dir: options.sourceDir,
  source_files: sourceStats,
  financial_and_synthesis_chapters: EXPECTED_CHAPTERS.length,
  financial_and_synthesis_words_live: expectedWords,
  live: {
    chapters: sections.length,
    chars: sectionsData.usage?.chars,
    chars_remaining: sectionsData.usage?.chars_remaining,
    chapters_remaining: sectionsData.usage?.chapters_remaining,
    below_floor: sectionsData.usage?.below_floor,
    above_ceiling: sectionsData.usage?.above_ceiling,
  },
  ok: errors.length === 0,
  errors,
};

console.log(JSON.stringify(summary, null, 2));
if (errors.length) process.exit(1);
