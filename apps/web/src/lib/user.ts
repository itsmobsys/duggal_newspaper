import { cookies } from 'next/headers';
import { apiFetch } from './api';
import { COOKIE_USER_SESSION, USER_SESSION_MAX_AGE_SECONDS } from './constants';

/**
 * Reader identity comes from Discord, but the browser only ever holds an opaque
 * session token. The API owns the token → member mapping; nothing the browser
 * sends is treated as identity.
 */

export interface SessionUser {
  memberId: string;
  discordId: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
}

export async function getUserSessionToken(): Promise<string | null> {
  const store = await cookies();
  return store.get(COOKIE_USER_SESSION)?.value || null;
}

export async function setUserSession(token: string, expiresAt?: string | null): Promise<void> {
  const store = await cookies();
  const remaining = expiresAt ? Math.floor((Date.parse(expiresAt) - Date.now()) / 1000) : NaN;
  const maxAge = Number.isFinite(remaining)
    ? Math.max(60, Math.min(remaining, USER_SESSION_MAX_AGE_SECONDS))
    : USER_SESSION_MAX_AGE_SECONDS;
  store.set(COOKIE_USER_SESSION, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge,
  });
}

export async function clearUserSession(): Promise<void> {
  const store = await cookies();
  store.set(COOKIE_USER_SESSION, '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  });
}

/** Resolve the signed-in reader. A stale or revoked token simply means logged out. */
export async function getCurrentUser(): Promise<SessionUser | null> {
  const token = await getUserSessionToken();
  if (!token) return null;
  try {
    const data = await apiFetch<{ user: SessionUser | null }>('/public/auth/me', {
      headers: { 'x-user-session': token },
      timeoutMs: 5000,
      cache: 'no-store',
    });
    return data.user ?? null;
  } catch {
    return null;
  }
}
