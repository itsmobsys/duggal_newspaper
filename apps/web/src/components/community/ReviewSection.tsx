'use client';

import { useEffect, useRef, useState } from 'react';
import { formatDateShort, relativeTime } from '@/lib/format';
import type {
  CommunityReview,
  ReviewListResponse,
  ReviewSubmitResponse,
  ReviewSummary,
} from '@/lib/types';
import { communityErrorMessage, communityFetch } from './api';
import { Stars } from './Stars';
import styles from './community.module.css';

export interface ReviewSectionProps {
  articleId: string;
  initialSummary: ReviewSummary;
  initialReviews: CommunityReview[];
  enabled: boolean;
  maxChars: number;
  timeZone: string;
}

type Notice = { kind: 'ok' | 'warn' | 'error'; message: string } | null;

function ratingWords(value: number): string {
  if (value >= 5) return 'Essential';
  if (value >= 4) return 'Good';
  if (value >= 3) return 'Fine';
  if (value >= 2) return 'Meh';
  return 'Rough';
}

function reviewName(review: CommunityReview): string {
  return review.displayName?.trim() || 'Anonymous reader';
}

function statusCopy(review: CommunityReview): string | null {
  if (review.status === 'pending') {
    return 'Your review is waiting for a moderator. It will appear here and count towards the weekly table once it is published.';
  }
  if (review.status === 'hidden') {
    return 'A moderator hid this review. You can edit it to send it back for review.';
  }
  return null;
}

export function ReviewSection({
  articleId,
  initialSummary,
  initialReviews,
  enabled,
  maxChars,
  timeZone,
}: ReviewSectionProps): React.JSX.Element | null {
  const [summary, setSummary] = useState(initialSummary);
  const [reviews, setReviews] = useState(initialReviews);
  const [myReview, setMyReview] = useState<CommunityReview | null>(null);
  const [ready, setReady] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [rating, setRating] = useState(0);
  const [hoverRating, setHoverRating] = useState(0);
  const [name, setName] = useState('');
  const [body, setBody] = useState('');
  const [website, setWebsite] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const [fieldError, setFieldError] = useState('');
  const formStartedAt = useRef(Date.now());

  useEffect(() => {
    if (!enabled) {
      setReady(true);
      return;
    }
    const controller = new AbortController();
    communityFetch<ReviewListResponse>(
      `/reviews?articleId=${encodeURIComponent(articleId)}&limit=10`,
      { signal: controller.signal },
    )
      .then((data) => {
        setSummary(data.summary);
        setReviews(data.reviews);
        setMyReview(data.myReview);
        if (data.myReview) {
          setRating(data.myReview.rating);
          setName(data.myReview.displayName ?? '');
          setBody(data.myReview.body);
        }
      })
      .catch(() => {
        // The server-rendered reviews remain readable if the BFF is cold.
      })
      .finally(() => setReady(true));
    return () => controller.abort();
  }, [articleId, enabled]);

  if (!enabled) return null;

  const distribution = [...summary.distribution].sort((a, b) => b.rating - a.rating);
  const visibleReviews = reviews.filter((review) => review.id !== myReview?.id);
  const canLoadMore = reviews.length < summary.count;
  const overlay = myReview ? statusCopy(myReview) : null;
  const shownRating = hoverRating || rating;

  async function submit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setNotice(null);
    setFieldError('');
    const trimmed = body.trim();
    if (rating < 1) {
      setFieldError('Pick a rating before publishing.');
      return;
    }
    if (trimmed.length < 20) {
      setFieldError('Write at least 20 characters. A reaction is not a review.');
      return;
    }
    if (trimmed.length > maxChars) {
      setFieldError(`Keep it under ${maxChars} characters.`);
      return;
    }

    setBusy(true);
    try {
      const data = await communityFetch<ReviewSubmitResponse>('/reviews', {
        method: 'POST',
        body: {
          articleId,
          ...(name.trim() ? { displayName: name.trim() } : {}),
          rating,
          body: trimmed,
          website,
          formStartedAt: formStartedAt.current,
        },
      });
      setSummary(data.summary);
      setMyReview(data.review);
      if (data.published) {
        setReviews((current) => [
          data.review,
          ...current.filter((review) => review.id !== data.review.id),
        ]);
      } else {
        setReviews((current) => current.filter((review) => review.id !== data.review.id));
      }
      setNotice({
        kind: data.published ? 'ok' : 'warn',
        message: data.message,
      });
    } catch (caught) {
      setNotice({ kind: 'error', message: communityErrorMessage(caught) });
    } finally {
      setBusy(false);
    }
  }

  async function removeMine(): Promise<void> {
    if (!myReview) return;
    if (!window.confirm('Delete your review? The stars will stop counting immediately.')) return;
    setBusy(true);
    setNotice(null);
    try {
      const data = await communityFetch<{ ok: true; summary: ReviewSummary }>(
        `/reviews/${encodeURIComponent(articleId)}`,
        { method: 'DELETE' },
      );
      setSummary(data.summary);
      setReviews((current) => current.filter((review) => review.id !== myReview.id));
      setMyReview(null);
      setRating(0);
      setName('');
      setBody('');
      setNotice({ kind: 'ok', message: 'Your review has been deleted.' });
    } catch (caught) {
      setNotice({ kind: 'error', message: communityErrorMessage(caught) });
    } finally {
      setBusy(false);
    }
  }

  async function loadMore(): Promise<void> {
    if (loadingMore) return;
    setLoadingMore(true);
    try {
      const data = await communityFetch<ReviewListResponse>(
        `/reviews?articleId=${encodeURIComponent(articleId)}&limit=10&offset=${reviews.length}`,
      );
      setSummary(data.summary);
      setReviews((current) => {
        const seen = new Set(current.map((review) => review.id));
        return [...current, ...data.reviews.filter((review) => !seen.has(review.id))];
      });
    } catch (caught) {
      setNotice({ kind: 'error', message: communityErrorMessage(caught) });
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <section className={styles.reviewSection} aria-labelledby="reviews-heading">
      <div className={styles.reviewHeader}>
        <h2 id="reviews-heading">Reader reviews</h2>
        <div className={styles.reviewSummary}>
          {summary.count > 0 ? (
            <>
              <span className={styles.summaryScore}>{summary.average.toFixed(1)}</span>
              <div>
                <Stars value={summary.average} />
                <p className={styles.summaryCount}>
                  {summary.count} {summary.count === 1 ? 'review' : 'reviews'} so far
                </p>
              </div>
              <div className={styles.distribution} aria-hidden="true">
                {distribution.map((row) => (
                  <div className={styles.distributionRow} key={row.rating}>
                    <span>{row.rating}★</span>
                    <span className={styles.distributionTrack}>
                      <span
                        className={styles.distributionFill}
                        style={{
                          width: `${summary.count > 0 ? Math.round((row.count / summary.count) * 100) : 0}%`,
                        }}
                      />
                    </span>
                    <span>{row.count}</span>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <p className={styles.summaryCount}>No ratings yet. Be the first to call it.</p>
          )}
        </div>
      </div>

      {myReview && overlay ? <p className={styles.statusNote}>{overlay}</p> : null}

      {myReview ? (
        <div className={styles.myReview}>
          <div className={styles.myReviewHead}>
            <strong>Your review</strong>
            <div className={styles.myReviewActions}>
              <span
                className={`badge ${
                  myReview.status === 'published'
                    ? 'badge--ok'
                    : myReview.status === 'pending'
                      ? 'badge--warn'
                      : 'badge--muted'
                }`}
              >
                {myReview.status}
              </span>
              <button
                className="button button--ghost button--sm"
                type="button"
                onClick={() => void removeMine()}
                disabled={busy}
              >
                Delete
              </button>
            </div>
          </div>
          <div className={styles.reviewMeta}>
            <Stars value={myReview.rating} compact />
            <span className={styles.reviewTime}>{relativeTime(myReview.updatedAt)}</span>
          </div>
          <p className={styles.reviewBody}>{myReview.body}</p>
        </div>
      ) : null}

      <form className={styles.reviewForm} onSubmit={submit} noValidate>
        <p className={styles.formKicker}>{myReview ? 'Edit your review' : 'Leave a review'}</p>

        <div className={styles.ratingRow}>
          <span className="field-label" id="review-rating-label">
            Rating
          </span>
          <span
            className={styles.starPicker}
            role="group"
            aria-labelledby="review-rating-label"
            onMouseLeave={() => setHoverRating(0)}
          >
            {[1, 2, 3, 4, 5].map((star) => (
              <button
                key={star}
                type="button"
                className={`${styles.starPick} ${star <= shownRating ? styles.starPickOn : ''}`}
                aria-label={`${star} star${star === 1 ? '' : 's'}`}
                aria-pressed={rating === star}
                onMouseEnter={() => setHoverRating(star)}
                onFocus={() => setHoverRating(star)}
                onBlur={() => setHoverRating(0)}
                onClick={() => setRating(star)}
                disabled={busy}
              >
                ★
              </button>
            ))}
          </span>
          <span className={styles.ratingLabel}>
            {shownRating > 0 ? `${shownRating} — ${ratingWords(shownRating)}` : 'Pick 1 to 5'}
          </span>
        </div>

        <div className="field" style={{ marginTop: 'var(--space-3)' }}>
          <div className="field-label">
            <label htmlFor="review-name">Name (optional)</label>
          </div>
          <input
            className="input"
            id="review-name"
            name="name"
            type="text"
            value={name}
            onChange={(event) => setName(event.currentTarget.value)}
            maxLength={40}
            autoComplete="nickname"
            placeholder="Anonymous reader"
            disabled={busy}
          />
          <p className="field-help">Leave it blank and we will call you Anonymous reader.</p>
        </div>

        <div className="field">
          <div className="field-label">
            <label htmlFor="review-body">Your review</label>
          </div>
          <textarea
            className="textarea"
            id="review-body"
            name="body"
            value={body}
            onChange={(event) => setBody(event.currentTarget.value)}
            rows={6}
            maxLength={maxChars}
            placeholder="What worked, what didn't, and what you wish the desk had asked."
            disabled={busy}
            aria-describedby="review-body-help"
          />
          <p className="field-help" id="review-body-help">
            At least 20 characters. Links and spam are held for a human.
            <span
              className={`${styles.counter} ${body.length > maxChars ? styles.counterOver : ''}`}
            >
              {body.length}/{maxChars}
            </span>
          </p>
        </div>

        <div className="visually-hidden" aria-hidden="true">
          <label htmlFor="review-website">Website</label>
          <input
            id="review-website"
            name="website"
            type="text"
            tabIndex={-1}
            autoComplete="off"
            value={website}
            onChange={(event) => setWebsite(event.currentTarget.value)}
          />
        </div>

        {fieldError ? (
          <p className="field-error" role="alert">
            {fieldError}
          </p>
        ) : null}
        {notice ? (
          <div
            className={`alert ${notice.kind === 'error' ? 'alert--error' : notice.kind === 'warn' ? 'alert--warn' : 'alert--success'}`}
            role={notice.kind === 'error' ? 'alert' : 'status'}
          >
            <p>{notice.message}</p>
          </div>
        ) : null}

        <div className={styles.formActions}>
          <button
            className="button button--primary button--sm"
            type="submit"
            disabled={!ready || busy}
          >
            {busy ? 'Saving...' : myReview ? 'Update review' : 'Publish review'}
          </button>
          <p className={styles.formNote}>
            Reviews publish instantly when they pass the spam checks. No account needed.
          </p>
        </div>
      </form>

      {visibleReviews.length > 0 ? (
        <ol className={styles.reviewList}>
          {visibleReviews.map((review) => (
            <li key={review.id}>
              <article className={styles.reviewCard}>
                <div className={styles.reviewTop}>
                  <span className={styles.reviewName}>{reviewName(review)}</span>
                  <span className={styles.reviewMeta}>
                    <Stars value={review.rating} compact />
                    <time
                      className={styles.reviewTime}
                      dateTime={review.createdAt}
                      suppressHydrationWarning
                    >
                      {relativeTime(review.createdAt)}
                    </time>
                  </span>
                </div>
                <p className={styles.reviewBody}>{review.body}</p>
                {review.updatedAt !== review.createdAt ? (
                  <p className={styles.reviewEdited}>
                    Edited {formatDateShort(review.updatedAt, timeZone)}
                  </p>
                ) : null}
              </article>
            </li>
          ))}
        </ol>
      ) : (
        <p className={styles.emptyReviews}>
          {myReview?.status === 'published'
            ? 'Your review is the first one here. Give the rest of the readership time.'
            : 'No published reviews yet. The first one gets to set the tone.'}
        </p>
      )}

      {canLoadMore ? (
        <div className={styles.loadMore}>
          <button
            className="button button--ghost button--sm"
            type="button"
            onClick={() => void loadMore()}
            disabled={loadingMore}
          >
            {loadingMore ? 'Loading...' : 'Load more reviews'}
          </button>
        </div>
      ) : null}
    </section>
  );
}
