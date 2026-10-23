import { timingSafeEqual } from 'node:crypto';
import { revalidatePath, revalidateTag } from 'next/cache';
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Called by the Render API after publishing, building an edition or writing
 * awards. Signed with REVALIDATE_SECRET and constrained to real site paths so
 * a leaked secret cannot be used to hammer arbitrary routes.
 */

const ALLOWED_EXACT = new Set([
  '/',
  '/latest',
  '/archive',
  '/editions',
  '/awards',
  '/photos',
  '/search',
  '/about',
  '/standards',
  '/rss.xml',
]);

const ALLOWED_PATTERNS = [
  /^\/article\/[a-z0-9-]{1,200}$/i,
  /^\/category\/[a-z0-9-]{1,80}$/i,
  /^\/edition\/\d{4}-\d{2}-\d{2}$/,
];

/**
 * Tags on the cross-request read cache in lib/queries.ts and lib/settings.ts.
 * Every publish, edit, delete or settings change hits this route, so clearing
 * all of them keeps the dynamic listing pages as fresh as the ISR ones.
 */
const DATA_TAGS = ['articles', 'editions', 'photos', 'categories', 'settings'];

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length || left.length === 0) return false;
  return timingSafeEqual(left, right);
}

function isAllowedPath(path: string): boolean {
  if (ALLOWED_EXACT.has(path)) return true;
  return ALLOWED_PATTERNS.some((pattern) => pattern.test(path));
}

export async function POST(request: Request): Promise<NextResponse> {
  const secret = process.env.REVALIDATE_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: { code: 'NOT_CONFIGURED', message: 'Revalidation is not configured.' } },
      { status: 503 },
    );
  }

  const provided = request.headers.get('x-revalidate-secret') ?? '';
  if (!safeEqual(provided, secret)) {
    return NextResponse.json(
      { error: { code: 'UNAUTHORIZED', message: 'Invalid revalidation secret.' } },
      { status: 401 },
    );
  }

  const body: unknown = await request.json().catch(() => null);

  // A layout-scoped purge clears every page that shares the (public) layout —
  // used by the takedown switch, which must apply to the whole site at once.
  const layout =
    body !== null && typeof body === 'object' && (body as { layout?: unknown }).layout === true;
  if (layout) {
    revalidatePath('/', 'layout');
    for (const tag of DATA_TAGS) revalidateTag(tag);
    return NextResponse.json({ revalidated: ['/'], scope: 'layout', count: 1 });
  }

  const rawPaths =
    body && typeof body === 'object' && Array.isArray((body as { paths?: unknown }).paths)
      ? (body as { paths: unknown[] }).paths
      : [];

  const paths = [...new Set(rawPaths.filter((path): path is string => typeof path === 'string'))]
    .filter(isAllowedPath)
    .slice(0, 40);

  if (paths.length === 0) {
    return NextResponse.json(
      { error: { code: 'NO_VALID_PATHS', message: 'No revalidatable paths were provided.' } },
      { status: 400 },
    );
  }

  for (const path of paths) revalidatePath(path);
  for (const tag of DATA_TAGS) revalidateTag(tag);

  return NextResponse.json({ revalidated: paths, count: paths.length });
}
