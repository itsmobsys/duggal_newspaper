import type { MetadataRoute } from 'next';
import { getSitemapData } from '@/lib/queries';
import { defaultPublicSettings, getPublicSettings, siteUrl } from '@/lib/settings';

/**
 * One sitemap, no pagination.
 *
 * `getSitemapData` already caps the heavy lists (5,000 articles / 400
 * editions), so the result stays well inside the 50,000-URL protocol limit.
 * Search, status, admin, API, report and correction pages are deliberately
 * absent: they are either private or carry `noindex`.
 */

export const revalidate = 3600;

/** Hard ceiling in case the data layer ever starts returning more. */
const MAX_ARTICLES = 5000;

type ChangeFrequency = NonNullable<MetadataRoute.Sitemap[number]['changeFrequency']>;

interface StaticRoute {
  path: string;
  changeFrequency: ChangeFrequency;
  priority: number;
}

const STATIC_ROUTES: readonly StaticRoute[] = [
  { path: '', changeFrequency: 'daily', priority: 1 },
  { path: '/latest', changeFrequency: 'hourly', priority: 0.9 },
  { path: '/editions', changeFrequency: 'daily', priority: 0.6 },
  { path: '/archive', changeFrequency: 'weekly', priority: 0.5 },
  { path: '/awards', changeFrequency: 'weekly', priority: 0.5 },
  { path: '/photos', changeFrequency: 'weekly', priority: 0.4 },
  { path: '/about', changeFrequency: 'monthly', priority: 0.4 },
  { path: '/standards', changeFrequency: 'monthly', priority: 0.3 },
  { path: '/submit', changeFrequency: 'monthly', priority: 0.4 },
];

function toDate(value: string | null | undefined, fallback: Date): Date {
  if (!value) return fallback;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? fallback : date;
}

function segment(value: string): string {
  return encodeURIComponent(value);
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [settings, data] = await Promise.all([
    getPublicSettings().catch(() => defaultPublicSettings()),
    getSitemapData().catch(() => ({ articles: [], categories: [], editions: [] })),
  ]);

  // Settings can technically hold an empty URL; a relative sitemap entry is
  // invalid, so fall back to the documented default host instead.
  const base = siteUrl(settings) || siteUrl(defaultPublicSettings());
  const now = new Date();
  const absolute = (path: string): string => `${base}${path}`;

  const entries: MetadataRoute.Sitemap = STATIC_ROUTES.map((route) => ({
    url: absolute(route.path),
    lastModified: now,
    changeFrequency: route.changeFrequency,
    priority: route.priority,
  }));

  for (const category of data.categories) {
    entries.push({
      url: absolute(`/category/${segment(category.slug)}`),
      lastModified: now,
      changeFrequency: 'daily',
      priority: 0.6,
    });
  }

  for (const article of data.articles.slice(0, MAX_ARTICLES)) {
    entries.push({
      url: absolute(`/article/${segment(article.slug)}`),
      lastModified: toDate(article.publishedAt, now),
      changeFrequency: 'weekly',
      priority: 0.7,
    });
  }

  for (const edition of data.editions) {
    entries.push({
      url: absolute(`/edition/${segment(edition.editionDate)}`),
      lastModified: toDate(edition.updatedAt, now),
      changeFrequency: 'weekly',
      priority: 0.6,
    });
  }

  return entries;
}
