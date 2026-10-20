import { NextResponse } from 'next/server';
import { COOKIE_OAUTH_STATE } from '@/lib/constants';
import {
  authorizeUrl,
  createHandshake,
  oauthConfigured,
  safeNextPath,
  stateCookieOptions,
} from '@/lib/discord';

export const dynamic = 'force-dynamic';

/**
 * Starts the Discord OAuth2 handshake. A random `state` plus a PKCE verifier are
 * stashed in an httpOnly cookie; the callback refuses any handshake it did not
 * start itself.
 */
export function GET(request: Request): NextResponse {
  const url = new URL(request.url);
  const next = safeNextPath(url.searchParams.get('next'));

  if (!oauthConfigured()) {
    return NextResponse.redirect(new URL('/submit?login=unconfigured', url.origin), 303);
  }

  const { handshake, cookie } = createHandshake(next);
  const response = NextResponse.redirect(authorizeUrl(url.origin, handshake), 303);
  response.cookies.set(COOKIE_OAUTH_STATE, cookie, stateCookieOptions());
  return response;
}
