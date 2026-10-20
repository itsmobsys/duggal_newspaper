import type { Metadata } from 'next';
import Link from 'next/link';
import { AiTestButton } from '@/components/admin/AiTestButton';
import { StoragePanel } from '@/components/admin/StoragePanel';
import { adminServerFetch } from '@/lib/admin-server';
import { formatDateTime } from '@/lib/format';
import styles from '@/components/admin/ops.module.css';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Diagnostics',
  robots: { index: false, follow: false },
};

interface AiHealth {
  available: boolean;
  model: string;
  modelsSeen: number;
  error?: string;
  configuredBaseUrl: string;
  rpmLimit: number;
  visionEnabled: boolean;
  jsonMode: boolean;
}

interface RecentError {
  id: string;
  type: string;
  last_error: string;
  attempts: number;
}

interface StorageUsage {
  month: string;
  bytes: { published: number; pending: number; originals: number; total: number };
  ops: { advanced: number; simple: number };
  limits: {
    preserveOriginals: boolean;
    originalRetentionDays: number;
    blockWhenFull: boolean;
    softStorageBytes: number;
    softAdvancedOps: number;
    retentionDays: number;
  };
  headroom: { storageBytes: number; advancedOps: number };
  exhausted: boolean;
  reason: 'storage' | 'ops' | 'degraded' | null;
  degraded: { active: boolean; since: string | null; code: string | null; message: string | null };
}

interface Diagnostics {
  storage: {
    ready: boolean;
    mode: 'blob' | 'local';
    originals: 'private' | 'public' | 'none';
    photos: 'public' | 'private' | 'local' | 'none';
    usage: StorageUsage;
  };
  ai: { configured: boolean; model: string };
  worker: {
    enabled: boolean;
    intervalMs: number;
    leaseMs: number;
    maxJobsPerTick: number;
    budgetMs: number;
  };
  timezone: string;
  recentErrors: RecentError[];
  version: string;
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value >= 10 || unit === 0 ? 0 : 1)} ${units[unit]}`;
}

function originalsLabel(originals: 'private' | 'public' | 'none'): string {
  if (originals === 'private') return 'Private store (recommended)';
  if (originals === 'public') return 'Public store, unguessable URL';
  return 'Not kept';
}

function photosLabel(photos: 'public' | 'private' | 'local' | 'none'): string {
  if (photos === 'public') return 'Public Blob CDN';
  if (photos === 'private') return 'Private Blob store';
  if (photos === 'local') return 'Local disk (development)';
  return 'Not configured';
}

function isNextControlFlow(error: unknown): boolean {
  const digest = (error as { digest?: unknown } | null)?.digest;
  return typeof digest === 'string' && /^NEXT_(REDIRECT|NOT_FOUND)/.test(digest);
}

function errorText(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return 'The newsroom API rejected the request.';
}

function yesNo(value: boolean): string {
  return value ? 'Yes' : 'No';
}

function formatMs(ms: number): string {
  if (!Number.isFinite(ms)) return '—';
  if (ms >= 60_000 && ms % 60_000 === 0) return `${ms / 60_000} min`;
  if (ms >= 1000 && ms % 1000 === 0) return `${ms / 1000} s`;
  return `${ms} ms`;
}

export default async function DiagnosticsPage(): Promise<React.JSX.Element> {
  const results = await Promise.allSettled([
    adminServerFetch<AiHealth>('/admin/ai/health'),
    adminServerFetch<Diagnostics>('/admin/diagnostics'),
  ]);

  for (const result of results) {
    if (result.status === 'rejected' && isNextControlFlow(result.reason)) {
      throw result.reason;
    }
  }

  const [healthResult, diagnosticsResult] = results;
  const health = healthResult.status === 'fulfilled' ? healthResult.value : null;
  const healthError = healthResult.status === 'rejected' ? errorText(healthResult.reason) : null;
  const diagnostics = diagnosticsResult.status === 'fulfilled' ? diagnosticsResult.value : null;
  const diagnosticsError =
    diagnosticsResult.status === 'rejected' ? errorText(diagnosticsResult.reason) : null;
  const recentErrors = diagnostics?.recentErrors ?? [];

  return (
    <>
      <div className="admin-head">
        <div>
          <h1>Diagnostics</h1>
          <p className="muted" style={{ margin: '4px 0 0' }}>
            What the API can see: the model, the worker, storage and the jobs that last failed.
          </p>
        </div>
      </div>

      <div className="admin-split">
        <div className="stack">
          <section className="panel" aria-labelledby="ai-health-heading">
            <div className={styles.groupHead}>
              <h2 id="ai-health-heading">AI model</h2>
              {health ? (
                <span className={health.available ? 'badge badge--ok' : 'badge badge--failed'}>
                  {health.available ? 'Available' : 'Unavailable'}
                </span>
              ) : null}
            </div>

            {healthError ? (
              <div className="alert alert--error" role="alert">
                <h3>AI health could not be checked</h3>
                <p>{healthError}</p>
              </div>
            ) : null}

            {health ? (
              <>
                <dl className="kv">
                  <dt>Model</dt>
                  <dd className={styles.mono}>{health.model}</dd>
                  <dt>Base URL</dt>
                  <dd className={styles.mono}>{health.configuredBaseUrl}</dd>
                  <dt>Models seen</dt>
                  <dd>{health.modelsSeen}</dd>
                  <dt>JSON mode</dt>
                  <dd>{yesNo(health.jsonMode)}</dd>
                  <dt>Vision</dt>
                  <dd>{yesNo(health.visionEnabled)}</dd>
                  <dt>Rate limit</dt>
                  <dd>{health.rpmLimit} requests/min</dd>
                </dl>
                {health.error ? (
                  <p className={`field-error ${styles.actionMessage}`} role="alert">
                    {health.error}
                  </p>
                ) : null}
              </>
            ) : null}

            <div style={{ marginTop: 'var(--space-4)' }}>
              <AiTestButton />
            </div>
          </section>

          <section className="panel" aria-labelledby="storage-heading">
            <div className={styles.groupHead}>
              <h2 id="storage-heading">Photo storage</h2>
              {diagnostics ? (
                <span
                  className={
                    diagnostics.storage.usage.exhausted || diagnostics.storage.usage.degraded.active
                      ? 'badge badge--failed'
                      : diagnostics.storage.ready
                        ? 'badge badge--ok'
                        : 'badge badge--muted'
                  }
                >
                  {diagnostics.storage.usage.exhausted
                    ? 'Uploads paused (quota)'
                    : diagnostics.storage.usage.degraded.active
                      ? 'Store failing'
                      : diagnostics.storage.ready
                        ? 'Ready'
                        : 'Not configured'}
                </span>
              ) : null}
            </div>

            {diagnostics ? (
              <>
                <dl className="kv">
                  <dt>Store</dt>
                  <dd>
                    {diagnostics.storage.mode === 'blob' ? 'Vercel Blob' : 'Local disk'}
                    <span className={styles.cellMuted}>
                      {' '}
                      · {diagnostics.storage.ready ? 'configured' : 'missing token'}
                    </span>
                  </dd>
                  <dt>Originals</dt>
                  <dd>{originalsLabel(diagnostics.storage.originals)}</dd>
                  <dt>Photos</dt>
                  <dd>
                    {photosLabel(diagnostics.storage.photos)}
                    <span className={styles.cellMuted}>
                      {diagnostics.storage.photos === 'private' ? ' — proxied by the API' : ''}
                    </span>
                  </dd>
                  <dt>Billing month</dt>
                  <dd className={styles.mono}>{diagnostics.storage.usage.month}</dd>
                  <dt>Storage used</dt>
                  <dd>
                    {formatBytes(diagnostics.storage.usage.bytes.total)} of{' '}
                    {formatBytes(diagnostics.storage.usage.limits.softStorageBytes)} soft limit
                  </dd>
                  <dt>Published photos</dt>
                  <dd>{formatBytes(diagnostics.storage.usage.bytes.published)}</dd>
                  <dt>Pending uploads</dt>
                  <dd>{formatBytes(diagnostics.storage.usage.bytes.pending)}</dd>
                  <dt>Originals</dt>
                  <dd>{formatBytes(diagnostics.storage.usage.bytes.originals)}</dd>
                  <dt>Advanced ops</dt>
                  <dd>
                    {diagnostics.storage.usage.ops.advanced} of{' '}
                    {diagnostics.storage.usage.limits.softAdvancedOps}
                  </dd>
                  <dt>Simple ops</dt>
                  <dd>{diagnostics.storage.usage.ops.simple}</dd>
                  <dt>Headroom</dt>
                  <dd>
                    {formatBytes(diagnostics.storage.usage.headroom.storageBytes)} ·{' '}
                    {diagnostics.storage.usage.headroom.advancedOps} puts
                  </dd>
                </dl>

                {diagnostics.storage.usage.degraded.active ? (
                  <div
                    className="alert alert--error"
                    role="alert"
                    style={{ marginTop: 'var(--space-3)' }}
                  >
                    <h3>Uploads are paused</h3>
                    <p>
                      The store rejected a write
                      {diagnostics.storage.usage.degraded.message
                        ? `: ${diagnostics.storage.usage.degraded.message}`
                        : '.'}{' '}
                      Text-only submissions keep working. Re-check after fixing the token or freeing
                      space.
                    </p>
                  </div>
                ) : null}

                <StoragePanel
                  preserveOriginals={diagnostics.storage.usage.limits.preserveOriginals}
                />
              </>
            ) : null}
          </section>

          <section className="panel" aria-labelledby="recent-errors-heading">
            <div className={styles.groupHead}>
              <h2 id="recent-errors-heading">Recent failed jobs</h2>
              {diagnostics ? (
                <span className="badge badge--muted">{recentErrors.length} shown</span>
              ) : null}
            </div>

            {diagnosticsError ? (
              <div className="alert alert--error" role="alert">
                <h3>Recent errors could not be loaded</h3>
                <p>{diagnosticsError}</p>
              </div>
            ) : null}

            {diagnostics && recentErrors.length === 0 ? (
              <div className="empty-state">
                <h2>Nothing failed</h2>
                <p>No jobs are in the failed or dead state right now.</p>
              </div>
            ) : null}

            {recentErrors.length > 0 ? (
              <div className="table-wrap">
                <table className="data-table">
                  <caption className="visually-hidden">
                    The ten most recent failed or dead jobs.
                  </caption>
                  <thead>
                    <tr>
                      <th scope="col">Job</th>
                      <th scope="col">Type</th>
                      <th scope="col">Attempts</th>
                      <th scope="col">Last error</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recentErrors.map((job) => (
                      <tr key={job.id}>
                        <td className={styles.hash}>{job.id}</td>
                        <td className={styles.mono}>{job.type}</td>
                        <td className={styles.hash}>{job.attempts}</td>
                        <td className={styles.cellStack}>
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
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}

            <p className={styles.actionMessage}>
              <Link href="/admin/jobs?status=dead">Open the dead queue on Jobs →</Link>
            </p>
          </section>
        </div>

        <aside className="stack" aria-label="Runtime configuration">
          <section className="panel" aria-labelledby="runtime-heading">
            <h2 id="runtime-heading">Runtime</h2>

            {diagnosticsError ? (
              <div className="alert alert--error" role="alert">
                <p>{diagnosticsError}</p>
              </div>
            ) : null}

            {diagnostics ? (
              <dl className="kv">
                <dt>Storage</dt>
                <dd>
                  {diagnostics.storage.ready ? 'Configured' : 'Not configured'}
                  <span className={styles.cellMuted}>
                    {' '}
                    · {diagnostics.storage.mode} · originals {diagnostics.storage.originals}
                  </span>
                </dd>
                <dt>AI key</dt>
                <dd>{diagnostics.ai.configured ? 'Configured' : 'Not configured'}</dd>
                <dt>AI model</dt>
                <dd className={styles.mono}>{diagnostics.ai.model}</dd>
                <dt>Worker</dt>
                <dd>{diagnostics.worker.enabled ? 'Enabled' : 'Disabled'}</dd>
                <dt>Interval</dt>
                <dd>{formatMs(diagnostics.worker.intervalMs)}</dd>
                <dt>Lease</dt>
                <dd>{formatMs(diagnostics.worker.leaseMs)}</dd>
                <dt>Jobs / tick</dt>
                <dd>{diagnostics.worker.maxJobsPerTick}</dd>
                <dt>Tick budget</dt>
                <dd>{formatMs(diagnostics.worker.budgetMs)}</dd>
                <dt>Timezone</dt>
                <dd className={styles.mono}>{diagnostics.timezone}</dd>
                <dt>Version</dt>
                <dd className={styles.mono}>{diagnostics.version}</dd>
              </dl>
            ) : null}
          </section>

          <section className="panel" aria-labelledby="diagnostics-note-heading">
            <h2 id="diagnostics-note-heading">About this screen</h2>
            <p className={styles.groupNote} style={{ margin: 0 }}>
              Values come straight from the API process. Nothing here can be changed, and no secret
              is ever displayed - storage credentials and the AI key are reported as configured or
              not, never echoed.
            </p>
            <p className={styles.actionMessage}>
              Settings that can be edited live on the{' '}
              <Link href="/admin/settings">Settings page</Link>.
            </p>
          </section>
        </aside>
      </div>

      {diagnostics ? (
        <p className={styles.actionMessage}>
          Snapshot taken {formatDateTime(new Date())}. Status reflects the API process at render
          time; a restart clears the failed-job list.
        </p>
      ) : null}
    </>
  );
}
