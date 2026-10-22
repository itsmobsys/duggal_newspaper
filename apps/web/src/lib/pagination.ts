/** Listing pages keep their page in the path so the HTML stays cacheable. */
export function pagePath(basePath: string, page: number): string {
  return page > 1 ? `${basePath}/page/${page}` : basePath;
}

/**
 * Optional catch-all reader: [] -> 1, ['page', '2'] -> 2, anything else -> null
 * (the page then calls notFound()).
 */
export function readPageSegments(segments: string[] | undefined): number | null {
  if (!segments || segments.length === 0) return 1;
  const [prefix, raw] = segments;
  if (segments.length !== 2 || prefix !== 'page' || !raw) return null;
  if (!/^[1-9]\d{0,5}$/.test(raw)) return null;
  return Number.parseInt(raw, 10);
}
