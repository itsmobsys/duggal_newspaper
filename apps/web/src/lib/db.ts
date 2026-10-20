import { existsSync } from 'node:fs';
import path from 'node:path';
import { createClient, type Client, type InValue } from '@libsql/client';

/**
 * Read-only Turso client for the website.
 *
 * Public pages read the database directly instead of round-tripping through the
 * Render API: Render's free tier cold-starts, and a cold start on every page
 * view would be a terrible reading experience.
 */

let client: Client | null = null;

/** Resolve a `file:` URL the same way the API does, from any working directory. */
export function resolveDatabaseUrl(url: string): string {
  if (!url.startsWith('file:')) return url;
  const raw = url.slice('file:'.length).replace(/^\/{2,}/, '');
  if (/^[A-Za-z]:[\\/]/.test(raw) || raw.startsWith('/')) return `file:${raw}`;

  const candidates = [
    path.resolve(process.cwd(), raw),
    path.resolve(process.cwd(), '..', raw),
    path.resolve(process.cwd(), '..', '..', raw),
  ];
  const found = candidates.find((candidate) => existsSync(candidate)) ?? candidates[0]!;
  return `file:${found.replace(/\\/g, '/')}`;
}

export function getDb(): Client {
  if (client) return client;
  const url = process.env.TURSO_DATABASE_URL ?? 'file:../../data/duggal.db';
  const authToken = process.env.TURSO_AUTH_TOKEN || undefined;
  client = createClient({
    url: resolveDatabaseUrl(url),
    ...(authToken ? { authToken } : {}),
  });
  return client;
}

export type QueryArg = string | number | boolean | null;

export async function query<T>(sql: string, args: QueryArg[] = []): Promise<T[]> {
  const result = await getDb().execute({ sql, args: args as InValue[] });
  return result.rows as unknown as T[];
}

export async function queryOne<T>(sql: string, args: QueryArg[] = []): Promise<T | null> {
  const rows = await query<T>(sql, args);
  return rows[0] ?? null;
}

/**
 * Never let a database hiccup take the newspaper offline. Public pages fall
 * back to an empty page (which still renders the masthead) and log the failure.
 */
export async function safeQuery<T>(sql: string, args: QueryArg[] = []): Promise<T[]> {
  try {
    return await query<T>(sql, args);
  } catch (error) {
    console.error(
      '[db] query failed:',
      error instanceof Error ? error.message : String(error),
      sql.slice(0, 120),
    );
    return [];
  }
}

export async function safeQueryOne<T>(sql: string, args: QueryArg[] = []): Promise<T | null> {
  const rows = await safeQuery<T>(sql, args);
  return rows[0] ?? null;
}
