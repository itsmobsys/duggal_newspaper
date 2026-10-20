import type { Metadata } from 'next';
import Link from 'next/link';
import { ReviewActions } from '@/components/admin/ReviewActions';
import { Stars } from '@/components/community/Stars';
import { adminServerFetch } from '@/lib/admin-server';
import { formatDateTime } from '@/lib/format';
import styles from '@/components/admin/ops.module.css';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Reviews',
  robots: { index: false, follow: false },
};

const REVIEW_STATUSES = ['pending', 'published', 'hidden', 'all'] as const;

type ReviewStatus = (typeof REVIEW_STATUSES)[number];

interface ReviewRecord {
  id: string;
  article_id: string;
  member_id: string;
  display_name: string | null;
  avatar_url: string | null;
  rating: number;
  body: string;
  status: 'published' | 'pending' | 'hidden';
  moderation_reason: string | null;
  created_at: string;
  updated_at: string;
  headline: string | null;
  slug: string | null;
  discord_username: string | null;
}

interface ReviewsResponse {
  reviews: ReviewRecord[];
  total: number;
  status: ReviewStatus;
}

function isNextControlFlow(error: unknown): boolean {
  const digest = (error as { digest?: unknown } | null)?.digest;
  return typeof digest === 'string' && /^NEXT_(REDIRECT|NOT_FOUND)/.test(digest);
}

function errorText(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return 'The newsroom API rejected the request.';
}

function first(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? '';
  return value ?? '';
}

function isReviewStatus(value: string): value is ReviewStatus {
  return (REVIEW_STATUSES as readonly string[]).includes(value);
}

function statusBadge(status: ReviewRecord['status']): string {
  if (status === 'published') return 'badge badge--ok';
  if (status === 'pending') return 'badge badge--warn';
  return 'badge badge--muted';
}

interface ReviewsPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function ReviewsPage({
  searchParams,
}: ReviewsPageProps): Promise<React.JSX.Element> {
  const query = await searchParams;
  const rawStatus = first(query.status).trim();
  const status: ReviewStatus = isReviewStatus(rawStatus) ? rawStatus : 'pending';

  const request = new URLSearchParams({ status, limit: '100' });

  let data: ReviewsResponse | null = null;
  let error: string | null = null;

  try {
    data = await adminServerFetch<ReviewsResponse>(`/admin/reviews?${request.toString()}`);
  } catch (caught) {
    if (isNextControlFlow(caught)) throw caught;
    error = errorText(caught);
  }

  return (
    <>
      <div className="admin-head">
        <div>
          <h1>Reviews</h1>
          <p className="muted" style={{ margin: '4px 0 0' }}>
            Reader ratings and comments. Reviews that fail the spam checks wait here; publishing one
            makes it count and appear on the story immediately.
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

      <form className="toolbar" method="get" action="/admin/reviews">
        <div className={styles.filter}>
          <label className={styles.filterLabel} htmlFor="review-status-filter">
            Status
          </label>
          <select className="select" id="review-status-filter" name="status" defaultValue={status}>
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
        {status !== 'pending' ? (
          <Link className="button button--ghost button--sm" href="/admin/reviews">
            Reset
          </Link>
        ) : null}
        {data ? (
          <span className={styles.actionMessage}>
            {data.total} {data.total === 1 ? 'review' : 'reviews'}
          </span>
        ) : null}
      </form>

      {data && data.reviews.length === 0 ? (
        <div className="empty-state">
          <h2>Nothing in this queue</h2>
          <p>
            {status === 'pending'
              ? 'No reviews are waiting for a human. The readership is behaving.'
              : `No reviews with the status "${status}".`}
          </p>
        </div>
      ) : null}

      {data && data.reviews.length > 0 ? (
        <div className="table-wrap">
          <table className="data-table">
            <caption className="visually-hidden">
              Reader reviews with status {status}, newest first. The API returns at most 100.
            </caption>
            <thead>
              <tr>
                <th scope="col">Received</th>
                <th scope="col">Story</th>
                <th scope="col">Reviewer</th>
                <th scope="col">Rating</th>
                <th scope="col">Review</th>
                <th scope="col">Status</th>
                <th scope="col">Actions</th>
              </tr>
            </thead>
            <tbody>
              {data.reviews.map((review) => (
                <tr key={review.id}>
                  <td className={styles.cellMuted}>
                    <span className={styles.mono}>{formatDateTime(review.created_at)}</span>
                  </td>
                  <td className={styles.cellStack}>
                    {review.slug ? (
                      <Link
                        className={styles.mono}
                        href={`/article/${review.slug}`}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        {review.headline || review.slug} ↗
                      </Link>
                    ) : (
                      <span className="muted">Missing article</span>
                    )}
                    <span className={styles.hash}>{review.article_id}</span>
                  </td>
                  <td className={styles.cellStack}>
                    <span>{review.display_name || 'Anonymous reader'}</span>
                    {review.discord_username ? (
                      <span className={styles.hash}>@{review.discord_username}</span>
                    ) : null}
                  </td>
                  <td>
                    <Stars value={review.rating} compact />
                  </td>
                  <td className={styles.cellStack}>
                    <p className={styles.detailText}>{review.body}</p>
                    {review.moderation_reason ? (
                      <span className={styles.hash}>note: {review.moderation_reason}</span>
                    ) : null}
                  </td>
                  <td>
                    <span className={statusBadge(review.status)}>{review.status}</span>
                  </td>
                  <td>
                    <ReviewActions reviewId={review.id} currentStatus={review.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      <p className={styles.actionMessage}>
        Hiding a review removes it from the story and from the rating. The author can edit it, which
        sends it back through moderation.
      </p>
    </>
  );
}
