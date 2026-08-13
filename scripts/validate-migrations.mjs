#!/usr/bin/env node
import { readdirSync } from "node:fs";

/**
 * Migration filenames are a shared namespace that no single pull request can
 * see. Two PRs developed in parallel both claimed 0018 (#85 profile claims,
 * #89 drop render_key) and neither diff showed the other's filename.
 *
 * This lives in scripts/ rather than a vitest file because the worker package
 * types are pinned to @cloudflare/workers-types and cannot import node:fs.
 */
const root = new URL("../", import.meta.url);
const dir = new URL("packages/worker/migrations/", root);

/**
 * Already applied in production, so it cannot be renumbered: `wrangler d1
 * migrations apply` keys its ledger on the FULL FILENAME. Renaming an applied
 * migration makes wrangler treat it as new and re-run it, and
 * `ALTER TABLE ... DROP COLUMN` is not idempotent — the re-run fails and blocks
 * every later migration behind it.
 */
const GRANDFATHERED = new Set(["0018"]);

const files = readdirSync(dir).filter((name) => name.endsWith(".sql")).sort();
const errors = [];

const byPrefix = new Map();
for (const file of files) {
  const prefix = file.slice(0, 4);
  byPrefix.set(prefix, [...(byPrefix.get(prefix) ?? []), file]);
}

for (const [prefix, group] of byPrefix) {
  if (group.length > 1 && !GRANDFATHERED.has(prefix)) {
    // Two migrations sharing a prefix apply in lexicographic order of the full
    // filename — not the order either author intended, and not visible in
    // review. If they are order-dependent the second silently wins or fails on
    // deploy, after the first has already committed.
    errors.push(`duplicate migration prefix ${prefix}: ${group.join(", ")}`);
  }
}

for (const prefix of GRANDFATHERED) {
  const count = files.filter((file) => file.startsWith(prefix)).length;
  if (count <= 1) {
    // If the pair is ever legitimately renumbered, delete the exception rather
    // than leaving it to excuse the next collision.
    errors.push(`grandfathered prefix ${prefix} is no longer duplicated — remove it from GRANDFATHERED`);
  }
}

const numbers = [...byPrefix.keys()].map(Number).sort((a, b) => a - b);
numbers.forEach((value, index) => {
  // A gap means a migration was deleted after being applied somewhere, which
  // leaves environments permanently divergent: the ledger keeps the row and no
  // file can ever satisfy it again.
  if (value !== index + 1) errors.push(`migration numbering is not contiguous at ${String(value).padStart(4, "0")}`);
});

if (errors.length) {
  console.error("migration filename check failed:");
  for (const error of errors) console.error(`  - ${error}`);
  process.exit(1);
}
console.log(`migrations ok: ${files.length} files, contiguous 0001-${String(numbers.at(-1)).padStart(4, "0")}`);
