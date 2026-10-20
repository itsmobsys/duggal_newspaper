'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { adminErrorMessage, adminFetch } from './api';
import styles from './ops.module.css';

export interface ReviewActionsProps {
  reviewId: string;
  currentStatus: 'published' | 'pending' | 'hidden';
}

export function ReviewActions({ reviewId, currentStatus }: ReviewActionsProps): React.JSX.Element {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'error' | 'success'; text: string } | null>(null);

  async function setStatus(status: 'published' | 'hidden'): Promise<void> {
    if (status === 'hidden') {
      const confirmed = window.confirm(
        'Hide this review? It disappears from the story and stops counting towards the weekly table. The record is kept for audit.',
      );
      if (!confirmed) return;
    }
    setBusy(true);
    setMessage(null);
    try {
      await adminFetch(`/reviews/${encodeURIComponent(reviewId)}`, {
        method: 'PATCH',
        body: { status },
      });
      setMessage({
        kind: 'success',
        text: status === 'published' ? 'Review published.' : 'Review hidden.',
      });
      router.refresh();
    } catch (error) {
      setMessage({ kind: 'error', text: adminErrorMessage(error) });
    } finally {
      setBusy(false);
    }
  }

  async function remove(): Promise<void> {
    if (
      !window.confirm(
        'Delete this review permanently? This cannot be undone. Hiding is usually the safer choice.',
      )
    ) {
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      await adminFetch(`/reviews/${encodeURIComponent(reviewId)}`, { method: 'DELETE' });
      setMessage({ kind: 'success', text: 'Review deleted.' });
      router.refresh();
    } catch (error) {
      setMessage({ kind: 'error', text: adminErrorMessage(error) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={styles.actionStack}>
      <div className={styles.actionRow}>
        {currentStatus !== 'published' ? (
          <button
            className="button button--primary button--sm"
            type="button"
            onClick={() => void setStatus('published')}
            disabled={busy}
          >
            Publish
          </button>
        ) : null}
        {currentStatus !== 'hidden' ? (
          <button
            className="button button--ghost button--sm"
            type="button"
            onClick={() => void setStatus('hidden')}
            disabled={busy}
          >
            Hide
          </button>
        ) : null}
        <button
          className="button button--danger button--sm"
          type="button"
          onClick={() => void remove()}
          disabled={busy}
        >
          Delete
        </button>
      </div>
      {message ? (
        <p
          className={`${styles.actionMessage} ${
            message.kind === 'error' ? styles.actionError : ''
          }`}
          role={message.kind === 'error' ? 'alert' : 'status'}
        >
          {message.text}
        </p>
      ) : null}
    </div>
  );
}
