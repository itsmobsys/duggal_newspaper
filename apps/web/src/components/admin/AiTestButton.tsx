'use client';

import { useState } from 'react';
import { adminErrorMessage, adminFetch } from './api';
import styles from './ops.module.css';

/** POST /admin/ai/test returns 200 even when the model call fails. */
interface AiTestResponse {
  ok: boolean;
  result?: { ok?: boolean; message?: string };
  attempts?: number;
  error?: { code?: string; message?: string };
}

export function AiTestButton(): React.JSX.Element {
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<AiTestResponse | null>(null);
  const [requestError, setRequestError] = useState<string | null>(null);

  async function test(): Promise<void> {
    setBusy(true);
    setOutcome(null);
    setRequestError(null);
    try {
      const result = await adminFetch<AiTestResponse>('/ai/test', { method: 'POST' });
      setOutcome(result);
    } catch (error) {
      setRequestError(adminErrorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  const failed = Boolean(requestError) || (outcome !== null && !outcome.ok);

  return (
    <div>
      <button className="button button--ghost" type="button" onClick={test} disabled={busy}>
        {busy ? 'Testing model...' : 'Send test prompt'}
      </button>
      <p className={styles.groupNote} style={{ margin: 'var(--space-2) 0 0' }}>
        Sends a tiny JSON prompt to the configured model and records the attempt in the audit log.
        No article is created.
      </p>

      {requestError ? (
        <div className="alert alert--error" role="alert" style={{ marginTop: 'var(--space-3)' }}>
          <h3>Test request failed</h3>
          <p>{requestError}</p>
        </div>
      ) : null}

      {outcome ? (
        <div className={styles.testOutput} role={failed ? 'alert' : 'status'}>
          <h3>{outcome.ok ? 'Model replied' : 'Model call failed'}</h3>
          <dl className="kv">
            {outcome.result ? (
              <>
                <dt>Reply</dt>
                <dd>
                  {outcome.result.ok === undefined
                    ? 'No status'
                    : outcome.result.ok
                      ? 'ok'
                      : 'not ok'}
                  {outcome.result.message ? ` — ${outcome.result.message}` : ''}
                </dd>
              </>
            ) : null}
            {outcome.attempts !== undefined ? (
              <>
                <dt>Attempts</dt>
                <dd>{outcome.attempts}</dd>
              </>
            ) : null}
            {outcome.error ? (
              <>
                <dt>Error code</dt>
                <dd>{outcome.error.code ?? '—'}</dd>
                <dt>Error</dt>
                <dd className="field-error">{outcome.error.message ?? 'No message returned.'}</dd>
              </>
            ) : null}
          </dl>
        </div>
      ) : null}
    </div>
  );
}
