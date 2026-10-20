import type { Db } from '../db/client.js';
import { newId } from '../lib/id.js';
import { nowIso } from '../lib/time.js';

export type JobStatus = 'pending' | 'leased' | 'done' | 'failed' | 'dead';

export interface JobRecord {
  id: string;
  type: string;
  payload: string;
  status: JobStatus;
  attempts: number;
  max_attempts: number;
  run_at: string;
  locked_until: string | null;
  locked_by: string | null;
  last_error: string | null;
  idempotency_key: string | null;
  priority: number;
  created_at: string;
  updated_at: string;
  finished_at: string | null;
}

export interface EnqueueOptions {
  type: string;
  payload?: Record<string, unknown>;
  runAt?: string;
  priority?: number;
  maxAttempts?: number;
  idempotencyKey?: string;
  /** If true, an already-completed job with the same key is not re-enqueued. */
  once?: boolean;
}

export async function enqueueJob(db: Db, options: EnqueueOptions): Promise<string> {
  const key = options.idempotencyKey;
  if (key) {
    const statuses = options.once ? `('pending','leased','done')` : `('pending','leased')`;
    const existing = await db.get<{ id: string }>(
      `SELECT id FROM jobs WHERE idempotency_key = ? AND status IN ${statuses} ORDER BY created_at DESC LIMIT 1`,
      [key],
    );
    if (existing) return existing.id;
  }

  const id = newId('job');
  const now = nowIso();
  await db.run(
    `INSERT INTO jobs (id, type, payload, status, attempts, max_attempts, run_at, priority,
       idempotency_key, created_at, updated_at)
     VALUES (?, ?, ?, 'pending', 0, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      options.type,
      JSON.stringify(options.payload ?? {}),
      options.maxAttempts ?? 8,
      options.runAt ?? now,
      options.priority ?? 0,
      key ?? null,
      now,
      now,
    ],
  );
  return id;
}

async function findClaimable(db: Db): Promise<JobRecord | null> {
  const now = nowIso();
  return (
    (await db.get<JobRecord>(
      `SELECT * FROM jobs
       WHERE (status = 'pending' AND run_at <= ?)
          OR (status = 'leased' AND locked_until IS NOT NULL AND locked_until < ?)
       ORDER BY priority DESC, run_at ASC
       LIMIT 1`,
      [now, now],
    )) ?? null
  );
}

export async function claimJob(
  db: Db,
  workerId: string,
  leaseMs: number,
): Promise<JobRecord | null> {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const candidate = await findClaimable(db);
    if (!candidate) return null;
    const now = nowIso();
    const lockedUntil = new Date(Date.now() + leaseMs).toISOString();
    const result = await db.run(
      `UPDATE jobs
       SET status = 'leased', locked_until = ?, locked_by = ?, attempts = attempts + 1, updated_at = ?
       WHERE id = ?
         AND (status = 'pending' OR (status = 'leased' AND locked_until IS NOT NULL AND locked_until < ?))`,
      [lockedUntil, workerId, now, candidate.id, now],
    );
    if (result.rowsAffected > 0) {
      const claimed = await db.get<JobRecord>('SELECT * FROM jobs WHERE id = ?', [candidate.id]);
      return claimed ?? null;
    }
  }
  return null;
}

export async function renewLease(
  db: Db,
  jobId: string,
  workerId: string,
  leaseMs: number,
): Promise<void> {
  const lockedUntil = new Date(Date.now() + leaseMs).toISOString();
  await db.run(
    `UPDATE jobs SET locked_until = ?, updated_at = ? WHERE id = ? AND locked_by = ? AND status = 'leased'`,
    [lockedUntil, nowIso(), jobId, workerId],
  );
}

export async function completeJob(db: Db, jobId: string): Promise<void> {
  const now = nowIso();
  await db.run(
    `UPDATE jobs SET status = 'done', locked_until = NULL, locked_by = NULL, last_error = NULL,
       updated_at = ?, finished_at = ? WHERE id = ?`,
    [now, now, jobId],
  );
}

export function jobBackoffSeconds(attempt: number): number {
  return Math.min(7200, 60 * 3 ** Math.max(0, attempt - 1));
}

export async function failJob(
  db: Db,
  job: JobRecord,
  error: string,
  options: { dead?: boolean } = {},
): Promise<'retry' | 'dead'> {
  const now = new Date();
  const dead = options.dead || job.attempts >= job.max_attempts;
  if (dead) {
    await db.run(
      `UPDATE jobs SET status = 'dead', locked_until = NULL, locked_by = NULL, last_error = ?,
         updated_at = ?, finished_at = ? WHERE id = ?`,
      [error.slice(0, 2000), now.toISOString(), now.toISOString(), job.id],
    );
    return 'dead';
  }
  const delay = jobBackoffSeconds(job.attempts);
  await db.run(
    `UPDATE jobs SET status = 'pending', locked_until = NULL, locked_by = NULL, last_error = ?,
       run_at = ?, updated_at = ? WHERE id = ?`,
    [
      error.slice(0, 2000),
      new Date(now.getTime() + delay * 1000).toISOString(),
      now.toISOString(),
      job.id,
    ],
  );
  return 'retry';
}

/** Reschedule without consuming an attempt (used for throttling / backpressure). */
export async function deferJob(
  db: Db,
  job: JobRecord,
  seconds: number,
  reason: string,
): Promise<void> {
  const now = new Date();
  await db.run(
    `UPDATE jobs SET status = 'pending', locked_until = NULL, locked_by = NULL,
       attempts = CASE WHEN attempts > 0 THEN attempts - 1 ELSE 0 END,
       run_at = ?, last_error = ?, updated_at = ? WHERE id = ?`,
    [
      new Date(now.getTime() + seconds * 1000).toISOString(),
      reason.slice(0, 500),
      now.toISOString(),
      job.id,
    ],
  );
}

export async function recoverExpiredLeases(db: Db): Promise<number> {
  const now = nowIso();
  const expired = await db.all<JobRecord>(
    `SELECT * FROM jobs WHERE status = 'leased' AND locked_until IS NOT NULL AND locked_until < ?`,
    [now],
  );
  for (const job of expired) {
    if (job.attempts >= job.max_attempts) {
      await db.run(
        `UPDATE jobs SET status = 'dead', locked_until = NULL, locked_by = NULL,
           last_error = COALESCE(last_error, 'Lease expired after maximum attempts'), updated_at = ?
         WHERE id = ?`,
        [now, job.id],
      );
    } else {
      await db.run(
        `UPDATE jobs SET status = 'pending', locked_until = NULL, locked_by = NULL, updated_at = ?
         WHERE id = ?`,
        [now, job.id],
      );
    }
  }
  return expired.length;
}

export interface QueueStats {
  pending: number;
  leased: number;
  dead: number;
  doneLast24h: number;
}

export async function queueStats(db: Db): Promise<QueueStats> {
  const rows = await db.all<{ status: string; count: number }>(
    'SELECT status, COUNT(*) as count FROM jobs GROUP BY status',
  );
  const map = new Map(rows.map((row) => [row.status, Number(row.count)]));
  const done = await db.get<{ count: number }>(
    `SELECT COUNT(*) as count FROM jobs WHERE status = 'done' AND finished_at >= ?`,
    [new Date(Date.now() - 24 * 3600 * 1000).toISOString()],
  );
  return {
    pending: map.get('pending') ?? 0,
    leased: map.get('leased') ?? 0,
    dead: map.get('dead') ?? 0,
    doneLast24h: Number(done?.count ?? 0),
  };
}

export async function listJobs(
  db: Db,
  filter: { status?: JobStatus; type?: string; limit?: number; offset?: number },
): Promise<JobRecord[]> {
  const clauses: string[] = [];
  const args: Array<string | number> = [];
  if (filter.status) {
    clauses.push('status = ?');
    args.push(filter.status);
  }
  if (filter.type) {
    clauses.push('type = ?');
    args.push(filter.type);
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const limit = Math.min(200, Math.max(1, filter.limit ?? 50));
  const offset = Math.max(0, filter.offset ?? 0);
  return db.all<JobRecord>(
    `SELECT * FROM jobs ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    [...args, limit, offset],
  );
}

export async function retryJob(db: Db, jobId: string): Promise<boolean> {
  const now = nowIso();
  const result = await db.run(
    `UPDATE jobs SET status = 'pending', attempts = 0, run_at = ?, locked_until = NULL,
      locked_by = NULL, last_error = NULL, finished_at = NULL, updated_at = ? WHERE id = ?`,
    [now, now, jobId],
  );
  return result.rowsAffected > 0;
}

export async function hasActiveJob(db: Db, type: string): Promise<boolean> {
  const row = await db.get<{ id: string }>(
    `SELECT id FROM jobs WHERE type = ? AND status IN ('pending','leased') LIMIT 1`,
    [type],
  );
  return Boolean(row);
}
