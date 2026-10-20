import type { Metadata } from 'next';
import Link from 'next/link';
import { adminServerFetch } from '@/lib/admin-server';
import { formatDateTime } from '@/lib/format';
import styles from '@/components/admin/ops.module.css';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Audit log',
  robots: { index: false, follow: false },
};

const PAGE_SIZE = 50;

interface AuditLogRecord {
  id: string;
  actor: string;
  action: string;
  target_type: string | null;
  target_id: string | null;
  detail: string | null;
  created_at: string;
  /**
   * `SELECT *` returns this column even though the route's declared row type
   * omits it. It is optional here so a future API that drops it does not break
   * the page.
   */
  ip_hash?: string | null;
}

interface AuditResponse {
  logs: AuditLogRecord[];
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

function auditHref(page: number): string {
  return page > 1 ? `/admin/audit?page=${page}` : '/admin/audit';
}

function shortHash(hash: string | null | undefined): string {
  if (!hash) return '';
  return hash.length > 12 ? `${hash.slice(0, 12)}…` : hash;
}

interface AuditPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function AuditPage({
  searchParams,
}: AuditPageProps): Promise<React.JSX.Element> {
  const query = await searchParams;
  const parsedPage = Number.parseInt(first(query.page), 10);
  const page = Number.isFinite(parsedPage) && parsedPage > 0 ? parsedPage : 1;

  const request = new URLSearchParams({
    limit: String(PAGE_SIZE),
    offset: String((page - 1) * PAGE_SIZE),
  });

  let logs: AuditLogRecord[] | null = null;
  let error: string | null = null;

  try {
    const data = await adminServerFetch<AuditResponse>(`/admin/audit?${request.toString()}`);
    logs = data.logs;
  } catch (caught) {
    if (isNextControlFlow(caught)) throw caught;
    error = errorText(caught);
  }

  return (
    <>
      <div className="admin-head">
        <div>
          <h1>Audit log</h1>
          <p className="muted" style={{ margin: '4px 0 0' }}>
            Every operator action the API records, newest first. Read-only.
          </p>
        </div>
      </div>

      {error ? (
        <div className={`alert alert--error ${styles.noticeBar}`} role="alert">
          <h3>The audit log could not be loaded</h3>
          <p>{error}</p>
          <p className={styles.actionMessage}>Nothing has been changed.</p>
        </div>
      ) : null}

      {logs && logs.length === 0 ? (
        <div className="empty-state">
          <h2>No entries{page > 1 ? ' on this page' : ''}</h2>
          <p>
            {page > 1
              ? 'This page is past the end of the log.'
              : 'No audited actions yet. Publishing, moderating or changing settings will fill this in.'}
          </p>
        </div>
      ) : null}

      {logs && logs.length > 0 ? (
        <div className="table-wrap">
          <table className="data-table">
            <caption className="visually-hidden">Audit entries, newest first. Page {page}.</caption>
            <thead>
              <tr>
                <th scope="col">When</th>
                <th scope="col">Actor</th>
                <th scope="col">Action</th>
                <th scope="col">Target</th>
                <th scope="col">IP hash</th>
                <th scope="col">Detail</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((log) => (
                <tr key={log.id}>
                  <td className={styles.cellStack}>
                    <span className={styles.mono}>{formatDateTime(log.created_at)}</span>
                    <span className={styles.hash}>{log.id}</span>
                  </td>
                  <td className={styles.mono}>{log.actor}</td>
                  <td className={styles.cellStack}>
                    <span className={styles.mono}>{log.action}</span>
                  </td>
                  <td className={styles.cellStack}>
                    {log.target_type || log.target_id ? (
                      <>
                        <span className={styles.cellMuted}>
                          {log.target_type || 'unknown type'}
                        </span>
                        {log.target_id ? (
                          <span className={styles.hash}>{log.target_id}</span>
                        ) : null}
                      </>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                  <td className={styles.hash}>
                    {log.ip_hash ? shortHash(log.ip_hash) : <span className="muted">—</span>}
                  </td>
                  <td className={styles.cellStack}>
                    {log.detail ? (
                      <details className={styles.details}>
                        <summary>Metadata</summary>
                        <pre className={styles.metadata}>{log.detail}</pre>
                      </details>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {logs && (page > 1 || logs.length === PAGE_SIZE) ? (
        <nav className="pagination" aria-label="Audit pages">
          <span>
            Page {page} · {logs?.length ?? 0} entr{(logs?.length ?? 0) === 1 ? 'y' : 'ies'}
          </span>
          <span className="pages">
            {page > 1 ? (
              <Link href={auditHref(page - 1)}>← Previous</Link>
            ) : (
              <span className="muted">← Previous</span>
            )}
            {logs && logs.length === PAGE_SIZE ? (
              <Link href={auditHref(page + 1)}>Next →</Link>
            ) : (
              <span className="muted">Next →</span>
            )}
          </span>
        </nav>
      ) : null}

      <p className={styles.actionMessage}>
        The audit API has no actor, action or date filters and returns no total, so this screen
        pages blindly and Next appears only while a full page comes back. Metadata is shown exactly
        as the API stored it.
      </p>
    </>
  );
}
