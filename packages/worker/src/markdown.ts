import { escapeHtml, slug } from './http';
import type { IdeaRow } from './types';

function externalHref(value: string) {
  const url = value.trim();
  if (!/^https?:\/\//i.test(url)) return '';
  return url;
}

function externalLink(label: string, url: string) {
  const href = externalHref(url);
  if (!href) return escapeHtml(label);
  return `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(label)}</a>`;
}

function splitTrailingUrlPunctuation(url: string) {
  const match = url.match(/^(.+?)([),.;:!?]+)?$/);
  return {
    href: match?.[1] || url,
    trailing: match?.[2] || '',
  };
}

function renderInline(value: string): string {
  let html = '';
  let index = 0;
  while (index < value.length) {
    const rest = value.slice(index);
    const markdownImage = rest.match(/^!\[([^\]]*)\]\((https:\/\/[^)\s]+)\)/i);
    if (markdownImage) {
      const alt = escapeHtml(markdownImage[1] || '');
      const src = escapeHtml(markdownImage[2] || '');
      html += `<img src="${src}" alt="${alt}" loading="lazy" style="max-width:100%;height:auto;border-radius:8px;margin:.5rem 0">`;
      index += markdownImage[0].length;
      continue;
    }

    const markdownLink = rest.match(/^\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/i);
    if (markdownLink) {
      html += externalLink(markdownLink[1] || '', markdownLink[2] || '');
      index += markdownLink[0].length;
      continue;
    }

    if (rest.startsWith('**')) {
      const close = rest.indexOf('**', 2);
      if (close > 2) {
        html += `<strong>${renderInline(rest.slice(2, close))}</strong>`;
        index += close + 2;
        continue;
      }
    }

    const bareUrl = rest.match(/^https?:\/\/[^\s<]+/i);
    if (bareUrl) {
      const { href, trailing } = splitTrailingUrlPunctuation(bareUrl[0]);
      html += externalLink(href, href) + escapeHtml(trailing);
      index += bareUrl[0].length;
      continue;
    }

    html += escapeHtml(value[index]);
    index += 1;
  }
  return html;
}

export type IdeaChapter = {
  id: string;
  title: string;
  markdown: string;
  excerpt: string;
  aliases: string[];
};

export function markdownToHtml(markdown: string) {
  const lines = markdown.split(/\r?\n/);
  const html: string[] = [];
  let listType: 'ul' | 'ol' | null = null;

  const closeList = () => {
    if (listType) {
      html.push(`</${listType}>`);
      listType = null;
    }
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      closeList();
      continue;
    }
    const heading = trimmed.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      closeList();
      const marker = heading[1] || '';
      const title = heading[2] || 'Section';
      const tag = marker.length <= 2 ? 'h2' : 'h3';
      html.push(`<${tag} id="${escapeHtml(slug(title) || 'section')}">${escapeHtml(title)}</${tag}>`);
      continue;
    }
    const listItem = trimmed.match(/^[-*]\s+(.+)$/);
    if (listItem) {
      if (listType !== 'ul') {
        closeList();
        html.push('<ul>');
        listType = 'ul';
      }
      html.push(`<li>${renderInline(listItem[1] || '')}</li>`);
      continue;
    }
    const orderedItem = trimmed.match(/^\d+\.\s+(.+)$/);
    if (orderedItem) {
      if (listType !== 'ol') {
        closeList();
        html.push('<ol>');
        listType = 'ol';
      }
      html.push(`<li>${renderInline(orderedItem[1] || '')}</li>`);
      continue;
    }
    closeList();
    html.push(`<p>${renderInline(trimmed)}</p>`);
  }
  closeList();
  return html.join('\n');
}

export function markdownHeadings(markdown: string) {
  return markdown
    .split(/\r?\n/)
    .map((line) => line.trim().match(/^#{1,3}\s+(.+)$/)?.[1])
    .filter((title): title is string => Boolean(title))
    .map((title) => ({ title, id: slug(title) || 'section' }));
}

export function chapterId(title: string) {
  const normalized = title.toLowerCase();
  if (normalized.includes('competitor') || normalized.includes('similar service')) return 'competitors';
  if (normalized.includes('regulation') || normalized.includes('site constraint')) return 'regulation';
  if (normalized.includes('prototype')) return 'prototype';
  if (normalized.includes('validation')) return 'validation';
  if (normalized.includes('open question')) return 'open-questions';
  if (normalized.includes('how to help') || normalized.includes('contribute')) return 'contribute';
  if (normalized.includes('current thesis')) return 'thesis';
  return slug(title) || 'section';
}

function excerpt(markdown: string) {
  return markdown
    .replace(/^#{1,3}\s+.+$/gm, '')
    .replace(/\[([^\]]+)\]\(https?:\/\/[^)\s]+\)/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/[-*]\s+/g, '')
    .replace(/\d+\.\s+/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 180);
}

export function ideaChapters(markdown: string, documentTitle = ''): IdeaChapter[] {
  const chapters: IdeaChapter[] = [];
  let currentTitle = 'Overview';
  let currentLines: string[] = [];
  let sawHeading = false;
  let ignoredDocumentTitle = false;

  const push = () => {
    const body = currentLines.join('\n').trim();
    if (!body && !sawHeading) return;
    const id = chapterId(currentTitle);
    const rawSlug = slug(currentTitle) || id;
    chapters.push({
      id,
      title: currentTitle,
      markdown: `## ${currentTitle}\n\n${body}`.trim(),
      excerpt: excerpt(body) || 'Open this chapter.',
      aliases: Array.from(new Set([id, rawSlug])),
    });
  };

  for (const line of markdown.split(/\r?\n/)) {
    const heading = line.trim().match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      const level = (heading[1] || '').length;
      const title = (heading[2] || '').trim();
      if (level > 2) {
        currentLines.push(line);
        continue;
      }
      if (
        level === 1 &&
        documentTitle &&
        !sawHeading &&
        !currentLines.some((item) => item.trim()) &&
        slug(title) === slug(documentTitle)
      ) {
        ignoredDocumentTitle = true;
        continue;
      }
      if (sawHeading || currentLines.some((item) => item.trim())) push();
      currentTitle = title;
      currentLines = [];
      sawHeading = true;
      ignoredDocumentTitle = false;
      continue;
    }
    if (ignoredDocumentTitle && !sawHeading) continue;
    currentLines.push(line);
  }
  push();

  return chapters.length ? chapters : [{
    id: 'snapshot',
    title: 'Snapshot',
    markdown,
    excerpt: excerpt(markdown) || 'Open this idea.',
    aliases: ['snapshot'],
  }];
}

export function ideaChapterById(chapters: IdeaChapter[], rawChapterId: string) {
  return chapters.find((chapter) => chapter.aliases.includes(rawChapterId));
}

export function defaultIdeaBody(idea: IdeaRow) {
  return [
    `## Snapshot`,
    idea.summary,
    ``,
    `## Current signal`,
    idea.signal || idea.preview || 'No signal has been added yet.',
    ``,
    `## Next step`,
    idea.next_step || 'Define the cheapest validation step.',
    ``,
    `## Risk`,
    idea.risk || 'Main risk not yet identified.',
    ``,
    `## How to help`,
    `- Add evidence from public sources.`,
    `- Name a risk or reason to trash it.`,
    `- Suggest a sharper customer, wedge, or pivot.`,
  ].join('\n');
}
