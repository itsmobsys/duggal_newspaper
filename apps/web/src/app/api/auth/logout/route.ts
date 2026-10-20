import { NextResponse } from 'next/server';
import { apiFetch } from '@/lib/api';
import { clearUserSession, getUserSessionToken } from '@/lib/user';

export const dynamic = 'force-dynamic';

/**
 * Revokes the server-side session first, then drops the cookie. A failed revoke
 * still clears the browser cookie so the reader is never stuck logged in.
 */
export async function POST(): Promise<NextResponse> {
  const token = await getUserSessionToken();
  if (token) {
    try {
      await apiFetch('/public/auth/logout', {
        method: 'POST',
        headers: { 'x-user-session': token },
        timeoutMs: 5000,
        cache: 'no-store',
      });
    } catch {
      // Already expired or API unreachable — clearing the cookie is enough.
    }
  }
  await clearUserSession();
  return NextResponse.json({ ok: true });
}
