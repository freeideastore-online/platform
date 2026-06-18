import { describe, expect, it } from 'vitest';
import { ideaChapters, markdownToHtml } from './markdown';

describe('markdownToHtml', () => {
  it('renders markdown links and bare URLs as safe new-tab links', () => {
    const html = markdownToHtml([
      'Use [StudentRide](https://studentride.com.au/) first.',
      '',
      '- Source: https://www.shebah.com.au/ride',
      '- Punctuated: https://example.com/path.',
      '',
      '**Shebah.** Check the provider page.',
    ].join('\n'));

    expect(html).toContain('<a href="https://studentride.com.au/" target="_blank" rel="noopener noreferrer">StudentRide</a>');
    expect(html).toContain('<a href="https://www.shebah.com.au/ride" target="_blank" rel="noopener noreferrer">https://www.shebah.com.au/ride</a>');
    expect(html).toContain('<a href="https://example.com/path" target="_blank" rel="noopener noreferrer">https://example.com/path</a>.');
    expect(html).toContain('<strong>Shebah.</strong>');
  });
});

describe('ideaChapters', () => {
  it('uses h2 headings as chapters and keeps h3 headings inside the chapter body', () => {
    const chapters = ideaChapters([
      '# Test Idea',
      '',
      'Intro should be ignored as document title only.',
      '',
      '## Overview',
      '',
      '### Snapshot',
      'The short version.',
      '',
      '### Status',
      'Researching.',
      '',
      '## Validation',
      '',
      '### Cheapest Test',
      'Run one interview.',
    ].join('\n'), 'Test Idea');

    expect(chapters.map((chapter) => chapter.title)).toEqual(['Overview', 'Validation']);
    expect(chapters[0]?.markdown).toContain('### Snapshot');
    expect(chapters[0]?.markdown).toContain('### Status');
    expect(chapters[1]?.markdown).toContain('### Cheapest Test');
  });

  it('strips markdown syntax from chapter excerpts before truncating', () => {
    const chapters = ideaChapters([
      '## Current Options Map',
      '',
      'The current option map should be presented by suburb and school, not as one national answer.',
      '',
      '**School-managed transport.**',
      '',
      '[StudentRide](https://studentride.com.au/) can be relevant when a school already runs a managed bus service.',
    ].join('\n'));

    expect(chapters[0]?.excerpt).toContain('School-managed transport.');
    expect(chapters[0]?.excerpt).toContain('StudentRide');
    expect(chapters[0]?.excerpt).not.toContain('**');
    expect(chapters[0]?.excerpt).not.toContain('](https://');
  });
});
