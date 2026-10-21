import type { Metadata } from 'next';
import Link from 'next/link';
import { EmptyState } from '@/components/EmptyState';
import { Pagination } from '@/components/Pagination';
import { editionHeading, pluralise, weekdayFor } from '@/lib/format';
import { excerptFrom } from '@/lib/prose';
import { listEditionsCached } from '@/lib/queries';
import { getPublicSettings, siteUrl } from '@/lib/settings';
import styles from './page.module.css';

export const revalidate = 60;

const PAGE_SIZE = 12;

interface EditionsPageProps {
  searchParams: Promise<{ page?: string | string[] }>;
}

function parsePage(value: string | string[] | undefined): number {
  const raw = Array.isArray(value) ? value[0] : value;
  const parsed = Number.parseInt(raw ?? '1', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
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

export async function generateMetadata({ searchParams }: EditionsPageProps): Promise<Metadata> {
  const query = await searchParams;
  const page = parsePage(query.page);
  const settings = await getPublicSettings();
  const baseUrl = siteUrl(settings);

  const title = page > 1 ? `Editions — page ${page}` : 'Editions';
  const description = `Every daily edition of ${settings.site.name}, one date at a time. Issues are assembled from reader submissions and go live at midnight IST.`;
  const canonical = page > 1 ? `/editions?page=${page}` : '/editions';

  return {
    title,
    description,
    alternates: { canonical: `${baseUrl}${canonical}` },
    openGraph: {
      type: 'website',
      siteName: settings.site.name,
      title: `${title} — ${settings.site.name}`,
      description,
      url: `${baseUrl}${canonical}`,
    },
  };
}

export default async function EditionsPage({
  searchParams,
}: EditionsPageProps): Promise<React.JSX.Element> {
  const query = await searchParams;
  const page = parsePage(query.page);

  const [settings, editions] = await Promise.all([
    getPublicSettings(),
    listEditionsCached(PAGE_SIZE, (page - 1) * PAGE_SIZE),
  ]);

  const timeZone = settings.site.timezone;

  return (
    <div className="container">
      <header className="page-head">
        <div className="accent-bar" aria-hidden="true" />
        <p className="eyebrow">The paper, dated</p>
        <h1>Editions</h1>
        <p className="lede">
          Every night the desk assembles a dated issue from the day&rsquo;s published stories. By
          default the build starts at 23:00 IST and the new edition goes live at midnight IST,
          whether or not anyone remembered to sleep.
        </p>
      </header>

      {editions.items.length > 0 ? (
        <ol className={styles.list}>
          {editions.items.map((edition) => (
            <li className={styles.item} key={edition.editionDate}>
              <article className={styles.edition}>
                <div className={styles.dateColumn}>
                  <Link
                    className={styles.dateLink}
                    href={`/edition/${edition.editionDate}`}
                    aria-label={`Open the edition of ${editionHeading(edition.editionDate, timeZone)}`}
                  >
                    <time dateTime={edition.editionDate}>
                      <span className={styles.day}>
                        {String(Number(edition.editionDate.slice(8, 10)))}
                      </span>
                      <span className={styles.month}>{monthName(edition.editionDate)}</span>
                      <span className={styles.year}>{edition.editionDate.slice(0, 4)}</span>
                    </time>
                  </Link>
                </div>

                <div className={styles.body}>
                  <p className="card-kicker">
                    Edition <span className="sep">/</span>{' '}
                    {weekdayFor(edition.editionDate, timeZone)}
                  </p>

                  <h2 className={styles.headline}>
                    <Link href={`/edition/${edition.editionDate}`}>
                      {edition.headline ?? `The edition of ${monthName(edition.editionDate)}`}
                    </Link>
                  </h2>

                  {edition.summary ? (
                    <p className={styles.summary}>{excerptFrom(edition.summary, 220)}</p>
                  ) : (
                    <p className={`${styles.summary} muted`}>
                      This edition carries no written summary.
                    </p>
                  )}

                  <p className={styles.meta}>
                    <span>{pluralise(edition.articleCount, 'story', 'stories')}</span>
                    <span className={styles.metaDivider} aria-hidden="true" />
                    <span>{assemblyLabel(edition.generatedBy)}</span>
                  </p>
                </div>
              </article>
            </li>
          ))}
        </ol>
      ) : (
        <EmptyState
          title={page > 1 ? 'No editions on this page' : 'No editions yet'}
          message={
            page > 1
              ? 'This page is past the end of the edition list. The archive does not pad itself with empty issues.'
              : 'Nothing has gone to press yet. The first dated edition appears after the 23:00 IST build, and only if there are published stories to put in it.'
          }
          actionHref={page > 1 ? '/editions' : '/submit'}
          actionLabel={page > 1 ? 'Back to the first page' : 'Submit a story'}
        />
      )}

      <Pagination page={page} total={editions.total} limit={PAGE_SIZE} basePath="/editions" />
    </div>
  );
}
