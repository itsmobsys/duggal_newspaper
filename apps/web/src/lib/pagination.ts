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

export interface ArchivePath {
  month: string | null;
  page: number;
}

/** `/archive`, `/archive/page/2`, `/archive/2026-10`, `/archive/2026-10/page/2`. */
export function archivePath(month: string | null, page: number): string {
  const base = month ? `/archive/${month}` : '/archive';
  return page > 1 ? `${base}/page/${page}` : base;
}

/**
 * Reads archive segments: [], ['page','2'], ['2026-10'], ['2026-10','page','2'].
 * Returns null for anything else so the page can 404 instead of guessing.
 */
export function readArchiveSegments(segments: string[] | undefined): ArchivePath | null {
  const parts = segments ?? [];
  if (parts.length === 0) return { month: null, page: 1 };
  if (parts.length === 1 && parts[0] && /^\d{4}-(0[1-9]|1[0-2])$/.test(parts[0])) {
    return { month: parts[0], page: 1 };
  }
  if (parts.length === 2 && parts[0] === 'page' && parts[1] && /^[1-9]\d{0,5}$/.test(parts[1])) {
    return { month: null, page: Number.parseInt(parts[1], 10) };
  }
  if (
    parts.length === 3 &&
    parts[0] &&
    /^\d{4}-(0[1-9]|1[0-2])$/.test(parts[0]) &&
    parts[1] === 'page' &&
    parts[2] &&
    /^[1-9]\d{0,5}$/.test(parts[2])
  ) {
    return { month: parts[0], page: Number.parseInt(parts[2], 10) };
  }
  return null;
}
