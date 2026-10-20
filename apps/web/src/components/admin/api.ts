import { COOKIE_CSRF, CSRF_HEADER } from '@/lib/constants';

export interface AdminApiErrorBody {
  code: string;
  message: string;
  details?: unknown;
  issues?: Array<{ field: string; message: string }>;
}

export class AdminRequestError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;
  readonly issues?: Array<{ field: string; message: string }>;

  constructor(status: number, body: AdminApiErrorBody) {
    super(body.message);
    this.name = 'AdminRequestError';
    this.status = status;
    this.code = body.code;
    this.details = body.details;
    this.issues = body.issues;
  }
}

function readCookie(name: string): string {
  if (typeof document === 'undefined') return '';
  const prefix = `${name}=`;
  const found = document.cookie.split('; ').find((row) => row.startsWith(prefix));
  if (!found) return '';
  try {
    return decodeURIComponent(found.slice(prefix.length));
  } catch {
    return found.slice(prefix.length);
  }
}

function loginRedirect(): void {
  if (typeof window === 'undefined') return;
  const next = `${window.location.pathname}${window.location.search}`;
  window.location.assign(`/admin/login?next=${encodeURIComponent(next)}`);
}

function parseBody(text: string): unknown {
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

function toErrorBody(payload: unknown, status: number): AdminApiErrorBody {
  if (payload && typeof payload === 'object' && 'error' in payload) {
    const inner = (payload as { error: unknown }).error;
    if (inner && typeof inner === 'object') {
      const record = inner as Record<string, unknown>;
      return {
        code: typeof record.code === 'string' ? record.code : 'REQUEST_FAILED',
        message:
          typeof record.message === 'string' && record.message
            ? record.message
            : 'The newsroom API rejected the request.',
        ...(record.details === undefined ? {} : { details: record.details }),
        ...(Array.isArray(record.issues)
          ? {
              issues: record.issues.filter((issue): issue is { field: string; message: string } =>
                Boolean(
                  issue &&
                  typeof issue === 'object' &&
                  typeof (issue as { field?: unknown }).field === 'string' &&
                  typeof (issue as { message?: unknown }).message === 'string',
                ),
              ),
            }
          : {}),
      };
    }
  }
  return {
    code: status === 502 ? 'BAD_GATEWAY' : 'REQUEST_FAILED',
    message:
      status === 502
        ? 'The newsroom API did not answer. It may be waking up - try again in a few seconds.'
        : 'The request failed.',
  };
}

export interface AdminFetchOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  signal?: AbortSignal;
}

/**
 * Client-side wrapper for the BFF. Adds the CSRF header for mutations, keeps
 * the admin cookie out of JavaScript, and turns API errors into exceptions the
 * UI can render without inventing a success state.
 */
export async function adminFetch<T>(path: string, options: AdminFetchOptions = {}): Promise<T> {
  const method = options.method ?? 'GET';
  const headers: Record<string, string> = { accept: 'application/json' };
  if (options.body !== undefined) headers['content-type'] = 'application/json';
  if (method !== 'GET') {
    const token = readCookie(COOKIE_CSRF);
    if (token) headers[CSRF_HEADER] = token;
  }

  let response: Response;
  try {
    response = await fetch(`/api/admin${path.startsWith('/') ? path : `/${path}`}`, {
      method,
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      credentials: 'same-origin',
      cache: 'no-store',
      signal: options.signal,
    });
  } catch (error) {
    if ((error as { name?: string }).name === 'AbortError') throw error;
    throw new AdminRequestError(0, {
      code: 'NETWORK_ERROR',
      message: 'Network error. Check your connection and try again.',
    });
  }

  const text = await response.text();
  const payload = parseBody(text);

  if (response.status === 401) {
    loginRedirect();
    throw new AdminRequestError(401, {
      code: 'ADMIN_SESSION_REQUIRED',
      message: 'Your session expired. Signing you out...',
    });
  }

  if (!response.ok)
    throw new AdminRequestError(response.status, toErrorBody(payload, response.status));
  return payload as T;
}

/** Readable message for any thrown value. Never shows a stack trace. */
export function adminErrorMessage(error: unknown): string {
  if (error instanceof AdminRequestError) return error.message;
  if (error instanceof Error) return error.message;
  return 'Something went wrong.';
}

export function adminFieldErrors(error: unknown): Record<string, string> {
  if (!(error instanceof AdminRequestError) || !error.issues) return {};
  const map: Record<string, string> = {};
  for (const issue of error.issues) {
    if (!map[issue.field]) map[issue.field] = issue.message;
  }
  return map;
}
