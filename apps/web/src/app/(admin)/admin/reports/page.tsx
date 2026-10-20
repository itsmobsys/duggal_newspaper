import type { Metadata } from 'next';
import Link from 'next/link';
import { ReportActions } from '@/components/admin/ReportActions';
import { adminServerFetch } from '@/lib/admin-server';
import { formatDateTime } from '@/lib/format';
import styles from '@/components/admin/ops.module.css';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Reports',
  robots: { index: false, follow: false },
};

const REPORT_STATUSES = ['open', 'resolved', 'dismissed'] as const;

type ReportStatus = (typeof REPORT_STATUSES)[number];

interface ReportRecord {
  id: string;
  article_id: string | null;
  reason: string;
  detail: string | null;
  reporter_contact: string | null;
  status: ReportStatus;
  resolution_note: string | null;
  created_at: string;
  resolved_at: string | null;
  resolved_by: string | null;
  slug: string | null;
  headline: string | null;
}

interface ReportsResponse {
  reports: ReportRecord[];
}

function isNextControlFlow(error: unknown): boolean {
  const digest = (error as { digest?: unknown } | null)?.digest;
  return typeof digest === 'string' && /^NEXT_(REDIRECT|NOT_FOUND)/.test(digest);
}

function errorText(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return 'The newsroom API rejected the request.';
}

function first(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? '';
  return value ?? '';
}

function isReportStatus(value: string): value is ReportStatus {
  return (REPORT_STATUSES as readonly string[]).includes(value);
}

function reportBadgeClass(status: ReportStatus): string {
  switch (status) {
    case 'resolved':
      return 'badge badge--ok';
    case 'dismissed':
      return 'badge badge--muted';
    default:
      return 'badge badge--warn';
  }
}

interface ReportsPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function ReportsPage({
  searchParams,
}: ReportsPageProps): Promise<React.JSX.Element> {
  const query = await searchParams;
  const rawStatus = first(query.status).trim();
  const status = isReportStatus(rawStatus) ? rawStatus : '';

  const request = new URLSearchParams({ limit: '100' });
  if (status) request.set('status', status);

  let reports: ReportRecord[] | null = null;
  let error: string | null = null;

  try {
    const data = await adminServerFetch<ReportsResponse>(`/admin/reports?${request.toString()}`);
    reports = data.reports;
  } catch (caught) {
    if (isNextControlFlow(caught)) throw caught;
    error = errorText(caught);
  }

  return (
    <>
      <div className="admin-head">
        <div>
          <h1>Reports</h1>
          <p className="muted" style={{ margin: '4px 0 0' }}>
            Reader complaints about published stories. Closing one changes the record, not the
            article.
          </p>
        </div>
      </div>

      {error ? (
        <div className={`alert alert--error ${styles.noticeBar}`} role="alert">
          <h3>Reports could not be loaded</h3>
          <p>{error}</p>
          <p className={styles.actionMessage}>Nothing has been changed.</p>
        </div>
      ) : null}

      <form className="toolbar" method="get" action="/admin/reports">
        <div className={styles.filter}>
          <label className={styles.filterLabel} htmlFor="report-status-filter">
            Status
          </label>
          <select className="select" id="report-status-filter" name="status" defaultValue={status}>
            <option value="">Any status</option>
            {REPORT_STATUSES.map((option) => (
              <option value={option} key={option}>
                {option}
              </option>
            ))}
          </select>
        </div>
        <button className="button button--sm" type="submit">
          Filter
        </button>
        {status ? (
          <Link className="button button--ghost button--sm" href="/admin/reports">
            Clear
          </Link>
        ) : null}
      </form>

      {reports && reports.length === 0 ? (
        <div className="empty-state">
          <h2>Nothing reported</h2>
          <p>
            {status
              ? `No reports with the status "${status}". It may be time to be smug.`
              : 'No reader complaints on file. The paper is either accurate or unread.'}
          </p>
        </div>
      ) : null}

      {reports && reports.length > 0 ? (
        <div className="table-wrap">
          <table className="data-table">
            <caption className="visually-hidden">
              Reader reports{status ? ` with status ${status}` : ''}, newest first. The API returns
              at most 100.
            </caption>
            <thead>
              <tr>
                <th scope="col">Received</th>
                <th scope="col">Story</th>
                <th scope="col">Reason</th>
                <th scope="col">Status</th>
                <th scope="col">Reporter</th>
                <th scope="col">Actions</th>
              </tr>
            </thead>
            <tbody>
              {reports.map((report) => (
                <tr key={report.id}>
                  <td className={styles.cellMuted}>
                    <span className={styles.mono}>{formatDateTime(report.created_at)}</span>
                  </td>
                  <td className={styles.cellStack}>
                    {report.slug ? (
                      <Link
                        className={styles.mono}
                        href={`/article/${report.slug}`}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        {report.headline || report.slug} ↗
                      </Link>
                    ) : (
                      <span className="muted">No linked article</span>
                    )}
                    {report.article_id ? (
                      <span className={styles.hash}>{report.article_id}</span>
                    ) : null}
                  </td>
                  <td className={styles.cellStack}>
                    <span>{report.reason}</span>
                    {report.detail ? (
                      <details className={styles.details}>
                        <summary>Detail</summary>
                        <p className={styles.detailText}>{report.detail}</p>
                      </details>
                    ) : null}
                    {report.resolution_note || report.resolved_by ? (
                      <details className={styles.details}>
                        <summary>Resolution</summary>
                        {report.resolution_note ? (
                          <p className={styles.detailText}>{report.resolution_note}</p>
                        ) : null}
                        <p className={styles.detailText}>
                          {report.resolved_by ? `By ${report.resolved_by}` : 'No operator recorded'}
                          {report.resolved_at ? ` · ${formatDateTime(report.resolved_at)}` : ''}
                        </p>
                      </details>
                    ) : null}
                  </td>
                  <td>
                    <span className={reportBadgeClass(report.status)}>{report.status}</span>
                  </td>
                  <td className={styles.cellMuted}>
                    {report.reporter_contact || <span className="muted">Not supplied</span>}
                  </td>
                  <td>
                    <ReportActions reportId={report.id} currentStatus={report.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      <p className={styles.actionMessage}>
        Reports are internal records. Resolving or dismissing one does not edit, unpublish or
        annotate the story - use a correction or the article editor for that.
      </p>
    </>
  );
}
