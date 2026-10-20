import { NextResponse, type NextRequest } from 'next/server';
import { COOKIE_ADMIN_SESSION, COOKIE_CSRF } from '@/lib/constants';

/**
 * Cheap edge gate for the admin console:
 *  - anonymous visitors are bounced to /admin/login before any admin markup renders;
 *  - every admin request gets a CSRF cookie (double-submit pattern).
 *
 * This is not the real authorisation boundary. The Render API validates the
 * admin session on every call, so a forged cookie buys nothing but a login page.
 */
export function middleware(request: NextRequest): NextResponse {
  const { pathname } = request.nextUrl;
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
  matcher: ['/admin/:path*', '/api/admin/:path*'],
};
