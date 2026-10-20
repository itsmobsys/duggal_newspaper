import { getDb, closeDb } from '../src/db/client.js';
import { runMigrations } from '../src/db/migrate.js';

async function main(): Promise<void> {
  const db = getDb();
  const result = await runMigrations(db, (message) => console.log(`[migrate] ${message}`));
  console.log(
    `[migrate] done. applied=${result.applied.length} skipped=${result.skipped.length} dir=${result.dir}`,
  );
  await closeDb();
}

main().catch((error) => {
  console.error('[migrate] failed:', error instanceof Error ? error.message : error);
  process.exit(1);
});
