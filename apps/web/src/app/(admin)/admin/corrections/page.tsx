import type { Metadata } from 'next';
import Link from 'next/link';
import { CorrectionActions } from '@/components/admin/CorrectionActions';
import { adminServerFetch } from '@/lib/admin-server';
import { formatDateTime } from '@/lib/format';
import styles from '@/components/admin/ops.module.css';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Corrections',
  robots: { index: false, follow: false },
};

type CorrectionStatus = 'pending' | 'accepted' | 'rejected';

interface CorrectionRecord {
  id: string;
  article_id: string;
  summary: string;
  detail: string | null;
  status: CorrectionStatus;
  submitted_by: string | null;
  admin_id: string | null;
  created_at: string;
  applied_at: string | null;
  slug: string | null;
  headline: string | null;
}

interface CorrectionsResponse {
  corrections: CorrectionRecord[];
}

function isNextControlFlow(error: unknown): boolean {
  const digest = (error as { digest?: unknown } | null)?.digest;
  return typeof digest === 'string' && /^NEXT_(REDIRECT|NOT_FOUND)/.test(digest);
}

function errorText(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return 'The newsroom API rejected the request.';
}

function correctionBadgeClass(status: CorrectionStatus): string {
  switch (status) {
    case 'accepted':
      return 'badge badge--ok';
    case 'rejected':
      return 'badge badge--muted';
    default:
      return 'badge badge--warn';
  }
}

export default async function CorrectionsPage(): Promise<React.JSX.Element> {
  let corrections: CorrectionRecord[] | null = null;
  let error: string | null = null;

  try {
    const data = await adminServerFetch<CorrectionsResponse>('/admin/corrections');
    corrections = data.corrections;
  } catch (caught) {
    if (isNextControlFlow(caught)) throw caught;
    error = errorText(caught);
  }

  return (
    <>
      <div className="admin-head">
        <div>
          <h1>Corrections</h1>
          <p className="muted" style={{ margin: '4px 0 0' }}>
            Reader-submitted corrections. Accepting one edits the live article body.
          </p>
        </div>
      </div>

      {error ? (
        <div className={`alert alert--error ${styles.noticeBar}`} role="alert">
          <h3>Corrections could not be loaded</h3>
          <p>{error}</p>
          <p className={styles.actionMessage}>Nothing has been changed.</p>
        </div>
      ) : null}

      {!error ? (
        <div className="alert alert--warn">
          <h3>Accepting edits the public article</h3>
          <p>
            Accepting appends <em>Correction (date): summary</em> to the published article body and
            revalidates the story page and front page immediately. Rejecting leaves the article
            untouched. The note you type is written to the audit log only.
          </p>
        </div>
      ) : null}

      {corrections && corrections.length === 0 ? (
        <div className="empty-state">
          <h2>No corrections on file</h2>
          <p>Nobody has asked the paper to correct itself yet.</p>
        </div>
      ) : null}

      {corrections && corrections.length > 0 ? (
        <div className="table-wrap">
          <table className="data-table">
            <caption className="visually-hidden">Corrections, newest first (last 100)</caption>
            <thead>
              <tr>
                <th scope="col">Received</th>
                <th scope="col">Story</th>
                <th scope="col">Summary</th>
                <th scope="col">Status</th>
                <th scope="col">Submitted by</th>
                <th scope="col">Actions</th>
              </tr>
            </thead>
            <tbody>
              {corrections.map((correction) => (
                <tr key={correction.id}>
                  <td className={styles.cellMuted}>
                    <span className={styles.mono}>{formatDateTime(correction.created_at)}</span>
                  </td>
                  <td className={styles.cellStack}>
                    {correction.slug ? (
                      <Link
                        className={styles.mono}
                        href={`/article/${correction.slug}`}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        {correction.headline || correction.slug} ↗
                      </Link>
                    ) : (
                      <span className="muted">Article unavailable</span>
                    )}
                    <span className={styles.hash}>{correction.article_id}</span>
                  </td>
                  <td className={styles.cellStack}>
                    <span>{correction.summary}</span>
                    {correction.detail ? (
                      <details className={styles.details}>
                        <summary>Detail</summary>
                        <p className={styles.detailText}>{correction.detail}</p>
                      </details>
                    ) : null}
                    {correction.admin_id || correction.applied_at ? (
                      <details className={styles.details}>
                        <summary>Decision</summary>
                        <p className={styles.detailText}>
                          {correction.admin_id
                            ? `By ${correction.admin_id}`
                            : 'No operator recorded'}
                          {correction.applied_at
                            ? ` · applied ${formatDateTime(correction.applied_at)}`
                            : ' · not applied'}
                        </p>
                      </details>
                    ) : null}
                  </td>
                  <td>
                    <span className={correctionBadgeClass(correction.status)}>
                      {correction.status}
                    </span>
                  </td>
                  <td className={styles.cellMuted}>
                    {correction.submitted_by || <span className="muted">Anonymous</span>}
                  </td>
                  <td>
                    {correction.status === 'pending' ? (
                      <CorrectionActions correctionId={correction.id} />
                    ) : (
                      <span className="muted">Already {correction.status}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </>
  );
}
