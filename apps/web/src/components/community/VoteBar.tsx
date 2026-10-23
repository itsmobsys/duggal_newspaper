'use client';

import { useEffect, useState } from 'react';
import { formatNumber } from '@/lib/format';
import { hasSessionHint } from '@/lib/session-hint';
import type { ArticleVoteCounts } from '@/lib/types';
import { communityErrorMessage, communityFetch, loginHref } from './api';
import styles from './community.module.css';

export interface VoteBarProps {
  articleId: string;
  articleSlug: string;
  initialLikes: number;
  initialDislikes: number;
  enabled: boolean;
}

export function VoteBar({
  articleId,
  articleSlug,
  initialLikes,
  initialDislikes,
  enabled,
}: VoteBarProps): React.JSX.Element | null {
  const [likes, setLikes] = useState(initialLikes);
  const [dislikes, setDislikes] = useState(initialDislikes);
  const [myVote, setMyVote] = useState<-1 | 1 | null>(null);
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!enabled) {
      setReady(true);
      return;
    }
    if (!hasSessionHint()) {
      setAuthenticated(false);
      setReady(true);
      return;
    }
    const controller = new AbortController();
    communityFetch<ArticleVoteCounts>(`/votes/${encodeURIComponent(articleId)}`, {
      signal: controller.signal,
    })
      .then((data) => {
        setLikes(data.likes);
        setDislikes(data.dislikes);
        setMyVote(data.myVote);
        setAuthenticated(data.authenticated);
      })
      .catch(() => {
        // Server-rendered counts remain usable; voting will surface the real
        // error if the BFF is unreachable.
      })
      .finally(() => setReady(true));
    return () => controller.abort();
  }, [articleId, enabled]);

  if (!enabled) return null;

  const canVote = ready && authenticated === true && !busy;

  function cast(value: -1 | 1): void {
    if (!canVote) return;
    const next: -1 | 0 | 1 = myVote === value ? 0 : value;
    // Optimistic paint: the click reacts instantly, the server response then
    // reconciles the real totals so nobody can fake counts from the browser.
    setLikes(likes + (next === 1 ? 1 : myVote === 1 ? -1 : 0));
    setDislikes(dislikes + (next === -1 ? 1 : myVote === -1 ? -1 : 0));
    setMyVote(next === 0 ? null : next);
    setBusy(true);
    setError('');
    void communityFetch<ArticleVoteCounts>('/votes', {
      method: 'POST',
      body: { articleId, value: next },
    })
      .then((data) => {
        setLikes(data.likes);
        setDislikes(data.dislikes);
        setMyVote(data.myVote ? data.myVote : null);
        setAuthenticated(data.authenticated);
      })
      .catch((caught: unknown) => {
        setError(communityErrorMessage(caught));
        setLikes(likes);
        setDislikes(dislikes);
        setMyVote(myVote);
      })
      .finally(() => {
        setBusy(false);
      });
  }

  const note =
    myVote === 1
      ? 'You liked this story. Click again to undo.'
      : myVote === -1
        ? 'You disliked this story. Click again to undo.'
        : 'One vote per member. Change it whenever you like.';

  return (
    <section className={styles.voteBar} aria-label="Like or dislike this story">
      <h2 className={styles.voteHeading}>Was this worth your time?</h2>
      <div className={styles.voteButtons}>
        <button
          type="button"
          className={`${styles.voteButton} ${myVote === 1 ? styles.voteButtonUp : ''}`}
          aria-pressed={myVote === 1}
          aria-label="Like this story"
          onClick={() => void cast(1)}
          disabled={!canVote}
        >
          <span aria-hidden="true">▲</span>
          <span>Like</span>
          <span className={styles.voteCount}>{formatNumber(likes)}</span>
        </button>
        <button
          type="button"
          className={`${styles.voteButton} ${myVote === -1 ? styles.voteButtonDown : ''}`}
          aria-pressed={myVote === -1}
          aria-label="Dislike this story"
          onClick={() => void cast(-1)}
          disabled={!canVote}
        >
          <span aria-hidden="true">▼</span>
          <span>Dislike</span>
          <span className={styles.voteCount}>{formatNumber(dislikes)}</span>
        </button>
      </div>
      <p className={styles.voteMeta} aria-live="polite">
        {formatNumber(likes)} up · {formatNumber(dislikes)} down
      </p>
      {authenticated === false ? (
        <p className={styles.voteNote}>
          <a href={loginHref(`/article/${articleSlug}`)}>Log in with Discord</a> to vote. Counts are
          public; votes are tied to your account.
        </p>
      ) : (
        <p
          className={error ? styles.voteError : styles.voteNote}
          role={error ? 'alert' : undefined}
        >
          {error || note}
        </p>
      )}
    </section>
  );
}
