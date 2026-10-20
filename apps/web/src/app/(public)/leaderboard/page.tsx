import type { Metadata } from 'next';
import Link from 'next/link';
import { EmptyState } from '@/components/EmptyState';
import { Stars } from '@/components/community/Stars';
import { formatDate, formatDateShort, formatNumber, weekBoundsFor } from '@/lib/format';
import { getWeeklyLeaderboard } from '@/lib/queries';
import { getPublicSettings, siteUrl } from '@/lib/settings';
import styles from './page.module.css';

export const revalidate = 30;

function weekLabel(startDate: string, endDate: string, timeZone: string): string {
  return `${formatDate(`${startDate}T12:00:00Z`, timeZone)} – ${formatDate(`${endDate}T12:00:00Z`, timeZone)}`;
}

function scoreLabel(score: number): string {
  const rounded = Math.round(score * 10) / 10;
  return rounded > 0 ? `+${rounded.toFixed(1)}` : rounded.toFixed(1);
}

export async function generateMetadata(): Promise<Metadata> {
  const settings = await getPublicSettings();
  const description = `The stories readers voted, argued about and reviewed most this week in ${settings.site.name}. Likes, dislikes and star ratings, capped so one review cannot run away with the table.`;
  return {
    title: 'Weekly leaderboard',
    description,
    alternates: { canonical: `${siteUrl(settings)}/leaderboard` },
    robots: settings.community.leaderboardEnabled ? undefined : { index: false, follow: false },
    openGraph: {
      type: 'website',
      siteName: settings.site.name,
      title: `Weekly leaderboard — ${settings.site.name}`,
      description,
      url: `${siteUrl(settings)}/leaderboard`,
    },
  };
}

export default async function LeaderboardPage(): Promise<React.JSX.Element> {
  const settings = await getPublicSettings();
  const timeZone = settings.site.timezone;

  if (!settings.community.leaderboardEnabled) {
    return (
      <div className="container">
        <header className="page-head">
          <div className="accent-bar" aria-hidden="true" />
          <p className="eyebrow">Reader-powered</p>
          <h1>Weekly leaderboard</h1>
        </header>
        <EmptyState
          title="The leaderboard is taking a break"
          message="The desk has switched the weekly table off for now. The stories are still online, and the archive is not going anywhere."
          actionHref="/latest"
          actionLabel="Read the latest"
        />
      </div>
    );
  }

  const now = new Date();
  const week = weekBoundsFor(now, timeZone);
  const entries = await getWeeklyLeaderboard(settings.community.leaderboardSize, timeZone, now);

  return (
    <div className="container">
      <header className="page-head">
        <div className="accent-bar" aria-hidden="true" />
        <p className="eyebrow">{weekLabel(week.startDate, week.endDate, timeZone)}</p>
        <h1>Weekly leaderboard</h1>
        <p className="lede">
          What readers actually did with the week&rsquo;s stories. Likes and dislikes set the
          baseline; reviews can move a story by up to twenty points either way. One browser, one
          vote, one review.
        </p>
      </header>

      {entries.length > 0 ? (
        <>
          <div className={styles.legend}>
            <span>Rank</span>
            <span>Story</span>
            <span>Votes</span>
            <span>Reviews</span>
            <span>Score</span>
          </div>
          <ol className={styles.list} aria-label="Weekly story ranking">
            {entries.map((entry) => (
              <li key={entry.id}>
                <article
                  className={`${styles.row} ${
                    entry.rank === 1 ? styles.first : entry.rank <= 3 ? styles.podium : ''
                  }`}
                >
                  <div className={styles.rank} aria-label={`Rank ${entry.rank}`}>
                    {entry.rank}
                  </div>

                  <div className={styles.story}>
                    <p className={styles.kicker}>
                      <Link href={`/category/${entry.categorySlug}`}>{entry.categoryName}</Link>
                      <span aria-hidden="true"> / </span>
                      <time dateTime={entry.publishedAt ?? undefined}>
                        {formatDateShort(entry.publishedAt, timeZone)}
                      </time>
                    </p>
                    <h2 className={styles.headline}>
                      <Link href={`/article/${entry.slug}`}>{entry.headline}</Link>
                    </h2>
                    {entry.dek ? <p className={styles.dek}>{entry.dek}</p> : null}
                  </div>

                  <div className={styles.metric}>
                    <span className={styles.metricLabel}>Votes</span>
                    <span className={styles.metricValue}>
                      <span className={styles.up}>▲ {formatNumber(entry.likes)}</span>
                      <span className={styles.down}>▼ {formatNumber(entry.dislikes)}</span>
                    </span>
                    <span className={styles.metricSub}>
                      {formatNumber(entry.likes - entry.dislikes)} net
                    </span>
                  </div>

                  <div className={styles.metric}>
                    <span className={styles.metricLabel}>Reviews</span>
                    {entry.reviewCount > 0 ? (
                      <>
                        <span className={styles.metricValue}>
                          <Stars value={entry.averageRating} compact />
                        </span>
                        <span className={styles.metricSub}>
                          {entry.averageRating.toFixed(1)} · {formatNumber(entry.reviewCount)}
                        </span>
                      </>
                    ) : (
                      <span className={styles.metricSub}>No reviews</span>
                    )}
                  </div>

                  <div className={styles.score}>
                    <span className={styles.metricLabel}>Score</span>
                    <strong>{scoreLabel(entry.score)}</strong>
                  </div>
                </article>
              </li>
            ))}
          </ol>

          <section className={styles.rules} aria-labelledby="leaderboard-rules">
            <h2 id="leaderboard-rules">How the table is calculated</h2>
            <p>
              Score = net votes + (average stars − 3) × the number of reviews, capped at ten. A
              ten-review pile-on can move a story by at most twenty points, so a single review can
              never bury a story on its own. Only stories published this week, and only published
              reviews, are counted. Ties break on net votes, then average stars, then review count,
              then publication time.
            </p>
            <p>
              There are no reader accounts. One browser gets one vote and one review per story, and
              both can be changed or removed.{' '}
              <Link href="/standards">Read the community standards</Link>.
            </p>
          </section>
        </>
      ) : (
        <EmptyState
          title="Nothing to rank yet"
          message="No stories have been published this week, so the table is empty. The moment the desk files something, it becomes eligible."
          actionHref="/latest"
          actionLabel="Read the latest"
        />
      )}
    </div>
  );
}
