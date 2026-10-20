'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { adminErrorMessage, adminFetch } from './api';
import styles from './ops.module.css';

export interface JobActionsProps {
  jobId: string;
}

/**
 * Retry is the only mutation the jobs API exposes. It resets attempts and puts
 * the job back in the pending queue, so the worker may repeat side effects.
 */
export function JobActions({ jobId }: JobActionsProps): React.JSX.Element {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ kind: 'error' | 'success'; message: string } | null>(null);

  async function retry(): Promise<void> {
    const confirmed = window.confirm(
      'Retry this job? Attempts reset to zero and the worker will run it again from the start.',
    );
    if (!confirmed) return;

    setBusy(true);
    setStatus(null);
    try {
      await adminFetch(`/jobs/${encodeURIComponent(jobId)}/retry`, { method: 'POST' });
      setStatus({ kind: 'success', message: 'Queued for retry.' });
      router.refresh();
    } catch (error) {
      setStatus({ kind: 'error', message: adminErrorMessage(error) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <button
        className="button button--ghost button--sm"
        type="button"
        onClick={retry}
        disabled={busy}
      >
        {busy ? 'Retrying...' : 'Retry'}
      </button>
      {status ? (
        <p className={styles.actionMessage} role={status.kind === 'error' ? 'alert' : 'status'}>
          {status.kind === 'error' ? (
            <span className="field-error">{status.message}</span>
          ) : (
            status.message
          )}
        </p>
      ) : null}
    </div>
  );
}
