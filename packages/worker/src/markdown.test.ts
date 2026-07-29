import { describe, expect, it } from 'vitest';
import { ideaChapters, markdownHeadings, markdownToHtml } from './markdown';

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

  it('renders the inline syntax the previous line renderer emitted literally', () => {
    const html = markdownToHtml([
      'Crawl the *supplier website* and stamp each field `extracted` or `inferred`.',
      '',
      'Also _underscore italics_ and ~~struck out~~.',
    ].join('\n'));

    expect(html).toContain('<em>supplier website</em>');
    expect(html).toContain('<code>extracted</code>');
    expect(html).toContain('<code>inferred</code>');
    expect(html).toContain('<em>underscore italics</em>');
    expect(html).toContain('<s>struck out</s>');
    expect(html).not.toContain('*supplier website*');
    expect(html).not.toContain('`extracted`');
  });

  it('renders block syntax the previous renderer could not produce', () => {
    const html = markdownToHtml([
      '> **Status: scan complete.** The original thesis is dead.',
      '',
      '| Source | Trust |',
      '| --- | --- |',
      '| ERP | high |',
      '',
      '---',
      '',
      '```',
      'sku,price',
      '```',
    ].join('\n'));

    expect(html).toContain('<blockquote>');
    expect(html).toContain('<table>');
    expect(html).toContain('<td>ERP</td>');
    expect(html).toContain('<hr>');
    expect(html).toContain('<pre><code>sku,price');
  });

  it('maps headings to h2/h3 with slug ids that match markdownHeadings', () => {
    const source = ['# Snapshot', '', '## Design Sketch', '', '### Source Trail'].join('\n');
    const html = markdownToHtml(source);

    // h1 and h2 both collapse to h2; anything deeper becomes h3.
    expect(html).toContain('<h2 id="snapshot">Snapshot</h2>');
    expect(html).toContain('<h2 id="design-sketch">Design Sketch</h2>');
    expect(html).toContain('<h3 id="source-trail">Source Trail</h3>');

    // The table of contents links to these ids, so the two must agree.
    for (const heading of markdownHeadings(source)) {
      expect(html).toContain(`id="${heading.id}"`);
    }
  });

  it('keeps the escape-by-default posture for untrusted bodies', () => {
    const html = markdownToHtml([
      '<script>alert(1)</script>',
      '',
      '<img src=x onerror=alert(1)>',
      '',
      '[click](javascript:alert(1))',
      '',
      '[data](data:text/html,<script>alert(1)</script>)',
      '',
      '![http image](http://example.com/insecure.png)',
    ].join('\n'));

    // Raw HTML survives only as inert escaped text, never as live markup.
    expect(html).not.toContain('<script');
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    // Unsafe schemes never become links — no href is emitted at all.
    expect(html).not.toContain('href="javascript:');
    expect(html).not.toContain('href="data:');
    // Non-https images degrade to alt text.
    expect(html).not.toContain('<img src="http://');
    expect(html).toContain('http image');
  });

  it('keeps a single newline as a line break so existing bodies do not re-flow', () => {
    const html = markdownToHtml('First line.\nSecond line.');

    expect(html).toContain('<br>');
    expect(html).toContain('First line.');
    expect(html).toContain('Second line.');
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
