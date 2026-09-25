#!/usr/bin/env node

const DEFAULT_IDEA =
  "cellar-door-cycling-a-roving-support-van-for-wine-country-weeken";
const DEFAULT_BASE = "https://freeideastore.online";

const FRANCE_TITLE =
  "Region — France: Burgundy, Loire, Alsace, Bordeaux, Provence";
const ITALY_SPAIN_PORTUGAL_PREFIX = "Region — Italy, Spain and Portugal";
const ITALY_SPAIN_PORTUGAL_TITLE =
  "Region — Italy, Spain and Portugal: Tuscany, Piedmont, Prosecco, Puglia, Rioja, Penedès, Douro, Alentejo";
const GLOBAL_TITLE = "Region — Global majors, DACH and Canada";

const MISPLACED_NOTICE_MARKERS = [
  "research/02-italy-spain-portugal.md",
  "8,695 words on Tuscany, Piedmont, Prosecco, Puglia, Rioja, Penedès, Douro and Alentejo",
  "NOT PUBLISHED — the idea document hit its 200,000-character platform limit",
];

function parseArgs(argv) {
  const options = { idea: DEFAULT_IDEA, base: DEFAULT_BASE };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--idea") options.idea = requiredValue(argv, ++i, arg);
    else if (arg === "--base") options.base = requiredValue(argv, ++i, arg);
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
    "Usage: node scripts/cellar-door-italy-spain-portugal-check.mjs [--idea ID] [--base URL]",
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

async function readSection(options, section) {
  const data = await fetchJson(
    options,
    `/api/ideas/${options.idea}/sections/${encodeURIComponent(section.id)}`,
  );
  if (!data.markdown || typeof data.markdown !== "string") {
    throw new Error(`section ${section.id} returned no markdown`);
  }
  return data.markdown;
}

function findSection(sections, title) {
  return sections.find((section) => section.title === title);
}

function sectionPosition(sections, section) {
  return sections.findIndex((row) => row.id === section.id);
}

function italyReferencesResolve(body, sections) {
  const existingTitles = new Set(sections.map((section) => section.title));
  const references = [
    ...body.matchAll(/\*\*(Region — Italy, Spain and Portugal(?::[^*]+)?)\*\* chapter/g),
  ].map((match) => match[1]);
  const unresolved = references.filter(
    (title) =>
      !existingTitles.has(title) &&
      !sections.some((section) => section.title.startsWith(title)),
  );
  return { references, unresolved };
}

function assert(condition, message, errors) {
  if (!condition) errors.push(message);
}

const options = parseArgs(process.argv.slice(2));
const errors = [];

const sectionsData = await fetchJson(options, `/api/ideas/${options.idea}/sections`);
const bodyData = await fetchJson(options, `/api/ideas/${options.idea}`, {
  body: "full",
});

const sections = sectionsData.sections || [];
const body = bodyData.body;
if (!body || typeof body !== "string") {
  throw new Error("idea response returned no markdown body");
}

const france = findSection(sections, FRANCE_TITLE);
const italy = findSection(sections, ITALY_SPAIN_PORTUGAL_TITLE);
const global = findSection(sections, GLOBAL_TITLE);

assert(france, `missing section: ${FRANCE_TITLE}`, errors);
assert(italy, `missing section: ${ITALY_SPAIN_PORTUGAL_TITLE}`, errors);
assert(global, `missing section: ${GLOBAL_TITLE}`, errors);

let franceMarkdown = "";
if (france) franceMarkdown = await readSection(options, france);

for (const marker of MISPLACED_NOTICE_MARKERS) {
  assert(
    !franceMarkdown.includes(marker),
    `France section still contains misplaced marker: ${marker}`,
    errors,
  );
}

if (france && italy && global) {
  const francePosition = sectionPosition(sections, france);
  const italyPosition = sectionPosition(sections, italy);
  const globalPosition = sectionPosition(sections, global);
  assert(
    francePosition < italyPosition && italyPosition < globalPosition,
    "regional order must be France, then Italy/Spain/Portugal, then Global majors",
    errors,
  );
}

const refs = italyReferencesResolve(body, sections);
assert(
  refs.references.length >= 2,
  `expected at least 2 Italy/Spain/Portugal chapter references, found ${refs.references.length}`,
  errors,
);
assert(
  refs.unresolved.length === 0,
  `unresolved Italy/Spain/Portugal chapter references: ${refs.unresolved.join(", ")}`,
  errors,
);

const summary = {
  idea: options.idea,
  sections: sections.length,
  france: france && { id: france.id, words: france.words },
  italy_spain_portugal: italy && { id: italy.id, words: italy.words },
  global: global && { id: global.id, words: global.words },
  italy_references: refs.references.length,
  unresolved_italy_references: refs.unresolved,
  ok: errors.length === 0,
  errors,
};

console.log(JSON.stringify(summary, null, 2));
if (errors.length) process.exit(1);
