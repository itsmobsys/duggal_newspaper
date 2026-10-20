'use client';

import { useState } from 'react';
import type { FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import styles from './forms.module.css';

/**
 * Token lookup. Deliberately a form and not a magic link: the token is the
 * only credential, so the visitor has to paste it on purpose.
 */
export function StatusLookup(): React.JSX.Element {
  const router = useRouter();
  const [token, setToken] = useState('');
  const [error, setError] = useState<string | null>(null);

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const value = token.trim();

    if (!value) {
      setError('Paste the tracking token first.');
      document.getElementById('tracking-token')?.focus();
      return;
    }
    if (value.length > 100) {
      setError(
        'That token is longer than 100 characters. Check what you pasted — a token is one short line.',
      );
      document.getElementById('tracking-token')?.focus();
      return;
    }
    if (/[\s\\/?#]/.test(value)) {
      setError('Tokens do not contain spaces or slashes. Paste just the token, not the whole URL.');
      document.getElementById('tracking-token')?.focus();
      return;
    }

    setError(null);
    router.push(`/status/${encodeURIComponent(value)}`);
  }

  return (
    <form className={`form ${styles.lookupWrap}`} onSubmit={handleSubmit} noValidate>
      <div className="field">
        <label className="field-label" htmlFor="tracking-token">
          <span>Tracking token</span>
        </label>
        <input
          id="tracking-token"
          name="token"
          className="input"
          type="text"
          value={token}
          onChange={(event) => {
            setToken(event.target.value);
            if (error) setError(null);
          }}
          maxLength={100}
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          aria-invalid={error ? true : undefined}
          aria-describedby={
            error ? 'tracking-token-help tracking-token-error' : 'tracking-token-help'
          }
        />
        <p className="field-help" id="tracking-token-help">
          Shown after you filed. It is also the last part of the tracking page address.
        </p>
        {error ? (
          <p className="field-error" id="tracking-token-error" role="alert">
            {error}
          </p>
        ) : null}
      </div>

      <div className={styles.inlineActions}>
        <button className="button button--primary" type="submit">
          Check the desk
        </button>
        <a className="button button--ghost" href="/submit">
          File something instead
        </a>
      </div>
    </form>
  );
}
