/**
 * Running D1 writes in as few round trips as the platform allows.
 *
 * A Worker gets a bounded number of subrequests per request, and every awaited
 * `.run()` is one of them. The post-write re-index used to spend one subrequest
 * per statement: on the live `cellar-door-cycling` document — 64 chapters, 127
 * URL citations over 120 distinct sources — that was 447 sequential round trips
 * *after* the body had already committed. `batch()` sends a list of statements
 * in a single round trip, which brings the same work down to single digits.
 */

/**
 * D1 allows at most 100 bound parameters in one statement, so a `WHERE … IN (…)`
 * over an arbitrary list has to be asked in chunks. Kept below the ceiling so a
 * caller can add a parameter of its own without tripping it.
 */
export const MAX_BOUND_PARAMS = 90;

/**
 * How many statements go into one batch.
 *
 * A batch is one round trip, so bigger is cheaper — but it is also one payload
 * and one implicit transaction, and an unbounded document should not turn into
 * an unbounded request.
 */
const MAX_BATCH_STATEMENTS = 100;

/**
 * How much statement *content* goes into one batch.
 *
 * Search rows carry the full markdown of a chapter, so statement count alone is
 * a poor proxy for batch size: a hundred chapters of a million-character
 * document would be one enormous request. Callers that bind large text declare
 * its size and the batch is cut on whichever limit is reached first.
 */
const MAX_BATCH_CHARS = 400_000;

/** A statement plus the size of any large text it binds. */
export type SizedStatement = { statement: D1PreparedStatement; chars?: number };

/** Splits a list into runs of at most `size`. */
export function chunk<T>(items: readonly T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

/**
 * Runs statements in order, batched.
 *
 * Statements inside a batch run in the order given, so a `DELETE` that has to
 * precede the rows replacing it can simply be first in the list. Returns the
 * number of round trips taken, which is what the batching tests assert on —
 * the point of this function is the count, so the count is observable.
 */
export async function runInBatches(db: D1Database, statements: readonly SizedStatement[]): Promise<number> {
  let roundTrips = 0;
  let pending: D1PreparedStatement[] = [];
  let pendingChars = 0;

  const flush = async () => {
    if (!pending.length) return;
    await db.batch(pending);
    roundTrips += 1;
    pending = [];
    pendingChars = 0;
  };

  for (const { statement, chars = 0 } of statements) {
    // Flush before adding, so a single oversized statement still goes out on
    // its own rather than being dropped or silently merged.
    if (pending.length && (pending.length >= MAX_BATCH_STATEMENTS || pendingChars + chars > MAX_BATCH_CHARS)) {
      await flush();
    }
    pending.push(statement);
    pendingChars += chars;
  }
  await flush();
  return roundTrips;
}
