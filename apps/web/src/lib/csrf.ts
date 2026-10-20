import { timingSafeEqual } from 'node:crypto';
import { cookies } from 'next/headers';
import { COOKIE_CSRF, CSRF_HEADER } from './constants';

/**
 * CSRF for the admin console uses the double-submit pattern:
 * a readable cookie plus an `x-csrf-token` header on every mutating request.
 * The cookie is issued by middleware, so the client never has to bootstrap it.
 */

export function safeTokenEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length || left.length === 0) return false;
  return timingSafeEqual(left, right);
}

export async function getCsrfToken(): Promise<string | null> {
  const store = await cookies();
  return store.get(COOKIE_CSRF)?.value || null;
}

/** True when the request carries the CSRF header matching the cookie. */
export function csrfMatches(request: Request, cookieToken: string | null): boolean {
  const headerToken = request.headers.get(CSRF_HEADER);
  if (!headerToken || !cookieToken) return false;
  return safeTokenEqual(headerToken, cookieToken);
}

/**
 * Enforce CSRF for mutating admin requests. GET/HEAD are exempt because they
 * must not change state (the API enforces that too).
 */
export async function requireCsrf(request: Request): Promise<boolean> {
  const method = request.method.toUpperCase();
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return true;
  return csrfMatches(request, await getCsrfToken());
}

/** Reject cross-site browser requests even if a token somehow leaked. */
export function sameOrigin(request: Request): boolean {
  const origin = request.headers.get('origin');
  if (!origin) return true; // non-browser client (curl, server) — CSRF is not applicable
  try {
    const expected = new URL(request.url);
    const actual = new URL(origin);
    return actual.host === expected.host;
  } catch {
    return false;
  }
}
