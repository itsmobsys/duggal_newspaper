import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Db } from '../db/client.js';
import type { AdminUserRow } from '../db/types.js';
import { hashIp } from '../lib/crypto.js';
import { AppError } from '../lib/errors.js';
import { nowIso } from '../lib/time.js';
import { loadSettings } from '../settings.js';

export interface AdminContext {
  user: AdminUserRow;
  sessionId: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    rawBody?: string;
    admin?: AdminContext;
  }
}

export function clientIp(request: FastifyRequest): string {
  return request.ip || '0.0.0.0';
}

export function clientIpHash(request: FastifyRequest): string {
  return hashIp(clientIp(request));
}

/**
 * Public writes are refused while the desk has taken the site down. Reads
 * (console, feeds, media) keep working so the operator can bring it back.
 */
export async function assertSiteLive(db: Db): Promise<void> {
  const settings = await loadSettings(db);
  if (settings['site.nuke']) {
    throw new AppError(503, 'SITE_DOWN', 'The website is down right now. Try again later.');
  }
}

export function parseJsonBody<T>(
  request: FastifyRequest,
  schema: {
    safeParse: (value: unknown) => {
      success: boolean;
      data?: T;
      error?: { issues: Array<{ path: Array<string | number>; message: string }> };
    };
  },
): T {
  const result = schema.safeParse(request.body ?? {});
  if (!result.success) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Some fields need fixing.', {
      details: result.error?.issues.map((issue) => ({
        field: issue.path.join('.'),
        message: issue.message,
      })),
    });
  }
  return result.data as T;
}

export function parsePagination(query: unknown): { limit: number; offset: number } {
  const data = (query ?? {}) as Record<string, string | undefined>;
  const limit = Math.min(100, Math.max(1, Number.parseInt(data.limit ?? '25', 10) || 25));
  const offset = Math.max(0, Number.parseInt(data.offset ?? '0', 10) || 0);
  return { limit, offset };
}

export async function writeAudit(
  db: Db,
  input: {
    actor: string;
    action: string;
    targetType?: string;
    targetId?: string;
    detail?: unknown;
    ipHash?: string | null;
  },
): Promise<void> {
  await db.run(
    `INSERT INTO audit_logs (id, actor, action, target_type, target_id, detail, ip_hash, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      `aud_${Date.now().toString(32)}${Math.random().toString(32).slice(2, 8)}`,
      input.actor,
      input.action,
      input.targetType ?? null,
      input.targetId ?? null,
      input.detail ? JSON.stringify(input.detail).slice(0, 4000) : null,
      input.ipHash ?? null,
      nowIso(),
    ],
  );
}

export function setNoStore(reply: FastifyReply): void {
  reply.header('Cache-Control', 'no-store, max-age=0');
}

export function parseBoolean(value: unknown, fallback = false): boolean {
  if (typeof value === 'boolean') return value;
  if (value === 'true' || value === '1' || value === 1) return true;
  if (value === 'false' || value === '0' || value === 0) return false;
  return fallback;
}

export function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
