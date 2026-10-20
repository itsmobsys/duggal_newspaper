export class AppError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly expose: boolean;
  readonly details?: unknown;

  constructor(
    statusCode: number,
    code: string,
    message: string,
    options: { expose?: boolean; details?: unknown } = {},
  ) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = code;
    this.expose = options.expose ?? statusCode < 500;
    this.details = options.details;
  }
}

export const badRequest = (message: string, code = 'BAD_REQUEST', details?: unknown) =>
  new AppError(400, code, message, { details });

export const unauthorized = (message = 'Authentication required.', code = 'UNAUTHORIZED') =>
  new AppError(401, code, message);

export const forbidden = (message = 'Not allowed.', code = 'FORBIDDEN') =>
  new AppError(403, code, message);

export const notFound = (message = 'Not found.', code = 'NOT_FOUND') =>
  new AppError(404, code, message);

export const conflict = (message: string, code = 'CONFLICT') => new AppError(409, code, message);

export const tooManyRequests = (message: string, retryAfterSeconds = 60) =>
  new AppError(429, 'RATE_LIMITED', message, { details: { retryAfterSeconds } });

export const serviceUnavailable = (message: string, code = 'SERVICE_UNAVAILABLE') =>
  new AppError(503, code, message);

export class DeferJobError extends Error {
  readonly seconds: number;
  constructor(seconds: number, message: string) {
    super(message);
    this.name = 'DeferJobError';
    this.seconds = Math.max(10, Math.min(3600, Math.round(seconds)));
  }
}

export class AiUnavailableError extends Error {
  readonly code: string;
  readonly retryable: boolean;

  constructor(message: string, code: string, retryable = true) {
    super(message);
    this.name = 'AiUnavailableError';
    this.code = code;
    this.retryable = retryable;
  }
}
