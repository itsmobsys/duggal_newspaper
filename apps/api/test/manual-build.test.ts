import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb, type Db } from '../src/db/client.js';
import { runMigrations } from '../src/db/migrate.js';
import { enqueueJob } from '../src/services/queue.js';
import { resetSchedulerForTests, runWorkerTick, setWorkerDb } from '../src/services/worker.js';
import { invalidateSettingsCache, updateSettings } from '../src/settings.js';

/**
 * "Build the paper now" (POST /admin/publish-now) leans on two behaviours that
 * are easy to break by accident:
 *
 *  1. the manual build job must not print before the stories it was triggered
 *     for have finished processing;
 *  2. a forced rebuild is an explicit human action, so it works even with
 *     autonomy switched off — but it must never downgrade a finished AI
 *     edition to the fallback layout when the AI desk is unreachable.
 *
 * No AI key exists in tests, so every AI call fails the same way production
 * fails when NVIDIA is down.
 */

const DATE = '2026-03-04';

let dir: string;
let db: Db;
let articleCounter = 0;

async function insertArticle(editionDate = DATE): Promise<string> {
  articleCounter += 1;
  const id = `art_test_${articleCounter}`;
  const now = new Date().toISOString();
  await db.run(
    `INSERT INTO articles (id, slug, headline, dek, body, category_slug, author_display,
       identity_mode, edition_date, status, published_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'server-news', 'Test Reporter', 'named', ?, 'published', ?, ?, ?)`,
    [
      id,
      `slug-${articleCounter}`,
      `Story number ${articleCounter}`,
      'A dek that explains the story.',
      'Body text that is long enough to be a paragraph.',
      editionDate,
      now,
      now,
      now,
    ],
  );
  return id;
}

async function insertEdition(generatedBy: 'ai' | 'fallback'): Promise<void> {
  const now = new Date().toISOString();
  await db.run(
    `INSERT INTO editions (edition_date, headline, summary, article_count, generated_by, status,
       created_at, updated_at)
     VALUES (?, 'Old paper', 'Old summary', 1, ?, 'published', ?, ?)`,
    [DATE, generatedBy, now, now],
  );
}

async function latestBuildJob(): Promise<
  { status: string; attempts: number; last_error: string | null } | undefined
> {
  return db.get<{ status: string; attempts: number; last_error: string | null }>(
    `SELECT status, attempts, last_error FROM jobs
     WHERE type = 'build_edition' ORDER BY created_at DESC LIMIT 1`,
  );
}

async function editionRow(): Promise<{ article_count: number; generated_by: string } | undefined> {
  return db.get<{ article_count: number; generated_by: string }>(
    'SELECT article_count, generated_by FROM editions WHERE edition_date = ?',
    [DATE],
  );
}

async function enqueueManualBuild(idempotencyKey: string): Promise<void> {
  await enqueueJob(db, {
    type: 'build_edition',
    payload: { date: DATE, force: true, afterQueue: true, queuedAt: Date.now() },
    idempotencyKey,
    once: true,
    priority: 2,
  });
}

async function tick(): Promise<void> {
  resetSchedulerForTests();
  await runWorkerTick({ maxJobs: 5, budgetMs: 15_000, runScheduler: false });
}

async function resetQueues(): Promise<void> {
  await db.run('DELETE FROM job_runs');
  await db.run('DELETE FROM jobs');
  await db.run('DELETE FROM editions');
  await db.run('DELETE FROM articles');
  invalidateSettingsCache();
}

beforeAll(async () => {
  dir = mkdtempSync(path.join(tmpdir(), 'dbd-manual-build-'));
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
    // Windows keeps the SQLite handle briefly; the OS temp cleaner will get it.
  }
});

describe('on-demand edition build', () => {
  it('waits for queued submissions instead of printing without their stories', async () => {
    await resetQueues();
    await insertArticle();
    // A submission job that cannot finish (the submission does not exist), so
    // the queue is still busy when the build job is claimed.
    await enqueueJob(db, {
      type: 'process_submission',
      payload: { submissionId: 'sub_does_not_exist' },
      idempotencyKey: 'process:sub_does_not_exist',
      priority: 5,
    });
    await enqueueManualBuild(`edition:${DATE}:manual:1`);

    await tick();

    const job = await latestBuildJob();
    expect(job?.status).toBe('pending');
    expect(job?.last_error).toMatch(/Waiting for 1 submission/);
    // The paper was not printed early.
    expect(await editionRow()).toBeUndefined();

    // The deferral does not burn an attempt.
    expect(job?.attempts).toBe(0);
  });

  it('builds on demand even when autonomy is switched off', async () => {
    await resetQueues();
    await insertArticle();
    await updateSettings(db, { 'autonomy.enabled': false }, 'test');
    await enqueueManualBuild(`edition:${DATE}:manual:2`);

    await tick();

    const job = await latestBuildJob();
    expect(job?.status).toBe('done');
    const edition = await editionRow();
    expect(edition?.generated_by).toBe('fallback');
    expect(edition?.article_count).toBe(1);
  });

  it('still refuses unattended builds while autonomy is off', async () => {
    await resetQueues();
    await insertArticle();
    await updateSettings(db, { 'autonomy.enabled': false }, 'test');
    await enqueueJob(db, {
      type: 'build_edition',
      payload: { date: DATE },
      idempotencyKey: `edition:${DATE}`,
      once: true,
      priority: 4,
    });

    await tick();

    expect((await latestBuildJob())?.status).toBe('done');
    expect(await editionRow()).toBeUndefined();
  });

  it('keeps a finished AI edition when a forced rebuild cannot reach the AI desk', async () => {
    await resetQueues();
    await insertEdition('ai');
    await insertArticle();
    await insertArticle(); // two stories now; the edition row still says one
    await updateSettings(db, { 'autonomy.enabled': true }, 'test');
    await enqueueManualBuild(`edition:${DATE}:manual:3`);

    await tick();

    const edition = await editionRow();
    // The deterministic fallback overwrote nothing.
    expect(edition?.generated_by).toBe('ai');
    expect(edition?.article_count).toBe(2);
  });
});
