import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb, type Db } from '../src/db/client.js';
import { runMigrations } from '../src/db/migrate.js';
import {
  claimJob,
  completeJob,
  deferJob,
  enqueueJob,
  failJob,
  listJobs,
  queueStats,
  recoverExpiredLeases,
  retryJob,
} from '../src/services/queue.js';
import { runWorkerTick, setWorkerDb } from '../src/services/worker.js';

let dir: string;
let db: Db;

beforeAll(async () => {
  dir = mkdtempSync(path.join(tmpdir(), 'dbd-queue-'));
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

describe('queue', () => {
  it('coalesces jobs with the same pending idempotency key', async () => {
    const first = await enqueueJob(db, { type: 'test_coalesce', idempotencyKey: 'coalesce:1' });
    const second = await enqueueJob(db, { type: 'test_coalesce', idempotencyKey: 'coalesce:1' });
    expect(second).toBe(first);
  });

  it('claims a pending job exactly once and increments attempts', async () => {
    await db.run('DELETE FROM jobs');
    const id = await enqueueJob(db, { type: 'test_claim' });
    const claimed = await claimJob(db, 'worker_test', 30_000);
    expect(claimed?.id).toBe(id);
    expect(claimed?.attempts).toBe(1);
    expect(claimed?.status).toBe('leased');
    const again = await claimJob(db, 'worker_other', 30_000);
    expect(again).toBeNull();
  });

  it('retries a failed job with backoff and no immediate re-claim', async () => {
    await db.run('DELETE FROM jobs');
    const id = await enqueueJob(db, { type: 'test_fail', maxAttempts: 3 });
    const job = await claimJob(db, 'worker_test', 30_000);
    expect(job?.id).toBe(id);
    const outcome = await failJob(db, job!, 'boom');
    expect(outcome).toBe('retry');
    const row = await db.get<{
      status: string;
      attempts: number;
      run_at: string;
      last_error: string;
    }>('SELECT status, attempts, run_at, last_error FROM jobs WHERE id = ?', [id]);
    expect(row?.status).toBe('pending');
    expect(row?.attempts).toBe(1);
    expect(row?.last_error).toBe('boom');
    expect(new Date(row!.run_at).getTime()).toBeGreaterThan(Date.now());
  });

  it('marks a job dead after its final attempt', async () => {
    await db.run('DELETE FROM jobs');
    await enqueueJob(db, { type: 'test_dead', maxAttempts: 1 });
    const job = await claimJob(db, 'worker_test', 30_000);
    const outcome = await failJob(db, job!, 'fatal');
    expect(outcome).toBe('dead');
    const row = await db.get<{ status: string }>('SELECT status FROM jobs WHERE id = ?', [job!.id]);
    expect(row?.status).toBe('dead');
  });

  it('defers without consuming an attempt', async () => {
    await db.run('DELETE FROM jobs');
    await enqueueJob(db, { type: 'test_defer', maxAttempts: 3 });
    const job = await claimJob(db, 'worker_test', 30_000);
    await deferJob(db, job!, 120, 'throttled');
    const row = await db.get<{ status: string; attempts: number; run_at: string }>(
      'SELECT status, attempts, run_at FROM jobs WHERE id = ?',
      [job!.id],
    );
    expect(row?.status).toBe('pending');
    expect(row?.attempts).toBe(0);
    expect(new Date(row!.run_at).getTime()).toBeGreaterThan(Date.now());
  });

  it('recovers an expired lease back to pending', async () => {
    await db.run('DELETE FROM jobs');
    await enqueueJob(db, { type: 'test_lease' });
    const job = await claimJob(db, 'worker_test', 30_000);
    await db.run('UPDATE jobs SET locked_until = ? WHERE id = ?', [
      new Date(Date.now() - 60_000).toISOString(),
      job!.id,
    ]);
    const recovered = await recoverExpiredLeases(db);
    expect(recovered).toBeGreaterThanOrEqual(1);
    const row = await db.get<{ status: string }>('SELECT status FROM jobs WHERE id = ?', [job!.id]);
    expect(row?.status).toBe('pending');
  });

  it('reports queue stats and supports manual retry', async () => {
    await db.run('DELETE FROM jobs');
    await enqueueJob(db, { type: 'test_stats', maxAttempts: 1 });
    const claimed = await claimJob(db, 'worker_test', 30_000);
    await failJob(db, claimed!, 'dead now');
    let stats = await queueStats(db);
    expect(stats.dead).toBe(1);
    expect(await retryJob(db, claimed!.id)).toBe(true);
    stats = await queueStats(db);
    expect(stats.pending).toBe(1);
    expect(stats.dead).toBe(0);
    const listed = await listJobs(db, { type: 'test_stats' });
    expect(listed).toHaveLength(1);
  });

  it('does not re-enqueue a completed once-only job', async () => {
    await db.run('DELETE FROM jobs');
    const first = await enqueueJob(db, { type: 'test_once', idempotencyKey: 'once:1', once: true });
    const job = await claimJob(db, 'worker_test', 30_000);
    await completeJob(db, job!.id);
    const repeated = await enqueueJob(db, {
      type: 'test_once',
      idempotencyKey: 'once:1',
      once: true,
    });
    expect(repeated).toBe(first);
  });
});

describe('worker tick', () => {
  it('records a failure and reschedules an unknown job without crashing', async () => {
    await db.run('DELETE FROM jobs');
    await enqueueJob(db, { type: 'test_unknown_job_type', maxAttempts: 3 });
    const result = await runWorkerTick({
      maxJobs: 1,
      runScheduler: false,
      workerId: 'worker_tick_test',
    });
    expect(result.processed).toBe(1);
    expect(result.failed).toBe(1);
    const job = await db.get<{ status: string; last_error: string }>(
      "SELECT status, last_error FROM jobs WHERE type = 'test_unknown_job_type'",
    );
    expect(job?.status).toBe('pending');
    expect(job?.last_error).toMatch(/unknown|unsupported|job type/i);
    const run = await db.get<{ status: string }>(
      'SELECT status FROM job_runs ORDER BY created_at DESC LIMIT 1',
    );
    expect(run?.status).toBe('failed');
  });
});
