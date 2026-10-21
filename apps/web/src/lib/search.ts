/**
 * Search helpers shared by the instant search bar, the `/api/search` route and
 * the archive page. Everything here is pure so it can be tested without a
 * database or a browser.
 */

/** Below this length a query matches half the paper and costs a full scan. */
export const SEARCH_MIN_LENGTH = 2;
export const SEARCH_MAX_LENGTH = 120;
/** Kept small: the panel is a glance, not a page. */
export const SEARCH_DEFAULT_LIMIT = 6;
export const SEARCH_MAX_LIMIT = 12;

export interface SearchHit {
  slug: string;
  headline: string;
  dek: string | null;
  categoryName: string;
  categoryAccent: string | null;
  publishedAt: string | null;
  readingMinutes: number;
  /** A window of body copy around the match, or null when only metadata matched. */
  snippet: string | null;
}

export interface SearchPayload {
  query: string;
  results: SearchHit[];
  hasMore: boolean;
}

/** Trim, collapse runs of whitespace, and cap the length the API will accept. */
export function normaliseSearchQuery(raw: string | null | undefined): string {
  return (raw ?? '').replace(/\s+/g, ' ').trim().slice(0, SEARCH_MAX_LENGTH);
}

export function isSearchable(query: string): boolean {
  return normaliseSearchQuery(query).length >= SEARCH_MIN_LENGTH;
}

/** `%`, `_` and `\` are LIKE wildcards; a search for "100%" must not match everything. */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (match) => `\\${match}`);
}

export function containsPattern(value: string): string {
  return `%${escapeLike(value)}%`;
}

export function prefixPattern(value: string): string {
  return `${escapeLike(value)}%`;
}

/** The human-facing archive URL for a query. */
export function searchHref(query: string): string {
  const cleaned = normaliseSearchQuery(query);
  return cleaned ? `/search?q=${encodeURIComponent(cleaned)}` : '/search';
}

export function clampSearchLimit(raw: string | null | undefined): number {
  const parsed = Number.parseInt(raw ?? '', 10);
  if (!Number.isFinite(parsed)) return SEARCH_DEFAULT_LIMIT;
  return Math.min(SEARCH_MAX_LIMIT, Math.max(1, parsed));
}

/**
 * Pull a readable window of body copy around the match so a content hit shows
 * why it matched. Returns null when the body does not contain the query (the
 * hit came from the headline, tags or category instead).
 */
export function buildSearchSnippet(body: string, query: string, maxLength = 150): string | null {
  const text = body.replace(/\s+/g, ' ').trim();
  const needle = normaliseSearchQuery(query).toLowerCase();
  if (!text || !needle) return null;

  const index = text.toLowerCase().indexOf(needle);
  if (index < 0) return null;

  const room = Math.max(24, Math.floor((maxLength - needle.length) / 2));
  let start = Math.max(0, index - room);
  let end = Math.min(text.length, index + needle.length + room);

  // Prefer whole words at both edges, but never cut into the match itself.
  if (start > 0) {
    const space = text.indexOf(' ', start);
    if (space >= 0 && space < index) start = space + 1;
  }
  if (end < text.length) {
    const space = text.lastIndexOf(' ', end);
    if (space > index + needle.length) end = space;
  }

  const window = text.slice(start, end).trim();
  if (!window) return null;
  return `${start > 0 ? '…' : ''}${window}${end < text.length ? '…' : ''}`;
}
