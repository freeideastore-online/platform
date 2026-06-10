import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const publicBase = 'https://freeideastore.serge-the-dev.workers.dev';
const registryPath = path.join(root, 'store', 'registry.json');

const chapters = [
  ['snapshot', 'Snapshot', 'What is the idea, who is it for, and what is the current maturity signal?'],
  ['brainstorming', 'Brainstorming', 'Raw thinking, variants, discarded angles, and why this idea deserves attention.'],
  ['problem-customer', 'Problem And Customer', 'Customer, problem frequency, pain level, current workaround, and buyer/user split.'],
  ['research', 'Research', 'Public sources, competitor notes, market signals, evidence requests, and unknowns.'],
  ['design', 'Design', 'Workflow sketch, information architecture, UX notes, system shape, and edge cases.'],
  ['prototype', 'Prototype', 'Smallest useful prototype, build scope, demo path, and test data required.'],
  ['validation', 'Validation', 'How to prove, pivot, park, or trash the idea with the least effort.'],
  ['open-questions', 'Open Questions', 'Questions that block confidence or need specialist input.'],
  ['contribute', 'Contribute', 'Useful contribution prompts for researchers, builders, designers, operators, and critics.'],
];

function usage() {
  return `Usage:
  pnpm idea:new -- --title "Idea Name" --summary "One sentence" [options]

Options:
  --slug <slug>          Defaults from title
  --stage <stage>        raw | critique | researched | pivot | prototype | built
  --category <category>  Defaults to uncategorized
  --signal <text>        Store card signal
  --preview <text>       Store card preview
  --next-step <text>     Next validation step
  --risk <text>          Main risk
  --sections <a,b,c>     Store card tags
  --dry-run              Print what would be created
`;
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i];
    if (item === '--') continue;
    if (!item.startsWith('--')) continue;
    const key = item.slice(2);
    if (key === 'dry-run') {
      args[key] = true;
    } else {
      args[key] = argv[i + 1];
      i += 1;
    }
  }
  return args;
}

function slugify(input) {
  return String(input || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 72);
}

function escapeToml(value) {
  return String(value || '').replaceAll('\\', '\\\\').replaceAll('"', '\\"');
}

async function exists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function chapterMarkdown(title, summary, prompt) {
  return `---
title: ${title}
summary: ${summary}
---

# ${title}

${prompt}
`;
}

const args = parseArgs(process.argv.slice(2));
if (!args.title || !args.summary) {
  console.error(usage());
  process.exit(1);
}

const title = args.title.trim();
const slug = slugify(args.slug || title);
const summary = args.summary.trim();
const stage = (args.stage || 'raw').trim();
const category = (args.category || 'uncategorized').trim();
const signal = (args.signal || summary).trim();
const preview = (args.preview || summary).trim();
const nextStep = (args['next-step'] || 'Define the first validation step.').trim();
const risk = (args.risk || 'Main risk not yet identified.').trim();
const docsSections = (args.sections || 'brainstorming,research,prototype')
  .split(',')
  .map((item) => item.trim())
  .filter(Boolean)
  .slice(0, 5);

if (!slug) {
  console.error('Could not derive slug.');
  process.exit(1);
}

const bookDir = path.join(root, 'idea-books', slug);
if (await exists(bookDir)) {
  console.error(`Idea book already exists: idea-books/${slug}`);
  process.exit(1);
}

const registry = JSON.parse(await readFile(registryPath, 'utf8'));
if ((registry.ideas || []).some((idea) => idea.id === slug)) {
  console.error(`Registry already contains idea: ${slug}`);
  process.exit(1);
}

const files = new Map();
files.set(
  path.join(bookDir, 'zensical.toml'),
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
  path.join(bookDir, 'docs', 'index.md'),
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

for (const [file, chapterTitle, prompt] of chapters) {
  files.set(path.join(bookDir, 'docs', `${file}.md`), chapterMarkdown(chapterTitle, summary, prompt));
}

const registryIdea = {
  id: slug,
  name: title,
  stage,
  category,
  signal,
  preview,
  docsUrl: `/ideas/${slug}/`,
  docsSections,
  nextStep,
  contributors: 0,
  support: 0,
  risk,
};

if (args['dry-run']) {
  console.log(JSON.stringify({ bookDir: `idea-books/${slug}`, files: [...files.keys()].map((file) => path.relative(root, file)), registryIdea }, null, 2));
  process.exit(0);
}

for (const [file, content] of files) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, content);
}

registry.ideas.push(registryIdea);
if (!registry.stages.includes(stage)) registry.stages.push(stage);
if (!registry.categories.includes(category)) registry.categories.push(category);
await writeFile(registryPath, `${JSON.stringify(registry, null, 2)}\n`);

console.log(`Created idea book: idea-books/${slug}`);
console.log(`Next: pnpm docs:build`);
