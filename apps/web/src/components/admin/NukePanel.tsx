'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { adminErrorMessage, adminFetch } from './api';
import styles from './nuke.module.css';

interface NukeResponse {
  ok: boolean;
  active: boolean;
}

/**
 * The red / green switch.
 *
 * The button never fires on a single click: it opens a confirmation that asks
 * for the operator's own password, which the API re-verifies server-side before
 * anything is written.
 */
export function NukePanel({ active }: { active: boolean }): React.JSX.Element {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [password, setPassword] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const target = !active;

  useEffect(() => {
    if (!confirming) return;
    const timer = window.setTimeout(() => inputRef.current?.focus(), 30);
    return () => window.clearTimeout(timer);
  }, [confirming]);

  function open(): void {
    setPassword('');
    setError(null);
    setDone(null);
    setConfirming(true);
  }

  function close(): void {
    if (sending) return;
    setConfirming(false);
    setPassword('');
    setError(null);
  }

  async function submit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!password) {
      setError('Type your admin password first.');
      return;
    }
    setSending(true);
    setError(null);
    try {
      const data = await adminFetch<NukeResponse>('/nuke', {
        method: 'POST',
        body: { active: target, password },
      });
      setConfirming(false);
      setPassword('');
      setDone(
        data.active
          ? 'The website is down. Every public page now shows the notice.'
          : 'The website is back up. Public pages are live again.',
      );
      router.refresh();
    } catch (thrown) {
      setError(adminErrorMessage(thrown));
    } finally {
      setSending(false);
    }
  }

  return (
    <div className={styles.wrap}>
      <div className={`panel ${styles.statusCard}`}>
        <div>
          <p className="eyebrow">Current state</p>
          <p className={styles.stateLine}>
            <span className={active ? styles.dotDown : styles.dotUp} aria-hidden="true" />
            {active ? 'Website is down' : 'Website is live'}
          </p>
          <p className="muted">
            {active
              ? 'Visitors see the takedown notice. Admin, feeds and publishing are unaffected.'
              : 'Everything is public. Use this only when the site genuinely has to come down.'}
          </p>
        </div>
      </div>

      {done ? (
        <div className="alert alert--success" role="status" aria-live="polite">
          <h3>Done</h3>
          <p>{done}</p>
        </div>
      ) : null}

      <button
        type="button"
        className={`${styles.bigButton} ${target ? styles.nuke : styles.restore}`}
        onClick={open}
      >
        <span className={styles.bigLabel}>{target ? 'NUKE THE SITE' : 'BRING THE SITE BACK'}</span>
        <span className={styles.bigHint}>
          {target
            ? 'Replaces every public page with the takedown notice.'
            : 'Puts every public page back exactly as it was.'}
        </span>
      </button>

      <p className={styles.note}>
        Both actions ask for your admin password. The switch is written server-side, audited, and
        applied to the whole site at once.
      </p>

      {confirming ? (
        <div className={styles.overlay} role="presentation" onClick={close}>
          <div
            className={styles.modal}
            role="dialog"
            aria-modal="true"
            aria-labelledby="nuke-confirm-title"
            onClick={(event) => event.stopPropagation()}
          >
            <h2 id="nuke-confirm-title">
              {target ? 'Take the whole website down?' : 'Bring the website back?'}
            </h2>
            <p className="muted">
              {target
                ? 'Every public page will be replaced by the notice until you bring it back. The console stays open.'
                : 'Public pages will go live again immediately.'}
            </p>
            <form onSubmit={submit}>
              <label className="field">
                <span className="field-label">Admin password</span>
                <input
                  ref={inputRef}
                  className="input"
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  disabled={sending}
                  required
                />
              </label>
              {error ? (
                <p className="field-error" role="alert">
                  {error}
                </p>
              ) : null}
              <div className={styles.modalActions}>
                <button
                  type="button"
                  className="button button--ghost"
                  onClick={close}
                  disabled={sending}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className={`button ${target ? 'button--danger' : 'button--primary'}`}
                  disabled={sending || password.length === 0}
                >
                  {sending ? 'Working…' : target ? 'Take the site down' : 'Bring it back'}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}
