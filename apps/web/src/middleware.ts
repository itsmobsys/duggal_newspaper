import { NextResponse, type NextRequest } from 'next/server';
import { COOKIE_ADMIN_SESSION, COOKIE_CSRF } from '@/lib/constants';
import { archivePath } from '@/lib/pagination';

/** Public listings whose page lives in the path, not in `?page=`. */
const PAGED_LISTINGS = new Set(['/latest', '/editions', '/photos']);

function isPagedListing(pathname: string): boolean {
  return PAGED_LISTINGS.has(pathname) || /^\/category\/[a-z0-9-]+$/i.test(pathname);
}

/**
 * Cheap edge gate for the admin console:
 *  - anonymous visitors are bounced to /admin/login before any admin markup renders;
 *  - every admin request gets a CSRF cookie (double-submit pattern).
 *
 * It also redirects the old `?page=` listing URLs to their cacheable path form.
 * This is not the real authorisation boundary: the Render API validates the admin
 * session on every call, so a forged cookie buys nothing but a login page.
 */
export function middleware(request: NextRequest): NextResponse {
  const { pathname, searchParams } = request.nextUrl;

  if (pathname === '/archive') {
    const legacyPage = searchParams.get('page');
    const rawMonth = searchParams.get('month');
    const month = rawMonth && /^\\d{4}-(0[1-9]|1[0-2])$/.test(rawMonth) ? rawMonth : null;
    const parsedPage = legacyPage ? Number.parseInt(legacyPage, 10) : 1;
    if (month || (Number.isInteger(parsedPage) && parsedPage > 1)) {
      const url = request.nextUrl.clone();
      url.pathname = archivePath(month, parsedPage > 1 ? parsedPage : 1);
      url.search = '';
      return NextResponse.redirect(url, 308);
    }
  }

  const legacyPage = searchParams.get('page');
  if (legacyPage && isPagedListing(pathname)) {
    const page = Number.parseInt(legacyPage, 10);
    if (Number.isInteger(page) && page > 1) {
      const url = request.nextUrl.clone();
      url.pathname = `${pathname}/page/${page}`;
      url.searchParams.delete('page');
      return NextResponse.redirect(url, 308);
    }
  }

  if (!pathname.startsWith('/admin') && !pathname.startsWith('/api/admin')) {
    return NextResponse.next();
  }

  const hasSession = Boolean(request.cookies.get(COOKIE_ADMIN_SESSION)?.value);

  if (pathname.startsWith('/admin') && pathname !== '/admin/login' && !hasSession) {
    const url = request.nextUrl.clone();
    url.pathname = '/admin/login';
    url.search = '';
    url.searchParams.set('next', pathname);
    return NextResponse.redirect(url);
  }

  const response = NextResponse.next();
  if (!request.cookies.get(COOKIE_CSRF)?.value) {
    response.cookies.set(COOKIE_CSRF, crypto.randomUUID(), {
      httpOnly: false,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60 * 12,
    });
  }
  return response;
}

export const config = {
  matcher: [
    '/admin/:path*',
    '/api/admin/:path*',
    '/latest',
    '/editions',
    '/photos',
    '/category/:slug',
    '/archive',
  ],
};
