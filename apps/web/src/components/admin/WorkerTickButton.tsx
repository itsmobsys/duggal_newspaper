'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { adminErrorMessage, adminFetch } from './api';
import styles from './admin.module.css';

interface TickResult {
  processed: number;
  succeeded: number;
  failed: number;
  skipped: boolean;
  recoveredLeases: number;
  durationMs: number;
  errors: Array<{ jobId: string; type: string; error: string }>;
}

interface TickResponse {
  ok: boolean;
  result: TickResult;
}

export function WorkerTickButton(): React.JSX.Element {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<TickResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function tick(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const response = await adminFetch<TickResponse>('/worker/tick', { method: 'POST' });
      setResult(response.result);
      router.refresh();
    } catch (caught) {
      setResult(null);
      setError(adminErrorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={styles.tickControl}>
      <button
        className="button button--ghost button--sm"
        type="button"
        onClick={tick}
        disabled={busy}
        aria-describedby={result || error ? 'worker-tick-result' : undefined}
      >
        {busy ? 'Running the desk…' : 'Run worker once'}
      </button>

      {result ? (
        <p id="worker-tick-result" className={styles.tickResult} role="status" aria-live="polite">
          {result.skipped
            ? 'A worker pass was already running; nothing was claimed.'
            : `${result.processed} job${result.processed === 1 ? '' : 's'} processed · ${result.succeeded} succeeded · ${result.failed} failed · ${Math.round(result.durationMs)}ms`}
          {result.recoveredLeases > 0
            ? ` · ${result.recoveredLeases} stale lease${result.recoveredLeases === 1 ? '' : 's'} recovered`
            : ''}
        </p>
      ) : null}

      {error ? (
        <p id="worker-tick-result" className="field-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
