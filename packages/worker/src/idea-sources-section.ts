import { escapeHtml } from './http';

type SourceView = {
  id: string;
  url: string;
  host: string;
  status: number;
  last_checked: string;
  sections: string[];
  contribution_citations: number;
};

/**
 * What the idea rests on, in one place.
 *
 * Sources previously existed only as inline links scattered through the document
 * and contribution prose, so the evidence base was the least inspectable part of
 * a page whose whole argument turns on evidence quality.
 */
export function sourcesSection(sources: SourceView[]) {
  if (!sources.length) return '';
  const broken = sources.filter((source) => source.status === 0 ? false : source.status >= 400);
  const rows = sources
    .map((source) => {
      const where = [
        ...source.sections.map((section) => `<a href="#${escapeHtml(section)}">${escapeHtml(section)}</a>`),
        source.contribution_citations
          ? `<a href="#research">${source.contribution_citations} research ${source.contribution_citations === 1 ? 'entry' : 'entries'}</a>`
          : '',
      ].filter(Boolean).join(', ');
      // Only flag a link once it has actually been checked and failed.
      const health = source.status >= 400
        ? `<span class="source-dead" title="Last check returned ${escapeHtml(source.status)}">unreachable</span>`
        : '';
      return `<li class="source-row">
        <a class="source-url" href="${escapeHtml(source.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(source.host || source.url)}</a>
        ${health}
        <span class="source-where">${where || 'cited'}</span>
        <a class="source-citations" href="/api/sources/${escapeHtml(source.id)}">cited by</a>
      </li>`;
    })
    .join('\n      ');

  return `<section class="sources" id="sources">
      <h2>Sources</h2>
      <p class="sources-intro">${sources.length} distinct ${sources.length === 1 ? 'source' : 'sources'} behind this idea, from the document and its research.${broken.length ? ` ${broken.length} did not respond when last checked.` : ''}</p>
      <ul class="source-list">
      ${rows}
      </ul>
    </section>`;
}
