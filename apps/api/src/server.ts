import { buildApp } from './app.js';
import { config } from './config.js';
import { closeDb, getDb } from './db/client.js';
import { runMigrations } from './db/migrate.js';
import { logger } from './lib/logger.js';
import { runWorkerTick } from './services/worker.js';

let shuttingDown = false;

async function main(): Promise<void> {
  const db = getDb();

  if (process.env.RUN_MIGRATIONS !== 'false') {
    try {
      const result = await runMigrations(db, (message) => logger.info(message));
      logger.info(
        { applied: result.applied, skipped: result.skipped.length, dir: result.dir },
        'database migrations checked',
      );
    } catch (error) {
      logger.error(
        { error: error instanceof Error ? error.message : String(error) },
        'database migration failed; refusing to serve a half-built newsroom',
      );
      throw error;
    }
  }

  const app = await buildApp({ db });

  await app.listen({ port: config.port, host: config.host });
  logger.info(
    {
      port: config.port,
      host: config.host,
      env: config.env,
      model: config.ai.model,
      aiConfigured: Boolean(config.ai.apiKey),
      storage: config.storage.configured ? config.storage.mode : 'disabled',
      worker: config.worker.enabled,
    },
    'Duggal Badmosh API is printing',
  );

  let timer: NodeJS.Timeout | null = null;
  if (config.worker.enabled && config.worker.intervalMs > 0) {
    const interval = Math.max(5_000, config.worker.intervalMs);
    timer = setInterval(() => {
      void runWorkerTick().catch((error) => {
        logger.error(
          { error: error instanceof Error ? error.message : String(error) },
          'worker tick crashed',
        );
      });
    }, interval);
    timer.unref();
    setTimeout(() => {
      void runWorkerTick({ maxJobs: 1 }).catch(() => {});
    }, 2_000).unref();
    logger.info({ intervalMs: interval }, 'in-process worker loop started');
  } else {
    logger.info('in-process worker disabled; expecting external cron ticks');
  }

  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'shutting down');
    if (timer) clearInterval(timer);
    try {
      await app.close();
    } catch (error) {
      logger.warn({ error }, 'error closing HTTP server');
    }
    try {
      await closeDb();
    } catch (error) {
      logger.warn({ error }, 'error closing database');
    }
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('unhandledRejection', (reason) => {
    logger.error({ reason }, 'unhandled promise rejection');
  });
}

main().catch((error) => {
  logger.fatal(
    { error: error instanceof Error ? (error.stack ?? error.message) : String(error) },
    'API failed to start',
  );
  process.exit(1);
});
