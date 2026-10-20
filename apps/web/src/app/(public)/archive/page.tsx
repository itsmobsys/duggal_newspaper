import type { Metadata } from 'next';
import Link from 'next/link';
import { ArticleCard } from '@/components/ArticleCard';
import { EmptyState } from '@/components/EmptyState';
import { Pagination } from '@/components/Pagination';
import { SectionHeading } from '@/components/SectionHeading';
import { pluralise, todayIn } from '@/lib/format';
import { getArchiveMonths, getTagCloud, listArticles, type ArchiveMonth } from '@/lib/queries';
import { getPublicSettings } from '@/lib/settings';
import styles from './page.module.css';

export const revalidate = 60;

const PAGE_SIZE = 12;

interface ArchivePageProps {
  searchParams: Promise<{ month?: string | string[]; page?: string | string[] }>;
}

interface YearGroup {
  year: string;
  total: number;
  months: ArchiveMonth[];
}

function parsePage(value: string | string[] | undefined): number {
  const raw = Array.isArray(value) ? value[0] : value;
  const parsed = Number.parseInt(raw ?? '1', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

/** Accepts `YYYY-MM` only when the month is a real calendar month. */
function parseMonth(value: string | string[] | undefined): string | null {
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw || !/^\d{4}-\d{2}-\d{2}$/.test(`${raw}-01`)) return null;
  const month = Number(raw.slice(5, 7));
  if (!Number.isInteger(month) || month < 1 || month > 12) return null;
  return raw;
}

/** "October 2026" without hand-rolling month names. */
function monthLabel(month: string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    month: 'long',
    year: 'numeric',
    timeZone,
  }).format(new Date(`${month}-01T12:00:00Z`));
}

/** `getArchiveMonths` is already newest-first; keep that order inside years. */
function groupByYear(months: ArchiveMonth[]): YearGroup[] {
  const groups: YearGroup[] = [];
  for (const entry of months) {
    const year = entry.month.slice(0, 4);
    const last = groups[groups.length - 1];
    if (last && last.year === year) {
      last.months.push(entry);
      last.total += entry.count;
    } else {
      groups.push({ year, total: entry.count, months: [entry] });
    }
  }
  return groups;
}

export async function generateMetadata({ searchParams }: ArchivePageProps): Promise<Metadata> {
  const query = await searchParams;
  const settings = await getPublicSettings();
  const month = parseMonth(query.month);
  const label = month ? monthLabel(month, settings.site.timezone) : null;

  const title = label ? `Archive — ${label}` : 'Archive';
  const description = label
    ? `Every story printed in an edition dated ${label} in ${settings.site.name}.`
    : `Every edition of ${settings.site.name}, month by month. The whole paper, kept on the record.`;
  const canonical = month ? `/archive?month=${month}` : '/archive';

  return {
    title,
    description,
    alternates: { canonical },
    openGraph: {
      type: 'website',
      siteName: settings.site.name,
      title: label ? `Archive — ${label}` : `Archive — ${settings.site.name}`,
      description,
      url: canonical,
    },
  };
}

export default async function ArchivePage({
  searchParams,
}: ArchivePageProps): Promise<React.JSX.Element> {
  const query = await searchParams;
  const month = parseMonth(query.month);
  const page = parsePage(query.page);

  const [settings, months, tags] = await Promise.all([
    getPublicSettings(),
    getArchiveMonths(),
    getTagCloud(18),
  ]);

  const timeZone = settings.site.timezone;
  const currentMonth = todayIn(timeZone).slice(0, 7);
  const label = month ? monthLabel(month, timeZone) : null;

  const filtered = month
    ? await listArticles({
        editionMonth: month,
        limit: PAGE_SIZE,
        offset: (page - 1) * PAGE_SIZE,
      })
    : null;

  const groups = groupByYear(months);

  return (
    <div className="container">
      <header className="page-head">
        <div className="accent-bar" aria-hidden="true" />
        <p className="eyebrow">{month ? 'Month view' : 'Every paper, kept'}</p>
        {month ? (
          <Link className={styles.backLink} href="/archive">
            ← All months
          </Link>
        ) : null}
        <h1>{label ? `Archive — ${label}` : 'Archive'}</h1>
        <p className="lede">
          {filtered && label
            ? filtered.total > 0
              ? `${pluralise(filtered.total, 'story', 'stories')} printed in editions dated ${label}. Sorted newest first, because time is rude like that.`
              : `No stories were printed in editions dated ${label}. The archive lists what ran, not what we wish had run.`
            : 'The whole paper, sorted by the month it ran. No search-engine amnesia, no promises to fix the archives later.'}
        </p>
      </header>

      {month ? (
        <>
          {filtered && filtered.items.length > 0 ? (
            <div className="listing-grid">
              {filtered.items.map((article) => (
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
          ) : (
            <EmptyState
              title={`Nothing filed in ${label ?? 'that month'}`}
              message="No published story carries an edition date in this month. The desk does not backfill stories to make a month look busy."
              actionHref="/archive"
              actionLabel="Back to all months"
            />
          )}

          {filtered ? (
            <Pagination
              page={page}
              total={filtered.total}
              limit={PAGE_SIZE}
              basePath="/archive"
              query={{ month }}
            />
          ) : null}
        </>
      ) : (
        <section className="section" aria-labelledby="months-heading">
          <SectionHeading title="Browse by month" id="months-heading" />

          {groups.length > 0 ? (
            groups.map((group) => (
              <div className={styles.year} key={group.year}>
                <div className={styles.yearHead}>
                  <h3 id={`year-${group.year}`}>{group.year}</h3>
                  <span className={styles.yearTotal}>
                    {pluralise(group.total, 'story', 'stories')}
                  </span>
                </div>
                <ul className={styles.monthList} aria-labelledby={`year-${group.year}`}>
                  {group.months.map((entry) => (
                    <li key={entry.month}>
                      <Link
                        className={styles.monthLink}
                        href={`/archive?month=${entry.month}`}
                        aria-current={entry.month === currentMonth ? 'date' : undefined}
                      >
                        <span className={styles.monthName}>
                          {monthLabel(entry.month, timeZone)}
                          {entry.month === currentMonth ? (
                            <span className={styles.currentLabel}>Current</span>
                          ) : null}
                        </span>
                        <span className={styles.monthCount}>
                          {pluralise(entry.count, 'story', 'stories')}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))
          ) : (
            <EmptyState
              title="The archive is empty"
              message="Nothing has been published yet, so there are no months to index. The archive fills itself one edition at a time."
              actionHref="/submit"
              actionLabel="Submit the first story"
            />
          )}
        </section>
      )}

      <section className="section" aria-labelledby="topics-heading">
        <SectionHeading title="Topics" id="topics-heading" />
        {tags.length > 0 ? (
          <nav className="chips" aria-label="Browse stories by topic">
            {tags.map((tag) => (
              <Link
                key={tag.tag}
                className="chip"
                href={`/search?tag=${encodeURIComponent(tag.tag)}`}
              >
                {tag.tag}
                <span className="muted">{tag.count}</span>
              </Link>
            ))}
          </nav>
        ) : (
          <p className="muted">
            No topics have been indexed yet. Tags appear once published stories carry them.
          </p>
        )}
      </section>
    </div>
  );
}
