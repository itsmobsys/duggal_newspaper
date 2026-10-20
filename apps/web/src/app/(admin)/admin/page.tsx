import type { Metadata } from 'next';
import Link from 'next/link';
import { WorkerTickButton } from '@/components/admin/WorkerTickButton';
import { adminServerFetch } from '@/lib/admin-server';
import { formatNumber, relativeTime } from '@/lib/format';
import styles from '@/components/admin/admin.module.css';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Overview',
  robots: { index: false, follow: false },
};

/** Shapes returned by the admin API. Kept local: the console owns its views. */
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
  reports: number;
  corrections: number;
  ai: {
    configured: boolean;
    model: string;
    calls24h: number;
    tokens24h: number;
    errors24h: number;
  };
  editions: number;
  autonomy: {
    enabled: unknown;
    autoPublish: unknown;
    editionHour: unknown;
    timezone: unknown;
  };
  storage: { configured: boolean; mode: string };
}

interface AiHealth {
  available: boolean;
  model: string;
  modelsSeen: number;
  error?: string;
  configuredBaseUrl: string;
  rpmLimit: number;
  jsonMode: boolean;
}

interface JobRecord {
  id: string;
  type: string;
  status: string;
  attempts: number;
  max_attempts: number;
  last_error: string | null;
  updated_at: string;
}

interface JobsResponse {
  jobs: JobRecord[];
  stats: unknown;
}

interface SubmissionListItem {
  id: string;
  headline: string;
  authorName: string;
  discordHandle: string | null;
  anonymous: boolean;
  category: string | null;
  status: string;
  createdAt: string;
}

interface SubmissionsResponse {
  total: number;
  submissions: SubmissionListItem[];
}

function readResult<T>(result: PromiseSettledResult<T>): T | null {
  return result.status === 'fulfilled' ? result.value : null;
}

function errorText(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return 'The newsroom API rejected the request.';
}

/**
 * `adminServerFetch` redirects to the login screen when a session has expired.
 * `redirect()` works by throwing, and Promise.allSettled would otherwise swallow
 * that signal, leaving the console stuck on a half-rendered page.
 */
function rethrowNextControlFlow(results: ReadonlyArray<PromiseSettledResult<unknown>>): void {
  for (const result of results) {
    if (result.status !== 'rejected') continue;
    const digest = (result.reason as { digest?: unknown }).digest;
    if (typeof digest === 'string' && /^NEXT_(REDIRECT|NOT_FOUND)/.test(digest)) {
      throw result.reason;
    }
  }
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

export default async function AdminOverviewPage(): Promise<React.JSX.Element> {
  const settled = await Promise.allSettled([
    adminServerFetch<StatsResponse>('/admin/stats'),
    adminServerFetch<AiHealth>('/admin/ai/health'),
    adminServerFetch<JobsResponse>('/admin/jobs?status=failed&limit=5'),
    adminServerFetch<SubmissionsResponse>('/admin/submissions?limit=5'),
  ] as const);

  rethrowNextControlFlow(settled);

  const [statsResult, healthResult, jobsResult, submissionsResult] = settled;
  const stats = readResult(statsResult);
  const health = readResult(healthResult);
  const jobs = readResult(jobsResult);
  const submissions = readResult(submissionsResult);

  const failures: string[] = [];
  if (statsResult.status === 'rejected') {
    failures.push(`Newsroom counts could not be loaded. ${errorText(statsResult.reason)}`);
  }
  if (healthResult.status === 'rejected') {
    failures.push(`AI desk status could not be loaded. ${errorText(healthResult.reason)}`);
  }
  if (jobsResult.status === 'rejected') {
    failures.push(`Failed jobs could not be loaded. ${errorText(jobsResult.reason)}`);
  }
  if (submissionsResult.status === 'rejected') {
    failures.push(`Newest submissions could not be loaded. ${errorText(submissionsResult.reason)}`);
  }

  const failedJobs = jobs?.jobs ?? [];
  const newest = submissions?.submissions ?? [];

  return (
    <>
      <div className="admin-head">
        <div>
          <h1>Overview</h1>
          <p className="muted" style={{ margin: '4px 0 0' }}>
            {stats
              ? `${stats.articles.published} published stories · ${stats.submissions.total} submissions on file`
              : 'The newsroom at a glance.'}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
          <Link className="button button--primary" href="/admin/publish">
            Build the paper now
          </Link>
          <WorkerTickButton />
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
            Nothing has been changed. Reload once the API is reachable.
          </p>
        </div>
      ) : null}

      {stats ? (
        <>
          <section className="stat-grid" aria-label="Newsroom statistics">
            <div className="stat">
              <div className="label">Published articles</div>
              <div className="value">{formatNumber(stats.articles.published)}</div>
              <div className={styles.statMeta}>
                {formatNumber(stats.articles.total)} total on file
              </div>
            </div>
            <div className="stat">
              <div className="label">Submissions</div>
              <div className="value">{formatNumber(stats.submissions.total)}</div>
              <div className={styles.statMeta}>
                {formatNumber(stats.submissions.received)} received ·{' '}
                {formatNumber(stats.submissions.failed)} failed
              </div>
            </div>
            <div className="stat">
              <div className="label">Awaiting review</div>
              <div className="value">{formatNumber(stats.submissions.review)}</div>
              <div className={styles.statMeta}>
                {formatNumber(stats.submissions.processing)} processing right now
              </div>
            </div>
            <div className="stat">
              <div className="label">Failed jobs</div>
              <div className="value">{formatNumber(stats.queue.dead)}</div>
              <div className={styles.statMeta}>
                {formatNumber(stats.queue.pending)} pending · {formatNumber(stats.queue.leased)}{' '}
                leased
              </div>
            </div>
            <div className="stat">
              <div className="label">AI calls · 24h</div>
              <div className="value">{formatNumber(stats.ai.calls24h)}</div>
              <div className={styles.statMeta}>
                {formatNumber(stats.ai.tokens24h)} tokens · {formatNumber(stats.ai.errors24h)}{' '}
                errors
              </div>
            </div>
            <div className="stat">
              <div className="label">Editions</div>
              <div className="value">{formatNumber(stats.editions)}</div>
              <div className={styles.statMeta}>
                {stats.autonomy.enabled === false ? 'Autonomy paused' : 'Autonomy armed'} ·{' '}
                {formatNumber(stats.queue.doneLast24h)} jobs done · 24h
              </div>
            </div>
          </section>

          <p className={styles.emptyLine}>
            The newsroom is autonomous; manual actions are exceptions, not the workflow. Every
            button on this console is written to the audit log.
          </p>

          <div className="admin-split" style={{ marginTop: 'var(--space-5)' }}>
            <div className="stack">
              <section className="panel" aria-labelledby="failed-jobs-heading">
                <div className={styles.panelHead}>
                  <h2 id="failed-jobs-heading">Failed jobs</h2>
                  <Link className={styles.panelLink} href="/admin/jobs">
                    Open job queue →
                  </Link>
                </div>
                {failedJobs.length === 0 ? (
                  <p className={styles.emptyLine}>
                    No failed jobs. Either the robot is behaving, or nothing has tried to do
                    anything yet.
                  </p>
                ) : (
                  <div className="table-wrap">
                    <table className="data-table">
                      <caption className="visually-hidden">
                        The five most recently failed jobs
                      </caption>
                      <thead>
                        <tr>
                          <th scope="col">Job</th>
                          <th scope="col">Type</th>
                          <th scope="col">Attempts</th>
                          <th scope="col">Last error</th>
                          <th scope="col">Updated</th>
                        </tr>
                      </thead>
                      <tbody>
                        {failedJobs.map((job) => (
                          <tr key={job.id}>
                            <td className={styles.num}>{job.id}</td>
                            <td>{job.type}</td>
                            <td className={styles.num}>
                              {job.attempts}/{job.max_attempts}
                            </td>
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
                            <td className={styles.num}>{relativeTime(job.updated_at)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>

              <section className="panel" aria-labelledby="new-submissions-heading">
                <div className={styles.panelHead}>
                  <h2 id="new-submissions-heading">Newest submissions</h2>
                  <Link className={styles.panelLink} href="/admin/submissions">
                    Open queue →
                  </Link>
                </div>
                {newest.length === 0 ? (
                  <p className={styles.emptyLine}>
                    The submission inbox is empty. Either the community is quiet, which would be a
                    first, or nobody can find the form.
                  </p>
                ) : (
                  <ul className={styles.plainList}>
                    {newest.map((submission) => (
                      <li className={styles.listItem} key={submission.id}>
                        <h3 className={styles.listHeadline}>
                          <Link href={`/admin/submissions/${submission.id}`}>
                            {submission.headline}
                          </Link>
                        </h3>
                        <div className={styles.listMeta}>
                          <span className={statusBadgeClass(submission.status)}>
                            {submission.status.replace('_', ' ')}
                          </span>
                          <span>
                            {submission.anonymous
                              ? 'Anonymous'
                              : submission.authorName || 'Unnamed'}
                          </span>
                          {submission.category ? <span>{submission.category}</span> : null}
                          <span>{relativeTime(submission.createdAt)}</span>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </div>

            <aside className="stack" aria-label="AI desk">
              <section className="panel" aria-labelledby="ai-desk-heading">
                <div className={styles.panelHead}>
                  <h2 id="ai-desk-heading">AI desk</h2>
                  {health ? (
                    <span className={health.available ? 'badge badge--ok' : 'badge badge--failed'}>
                      {health.available ? 'Online' : 'Unavailable'}
                    </span>
                  ) : null}
                </div>

                {!health ? (
                  <p className={styles.emptyLine}>
                    The AI desk did not answer. Check the API connection.
                  </p>
                ) : (
                  <dl className="kv">
                    <dt>Configured</dt>
                    <dd>{stats ? (stats.ai.configured ? 'Yes' : 'No API key') : 'Unknown'}</dd>
                    <dt>Model</dt>
                    <dd>{health.model || '—'}</dd>
                    <dt>Models seen</dt>
                    <dd>{formatNumber(health.modelsSeen)}</dd>
                    <dt>JSON mode</dt>
                    <dd>{health.jsonMode ? 'Enabled' : 'Disabled'}</dd>
                    <dt>Rate limit</dt>
                    <dd>{formatNumber(health.rpmLimit)} rpm</dd>
                    <dt>Endpoint</dt>
                    <dd className={styles.titleMeta}>{health.configuredBaseUrl || '—'}</dd>
                    <dt>Last error</dt>
                    <dd>
                      {health.error ? (
                        <span className="field-error">{health.error}</span>
                      ) : (
                        'None reported'
                      )}
                    </dd>
                  </dl>
                )}
              </section>

              {stats ? (
                <section className="panel" aria-labelledby="attention-heading">
                  <h2 id="attention-heading">Needs attention</h2>
                  <dl className="kv">
                    <dt>Open reports</dt>
                    <dd>{formatNumber(stats.reports)}</dd>
                    <dt>Pending corrections</dt>
                    <dd>{formatNumber(stats.corrections)}</dd>
                    <dt>Breaking</dt>
                    <dd>{formatNumber(stats.articles.breaking)} live</dd>
                    <dt>Storage</dt>
                    <dd>{stats.storage.configured ? stats.storage.mode : 'Not configured'}</dd>
                    <dt>Edition hour</dt>
                    <dd>
                      {String(stats.autonomy.editionHour ?? '—')} ·{' '}
                      {String(stats.autonomy.timezone ?? '—')}
                    </dd>
                  </dl>
                </section>
              ) : null}
            </aside>
          </div>
        </>
      ) : null}
    </>
  );
}
