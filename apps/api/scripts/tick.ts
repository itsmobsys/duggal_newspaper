import { closeDb, getDb } from '../src/db/client.js';
import { runMigrations } from '../src/db/migrate.js';
import { runWorkerTick } from '../src/services/worker.js';

/** One-shot worker tick, used by cron and by operators debugging the queue. */
async function main(): Promise<void> {
  const db = getDb();
  await runMigrations(db);
  const result = await runWorkerTick({ runScheduler: true });
  console.log(JSON.stringify(result, null, 2));
  await closeDb();
}

main().catch((error) => {
  console.error('[tick] failed:', error instanceof Error ? error.message : error);
  process.exit(1);
});
