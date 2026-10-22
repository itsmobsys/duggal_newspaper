import type { Metadata } from 'next';
import Link from 'next/link';
import { ArticleCard } from '@/components/ArticleCard';
import { EmptyState } from '@/components/EmptyState';
import { Pagination } from '@/components/Pagination';
import { getCategories, listArticlesCached } from '@/lib/queries';
import { notFound } from 'next/navigation';
import { pagePath, readPageSegments } from '@/lib/pagination';
import { getPublicSettings } from '@/lib/settings';

export const revalidate = 60;

const PAGE_SIZE = 15;

interface LatestPageProps {
  params: Promise<{ page?: string[] }>;
}

export const dynamicParams = true;

/** Nothing to prerender; this only opts the segment into ISR on demand. */
export function generateStaticParams(): Array<{ page: string[] }> {
  return [];
}

export async function generateMetadata({ params }: LatestPageProps): Promise<Metadata> {
  const { page: pageSegments } = await params;
  const page = readPageSegments(pageSegments) ?? 1;
  const settings = await getPublicSettings();
  const description = `Every story printed in ${settings.site.name}, newest first.`;

  return {
    title: 'Latest',
    description,
    alternates: { canonical: pagePath('/latest', page) },
    openGraph: {
      type: 'website',
      siteName: settings.site.name,
      title: `Latest — ${settings.site.name}`,
      description,
      url: pagePath('/latest', page),
    },
  };
}

export default async function LatestPage({ params }: LatestPageProps): Promise<React.JSX.Element> {
  const { page: pageSegments } = await params;
  const page = readPageSegments(pageSegments);
  if (page === null) notFound();

  const [settings, categories, result] = await Promise.all([
    getPublicSettings(),
    getCategories(),
    listArticlesCached({ limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE }),
  ]);

  const timeZone = settings.site.timezone;

  return (
    <div className="container">
      <header className="page-head">
        <div className="accent-bar" aria-hidden="true" />
        <p className="eyebrow">The paper</p>
        <h1>Latest</h1>
        <p className="lede">
          Everything that has cleared the robot, newest first. No algorithm, no infinite scroll, no
          mercy.
        </p>
      </header>

      {result.items.length > 0 ? (
        <div className="listing-grid">
          {result.items.map((article) => (
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
          title="No stories yet"
          message="The paper has not published anything. The first edition is one good tip away."
          actionHref="/submit"
          actionLabel="Submit a story"
        />
      )}

      <Pagination
        page={page}
        total={result.total}
        limit={PAGE_SIZE}
        basePath="/latest"
        hrefFor={(target) => pagePath('/latest', target)}
      />

      {categories.length > 0 ? (
        <nav className="chips" aria-label="Browse sections" style={{ marginTop: 'var(--space-5)' }}>
          {categories.map((category) => (
            <Link key={category.slug} className="chip" href={`/category/${category.slug}`}>
              {category.name}
            </Link>
          ))}
        </nav>
      ) : null}
    </div>
  );
}
