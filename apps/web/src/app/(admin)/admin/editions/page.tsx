import type { Metadata } from 'next';
import Link from 'next/link';
import { EditionActions } from '@/components/admin/EditionActions';
import { adminServerFetch } from '@/lib/admin-server';
import { formatDateShort, formatDateTime, relativeTime } from '@/lib/format';
import styles from '@/components/admin/ops.module.css';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Editions',
  robots: { index: false, follow: false },
};

interface EditionRecord {
  edition_date: string;
  headline: string | null;
  summary: string | null;
  mood: string | null;
  lead_article_id: string | null;
  article_count: number;
  generated_by: string;
  ai_model: string | null;
  status: 'draft' | 'published';
  created_at: string;
  updated_at: string;
}

interface EditionsResponse {
  editions: EditionRecord[];
}

function isNextControlFlow(error: unknown): boolean {
  const digest = (error as { digest?: unknown } | null)?.digest;
  return typeof digest === 'string' && /^NEXT_(REDIRECT|NOT_FOUND)/.test(digest);
}

function errorText(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return 'The newsroom API rejected the request.';
}

function statusBadgeClass(status: EditionRecord['status']): string {
  return status === 'published' ? 'badge badge--ok' : 'badge badge--warn';
}

export default async function EditionsPage(): Promise<React.JSX.Element> {
  let editions: EditionRecord[] | null = null;
  let error: string | null = null;

  try {
    const data = await adminServerFetch<EditionsResponse>('/admin/editions');
    editions = data.editions;
  } catch (caught) {
    if (isNextControlFlow(caught)) throw caught;
    error = errorText(caught);
  }

  return (
    <>
      <div className="admin-head">
        <div>
          <h1>Editions</h1>
          <p className="muted" style={{ margin: '4px 0 0' }}>
            The stored front pages, newest first. The public edition lives at its own dated URL.
          </p>
        </div>
      </div>

      {error ? (
        <div className={`alert alert--error ${styles.noticeBar}`} role="alert">
          <h3>Editions could not be loaded</h3>
          <p>{error}</p>
          <p className={styles.actionMessage}>Nothing has been changed.</p>
        </div>
      ) : null}

      <section className="panel" aria-labelledby="edition-rebuild-heading">
        <h2 id="edition-rebuild-heading">Rebuild an edition</h2>
        <EditionActions />
        <p className={styles.groupNote} style={{ margin: 'var(--space-3) 0 0' }}>
          A rebuild queues a <code className={styles.mono}>build_edition</code> job that replaces
          the stored edition for the chosen date: it re-picks the lead, re-writes the headline and
          summary, and recomputes the article count. The action is written to the audit log. If the
          daily edition switch or autonomy is off, the API exits without touching anything.
        </p>
      </section>

      {editions && editions.length === 0 ? (
        <div className="empty-state">
          <h2>No editions stored</h2>
          <p>
            Nothing has been printed yet. Once the night desk runs - or you queue a rebuild above -
            the edition appears here.
          </p>
        </div>
      ) : null}

      {editions && editions.length > 0 ? (
        <div className="table-wrap" style={{ marginTop: 'var(--space-5)' }}>
          <table className="data-table">
            <caption className="visually-hidden">
              Stored editions, newest first. The API returns at most 60.
            </caption>
            <thead>
              <tr>
                <th scope="col">Edition</th>
                <th scope="col">Headline</th>
                <th scope="col">Status</th>
                <th scope="col">Stories</th>
                <th scope="col">Mood</th>
                <th scope="col">Produced by</th>
                <th scope="col">Updated</th>
              </tr>
            </thead>
            <tbody>
              {editions.map((edition) => (
                <tr key={edition.edition_date}>
                  <td className={styles.cellStack}>
                    <span className="title-cell">
                      <Link href={`/edition/${edition.edition_date}`}>
                        {formatDateShort(edition.edition_date)}
                      </Link>
                    </span>
                    <span className={styles.hash}>{edition.edition_date}</span>
                  </td>
                  <td className={styles.cellStack}>
                    {edition.headline ? (
                      edition.headline
                    ) : (
                      <span className="muted">No headline</span>
                    )}
                    {edition.summary ? (
                      <details className={styles.details}>
                        <summary>Summary</summary>
                        <p className={styles.detailText}>{edition.summary}</p>
                      </details>
                    ) : null}
                  </td>
                  <td>
                    <span className={statusBadgeClass(edition.status)}>{edition.status}</span>
                  </td>
                  <td className={styles.hash}>{edition.article_count}</td>
                  <td className={styles.cellMuted}>
                    {edition.mood || <span className="muted">—</span>}
                  </td>
                  <td className={styles.cellStack}>
                    <span className={styles.mono}>{edition.generated_by}</span>
                    {edition.ai_model ? (
                      <span className={styles.hash}>{edition.ai_model}</span>
                    ) : (
                      <span className="muted">No model recorded</span>
                    )}
                  </td>
                  <td className={styles.cellMuted}>
                    {relativeTime(edition.updated_at)}
                    <div className={styles.cellMuted}>{formatDateTime(edition.updated_at)}</div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      <p className={styles.actionMessage}>
        Editions are never edited by hand here. Rebuilding is the only action, and it overwrites the
        stored record for that date.
      </p>
    </>
  );
}
