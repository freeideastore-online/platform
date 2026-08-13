import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const MIGRATIONS_DIR = join(import.meta.dirname, '..', 'migrations');

/**
 * Migrations whose numeric prefix collides with another file, and which are
 * already applied in production. They cannot be renumbered: `wrangler d1
 * migrations apply` keys the `d1_migrations` ledger on the FULL FILENAME, so
 * renaming an applied migration makes wrangler treat it as new and re-run it —
 * and `ALTER TABLE ... DROP COLUMN` is not idempotent, so the re-run fails and
 * blocks every later migration behind it.
 *
 * This pair arrived from two pull requests developed in parallel on the same
 * afternoon (#85 profile claims, #89 drop render_key). Both applied cleanly
 * because they are independent and wrangler tracks them separately — the
 * collision is a readability and review hazard, not a data one. It is
 * grandfathered here rather than fixed, and the assertion below stops the next
 * one.
 */
const GRANDFATHERED_DUPLICATE_PREFIXES = new Set(['0018']);

function migrationFiles() {
  return readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith('.sql'))
    .sort();
}

describe('migration filenames', () => {
  it('never reuses a numeric prefix', () => {
    const byPrefix = new Map<string, string[]>();
    for (const file of migrationFiles()) {
      const prefix = file.slice(0, 4);
      byPrefix.set(prefix, [...(byPrefix.get(prefix) ?? []), file]);
    }

    const collisions = [...byPrefix.entries()]
      .filter(([prefix, files]) => files.length > 1 && !GRANDFATHERED_DUPLICATE_PREFIXES.has(prefix))
      .map(([prefix, files]) => `${prefix}: ${files.join(', ')}`);

    // Two migrations sharing a prefix are applied in lexicographic order of the
    // full filename, which is not the order either author intended and is not
    // visible in review. If they are order-dependent the second one silently
    // wins or fails on deploy, after the first has already committed.
    expect(collisions).toEqual([]);
  });

  it('numbers migrations contiguously from 0001', () => {
    const prefixes = [...new Set(migrationFiles().map((file) => file.slice(0, 4)))]
      .map(Number)
      .sort((a, b) => a - b);

    expect(prefixes[0]).toBe(1);
    // A gap means a migration was deleted after being applied somewhere, which
    // leaves environments permanently divergent — the ledger keeps the row and
    // no file can ever satisfy it again.
    expect(prefixes).toEqual(prefixes.map((_, index) => index + 1));
  });

  it('grandfathered prefixes are actually still duplicated', () => {
    // If someone does renumber the pair safely (a fresh database, or a paired
    // ledger edit), this fails and the exception should be deleted rather than
    // left to excuse a future collision.
    const prefixes = migrationFiles().map((file) => file.slice(0, 4));
    for (const grandfathered of GRANDFATHERED_DUPLICATE_PREFIXES) {
      expect(prefixes.filter((prefix) => prefix === grandfathered).length).toBeGreaterThan(1);
    }
  });
});
