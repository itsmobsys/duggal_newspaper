import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import { ZodError } from 'zod';
import { config } from './config.js';
import type { Db } from './db/client.js';
import { AppError } from './lib/errors.js';
import { logger } from './lib/logger.js';
import { verifyServiceRequest } from './lib/crypto.js';
import './routes/helpers.js';
import { registerAdminRoutes } from './routes/admin.js';
import { registerHealthRoutes } from './routes/health.js';
import { registerInternalRoutes } from './routes/internal.js';
import { registerMediaRoutes } from './routes/media.js';
import { registerPublicRoutes } from './routes/public.js';

export interface BuildAppOptions {
  db: Db;
  /** Disable Fastify's own request logging (tests / cron invocations). */
  quiet?: boolean;
}

function headerValue(request: FastifyRequest, name: string): string | undefined {
  const value = request.headers[name];
  if (Array.isArray(value)) return value[0];
  return value;
}

function pathnameOf(request: FastifyRequest): string {
  const url = request.raw.url ?? request.url;
  return url.split('?')[0] ?? url;
}

function isAllowedOrigin(origin: string): boolean {
  if (config.webOrigins.includes(origin)) return true;
  try {
    const parsed = new URL(origin);
    return (
      parsed.hostname === 'localhost' ||
      parsed.hostname === '127.0.0.1' ||
      parsed.hostname.endsWith('.vercel.app')
    );
  } catch {
    return false;
  }
}

/**
 * SQLite/Turso has a single writer. Serialising every route is too slow, but
 * the two-step upload flow needs the raw bytes both for hashing and for Blob,
 * so we capture the decoded JSON body for HMAC verification.
 */
function installBodyParsers(app: FastifyInstance): void {
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (request, body, done) => {
    const raw = typeof body === 'string' ? body : body.toString('utf8');
    request.rawBody = raw;
    if (!raw.trim()) {
      done(null, {});
      return;
    }
    try {
      done(null, JSON.parse(raw));
    } catch {
      done(new AppError(400, 'INVALID_JSON', 'Request body is not valid JSON.'), undefined);
    }
  });

  const imageParser = (
    request: FastifyRequest,
    body: Buffer,
    done: (error: Error | null, result?: unknown) => void,
  ): void => {
    request.rawBody = '';
    done(null, body);
  };

  app.addContentTypeParser(
    ['image/jpeg', 'image/png', 'image/webp', 'image/jpg', 'application/octet-stream'],
    { parseAs: 'buffer' },
    imageParser,
  );
}

export async function buildApp(options: BuildAppOptions): Promise<FastifyInstance> {
  const app = Fastify({
    logger: false,
    trustProxy: config.trustProxy,
    bodyLimit: config.maxUploadBytes + 1024 * 1024,
    disableRequestLogging: options.quiet ?? false,
    requestIdHeader: 'x-request-id',
    ignoreTrailingSlash: true,
  });

  installBodyParsers(app);

  app.addHook('onRequest', async (request, reply) => {
    const origin = headerValue(request, 'origin');
    if (origin && isAllowedOrigin(origin)) {
      reply.header('Access-Control-Allow-Origin', origin);
      reply.header('Vary', 'Origin');
      reply.header('Access-Control-Allow-Credentials', 'true');
    }
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Referrer-Policy', 'strict-origin-when-cross-origin');
    reply.header('X-Frame-Options', 'DENY');
    reply.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    reply.header('Cross-Origin-Resource-Policy', 'cross-origin');
    if (config.isProduction) {
      reply.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }

    if (request.method === 'OPTIONS') {
      reply.header('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
      reply.header(
        'Access-Control-Allow-Headers',
        'Content-Type, Authorization, X-Service-Timestamp, X-Service-Signature, X-Admin-Session, X-Worker-Token',
      );
      reply.header('Access-Control-Max-Age', '600');
      return reply.code(204).send();
    }
  });

  /**
   * Only the Next.js BFF (holding the shared secret) may call public/admin
   * endpoints. Direct Render traffic is rejected. Photo PUTs authenticate with
   * their own single-use ticket instead.
   */
  app.addHook('preHandler', async (request) => {
    const pathname = pathnameOf(request);
    if (pathname === '/healthz' || pathname === '/readyz') return;
    if (pathname.startsWith('/media/')) return;
    if (request.method === 'PUT' && pathname.startsWith('/public/uploads/')) return;
    if (!pathname.startsWith('/public/') && !pathname.startsWith('/admin/')) return;

    const timestamp = headerValue(request, 'x-service-timestamp');
    const signature = headerValue(request, 'x-service-signature');
    const raw = request.rawBody ?? '';
    if (
      !verifyServiceRequest(
        request.method,
        request.raw.url ?? request.url,
        raw,
        timestamp,
        signature,
      )
    ) {
      throw new AppError(
        401,
        'SERVICE_SIGNATURE_INVALID',
        'This endpoint is only reachable through the newspaper website.',
      );
    }
  });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ZodError) {
      return reply.code(400).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Some fields need fixing.',
          issues: error.issues.slice(0, 12).map((issue) => ({
            field: issue.path.join('.') || 'root',
            message: issue.message,
          })),
        },
      });
    }

    if (error instanceof AppError) {
      if (error.statusCode === 429) {
        const retryAfter = (error.details as { retryAfterSeconds?: number } | undefined)
          ?.retryAfterSeconds;
        if (retryAfter) reply.header('Retry-After', String(retryAfter));
      }
      return reply.code(error.statusCode).send({
        error: {
          code: error.code,
          message: error.message,
          ...(error.details !== undefined ? { details: error.details } : {}),
        },
      });
    }

    const statusCode =
      typeof (error as { statusCode?: unknown }).statusCode === 'number'
        ? (error as { statusCode: number }).statusCode
        : 500;

    if (statusCode === 413) {
      return reply.code(413).send({
        error: {
          code: 'PAYLOAD_TOO_LARGE',
          message: `Photo is too large. Maximum is ${Math.floor(config.maxUploadBytes / (1024 * 1024))} MB.`,
        },
      });
    }

    if (statusCode < 500) {
      const known = error as { code?: string; message?: string };
      return reply.code(statusCode).send({
        error: {
          code: known.code ?? 'BAD_REQUEST',
          message: known.message ?? 'Request rejected.',
        },
      });
    }

    logger.error(
      {
        err: error,
        method: request.method,
        path: pathnameOf(request),
        requestId: request.id,
      },
      'unhandled request error',
    );
    return reply.code(500).send({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'The printing press jammed. Try again in a moment.',
      },
    });
  });

  app.setNotFoundHandler(async (request, reply) => {
    return reply.code(404).send({
      error: {
        code: 'NOT_FOUND',
        message: `Nothing at ${pathnameOf(request)}. The intern probably moved it.`,
      },
    });
  });

  await registerHealthRoutes(app, options.db);
  await registerPublicRoutes(app, options.db);
  await registerAdminRoutes(app, options.db);
  await registerInternalRoutes(app, options.db);
  await registerMediaRoutes(app, options.db);

  return app;
}
