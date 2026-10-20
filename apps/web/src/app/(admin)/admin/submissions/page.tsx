import type { Metadata } from 'next';
import Link from 'next/link';
import { AdminFilters, AdminPager } from '@/components/admin/AdminFilters';
import { adminServerFetch } from '@/lib/admin-server';
import { ApiError } from '@/lib/api';
import { formatDateTime, formatNumber, relativeTime } from '@/lib/format';
import styles from '@/components/admin/admin.module.css';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Submissions',
  robots: { index: false, follow: false },
};

const PAGE_SIZE = 20;

const STATUS_OPTIONS = [
  { value: 'received', label: 'Received' },
  { value: 'processing', label: 'Processing' },
  { value: 'queued_review', label: 'Awaiting review' },
  { value: 'published', label: 'Published' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'failed', label: 'Failed' },
] as const;

interface SubmissionListItem {
  id: string;
  headline: string;
  authorName: string;
  discordHandle: string | null;
  anonymous: boolean;
  category: string | null;
  status: string;
  spamScore: number;
  reviewReasons: string[];
  aiModel: string | null;
  aiAttempts: number;
  aiLastError: string | null;
  articleId: string | null;
  imageCount: number;
  createdAt: string;
  updatedAt: string;
}

interface SubmissionsResponse {
  total: number;
  submissions: SubmissionListItem[];
}

interface SubmissionsPageProps {
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

function statusLabel(status: string): string {
  return status.replace(/_/g, ' ');
}

function statusBadgeClass(status: string): string {
  switch (status) {
    case 'published':
      return 'badge badge--published';
    case 'queued_review':
      return 'badge badge--review';
    case 'failed':
      return 'badge badge--failed';
    case 'processing':
      return 'badge badge--warn';
    case 'rejected':
      return 'badge badge--muted';
    default:
      return 'badge badge--info';
  }
}

function riskText(value: number): string {
  if (!Number.isFinite(value)) return '—';
  return `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%`;
}

function errorText(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error && error.message) return error.message;
  return 'The newsroom API rejected the request.';
}

function isNextControlFlow(error: unknown): boolean {
  const digest = (error as { digest?: unknown }).digest;
  return typeof digest === 'string' && /^NEXT_(REDIRECT|NOT_FOUND)/.test(digest);
}

export default async function AdminSubmissionsPage({
  searchParams,
}: SubmissionsPageProps): Promise<React.JSX.Element> {
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

  let data: SubmissionsResponse | null = null;
  let error: string | null = null;
  try {
    data = await adminServerFetch<SubmissionsResponse>(`/admin/submissions?${params.toString()}`);
  } catch (caught) {
    // `adminServerFetch` signals an expired session with `redirect()`, which
    // works by throwing. Swallowing that would strand the operator here.
    if (isNextControlFlow(caught)) throw caught;
    error = errorText(caught);
  }

  const items = data?.submissions ?? [];
  const total = data?.total ?? 0;
  const filterQuery = { status, q };

  return (
    <>
      <div className="admin-head">
        <div>
          <h1>Submissions</h1>
          <p className="muted" style={{ margin: '4px 0 0' }}>
            {data
              ? `${formatNumber(total)} submission${total === 1 ? '' : 's'}${
                  status ? ` with status “${statusLabel(status)}”` : ''
                }`
              : 'The story inbox.'}
          </p>
        </div>
        <Link className={styles.panelLink} href="/admin">
          ← Overview
        </Link>
      </div>

      <AdminFilters action="/admin/submissions" statuses={STATUS_OPTIONS} status={status} q={q} />

      {error ? (
        <div className={`alert alert--error ${styles.noticeBar}`} role="alert">
          <h3>Submissions could not be loaded</h3>
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
              ? 'No submissions match these filters. Try a different status or clear the search.'
              : 'The inbox is empty. Nothing has been filed yet.'}
          </p>
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <caption className="visually-hidden">
                Submissions, newest first, with submitter, category, status and risk
              </caption>
              <thead>
                <tr>
                  <th scope="col">Headline</th>
                  <th scope="col">Submitter</th>
                  <th scope="col">Category</th>
                  <th scope="col">Status</th>
                  <th scope="col">Risk</th>
                  <th scope="col">Created</th>
                </tr>
              </thead>
              <tbody>
                {items.map((submission) => (
                  <tr key={submission.id}>
                    <td className="title-cell">
                      <div className={styles.titleStack}>
                        <Link href={`/admin/submissions/${submission.id}`}>
                          {submission.headline}
                        </Link>
                        <span className={styles.titleMeta}>
                          {submission.imageCount > 0
                            ? `${submission.imageCount} photo${submission.imageCount === 1 ? '' : 's'} · `
                            : ''}
                          {submission.articleId ? 'has article · ' : ''}
                          {submission.aiAttempts > 0
                            ? `AI attempts ${submission.aiAttempts}`
                            : 'no AI run'}
                        </span>
                      </div>
                    </td>
                    <td>
                      <div className={styles.titleStack}>
                        <span>
                          {submission.anonymous ? 'Anonymous' : submission.authorName || 'Unnamed'}
                        </span>
                        {submission.discordHandle ? (
                          <span className={styles.titleMeta}>{submission.discordHandle}</span>
                        ) : null}
                      </div>
                    </td>
                    <td className={styles.cellMuted}>{submission.category ?? '—'}</td>
                    <td>
                      <span className={statusBadgeClass(submission.status)}>
                        {statusLabel(submission.status)}
                      </span>
                    </td>
                    <td className={styles.num}>
                      <span title={`Spam score ${riskText(submission.spamScore)}`}>
                        {riskText(submission.spamScore)}
                      </span>
                    </td>
                    <td className={styles.num}>
                      <time
                        dateTime={submission.createdAt}
                        title={formatDateTime(submission.createdAt)}
                      >
                        {relativeTime(submission.createdAt)}
                      </time>
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
          basePath="/admin/submissions"
          page={page}
          limit={PAGE_SIZE}
          total={total}
          query={filterQuery}
          noun="submissions"
        />
      ) : null}
    </>
  );
}
