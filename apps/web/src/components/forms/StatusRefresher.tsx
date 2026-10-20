'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import styles from './forms.module.css';

export interface StatusRefresherProps {
  /** Keep polling while the desk is still working on the story. */
  active: boolean;
  intervalMs?: number;
}

/**
 * Pulls fresh status while a submission is in the machine. The interval is
 * cleared on unmount so a published page does not keep tapping the API.
 */
export function StatusRefresher({
  active,
  intervalMs = 20_000,
}: StatusRefresherProps): React.JSX.Element | null {
  const router = useRouter();
  const [justRefreshed, setJustRefreshed] = useState(false);

  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => {
      router.refresh();
    }, intervalMs);
    return () => window.clearInterval(timer);
  }, [active, intervalMs, router]);

  useEffect(() => {
    if (!justRefreshed) return;
    const timer = window.setTimeout(() => setJustRefreshed(false), 2000);
    return () => window.clearTimeout(timer);
  }, [justRefreshed]);

  if (!active) return null;

  return (
    <div className={styles.refresher}>
      <span className={styles.refresherNote} aria-live="polite">
        {justRefreshed
          ? 'Checked with the desk. Nothing new yet.'
          : `Auto-refreshing every ${Math.round(intervalMs / 1000)} seconds while the desk works.`}
      </span>
      <button
        className="button button--sm button--ghost"
        type="button"
        onClick={() => {
          router.refresh();
          setJustRefreshed(true);
        }}
      >
        Refresh now
      </button>
    </div>
  );
}
