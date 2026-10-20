import { cookies } from 'next/headers';
import { ADMIN_SESSION_MAX_AGE_SECONDS, COOKIE_ADMIN_SESSION } from './constants';

/**
 * The admin session token lives in an httpOnly cookie and is never exposed to
 * client JavaScript. The BFF forwards it to the API, which validates the hashed
 * token itself — the cookie is a carrier, not the source of truth.
 */

export async function getAdminSession(): Promise<string | null> {
  const store = await cookies();
  return store.get(COOKIE_ADMIN_SESSION)?.value || null;
}

export async function setAdminSession(token: string, maxAgeSeconds: number): Promise<void> {
  const store = await cookies();
  store.set(COOKIE_ADMIN_SESSION, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: Math.max(60, Math.min(maxAgeSeconds, ADMIN_SESSION_MAX_AGE_SECONDS)),
  });
}

export async function clearAdminSession(): Promise<void> {
  const store = await cookies();
  store.set(COOKIE_ADMIN_SESSION, '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  });
}

/** True when the browser presents an admin cookie. The API still re-checks it. */
export async function hasAdminCookie(): Promise<boolean> {
  return (await getAdminSession()) !== null;
}
