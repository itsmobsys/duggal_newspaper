'use client';

import { useState, type FormEvent } from 'react';
import { safeAdminNext } from '@/lib/admin-next';
import styles from './admin.module.css';

function errorMessageFrom(payload: unknown): string | null {
  if (payload && typeof payload === 'object' && 'error' in payload) {
    const inner = (payload as { error?: unknown }).error;
    if (inner && typeof inner === 'object') {
      const message = (inner as { message?: unknown }).message;
      if (typeof message === 'string' && message.trim()) return message;
    }
  }
  return null;
}

export function LoginForm({ next }: { next: string }): React.JSX.Element {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);

    const trimmed = email.trim();
    if (!trimmed) {
      setError('Enter your newsroom email address.');
      return;
    }
    if (password.length < 8) {
      setError('Passwords are at least 8 characters. Check for a missed character.');
      return;
    }

    setBusy(true);
    try {
      // Login bypasses `adminFetch`: a failed attempt returns 401, and that
      // helper treats 401 as an expired session and reloads the page.
      const response = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { accept: 'application/json', 'content-type': 'application/json' },
        body: JSON.stringify({ email: trimmed, password }),
        credentials: 'same-origin',
        cache: 'no-store',
      });
      const payload: unknown = await response.json().catch(() => null);

      if (!response.ok) {
        setError(
          errorMessageFrom(payload) ??
            (response.status === 429
              ? 'Too many attempts. Wait a few minutes, then try again.'
              : 'Sign-in failed. Check your email and password.'),
        );
        return;
      }

      window.location.assign(safeAdminNext(next));
    } catch {
      setError('Network error. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="form" onSubmit={onSubmit} noValidate>
      {error ? (
        <div className="alert alert--error" role="alert">
          <p>{error}</p>
        </div>
      ) : null}

      <div className="field">
        <label className="field-label" htmlFor="login-email">
          Email <span className="req">*</span>
        </label>
        <input
          className="input"
          id="login-email"
          name="email"
          type="email"
          autoComplete="username"
          inputMode="email"
          autoFocus
          required
          maxLength={200}
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          aria-invalid={error ? true : undefined}
        />
      </div>

      <div className="field">
        <label className="field-label" htmlFor="login-password">
          Password <span className="req">*</span>
        </label>
        <input
          className="input"
          id="login-password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          minLength={8}
          maxLength={200}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          aria-invalid={error ? true : undefined}
        />
      </div>

      <div className={styles.loginActions}>
        <button className="button button--primary button--block" type="submit" disabled={busy}>
          {busy ? 'Signing in…' : 'Enter the console'}
        </button>
      </div>

      <p className={styles.loginNote}>
        Staff access only. Sessions are short-lived and every action in the console is written to
        the audit log.
      </p>
    </form>
  );
}
