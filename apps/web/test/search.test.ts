import { describe, expect, it } from 'vitest';
import {
  SEARCH_DEFAULT_LIMIT,
  SEARCH_MAX_LENGTH,
  SEARCH_MAX_LIMIT,
  buildSearchSnippet,
  clampSearchLimit,
  containsPattern,
  escapeLike,
  isSearchable,
  normaliseSearchQuery,
  prefixPattern,
  searchHref,
} from '../src/lib/search';

describe('normaliseSearchQuery', () => {
  it('trims, collapses whitespace and handles nullish input', () => {
    expect(normaliseSearchQuery('  red   chaddi  ')).toBe('red chaddi');
    expect(normaliseSearchQuery(null)).toBe('');
    expect(normaliseSearchQuery(undefined)).toBe('');
  });

  it('caps runaway queries', () => {
    expect(normaliseSearchQuery('a'.repeat(500))).toHaveLength(SEARCH_MAX_LENGTH);
  });
});

describe('isSearchable', () => {
  it('ignores one-character and whitespace-only queries', () => {
    expect(isSearchable('a')).toBe(false);
    expect(isSearchable('   ')).toBe(false);
    expect(isSearchable(' ab ')).toBe(true);
  });
});

describe('LIKE helpers', () => {
  it('escapes wildcards so a literal percent sign does not match everything', () => {
    expect(escapeLike('100%_off\\')).toBe('100\\%\\_off\\\\');
  });

  it('wraps escaped patterns', () => {
    expect(containsPattern('50%')).toBe('%50\\%%');
    expect(prefixPattern('red')).toBe('red%');
  });
});

describe('searchHref', () => {
  it('builds an encoded archive URL', () => {
    expect(searchHref('red chaddi')).toBe('/search?q=red%20chaddi');
    expect(searchHref('  ')).toBe('/search');
  });
});

describe('clampSearchLimit', () => {
  it('falls back to the default for junk input', () => {
    expect(clampSearchLimit(null)).toBe(SEARCH_DEFAULT_LIMIT);
    expect(clampSearchLimit('abc')).toBe(SEARCH_DEFAULT_LIMIT);
  });

  it('clamps into the allowed range', () => {
    expect(clampSearchLimit('0')).toBe(1);
    expect(clampSearchLimit('99')).toBe(SEARCH_MAX_LIMIT);
    expect(clampSearchLimit('3')).toBe(3);
  });
});

describe('buildSearchSnippet', () => {
  const body =
    'It began in general chat with a simple question about the colour of a ' +
    'certain undergarment. Nobody expected the server to split in half before lunch, ' +
    'but here we are, still arguing about laundry.';

  it('returns a window around a body match and marks the cut edges', () => {
    const snippet = buildSearchSnippet(body, 'undergarment', 60);
    expect(snippet).toContain('undergarment');
    expect(snippet?.startsWith('…')).toBe(true);
    expect(snippet?.endsWith('…')).toBe(true);
  });

  it('returns null when the query is only in the headline', () => {
    expect(buildSearchSnippet(body, 'headline only')).toBeNull();
  });

  it('returns null for an empty body or query', () => {
    expect(buildSearchSnippet('', 'red')).toBeNull();
    expect(buildSearchSnippet(body, '   ')).toBeNull();
  });

  it('never cuts through the matched word', () => {
    const tight = buildSearchSnippet('aaaaaaaaaa needle bbbbbbbbbb', 'needle', 12);
    expect(tight).toContain('needle');
  });

  it('keeps the whole text when it already fits', () => {
    expect(buildSearchSnippet('short body here', 'body', 150)).toBe('short body here');
  });
});
