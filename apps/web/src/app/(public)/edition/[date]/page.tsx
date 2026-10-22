import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArticleCard } from '@/components/ArticleCard';
import { EmptyState } from '@/components/EmptyState';
import { JsonLd } from '@/components/JsonLd';
import { SectionHeading } from '@/components/SectionHeading';
import { editionHeading, formatDateTime, pluralise, weekdayFor } from '@/lib/format';
import { excerptFrom } from '@/lib/prose';
import { getEdition, getEditionArticles } from '@/lib/queries';
import { getPublicSettings, siteUrl } from '@/lib/settings';
import styles from './page.module.css';

export const revalidate = 60;
export const dynamicParams = true;

/**
 * An empty generator is what tells Next this dynamic segment is cacheable.
 * Without it the route is rendered per request and `revalidate` is ignored.
 */
export function generateStaticParams(): Array<{ date: string }> {
  return [];
}

interface EditionPageProps {
  params: Promise<{ date: string }>;
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Accepts only real calendar dates: 2026-02-30 is not an edition. */
function isRealDate(value: string): boolean {
  const match = ISO_DATE.exec(value);
  if (!match) return false;
  const [, yearPart, monthPart, dayPart] = match;
  if (!yearPart || !monthPart || !dayPart) return false;

  const year = Number(yearPart);
  const month = Number(monthPart);
  const day = Number(dayPart);
  const date = new Date(Date.UTC(year, month - 1, day));

  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

/** Month name straight from ICU; the date is anchored at noon UTC so no zone can shift it. */
function monthName(date: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    month: 'long',
    timeZone: 'UTC',
  }).format(new Date(`${date}T12:00:00Z`));
}

function assemblyLabel(value: string): string {
  if (value === 'ai') return 'Assembled by the AI desk';
  if (value === 'fallback') return 'Assembled by the deterministic fallback layout';
  return `Assembled by ${value}`;
}

export async function generateMetadata({ params }: EditionPageProps): Promise<Metadata> {
  const { date } = await params;
  const settings = await getPublicSettings();
  const baseUrl = siteUrl(settings);

  if (!isRealDate(date)) {
    return { title: 'Edition not found', robots: { index: false, follow: false } };
  }

  const edition = await getEdition(date);
  if (!edition) {
    return { title: 'Edition not found', robots: { index: false, follow: false } };
  }

  const heading = editionHeading(date, settings.site.timezone);
  const title = `Edition — ${heading}`;
  const description =
    excerptFrom(edition.summary, 160) ||
    `The ${heading} edition of ${settings.site.name}: ${pluralise(
      edition.articleCount,
      'published story',
      'published stories',
    )}.`;

  return {
    title,
    description,
    alternates: { canonical: `${baseUrl}/edition/${date}` },
    openGraph: {
      type: 'website',
      siteName: settings.site.name,
      title: `${title} — ${settings.site.name}`,
      description,
      url: `${baseUrl}/edition/${date}`,
    },
  };
}

export default async function EditionPage({
  params,
}: EditionPageProps): Promise<React.JSX.Element> {
  const { date } = await params;
  if (!isRealDate(date)) notFound();

  const [settings, edition] = await Promise.all([getPublicSettings(), getEdition(date)]);
  if (!edition) notFound();

  const articles = await getEditionArticles(date);
  const timeZone = settings.site.timezone;

  const lead =
    articles.find((article) => article.id === edition.leadArticleId) ?? articles[0] ?? null;
  const rest = lead ? articles.filter((article) => article.id !== lead.id) : articles;
  const top = rest.slice(0, 4);
  const listing = rest.slice(4);

  const baseUrl = siteUrl(settings);
  const editionUrl = `${baseUrl}/edition/${date}`;
  const heading = editionHeading(date, timeZone);

  const editionLd = {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: edition.headline ?? `Edition of ${heading}`,
    description: edition.summary ?? undefined,
    url: editionUrl,
    isPartOf: {
      '@type': 'WebSite',
      name: settings.site.name,
      url: baseUrl,
    },
    about: {
      '@type': 'Periodical',
      name: settings.site.name,
      url: baseUrl,
    },
    hasPart: articles.map((article) => ({
      '@type': 'NewsArticle',
      headline: article.headline,
      url: `${baseUrl}/article/${article.slug}`,
      datePublished: article.publishedAt ?? undefined,
    })),
    inLanguage: 'en-IN',
    isAccessibleForFree: true,
  };

  return (
    <div className="container">
      <header className={`page-head ${styles.hero}`}>
        <div className="accent-bar" aria-hidden="true" />
        <p className="eyebrow">
          <Link className={styles.eyebrowLink} href="/editions">
            Editions
          </Link>
          <span className="sep">/</span>
          {weekdayFor(date, timeZone)}
        </p>

        <h1 className={styles.date}>{heading}</h1>

        {edition.headline ? <p className={styles.headline}>{edition.headline}</p> : null}

        {edition.summary ? (
          <p className="lede">{edition.summary}</p>
        ) : (
          <p className="lede muted">This edition carries no written summary.</p>
        )}

        <ul className={styles.meta}>
          <li>{pluralise(edition.articleCount, 'story', 'stories')}</li>
          {edition.mood ? <li>Mood: {edition.mood}</li> : null}
          <li>{assemblyLabel(edition.generatedBy)}</li>
          <li>
            <time dateTime={edition.updatedAt}>
              Updated {formatDateTime(edition.updatedAt, timeZone)}
            </time>
          </li>
        </ul>
      </header>

      {lead ? (
        <section className="section" aria-labelledby="edition-lead-heading">
          <SectionHeading id="edition-lead-heading" title="The lead" />
          <ArticleCard article={lead} variant="lead" priority timeZone={timeZone} />
        </section>
      ) : null}

      {top.length > 0 ? (
        <section className="section" aria-labelledby="edition-front-heading">
          <SectionHeading id="edition-front-heading" title="Front page" />
          <div className="top-grid">
            {top.map((article) => (
              <ArticleCard key={article.id} article={article} variant="top" timeZone={timeZone} />
            ))}
          </div>
        </section>
      ) : null}

      {listing.length > 0 ? (
        <section className="section" aria-labelledby="edition-rest-heading">
          <SectionHeading id="edition-rest-heading" title="Also in this edition" />
          <div className="listing-grid">
            {listing.map((article) => (
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

      {articles.length === 0 ? (
        <EmptyState
          title={`No stories in the ${monthName(date)} ${date.slice(0, 4)} edition`}
          message="The edition record exists, but no published story carries this edition date. The desk does not invent copy to fill a page."
          actionHref="/editions"
          actionLabel="Back to editions"
        />
      ) : null}

      <JsonLd data={editionLd} />
    </div>
  );
}
