import type { Metadata } from 'next';
import Link from 'next/link';
import { ArticleCard } from '@/components/ArticleCard';
import { EmptyState } from '@/components/EmptyState';
import { Pagination } from '@/components/Pagination';
import { getCategories, listArticles } from '@/lib/queries';
import { getPublicSettings } from '@/lib/settings';

export const revalidate = 60;

const PAGE_SIZE = 15;

interface LatestPageProps {
  searchParams: Promise<{ page?: string | string[] }>;
}

function parsePage(value: string | string[] | undefined): number {
  const raw = Array.isArray(value) ? value[0] : value;
  const parsed = Number.parseInt(raw ?? '1', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

export async function generateMetadata(): Promise<Metadata> {
  const settings = await getPublicSettings();
  const description = `Every story printed in ${settings.site.name}, newest first.`;

  return {
    title: 'Latest',
    description,
    alternates: { canonical: '/latest' },
    openGraph: {
      type: 'website',
      siteName: settings.site.name,
      title: `Latest — ${settings.site.name}`,
      description,
      url: '/latest',
    },
  };
}

export default async function LatestPage({
  searchParams,
}: LatestPageProps): Promise<React.JSX.Element> {
  const query = await searchParams;
  const page = parsePage(query.page);

  const [settings, categories, result] = await Promise.all([
    getPublicSettings(),
    getCategories(),
    listArticles({ limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE }),
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

      <Pagination page={page} total={result.total} limit={PAGE_SIZE} basePath="/latest" />

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
