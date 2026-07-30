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
  // Bodies live in R2, not a D1 column value, so depth is not limited by the
  // database. The remaining ceiling is the JSON request itself (MAX_BODY_BYTES);
  // section-level writes lift that for incremental deepening.
  body: 200_000,
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
 * Ceiling on a single request. Comfortably above FIELD_LIMITS.body so a full
 * document write fits, while still bounding what one call can cost.
 */
export const MAX_REQUEST_CHARS = 1_000_000;

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
  const declared = Number(request.headers.get('content-length') || '0');
  if (Number.isFinite(declared) && declared > MAX_REQUEST_CHARS) {
    return {
      ok: false,
      response: bad(`request body is ${declared} bytes; the limit is ${MAX_REQUEST_CHARS}`, 413),
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
      response: bad(`request body is ${text.length} characters; the limit is ${MAX_REQUEST_CHARS}`, 413),
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
