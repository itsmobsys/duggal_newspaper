import { NextResponse, type NextRequest } from 'next/server';
import { ApiError, apiFetch, clientIpFrom } from '@/lib/api';
import { newVoterToken, readVoterToken, setVoterCookie } from '@/lib/community';
import { requireCsrf, sameOrigin } from '@/lib/csrf';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * BFF for reader votes and reviews.
 *
 * - only the five community endpoints the browser needs are reachable;
 * - the httpOnly voter cookie never reaches client JavaScript;
 * - mutations require the same CSRF + same-origin checks as the admin console;
 * - the API stores only a hash of the voter token.
 */

type CommunityMethod = 'GET' | 'POST' | 'DELETE';
type RouteContext = { params: Promise<{ path?: string[] }> };

interface AllowRule {
  method: CommunityMethod;
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

function errorResponse(error: unknown): NextResponse {
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

async function proxy(
  request: NextRequest,
  context: RouteContext,
  method: CommunityMethod,
): Promise<NextResponse> {
  const segments = (await context.params).path ?? [];
  const allowed = RULES.some((rule) => rule.method === method && rule.test(segments));
  if (!allowed) return jsonError(404, 'NOT_FOUND', 'Unknown endpoint.');

  if (!sameOrigin(request)) {
    return jsonError(403, 'ORIGIN_REJECTED', 'Cross-site request rejected.');
  }
  if (method !== 'GET' && !(await requireCsrf(request))) {
    return jsonError(403, 'CSRF_INVALID', 'Reload the page and try again.');
  }

  const existing = readVoterToken(request);
  const voterToken = existing ?? newVoterToken();
  const path = `/public/${segments.map((segment) => encodeURIComponent(segment)).join('/')}`;
  const rawBody = method === 'GET' ? '' : await request.text().catch(() => '');

  if (method === 'POST' && !rawBody.trim()) {
    return jsonError(400, 'INVALID_JSON', 'Request body is required.');
  }

  let response: NextResponse;
  try {
    const result = await apiFetch<unknown>(`${path}${rawSearch(request.url)}`, {
      method,
      rawBody: rawBody || undefined,
      clientIp: clientIpFrom(request),
      headers: { 'x-voter-token': voterToken },
    });
    if (result === null || result === undefined) {
      response = new NextResponse(null, {
        status: 204,
        headers: { 'cache-control': 'no-store' },
      });
    } else {
      response = NextResponse.json(result, { headers: { 'cache-control': 'no-store' } });
    }
  } catch (error) {
    response = errorResponse(error);
  }

  if (!existing) setVoterCookie(response, voterToken);
  return response;
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
