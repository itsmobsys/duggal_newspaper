import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { config } from '../src/config.js';
import { createDb, type Db } from '../src/db/client.js';
import { runMigrations } from '../src/db/migrate.js';
import { logger } from '../src/lib/logger.js';
import { AI_PAUSED_REASON, processSubmission } from '../src/services/process-submission.js';
import { runScheduler } from '../src/services/worker.js';

let dir: string;
let db: Db;
let submissionCounter = 0;

async function insertSubmission(
  overrides: Record<string, string | number | null> = {},
): Promise<string> {
  submissionCounter += 1;
  const id = `sub_test_${submissionCounter}`;
  const now = new Date().toISOString();
  await db.run(
    `INSERT INTO submissions (id, public_token, headline, story, author_name, identity_mode,
       status, content_hash, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'named', 'received', ?, ?, ?)`,
    [
      id,
      `tok_${submissionCounter}`,
      'The Server Owner Said Something Important Today',
      'The server owner posted a long message in the general channel and everyone read it carefully before replying with emojis.',
      'Test Reporter',
      `hash_${submissionCounter}`,
      now,
      now,
    ],
  );
  if (Object.keys(overrides).length > 0) {
    const columns = Object.keys(overrides);
    const assignments = columns.map((column) => `${column} = ?`).join(', ');
    await db.run(`UPDATE submissions SET ${assignments} WHERE id = ?`, [
      ...columns.map((column) => overrides[column]!),
      id,
    ]);
  }
  return id;
}

async function readSubmission(id: string) {
  return db.get<{
    status: string;
    review_reason: string | null;
    review_reasons: string | null;
    ai_attempts: number;
    ai_last_error: string | null;
  }>(
    'SELECT status, review_reason, review_reasons, ai_attempts, ai_last_error FROM submissions WHERE id = ?',
    [id],
  );
}

beforeAll(async () => {
  dir = mkdtempSync(path.join(tmpdir(), 'dbd-pipeline-'));
  db = createDb({ url: `file:${path.join(dir, 'test.db')}` });
  await runMigrations(db);
});

afterAll(() => {
  db.client.close();
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    // Windows keeps the SQLite handle briefly; the OS temp cleaner will get it.
  }
});

describe('AI outage handling', () => {
  it('parks a submission instead of losing it when AI is not configured', async () => {
    const id = await insertSubmission();
    await processSubmission(db, id, logger);
    const row = await readSubmission(id);
    expect(row?.status).toBe('queued_review');
    expect(row?.review_reason).toBe(AI_PAUSED_REASON);
    expect(row?.ai_attempts).toBe(0);
    expect(row?.ai_last_error).toMatch(/NVIDIA_API_KEY/);
  });

  it('requeues parked submissions once an AI key is present', async () => {
    const id = await insertSubmission({ status: 'queued_review', review_reason: AI_PAUSED_REASON });
    const originalKey = config.ai.apiKey;
    config.ai.apiKey = 'test-key-for-scheduler-only';
    try {
      await runScheduler(db);
    } finally {
      config.ai.apiKey = originalKey;
    }
    const row = await readSubmission(id);
    expect(row?.status).toBe('received');
    expect(row?.review_reason).toBeNull();
    const job = await db.get<{ type: string; status: string }>(
      "SELECT type, status FROM jobs WHERE type = 'process_submission' AND payload LIKE ?",
      [`%${id}%`],
    );
    expect(job?.type).toBe('process_submission');
    expect(job?.status).toBe('pending');
  });
});
