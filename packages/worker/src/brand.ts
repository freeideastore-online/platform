/**
 * Single source of truth for FreeIdeaStore branding.
 *
 * Before this existed the mark was the literal string "FI" hardcoded into seven
 * page modules, the `.logo` CSS was copy-pasted into four, and two of the most
 * visited pages (idea home and idea chapters) carried no favicon link at all.
 * Changing the brand meant finding every copy and hoping.
 *
 * Everything visual that says "this is FreeIdeaStore" belongs here.
 */

export const BRAND = {
  name: 'FreeIdeaStore',
  /** Used in <title> suffixes and anywhere the full name is too long. */
  short: 'FIS',
  tagline: 'Ideas, researched in the open',
  colors: {
    ink: '#102027',
    spark: '#67e8f9',
    accent: '#f59e0b',
    paper: '#ffffff',
  },
} as const;

/**
 * The mark. Deliberately NOT initials — a glyph reads at 16px where "FI" does
 * not, and it is the same artwork as the favicon so the tab and the header
 * agree. Reads as a document with a spark: research, plus the idea.
 */
export function brandMark(size = 34): string {
  const { ink, spark, accent, paper } = BRAND.colors;
  return `<svg class="brand-mark" width="${size}" height="${size}" viewBox="0 0 512 512" role="img" aria-label="${BRAND.name}" focusable="false">
<rect width="512" height="512" rx="88" fill="${ink}"/>
<path d="M116 142h280v54H116z" fill="${spark}"/>
<path d="M116 229h210v54H116z" fill="${paper}"/>
<path d="M116 316h154v54H116z" fill="${accent}"/>
<path d="M378 224l42 32-42 32-42-32z" fill="${spark}"/>
<circle cx="398" cy="142" r="24" fill="${accent}"/>
</svg>`;
}

/** The favicon, as markup for `store/favicon.svg`. Same artwork as `brandMark`. */
export function faviconSvg(): string {
  const { ink, spark, accent, paper } = BRAND.colors;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="88" fill="${ink}"/>
  <path d="M116 142h280v54H116z" fill="${spark}"/>
  <path d="M116 229h210v54H116z" fill="${paper}"/>
  <path d="M116 316h154v54H116z" fill="${accent}"/>
  <path d="M378 224l42 32-42 32-42-32z" fill="${spark}"/>
  <circle cx="398" cy="142" r="24" fill="${accent}"/>
</svg>
`;
}

/**
 * Head tags every page needs. Previously only four of six page modules linked a
 * favicon, so idea pages showed the browser's default globe.
 */
export function brandHead(): string {
  return `<link rel="icon" type="image/svg+xml" href="/favicon.svg">
<link rel="apple-touch-icon" href="/favicon.svg">
<meta name="theme-color" content="${BRAND.colors.ink}">`;
}

/**
 * The clickable brand lockup for a page header: mark plus wordmark, linking home.
 * `compact` drops the wordmark, for the reading views where the document title
 * takes the space instead.
 */
export function brandLockup(options: { compact?: boolean; size?: number } = {}): string {
  const { compact = false, size = 34 } = options;
  const label = compact ? ` aria-label="${BRAND.name}"` : '';
  const word = compact ? '' : `<span class="brand-word">${BRAND.name}</span>`;
  return `<a href="/" class="brand"${label}>${brandMark(size)}${word}</a>`;
}

/** Shared brand CSS. Replaces four near-identical copies of `.logo`. */
export function brandCss(): string {
  return `.brand{display:flex;align-items:center;gap:.6rem;font-weight:900;color:inherit;text-decoration:none}
.brand-mark{display:block;flex:0 0 auto;border-radius:8px}
.brand-word{white-space:nowrap}
@media(max-width:520px){.brand-word{display:none}}`;
}
