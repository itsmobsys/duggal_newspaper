import { NextResponse, type NextRequest } from 'next/server';
import { ApiError, apiFetch, clientIpFrom } from '@/lib/api';
import { requireCsrf, sameOrigin } from '@/lib/csrf';
import { getAdminSession } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * The only path from the admin UI to the newsroom API.
 *
 * Security properties:
 *  - no session cookie -> 401 before anything is proxied;
 *  - mutating methods require the CSRF double-submit token;
 *  - Origin is checked, so another site cannot drive the console;
 *  - only known admin resource prefixes are forwarded (no arbitrary proxy);
 *  - the session token never reaches client JavaScript.
 */

const ALLOWED_PREFIXES = new Set([
  'me',
  'stats',
  'submissions',
  'articles',
  'jobs',
  'worker',
  'settings',
  'categories',
  'awards',
  'reports',
  'corrections',
  'editions',
  'publish-now',
  'audit',
  'ai',
  'diagnostics',
  'storage',
]);

const METHODS = new Set(['GET', 'POST', 'PATCH', 'PUT', 'DELETE']);

type RouteContext = { params: Promise<{ path?: string[] }> };

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

async function proxy(request: NextRequest, context: RouteContext): Promise<NextResponse> {
  const method = request.method.toUpperCase();
  if (!METHODS.has(method)) return jsonError(405, 'METHOD_NOT_ALLOWED', 'Unsupported method.');

  const segments = (await context.params).path ?? [];
  const first = segments[0];
  if (!first || !ALLOWED_PREFIXES.has(first)) {
    return jsonError(404, 'NOT_FOUND', 'Unknown admin resource.');
  }

  const session = await getAdminSession();
  if (!session) {
    return jsonError(401, 'ADMIN_SESSION_REQUIRED', 'Sign in to continue.');
  }

  if (!sameOrigin(request)) {
    return jsonError(403, 'ORIGIN_REJECTED', 'Cross-site request rejected.');
  }

  if (method !== 'GET' && !(await requireCsrf(request))) {
    return jsonError(
      403,
      'CSRF_INVALID',
      'Your session token expired. Reload the page and try again.',
    );
  }

  const path = `/admin/${segments.map((segment) => encodeURIComponent(segment)).join('/')}`;
  const search = rawSearch(request.url);
  const rawBody = method === 'GET' ? '' : await request.text().catch(() => '');

  try {
    const result = await apiFetch<unknown>(`${path}${search}`, {
      method: method as 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
      rawBody: rawBody || undefined,
      adminSession: session,
      clientIp: clientIpFrom(request),
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
  return proxy(request, context);
}

export async function POST(request: NextRequest, context: RouteContext): Promise<NextResponse> {
  return proxy(request, context);
}

export async function PATCH(request: NextRequest, context: RouteContext): Promise<NextResponse> {
  return proxy(request, context);
}

export async function PUT(request: NextRequest, context: RouteContext): Promise<NextResponse> {
  return proxy(request, context);
}

export async function DELETE(request: NextRequest, context: RouteContext): Promise<NextResponse> {
  return proxy(request, context);
}
