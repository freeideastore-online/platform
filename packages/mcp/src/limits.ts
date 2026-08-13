/**
 * The write-size limits the MCP schemas declare to callers.
 *
 * These are a DELIBERATE DUPLICATION of the worker's `FIELD_LIMITS.body`
 * (`packages/worker/src/http.ts`). `@fis/mcp` is a separate Cloudflare Worker
 * with its own bundle and no dependency on `@fis/worker`, so it cannot import
 * the constant; `limits.test.ts` reads the worker source and pins DOCUMENT_CHARS
 * to it, which is what stops the two drifting apart the way the old hard-coded
 * `200000` did.
 *
 * The point of naming them at all is #46: six schemas carried a stale `200000`
 * literal and a seventh carried no cap, because the number was written out
 * seven times and updated in none of them.
 */

/**
 * A whole document, matching the server's free-tier body ceiling exactly.
 *
 * Only the three whole-document fields use this — `create_free_idea.body`,
 * `derive_idea.body`, `publish_idea_update.body` — because for them the
 * per-call cap and the document budget genuinely ARE the same number: the call
 * replaces the entire document.
 */
export const DOCUMENT_CHARS = 1_000_000;

/**
 * One section write.
 *
 * Deliberately and visibly smaller than DOCUMENT_CHARS. A per-call field
 * declaring the whole document budget is the original bug in #46 at a bigger
 * number: three agents read `max(200000)` on `patch_idea_section.content` as
 * the section's allowance when it was the allowance for everything, discovered
 * the truth by overflowing, and one document shipped missing its P&L.
 *
 * A tenth of the budget is roughly six times the mean chapter implied by the
 * server's own pairing of limits (1,000,000 chars / 100 chapters), so it is
 * generous for any single chapter while staying obviously not the whole
 * document.
 */
export const SECTION_CHARS = DOCUMENT_CHARS / 10;

/** Thousands separators without depending on the runtime's Intl data. */
const grouped = (value: number) => value.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");

/** Appended to every per-call `content` field, so the scope is stated and not inferred. */
export const SECTION_LIMIT_NOTE =
  `This is a PER-CALL limit (${grouped(SECTION_CHARS)} characters), not the document budget:` +
  ` the whole document may hold ${grouped(DOCUMENT_CHARS)} characters across all sections, and every write` +
  ` is checked against what the document already spends. Read \`usage\` on any get_idea or` +
  ` list_idea_sections response for the headroom left.`;

/** Stated on the three whole-document fields, where per-call and budget coincide. */
export const DOCUMENT_LIMIT_NOTE =
  `The free-tier document ceiling is ${grouped(DOCUMENT_CHARS)} characters and this call replaces the whole document,` +
  ` so this cap and the document budget are the same number.`;
