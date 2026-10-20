'use client';

import { useEffect, useState } from 'react';
import { formatNumber } from '@/lib/format';
import type { ArticleVoteCounts } from '@/lib/types';
import { communityErrorMessage, communityFetch } from './api';
import styles from './community.module.css';

export interface VoteBarProps {
  articleId: string;
  initialLikes: number;
  initialDislikes: number;
  enabled: boolean;
}

export function VoteBar({
  articleId,
  initialLikes,
  initialDislikes,
  enabled,
}: VoteBarProps): React.JSX.Element | null {
  const [likes, setLikes] = useState(initialLikes);
  const [dislikes, setDislikes] = useState(initialDislikes);
  const [myVote, setMyVote] = useState<-1 | 0 | 1 | null>(null);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!enabled) {
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
      })
      .catch(() => {
        // The counts from the server render are still useful; voting will
        // surface a real error if the BFF is unreachable.
      })
      .finally(() => setReady(true));
    return () => controller.abort();
  }, [articleId, enabled]);

  if (!enabled) return null;

  async function cast(value: -1 | 1): Promise<void> {
    if (busy || !ready) return;
    const next = myVote === value ? 0 : value;
    setBusy(true);
    setError('');
    try {
      const data = await communityFetch<ArticleVoteCounts>('/votes', {
        method: 'POST',
        body: { articleId, value: next },
      });
      setLikes(data.likes);
      setDislikes(data.dislikes);
      setMyVote(data.myVote);
    } catch (caught) {
      setError(communityErrorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  const note =
    myVote === 1
      ? 'You liked this story. Click again to undo.'
      : myVote === -1
        ? 'You disliked this story. Click again to undo.'
        : 'One vote per browser. Change it whenever you like.';

  return (
    <section className={styles.voteBar} aria-label="Rate this story">
      <h2 className={styles.voteHeading}>Was this worth your time?</h2>
      <div className={styles.voteButtons}>
        <button
          type="button"
          className={`${styles.voteButton} ${myVote === 1 ? styles.voteButtonUp : ''}`}
          aria-pressed={myVote === 1}
          aria-label="Like this story"
          onClick={() => void cast(1)}
          disabled={!ready || busy}
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
          disabled={!ready || busy}
        >
          <span aria-hidden="true">▼</span>
          <span>Dislike</span>
          <span className={styles.voteCount}>{formatNumber(dislikes)}</span>
        </button>
      </div>
      <p className={styles.voteMeta} aria-live="polite">
        {formatNumber(likes)} up · {formatNumber(dislikes)} down
      </p>
      <p className={error ? styles.voteError : styles.voteNote} role={error ? 'alert' : undefined}>
        {error || note}
      </p>
    </section>
  );
}
