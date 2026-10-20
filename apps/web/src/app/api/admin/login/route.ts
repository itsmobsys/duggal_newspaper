import { NextResponse } from 'next/server';
import { apiFetch, clientIpFrom } from '@/lib/api';
import { setAdminSession } from '@/lib/session';
import { sameOrigin } from '@/lib/csrf';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface LoginResponse {
  token: string;
  expiresAt: string;
  user: { id: string; email: string; name: string; role: string };
}

/**
 * Login is the only admin route that does not require a session or a CSRF
 * token. It still checks Origin so a third-party page cannot quietly sign a
 * victim into an attacker-controlled newsroom account.
 */
export async function POST(request: Request): Promise<NextResponse> {
  if (!sameOrigin(request)) {
    return NextResponse.json(
      { error: { code: 'ORIGIN_REJECTED', message: 'Cross-site login attempt rejected.' } },
      { status: 403 },
    );
  }

  const body: unknown = await request.json().catch(() => null);
  if (
    typeof body !== 'object' ||
    body === null ||
    typeof (body as { email?: unknown }).email !== 'string' ||
    typeof (body as { password?: unknown }).password !== 'string'
  ) {
    return NextResponse.json(
      { error: { code: 'VALIDATION_ERROR', message: 'Email and password are required.' } },
      { status: 400 },
    );
  }

  const email = (body as { email: string }).email.trim().slice(0, 200);
  const password = (body as { password: string }).password.slice(0, 400);

  try {
    const result = await apiFetch<LoginResponse>('/admin/auth/login', {
      method: 'POST',
      body: { email, password },
      clientIp: clientIpFrom(request),
    });

    const expiresAtMs = new Date(result.expiresAt).getTime();
    const maxAge = Number.isFinite(expiresAtMs)
      ? Math.max(60, Math.floor((expiresAtMs - Date.now()) / 1000))
      : 60 * 60 * 12;

    await setAdminSession(result.token, maxAge);
    return NextResponse.json({ user: result.user, expiresAt: result.expiresAt });
  } catch (error) {
    const status =
      typeof (error as { status?: unknown }).status === 'number'
        ? (error as { status: number }).status
        : 502;
    const code =
      typeof (error as { code?: unknown }).code === 'string'
        ? (error as { code: string }).code
        : 'LOGIN_FAILED';
    const message =
      error instanceof Error
        ? error.message
        : 'Could not reach the newsroom API. Try again shortly.';
    return NextResponse.json({ error: { code, message } }, { status });
  }
}
