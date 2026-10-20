import type { Metadata } from 'next';
import Link from 'next/link';
import { ArticleCard } from '@/components/ArticleCard';
import { EmptyState } from '@/components/EmptyState';
import { Pagination } from '@/components/Pagination';
import { SectionHeading } from '@/components/SectionHeading';
import { SiteSearch } from '@/components/SiteSearch';
import { pluralise } from '@/lib/format';
import { getCategories, getTagCloud, listArticles } from '@/lib/queries';
import { getPublicSettings } from '@/lib/settings';
import styles from './page.module.css';

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 12;

interface SearchPageProps {
  searchParams: Promise<{
    q?: string | string[];
    tag?: string | string[];
    category?: string | string[];
    page?: string | string[];
  }>;
}

function first(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? '';
}

function parsePage(value: string | string[] | undefined): number {
  const raw = first(value);
  const parsed = Number.parseInt(raw || '1', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

function buildHref(filters: { q?: string; tag?: string; category?: string }): string {
  const params = new URLSearchParams();
  if (filters.q) params.set('q', filters.q);
  if (filters.tag) params.set('tag', filters.tag);
  if (filters.category) params.set('category', filters.category);
  const suffix = params.toString();
  return suffix ? `/search?${suffix}` : '/search';
}

export async function generateMetadata(): Promise<Metadata> {
  const settings = await getPublicSettings();
  return {
    title: 'Search',
    description: `Search every headline, story, dek and tag in ${settings.site.name}.`,
    alternates: { canonical: '/search' },
    robots: { index: false, follow: true },
  };
}

export default async function SearchPage({
  searchParams,
}: SearchPageProps): Promise<React.JSX.Element> {
  const query = await searchParams;
  const q = first(query.q).trim().slice(0, 120);
  const tag = first(query.tag).trim().slice(0, 40);
  const category = first(query.category).trim().slice(0, 80);
  const page = parsePage(query.page);
  const hasFilters = Boolean(q || tag || category);

  const [settings, categories, tagCloud] = await Promise.all([
    getPublicSettings(),
    getCategories(),
    getTagCloud(18),
  ]);

  const categoryName = categories.find((item) => item.slug === category)?.name;
  const topics = tagCloud.filter((topic) => topic.tag.trim().length > 0);
  const result = hasFilters
    ? await listArticles({
        query: q || undefined,
        tag: tag || undefined,
        category: category || undefined,
        limit: PAGE_SIZE,
        offset: (page - 1) * PAGE_SIZE,
      })
    : null;
  const recent = hasFilters ? [] : (await listArticles({ limit: 6 })).items;

  let heading = 'Search the morgue';
  if (q) heading = `Search results for “${q}”`;
  else if (tag) heading = `Stories tagged “${tag}”`;
  else if (category) heading = `Stories in ${categoryName ?? category}`;

  const activeFilters = [
    q ? `“${q}”` : null,
    tag ? `tag “${tag}”` : null,
    category ? `section “${categoryName ?? category}”` : null,
  ]
    .filter((value): value is string => value !== null)
    .join(' · ');

  return (
    <div className="container">
      <header className="page-head">
        <div className="accent-bar" aria-hidden="true" />
        <p className="eyebrow">The archive</p>
        <h1>{heading}</h1>
        <p className="lede">
          {hasFilters
            ? 'Matches are pulled from every published headline, dek, body and tag.'
            : 'Search every published headline, dek, body and tag. The archive is small, honest and occasionally regrettable.'}
        </p>
      </header>

      <section className={styles.filters} aria-label="Search and filters">
        <SiteSearch action="/search" defaultValue={q} />

        {hasFilters ? (
          <div className={styles.activeFilters}>
            <span className={styles.filterLabel}>Active filters</span>
            {q ? (
              <Link
                className="chip"
                href={buildHref({ tag, category })}
                aria-label={`Remove search query ${q}`}
              >
                “{q}” ×
              </Link>
            ) : null}
            {tag ? (
              <Link
                className="chip"
                href={buildHref({ q, category })}
                aria-label={`Remove tag filter ${tag}`}
              >
                Tag: {tag} ×
              </Link>
            ) : null}
            {category ? (
              <Link
                className="chip"
                href={buildHref({ q, tag })}
                aria-label={`Remove section filter ${categoryName ?? category}`}
              >
                Section: {categoryName ?? category} ×
              </Link>
            ) : null}
            <Link className="chip" href="/search">
              Clear all
            </Link>
          </div>
        ) : null}

        {categories.length > 0 ? (
          <div className={styles.filterGroup}>
            <p className={styles.filterLabel}>Sections</p>
            <div className="chips">
              {categories.map((item) => (
                <Link
                  key={item.slug}
                  className="chip"
                  href={buildHref({ q, tag, category: item.slug })}
                  aria-current={item.slug === category ? 'page' : undefined}
                >
                  {item.name}
                </Link>
              ))}
            </div>
          </div>
        ) : null}

        {topics.length > 0 ? (
          <div className={styles.filterGroup}>
            <p className={styles.filterLabel}>Tags</p>
            <div className="chips">
              {topics.map((topic) => (
                <Link
                  key={topic.tag}
                  className="chip"
                  href={buildHref({ q, tag: topic.tag, category })}
                  aria-current={
                    tag && topic.tag.toLowerCase() === tag.toLowerCase() ? 'page' : undefined
                  }
                >
                  {topic.tag} <span className="muted">{topic.count}</span>
                </Link>
              ))}
            </div>
          </div>
        ) : null}
      </section>

      {hasFilters && result ? (
        result.items.length > 0 ? (
          <section aria-label="Search results">
            <p className={styles.summary}>
              {pluralise(result.total, 'story', 'stories')} found
              {activeFilters ? ` for ${activeFilters}` : ''}
            </p>
            <div className="listing-grid">
              {result.items.map((article) => (
                <ArticleCard
                  key={article.id}
                  article={article}
                  variant="standard"
                  showDek
                  showMeta
                  timeZone={settings.site.timezone}
                />
              ))}
            </div>
            <Pagination
              page={page}
              total={result.total}
              limit={PAGE_SIZE}
              basePath="/search"
              query={{ q, tag, category }}
            />
          </section>
        ) : (
          <>
            <EmptyState
              title="Nothing in the morgue"
              message={`No story matches ${activeFilters || 'that search'}. Try fewer words, a different tag, or clear one of the filters.`}
            />
            <p className={`muted ${styles.emptyLinks}`}>
              <Link href="/latest">Browse the latest stories</Link> ·{' '}
              <Link href="/submit">Send the desk a tip</Link>
            </p>
          </>
        )
      ) : (
        <section className="section" aria-labelledby="recent-heading">
          <SectionHeading id="recent-heading" title="Recently filed" href="/latest" />
          {recent.length > 0 ? (
            <div className="listing-grid">
              {recent.map((article) => (
                <ArticleCard
                  key={article.id}
                  article={article}
                  variant="standard"
                  showDek
                  showMeta
                  timeZone={settings.site.timezone}
                />
              ))}
            </div>
          ) : (
            <p className="muted">The paper has not published anything yet.</p>
          )}
        </section>
      )}
    </div>
  );
}
