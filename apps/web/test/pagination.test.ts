import { describe, expect, it } from 'vitest';
import {
  archivePath,
  pagePath,
  readArchiveSegments,
  readPageSegments,
} from '../src/lib/pagination';

describe('pagePath', () => {
  it('keeps page 1 on the base path', () => {
    expect(pagePath('/latest', 1)).toBe('/latest');
  });

  it('puts later pages in the path', () => {
    expect(pagePath('/latest', 3)).toBe('/latest/page/3');
  });
});

describe('readPageSegments', () => {
  it('treats no segments as page 1', () => {
    expect(readPageSegments(undefined)).toBe(1);
    expect(readPageSegments([])).toBe(1);
  });

  it('reads a page segment', () => {
    expect(readPageSegments(['page', '2'])).toBe(2);
  });

  it('rejects junk instead of guessing', () => {
    expect(readPageSegments(['page'])).toBeNull();
    expect(readPageSegments(['page', '0'])).toBeNull();
    expect(readPageSegments(['page', '2', 'x'])).toBeNull();
    expect(readPageSegments(['2'])).toBeNull();
  });
});

describe('readArchiveSegments', () => {
  it('reads the plain archive', () => {
    expect(readArchiveSegments([])).toEqual({ month: null, page: 1 });
  });

  it('reads month and page forms', () => {
    expect(readArchiveSegments(['2026-10'])).toEqual({ month: '2026-10', page: 1 });
    expect(readArchiveSegments(['page', '2'])).toEqual({ month: null, page: 2 });
    expect(readArchiveSegments(['2026-10', 'page', '2'])).toEqual({
      month: '2026-10',
      page: 2,
    });
  });

  it('rejects invalid months and pages', () => {
    expect(readArchiveSegments(['2026-13'])).toBeNull();
    expect(readArchiveSegments(['10-2026'])).toBeNull();
    expect(readArchiveSegments(['2026-10', 'page', '0'])).toBeNull();
    expect(readArchiveSegments(['2026-10', 'x'])).toBeNull();
  });
});

describe('archivePath', () => {
  it('builds cacheable archive URLs', () => {
    expect(archivePath(null, 1)).toBe('/archive');
    expect(archivePath('2026-10', 1)).toBe('/archive/2026-10');
    expect(archivePath('2026-10', 2)).toBe('/archive/2026-10/page/2');
    expect(archivePath(null, 2)).toBe('/archive/page/2');
  });
});
