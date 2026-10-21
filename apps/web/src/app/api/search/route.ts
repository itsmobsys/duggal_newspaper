import { NextResponse } from 'next/server';
import { searchArticles } from '@/lib/queries';
import { clampSearchLimit, isSearchable, normaliseSearchQuery } from '@/lib/search';

export const dynamic = 'force-dynamic';

/**
 * One JSON round-trip per distinct query. The CDN caches it briefly, so two
 * readers typing the same thing only hit Turso once.
 */
const HEADERS = {
  'cache-control': 'public, max-age=0, s-maxage=30, stale-while-revalidate=120',
  'x-robots-tag': 'noindex',
} as const;

export async function GET(request: Request): Promise<NextResponse> {
  const url = new URL(request.url);
  const query = normaliseSearchQuery(url.searchParams.get('q'));

  if (!isSearchable(query)) {
    return NextResponse.json({ query, results: [], hasMore: false }, { headers: HEADERS });
  }

  const limit = clampSearchLimit(url.searchParams.get('limit'));
  const { hits, hasMore } = await searchArticles(query, limit);

  return NextResponse.json({ query, results: hits, hasMore }, { headers: HEADERS });
}
