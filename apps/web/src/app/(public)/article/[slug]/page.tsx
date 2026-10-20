import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArticleBody } from '@/components/ArticleBody';
import { ArticleCard } from '@/components/ArticleCard';
import { ArticleFigure } from '@/components/ArticleFigure';
import { Byline } from '@/components/Byline';
import { ReviewSection } from '@/components/community/ReviewSection';
import { VoteBar } from '@/components/community/VoteBar';
import { JsonLd } from '@/components/JsonLd';
import { SectionHeading } from '@/components/SectionHeading';
import { formatDateShort } from '@/lib/format';
import { clampHeadline } from '@/lib/prose';
import {
  getArticle,
  getArticleVoteCounts,
  getEditionArticles,
  getRelatedArticles,
  getReviewSummary,
  listArticles,
  listPublishedReviews,
} from '@/lib/queries';
import { getPublicSettings, siteUrl } from '@/lib/settings';
import styles from './page.module.css';

export const revalidate = 60;

interface ArticlePageProps {
  params: Promise<{ slug: string }>;
}

function safeSource(value: string): { href: string; host: string } | null {
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    const host = url.hostname.replace(/^www\./, '');
    return host ? { href: url.toString(), host } : null;
  } catch {
    return null;
  }
}

function absoluteUrl(value: string, base: string): string {
  try {
    return new URL(value, base).toString();
  } catch {
    return value;
  }
}

export async function generateMetadata({ params }: ArticlePageProps): Promise<Metadata> {
  const { slug } = await params;
  const [article, settings] = await Promise.all([getArticle(slug), getPublicSettings()]);
  if (!article) return { title: 'Story not found', robots: { index: false, follow: false } };

  const description = article.dek ?? article.excerpt;
  const images = article.image
    ? [
        {
          url: article.image.url,
          width: article.image.width ?? 1200,
          height: article.image.height ?? 675,
          alt: article.image.alt ?? article.headline,
        },
      ]
    : [];

  return {
    title: article.headline,
    description,
    alternates: { canonical: `/article/${article.slug}` },
    openGraph: {
      type: 'article',
      siteName: settings.site.name,
      title: article.headline,
      description,
      url: `/article/${article.slug}`,
      publishedTime: article.publishedAt ?? undefined,
      modifiedTime: article.publishedAt ?? undefined,
      section: article.categoryName,
      authors: [article.authorDisplay],
      images,
    },
    twitter: {
      card: 'summary_large_image',
      title: article.headline,
      description,
      images: article.image ? [article.image.url] : [],
    },
  };
}

export default async function ArticlePage({
  params,
}: ArticlePageProps): Promise<React.JSX.Element> {
  const { slug } = await params;
  const [article, settings] = await Promise.all([getArticle(slug), getPublicSettings()]);
  if (!article) notFound();

  const timeZone = settings.site.timezone;
  const description = article.dek ?? article.excerpt;
  const [leadImage, ...remainingImages] = article.images;
  const source = article.sourceUrl ? safeSource(article.sourceUrl) : null;

  const [related, editionPool, voteCounts, reviewSummary, initialReviews] = await Promise.all([
    getRelatedArticles(article, 3),
    getEditionArticles(article.editionDate),
    getArticleVoteCounts(article.id),
    getReviewSummary(article.id),
    listPublishedReviews(article.id, 10, 0),
  ]);

  const editionStories = editionPool.filter((item) => item.id !== article.id).slice(0, 5);
  const hasEditionSiblings = editionStories.length > 0;
  const asideStories = hasEditionSiblings
    ? editionStories
    : (await listArticles({ limit: 5, excludeId: article.id })).items;

  const baseUrl = siteUrl(settings);
  const articleUrl = `${baseUrl}/article/${article.slug}`;
  const articleLd = {
    '@context': 'https://schema.org',
    '@type': 'NewsArticle',
    headline: article.headline,
    description,
    datePublished: article.publishedAt ?? undefined,
    dateModified: article.publishedAt ?? undefined,
    author: { '@type': 'Person', name: article.authorDisplay },
    publisher: {
      '@type': 'Organization',
      name: settings.site.name,
      url: baseUrl,
    },
    image:
      article.images.length > 0
        ? article.images.map((image) => absoluteUrl(image.url, baseUrl))
        : undefined,
    articleSection: article.categoryName,
    url: articleUrl,
    inLanguage: 'en-IN',
    isAccessibleForFree: true,
    ...(settings.community.reviewsEnabled && reviewSummary.count > 0
      ? {
          aggregateRating: {
            '@type': 'AggregateRating',
            ratingValue: reviewSummary.average,
            reviewCount: reviewSummary.count,
            bestRating: 5,
            worstRating: 1,
          },
        }
      : {}),
  };

  return (
    <div className="container">
      <nav className={styles.crumbs} aria-label="Breadcrumb">
        <ol>
          <li>
            <Link href="/">Home</Link>
          </li>
          <li className={styles.sep} aria-hidden="true">
            /
          </li>
          <li>
            <Link href={`/category/${article.categorySlug}`}>{article.categoryName}</Link>
          </li>
          <li className={styles.sep} aria-hidden="true">
            /
          </li>
          <li>
            <span aria-current="page">{clampHeadline(article.headline, 80)}</span>
          </li>
        </ol>
      </nav>

      <div className="article">
        <article className="article-main">
          <header className="article-header">
            <p className="card-kicker">
              <Link href={`/category/${article.categorySlug}`}>{article.categoryName}</Link>
              {article.breaking ? (
                <>
                  <span className="sep">/</span>
                  <span className="badge badge--breaking">Breaking</span>
                </>
              ) : null}
            </p>
            <h1 className="article-title">{article.headline}</h1>
            {article.dek ? <p className="article-dek">{article.dek}</p> : null}
            <Byline
              author={article.authorDisplay}
              publishedAt={article.publishedAt}
              readingMinutes={article.readingMinutes}
              timeZone={timeZone}
              editionDate={article.editionDate}
            />
          </header>

          {leadImage ? (
            <ArticleFigure image={leadImage} priority className="article-figure" />
          ) : null}

          <ArticleBody body={article.body} />

          {remainingImages.map((image) => (
            <ArticleFigure key={image.id} image={image} className="article-figure" />
          ))}

          {article.tags.length > 0 ? (
            <div className={styles.tags}>
              <ul className="tag-list" aria-label="Story tags">
                {article.tags.map((tag) => (
                  <li key={tag}>
                    <Link className="tag" href={`/search?tag=${encodeURIComponent(tag)}`}>
                      {tag}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {source ? (
            <p className={styles.source}>
              <span className={styles.noteLabel}>Source</span>
              <a href={source.href} target="_blank" rel="nofollow noopener noreferrer">
                {source.host}
                <span className="visually-hidden"> (opens in a new tab)</span>
              </a>
            </p>
          ) : null}

          {article.aiGenerated ? (
            <aside className={`article-note ${styles.note} ${styles.disclosure}`}>
              <span className={styles.noteLabel}>AI disclosure</span>
              <p>
                This story was rewritten by the AI desk
                {article.aiModel ? ` (${article.aiModel})` : ''} from a reader submission.{' '}
                <Link href="/standards">Read how we work</Link>.
              </p>
            </aside>
          ) : null}

          {article.editorNote ? (
            <aside className={`article-note ${styles.note}`}>
              <span className={styles.noteLabel}>Editor&rsquo;s note</span>
              <p>{article.editorNote}</p>
            </aside>
          ) : null}

          <VoteBar
            articleId={article.id}
            initialLikes={voteCounts.likes}
            initialDislikes={voteCounts.dislikes}
            enabled={settings.community.votingEnabled}
          />

          <div className={styles.actions}>
            <Link
              className="button button--sm button--ghost"
              href={`/report?article=${encodeURIComponent(article.id)}`}
            >
              Report a problem
            </Link>
            <Link
              className="button button--sm button--ghost"
              href={`/correction?article=${encodeURIComponent(article.id)}`}
            >
              Request a correction
            </Link>
          </div>

          <ReviewSection
            articleId={article.id}
            initialSummary={reviewSummary}
            initialReviews={initialReviews}
            enabled={settings.community.reviewsEnabled}
            maxChars={settings.community.reviewMaxChars}
            timeZone={timeZone}
          />
        </article>

        <aside className="article-aside" aria-label="Story sidebar">
          <section aria-labelledby="more-stories-heading">
            <h2 id="more-stories-heading" className={styles.asideTitle}>
              {hasEditionSiblings ? 'More from this edition' : 'More from the paper'}
            </h2>
            {asideStories.length > 0 ? (
              <ul className={styles.asideList}>
                {asideStories.map((story) => (
                  <li key={story.id}>
                    <Link href={`/article/${story.slug}`}>{clampHeadline(story.headline, 90)}</Link>
                    <span className={styles.asideTime}>
                      <time dateTime={story.publishedAt ?? undefined}>
                        {formatDateShort(story.publishedAt, timeZone)}
                      </time>
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted">No other stories are online yet.</p>
            )}
          </section>

          <section className={styles.cta} aria-labelledby="article-submit-heading">
            <h2 id="article-submit-heading">Got a better story?</h2>
            <p>The desk takes tips through the submission form. Bring receipts, not vibes.</p>
            <p>
              <Link className="button button--primary button--sm" href="/submit">
                Submit a story
              </Link>
            </p>
          </section>
        </aside>
      </div>

      {related.length > 0 ? (
        <section className="section" aria-labelledby="related-heading">
          <SectionHeading id="related-heading" title="Related stories" href="/latest" />
          <div className="listing-grid">
            {related.map((story) => (
              <ArticleCard
                key={story.id}
                article={story}
                variant="standard"
                showDek
                showMeta
                timeZone={timeZone}
              />
            ))}
          </div>
        </section>
      ) : null}

      <JsonLd data={articleLd} />
    </div>
  );
}
