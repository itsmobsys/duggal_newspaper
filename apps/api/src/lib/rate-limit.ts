import type { Db } from '../db/client.js';

export interface RateLimitResult {
  allowed: boolean;
  count: number;
  limit: number;
  remaining: number;
  resetAt: string;
  retryAfterSeconds: number;
}

/**
 * Durable fixed-window rate limiter. Works across restarts and instances
 * because the counter lives in Turso, not in process memory.
 */
export async function consumeRateLimit(
  db: Db,
  key: string,
  limit: number,
  windowSeconds: number,
): Promise<RateLimitResult> {
  const nowMs = Date.now();
  const windowMs = windowSeconds * 1000;
  const windowStart = Math.floor(nowMs / windowMs) * windowMs;
  const expiresAt = windowStart + windowMs;
  const resetAt = new Date(expiresAt).toISOString();

  const row = await db.get<{ count: number }>(
    `INSERT INTO rate_limits (key, window_start, count, expires_at)
     VALUES (?, ?, 1, ?)
     ON CONFLICT(key) DO UPDATE SET
       count = CASE WHEN rate_limits.window_start = excluded.window_start
                    THEN rate_limits.count + 1 ELSE 1 END,
       window_start = excluded.window_start,
       expires_at = excluded.expires_at
     RETURNING count`,
    [key, windowStart, expiresAt],
  );

  const count = Number(row?.count ?? 1);
  return {
    allowed: count <= limit,
    count,
    limit,
    remaining: Math.max(0, limit - count),
    resetAt,
    retryAfterSeconds: Math.max(1, Math.ceil((expiresAt - nowMs) / 1000)),
  };
}

let lastCleanup = 0;

export async function cleanupRateLimits(db: Db): Promise<void> {
  const now = Date.now();
  if (now - lastCleanup < 10 * 60 * 1000) return;
  lastCleanup = now;
  await db.run('DELETE FROM rate_limits WHERE expires_at < ?', [now]);
}
