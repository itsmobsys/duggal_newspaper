import type { FastifyInstance } from 'fastify';
import { config } from '../config.js';
import type { Db } from '../db/client.js';
import { nowIso } from '../lib/time.js';
import { storageStatus } from '../services/storage.js';
import { getStorageDegraded } from '../services/storage-usage.js';

export async function registerHealthRoutes(app: FastifyInstance, db: Db): Promise<void> {
  app.get('/healthz', async (_request, reply) => {
    reply.header('cache-control', 'public, max-age=5');
    return { ok: true, service: 'duggal-badmosh-api', time: nowIso() };
  });

  app.get('/readyz', async (_request, reply) => {
    const checks: Record<string, { ok: boolean; detail?: string }> = {};
    let ok = true;

    try {
      await db.get('SELECT 1 as ok');
      checks.database = { ok: true };
    } catch (error) {
      ok = false;
      checks.database = {
        ok: false,
        detail: error instanceof Error ? error.message.slice(0, 200) : 'unreachable',
      };
    }

    const storage = storageStatus();
    const degraded = getStorageDegraded();
    checks.storage = {
      ok: storage.ready,
      detail: storage.ready
        ? `${storage.mode} storage, originals: ${storage.originals}` +
          (degraded.active ? `; writes degraded: ${degraded.message ?? degraded.code}` : '')
        : 'not configured - photo uploads disabled',
    };
    checks.ai = {
      ok: Boolean(config.ai.apiKey),
      detail: config.ai.apiKey ? config.ai.model : 'NVIDIA_API_KEY missing - AI newsroom paused',
    };
    checks.worker = {
      ok: true,
      detail: config.worker.enabled
        ? `interval ${config.worker.intervalMs}ms`
        : 'external cron mode',
    };

    // AI/storage being absent is a degraded state, not a dead server: text
    // submissions and the admin console must still work.
    reply.header('cache-control', ok ? 'public, max-age=10' : 'no-store');
    reply.code(ok ? 200 : 503);
    return { ok, checks, time: nowIso() };
  });
}
