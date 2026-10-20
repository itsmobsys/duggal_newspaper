import { NextResponse } from 'next/server';
import { apiFetch } from '@/lib/api';
import { clearAdminSession, getAdminSession } from '@/lib/session';
import { sameOrigin } from '@/lib/csrf';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Revoke the API session (best effort) and always drop the local cookie. */
export async function POST(request: Request): Promise<NextResponse> {
  if (!sameOrigin(request)) {
    return NextResponse.json(
      { error: { code: 'ORIGIN_REJECTED', message: 'Cross-site request rejected.' } },
      { status: 403 },
    );
  }

  const session = await getAdminSession();
  if (session) {
    try {
      await apiFetch('/admin/auth/logout', { method: 'POST', adminSession: session });
    } catch {
      // The local cookie still has to go even if Render is asleep.
    }
  }
  await clearAdminSession();
  return NextResponse.json({ ok: true });
}
