import type { Metadata } from 'next';
import Link from 'next/link';
import { ArticleCard } from '@/components/ArticleCard';
import { EmptyState } from '@/components/EmptyState';
import { SectionHeading } from '@/components/SectionHeading';
import { editionHeading, pluralise, relativeTime } from '@/lib/format';
import { excerptFrom } from '@/lib/prose';
import {
  getCategories,
  getCategoryStrips,
  getFrontPage,
  getTagCloudCached,
  listArticlesCached,
} from '@/lib/queries';
import { getPublicSettings } from '@/lib/settings';
import styles from './front.module.css';

export const revalidate = 60;

export async function generateMetadata(): Promise<Metadata> {
  const settings = await getPublicSettings();
  const description = settings.site.description;
  const title = `${settings.site.name} — ${settings.site.tagline}`;

  return {
    title: { absolute: title },
    description,
    alternates: { canonical: '/' },
    openGraph: {
      type: 'website',
      siteName: settings.site.name,
      title,
      description,
      url: '/',
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
    },
  };
}

export default async function FrontPage(): Promise<React.JSX.Element> {
  const settings = await getPublicSettings();
  const timeZone = settings.site.timezone;

  const [front, categories, tagCloud, justIn] = await Promise.all([
    getFrontPage({
      limit: settings.appearance.frontPageLimit,
      tickerCount: settings.appearance.tickerCount,
      timeZone,
    }),
    getCategories(),
    getTagCloudCached(12),
    listArticlesCached({ limit: 10 }),
  ]);

  const stripCategories = categories.filter((category) => category.publishedCount > 0).slice(0, 3);
  const stripResults = await getCategoryStrips(
    stripCategories.map((category) => category.slug),
    3,
  );
  const latest = front.latest.slice(0, 8);
  const edition = front.edition;
  const topics = tagCloud.filter((topic) => topic.tag.trim().length > 0);
  const shown = new Set<string>([
    ...(front.lead ? [front.lead.slug] : []),
    ...front.top.map((article) => article.slug),
    ...latest.map((article) => article.slug),
    ...[...stripResults.values()].flat().map((article) => article.slug),
  ]);
  const railItems = justIn.items.filter((article) => !shown.has(article.slug));

  return (
    <div className="container">
      <h1 className="visually-hidden">{settings.site.name} — front page</h1>

      {edition ? (
        <section className={`edition-banner ${styles.editionBanner}`} aria-label="Latest edition">
          <p className={styles.bannerKicker}>
            Edition · {editionHeading(edition.editionDate, timeZone)}
          </p>
          <h2 className={styles.bannerTitle}>
            <Link href={`/edition/${edition.editionDate}`}>
              {edition.headline ?? 'Read the latest edition'}
            </Link>
          </h2>
          {edition.summary ? (
            <p className={styles.bannerSummary}>{excerptFrom(edition.summary, 220)}</p>
          ) : null}
          <p className={styles.bannerMeta}>
            {pluralise(edition.articleCount, 'story', 'stories')} in this edition ·{' '}
            <Link href={`/edition/${edition.editionDate}`}>Open the edition</Link>
          </p>
        </section>
      ) : null}

      <div className="front-grid">
        <div className="front-main">
          <h2 className="visually-hidden">Top story</h2>
          {front.lead ? (
            <ArticleCard article={front.lead} variant="lead" priority timeZone={timeZone} />
          ) : (
            <EmptyState
              title="No paper yet"
              message="The newsroom has not printed a single story. The press is warm, the robot is idle, and the first edition is waiting for a tip."
              actionHref="/submit"
              actionLabel="Submit the first story"
            />
          )}

          {front.top.length > 0 ? (
            <>
              <h2 className="visually-hidden">More top stories</h2>
              <div className="top-grid">
                {front.top.map((article) => (
                  <ArticleCard
                    key={article.id}
                    article={article}
                    variant="top"
                    timeZone={timeZone}
                  />
                ))}
              </div>
            </>
          ) : null}

          {latest.length > 0 ? (
            <section className="section" aria-labelledby="latest-heading">
              <SectionHeading id="latest-heading" title="The Latest" href="/latest" />
              <div className="listing-grid">
                {latest.map((article) => (
                  <ArticleCard
                    key={article.id}
                    article={article}
                    variant="standard"
                    showDek
                    showMeta
                    timeZone={timeZone}
                  />
                ))}
              </div>
            </section>
          ) : null}

          {stripCategories.map((category) => {
            const result = stripResults.get(category.slug);
            if (!result || result.length === 0) return null;
            return (
              <section
                key={category.slug}
                className="section"
                aria-labelledby={`strip-${category.slug}`}
              >
                <SectionHeading
                  id={`strip-${category.slug}`}
                  title={category.name}
                  href={`/category/${category.slug}`}
                />
                <div className="listing-grid">
                  {result.map((article) => (
                    <ArticleCard
                      key={article.id}
                      article={article}
                      variant="standard"
                      showDek
                      showMeta
                      timeZone={timeZone}
                    />
                  ))}
                </div>
              </section>
            );
          })}

          <p className={styles.howItWorks}>
            How this paper works: tips arrive through the submission desk, the AI editor drafts
            them, and the edition goes to press at midnight IST.{' '}
            <Link href="/about">About the paper</Link> ·{' '}
            <Link href="/standards">Standards &amp; corrections</Link>
          </p>
        </div>

        <aside className="front-rail" aria-label="Front page highlights">
          <section
            className={`rail-panel ${styles.railPanel}`}
            aria-labelledby="tonight-edition-heading"
          >
            <h2 id="tonight-edition-heading">Tonight&rsquo;s edition</h2>
            {edition ? (
              <>
                <p className={styles.panelLead}>{editionHeading(edition.editionDate, timeZone)}</p>
                <p className={styles.panelText}>
                  {pluralise(edition.articleCount, 'story', 'stories')} filed in this edition.
                </p>
                <p>
                  <Link
                    className="button button--sm button--ghost"
                    href={`/edition/${edition.editionDate}`}
                  >
                    Read the edition
                  </Link>
                </p>
              </>
            ) : (
              <p className={styles.panelText}>
                Nothing has gone to press yet. The next edition lands at midnight IST, whether the
                stories are ready or not.
              </p>
            )}
          </section>

          {railItems.length > 0 ? (
            <section className={`rail-panel ${styles.railPanel}`} aria-labelledby="just-in-heading">
              <h2 id="just-in-heading">Just in</h2>
              <ol className="rail-list">
                {railItems.map((article, index) => (
                  <li className="rail-item" key={article.id}>
                    <span className="num rail-item__num" aria-hidden="true">
                      {String(index + 1).padStart(2, '0')}
                    </span>
                    <div>
                      <p className="headline">
                        <Link href={`/article/${article.slug}`}>{article.headline}</Link>
                      </p>
                      <p className="meta">{relativeTime(article.publishedAt) || 'Just filed'}</p>
                    </div>
                  </li>
                ))}
              </ol>
            </section>
          ) : null}

          {topics.length > 0 ? (
            <section className={`rail-panel ${styles.railPanel}`} aria-labelledby="topics-heading">
              <h2 id="topics-heading">Topics</h2>
              <p className={`chips ${styles.railTopics}`}>
                {topics.map((topic) => (
                  <Link
                    className="chip"
                    key={topic.tag}
                    href={`/search?tag=${encodeURIComponent(topic.tag)}`}
                  >
                    {topic.tag} <span className="muted">{topic.count}</span>
                  </Link>
                ))}
              </p>
            </section>
          ) : null}

          <section
            className={`rail-panel ${styles.railPanel} ${styles.ctaPanel}`}
            aria-labelledby="submit-panel-heading"
          >
            <h2 id="submit-panel-heading">File a story</h2>
            <p className={styles.panelText}>
              Got a tip, a grievance, or a group chat that has gone too far? Send it in. The robot
              decides what it deserves.
            </p>
            <p>
              <Link className="button button--primary button--sm" href="/submit">
                Submit a story
              </Link>
            </p>
          </section>
        </aside>
      </div>
    </div>
  );
}
