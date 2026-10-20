import type { MetadataRoute } from 'next';
import { defaultPublicSettings, getPublicSettings, siteUrl } from '@/lib/settings';

/**
 * Crawl policy for the public paper.
 *
 * The admin console, BFF and internal status/search pages are never useful in
 * an index. Everything else — articles, editions, categories — is fair game.
 * The canonical host comes from settings so preview deployments cannot leak
 * their own URL into a cached robots.txt.
 */

export const revalidate = 3600;

export default async function robots(): Promise<MetadataRoute.Robots> {
  let base = siteUrl(defaultPublicSettings());
  try {
    // Settings live in the database; if that is down the site still needs a
    // valid robots.txt rather than a 500. An empty canonical URL would make
    // the sitemap reference relative, so keep the documented default too.
    base = siteUrl(await getPublicSettings()) || base;
  } catch {
    // Keep the default base.
  }

  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: ['/admin', '/api', '/status', '/search'],
      },
    ],
    sitemap: `${base}/sitemap.xml`,
    host: base,
  };
}
