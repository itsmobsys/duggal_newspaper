'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { adminErrorMessage, adminFetch, adminFieldErrors } from './api';
import styles from './ops.module.css';

type ReportStatus = 'open' | 'resolved' | 'dismissed';

export interface ReportActionsProps {
  reportId: string;
  currentStatus: ReportStatus;
}

const STATUS_LABELS: Record<ReportStatus, string> = {
  open: 'Open',
  resolved: 'Resolved',
  dismissed: 'Dismissed',
};

export function ReportActions({ reportId, currentStatus }: ReportActionsProps): React.JSX.Element {
  const router = useRouter();
  const [nextStatus, setNextStatus] = useState<ReportStatus>(currentStatus);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ kind: 'error' | 'success'; message: string } | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  async function submit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setStatus(null);
    setFieldErrors({});

    if (nextStatus !== currentStatus && nextStatus !== 'open') {
      const confirmed = window.confirm(
        `Mark this report as ${STATUS_LABELS[nextStatus].toLowerCase()}? The article stays published; only the report record changes.`,
      );
      if (!confirmed) return;
    }

    const body: Record<string, unknown> = { status: nextStatus };
    if (note.trim()) body.note = note.trim();

    setBusy(true);
    try {
      await adminFetch(`/reports/${encodeURIComponent(reportId)}`, {
        method: 'PATCH',
        body,
      });
      setStatus({
        kind: 'success',
        message: `Report marked ${STATUS_LABELS[nextStatus].toLowerCase()}.`,
      });
      setNote('');
      router.refresh();
    } catch (error) {
      setFieldErrors(adminFieldErrors(error));
      setStatus({ kind: 'error', message: adminErrorMessage(error) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <details className={styles.drawer}>
      <summary>Update report</summary>
      <form className={styles.drawerBody} onSubmit={submit} noValidate>
        <div className="field">
          <div className="field-label">
            <label htmlFor={`report-status-${reportId}`}>Status</label>
          </div>
          <select
            className="select"
            id={`report-status-${reportId}`}
            value={nextStatus}
            onChange={(event) => setNextStatus(event.currentTarget.value as ReportStatus)}
          >
            <option value="open">Open</option>
            <option value="resolved">Resolved</option>
            <option value="dismissed">Dismissed</option>
          </select>
        </div>

        <div className="field">
          <div className="field-label">
            <label htmlFor={`report-note-${reportId}`}>Resolution note</label>
          </div>
          <textarea
            className="textarea"
            id={`report-note-${reportId}`}
            value={note}
            onChange={(event) => setNote(event.currentTarget.value)}
            maxLength={1000}
            rows={3}
            placeholder="Optional. Stored with the report."
          />
          {fieldErrors.note ? <span className="field-error">{fieldErrors.note}</span> : null}
        </div>

        <p className={styles.groupNote} style={{ margin: 0 }}>
          Closing a report is internal. It does not edit, unpublish or annotate the article; use a
          correction or the article editor for that.
        </p>

        {status ? (
          <div
            className={`alert ${status.kind === 'error' ? 'alert--error' : 'alert--success'}`}
            role={status.kind === 'error' ? 'alert' : 'status'}
          >
            <p>{status.message}</p>
          </div>
        ) : null}

        <button className="button button--primary button--sm" type="submit" disabled={busy}>
          {busy ? 'Saving...' : 'Save report'}
        </button>
      </form>
    </details>
  );
}
