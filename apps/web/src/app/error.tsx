'use client';

import { useEffect } from 'react';

export interface ErrorPageProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function ErrorPage({ error, reset }: ErrorPageProps): React.JSX.Element {
  useEffect(() => {
    // The digest is the only safe identifier to surface; never leak stack traces
    // or environment values to the reader.
    console.error('[web] render error', error.digest ?? error.message);
  }, [error]);

  return (
    <main className="container" style={{ paddingBlock: '16vh' }}>
      <p className="eyebrow">500 · Presses jammed</p>
      <h1 style={{ fontSize: 'clamp(2rem, 7vw, 4rem)' }}>The paper failed to print.</h1>
      <p className="lede">
        Something broke while assembling this page. The stories are safe; the layout is not. Try
        again, or head back to the front page.
      </p>
      {error.digest ? (
        <p className="card-meta" style={{ marginTop: 12 }}>
          Reference: {error.digest}
        </p>
      ) : null}
      <p style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 24 }}>
        <button className="button button--primary" type="button" onClick={() => reset()}>
          Try again
        </button>
        {/* A full reload is deliberate: the client router is what just failed. */}
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
        <a className="button button--ghost" href="/">
          Front page
        </a>
      </p>
    </main>
  );
}
