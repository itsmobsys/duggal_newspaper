'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { adminErrorMessage, adminFetch } from './api';
import styles from './ops.module.css';

interface PruneResult {
  reason: 'retention' | 'capacity' | 'none';
  pruned: number;
  bytesFreed: number;
  remainingOriginals: number;
}

interface RecheckResult {
  degraded: { active: boolean };
  usage: { exhausted: boolean; reason: 'storage' | 'ops' | 'degraded' | null };
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

/**
 * Manual storage upkeep. Both actions are idempotent and audited on the API;
 * neither can touch published photos, only the untouched "as filed" originals.
 */
export function StoragePanel({
  preserveOriginals,
}: {
  preserveOriginals: boolean;
}): React.JSX.Element {
  const router = useRouter();
  const [busy, setBusy] = useState<'prune' | 'recheck' | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function prune(): Promise<void> {
    setBusy('prune');
    setMessage(null);
    setError(null);
    try {
      const result = await adminFetch<PruneResult>('/storage/prune', {
        method: 'POST',
        body: { force: true },
      });
      setMessage(
        result.pruned === 0
          ? 'Nothing to prune — every original is still inside the retention window.'
          : `Deleted ${result.pruned} original${result.pruned === 1 ? '' : 's'}, freed ${formatBytes(
              result.bytesFreed,
            )}. ${result.remainingOriginals} remain. Published photos were not touched.`,
      );
      router.refresh();
    } catch (caught) {
      setError(adminErrorMessage(caught));
    } finally {
      setBusy(null);
    }
  }

  async function recheck(): Promise<void> {
    setBusy('recheck');
    setMessage(null);
    setError(null);
    try {
      const result = await adminFetch<RecheckResult>('/storage/recheck', { method: 'POST' });
      if (result.degraded.active) {
        setMessage(
          'The store still fails. Uploads stay paused and text submissions keep working until it recovers.',
        );
      } else if (result.usage.exhausted) {
        setMessage(
          `The store responds, but the monthly budget is spent (${
            result.usage.reason ?? 'quota'
          }). Uploads resume when the allowance resets or you free space.`,
        );
      } else {
        setMessage('The store responds normally. Photo uploads are allowed.');
      }
      router.refresh();
    } catch (caught) {
      setError(adminErrorMessage(caught));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div style={{ marginTop: 'var(--space-4)' }}>
      <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
        <button
          className="button button--ghost"
          type="button"
          onClick={prune}
          disabled={busy !== null || !preserveOriginals}
        >
          {busy === 'prune' ? 'Pruning…' : 'Prune originals'}
        </button>
        <button
          className="button button--ghost"
          type="button"
          onClick={recheck}
          disabled={busy !== null}
        >
          {busy === 'recheck' ? 'Checking…' : 'Re-check store'}
        </button>
      </div>

      <p className={styles.groupNote} style={{ margin: 'var(--space-2) 0 0' }}>
        Pruning deletes the untouched copies users filed, oldest first. Optimised photos on
        published stories are never deleted. Deletes are free on the Hobby plan, so pruning cannot
        add a bill.
        {preserveOriginals ? '' : ' Originals are currently disabled in Settings → Storage.'}
      </p>

      {error ? (
        <div className="alert alert--error" role="alert" style={{ marginTop: 'var(--space-3)' }}>
          <h3>Storage action failed</h3>
          <p>{error}</p>
        </div>
      ) : null}

      {message ? (
        <p className={styles.actionMessage} role="status">
          {message}
        </p>
      ) : null}
    </div>
  );
}
