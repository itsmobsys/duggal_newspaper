import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb, type Db } from '../src/db/client.js';
import { runMigrations } from '../src/db/migrate.js';
import { enqueueJob } from '../src/services/queue.js';
import { runScheduler, runWorkerTick, setWorkerDb } from '../src/services/worker.js';

let dir: string;
let db: Db;

beforeAll(async () => {
  dir = mkdtempSync(path.join(tmpdir(), 'dbd-placements-'));
  db = createDb({ url: `file:${path.join(dir, 'test.db')}` });
  await runMigrations(db);
  setWorkerDb(db);
});

afterAll(() => {
  setWorkerDb(null);
  db.client.close();
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    // Windows keeps SQLite handles briefly; the OS temp cleaner will get it.
  }
});

interface Seed {
  id: string;
  placement: string;
  breaking: number;
  featured: number;
  status?: string;
}

async function seed(rows: Seed[]): Promise<void> {
  const now = '2026-10-20T00:00:00.000Z';
  for (const row of rows) {
    await db.run(
      `INSERT INTO articles (
         id, slug, headline, body, author_display, edition_date,
         status, placement, breaking, featured, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        row.id,
        row.id,
        `Headline ${row.id}`,
        'Body text.',
        'Desk',
        '2026-10-20',
        row.status ?? 'published',
        row.placement,
        row.breaking,
        row.featured,
        now,
        now,
      ],
    );
  }
}

async function read(id: string) {
  return db.get<{ placement: string; breaking: number; featured: number }>(
    `SELECT placement, breaking, featured FROM articles WHERE id = ?`,
    [id],
  );
}

describe('reset_placements', () => {
  it('clears lead, top, breaking and featured on published stories only', async () => {
    await seed([
      { id: 'lead-1', placement: 'lead', breaking: 1, featured: 0 },
      { id: 'top-1', placement: 'top', breaking: 0, featured: 1 },
      { id: 'std-1', placement: 'standard', breaking: 1, featured: 0 },
      { id: 'plain-1', placement: 'standard', breaking: 0, featured: 0 },
      { id: 'draft-1', placement: 'lead', breaking: 1, featured: 1, status: 'draft' },
    ]);

    await enqueueJob(db, { type: 'reset_placements', idempotencyKey: 'placements:test' });
    await runWorkerTick({ maxJobs: 10, runScheduler: false });

    expect(await read('lead-1')).toEqual({ placement: 'standard', breaking: 0, featured: 0 });
    expect(await read('top-1')).toEqual({ placement: 'standard', breaking: 0, featured: 0 });
    expect(await read('std-1')).toEqual({ placement: 'standard', breaking: 0, featured: 0 });
    expect(await read('plain-1')).toEqual({ placement: 'standard', breaking: 0, featured: 0 });

    // Unpublished work keeps whatever the editor set.
    expect(await read('draft-1')).toEqual({ placement: 'lead', breaking: 1, featured: 1 });
  });

  it('runs at most once per local day', async () => {
    // 18:31 UTC is 00:01 the next day in Asia/Kolkata.
    await runScheduler(db, new Date('2026-10-20T18:31:00.000Z'));
    await runScheduler(db, new Date('2026-10-20T18:36:00.000Z'));

    // The first tick of the day enqueued one job; the second was a no-op.
    // The manual key from the previous test is ignored on purpose.
    const scheduled = await db.all<{ idempotency_key: string }>(
      `SELECT idempotency_key FROM jobs
       WHERE type = 'reset_placements' AND idempotency_key <> 'placements:test'`,
    );
    expect(scheduled.length).toBe(1);
    expect(scheduled[0]?.idempotency_key).toBe('placements:2026-10-21');
  });

  it('stays out of the way during the rest of the day', async () => {
    // 06:30 UTC is noon in Asia/Kolkata: a deploy must not clear today's pins.
    await runScheduler(db, new Date('2026-10-21T06:30:00.000Z'));

    const scheduled = await db.all<{ idempotency_key: string }>(
      `SELECT idempotency_key FROM jobs
       WHERE type = 'reset_placements' AND idempotency_key <> 'placements:test'
       AND idempotency_key <> 'placements:2026-10-21'`,
    );
    expect(scheduled).toEqual([]);
  });
});
