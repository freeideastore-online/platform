#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const DEFAULT_IDEA =
  "cellar-door-cycling-a-roving-support-van-for-wine-country-weeken";
const DEFAULT_BASE = "https://freeideastore.online";
const DEFAULT_SOURCE_DIR =
  "/Users/serge-ivo/dev/ideas/cellar-door-cycling/research";

const SOURCE_FILES = [
  {
    file: "01-france.md",
    words: 7401,
    bytes: 50476,
    headings: { 1: 9, 2: 14, 3: 22 },
  },
  {
    file: "02-italy-spain-portugal.md",
    words: 8695,
    bytes: 59907,
    headings: { 1: 11, 2: 15, 3: 37 },
  },
  {
    file: "03-majors-dach-canada.md",
    words: 12504,
    bytes: 85699,
    headings: { 1: 7, 2: 32, 3: 35 },
  },
  {
    file: "04-new-world.md",
    words: 10167,
    bytes: 69266,
    headings: { 1: 7, 2: 14, 3: 47 },
  },
  {
    file: "05-aggregators-and-shared-support.md",
    words: 9251,
    bytes: 63192,
    headings: { 1: 6, 2: 25, 3: 23 },
  },
];

const EXPECTED_REGIONAL_SECTIONS = [
  ["Region — France: Burgundy, Loire, Alsace, Bordeaux, Provence", 2064, "ok"],
  ["France — the UK and Australian packagers selling France", 1779, "ok"],
  [
    "France — the shared-cost support layer: who batches customers onto one van",
    992,
    "ok",
  ],
  ["France — cross-cutting patterns and seasonality", 1132, "ok"],
  [
    "France — licensing, liability, failures and the Australian read-across",
    1439,
    "ok",
  ],
  [
    "Region — Italy, Spain and Portugal: Tuscany, Piedmont, Prosecco, Puglia, Rioja, Penedès, Douro, Alentejo",
    2759,
    "ok",
  ],
  ["Spain and Portugal — the operator profiles", 2175, "ok"],
  [
    "Southern Europe — foreign inbound operators and cross-cutting commercial patterns",
    1370,
    "ok",
  ],
  [
    "Southern Europe — wine logistics, shared-cost support, and the legal frame",
    1350,
    "ok",
  ],
  [
    "Southern Europe — failures, gaps, and the three findings for Australia",
    1038,
    "ok",
  ],
  ["Region — Global majors, DACH and Canada", 1785, "ok"],
  [
    "The global majors — apps, the wine-logistics void, and who owns whom",
    1348,
    "ok",
  ],
  [
    "Germany and Austria — consolidation, exact pricing, and the Weinradweg products",
    2087,
    "ok",
  ],
  [
    "Germany and Austria — the shared-cost precedents, shuttles and wine shipping",
    1168,
    "ok",
  ],
  [
    "Canada — Niagara, and the only working wine-collection service found anywhere",
    1432,
    "ok",
  ],
  ["Canada — the Okanagan, and the one operator that prices rescue", 1500, "ok"],
  [
    "Canada — the unattended platform model, the shared-cost precedent, and the licensing position",
    841,
    "ok",
  ],
  [
    "Cross-cutting — shared-cost models, wine, wineries, accommodation and seasonality",
    655,
    "thin",
  ],
  ["Drink-cycling law, package liability, and the failures list", 1171, "ok"],
  ["The majors, DACH and Canada — explicit gaps and the bottom line", 546, "thin"],
  [
    "Region — New World: NZ, California, Oregon, South Africa, Argentina, Chile",
    1560,
    "ok",
  ],
  [
    "New World — Hawke's Bay, the richest region for the wine-logistics question",
    1074,
    "ok",
  ],
  [
    "New World — Central Otago, Queenstown, and the New Zealand ecosystem",
    2003,
    "ok",
  ],
  ["New World — California and Oregon", 2200, "ok"],
  ["New World — South Africa, Argentina and Chile", 1413, "ok"],
  [
    "New World — cross-cutting analysis and the gaps in the regional scan",
    1930,
    "ok",
  ],
  ["Aggregators And Shared-Cost Support Models", 1696, "ok"],
  [
    "Shared-cost support — the Camino, the UK paths, the Danube and rail-trail shuttles",
    1739,
    "ok",
  ],
  [
    "Wine and bike with a support van — the direct analogues and the shared shuttles",
    1523,
    "ok",
  ],
  ["Cyclist rescue subscriptions, and one Australian policy fact", 1265, "ok"],
  ["MTB uplift, sag wagons and event support", 1364, "ok"],
  [
    "Distribution — the channel findings that bite, and the gaps stated plainly",
    1722,
    "ok",
  ],
];

const PLACEHOLDER_MARKERS = [
  "NOT PUBLISHED — the idea document hit its 200,000-character platform limit",
  "Source: `research/01-france.md`",
  "Source: `research/02-italy-spain-portugal.md`",
  "Source: `research/03-majors-dach-canada.md`",
  "Source: `research/04-new-world.md`",
  "Source: `research/05-aggregators-and-shared-support.md`",
];

const EVIDENCE_MARKERS = [
  "Bourgogne Evasion / Active Tours — the same company",
  "Détours de Loire — the published shared-cost curve",
  "La Malle Postale — the scale player",
  "Puglia Cycle Tours — the richest published commercial data",
  "DuVine puts a van behind seven people",
  "Portugal Bike Tours / BTTour — the most transparent operator",
  "ADFC Pannenhilfe — a national, membership-funded, 24/7 bike rescue service",
  "Hoodoo Adventures, Penticton — the one operator that prices rescue",
  "Takaro Trails — the most complete stack",
  "Wine Country Bikes — the closest thing found anywhere",
  "GetYourGuide — explicitly refuses to publish a rate",
  "RACV Bike Assist (Victoria) — the Australian benchmark",
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
    "Usage: node scripts/cellar-door-regional-sources-check.mjs [--idea ID] [--base URL] [--source-dir DIR]",
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
const sectionByTitle = new Map(sections.map((section) => [section.title, section]));

fail(errors, sections.length === 74, `chapter count ${sections.length} !== 74`);
fail(
  errors,
  sectionsData.usage?.chapters === 74,
  `usage chapter count ${sectionsData.usage?.chapters} !== 74`,
);
fail(
  errors,
  sectionsData.usage?.chars <= 1_000_000,
  `document chars ${sectionsData.usage?.chars} exceeds 1,000,000`,
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
for (const [title, words, verdict] of EXPECTED_REGIONAL_SECTIONS) {
  const section = sectionByTitle.get(title);
  fail(errors, Boolean(section), `missing regional section: ${title}`);
  if (!section) continue;
  const position = sections.findIndex((row) => row.id === section.id);
  fail(
    errors,
    position > previousPosition,
    `regional section out of order: ${title}`,
  );
  previousPosition = position;
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

for (const marker of PLACEHOLDER_MARKERS) {
  fail(errors, !body.includes(marker), `placeholder marker still present: ${marker}`);
}

for (const marker of EVIDENCE_MARKERS) {
  fail(errors, body.includes(marker), `missing evidence marker: ${marker}`);
}

const regionalWords = EXPECTED_REGIONAL_SECTIONS.reduce(
  (sum, [, words]) => sum + words,
  0,
);
const sourceWords = SOURCE_FILES.reduce((sum, file) => sum + file.words, 0);

const summary = {
  idea: options.idea,
  source_dir: options.sourceDir,
  source_files: sourceStats,
  source_words: sourceWords,
  regional_chapters: EXPECTED_REGIONAL_SECTIONS.length,
  regional_words_live: regionalWords,
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
