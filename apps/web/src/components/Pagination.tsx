import Link from 'next/link';

export interface PaginationProps {
  page: number;
  total: number;
  limit: number;
  basePath: string;
  /** Extra query parameters to preserve (category, q, tag…). */
  query?: Record<string, string | undefined>;
  /** Override link targets, e.g. path segments instead of ?page=. */
  hrefFor?: (page: number) => string;
}

function buildHref(
  basePath: string,
  query: Record<string, string | undefined>,
  page: number,
): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value) params.set(key, value);
  }
  if (page > 1) params.set('page', String(page));
  const suffix = params.toString();
  return suffix ? `${basePath}?${suffix}` : basePath;
}

export function Pagination({
  page,
  total,
  limit,
  basePath,
  query = {},
  hrefFor,
}: PaginationProps): React.JSX.Element | null {
  const totalPages = Math.max(1, Math.ceil(total / Math.max(1, limit)));
  if (totalPages <= 1) return null;

  const current = Math.min(Math.max(page, 1), totalPages);
  const windowStart = Math.max(1, current - 2);
  const windowEnd = Math.min(totalPages, windowStart + 4);
  const pages: number[] = [];
  for (let index = windowStart; index <= windowEnd; index += 1) pages.push(index);

  const href = (target: number): string =>
    hrefFor ? hrefFor(target) : buildHref(basePath, query, target);

  return (
    <nav className="pagination" aria-label="Pagination">
      <span>
        Page {current} of {totalPages} · {total} stories
      </span>
      <span className="pages">
        {current > 1 ? (
          <Link className="chip" href={href(current - 1)} rel="prev">
            ← Newer
          </Link>
        ) : null}
        {pages.map((number) => (
          <Link
            key={number}
            className="chip"
            href={href(number)}
            aria-current={number === current ? 'page' : undefined}
          >
            {number}
          </Link>
        ))}
        {current < totalPages ? (
          <Link className="chip" href={href(current + 1)} rel="next">
            Older →
          </Link>
        ) : null}
      </span>
    </nav>
  );
}
