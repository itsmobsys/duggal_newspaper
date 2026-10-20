import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { createDb, type Db } from '../src/db/client.js';
import { resolveMigrationsDir, runMigrations } from '../src/db/migrate.js';

const migrationsDir = resolveMigrationsDir();
const originalMigrationsDir = process.env.MIGRATIONS_DIR;
const tempRoots: string[] = [];

afterAll(() => {
  if (originalMigrationsDir === undefined) {
    delete process.env.MIGRATIONS_DIR;
  } else {
    process.env.MIGRATIONS_DIR = originalMigrationsDir;
  }
  for (const root of tempRoots) {
    try {
      rmSync(root, { recursive: true, force: true });
    } catch {
      // Windows may keep the SQLite handle briefly; the temp cleaner will get it.
    }
  }
});

function tempRoot(): string {
  const root = mkdtempSync(path.join(tmpdir(), 'dbd-migrations-'));
  tempRoots.push(root);
  return root;
}

function createTempDb(root: string, name: string): Db {
  const dbPath = path.join(root, name);
  return createDb({ url: `file:${dbPath.replace(/\\/g, '/')}` });
}

async function tableNames(db: Db): Promise<string[]> {
  const rows = await db.all<{ name: string }>(
    "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
  );
  return rows.map((row) => row.name);
}

async function memberColumns(db: Db): Promise<string[]> {
  const rows = await db.all<{ name: string }>('PRAGMA table_info(members)');
  return rows.map((row) => row.name);
}

describe('account cleanup migration', () => {
  it('leaves no reader account schema on a fresh database', async () => {
    const root = tempRoot();
    const db = createTempDb(root, 'fresh.db');
    process.env.MIGRATIONS_DIR = migrationsDir;
    await runMigrations(db);

    const tables = await tableNames(db);
    const columns = await memberColumns(db);
    expect(tables).toContain('article_votes');
    expect(tables).toContain('article_reviews');
    expect(tables).not.toContain('user_sessions');
    expect(columns).not.toContain('global_name');
    expect(columns).not.toContain('avatar_url');

    db.client.close();
  });

  it('cleans up a database that already applied 0004_discord_login.sql', async () => {
    const root = tempRoot();
    const partialDir = path.join(root, 'migrations-0004');
    mkdirSync(partialDir);
    for (const file of [
      '0001_init.sql',
      '0002_vercel_blob.sql',
      '0003_editor_override.sql',
      '0004_discord_login.sql',
    ]) {
      copyFileSync(path.join(migrationsDir, file), path.join(partialDir, file));
    }

    const db = createTempDb(root, 'existing.db');
    process.env.MIGRATIONS_DIR = partialDir;
    await runMigrations(db);
    expect(await tableNames(db)).toContain('user_sessions');
    expect(await memberColumns(db)).toContain('global_name');

    process.env.MIGRATIONS_DIR = migrationsDir;
    await runMigrations(db);

    const tables = await tableNames(db);
    const columns = await memberColumns(db);
    expect(tables).not.toContain('user_sessions');
    expect(columns).not.toContain('global_name');
    expect(columns).not.toContain('avatar_url');

    db.client.close();
  });
});
