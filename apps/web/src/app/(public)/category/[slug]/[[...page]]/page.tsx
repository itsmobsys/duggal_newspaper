import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArticleCard } from '@/components/ArticleCard';
import { EmptyState } from '@/components/EmptyState';
import { Pagination } from '@/components/Pagination';
import { pluralise } from '@/lib/format';
import { pagePath, readPageSegments } from '@/lib/pagination';
import { getCategories, getCategory, listArticlesCached } from '@/lib/queries';
import { getPublicSettings } from '@/lib/settings';

export const revalidate = 60;

const PAGE_SIZE = 12;

interface CategoryPageProps {
  params: Promise<{ slug: string; page?: string[] }>;
}

export const dynamicParams = true;

/** Nothing to prerender; this only opts the segment into ISR on demand. */
export function generateStaticParams(): Array<{ page: string[] }> {
  return [];
}

export async function generateMetadata({ params }: CategoryPageProps): Promise<Metadata> {
  const { slug, page: pageSegments } = await params;
  const page = readPageSegments(pageSegments) ?? 1;
  const [category, settings] = await Promise.all([getCategory(slug), getPublicSettings()]);
  if (!category) return { title: 'Section not found', robots: { index: false, follow: false } };

  const description =
    category.description ?? `Every ${category.name} story printed in ${settings.site.name}.`;

  return {
    title: { absolute: `${category.name} — ${settings.site.name}` },
    description,
    alternates: { canonical: pagePath(`/category/${category.slug}`, page) },
    openGraph: {
      type: 'website',
      siteName: settings.site.name,
      title: `${category.name} — ${settings.site.name}`,
      description,
      url: pagePath(`/category/${category.slug}`, page),
    },
  };
}

export default async function CategoryPage({
  params,
}: CategoryPageProps): Promise<React.JSX.Element> {
  const { slug, page: pageSegments } = await params;
  const page = readPageSegments(pageSegments);
  if (page === null) notFound();

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
        hrefFor={(target) => pagePath(`/category/${category.slug}`, target)}
      />
    </div>
  );
}
