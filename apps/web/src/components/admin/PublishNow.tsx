'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { adminErrorMessage, adminFetch } from './api';
import styles from './publish.module.css';

interface PublishNowResult {
  ok: boolean;
  editionDate: string;
  requeued: number;
  parked: number;
  failed: number;
  aiConfigured: boolean;
  workerTickRequested: boolean;
  buildFollowUpSeconds: number;
  message: string;
}

/**
 * The emergency "print now" lever.
 *
 * It does not publish anything itself: the API requeues waiting submissions,
 * schedules an edition rebuild that waits for the queue to drain, and asks the
 * worker for a tick. The response is a receipt, not a success claim — the
 * edition may still be assembling after this component has gone quiet.
 */
export function PublishNow(): React.JSX.Element {
  const router = useRouter();
  const [armed, setArmed] = useState(false);
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<PublishNowResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(): Promise<void> {
    setSending(true);
    setError(null);
    try {
      const data = await adminFetch<PublishNowResult>('/publish-now', {
        method: 'POST',
        body: {},
      });
      setResult(data);
      setArmed(false);
      router.refresh();
    } catch (thrown) {
      setError(adminErrorMessage(thrown));
    } finally {
      setSending(false);
    }
  }

  return (
    <div className={styles.wrap}>
      {error ? (
        <div className="alert alert--error" role="alert">
          <h3>Nothing was queued</h3>
          <p>{error}</p>
          <p className={styles.note}>
            The button either reached the API and was rejected, or never left the browser. Refresh
            the job queue before trying again.
          </p>
        </div>
      ) : null}

      {result ? (
        <div className="alert alert--success" role="status" aria-live="polite">
          <h3>Build queued</h3>
          <p>{result.message}</p>
          <dl className="kv">
            <dt>Edition</dt>
            <dd>{result.editionDate}</dd>
            <dt>Submissions requeued</dt>
            <dd>{result.requeued}</dd>
            <dt>Parked without an AI key</dt>
            <dd>{result.parked}</dd>
            <dt>Failed, retried</dt>
            <dd>{result.failed}</dd>
            <dt>AI desk</dt>
            <dd>{result.aiConfigured ? 'Key present' : 'No key — fallback layout'}</dd>
            <dt>Worker tick</dt>
            <dd>
              {result.workerTickRequested
                ? 'Requested (runs in the background)'
                : 'Disabled — enable WORKER_ENABLED on Render'}
            </dd>
          </dl>
          <p className={styles.note}>
            The rebuild runs as soon as the waiting stories finish processing (it waits up to 15
            minutes), and a second worker tick checks again in about{' '}
            {Math.max(1, Math.round(result.buildFollowUpSeconds / 60))} minute
            {result.buildFollowUpSeconds >= 120 ? 's' : ''}. You can leave this page; the queue is
            durable.
          </p>
          <p className={styles.links}>
            <a className="button button--sm" href="/" target="_blank" rel="noopener noreferrer">
              Open the live site
            </a>{' '}
            <button
              type="button"
              className="button button--sm button--ghost"
              onClick={() => router.refresh()}
            >
              Refresh status
            </button>
          </p>
        </div>
      ) : null}

      {!armed ? (
        <button
          type="button"
          className="button button--primary"
          onClick={() => setArmed(true)}
          disabled={sending}
        >
          Build the paper now
        </button>
      ) : (
        <div className={styles.confirm} role="group" aria-label="Confirm instant build">
          <p>
            This processes every waiting submission and rebuilds the edition the front page is
            showing. Routine stories still follow the normal moderation rules; anything held for
            review stays held.
          </p>
          <div className={styles.confirmActions}>
            <button type="button" className="button" onClick={run} disabled={sending}>
              {sending ? 'Queueing…' : 'Yes, build now'}
            </button>
            <button
              type="button"
              className="button button--ghost"
              onClick={() => setArmed(false)}
              disabled={sending}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <p className={styles.hint}>
        Prefer the unattended path? The newsroom already runs on its own: stories publish as they
        clear the AI desk, and the next edition is assembled at 23:00 IST for a midnight release.
      </p>
    </div>
  );
}
