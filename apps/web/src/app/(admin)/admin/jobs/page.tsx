import type { Metadata } from 'next';
import Link from 'next/link';
import { JobActions } from '@/components/admin/JobActions';
import { adminServerFetch } from '@/lib/admin-server';
import { formatDateTime, formatNumber, relativeTime } from '@/lib/format';
import styles from '@/components/admin/ops.module.css';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Jobs',
  robots: { index: false, follow: false },
};

const JOB_STATUSES = ['pending', 'leased', 'done', 'failed', 'dead'] as const;
const PAGE_SIZE = 25;

type JobStatus = (typeof JOB_STATUSES)[number];

interface JobRecord {
  id: string;
  type: string;
  status: string;
  attempts: number;
  max_attempts: number;
  run_at: string;
  last_error: string | null;
  created_at: string;
  updated_at: string;
  finished_at: string | null;
}

interface JobsResponse {
  jobs: JobRecord[];
  stats: { pending: number; leased: number; dead: number; doneLast24h: number };
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

function isJobStatus(value: string): value is JobStatus {
  return (JOB_STATUSES as readonly string[]).includes(value);
}

function jobBadgeClass(status: string): string {
  switch (status) {
    case 'done':
      return 'badge badge--ok';
    case 'failed':
    case 'dead':
      return 'badge badge--failed';
    case 'leased':
      return 'badge badge--warn';
    default:
      return 'badge badge--info';
  }
}

function jobsHref(state: { status: string; type: string; page: number }): string {
  const params = new URLSearchParams();
  if (state.status) params.set('status', state.status);
  if (state.type) params.set('type', state.type);
  if (state.page > 1) params.set('page', String(state.page));
  const query = params.toString();
  return query ? `/admin/jobs?${query}` : '/admin/jobs';
}

interface JobsPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function JobsPage({
  searchParams,
}: JobsPageProps): Promise<React.JSX.Element> {
  const query = await searchParams;
  const rawStatus = first(query.status).trim();
  const status = isJobStatus(rawStatus) ? rawStatus : '';
  const type = first(query.type).trim().slice(0, 60);
  const parsedPage = Number.parseInt(first(query.page), 10);
  const page = Number.isFinite(parsedPage) && parsedPage > 0 ? parsedPage : 1;

  const request = new URLSearchParams({
    limit: String(PAGE_SIZE),
    offset: String((page - 1) * PAGE_SIZE),
  });
  if (status) request.set('status', status);
  if (type) request.set('type', type);

  let data: JobsResponse | null = null;
  let error: string | null = null;

  try {
    data = await adminServerFetch<JobsResponse>(`/admin/jobs?${request.toString()}`);
  } catch (caught) {
    if (isNextControlFlow(caught)) throw caught;
    error = errorText(caught);
  }

  const jobs = data?.jobs ?? [];
  const stats = data?.stats ?? null;
  const filtered = Boolean(status || type);

  return (
    <>
      <div className="admin-head">
        <div>
          <h1>Jobs</h1>
          <p className="muted" style={{ margin: '4px 0 0' }}>
            The worker queue: submissions, editions and award runs, in the order the night desk will
            get to them.
          </p>
        </div>
      </div>

      {error ? (
        <div className={`alert alert--error ${styles.noticeBar}`} role="alert">
          <h3>Jobs could not be loaded</h3>
          <p>{error}</p>
          <p className={styles.actionMessage}>Nothing has been changed.</p>
        </div>
      ) : null}

      {stats ? (
        <section className="stat-grid" aria-label="Queue statistics">
          <div className="stat">
            <div className="label">Pending</div>
            <div className="value">{formatNumber(stats.pending)}</div>
          </div>
          <div className="stat">
            <div className="label">Leased</div>
            <div className="value">{formatNumber(stats.leased)}</div>
          </div>
          <div className="stat">
            <div className="label">Dead</div>
            <div className="value">{formatNumber(stats.dead)}</div>
          </div>
          <div className="stat">
            <div className="label">Done · 24h</div>
            <div className="value">{formatNumber(stats.doneLast24h)}</div>
          </div>
        </section>
      ) : null}

      <form className="toolbar" method="get" action="/admin/jobs">
        <div className={styles.filter}>
          <label className={styles.filterLabel} htmlFor="job-status-filter">
            Status
          </label>
          <select className="select" id="job-status-filter" name="status" defaultValue={status}>
            <option value="">Any status</option>
            {JOB_STATUSES.map((option) => (
              <option value={option} key={option}>
                {option}
              </option>
            ))}
          </select>
        </div>
        <div className={styles.filter}>
          <label className={styles.filterLabel} htmlFor="job-type-filter">
            Job type
          </label>
          <input
            className="input"
            id="job-type-filter"
            type="text"
            name="type"
            defaultValue={type}
            maxLength={60}
            placeholder="process_submission"
          />
        </div>
        <button className="button button--sm" type="submit">
          Filter
        </button>
        {filtered ? (
          <Link className="button button--ghost button--sm" href="/admin/jobs">
            Clear
          </Link>
        ) : null}
      </form>

      {data && jobs.length === 0 ? (
        <div className="empty-state">
          <h2>No jobs match</h2>
          <p>
            {filtered
              ? 'Nothing in the queue matches these filters. Clear them to see the whole queue.'
              : 'The queue is empty. Either everything is done or nothing has been enqueued yet.'}
          </p>
        </div>
      ) : null}

      {jobs.length > 0 ? (
        <div className="table-wrap">
          <table className="data-table">
            <caption className="visually-hidden">
              Worker jobs{filtered ? ', filtered' : ''}. Page {page}.
            </caption>
            <thead>
              <tr>
                <th scope="col">Job</th>
                <th scope="col">Type</th>
                <th scope="col">Status</th>
                <th scope="col">Attempts</th>
                <th scope="col">Run after</th>
                <th scope="col">Last error</th>
                <th scope="col">Actions</th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((job) => (
                <tr key={job.id}>
                  <td className={styles.mono}>{job.id}</td>
                  <td className={styles.mono}>{job.type}</td>
                  <td>
                    <span className={jobBadgeClass(job.status)}>{job.status}</span>
                  </td>
                  <td className={styles.hash}>
                    {job.attempts}/{job.max_attempts}
                  </td>
                  <td className={styles.cellMuted}>
                    {job.run_at ? formatDateTime(job.run_at) : '—'}
                    <div className={styles.cellMuted}>{relativeTime(job.created_at)} created</div>
                  </td>
                  <td className={styles.cellStack}>
                    {job.last_error ? (
                      <>
                        <span className={styles.detailText} style={{ margin: 0 }}>
                          {job.last_error.length > 160
                            ? `${job.last_error.slice(0, 160)}…`
                            : job.last_error}
                        </span>
                        {job.last_error.length > 160 ? (
                          <details className={styles.details}>
                            <summary>Full error</summary>
                            <p className={styles.detailText}>{job.last_error}</p>
                          </details>
                        ) : null}
                      </>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                  <td>
                    {job.status === 'failed' || job.status === 'dead' ? (
                      <JobActions jobId={job.id} />
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

      {filtered || page > 1 ? (
        <nav className="pagination" aria-label="Job pages">
          <span>
            Page {page} · {jobs.length} job{jobs.length === 1 ? '' : 's'}
          </span>
          <span className="pages">
            {page > 1 ? (
              <Link href={jobsHref({ status, type, page: page - 1 })}>← Previous</Link>
            ) : (
              <span className="muted">← Previous</span>
            )}
            {jobs.length === PAGE_SIZE ? (
              <Link href={jobsHref({ status, type, page: page + 1 })}>Next →</Link>
            ) : (
              <span className="muted">Next →</span>
            )}
          </span>
        </nav>
      ) : null}

      <p className={styles.actionMessage}>
        The jobs API has no total count, so Next appears only while a full page is returned.
        Retrying a job resets its attempts and may repeat side effects.
      </p>
    </>
  );
}
