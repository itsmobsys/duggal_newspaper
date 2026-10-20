'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { adminErrorMessage, adminFetch, adminFieldErrors } from './api';
import styles from './ops.module.css';

interface RebuildResponse {
  ok: boolean;
  date: string;
}

export function EditionActions(): React.JSX.Element {
  const router = useRouter();
  const [date, setDate] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ kind: 'error' | 'success'; message: string } | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  async function rebuild(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setStatus(null);
    setFieldErrors({});

    if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      setStatus({ kind: 'error', message: 'Use a calendar date (YYYY-MM-DD).' });
      return;
    }

    const confirmed = window.confirm(
      date
        ? `Queue a rebuild for ${date}? The stored edition for that date is refreshed and the action is audited.`
        : "Queue a rebuild for today's edition? The stored edition is refreshed and the action is audited.",
    );
    if (!confirmed) return;

    setBusy(true);
    try {
      const result = await adminFetch<RebuildResponse>('/editions/rebuild', {
        method: 'POST',
        body: date ? { date } : {},
      });
      setStatus({
        kind: 'success',
        message: `Rebuild queued for ${result.date}. The worker picks it up on its next tick.`,
      });
      router.refresh();
    } catch (error) {
      setFieldErrors(adminFieldErrors(error));
      setStatus({ kind: 'error', message: adminErrorMessage(error) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className={styles.rebuildForm} onSubmit={rebuild} noValidate>
      <div className="field">
        <div className="field-label">
          <label htmlFor="edition-rebuild-date">Edition date</label>
          <span className={styles.fieldKey}>date</span>
        </div>
        <input
          className="input"
          id="edition-rebuild-date"
          type="date"
          value={date}
          onChange={(event) => setDate(event.currentTarget.value)}
          aria-invalid={Boolean(fieldErrors.date)}
        />
        <p className="field-help">
          Leave blank to use today&apos;s date in the newsroom timezone. The API only accepts
          YYYY-MM-DD.
        </p>
        {fieldErrors.date ? <span className="field-error">{fieldErrors.date}</span> : null}
      </div>

      <div>
        <button className="button button--primary" type="submit" disabled={busy}>
          {busy ? 'Queueing...' : 'Queue rebuild'}
        </button>
      </div>

      {status ? (
        <div
          className={`alert ${status.kind === 'error' ? 'alert--error' : 'alert--success'}`}
          role={status.kind === 'error' ? 'alert' : 'status'}
        >
          <p>{status.message}</p>
        </div>
      ) : null}
    </form>
  );
}
