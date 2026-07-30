import { describe, expect, it } from 'vitest';
import { toMatchQuery } from './search';

describe('toMatchQuery', () => {
  it('quotes each term so user input cannot be read as FTS syntax', () => {
    // Bare punctuation like NOT/OR/parens is FTS5 syntax: unquoted it is a
    // syntax error rather than a search.
    expect(toMatchQuery('etim OR (matrixify')).toBe('"etim" "or" "matrixify"');
    expect(toMatchQuery('"quoted"')).toBe('"quoted"');
    expect(toMatchQuery('a -b')).toBe('"a" "b"');
  });

  it('keeps intra-word punctuation that belongs to the term', () => {
    expect(toMatchQuery("supplier's data")).toBe('"supplier\'s" "data"');
    expect(toMatchQuery('wood-look tiles')).toBe('"wood-look" "tiles"');
  });

  it('handles unicode and digits', () => {
    expect(toMatchQuery('ISO 13006')).toBe('"iso" "13006"');
    expect(toMatchQuery('café')).toBe('"café"');
  });

  it('returns null when there is nothing searchable', () => {
    expect(toMatchQuery('')).toBeNull();
    expect(toMatchQuery('   ')).toBeNull();
    expect(toMatchQuery('!!! ???')).toBeNull();
  });

  it('bounds the number of terms', () => {
    const many = Array.from({ length: 30 }, (_, index) => `term${index}`).join(' ');
    expect(toMatchQuery(many)?.split(' ')).toHaveLength(12);
  });
});
