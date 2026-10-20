import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Db } from './client.js';
import { splitSqlStatements } from './sql-split.js';

function candidateDirs(): string[] {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return [
    process.env.MIGRATIONS_DIR ?? '',
    path.resolve(process.cwd(), 'db/migrations'),
    path.resolve(process.cwd(), '../../db/migrations'),
    path.resolve(process.cwd(), '../db/migrations'),
    path.resolve(here, '../../db/migrations'),
    path.resolve(here, '../../../../db/migrations'),
  ].filter(Boolean);
}

export function resolveMigrationsDir(): string {
  for (const dir of candidateDirs()) {
    if (existsSync(dir)) return dir;
  }
  throw new Error(
    `Could not find database migrations. Looked in: ${candidateDirs().join(', ')}. ` +
      'Set MIGRATIONS_DIR to the db/migrations folder.',
  );
}

export interface MigrationResult {
  applied: string[];
  skipped: string[];
  dir: string;
}

export async function runMigrations(
  db: Db,
  log: (msg: string) => void = () => {},
): Promise<MigrationResult> {
  const dir = resolveMigrationsDir();
  await db.run(
    'CREATE TABLE IF NOT EXISTS _migrations (id TEXT PRIMARY KEY, applied_at TEXT NOT NULL)',
  );

  const files = readdirSync(dir)
    .filter((file) => file.endsWith('.sql'))
    .sort();

  const appliedRows = await db.all<{ id: string }>('SELECT id FROM _migrations');
  const applied = new Set(appliedRows.map((row) => row.id));
  const newlyApplied: string[] = [];
  const skipped: string[] = [];

  for (const file of files) {
    if (applied.has(file)) {
      skipped.push(file);
      continue;
    }
    const sql = readFileSync(path.join(dir, file), 'utf8');
    const statements = splitSqlStatements(sql);
    await db.transaction(async (tx) => {
      for (const statement of statements) {
        await tx.run(statement);
      }
      await tx.run('INSERT INTO _migrations (id, applied_at) VALUES (?, ?)', [
        file,
        new Date().toISOString(),
      ]);
    });
    newlyApplied.push(file);
    log(`applied migration ${file} (${statements.length} statements)`);
  }

  return { applied: newlyApplied, skipped, dir };
}
