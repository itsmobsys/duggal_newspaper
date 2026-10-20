import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createDb, type Db } from '../src/db/client.js';
import { runMigrations } from '../src/db/migrate.js';
import { nextEditionDate } from '../src/lib/time.js';
import { resetSchedulerForTests, runScheduler } from '../src/services/worker.js';

let dir: string;
let db: Db;

const TOMORROW = '2026-10-21';

beforeAll(async () => {
  dir = mkdtempSync(path.join(tmpdir(), 'dbd-edition-'));
  db = createDb({ url: `file:${path.join(dir, 'test.db')}` });
  await runMigrations(db);
  await db.run(
    `INSERT INTO articles (id, slug, headline, body, category_slug, author_display, identity_mode,
       tags, status, edition_date, published_at, created_at, updated_at)
     VALUES ('art_sched', 'sched-story', 'A Story For Tomorrow', 'Body text.', 'server-news',
       'Reporter', 'named', '[]', 'published', ?, ?, ?, ?)`,
    [TOMORROW, '2026-10-20T10:00:00.000Z', '2026-10-20T10:00:00.000Z', '2026-10-20T10:00:00.000Z'],
  );
});

afterEach(() => {
  vi.useRealTimers();
});

afterAll(() => {
  db.client.close();
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    // Windows keeps the SQLite handle briefly; the OS temp cleaner will get it.
  }
});

describe('midnight edition schedule', () => {
  it('assigns a story to the edition it will actually be read in', () => {
    // 10:00 and 23:59 IST on 20 Oct both go into the 21 Oct paper...
    expect(nextEditionDate(new Date('2026-10-20T04:30:00Z'), 'Asia/Kolkata')).toBe('2026-10-21');
    expect(nextEditionDate(new Date('2026-10-20T18:29:00Z'), 'Asia/Kolkata')).toBe('2026-10-21');
    // ...while a story arriving exactly at midnight misses the paper that just went live.
    expect(nextEditionDate(new Date('2026-10-20T18:30:00Z'), 'Asia/Kolkata')).toBe('2026-10-22');
  });

  it('starts building at 11 PM IST so the paper is ready at midnight', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-20T17:30:00Z')); // 23:00 Asia/Kolkata
    resetSchedulerForTests();
    await runScheduler(db);

    const job = await db.get<{ payload: string; status: string; idempotency_key: string }>(
      "SELECT payload, status, idempotency_key FROM jobs WHERE type = 'build_edition'",
    );
    expect(job?.status).toBe('pending');
    expect(JSON.parse(job!.payload)).toEqual({ date: TOMORROW });
    expect(job?.idempotency_key).toBe(`edition:${TOMORROW}`);
  });

  it('does not start the nightly build before 11 PM', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-20T10:00:00Z')); // 15:30 Asia/Kolkata
    resetSchedulerForTests();
    await db.run("DELETE FROM jobs WHERE type = 'build_edition'");
    await runScheduler(db);

    const job = await db.get<{ id: string }>(
      "SELECT id FROM jobs WHERE type = 'build_edition' AND idempotency_key = ?",
      [`edition:${TOMORROW}`],
    );
    expect(job).toBeUndefined();
  });

  it('does not rebuild an edition that the AI already wrote', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-20T17:45:00Z')); // 23:15 Asia/Kolkata
    resetSchedulerForTests();
    await db.run(
      `INSERT INTO editions (edition_date, headline, summary, mood, lead_article_id, article_count,
         generated_by, status, created_at, updated_at)
       VALUES (?, 'Ready', 'Ready.', 'calm', 'art_sched', 1, 'ai', 'published', ?, ?)`,
      [TOMORROW, '2026-10-20T17:31:00.000Z', '2026-10-20T17:31:00.000Z'],
    );

    await runScheduler(db);

    const job = await db.get<{ id: string }>(
      "SELECT id FROM jobs WHERE type = 'build_edition' AND idempotency_key = ?",
      [`edition:${TOMORROW}`],
    );
    expect(job).toBeUndefined();
  });
});
