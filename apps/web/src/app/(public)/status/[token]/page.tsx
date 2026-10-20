import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { StatusRefresher } from '@/components/forms/StatusRefresher';
import { ApiError, apiFetch } from '@/lib/api';
import { formatDateTime, pluralise } from '@/lib/format';
import { getPublicSettings } from '@/lib/settings';
import type { SubmissionDetail, SubmissionStatus } from '@/lib/types';
import styles from '@/components/forms/forms.module.css';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Submission status',
  robots: { index: false, follow: false },
};

const STATUS_BADGES: Record<SubmissionStatus, { label: string; className: string }> = {
  received: { label: 'Received', className: 'badge badge--info' },
  processing: { label: 'In the machine', className: 'badge badge--info' },
  queued_review: { label: 'Held for review', className: 'badge badge--review' },
  published: { label: 'Published', className: 'badge badge--published' },
  rejected: { label: 'Not published', className: 'badge badge--failed' },
  failed: { label: 'Retrying', className: 'badge badge--error' },
};

const ACTIVE_STATUSES: SubmissionStatus[] = ['received', 'processing', 'queued_review'];

function currentStepFor(status: SubmissionStatus): number {
  switch (status) {
    case 'received':
      return 0;
    case 'processing':
      return 1;
    case 'failed':
      return 1;
    case 'queued_review':
      return 2;
    case 'rejected':
      return 2;
    case 'published':
      return 3;
    default:
      return 0;
  }
}

interface StepView {
  title: string;
  copy: string;
}

function stepsFor(status: SubmissionStatus): StepView[] {
  return [
    {
      title: 'Received',
      copy: 'The desk has the story and a token with your name on it.',
    },
    {
      title: 'AI desk',
      copy:
        status === 'failed'
          ? 'The robot hit a wall. The story is safe and will be retried automatically.'
          : 'Rewritten in house style. The adjectives are escorted out.',
    },
    {
      title: 'Review',
      copy:
        status === 'rejected'
          ? 'The editor read it and passed. That is the whole review.'
          : 'Held for a human, because the risk desk has questions.',
    },
    {
      title: 'Published',
      copy: 'Live on the site, in this or a later edition.',
    },
  ];
}

/** Risk reasons are written as sentences, but older rows may hold codes. */
function friendlyReason(reason: string): string {
  const trimmed = reason.trim().slice(0, 240);
  if (!trimmed) return '';
  if (/publisher-flagged/i.test(trimmed)) {
    return 'Contains a phrase the publisher asked the desk to hold.';
  }
  if (!/\s/.test(trimmed)) {
    return 'The risk desk wants a human to read it before it runs.';
  }
  return trimmed.endsWith('.') || trimmed.endsWith('!') || trimmed.endsWith('?')
    ? trimmed
    : `${trimmed}.`;
}

function retrySecondsFrom(details: unknown): number | null {
  if (details && typeof details === 'object' && 'retryAfterSeconds' in details) {
    const value = (details as { retryAfterSeconds?: unknown }).retryAfterSeconds;
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value;
  }
  return null;
}

export default async function StatusDetailPage({
  params,
}: {
  params: Promise<{ token: string }>;
}): Promise<React.JSX.Element> {
  const { token } = await params;
  const settings = await getPublicSettings();

  let data: SubmissionDetail | null = null;
  let rateLimited = false;
  let retryAfter: number | null = null;

  try {
    data = await apiFetch<SubmissionDetail>(`/public/submissions/${encodeURIComponent(token)}`, {
      cache: 'no-store',
    });
  } catch (error) {
    if (error instanceof ApiError) {
      if (error.status === 404) notFound();
      if (error.status === 429) {
        rateLimited = true;
        retryAfter = retrySecondsFrom(error.details);
      } else {
        throw error;
      }
    } else {
      throw error;
    }
  }

  if (rateLimited) {
    return (
      <div className="container">
        <header className="page-head">
          <p className="eyebrow">Tracking desk</p>
          <h1>Too many checks</h1>
          <p className="lede">
            The desk rate-limits status checks per connection. Nothing is wrong with your story —
            the counter is simply doing its job.
          </p>
        </header>
        <div className={`section status-card ${styles.lookupWrap}`}>
          <p>
            Wait{' '}
            {retryAfter ? `about ${Math.max(1, Math.round(retryAfter))} seconds` : 'a little while'}{' '}
            and load this page again. Your token has not changed, and neither has the story.
          </p>
          <p>
            <Link className="button button--ghost" href="/status">
              Back to the lookup
            </Link>
          </p>
        </div>
      </div>
    );
  }

  if (!data) notFound();

  const timeZone = settings.site.timezone;
  const badge = STATUS_BADGES[data.status];
  const steps = stepsFor(data.status);
  const currentStep = currentStepFor(data.status);
  const active = ACTIVE_STATUSES.includes(data.status);
  const reasons = Array.from(
    new Set(data.reviewReasons.map(friendlyReason).filter((reason) => reason.length > 0)),
  ).slice(0, 8);
  const articleHref = data.article ? `/article/${data.article.slug}` : null;

  return (
    <div className="container">
      <header className="page-head">
        <p className="eyebrow">Tracking desk</p>
        <h1>Submission status</h1>
        <p className="lede">The desk&rsquo;s own account of what happened to your story.</p>
      </header>

      <div className={`section ${styles.statusGrid}`}>
        <div className="status-card">
          <div className={styles.statusHead}>
            <span className={badge.className}>{badge.label}</span>
            <span className={styles.metaValue}>{data.statusCopy}</span>
          </div>

          <h2 className={styles.statusTitle}>{data.headline}</h2>

          <div className={styles.metaList}>
            <div className={styles.metaRow}>
              <span className={styles.metaKey}>Submitted</span>
              <span className={styles.metaValue}>
                <time dateTime={data.createdAt}>
                  {formatDateTime(data.createdAt, timeZone) || data.createdAt}
                </time>{' '}
                ({timeZone})
              </span>
            </div>
            <div className={styles.metaRow}>
              <span className={styles.metaKey}>Last update</span>
              <span className={styles.metaValue}>
                {formatDateTime(data.updatedAt, timeZone) || data.updatedAt}
              </span>
            </div>
            <div className={styles.metaRow}>
              <span className={styles.metaKey}>Photos</span>
              <span className={styles.metaValue}>
                {pluralise(data.images.length, 'photo')} attached
              </span>
            </div>
          </div>

          <ol className="steps">
            {steps.map((step, index) => {
              const stateClass =
                index < currentStep
                  ? 'step step--done'
                  : index === currentStep
                    ? 'step step--active'
                    : 'step';
              return (
                <li
                  key={step.title}
                  className={stateClass}
                  aria-current={index === currentStep ? 'step' : undefined}
                >
                  <div>
                    <strong>{step.title}</strong>
                    <span>{step.copy}</span>
                  </div>
                </li>
              );
            })}
          </ol>

          {data.images.length > 0 ? (
            <ul className={styles.thumbGrid}>
              {data.images.map((image, index) => (
                <li key={image.id}>
                  {/* eslint-disable-next-line @next/next/no-img-element -- remote storage URLs are not configured for next/image */}
                  <img
                    className={styles.thumb}
                    src={image.thumbUrl ?? image.url}
                    alt={`Submitted photo ${index + 1} of ${data.images.length}`}
                    loading="lazy"
                  />
                </li>
              ))}
            </ul>
          ) : null}

          {data.status === 'published' && data.article && articleHref ? (
            <div className="alert alert--success" style={{ marginTop: 'var(--space-4)' }}>
              <h3>It&rsquo;s live.</h3>
              <p>
                The desk did not spike it.{' '}
                {data.article.breaking ? 'It is even marked breaking. ' : ''}
                The story is in the paper as &ldquo;{data.article.headline}&rdquo;.
              </p>
              <p style={{ marginTop: 'var(--space-3)' }}>
                <Link className="button button--sm" href={articleHref}>
                  Read it in the paper
                </Link>
              </p>
            </div>
          ) : null}

          {data.status === 'queued_review' ? (
            <div className="alert alert--warn" style={{ marginTop: 'var(--space-4)' }}>
              <h3>Why it is held</h3>
              {reasons.length > 0 ? (
                <ul>
                  {reasons.map((reason) => (
                    <li key={reason}>{reason}</li>
                  ))}
                </ul>
              ) : (
                <p>
                  The risk desk flagged it but did not file a reason. A human will read it before
                  anything is published.
                </p>
              )}
              <p style={{ marginTop: 'var(--space-2)' }}>
                A hold is not a rejection. It means somebody has to think about it.
              </p>
            </div>
          ) : null}

          {data.status === 'rejected' ? (
            <div className="alert" style={{ marginTop: 'var(--space-4)' }}>
              <h3>It was not published</h3>
              <p>{data.statusCopy}</p>
              <p style={{ marginTop: 'var(--space-2)' }}>
                The desk does not publish a post-mortem. You are welcome to file something else.
              </p>
            </div>
          ) : null}

          {data.status === 'failed' ? (
            <div className="alert alert--warn" style={{ marginTop: 'var(--space-4)' }}>
              <h3>The robot hit a wall</h3>
              <p>
                {data.aiError ??
                  'The desk has not said why the AI pass failed. Your story is still on file.'}
              </p>
            </div>
          ) : null}

          <StatusRefresher active={active} />

          <div className={styles.refresher}>
            <Link
              className="button button--sm button--ghost"
              href={`/status/${encodeURIComponent(token)}`}
            >
              Check again
            </Link>
            <span className={styles.refresherNote}>No auto-refresh once the desk is finished.</span>
          </div>
        </div>

        <aside className={styles.aside}>
          <div className={styles.card}>
            <h2 className={styles.cardTitle}>Your token</h2>
            <code className={styles.tokenBox}>{token}</code>
            <p className={styles.note}>
              This is the only key to this page. The desk cannot look it up for you, and it does not
              appear anywhere public.
            </p>
          </div>

          <div className={styles.card}>
            <h2 className={styles.cardTitle}>What now?</h2>
            <p className={styles.note}>
              {data.status === 'published'
                ? 'Read it, share it, then regret the headline. The desk already has.'
                : data.status === 'rejected'
                  ? 'Nothing else happens to this filing. File a different story if you have one.'
                  : data.status === 'failed'
                    ? 'The desk retries failed AI passes on its own. Refiling the same story will not speed that up.'
                    : data.status === 'queued_review'
                      ? 'A human will get to it. The queue is not fast, and nobody here pretends otherwise.'
                      : 'Leave the page open while the desk works, or come back with the token. Nothing is lost if you close it.'}
            </p>
            <p className={styles.note}>
              <Link href="/submit">File another story</Link> ·{' '}
              <Link href="/status">Track another</Link>
            </p>
          </div>
        </aside>
      </div>
    </div>
  );
}
