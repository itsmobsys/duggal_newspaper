'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { adminErrorMessage, adminFetch, adminFieldErrors } from './api';
import styles from './ops.module.css';

export interface CorrectionActionsProps {
  correctionId: string;
}

type Decision = 'accepted' | 'rejected';

export function CorrectionActions({ correctionId }: CorrectionActionsProps): React.JSX.Element {
  const router = useRouter();
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<Decision | null>(null);
  const [status, setStatus] = useState<{ kind: 'error' | 'success'; message: string } | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  async function decide(decision: Decision): Promise<void> {
    setStatus(null);
    setFieldErrors({});

    if (decision === 'accepted') {
      const confirmed = window.confirm(
        'Accept this correction? The correction text is appended to the published article immediately and the public page is revalidated. This cannot be undone from this screen.',
      );
      if (!confirmed) return;
    }

    const body: Record<string, unknown> = { status: decision };
    if (note.trim()) body.note = note.trim();

    setBusy(decision);
    try {
      await adminFetch(`/corrections/${encodeURIComponent(correctionId)}`, {
        method: 'PATCH',
        body,
      });
      setStatus({
        kind: 'success',
        message:
          decision === 'accepted'
            ? 'Correction accepted and appended to the article.'
            : 'Correction rejected. The article is unchanged.',
      });
      setNote('');
      router.refresh();
    } catch (error) {
      setFieldErrors(adminFieldErrors(error));
      setStatus({ kind: 'error', message: adminErrorMessage(error) });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className={styles.drawer}>
      <div className="field">
        <div className="field-label">
          <label htmlFor={`correction-note-${correctionId}`}>Review note</label>
        </div>
        <textarea
          className="textarea"
          id={`correction-note-${correctionId}`}
          value={note}
          onChange={(event) => setNote(event.currentTarget.value)}
          maxLength={1000}
          rows={2}
          placeholder="Optional. Written to the audit log."
        />
        {fieldErrors.note ? <span className="field-error">{fieldErrors.note}</span> : null}
      </div>

      <p className={styles.groupNote} style={{ margin: 'var(--space-2) 0 0' }}>
        Accepting appends the correction to the public article body. Rejecting leaves the article
        untouched. The note is recorded in the audit log only.
      </p>

      <div className="cluster" style={{ marginTop: 'var(--space-3)' }}>
        <button
          className="button button--primary button--sm"
          type="button"
          onClick={() => void decide('accepted')}
          disabled={busy !== null}
        >
          {busy === 'accepted' ? 'Applying...' : 'Accept & apply'}
        </button>
        <button
          className="button button--ghost button--sm"
          type="button"
          onClick={() => void decide('rejected')}
          disabled={busy !== null}
        >
          {busy === 'rejected' ? 'Rejecting...' : 'Reject'}
        </button>
      </div>

      {status ? (
        <div
          className={`alert ${status.kind === 'error' ? 'alert--error' : 'alert--success'}`}
          role={status.kind === 'error' ? 'alert' : 'status'}
          style={{ marginTop: 'var(--space-3)' }}
        >
          <p>{status.message}</p>
        </div>
      ) : null}
    </div>
  );
}
