import { NextResponse, type NextRequest } from 'next/server';
import { ApiError, apiFetch, clientIpFrom } from '@/lib/api';
import { sameOrigin } from '@/lib/csrf';
import { getUserSessionToken } from '@/lib/user';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Reader community writes (votes and reviews).
 *
 * The browser only talks to this BFF. The service signature is added
 * server-side and the reader session token stays in an httpOnly cookie, so the
 * Render API cannot be driven directly and the browser never holds identity.
 */

type RouteContext = { params: Promise<{ path?: string[] }> };

interface AllowRule {
  method: 'GET' | 'POST' | 'DELETE';
  test: (segments: string[]) => boolean;
}

const RULES: AllowRule[] = [
  { method: 'GET', test: (s) => s.length === 2 && s[0] === 'votes' },
  { method: 'POST', test: (s) => s.length === 1 && s[0] === 'votes' },
  { method: 'GET', test: (s) => s.length === 1 && s[0] === 'reviews' },
  { method: 'POST', test: (s) => s.length === 1 && s[0] === 'reviews' },
  { method: 'DELETE', test: (s) => s.length === 2 && s[0] === 'reviews' },
];

function jsonError(status: number, code: string, message: string): NextResponse {
  return NextResponse.json(
    { error: { code, message } },
    { status, headers: { 'cache-control': 'no-store' } },
  );
}

function rawSearch(url: string): string {
  const index = url.indexOf('?');
  return index === -1 ? '' : url.slice(index);
}

async function proxy(
  request: NextRequest,
  context: RouteContext,
  method: 'GET' | 'POST' | 'DELETE',
): Promise<NextResponse> {
  const segments = (await context.params).path ?? [];
  const allowed = RULES.some((rule) => rule.method === method && rule.test(segments));
  if (!allowed) return jsonError(404, 'NOT_FOUND', 'Unknown endpoint.');

  if (method !== 'GET' && !sameOrigin(request)) {
    return jsonError(403, 'ORIGIN_REJECTED', 'Cross-site request rejected.');
  }

  const path = `/public/${segments.map((segment) => encodeURIComponent(segment)).join('/')}`;
  const rawBody = method === 'GET' ? '' : await request.text().catch(() => '');

  if (method !== 'GET' && !rawBody.trim()) {
    return jsonError(400, 'INVALID_JSON', 'Request body is required.');
  }

  try {
    const sessionToken = await getUserSessionToken();
    const result = await apiFetch<unknown>(`${path}${rawSearch(request.url)}`, {
      method,
      rawBody: rawBody || undefined,
      clientIp: clientIpFrom(request),
      ...(sessionToken ? { headers: { 'x-user-session': sessionToken } } : {}),
    });
    if (result === null || result === undefined) {
      return new NextResponse(null, { status: 204, headers: { 'cache-control': 'no-store' } });
    }
    return NextResponse.json(result, { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    if (error instanceof ApiError) {
      return NextResponse.json(
        {
          error: {
            code: error.code,
            message: error.message,
            ...(error.details === undefined ? {} : { details: error.details }),
            ...(error.issues === undefined ? {} : { issues: error.issues }),
          },
        },
        { status: error.status, headers: { 'cache-control': 'no-store' } },
      );
    }
    return jsonError(502, 'BAD_GATEWAY', 'The newsroom API did not answer. Try again shortly.');
  }
}

export async function GET(request: NextRequest, context: RouteContext): Promise<NextResponse> {
  return proxy(request, context, 'GET');
}

export async function POST(request: NextRequest, context: RouteContext): Promise<NextResponse> {
  return proxy(request, context, 'POST');
}

export async function DELETE(request: NextRequest, context: RouteContext): Promise<NextResponse> {
  return proxy(request, context, 'DELETE');
}
