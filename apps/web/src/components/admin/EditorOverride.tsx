'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { adminErrorMessage, adminFetch } from './api';
import styles from './EditorOverride.module.css';

interface EditorOverrideProps {
  submissionId: string;
  status: string;
  flags: string[];
}

interface OverrideResponse {
  ok?: boolean;
  cleared?: number;
  message?: string;
}

/**
 * The human escape hatch for the desk's flags. It clears the hold, records the
 * waived flags in the audit trail, and asks the AI to rewrite the story with
 * those specific concerns treated as already reviewed.
 */
export default function EditorOverride({ submissionId, status, flags }: EditorOverrideProps) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (status === 'published') return null;
  if (flags.length === 0 && status !== 'queued_review') return null;

  async function run() {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const data = await adminFetch<OverrideResponse>(
        `/submissions/${encodeURIComponent(submissionId)}/approve`,
        { method: 'POST', body: { note: note.trim() || undefined } },
      );
      setNotice(
        data.message ??
          `Cleared ${data.cleared ?? flags.length} desk flag${
            (data.cleared ?? flags.length) === 1 ? '' : 's'
          }. The AI is rewriting the story now.`,
      );
      setNote('');
      router.refresh();
    } catch (caught) {
      setError(adminErrorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={styles.override}>
      <div>
        <h3 className={styles.heading}>Editor override</h3>
        <p className={styles.copy}>
          Send this back to the AI with the desk flags cleared. It rewrites the story instead of
          holding it again, and your note is passed along as editorial guidance.
        </p>
      </div>
      <label className={styles.label}>
        Note for the AI (optional)
        <textarea
          className={styles.note}
          rows={2}
          maxLength={600}
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder="e.g. we already reviewed this one. Keep the joke, lose the graphic detail."
        />
      </label>
      <button type="button" className="button button--primary" onClick={run} disabled={busy}>
        {busy ? 'Sending to the AI…' : 'Clear flags & rewrite'}
      </button>
      {notice ? <p className="alert alert--success">{notice}</p> : null}
      {error ? <p className="alert alert--error">{error}</p> : null}
    </section>
  );
}
