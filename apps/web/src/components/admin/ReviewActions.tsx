'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { adminErrorMessage, adminFetch } from './api';

export interface ReviewActionsProps {
  reviewId: string;
  currentStatus: 'published' | 'pending' | 'hidden';
}

/**
 * Moderation actions for one review. Publishing or hiding revalidates the
 * article page through the API, so the public site catches up immediately.
 */
export function ReviewActions({ reviewId, currentStatus }: ReviewActionsProps): React.JSX.Element {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function update(status: 'published' | 'hidden'): Promise<void> {
    setBusy(true);
    setError('');
    try {
      await adminFetch(`/reviews/${encodeURIComponent(reviewId)}`, {
        method: 'PATCH',
        body: { status },
      });
      router.refresh();
    } catch (caught) {
      setError(adminErrorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)' }}>
        {currentStatus !== 'published' ? (
          <button
            className="button button--primary button--sm"
            type="button"
            disabled={busy}
            onClick={() => void update('published')}
          >
            {busy ? 'Saving…' : 'Publish'}
          </button>
        ) : null}
        {currentStatus !== 'hidden' ? (
          <button
            className="button button--ghost button--sm"
            type="button"
            disabled={busy}
            onClick={() => void update('hidden')}
          >
            {busy ? 'Saving…' : 'Hide'}
          </button>
        ) : null}
      </div>
      {error ? (
        <p className="field-error" role="alert" style={{ marginTop: '6px' }}>
          {error}
        </p>
      ) : null}
    </div>
  );
}
