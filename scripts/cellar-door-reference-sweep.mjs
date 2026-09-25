#!/usr/bin/env node
import { writeFile } from "node:fs/promises";

const DEFAULT_IDEA =
  "cellar-door-cycling-a-roving-support-van-for-wine-country-weeken";
const DEFAULT_BASE = "https://freeideastore.online";

const CHAPTERS = {
  "00": "International Synthesis — an index, not a conclusion",
  "01": "Region — France: Burgundy, Loire, Alsace, Bordeaux, Provence",
  "02":
    "Region — Italy, Spain and Portugal: Tuscany, Piedmont, Prosecco, Puglia, Rioja, Penedès, Douro, Alentejo",
  "03": "Region — Global majors, DACH and Canada",
  "04":
    "Region — New World: NZ, California, Oregon, South Africa, Argentina, Chile",
  "05": "Aggregators And Shared-Cost Support Models",
  "06": "Failures, Seasonality And Regulation",
  "07": "Audit And Corrections — read this before acting on any number",
};

const FILES = {
  "../README.md": "the idea spine (**Overview** through **Evolution**)",
  "../CRITIQUE.md":
    "**The Case Against — the critique and the wedge that survives it**",
  "../RESEARCH-precedent.md":
    "**Precedent Hunt — does the roving shared van exist anywhere?**",
  "RESEARCH-precedent.md":
    "**Precedent Hunt — does the roving shared van exist anywhere?**",
  "../RESEARCH-routes.md":
    "**Route Survey — which trails can actually carry this**",
  "RESEARCH-routes.md":
    "**Route Survey — which trails can actually carry this**",
  "../RESEARCH-van-economics.md":
    "**Van Economics — what shared support vehicles cost and sell for**",
  "RESEARCH-van-economics.md":
    "**Van Economics — what shared support vehicles cost and sell for**",
  "../RESEARCH-distribution.md":
    "**Distribution And Take Rates — channels, OTA fees, payout terms**",
  "RESEARCH-distribution.md":
    "**Distribution And Take Rates — channels, OTA fees, payout terms**",
  "FINANCIALS.md":
    "**Financial Model And P&L — break-even, funding, and the insurance hole**",
  "research/README.md":
    "**International Scan — method, evidence tags, and its limits**",
};

for (const [code, title] of Object.entries(CHAPTERS)) {
  FILES[`research/${codeTitleFile(code)}`] = `**${title}**`;
  FILES[codeTitleFile(code)] = `**${title}**`;
}

function codeTitleFile(code) {
  return {
    "00": "00-synthesis.md",
    "01": "01-france.md",
    "02": "02-italy-spain-portugal.md",
    "03": "03-majors-dach-canada.md",
    "04": "04-new-world.md",
    "05": "05-aggregators-and-shared-support.md",
    "06": "06-failures-seasonality-regulation.md",
    "07": "07-audit-and-corrections.md",
  }[code];
}

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
    "Usage: node scripts/cellar-door-reference-sweep.mjs [--check] [--write OUTPUT.md] [--idea ID] [--base URL]",
  );
  process.exit(2);
}

async function fetchBody(options) {
  const url = new URL(`/api/ideas/${options.idea}`, options.base);
  url.searchParams.set("body", "full");
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`GET ${url} failed: HTTP ${response.status}`);
  }
  const data = await response.json();
  if (!data.body || typeof data.body !== "string") {
    throw new Error(`GET ${url} returned no markdown body`);
  }
  return data.body;
}

function replaceRefs(body) {
  let replacements = 0;
  const next = body.replace(/`([^`\n]+)`/g, (match, token) => {
    const code = token.match(/^0[0-7]$/);
    if (code) {
      replacements += 1;
      return `**${CHAPTERS[token]}**`;
    }
    const file = FILES[token];
    if (file) {
      replacements += 1;
      return file;
    }
    return match;
  });
  return { body: next, replacements };
}

function residuals(body) {
  const fileNames = Object.keys(FILES).map(escapeRegex).join("|");
  const filePattern = new RegExp(`\`(?:${fileNames})\``, "g");
  const codePattern = /`0[0-7]`/g;
  return {
    codes: count(body, codePattern),
    filenames: count(body, filePattern),
  };
}

function count(body, pattern) {
  return [...body.matchAll(pattern)].length;
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const options = parseArgs(process.argv.slice(2));
const before = await fetchBody(options);
const beforeResiduals = residuals(before);
const transformed = replaceRefs(before);
const afterResiduals = residuals(transformed.body);
const summary = {
  idea: options.idea,
  before: beforeResiduals,
  replacements: transformed.replacements,
  after: afterResiduals,
};

if (options.mode === "write") {
  await writeFile(options.write, transformed.body);
  summary.wrote = options.write;
}

console.log(JSON.stringify(summary, null, 2));

if (afterResiduals.codes || afterResiduals.filenames) {
  process.exit(1);
}
