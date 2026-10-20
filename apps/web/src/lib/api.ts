import { createHash, createHmac } from 'node:crypto';

/**
 * Server-only client for the Render API.
 *
 * Every call is signed with SERVICE_SECRET so a stranger who finds the Render
 * URL cannot read the admin surface or forge submissions. The canonical string
 * must stay byte-identical to `signServiceRequest` in apps/api/src/lib/crypto.ts:
 *
 *   timestamp \n METHOD \n pathWithQuery \n sha256(rawBody)
 */

export interface ApiIssue {
  field: string;
  message: string;
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;
  readonly issues?: ApiIssue[];

  constructor(
    status: number,
    code: string,
    message: string,
    options: { details?: unknown; issues?: ApiIssue[] } = {},
  ) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = options.details;
    this.issues = options.issues;
  }
}

export function apiBaseUrl(): string {
  return (process.env.API_BASE_URL ?? 'http://localhost:8080').replace(/\/+$/, '');
}

export function apiConfigured(): boolean {
  return Boolean(process.env.SERVICE_SECRET);
}

function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

function hmac(secret: string, input: string): string {
  return createHmac('sha256', secret).update(input).digest('hex');
}

export interface ServiceSignature {
  timestamp: string;
  signature: string;
}

export function signServiceRequest(
  method: string,
  pathWithQuery: string,
  rawBody: string,
  secret: string,
  nowMs = Date.now(),
): ServiceSignature {
  const timestamp = Math.floor(nowMs / 1000).toString();
  const canonical = [timestamp, method.toUpperCase(), pathWithQuery, sha256(rawBody)].join('\n');
  return { timestamp, signature: hmac(secret, canonical) };
}

export type ApiMethod = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

export interface ApiFetchOptions {
  method?: ApiMethod;
  /** JSON body. Serialised once so the signature covers the exact bytes sent. */
  body?: unknown;
  /** Pre-serialised body, if a caller needs byte-level control. */
  rawBody?: string;
  /** Admin session token, forwarded as x-admin-session. */
  adminSession?: string | null;
  /** Real visitor IP, forwarded so API rate limits stay per-user. */
  clientIp?: string | null;
  headers?: Record<string, string>;
  /** Abort slow API calls instead of hanging a page render. */
  timeoutMs?: number;
  cache?: RequestCache;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** Read the Fastify error envelope without trusting its shape. */
function parseApiError(status: number, payload: unknown): ApiError {
  if (isRecord(payload) && isRecord(payload.error)) {
    const { code, message, details, issues } = payload.error;
    return new ApiError(
      status,
      typeof code === 'string' ? code : 'API_ERROR',
      typeof message === 'string' && message ? message : 'The newsroom API rejected the request.',
      {
        details,
        issues: Array.isArray(issues)
          ? issues.filter(
              (issue): issue is ApiIssue =>
                isRecord(issue) &&
                typeof issue.field === 'string' &&
                typeof issue.message === 'string',
            )
          : undefined,
      },
    );
  }
  return new ApiError(status, 'API_ERROR', 'The newsroom API returned an unexpected response.');
}

/**
 * Call the API. Throws ApiError for every non-2xx response so route handlers
 * can map failures to honest status codes instead of pretending to succeed.
 */
export async function apiFetch<T>(path: string, options: ApiFetchOptions = {}): Promise<T> {
  if (!path.startsWith('/')) throw new Error('apiFetch path must start with "/"');
  const secret = process.env.SERVICE_SECRET;
  if (!secret) {
    throw new ApiError(
      503,
      'API_NOT_CONFIGURED',
      'The website is not connected to the newsroom API yet.',
    );
  }

  const method = options.method ?? 'GET';
  const rawBody =
    options.rawBody ?? (options.body === undefined ? '' : JSON.stringify(options.body));
  const { timestamp, signature } = signServiceRequest(method, path, rawBody, secret);

  const headers: Record<string, string> = {
    accept: 'application/json',
    'x-service-timestamp': timestamp,
    'x-service-signature': signature,
    ...(options.adminSession ? { 'x-admin-session': options.adminSession } : {}),
    ...(options.clientIp ? { 'x-forwarded-for': options.clientIp } : {}),
    ...(rawBody ? { 'content-type': 'application/json' } : {}),
    ...options.headers,
  };

  let response: Response;
  try {
    response = await fetch(`${apiBaseUrl()}${path}`, {
      method,
      headers,
      body: rawBody ? rawBody : undefined,
      signal: AbortSignal.timeout(options.timeoutMs ?? 20_000),
      cache: options.cache ?? 'no-store',
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new ApiError(
      504,
      'API_UNREACHABLE',
      `The newsroom API could not be reached (${reason}).`,
    );
  }

  const contentType = response.headers.get('content-type') ?? '';
  const payload: unknown = contentType.includes('application/json')
    ? await response.json().catch(() => null)
    : await response.text().catch(() => '');

  if (!response.ok) throw parseApiError(response.status, payload);
  return payload as T;
}

/** Best-effort read of the visitor's IP from proxy headers. */
export function clientIpFrom(request: Request): string | null {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim();
    if (first) return first;
  }
  return request.headers.get('x-real-ip')?.trim() || null;
}
