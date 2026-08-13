export const JSON_HEADERS = {
  'Content-Type': 'application/json;charset=UTF-8',
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
};

export const SECURITY_HEADERS: Record<string, string> = {
  'Content-Security-Policy':
    "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' https:; connect-src 'self'; frame-ancestors 'self'; base-uri 'self'; form-action 'self'",
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'SAMEORIGIN',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
};

export function json(data: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: { ...JSON_HEADERS, ...SECURITY_HEADERS, ...(init.headers || {}) },
  });
}

export function htmlResponse(page: string, init: ResponseInit = {}) {
  return new Response(page, {
    ...init,
    headers: {
      ...SECURITY_HEADERS,
      'Content-Type': 'text/html;charset=UTF-8',
      'Cache-Control': 'public, max-age=60',
      ...(init.headers || {}),
    },
  });
}

export function bad(message: string, status = 400) {
  return json({ error: message }, { status });
}

/**
 * Field length limits.
 *
 * These are enforced by rejecting the write, never by truncating it. Silent
 * `.slice()` on the way into D1 destroyed the tail of four contributions on the
 * gapfill idea — the writes returned 201 and the text was unrecoverable.
 */
export const FIELD_LIMITS = {
  title: 80,
  summary: 1000,
  preview: 1000,
  signal: 1000,
  sourceUrl: 500,
  category: 60,
  nextStep: 500,
  risk: 500,
  // FREE-TIER document ceilings. Bodies live in R2, not a D1 column value, so
  // neither number is inherited from a storage constraint — the database never
  // bound this, and section-level writes already removed the request-size
  // ceiling that once did. These are a product decision: the free store holds a
  // quick idea and a normal research pass; a corpus the size of a book belongs
  // on Pro.
  //
  // The two are chosen TOGETHER, and may not be changed independently. A char
  // cap and a chapter cap imply a mean chapter size:
  //
  //   implied mean words per chapter = body / chapters / ~6.5 chars-per-word
  //   1_000_000 / 100 / 6.5 ≈ 1_538 words
  //
  // 1,538 sits in the middle of the CHAPTER_SIZE target band (800–3,000), so an
  // author who spends the whole chapter allowance writes chapters
  // chapterHealth() calls `ok` — not merely above the floor. The previous
  // 200_000 implied 308 words per chapter, BELOW floorWords (500), which made
  // the two limits mutually unsatisfiable: the platform asked for 800-word
  // chapters on a budget that only paid for 308. limits.test.ts asserts the
  // rule so this cannot regress.
  //
  // Why this is safe to set this high: the ceiling that used to justify 200_000
  // was cited in this comment as `MAX_BODY_BYTES`, a constant that does not
  // exist anywhere in the codebase. Bodies are in R2 and section writes keep
  // individual requests small, so the real remaining constraint is RENDER cost
  // — which is why idea-home-page.ts no longer inlines the whole body once a
  // document is paginated.
  body: 1_000_000,
  /** Free-tier chapter ceiling. Also near the practical limit of a FLAT chapter
   * list — `###` are in-page anchors, so there is no level above the chapter to
   * navigate by, and a few hundred entries stop being a table of contents. */
  chapters: 100,
  contribution: 8000,
  contributionKind: 40,
  claim: 300,
} as const;

/**
 * Returns a message describing the first over-limit field, or null when every
 * field fits. Callers pass the caller-facing field name so the error tells the
 * author what to shorten and by how much.
 */
export function tooLong(fields: Array<[name: string, value: string, limit: number]>) {
  for (const [name, value, limit] of fields) {
    if (value.length > limit) {
      return `${name} is ${value.length} characters; the limit is ${limit}`;
    }
  }
  return null;
}

export function id(prefix: string) {
  return `${prefix}-${crypto.randomUUID()}`;
}

export function slug(input: string) {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}

export function pathId(input: string) {
  try {
    const decoded = decodeURIComponent(input);
    return /^[a-z0-9][a-z0-9-]{0,80}$/.test(decoded) ? decoded : '';
  } catch {
    return '';
  }
}

export function escapeHtml(value: unknown) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function clampInt(value: string | null, fallback: number, min: number, max: number) {
  if (value === null || value.trim() === '') return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(parsed)));
}

export function enumValue(value: unknown, allowed: Set<string>, fallback: string) {
  const normalized = slug(String(value || ''));
  return allowed.has(normalized) ? normalized : fallback;
}

/**
 * Ceiling on a single request, measured in CHARACTERS of the decoded body.
 *
 * It has to sit above FIELD_LIMITS.body rather than at it: a whole-document
 * write is the body plus a JSON envelope, and JSON only ever makes the payload
 * longer. Every `"` and `\` becomes two characters, every newline in the
 * markdown becomes the two characters `\n`, and a control character becomes the
 * six characters `\u0000`. A document at the body limit therefore arrives as
 * strictly more than FIELD_LIMITS.body characters, so a request ceiling EQUAL
 * to the body limit would reject the largest document the body limit permits —
 * with a 413 that names a different number than the one the author was told to
 * write to.
 *
 * Doubling is the headroom: markdown runs roughly 2-4% escapable characters
 * (mostly newlines), so 2x covers the envelope, the other fields, and a wide
 * margin of quote-heavy prose, while still bounding what one call can cost.
 * Derived from FIELD_LIMITS.body so the two cannot drift apart again.
 */
export const MAX_REQUEST_CHARS = FIELD_LIMITS.body * 2;

/**
 * The same ceiling expressed in BYTES, for the `content-length` pre-check.
 *
 * `content-length` counts UTF-8 bytes; MAX_REQUEST_CHARS counts UTF-16 code
 * units. They are not the same quantity, and comparing one against the other
 * silently shrinks the real limit for any document that is not pure ASCII: `§`
 * costs 2 bytes, `—` 3, `⚠️` 6, so a document of section marks and em dashes
 * would be rejected at a third of the characters it is allowed. Research bodies
 * in this corpus are full of exactly those characters.
 *
 * So the byte check uses the UTF-8 worst case — 4 bytes per character — which
 * makes it a cheap early-out on an unverified header that can never reject a
 * payload the authoritative character check below would accept.
 */
export const MAX_REQUEST_BYTES = MAX_REQUEST_CHARS * 4;

export type JsonBodyResult =
  | { ok: true; data: Record<string, unknown> }
  | { ok: false; response: Response };

/**
 * Parses a JSON request body, distinguishing "too large" and "malformed" from
 * "absent".
 *
 * The previous version returned `{}` for all three, so an oversized or broken
 * payload surfaced as whatever validation error came next — for createIdea that
 * was "title and summary are required", which sent the caller looking in
 * entirely the wrong place. Same silent-failure family as the truncation in #1.
 */
export async function readJsonBody(request: Request): Promise<JsonBodyResult> {
  // A byte header compared against a byte limit. See MAX_REQUEST_BYTES for why
  // this is deliberately not MAX_REQUEST_CHARS.
  const declared = Number(request.headers.get('content-length') || '0');
  if (Number.isFinite(declared) && declared > MAX_REQUEST_BYTES) {
    return {
      ok: false,
      response: bad(`request body is ${declared} bytes; the limit is ${MAX_REQUEST_BYTES} bytes`, 413),
    };
  }

  let text: string;
  try {
    text = await request.text();
  } catch {
    return { ok: false, response: bad('could not read the request body', 400) };
  }
  if (text.length > MAX_REQUEST_CHARS) {
    return {
      ok: false,
      response: bad(
        `request body is ${text.length} characters; the limit is ${MAX_REQUEST_CHARS} characters` +
          ` (a whole document is at most ${FIELD_LIMITS.body}, plus its JSON envelope)`,
        413,
      ),
    };
  }
  // An absent body is legitimate: several endpoints take no fields.
  if (!text.trim()) return { ok: true, data: {} };

  try {
    const parsed = JSON.parse(text) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { ok: false, response: bad('request body must be a JSON object', 400) };
    }
    return { ok: true, data: parsed as Record<string, unknown> };
  } catch {
    return { ok: false, response: bad('request body is not valid JSON', 400) };
  }
}
