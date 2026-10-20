import { config } from '../config.js';
import type { Db } from '../db/client.js';
import { getDb } from '../db/client.js';
import type { UploadRow } from '../db/types.js';
import { DeferJobError } from '../lib/errors.js';
import { logger, type Logger } from '../lib/logger.js';
import { cleanupRateLimits } from '../lib/rate-limit.js';
import {
  editionDateFor,
  localHourFor,
  localWeekdayFor,
  nextEditionDate,
  nowIso,
} from '../lib/time.js';
import { loadSettings, type Settings } from '../settings.js';
import { buildWeeklyAwards } from './awards.js';
import { buildEdition } from './editions.js';
import { AI_PAUSED_REASON, processSubmission } from './process-submission.js';
import {
  claimJob,
  completeJob,
  deferJob,
  enqueueJob,
  failJob,
  hasActiveJob,
  recoverExpiredLeases,
  renewLease,
  type JobRecord,
} from './queue.js';
import { getStorage } from './storage.js';

export interface TickOptions {
  maxJobs?: number;
  budgetMs?: number;
  workerId?: string;
  runScheduler?: boolean;
}

export interface TickResult {
  processed: number;
  succeeded: number;
  failed: number;
  skipped: boolean;
  recoveredLeases: number;
  durationMs: number;
  errors: Array<{ jobId: string; type: string; error: string }>;
}

let tickInProgress = false;
let lastSchedulerRun = 0;

function parsePayload(job: JobRecord): Record<string, unknown> {
  try {
    return JSON.parse(job.payload) as Record<string, unknown>;
  } catch {
    return {};
  }
}

async function runJob(db: Db, job: JobRecord, log: Logger, settings: Settings): Promise<void> {
  const payload = parsePayload(job);
  switch (job.type) {
    case 'process_submission': {
      const submissionId = String(payload.submissionId ?? '');
      if (!submissionId) throw new Error('process_submission job is missing submissionId.');
      await processSubmission(db, submissionId, log);
      return;
    }
    case 'build_edition': {
      const date = String(payload.date ?? editionDateFor(new Date(), settings['site.timezone']));

      // An on-demand rebuild should include the stories the admin just sent.
      // If those are still being rewritten, wait briefly instead of printing a
      // paper that is already missing its own front page.
      if (payload.afterQueue === true) {
        const queuedAt = Number(payload.queuedAt ?? 0);
        const pending = await db.get<{ count: number }>(
          `SELECT COUNT(*) as count FROM jobs
           WHERE type = 'process_submission' AND status IN ('pending','leased')`,
        );
        const waiting = Number(pending?.count ?? 0);
        const withinWindow = queuedAt > 0 && Date.now() - queuedAt < 15 * 60_000;
        if (waiting > 0 && withinWindow) {
          throw new DeferJobError(15, `Waiting for ${waiting} submission(s) to finish processing.`);
        }
      }

      await buildEdition(db, date, log, { force: payload.force === true });
      return;
    }
    case 'weekly_awards': {
      await buildWeeklyAwards(db, log);
      return;
    }
    case 'cleanup_uploads': {
      await cleanupUploads(db, log);
      return;
    }
    case 'recover_failed': {
      await recoverFailedSubmissions(db, log);
      return;
    }
    default:
      throw new Error(`Unknown job type: ${job.type}`);
  }
}

async function cleanupUploads(db: Db, log: Logger): Promise<void> {
  const now = nowIso();
  const stale = await db.all<UploadRow>(
    `SELECT * FROM uploads
     WHERE (status IN ('pending','stored') AND expires_at < ? AND submission_id IS NULL)
     ORDER BY expires_at ASC LIMIT 100`,
    [now],
  );
  if (stale.length === 0) return;
  const storage = config.storage.configured ? getStorage() : null;
  for (const upload of stale) {
    if (storage) {
      if (upload.storage_key) await storage.delete(upload.storage_key);
      if (upload.thumb_key) await storage.delete(upload.thumb_key);
    }
    await db.run(`UPDATE uploads SET status = 'expired' WHERE id = ? AND submission_id IS NULL`, [
      upload.id,
    ]);
  }
  log.info({ count: stale.length }, 'expired orphan uploads cleaned up');
}

async function recoverFailedSubmissions(db: Db, log: Logger): Promise<void> {
  if (!config.ai.apiKey) return;
  const cutoff = new Date(Date.now() - 3 * 3600 * 1000).toISOString();
  const stuck = await db.all<{ id: string }>(
    `SELECT id FROM submissions
     WHERE article_id IS NULL
       AND (status = 'failed' OR (status = 'processing' AND updated_at < ?))
     ORDER BY updated_at ASC LIMIT 20`,
    [cutoff],
  );
  for (const row of stuck) {
    await db.run(
      `UPDATE submissions SET status = 'received', ai_last_error = NULL, updated_at = ? WHERE id = ?`,
      [nowIso(), row.id],
    );
    await enqueueJob(db, {
      type: 'process_submission',
      payload: { submissionId: row.id, recovery: true },
      idempotencyKey: `process:${row.id}`,
      priority: 1,
    });
  }
  if (stuck.length > 0) log.info({ count: stuck.length }, 'requeued failed submissions');
}

/**
 * Makes sure an edition exists for `date` — either by asking the queue to build
 * it, or by retrying a deterministic fallback that was written while the AI was
 * unreachable. Never enqueues an edition with no stories behind it.
 */
async function ensureEdition(
  db: Db,
  date: string,
  options: { hour: number; retryFallback: boolean },
): Promise<void> {
  const existing = await db.get<{ generated_by: string }>(
    'SELECT generated_by FROM editions WHERE edition_date = ?',
    [date],
  );

  if (!existing) {
    const story = await db.get<{ count: number }>(
      `SELECT COUNT(*) as count FROM articles WHERE status = 'published' AND edition_date = ?`,
      [date],
    );
    if (Number(story?.count ?? 0) === 0) return;
    await enqueueJob(db, {
      type: 'build_edition',
      payload: { date },
      idempotencyKey: `edition:${date}`,
      once: true,
      priority: 4,
    });
    return;
  }

  // A fallback layout is a safety net, not the finished paper. During the night
  // window, try once an hour to replace it with a real AI-written edition.
  if (options.retryFallback && existing.generated_by !== 'ai') {
    await enqueueJob(db, {
      type: 'build_edition',
      payload: { date },
      idempotencyKey: `edition:${date}:retry:${options.hour}`,
      once: true,
      priority: 3,
    });
  }
}

export async function runScheduler(db: Db): Promise<void> {
  const settings = await loadSettings(db);
  const now = new Date();
  const date = editionDateFor(now, settings['site.timezone']);
  const hour = localHourFor(now, settings['site.timezone']);
  const weekday = localWeekdayFor(now, settings['site.timezone']);

  // Housekeeping: once per hour.
  const hourKey = `${date}-${String(hour).padStart(2, '0')}`;
  if (!(await hasActiveJob(db, 'cleanup_uploads'))) {
    await enqueueJob(db, {
      type: 'cleanup_uploads',
      idempotencyKey: `cleanup:${hourKey}`,
      once: true,
      priority: -5,
    });
  }
  void cleanupRateLimits(db).catch(() => {});

  if (!settings['autonomy.enabled']) return;

  // Stories that arrived while AI was unconfigured were parked, not dropped.
  // Once a key exists, requeue them so nothing is lost to a missing env var.
  if (config.ai.apiKey) {
    const paused = await db.all<{ id: string }>(
      `SELECT id FROM submissions
       WHERE status = 'queued_review' AND review_reason = ?
       ORDER BY created_at ASC LIMIT 10`,
      [AI_PAUSED_REASON],
    );
    for (const row of paused) {
      await db.run(
        `UPDATE submissions SET status = 'received', review_reason = NULL,
           review_reasons = NULL, updated_at = ? WHERE id = ?`,
        [nowIso(), row.id],
      );
      await enqueueJob(db, {
        type: 'process_submission',
        payload: { submissionId: row.id, recovered: true },
        idempotencyKey: `process:${row.id}`,
        priority: 2,
      });
    }
    if (paused.length > 0) {
      logger.info({ count: paused.length }, 'requeued AI-paused submissions');
    }
  }

  if (settings['autonomy.daily_edition']) {
    // A story belongs to the edition it will be read in, so the paper dated
    // today was assembled last night and should already be waiting.
    await ensureEdition(db, date, { hour, retryFallback: hour < 6 });

    // Nightly build. With the default edition hour of 23 (11 PM IST) the AI
    // starts assembling tomorrow's paper, then the front page rolls over to it
    // at midnight — ready, not still typing.
    if (hour >= settings['autonomy.edition_hour']) {
      const upcoming = nextEditionDate(now, settings['site.timezone']);
      await ensureEdition(db, upcoming, {
        hour,
        retryFallback: hour >= settings['autonomy.edition_hour'] || hour < 6,
      });
    }
  }

  if (
    settings['autonomy.awards_enabled'] &&
    weekday === settings['autonomy.awards_weekday'] &&
    hour >= 12
  ) {
    const existing = await db.get<{ id: string }>(
      `SELECT id FROM awards WHERE auto_generated = 1 AND edition_date = ? LIMIT 1`,
      [date],
    );
    if (!existing) {
      await enqueueJob(db, {
        type: 'weekly_awards',
        idempotencyKey: `awards:${date}`,
        once: true,
        priority: 2,
      });
    }
  }

  if (settings['autonomy.recover_failed_daily'] && hour >= 6) {
    await enqueueJob(db, {
      type: 'recover_failed',
      idempotencyKey: `recover:${date}`,
      once: true,
      priority: -2,
    });
  }
}

export async function runWorkerTick(options: TickOptions = {}): Promise<TickResult> {
  const startedAt = Date.now();
  const maxJobs = options.maxJobs ?? config.worker.maxJobsPerTick;
  const budgetMs = options.budgetMs ?? config.worker.budgetMs;
  const workerId = options.workerId ?? `worker_${process.pid}`;
  const runSched = options.runScheduler ?? true;

  if (tickInProgress) {
    return {
      processed: 0,
      succeeded: 0,
      failed: 0,
      skipped: true,
      recoveredLeases: 0,
      durationMs: 0,
      errors: [],
    };
  }

  tickInProgress = true;
  const result: TickResult = {
    processed: 0,
    succeeded: 0,
    failed: 0,
    skipped: false,
    recoveredLeases: 0,
    durationMs: 0,
    errors: [],
  };

  try {
    result.recoveredLeases = await recoverExpiredLeases(db_());
    if (runSched && Date.now() - lastSchedulerRun > 60_000) {
      lastSchedulerRun = Date.now();
      await runScheduler(db_());
    }

    while (result.processed < maxJobs && Date.now() - startedAt < budgetMs) {
      const job = await claimJob(db_(), workerId, config.worker.leaseMs);
      if (!job) break;

      result.processed += 1;
      const jobLog = logger.child({ jobId: job.id, jobType: job.type, attempt: job.attempts });
      const settings = await loadSettings(db_());
      const runId = `jr_${Date.now().toString(32)}${Math.random().toString(32).slice(2, 8)}`;
      const jobStart = Date.now();
      await db_().run(
        `INSERT INTO job_runs (id, job_id, attempt, status, created_at) VALUES (?, ?, ?, 'started', ?)`,
        [runId, job.id, job.attempts, nowIso()],
      );

      let heartbeat: NodeJS.Timeout | null = setInterval(
        () => {
          void renewLease(db_(), job.id, workerId, config.worker.leaseMs).catch(() => {});
        },
        Math.max(30_000, Math.floor(config.worker.leaseMs / 3)),
      );

      try {
        await runJob(db_(), job, jobLog, settings);
        await completeJob(db_(), job.id);
        await db_().run(`UPDATE job_runs SET status = 'succeeded', duration_ms = ? WHERE id = ?`, [
          Date.now() - jobStart,
          runId,
        ]);
        result.succeeded += 1;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (error instanceof DeferJobError) {
          await deferJob(db_(), job, error.seconds, message);
          await db_().run(
            `UPDATE job_runs SET status = 'succeeded', duration_ms = ?, error = ? WHERE id = ?`,
            [Date.now() - jobStart, `deferred: ${message}`.slice(0, 500), runId],
          );
          jobLog.info({ seconds: error.seconds }, 'job deferred');
        } else {
          const outcome = await failJob(db_(), job, message);
          await db_().run(
            `UPDATE job_runs SET status = 'failed', duration_ms = ?, error = ? WHERE id = ?`,
            [Date.now() - jobStart, message.slice(0, 1000), runId],
          );
          result.failed += 1;
          result.errors.push({ jobId: job.id, type: job.type, error: message.slice(0, 300) });

          if (outcome === 'dead' && job.type === 'process_submission') {
            const payload = parsePayload(job);
            const submissionId = String(payload.submissionId ?? '');
            if (submissionId) {
              await db_().run(
                `UPDATE submissions SET status = 'failed', ai_last_error = ?, updated_at = ?
                 WHERE id = ? AND status != 'published'`,
                [message.slice(0, 1000), nowIso(), submissionId],
              );
            }
          }
          jobLog.error({ error: message, outcome }, 'job failed');
        }
      } finally {
        if (heartbeat) {
          clearInterval(heartbeat);
          heartbeat = null;
        }
      }
    }
  } finally {
    tickInProgress = false;
    result.durationMs = Date.now() - startedAt;
  }

  return result;
}

// The DB handle is created lazily so tests can inject an isolated database via
// setWorkerDb() before the first tick.
let injectedDb: Db | null = null;

export function setWorkerDb(db: Db | null): void {
  injectedDb = db;
}

/**
 * Fire-and-forget tick used by request handlers. On a long-lived Render
 * instance this starts work a few milliseconds after the response; if the
 * process is asleep the durable queue (or the external cron pinger) picks it
 * up on the next tick.
 */
export function kickWorkerTick(delayMs = 5, maxJobs = 4): void {
  if (!config.worker.enabled) return;
  setTimeout(() => {
    void runWorkerTick({ maxJobs }).catch((error) => {
      if (process.env.NODE_ENV !== 'test') {
        logger.error(
          { error: error instanceof Error ? error.message : String(error) },
          'kicked worker tick failed',
        );
      }
    });
  }, delayMs).unref?.();
}

function db_(): Db {
  return injectedDb ?? getDb();
}

export function resetSchedulerForTests(): void {
  lastSchedulerRun = 0;
  tickInProgress = false;
}
