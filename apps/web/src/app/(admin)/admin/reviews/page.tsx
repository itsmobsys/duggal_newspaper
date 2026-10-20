import type { Metadata } from 'next';
import Link from 'next/link';
import { ReviewActions } from '@/components/admin/ReviewActions';
import { adminServerFetch } from '@/lib/admin-server';
import { formatDateTime } from '@/lib/format';
import styles from '@/components/admin/ops.module.css';
import reviewStyles from './page.module.css';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Reviews',
  robots: { index: false, follow: false },
};

const REVIEW_STATUSES = ['published', 'pending', 'hidden'] as const;
type ReviewStatus = (typeof REVIEW_STATUSES)[number];

interface ReviewRecord {
  id: string;
  article_id: string;
  display_name: string | null;
  rating: number;
  body: string;
  status: ReviewStatus;
  moderation_reason: string | null;
  created_at: string;
  updated_at: string;
  slug: string | null;
  headline: string | null;
}

interface ReviewsResponse {
  reviews: ReviewRecord[];
  counts: Array<{ status: string; count: number }>;
}

interface ReviewsPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function first(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? '';
  return value ?? '';
}

function isReviewStatus(value: string): value is ReviewStatus {
  return (REVIEW_STATUSES as readonly string[]).includes(value);
}

function isNextControlFlow(error: unknown): boolean {
  const digest = (error as { digest?: unknown } | null)?.digest;
  return typeof digest === 'string' && /^NEXT_(REDIRECT|NOT_FOUND)/.test(digest);
}

function errorText(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return 'The newsroom API rejected the request.';
}

function statusBadgeClass(status: ReviewStatus): string {
  switch (status) {
    case 'published':
      return 'badge badge--ok';
    case 'hidden':
      return 'badge badge--muted';
    default:
      return 'badge badge--warn';
  }
}

function countFor(counts: ReviewsResponse['counts'] | undefined, status: string): number {
  return Number(counts?.find((row) => row.status === status)?.count ?? 0);
}

export default async function AdminReviewsPage({
  searchParams,
}: ReviewsPageProps): Promise<React.JSX.Element> {
  const query = await searchParams;
  const rawStatus = first(query.status).trim();
  const status = isReviewStatus(rawStatus) ? rawStatus : '';

  const request = new URLSearchParams({ limit: '100' });
  if (status) request.set('status', status);

  let data: ReviewsResponse | null = null;
  let error: string | null = null;
  try {
    data = await adminServerFetch<ReviewsResponse>(`/admin/reviews?${request.toString()}`);
  } catch (caught) {
    if (isNextControlFlow(caught)) throw caught;
    error = errorText(caught);
  }

  const reviews = data?.reviews ?? null;

  return (
    <>
      <div className="admin-head">
        <div>
          <h1>Reviews</h1>
          <p className="muted" style={{ margin: '4px 0 0' }}>
            Reader reviews and star ratings. Publishing or hiding one immediately changes the story
            and the weekly leaderboard.
          </p>
        </div>
      </div>

      {error ? (
        <div className={`alert alert--error ${styles.noticeBar}`} role="alert">
          <h3>Reviews could not be loaded</h3>
          <p>{error}</p>
          <p className={styles.actionMessage}>Nothing has been changed.</p>
        </div>
      ) : null}

      <div className={styles.statRow}>
        <span>
          Published <strong>{countFor(data?.counts, 'published')}</strong>
        </span>
        <span>
          Pending <strong>{countFor(data?.counts, 'pending')}</strong>
        </span>
        <span>
          Hidden <strong>{countFor(data?.counts, 'hidden')}</strong>
        </span>
      </div>

      <form className="toolbar" method="get" action="/admin/reviews">
        <div className={styles.filter}>
          <label className={styles.filterLabel} htmlFor="review-status-filter">
            Status
          </label>
          <select className="select" id="review-status-filter" name="status" defaultValue={status}>
            <option value="">Any status</option>
            {REVIEW_STATUSES.map((option) => (
              <option value={option} key={option}>
                {option}
              </option>
            ))}
          </select>
        </div>
        <button className="button button--sm" type="submit">
          Filter
        </button>
        {status ? (
          <Link className="button button--ghost button--sm" href="/admin/reviews">
            Clear
          </Link>
        ) : null}
      </form>

      {reviews && reviews.length === 0 ? (
        <div className="empty-state">
          <h2>No reviews here</h2>
          <p>
            {status
              ? `Nothing with the status "${status}". The queue is clear.`
              : 'Readers have not reviewed anything yet. The form is live on every published story.'}
          </p>
        </div>
      ) : null}

      {reviews && reviews.length > 0 ? (
        <ul className={reviewStyles.list}>
          {reviews.map((review) => (
            <li key={review.id}>
              <article className={reviewStyles.card}>
                <div className={reviewStyles.main}>
                  <div className={reviewStyles.top}>
                    <div>
                      <p className={reviewStyles.meta}>
                        Received {formatDateTime(review.created_at)}
                        {review.updated_at !== review.created_at
                          ? ` · edited ${formatDateTime(review.updated_at)}`
                          : ''}
                      </p>
                      <h2 className={reviewStyles.headline}>
                        {review.slug ? (
                          <Link
                            href={`/article/${review.slug}`}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            {review.headline || review.slug} ↗
                          </Link>
                        ) : (
                          <span className="muted">Story no longer available</span>
                        )}
                      </h2>
                    </div>
                    <span className={statusBadgeClass(review.status)}>{review.status}</span>
                  </div>

                  <div className={reviewStyles.reviewer}>
                    <strong>{review.display_name || 'Anonymous reader'}</strong>
                    <span
                      className={reviewStyles.stars}
                      aria-label={`${review.rating} out of 5 stars`}
                    >
                      {'★'.repeat(review.rating)}
                      {'☆'.repeat(5 - review.rating)}
                    </span>
                    <span className={reviewStyles.rating}>{review.rating}/5</span>
                  </div>

                  <p className={reviewStyles.body}>{review.body}</p>

                  {review.moderation_reason ? (
                    <details className={reviewStyles.details}>
                      <summary>Moderation</summary>
                      <p>{review.moderation_reason}</p>
                    </details>
                  ) : null}
                </div>

                <div className={reviewStyles.actions}>
                  <ReviewActions reviewId={review.id} currentStatus={review.status} />
                </div>
              </article>
            </li>
          ))}
        </ul>
      ) : null}

      <p className={styles.actionMessage}>
        Hiding keeps the record for audit; deleting removes it. Either action revalidates the story
        and the weekly leaderboard. Reviews with links, banned words or spam signals are held as
        pending automatically.
      </p>
    </>
  );
}
