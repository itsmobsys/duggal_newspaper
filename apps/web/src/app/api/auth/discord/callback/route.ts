import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { apiFetch, clientIpFrom } from '@/lib/api';
import {
  COOKIE_OAUTH_STATE,
  COOKIE_USER_SESSION,
  USER_SESSION_MAX_AGE_SECONDS,
} from '@/lib/constants';
import {
  decodeHandshake,
  exchangeCode,
  fetchDiscordIdentity,
  oauthConfigured,
  stateCookieOptions,
  stateMatches,
} from '@/lib/discord';
import type { SessionUser } from '@/lib/user';

export const dynamic = 'force-dynamic';

interface MintResponse {
  token: string;
  expiresAt: string;
  user: SessionUser;
}

function fail(origin: string, reason: string): NextResponse {
  const response = NextResponse.redirect(new URL(`/submit?login=${reason}`, origin), 303);
  response.cookies.set(COOKIE_OAUTH_STATE, '', { ...stateCookieOptions(), maxAge: 0 });
  return response;
}

/**
 * Completes the handshake: verifies state, swaps the code for a token, reads the
 * profile straight from Discord, then asks the API to mint our own opaque
 * session. The browser never supplies an identity.
 */
export async function GET(request: Request): Promise<NextResponse> {
  const url = new URL(request.url);
  const origin = url.origin;

  if (!oauthConfigured()) return fail(origin, 'unconfigured');
  if (url.searchParams.get('error')) return fail(origin, 'cancelled');

  const store = await cookies();
  const handshake = decodeHandshake(store.get(COOKIE_OAUTH_STATE)?.value);

  if (!handshake) return fail(origin, 'expired');
  if (!stateMatches(handshake.state, url.searchParams.get('state'))) return fail(origin, 'state');

  const code = (url.searchParams.get('code') ?? '').trim();
  if (!code) return fail(origin, 'cancelled');

  const accessToken = await exchangeCode(code, handshake.verifier, origin);
  if (!accessToken) return fail(origin, 'exchange');

  const identity = await fetchDiscordIdentity(accessToken);
  if (!identity) return fail(origin, 'profile');

  let minted: MintResponse;
  try {
    minted = await apiFetch<MintResponse>('/public/auth/session', {
      method: 'POST',
      body: identity,
      clientIp: clientIpFrom(request),
      timeoutMs: 10_000,
      cache: 'no-store',
    });
  } catch {
    return fail(origin, 'unavailable');
  }

  const remaining = Math.floor((Date.parse(minted.expiresAt) - Date.now()) / 1000);
  const maxAge = Number.isFinite(remaining)
    ? Math.max(60, Math.min(remaining, USER_SESSION_MAX_AGE_SECONDS))
    : USER_SESSION_MAX_AGE_SECONDS;

  const response = NextResponse.redirect(new URL(handshake.next, origin), 303);
  response.cookies.set(COOKIE_USER_SESSION, minted.token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge,
  });
  response.cookies.set(COOKIE_OAUTH_STATE, '', { ...stateCookieOptions(), maxAge: 0 });
  return response;
}
