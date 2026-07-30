import { escapeHtml } from './http';
import type { IdeaContributionRow } from './types';

/**
 * Contributions come in seven kinds. `comment` is a conversation and belongs in the
 * comment thread; every other kind is the research record behind the idea and is
 * rendered here, server-side, so it is readable without JS and indexable.
 */
const COMMENT_KIND = 'comment';

/**
 * How a claim came to be known. Borrowed from the gapfill document, which had to
 * spell this vocabulary out in prose because the schema could not hold it.
 *
 * The distinction is the point: an inferred claim must not be displayed as though
 * it were confirmed.
 */
export const PROVENANCE_VALUES = new Set([
  'extracted',
  'derived',
  'inferred',
  'human-asserted',
  'confirmed',
]);

export const CONFIDENCE_VALUES = new Set(['low', 'medium', 'high']);

/**
 * Cap on contributions fetched for the page. Bodies are inlined, so this bounds
 * both the D1 read and the HTML size on a public route. When the cap is hit the
 * section says so and points at the JSON API for the remainder.
 */
export const RESEARCH_RENDER_CAP = 100;

const KIND_GROUPS: Array<{ kind: string; title: string; blurb: string }> = [
  { kind: 'evidence', title: 'Evidence', blurb: 'Sources, findings, and competitor scans.' },
  { kind: 'risk', title: 'Risks', blurb: 'Reasons this could fail.' },
  { kind: 'kill-signal', title: 'Kill signals', blurb: 'Findings that would end the idea.' },
  { kind: 'pivot', title: 'Pivots', blurb: 'Alternative shapes worth testing.' },
  { kind: 'prototype', title: 'Prototype notes', blurb: 'What to build first, and how to test it.' },
  { kind: 'refinement', title: 'Proposed refinements', blurb: 'Proposals, not yet merged into the document above.' },
];

const KIND_ORDER = new Map(KIND_GROUPS.map((group, index) => [group.kind, index]));

export function normaliseKind(value: unknown) {
  return String(value || '').trim().toLowerCase() || COMMENT_KIND;
}

export function isResearchKind(value: unknown) {
  return normaliseKind(value) !== COMMENT_KIND;
}

export function splitContributions(contributions: IdeaContributionRow[]) {
  const research: IdeaContributionRow[] = [];
  let comments = 0;
  for (const item of contributions) {
    if (isResearchKind(item.kind)) research.push(item);
    else comments += 1;
  }
  return { research, comments };
}

function formatDate(value: unknown) {
  const time = Date.parse(String(value || ''));
  if (!Number.isFinite(time)) return '';
  return new Date(time).toLocaleDateString('en-AU', { year: 'numeric', month: 'short', day: 'numeric' });
}

/**
 * Contribution bodies are plain text written headline-first. The first line makes a
 * good summary; if it is very short (e.g. "Section: design") pull in the next line too.
 */
export function excerpt(body: unknown, limit = 150) {
  const lines = String(body || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  let text = lines[0] || '';
  if (text.length < 40 && lines[1]) text = `${text} — ${lines[1]}`;
  if (text.length <= limit) return text;
  return `${text.slice(0, limit - 1).trimEnd()}…`;
}

function renderItem(item: IdeaContributionRow) {
  const kind = normaliseKind(item.kind);
  const author = item.display_name || item.handle || 'Guest';
  const when = formatDate(item.created_at);
  const byline = item.handle
    ? `<a href="/contributors/${escapeHtml(item.handle)}/">${escapeHtml(author)}</a>`
    : escapeHtml(author);

  // A superseded entry stays readable — the record should show that it was
  // corrected, not hide that it was ever believed.
  const superseded = Boolean(item.superseded_by);
  const badges = [
    `<span class="research-kind">${escapeHtml(kind)}</span>`,
    item.provenance ? `<span class="research-tag prov-${escapeHtml(item.provenance)}">${escapeHtml(item.provenance)}</span>` : '',
    item.confidence ? `<span class="research-tag conf-${escapeHtml(item.confidence)}">${escapeHtml(item.confidence)} confidence</span>` : '',
    superseded ? '<span class="research-tag superseded">superseded</span>' : '',
  ].filter(Boolean).join('');

  const headline = item.claim ? escapeHtml(item.claim) : escapeHtml(excerpt(item.body));
  const source = item.source_url
    ? `<a class="research-source" href="${escapeHtml(item.source_url)}" target="_blank" rel="noopener noreferrer">source</a>${
        item.accessed_at ? `<span class="research-accessed">checked ${escapeHtml(item.accessed_at)}</span>` : ''
      }`
    : '';
  const correction = superseded
    ? `<p class="research-superseded">Corrected by <a href="#contribution-${escapeHtml(String(item.superseded_by))}">a later entry</a>.</p>`
    : '';

  return `<details class="research-item${superseded ? ' is-superseded' : ''}" id="contribution-${escapeHtml(item.id)}">
        <summary>${badges}<span class="research-excerpt">${headline}</span></summary>
        <p class="research-byline">${byline}${when ? ` <time>${escapeHtml(when)}</time>` : ''}${source}</p>
        ${correction}
        <p class="research-body">${escapeHtml(item.body)}</p>
      </details>`;
}

/**
 * Ordered oldest-first on purpose: this is a research log, and entries reference
 * earlier ones ("previously recorded", "now corrected"). Newest-first breaks the thread.
 */
function renderGroup(kind: string, items: IdeaContributionRow[]) {
  const known = KIND_GROUPS.find((group) => group.kind === kind);
  const title = known?.title || kind.replace(/[-_]+/g, ' ');
  const blurb = known?.blurb || '';
  const ordered = [...items].sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
  return `<section class="research-group">
      <h3>${escapeHtml(title)} <span class="research-count">${ordered.length}</span></h3>
      ${blurb ? `<p class="research-blurb">${escapeHtml(blurb)}</p>` : ''}
      ${ordered.map(renderItem).join('\n      ')}
    </section>`;
}

export function researchSection(contributions: IdeaContributionRow[], ideaId?: string) {
  const { research } = splitContributions(contributions);
  if (!research.length) return '';
  // We fetched at most RESEARCH_RENDER_CAP rows; if we got exactly that many there
  // are probably older ones we are not showing. Say so rather than imply completeness.
  const truncated = contributions.length >= RESEARCH_RENDER_CAP;

  const groups = new Map<string, IdeaContributionRow[]>();
  for (const item of research) {
    const kind = normaliseKind(item.kind);
    const list = groups.get(kind);
    if (list) list.push(item);
    else groups.set(kind, [item]);
  }

  const orderedKinds = [...groups.keys()].sort((a, b) => {
    const rankA = KIND_ORDER.get(a) ?? KIND_GROUPS.length;
    const rankB = KIND_ORDER.get(b) ?? KIND_GROUPS.length;
    return rankA === rankB ? a.localeCompare(b) : rankA - rankB;
  });

  const moreLink = ideaId ? ` <a href="/api/ideas/${escapeHtml(ideaId)}/contributions">See all via the API</a>.` : '';
  return `<section class="research" id="research">
      <h2>Research &amp; evidence</h2>
      <p class="research-intro">${truncated ? `Showing the ${research.length} most recent of a longer record` : `${research.length} recorded ${research.length === 1 ? 'entry' : 'entries'}`} behind this idea, oldest first. Open one to read it in full.${truncated ? moreLink : ''}</p>
      ${orderedKinds.map((kind) => renderGroup(kind, groups.get(kind) || [])).join('\n      ')}
    </section>`;
}
