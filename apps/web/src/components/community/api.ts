export interface CommunityErrorBody {
  code: string;
  message: string;
  details?: unknown;
  issues?: Array<{ field: string; message: string }>;
}

export class CommunityRequestError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;
  readonly issues?: Array<{ field: string; message: string }>;

  constructor(status: number, body: CommunityErrorBody) {
    super(body.message);
    this.name = 'CommunityRequestError';
    this.status = status;
    this.code = body.code;
    this.details = body.details;
    this.issues = body.issues;
  }
}

function parseBody(text: string): unknown {
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

function toErrorBody(payload: unknown, status: number): CommunityErrorBody {
  if (payload && typeof payload === 'object' && 'error' in payload) {
    const inner = (payload as { error: unknown }).error;
    if (inner && typeof inner === 'object') {
      const record = inner as Record<string, unknown>;
      return {
        code: typeof record.code === 'string' ? record.code : 'REQUEST_FAILED',
        message:
          typeof record.message === 'string' && record.message
            ? record.message
            : 'The paper rejected that request.',
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
        ? 'The newsroom API did not answer. It may be waking up — try again in a few seconds.'
        : 'The request failed.',
  };
}

export interface CommunityFetchOptions {
  method?: 'GET' | 'POST' | 'DELETE';
  body?: unknown;
  signal?: AbortSignal;
}

/**
 * Client wrapper for the reader BFF. The session lives in an httpOnly cookie,
 * so `credentials: same-origin` is the only auth the browser needs.
 */
export async function communityFetch<T>(
  path: string,
  options: CommunityFetchOptions = {},
): Promise<T> {
  const method = options.method ?? 'GET';
  const headers: Record<string, string> = { accept: 'application/json' };
  if (options.body !== undefined) headers['content-type'] = 'application/json';

  let response: Response;
  try {
    response = await fetch(`/api/community${path.startsWith('/') ? path : `/${path}`}`, {
      method,
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      credentials: 'same-origin',
      cache: 'no-store',
      signal: options.signal,
    });
  } catch (error) {
    if ((error as { name?: string }).name === 'AbortError') throw error;
    throw new CommunityRequestError(0, {
      code: 'NETWORK_ERROR',
      message: 'Network error. Check your connection and try again.',
    });
  }

  const text = await response.text();
  const payload = parseBody(text);
  if (!response.ok) {
    throw new CommunityRequestError(response.status, toErrorBody(payload, response.status));
  }
  return payload as T;
}

export function communityErrorMessage(error: unknown): string {
  if (error instanceof CommunityRequestError) {
    if (error.code === 'AUTH_REQUIRED') {
      return 'Log in with Discord to join the conversation.';
    }
    return error.message;
  }
  if (error instanceof Error) return error.message;
  return 'Something went wrong.';
}

/** Login URL that returns the reader to this article after Discord OAuth. */
export function loginHref(nextPath: string): string {
  return `/api/auth/discord?next=${encodeURIComponent(nextPath)}`;
}
