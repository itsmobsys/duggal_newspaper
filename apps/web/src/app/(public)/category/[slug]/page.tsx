import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArticleCard } from '@/components/ArticleCard';
import { EmptyState } from '@/components/EmptyState';
import { Pagination } from '@/components/Pagination';
import { pluralise } from '@/lib/format';
import { getCategories, getCategory, listArticlesCached } from '@/lib/queries';
import { getPublicSettings } from '@/lib/settings';

export const revalidate = 60;

const PAGE_SIZE = 12;

interface CategoryPageProps {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ page?: string | string[] }>;
}

function parsePage(value: string | string[] | undefined): number {
  const raw = Array.isArray(value) ? value[0] : value;
  const parsed = Number.parseInt(raw ?? '1', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

export async function generateMetadata({ params }: CategoryPageProps): Promise<Metadata> {
  const { slug } = await params;
  const [category, settings] = await Promise.all([getCategory(slug), getPublicSettings()]);
  if (!category) return { title: 'Section not found', robots: { index: false, follow: false } };

  const description =
    category.description ?? `Every ${category.name} story printed in ${settings.site.name}.`;

  return {
    title: { absolute: `${category.name} — ${settings.site.name}` },
    description,
    alternates: { canonical: `/category/${category.slug}` },
    openGraph: {
      type: 'website',
      siteName: settings.site.name,
      title: `${category.name} — ${settings.site.name}`,
      description,
      url: `/category/${category.slug}`,
    },
  };
}

export default async function CategoryPage({
  params,
  searchParams,
}: CategoryPageProps): Promise<React.JSX.Element> {
  const { slug } = await params;
  const query = await searchParams;
  const page = parsePage(query.page);

  const [category, categories, result, settings] = await Promise.all([
    getCategory(slug),
    getCategories(),
    listArticlesCached({ category: slug, limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE }),
    getPublicSettings(),
  ]);

  if (!category) notFound();

  const timeZone = settings.site.timezone;
  const description =
    category.description ?? `Every ${category.name} story printed in ${settings.site.name}.`;

  return (
    <div className="container">
      <header className="page-head">
        <div className="accent-bar" aria-hidden="true" />
        <p className="eyebrow">Section</p>
        <h1>{category.name}</h1>
        <p className="lede">{description}</p>
        <p className="muted">
          {pluralise(category.publishedCount, 'published story', 'published stories')}
        </p>
      </header>

      <nav className="chips" aria-label="All sections">
        {categories.map((item) => (
          <Link
            key={item.slug}
            className="chip"
            href={`/category/${item.slug}`}
            aria-current={item.slug === category.slug ? 'page' : undefined}
          >
            {item.name}
          </Link>
        ))}
      </nav>

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
          title={`Nothing in ${category.name} yet`}
          message="The section is live but empty. If you have a story that belongs here, the desk is listening."
          actionHref="/submit"
          actionLabel="Submit a story"
        />
      )}

      <Pagination
        page={page}
        total={result.total}
        limit={PAGE_SIZE}
        basePath={`/category/${category.slug}`}
      />
    </div>
  );
}
