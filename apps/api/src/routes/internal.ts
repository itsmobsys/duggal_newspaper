import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { config } from '../config.js';
import type { Db } from '../db/client.js';
import { safeEqual } from '../lib/crypto.js';
import { unauthorized } from '../lib/errors.js';
import { runWorkerTick } from '../services/worker.js';

const TickSchema = z.object({
  maxJobs: z.number().int().min(1).max(10).optional(),
});

function tokenFrom(request: FastifyRequest): string {
  const header = request.headers['x-worker-token'];
  if (typeof header === 'string' && header.length > 0) return header;
  const auth = request.headers.authorization;
  if (typeof auth === 'string' && auth.startsWith('Bearer ')) return auth.slice(7).trim();
  return '';
}

async function handleTick(
  request: FastifyRequest,
  options: { maxJobs?: number },
): Promise<{ ok: true; result: Awaited<ReturnType<typeof runWorkerTick>> }> {
  const token = tokenFrom(request);
  if (!token || !safeEqual(token, config.workerTickToken)) {
    throw unauthorized('Invalid worker token.', 'WORKER_TOKEN_INVALID');
  }
  const maxJobs = options.maxJobs ?? config.worker.maxJobsPerTick;
  const result = await runWorkerTick({
    maxJobs,
    runScheduler: true,
  });
  return { ok: true, result };
}

/**
 * Cron entry point. GitHub Actions hits this every few minutes so Render's
 * free instance can sleep in between; the in-process loop is optional.
 */
export async function registerInternalRoutes(app: FastifyInstance, _db: Db): Promise<void> {
  app.post('/internal/worker/tick', async (request) => {
    const body = TickSchema.parse(request.body ?? {});
    return handleTick(request, { maxJobs: body.maxJobs });
  });

  app.get('/internal/worker/tick', async (request) => {
    const query = request.query as Record<string, string | undefined>;
    const parsed = Number.parseInt(query.maxJobs ?? '', 10);
    return handleTick(request, {
      maxJobs: Number.isFinite(parsed) ? Math.min(10, Math.max(1, parsed)) : undefined,
    });
  });
}
