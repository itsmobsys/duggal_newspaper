import { existsSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { config } from '../src/config.js';

/**
 * Local-only destructive reset. Remote databases are never touched.
 * Usage: npm run db:reset -- --yes
 */
async function main(): Promise<void> {
  if (!process.argv.includes('--yes')) {
    console.error('[reset] Refusing to delete data without --yes.');
    process.exit(1);
  }
  if (!config.db.url.startsWith('file:')) {
    console.error(
      '[reset] TURSO_DATABASE_URL is remote. This script only deletes a local SQLite file. ' +
        'Delete the Turso database from the dashboard if that is really what you want.',
    );
    process.exit(1);
  }

  const rawPath = config.db.url.slice('file:'.length);
  const target = path.isAbsolute(rawPath) ? rawPath : path.resolve(process.cwd(), rawPath);
  const candidates = [target, `${target}-wal`, `${target}-shm`];
  let removed = 0;
  for (const file of candidates) {
    if (existsSync(file)) {
      unlinkSync(file);
      removed += 1;
      console.log(`[reset] deleted ${file}`);
    }
  }
  console.log(`[reset] done (${removed} file(s)). Run npm run db:seed next.`);
}

main().catch((error) => {
  console.error('[reset] failed:', error instanceof Error ? error.message : error);
  process.exit(1);
});
