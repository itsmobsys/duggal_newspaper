import Link from 'next/link';
import styles from './admin.module.css';

export interface AdminFilterOption {
  value: string;
  label: string;
}

export interface AdminFiltersProps {
  /** Path the GET form submits to, e.g. `/admin/submissions`. */
  action: string;
  statuses: ReadonlyArray<AdminFilterOption>;
  status: string;
  /** Omit to hide the search field (the API may not support `q`). */
  q?: string;
  qLabel?: string;
  qPlaceholder?: string;
}

/**
 * A plain GET form: filters work without client JavaScript, and submitting
 * always drops the page parameter so results start at page one.
 */
export function AdminFilters({
  action,
  statuses,
  status,
  q,
  qLabel = 'Search',
  qPlaceholder = 'Headline, story or author',
}: AdminFiltersProps): React.JSX.Element {
  // An unknown status (hand-typed URL, deleted category) still needs to appear
  // in the select, otherwise the control silently lies about the filter.
  const options =
    status && !statuses.some((option) => option.value === status)
      ? [{ value: status, label: status.replace(/_/g, ' ') }, ...statuses]
      : statuses;

  return (
    <form className="toolbar" method="get" action={action} role="search" aria-label="Filter list">
      {q === undefined ? null : (
        <div className={styles.filterField}>
          <label className={styles.filterLabel} htmlFor="admin-filter-q">
            {qLabel}
          </label>
          <input
            className="input"
            id="admin-filter-q"
            name="q"
            type="search"
            defaultValue={q}
            placeholder={qPlaceholder}
            maxLength={100}
          />
        </div>
      )}

      <div className={styles.filterField}>
        <label className={styles.filterLabel} htmlFor="admin-filter-status">
          Status
        </label>
        <select className="select" id="admin-filter-status" name="status" defaultValue={status}>
          <option value="">All statuses</option>
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>

      <button className="button button--ghost button--sm" type="submit">
        Apply
      </button>

      {status || q ? (
        <Link className={`button button--ghost button--sm ${styles.filterReset}`} href={action}>
          Reset
        </Link>
      ) : null}
    </form>
  );
}

export interface AdminPagerProps {
  basePath: string;
  page: number;
  limit: number;
  total: number;
  /** Extra query parameters to preserve (status, q…). */
  query?: Record<string, string | undefined>;
  noun?: string;
}

function pageHref(
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

export function AdminPager({
  basePath,
  page,
  limit,
  total,
  query = {},
  noun = 'records',
}: AdminPagerProps): React.JSX.Element | null {
  const totalPages = Math.max(1, Math.ceil(total / Math.max(1, limit)));
  if (totalPages <= 1) return null;

  const current = Math.min(Math.max(page, 1), totalPages);
  const windowStart = Math.max(1, current - 2);
  const windowEnd = Math.min(totalPages, windowStart + 4);
  const pages: number[] = [];
  for (let number = windowStart; number <= windowEnd; number += 1) pages.push(number);

  return (
    <nav className="pagination" aria-label="Pagination">
      <span>
        Page {current} of {totalPages} · {total} {noun}
      </span>
      <span className="pages">
        {current > 1 ? (
          <Link className="chip" href={pageHref(basePath, query, current - 1)} rel="prev">
            ← Previous
          </Link>
        ) : null}
        {pages.map((number) => (
          <Link
            key={number}
            className="chip"
            href={pageHref(basePath, query, number)}
            aria-current={number === current ? 'page' : undefined}
          >
            {number}
          </Link>
        ))}
        {current < totalPages ? (
          <Link className="chip" href={pageHref(basePath, query, current + 1)} rel="next">
            Next →
          </Link>
        ) : null}
      </span>
    </nav>
  );
}
