import {
  BlobAccessError,
  BlobError,
  BlobServiceRateLimited,
  BlobStoreSuspendedError,
} from '@vercel/blob';
import type { Db } from '../db/client.js';
import { config } from '../config.js';
import { AppError } from '../lib/errors.js';
import { newId } from '../lib/id.js';
import { nowIso } from '../lib/time.js';
import { loadSettings, type Settings } from '../settings.js';
import { isPrivateStoreError, storageStatus } from './storage.js';

/**
 * Vercel Blob free-tier governor.
 *
 * Hobby Blob is free but hard-capped: 1 GB of storage, 10,000 simple
 * operations, 2,000 advanced operations (uploads/copies/lists) and 10 GB of
 * transfer per month. Going over does not charge money - it locks the store
 * out for 30 days, which for a daily paper means losing every photo. So the
 * API counts what it spends and stops accepting photos *before* the ceiling,
 * while text-only submissions keep working.
 *
 * Verified against https://vercel.com/docs/vercel-blob/usage-and-pricing
 * (pricing page last updated 2026-09-23). Deletes are free and uncounted.
 */
export const BLOB_HOBBY_PLAN = {
  storageBytes: 1024 ** 3, // 1 GB
  simpleOps: 10_000,
  advancedOps: 2_000,
  transferBytes: 10 * 1024 ** 3, // 10 GB
  docsUrl: 'https://vercel.com/docs/vercel-blob/usage-and-pricing',
} as const;

export const STORAGE_QUOTA_ERROR = 'STORAGE_QUOTA_EXHAUSTED';
export const STORAGE_DEGRADED_ERROR = 'STORAGE_DEGRADED';

export function currentMonth(date = new Date()): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

export interface StoragePolicy {
  preserveOriginals: boolean;
  originalRetentionDays: number;
  blockWhenFull: boolean;
  softStorageBytes: number;
  softAdvancedOps: number;
}

export function resolveStoragePolicy(settings: Settings): StoragePolicy {
  const softMb = Math.min(
    settings['storage.soft_limit_mb'],
    BLOB_HOBBY_PLAN.storageBytes / 1024 ** 2,
  );
  return {
    preserveOriginals: settings['storage.preserve_originals'],
    originalRetentionDays: settings['storage.original_retention_days'],
    blockWhenFull: settings['storage.block_uploads_when_full'],
    softStorageBytes: Math.round(softMb * 1024 ** 2),
    softAdvancedOps: Math.min(
      settings['storage.monthly_advanced_op_limit'],
      BLOB_HOBBY_PLAN.advancedOps,
    ),
  };
}

export interface StorageUsage {
  month: string;
  bytes: {
    /** Photos attached to published stories. */
    published: number;
    /** Photos uploaded but not yet published (or never claimed). */
    pending: number;
    /** Preserved originals counted separately so admins can see the cost of keeping them. */
    originals: number;
    total: number;
  };
  ops: { advanced: number; simple: number };
  counters: { bytesUploaded: number; bytesPruned: number };
  plan: typeof BLOB_HOBBY_PLAN;
  limits: StoragePolicy & { retentionDays: number };
  headroom: { storageBytes: number; advancedOps: number };
  store: ReturnType<typeof storageStatus>;
  exhausted: boolean;
  reason: 'storage' | 'ops' | 'degraded' | null;
  degraded: DegradedState;
}

export interface DegradedState {
  active: boolean;
  since: string | null;
  code: string | null;
  message: string | null;
}

let degraded: DegradedState = { active: false, since: null, code: null, message: null };
let lastDegradedLogAt = 0;

export function getStorageDegraded(): DegradedState {
  return { ...degraded };
}

export function clearStorageDegraded(): DegradedState {
  degraded = { active: false, since: null, code: null, message: null };
  return getStorageDegraded();
}

/**
 * Remember that Blob refused a write, so intake stops promising photos and the
 * admin console can explain why. Written to the audit log at most once every
 * fifteen minutes to keep the table readable during an outage.
 */
export async function markStorageDegraded(
  db: Db,
  input: { code: string; message: string },
): Promise<void> {
  const first = !degraded.active;
  degraded = {
    active: true,
    since: degraded.since ?? nowIso(),
    code: input.code,
    message: input.message.slice(0, 400),
  };

  const now = Date.now();
  if (!first && now - lastDegradedLogAt < 15 * 60 * 1000) return;
  lastDegradedLogAt = now;

  try {
    await db.run(
      `INSERT INTO audit_logs (id, actor, action, target_type, target_id, detail, ip_hash, created_at)
       VALUES (?, 'system', 'storage.degraded', 'storage', 'vercel-blob', ?, NULL, ?)`,
      [
        newId('aud'),
        JSON.stringify({ code: input.code, message: input.message.slice(0, 400) }),
        nowIso(),
      ],
    );
  } catch {
    /* the flag above is what actually protects the intake */
  }
}

/** Blob failures worth surfacing differently from a plain bug. */
export function classifyBlobError(error: unknown): {
  kind: 'quota' | 'auth' | 'rate-limited' | 'too-large' | 'other';
  message: string;
} {
  const message = error instanceof Error ? error.message : String(error);
  if (error instanceof BlobStoreSuspendedError) {
    return {
      kind: 'quota',
      message: 'The Blob store is suspended (free-tier usage limit reached).',
    };
  }
  if (isPrivateStoreError(error)) {
    return {
      kind: 'auth',
      message: 'The Blob store is private; photo writes must use private access.',
    };
  }
  if (error instanceof BlobAccessError) {
    return { kind: 'auth', message: 'Vercel Blob rejected the write (check the store token).' };
  }
  if (error instanceof BlobServiceRateLimited) {
    return {
      kind: 'rate-limited',
      message: `Vercel Blob rate limited the request (retry in ${error.retryAfter}s).`,
    };
  }
  if (error instanceof BlobError && /too large/i.test(message)) {
    return { kind: 'too-large', message };
  }
  if (/quota|exceeded|limit reached|suspended|insufficient/i.test(message)) {
    return { kind: 'quota', message };
  }
  return { kind: 'other', message };
}

export async function recordAdvancedOps(db: Db, count: number, bytes = 0): Promise<void> {
  if (count <= 0 && bytes <= 0) return;
  await db.run(
    `INSERT INTO storage_usage (month, advanced_ops, simple_ops, bytes_uploaded, bytes_pruned, updated_at)
     VALUES (?, ?, 0, ?, 0, ?)
     ON CONFLICT(month) DO UPDATE SET
       advanced_ops = advanced_ops + excluded.advanced_ops,
       bytes_uploaded = bytes_uploaded + excluded.bytes_uploaded,
       updated_at = excluded.updated_at`,
    [currentMonth(), Math.max(0, count), Math.max(0, bytes), nowIso()],
  );
}

export async function recordSimpleOps(db: Db, count: number): Promise<void> {
  if (count <= 0) return;
  await db.run(
    `INSERT INTO storage_usage (month, advanced_ops, simple_ops, bytes_uploaded, bytes_pruned, updated_at)
     VALUES (?, 0, ?, 0, 0, ?)
     ON CONFLICT(month) DO UPDATE SET
       simple_ops = simple_ops + excluded.simple_ops,
       updated_at = excluded.updated_at`,
    [currentMonth(), count, nowIso()],
  );
}

export async function recordPrunedBytes(db: Db, bytes: number): Promise<void> {
  if (bytes <= 0) return;
  await db.run(
    `INSERT INTO storage_usage (month, advanced_ops, simple_ops, bytes_uploaded, bytes_pruned, updated_at)
     VALUES (?, 0, 0, 0, ?, ?)
     ON CONFLICT(month) DO UPDATE SET
       bytes_pruned = bytes_pruned + excluded.bytes_pruned,
       updated_at = excluded.updated_at`,
    [currentMonth(), bytes, nowIso()],
  );
}

interface SumRow {
  total: number | null;
  originals: number | null;
}

export async function getStorageUsage(db: Db, settings?: Settings): Promise<StorageUsage> {
  const policy = resolveStoragePolicy(settings ?? (await loadSettings(db)));

  const published = await db.get<SumRow>(
    `SELECT COALESCE(SUM(bytes), 0) AS total,
            COALESCE(SUM(CASE WHEN original_preserved = 1 THEN COALESCE(original_bytes, 0) ELSE 0 END), 0) AS originals
     FROM article_images`,
  );
  const pending = await db.get<SumRow>(
    `SELECT COALESCE(SUM(u.bytes), 0) AS total,
            COALESCE(SUM(CASE WHEN u.original_preserved = 1 THEN COALESCE(u.original_bytes, 0) ELSE 0 END), 0) AS originals
     FROM uploads u
     WHERE u.status != 'expired'
       AND u.id NOT IN (SELECT upload_id FROM article_images WHERE upload_id IS NOT NULL)`,
  );
  const counters = await db.get<{
    advanced_ops: number;
    simple_ops: number;
    bytes_uploaded: number;
    bytes_pruned: number;
  }>(
    `SELECT advanced_ops, simple_ops, bytes_uploaded, bytes_pruned FROM storage_usage WHERE month = ?`,
    [currentMonth()],
  );

  const publishedBytes = published?.total ?? 0;
  const pendingBytes = pending?.total ?? 0;
  const originalBytes = (published?.originals ?? 0) + (pending?.originals ?? 0);
  const total = publishedBytes + pendingBytes;

  const state = getStorageDegraded();
  const overStorage = total >= policy.softStorageBytes;
  const overOps = (counters?.advanced_ops ?? 0) >= policy.softAdvancedOps;
  const reason: StorageUsage['reason'] = state.active
    ? 'degraded'
    : overStorage
      ? 'storage'
      : overOps
        ? 'ops'
        : null;

  return {
    month: currentMonth(),
    bytes: {
      published: publishedBytes,
      pending: pendingBytes,
      originals: originalBytes,
      total,
    },
    ops: {
      advanced: counters?.advanced_ops ?? 0,
      simple: counters?.simple_ops ?? 0,
    },
    counters: {
      bytesUploaded: counters?.bytes_uploaded ?? 0,
      bytesPruned: counters?.bytes_pruned ?? 0,
    },
    plan: BLOB_HOBBY_PLAN,
    limits: { ...policy, retentionDays: policy.originalRetentionDays },
    headroom: {
      storageBytes: Math.max(0, policy.softStorageBytes - total),
      advancedOps: Math.max(0, policy.softAdvancedOps - (counters?.advanced_ops ?? 0)),
    },
    store: storageStatus(),
    exhausted: reason !== null,
    reason,
    degraded: state,
  };
}

export function storageBlockedMessage(reason: StorageUsage['reason']): string {
  if (reason === 'degraded') {
    return 'Photo storage is having a moment on our side. Your story still works without photos.';
  }
  if (reason === 'ops') {
    return 'The free photo quota for this month is spent. Your story still works without photos.';
  }
  return 'Photo storage is full for now. Your story still works without photos.';
}

/**
 * Gate for photo intake. Throws a 503 the submission form understands, so a
 * text-only story can still be filed when the free allowance is gone.
 */
export async function assertUploadsAllowed(db: Db, settings?: Settings): Promise<StorageUsage> {
  if (config.storage.mode === 'local') return getStorageUsage(db, settings);
  if (!config.storage.configured) {
    throw new AppError(
      503,
      'STORAGE_NOT_CONFIGURED',
      'Photo storage is not configured on the server yet. Stories without photos still work.',
    );
  }

  const usage = await getStorageUsage(db, settings);
  if (!usage.exhausted || !usage.limits.blockWhenFull) return usage;

  throw new AppError(
    503,
    usage.reason === 'degraded' ? STORAGE_DEGRADED_ERROR : STORAGE_QUOTA_ERROR,
    storageBlockedMessage(usage.reason),
  );
}
