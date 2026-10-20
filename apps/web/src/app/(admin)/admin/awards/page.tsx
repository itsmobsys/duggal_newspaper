import type { Metadata } from 'next';
import { AwardForm } from '@/components/admin/AwardForm';
import { adminServerFetch } from '@/lib/admin-server';
import { formatDateShort, relativeTime } from '@/lib/format';
import styles from '@/components/admin/ops.module.css';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Awards',
  robots: { index: false, follow: false },
};

interface AwardRecord {
  id: string;
  title: string;
  category: string | null;
  winner_name: string;
  winner_member_id: string | null;
  citation: string | null;
  edition_date: string | null;
  article_id: string | null;
  auto_generated: number;
  active: number;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

interface AwardsResponse {
  awards: AwardRecord[];
}

function isNextControlFlow(error: unknown): boolean {
  const digest = (error as { digest?: unknown } | null)?.digest;
  return typeof digest === 'string' && /^NEXT_(REDIRECT|NOT_FOUND)/.test(digest);
}

function errorText(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return 'The newsroom API rejected the request.';
}

export default async function AwardsPage(): Promise<React.JSX.Element> {
  let awards: AwardRecord[] | null = null;
  let error: string | null = null;

  try {
    const data = await adminServerFetch<AwardsResponse>('/admin/awards');
    awards = data.awards;
  } catch (caught) {
    if (isNextControlFlow(caught)) throw caught;
    error = errorText(caught);
  }

  return (
    <>
      <div className="admin-head">
        <div>
          <h1>Awards</h1>
          <p className="muted" style={{ margin: '4px 0 0' }}>
            Weekly honours from the night desk and the ones you add by hand. Lower sort order prints
            first.
          </p>
        </div>
      </div>

      {error ? (
        <div className={`alert alert--error ${styles.noticeBar}`} role="alert">
          <h3>Awards could not be loaded</h3>
          <p>{error}</p>
          <p className={styles.actionMessage}>Nothing has been changed.</p>
        </div>
      ) : null}

      <div className="admin-split">
        <div className="stack">
          <section className="panel" aria-labelledby="award-list-heading">
            <div className={styles.groupHead}>
              <h2 id="award-list-heading">All awards</h2>
              {awards ? <span className="badge badge--muted">{awards.length} total</span> : null}
            </div>

            {awards && awards.length === 0 ? (
              <div className="empty-state">
                <h2>No awards yet</h2>
                <p>Add the first one with the form beside this table.</p>
              </div>
            ) : null}

            {awards && awards.length > 0 ? (
              <div className="table-wrap">
                <table className="data-table">
                  <caption className="visually-hidden">
                    All awards, ordered by sort order then newest first.
                  </caption>
                  <thead>
                    <tr>
                      <th scope="col">Award</th>
                      <th scope="col">Winner</th>
                      <th scope="col">Category</th>
                      <th scope="col">Edition</th>
                      <th scope="col">Source</th>
                      <th scope="col">Order</th>
                      <th scope="col">Visible</th>
                      <th scope="col">Updated</th>
                    </tr>
                  </thead>
                  <tbody>
                    {awards.map((award) => (
                      <tr key={award.id}>
                        <td className={styles.cellStack}>
                          <span className="title-cell">{award.title}</span>
                          <span className={styles.hash}>{award.id}</span>
                          {award.citation ? (
                            <details className={styles.details}>
                              <summary>Citation</summary>
                              <p className={styles.detailText}>{award.citation}</p>
                            </details>
                          ) : null}
                        </td>
                        <td className={styles.cellStack}>
                          <span>{award.winner_name}</span>
                          {award.winner_member_id ? (
                            <span className={styles.hash}>{award.winner_member_id}</span>
                          ) : null}
                        </td>
                        <td className={styles.cellMuted}>
                          {award.category || <span className="muted">—</span>}
                        </td>
                        <td className={styles.cellStack}>
                          {award.edition_date ? (
                            <span className={styles.mono}>
                              {formatDateShort(award.edition_date)}
                            </span>
                          ) : (
                            <span className="muted">—</span>
                          )}
                          {award.article_id ? (
                            <span className={styles.hash}>{award.article_id}</span>
                          ) : null}
                        </td>
                        <td>
                          <span
                            className={
                              award.auto_generated === 1
                                ? 'badge badge--info'
                                : 'badge badge--muted'
                            }
                          >
                            {award.auto_generated === 1 ? 'Auto' : 'Manual'}
                          </span>
                        </td>
                        <td className={styles.hash}>{award.sort_order}</td>
                        <td>
                          <span
                            className={
                              award.active === 1 ? 'badge badge--ok' : 'badge badge--muted'
                            }
                          >
                            {award.active === 1 ? 'Live' : 'Hidden'}
                          </span>
                        </td>
                        <td className={styles.cellMuted}>{relativeTime(award.updated_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}

            <p className={styles.actionMessage}>
              The API also supports editing and deleting awards, but neither control is exposed on
              this screen yet. Any change made elsewhere is written to the audit log.
            </p>
          </section>
        </div>

        <aside className="stack" aria-label="Create award">
          <section className="panel" aria-labelledby="award-create-heading">
            <h2 id="award-create-heading">Create an award</h2>
            <AwardForm />
          </section>
        </aside>
      </div>
    </>
  );
}
