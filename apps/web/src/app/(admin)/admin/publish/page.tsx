import type { Metadata } from 'next';
import Link from 'next/link';
import { PublishNow } from '@/components/admin/PublishNow';
import { adminServerFetch } from '@/lib/admin-server';
import { formatNumber, relativeTime } from '@/lib/format';
import styles from '@/components/admin/admin.module.css';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Build now',
  robots: { index: false, follow: false },
};

interface StatsResponse {
  submissions: {
    total: number;
    received: number;
    processing: number;
    review: number;
    published: number;
    rejected: number;
    failed: number;
  };
  articles: { total: number; published: number; breaking: number };
  queue: { pending: number; leased: number; dead: number; doneLast24h: number };
  editions: number;
  ai: { configured: boolean; model: string };
}

interface JobRecord {
  id: string;
  type: string;
  status: string;
  attempts: number;
  max_attempts: number;
  last_error: string | null;
  run_at: string;
  updated_at: string;
}

interface JobsResponse {
  jobs: JobRecord[];
}

function readResult<T>(result: PromiseSettledResult<T>): T | null {
  return result.status === 'fulfilled' ? result.value : null;
}

function errorText(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return 'The newsroom API rejected the request.';
}

/** `redirect()` throws; Promise.allSettled would swallow the login redirect. */
function rethrowNextControlFlow(results: ReadonlyArray<PromiseSettledResult<unknown>>): void {
  for (const result of results) {
    if (result.status !== 'rejected') continue;
    const digest = (result.reason as { digest?: unknown }).digest;
    if (typeof digest === 'string' && /^NEXT_(REDIRECT|NOT_FOUND)/.test(digest)) {
      throw result.reason;
    }
  }
}

function jobBadge(status: string): string {
  switch (status) {
    case 'done':
      return 'badge badge--published';
    case 'failed':
    case 'dead':
      return 'badge badge--failed';
    case 'leased':
      return 'badge badge--warn';
    default:
      return 'badge badge--info';
  }
}

export default async function BuildNowPage(): Promise<React.JSX.Element> {
  const settled = await Promise.allSettled([
    adminServerFetch<StatsResponse>('/admin/stats'),
    adminServerFetch<JobsResponse>('/admin/jobs?type=build_edition&limit=6'),
    adminServerFetch<JobsResponse>('/admin/jobs?status=pending&limit=6'),
  ] as const);

  rethrowNextControlFlow(settled);

  const [statsResult, buildsResult, pendingResult] = settled;
  const stats = readResult(statsResult);
  const builds = readResult(buildsResult)?.jobs ?? [];
  const pending = readResult(pendingResult)?.jobs ?? [];

  const failures: string[] = [];
  if (statsResult.status === 'rejected') {
    failures.push(`Queue counts could not be loaded. ${errorText(statsResult.reason)}`);
  }
  if (buildsResult.status === 'rejected') {
    failures.push(`Edition job history could not be loaded. ${errorText(buildsResult.reason)}`);
  }
  if (pendingResult.status === 'rejected') {
    failures.push(`Pending jobs could not be loaded. ${errorText(pendingResult.reason)}`);
  }

  const waiting = stats ? stats.submissions.received + stats.submissions.processing : null;

  return (
    <>
      <div className="admin-head">
        <div>
          <h1>Build the paper now</h1>
          <p className="muted" style={{ margin: '4px 0 0' }}>
            Send the waiting stories through the AI desk and rebuild the edition on the front page —
            without waiting for the 23:00 IST run.
          </p>
        </div>
      </div>

      {failures.length > 0 ? (
        <div className={`alert alert--error ${styles.noticeBar}`} role="alert">
          <h3>Some panels are unavailable</h3>
          <ul>
            {failures.map((message) => (
              <li key={message}>{message}</li>
            ))}
          </ul>
          <p className={styles.actionNote}>
            You can still queue a build; the API validates the queue itself.
          </p>
        </div>
      ) : null}

      <section className="panel" aria-labelledby="snapshot-heading">
        <div className={styles.panelHead}>
          <h2 id="snapshot-heading">Right now</h2>
          <Link className={styles.panelLink} href="/admin/jobs">
            Open job queue →
          </Link>
        </div>
        {stats ? (
          <dl className="kv">
            <dt>Waiting to be processed</dt>
            <dd>{formatNumber(waiting ?? 0)} submissions</dd>
            <dt>Processing</dt>
            <dd>{formatNumber(stats.submissions.processing)} right now</dd>
            <dt>Held for review</dt>
            <dd>{formatNumber(stats.submissions.review)}</dd>
            <dt>Failed submissions</dt>
            <dd>{formatNumber(stats.submissions.failed)}</dd>
            <dt>Pending jobs</dt>
            <dd>
              {formatNumber(stats.queue.pending)} pending · {formatNumber(stats.queue.leased)}{' '}
              leased · {formatNumber(stats.queue.dead)} dead
            </dd>
            <dt>Published stories</dt>
            <dd>{formatNumber(stats.articles.published)}</dd>
            <dt>AI desk</dt>
            <dd>{stats.ai.configured ? stats.ai.model : 'No NVIDIA_API_KEY configured'}</dd>
          </dl>
        ) : (
          <p className={styles.emptyLine}>Queue counts are unavailable.</p>
        )}
      </section>

      <section className="panel" aria-labelledby="action-heading">
        <h2 id="action-heading">Queue an instant build</h2>
        <p className={styles.emptyLine}>
          What happens after you press the button: waiting submissions are rewritten and published
          under the normal moderation rules, then the edition rebuild waits for that queue to drain
          (up to 15 minutes) and re-lays out the front page. Held stories stay held — publish those
          individually if you have reviewed them.
        </p>
        <PublishNow />
      </section>

      {pending.length > 0 ? (
        <section className="panel" aria-labelledby="pending-heading">
          <h2 id="pending-heading">Queued work</h2>
          <div className="table-wrap">
            <table className="data-table">
              <caption className="visually-hidden">Pending jobs, highest priority first</caption>
              <thead>
                <tr>
                  <th scope="col">Job</th>
                  <th scope="col">Type</th>
                  <th scope="col">Status</th>
                  <th scope="col">Runs</th>
                </tr>
              </thead>
              <tbody>
                {pending.map((job) => (
                  <tr key={job.id}>
                    <td className={styles.num}>{job.id}</td>
                    <td>{job.type}</td>
                    <td>
                      <span className={jobBadge(job.status)}>{job.status}</span>
                    </td>
                    <td className={styles.num}>{relativeTime(job.run_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      <section className="panel" aria-labelledby="builds-heading">
        <div className={styles.panelHead}>
          <h2 id="builds-heading">Recent edition builds</h2>
          <Link className={styles.panelLink} href="/admin/editions">
            Open editions →
          </Link>
        </div>
        {builds.length === 0 ? (
          <p className={styles.emptyLine}>
            No edition build has run yet. The first one happens automatically at 23:00 IST, or when
            you press the button above.
          </p>
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <caption className="visually-hidden">The six most recent edition build jobs</caption>
              <thead>
                <tr>
                  <th scope="col">Job</th>
                  <th scope="col">Status</th>
                  <th scope="col">Attempts</th>
                  <th scope="col">Updated</th>
                  <th scope="col">Last error</th>
                </tr>
              </thead>
              <tbody>
                {builds.map((job) => (
                  <tr key={job.id}>
                    <td className={styles.num}>{job.id}</td>
                    <td>
                      <span className={jobBadge(job.status)}>{job.status}</span>
                    </td>
                    <td className={styles.num}>
                      {job.attempts}/{job.max_attempts}
                    </td>
                    <td className={styles.num}>{relativeTime(job.updated_at)}</td>
                    <td className={styles.cellMuted}>
                      {job.last_error ? (
                        <span title={job.last_error}>
                          {job.last_error.length > 120
                            ? `${job.last_error.slice(0, 120)}…`
                            : job.last_error}
                        </span>
                      ) : (
                        '—'
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
