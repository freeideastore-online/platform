import { describe, expect, it } from 'vitest';
import { extractUrls, normaliseSourceUrl } from './sources';

describe('normaliseSourceUrl', () => {
  it('treats the same source cited different ways as one url', () => {
    const canonical = normaliseSourceUrl('https://www.iso.org/standard/63406.html');

    expect(normaliseSourceUrl('https://WWW.ISO.ORG/standard/63406.html')).toBe(canonical);
    expect(normaliseSourceUrl('https://www.iso.org/standard/63406.html#scope')).toBe(canonical);
    expect(normaliseSourceUrl('https://www.iso.org/standard/63406.html?utm_source=newsletter')).toBe(canonical);
    expect(normaliseSourceUrl('https://www.iso.org/standard/63406.html?fbclid=abc')).toBe(canonical);
  });

  it('drops a bare trailing slash but keeps meaningful query strings', () => {
    expect(normaliseSourceUrl('https://matrixify.app/docs/')).toBe('https://matrixify.app/docs');
    // A query that is not tracking is part of the identity of the page.
    expect(normaliseSourceUrl('https://example.com/search?q=tiles')).toBe('https://example.com/search?q=tiles');
  });

  it('does not merge genuinely different pages', () => {
    expect(normaliseSourceUrl('https://example.com/a')).not.toBe(normaliseSourceUrl('https://example.com/b'));
    // Path case can be significant, so it is left alone.
    expect(normaliseSourceUrl('https://example.com/Docs')).not.toBe(normaliseSourceUrl('https://example.com/docs'));
  });

  it('rejects anything that is not an http(s) url', () => {
    expect(normaliseSourceUrl('javascript:alert(1)')).toBeNull();
    expect(normaliseSourceUrl('mailto:someone@example.com')).toBeNull();
    expect(normaliseSourceUrl('not a url')).toBeNull();
    expect(normaliseSourceUrl('')).toBeNull();
  });
});

describe('extractUrls', () => {
  it('finds markdown links and bare urls, deduped', () => {
    const urls = extractUrls([
      'See [ISO 13006](https://www.iso.org/standard/63406.html) for the grouping.',
      'Bare: https://matrixify.app/ and again https://matrixify.app/.',
      'Repeat of the standard: https://www.iso.org/standard/63406.html#scope',
    ].join('\n'));

    expect(urls).toContain('https://www.iso.org/standard/63406.html');
    expect(urls).toContain('https://matrixify.app/');
    // The fragment variant normalises onto the same source, so no duplicate.
    expect(urls).toHaveLength(2);
  });

  it('does not take trailing sentence punctuation as part of the url', () => {
    expect(extractUrls('Source: https://example.com/path.')).toEqual(['https://example.com/path']);
    expect(extractUrls('(see https://example.com/path)')).toEqual(['https://example.com/path']);
  });

  it('ignores non-http links', () => {
    expect(extractUrls('[bad](javascript:alert(1)) and mailto:a@b.com')).toEqual([]);
  });
});
