import type { Metadata } from 'next';
import Link from 'next/link';
import { AdminFilters, AdminPager } from '@/components/admin/AdminFilters';
import { adminServerFetch } from '@/lib/admin-server';
import { formatDateShort, formatNumber, relativeTime } from '@/lib/format';
import styles from '@/components/admin/admin.module.css';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Articles',
  robots: { index: false, follow: false },
};

const PAGE_SIZE = 20;

const STATUS_OPTIONS = [
  { value: 'published', label: 'Published' },
  { value: 'draft', label: 'Draft' },
  { value: 'unpublished', label: 'Unpublished' },
  { value: 'deleted', label: 'Deleted' },
] as const;

interface ArticleListItem {
  id: string;
  slug: string;
  headline: string;
  dek: string | null;
  category_slug: string;
  author_display: string;
  breaking: number;
  featured: number;
  placement: 'lead' | 'top' | 'standard';
  status: string;
  edition_date: string;
  published_at: string | null;
  views: number;
  created_at: string;
  updated_at: string;
}

interface ArticlesResponse {
  total: number;
  articles: ArticleListItem[];
}

interface ArticlesPageProps {
  searchParams: Promise<{
    status?: string | string[];
    page?: string | string[];
    q?: string | string[];
  }>;
}

function first(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? '';
}

function parsePage(value: string | string[] | undefined): number {
  const parsed = Number.parseInt(first(value) || '1', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

function statusBadgeClass(status: string): string {
  switch (status) {
    case 'published':
      return 'badge badge--published';
    case 'unpublished':
      return 'badge badge--review';
    case 'deleted':
      return 'badge badge--failed';
    default:
      return 'badge badge--info';
  }
}

function isNextControlFlow(error: unknown): boolean {
  const digest = (error as { digest?: unknown }).digest;
  return typeof digest === 'string' && /^NEXT_(REDIRECT|NOT_FOUND)/.test(digest);
}

function errorText(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return 'The newsroom API rejected the request.';
}

export default async function AdminArticlesPage({
  searchParams,
}: ArticlesPageProps): Promise<React.JSX.Element> {
  const query = await searchParams;
  const status = first(query.status).trim().slice(0, 40);
  const q = first(query.q).trim().slice(0, 100);
  const page = parsePage(query.page);

  const params = new URLSearchParams({
    limit: String(PAGE_SIZE),
    offset: String((page - 1) * PAGE_SIZE),
  });
  if (status) params.set('status', status);
  if (q) params.set('q', q);

  let data: ArticlesResponse | null = null;
  let error: string | null = null;
  try {
    data = await adminServerFetch<ArticlesResponse>(`/admin/articles?${params.toString()}`);
  } catch (caught) {
    if (isNextControlFlow(caught)) throw caught;
    error = errorText(caught);
  }

  const items = data?.articles ?? [];
  const total = data?.total ?? 0;

  return (
    <>
      <div className="admin-head">
        <div>
          <h1>Articles</h1>
          <p className="muted" style={{ margin: '4px 0 0' }}>
            {data
              ? `${formatNumber(total)} article${total === 1 ? '' : 's'}${
                  status ? ` with status “${status}”` : ''
                }`
              : 'Every story on file.'}
          </p>
        </div>
        <Link className={styles.panelLink} href="/admin">
          ← Overview
        </Link>
      </div>

      <AdminFilters
        action="/admin/articles"
        statuses={STATUS_OPTIONS}
        status={status}
        q={q}
        qPlaceholder="Headline or author"
      />

      {error ? (
        <div className={`alert alert--error ${styles.noticeBar}`} role="alert">
          <h3>Articles could not be loaded</h3>
          <p>{error}</p>
          <p className={styles.actionNote}>
            Nothing has been changed. Reload once the API is reachable.
          </p>
        </div>
      ) : null}

      {!error && data ? (
        items.length === 0 ? (
          <p className={styles.emptyLine}>
            {status || q
              ? 'No articles match these filters. Try a different status or clear the search.'
              : 'No articles on file yet.'}
          </p>
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <caption className="visually-hidden">
                Articles, newest first, with section, author, status, flags and publication date
              </caption>
              <thead>
                <tr>
                  <th scope="col">Headline</th>
                  <th scope="col">Category</th>
                  <th scope="col">Author</th>
                  <th scope="col">Status</th>
                  <th scope="col">Flags</th>
                  <th scope="col">Date</th>
                </tr>
              </thead>
              <tbody>
                {items.map((article) => (
                  <tr key={article.id}>
                    <td className="title-cell">
                      <div className={styles.titleStack}>
                        <Link href={`/admin/articles/${article.id}`}>{article.headline}</Link>
                        <span className={styles.titleMeta}>
                          /article/{article.slug} · {formatNumber(article.views)} views
                        </span>
                      </div>
                    </td>
                    <td className={styles.cellMuted}>{article.category_slug}</td>
                    <td className={styles.cellMuted}>{article.author_display || 'Unnamed'}</td>
                    <td>
                      <span className={statusBadgeClass(article.status)}>{article.status}</span>
                    </td>
                    <td>
                      <div className={styles.badgeRow}>
                        {article.breaking === 1 ? (
                          <span className="badge badge--breaking">Breaking</span>
                        ) : null}
                        {article.featured === 1 ? (
                          <span className="badge badge--info">Featured</span>
                        ) : null}
                        <span className="badge badge--muted">{article.placement}</span>
                      </div>
                    </td>
                    <td className={styles.num}>
                      {article.published_at ? (
                        <time
                          dateTime={article.published_at}
                          title={`Published ${formatDateShort(article.published_at)}`}
                        >
                          {formatDateShort(article.published_at)}
                        </time>
                      ) : (
                        <span title={`Created ${formatDateShort(article.created_at)}`}>
                          {relativeTime(article.created_at)}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      ) : null}

      {data ? (
        <AdminPager
          basePath="/admin/articles"
          page={page}
          limit={PAGE_SIZE}
          total={total}
          query={{ status, q }}
          noun="articles"
        />
      ) : null}
    </>
  );
}
