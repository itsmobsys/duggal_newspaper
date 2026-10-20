import type { Metadata } from 'next';
import { StatusLookup } from '@/components/forms/StatusLookup';
import styles from '@/components/forms/forms.module.css';

export const metadata: Metadata = {
  title: 'Track a submission',
  description: 'Check what the desk did with a story you filed.',
  robots: { index: false },
};

export default function StatusPage(): React.JSX.Element {
  return (
    <div className="container">
      <header className="page-head">
        <p className="eyebrow">Tracking desk</p>
        <h1>Track a submission</h1>
        <p className="lede">
          Every filing gets a token when it is accepted. Paste it here to see whether the robot has
          rewritten it, a human has held it, or it has already gone to press.
        </p>
      </header>

      <div className={`section ${styles.split}`}>
        <div className="stack">
          <StatusLookup />

          <div className="alert">
            <h3>The short version of each status</h3>
            <ul>
              <li>
                <strong>Received</strong> — in the queue. Nothing has happened yet.
              </li>
              <li>
                <strong>In the machine</strong> — the AI desk is rewriting it in house style.
              </li>
              <li>
                <strong>Held for review</strong> — a human is deciding. This is not a rejection.
              </li>
              <li>
                <strong>Published</strong> — live on the site, with your name on it or without it.
              </li>
              <li>
                <strong>Not published</strong> — the editor passed. It happens to the best of us.
              </li>
              <li>
                <strong>Retrying</strong> — the robot hit a wall and is being sent back in.
              </li>
            </ul>
          </div>
        </div>

        <aside className={styles.aside}>
          <div className={styles.card}>
            <h2 className={styles.cardTitle}>Lost the token?</h2>
            <p className={styles.note}>
              It was shown once, after filing, and it is also the end of the tracking page address.
              The desk does not keep a public list of tokens — that would defeat the point of having
              one.
            </p>
            <p className={styles.note}>
              If it is gone, file again only if the story never appeared. Duplicate filings are
              detected and discarded, but the desk still counts the attempt against you.
            </p>
          </div>
        </aside>
      </div>
    </div>
  );
}
