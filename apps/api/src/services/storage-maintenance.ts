import type { Db } from '../db/client.js';
import { config } from '../config.js';
import type { Logger } from '../lib/logger.js';
import { nowIso } from '../lib/time.js';
import { getStorageUsage, recordPrunedBytes } from './storage-usage.js';
import { deleteObject, type StoredObject } from './storage.js';

/**
 * Pruning preserved originals.
 *
 * Optimized WebP derivatives are tiny; untouched originals are not. On a free
 * 1 GB store, keeping every 8 MB phone photo forever would fill the allowance
 * in a couple of months. This job removes originals that outlived
 * `storage.original_retention_days`, and - if the store is at the soft limit -
 * the oldest remaining ones until there is headroom again. Published photos
 * themselves are never deleted here; only the "as filed" copy is.
 */

export interface PruneResult {
  reason: 'retention' | 'capacity' | 'none';
  pruned: number;
  bytesFreed: number;
  remainingOriginals: number;
}

interface OriginalRow {
  id: string;
  upload_id: string | null;
  storage_key: string;
  original_key: string;
  original_url: string | null;
  original_store: string | null;
  original_bytes: number | null;
}

export async function pruneOriginals(
  db: Db,
  log: Logger,
  options: { force?: boolean; limit?: number } = {},
): Promise<PruneResult> {
  const limit = Math.min(Math.max(options.limit ?? 25, 1), 100);
  if (!config.storage.configured) {
    return { reason: 'none', pruned: 0, bytesFreed: 0, remainingOriginals: 0 };
  }

  const usage = await getStorageUsage(db);
  const staleCutoff = new Date(
    Date.now() - usage.limits.retentionDays * 24 * 60 * 60 * 1000,
  ).toISOString();
  const overCapacity = options.force === true || usage.bytes.total >= usage.limits.softStorageBytes;

  const byRetention = await db.all<OriginalRow>(
    `SELECT id, upload_id, storage_key, original_key, original_url, original_store, original_bytes
     FROM article_images
     WHERE original_preserved = 1 AND original_key IS NOT NULL AND created_at < ?
     ORDER BY created_at ASC LIMIT ?`,
    [staleCutoff, limit],
  );

  let reason: PruneResult['reason'] = byRetention.length > 0 ? 'retention' : 'none';
  let candidates = byRetention;

  if (candidates.length === 0 && overCapacity) {
    candidates = await db.all<OriginalRow>(
      `SELECT id, upload_id, storage_key, original_key, original_url, original_store, original_bytes
       FROM article_images
       WHERE original_preserved = 1 AND original_key IS NOT NULL
       ORDER BY created_at ASC LIMIT ?`,
      [limit],
    );
    if (candidates.length > 0) reason = 'capacity';
  }

  let bytesFreed = 0;
  let pruned = 0;
  const now = nowIso();

  for (const row of candidates) {
    const store = (row.original_store as StoredObject['store'] | null) ?? null;
    try {
      await deleteObject(row.original_key, store);
    } catch (error) {
      log.warn(
        { imageId: row.id, error: error instanceof Error ? error.message : String(error) },
        'could not delete preserved original; will retry on the next maintenance tick',
      );
      continue;
    }

    await db.run(
      `UPDATE article_images SET original_preserved = 0, original_pruned_at = ? WHERE id = ?`,
      [now, row.id],
    );
    // Keep the uploads + submission mirrors truthful: the file is gone.
    await db.run(
      `UPDATE uploads SET original_preserved = 0, original_pruned_at = ?
       WHERE id = ? OR storage_key = ?`,
      [now, row.upload_id, row.storage_key],
    );
    await db.run(
      `UPDATE submission_images SET original_preserved = 0, original_pruned_at = ?
       WHERE storage_key = ?`,
      [now, row.storage_key],
    );

    pruned += 1;
    bytesFreed += row.original_bytes ?? 0;
  }

  if (bytesFreed > 0) await recordPrunedBytes(db, bytesFreed);

  const remaining = await db.get<{ count: number }>(
    `SELECT COUNT(*) AS count FROM article_images WHERE original_preserved = 1`,
  );

  if (pruned > 0) {
    log.info(
      { reason, pruned, bytesFreed, remaining: remaining?.count ?? 0 },
      'pruned preserved originals',
    );
  }

  return {
    reason,
    pruned,
    bytesFreed,
    remainingOriginals: remaining?.count ?? 0,
  };
}
