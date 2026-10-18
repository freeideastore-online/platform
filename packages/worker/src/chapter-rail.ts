import { escapeHtml } from './http';
import { chapterGroups, type IdeaChapter, type IdeaPart } from './markdown';

/**
 * The chapter rail, grouped by part (#63).
 *
 * At the 100-chapter cap a flat rail is a hundred peers and a substring filter.
 * Parts give it a level: each part is a collapsible group, and only the part
 * holding the chapter being read starts open, so a reader sees the shape of the
 * document — ten parts, not a hundred links — and the neighbourhood they are
 * in. A document with at most one part opens it, since collapsing the only
 * group would hide the whole rail behind one click.
 *
 * Chapter numbers keep running across parts: a chapter URL and its ordinal are
 * the document's, not the part's, so "Chapter 47" means the same thing in
 * every rail.
 *
 * Both the idea home page and every chapter page render this, so the two rails
 * cannot drift apart.
 */
export function chapterRail(
  ideaId: string,
  chapters: IdeaChapter[],
  parts: IdeaPart[],
  options: { activeId?: string; filterable?: boolean } = {},
) {
  const groups = chapterGroups(chapters, parts);
  const openEveryPart = groups.filter((group) => group.part).length <= 1;
  let ordinal = 0;
  const link = (chapter: IdeaChapter) => {
    ordinal += 1;
    const active = chapter.id === options.activeId;
    const filterText = options.filterable ? ` data-title="${escapeHtml(chapter.title)} ${escapeHtml(chapter.excerpt)}"` : '';
    return `<a class="chapter-link${active ? ' active' : ''}"${filterText} href="/ideas/${escapeHtml(ideaId)}/${escapeHtml(chapter.id)}/"${active ? ' aria-current="page"' : ''}><b>${ordinal}</b><span>${escapeHtml(chapter.title)}</span></a>`;
  };
  return groups
    .map((group) => {
      const links = group.chapters.map(link).join('');
      if (!group.part) return links;
      const open = openEveryPart || group.chapters.some((chapter) => chapter.id === options.activeId);
      return `<details class="part-group"${open ? ' open' : ''}><summary class="part-title"><span>${escapeHtml(group.part.title)}</span><small>${group.chapters.length}</small></summary><div class="part-chapters">${links}</div></details>`;
    })
    .join('');
}

export const CHAPTER_RAIL_CSS = `
.part-group{display:grid;gap:.28rem}.part-group+.part-group,.chapter-link+.part-group{margin-top:.35rem}
.part-title{display:flex;justify-content:space-between;align-items:baseline;gap:.6rem;cursor:pointer;list-style:none;border-radius:8px;padding:.45rem .56rem;color:var(--accent-strong);font-size:.74rem;font-weight:900;letter-spacing:.06em;text-transform:uppercase;line-height:1.3}
.part-title::-webkit-details-marker{display:none}.part-title::before{content:'\\25B8';margin-right:.35rem}.part-group[open]>.part-title::before{content:'\\25BE'}
.part-title span{flex:1}.part-title small{color:var(--muted);font-size:.68rem;letter-spacing:0}.part-title:hover{background:var(--mark)}
.part-chapters{display:grid;gap:.28rem;border-left:2px solid var(--line);margin-left:.6rem;padding-left:.35rem}
`;

/**
 * Filters the rail by title and excerpt. While a query is active every part
 * that has a match opens and every part with none hides; clearing the query
 * puts each part back the way the page rendered it.
 */
export const CHAPTER_FILTER_SCRIPT = `
const filter = document.querySelector('#book-filter');
const chapterLinks = [...document.querySelectorAll('#chapter-list .chapter-link')];
const partGroups = [...document.querySelectorAll('#chapter-list .part-group')];
partGroups.forEach((group) => { group.dataset.initiallyOpen = group.open ? '1' : ''; });
if (filter) filter.oninput = () => {
  const query = filter.value.trim().toLowerCase();
  chapterLinks.forEach((link) => {
    link.hidden = query && !String(link.dataset.title || '').toLowerCase().includes(query);
  });
  partGroups.forEach((group) => {
    const matches = [...group.querySelectorAll('.chapter-link')].some((link) => !link.hidden);
    group.hidden = Boolean(query) && !matches;
    group.open = query ? matches : Boolean(group.dataset.initiallyOpen);
  });
};
`;
