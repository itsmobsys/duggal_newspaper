import {
  createClient,
  type Client,
  type InArgs,
  type InStatement,
  type ResultSet,
} from '@libsql/client';
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';

export type RowRecord = Record<string, unknown>;

export interface TxApi {
  all<T = RowRecord>(sql: string, args?: InArgs): Promise<T[]>;
  get<T = RowRecord>(sql: string, args?: InArgs): Promise<T | undefined>;
  run(sql: string, args?: InArgs): Promise<ResultSet>;
}

export interface Db extends TxApi {
  batch(statements: InStatement[]): Promise<ResultSet[]>;
  transaction<T>(fn: (tx: TxApi) => Promise<T>): Promise<T>;
  client: Client;
  url: string;
}

/**
 * Resolve a `file:` URL relative to the current package directory so that
 * `apps/api` and `apps/web` can share the same local SQLite database.
 */
export function resolveDatabaseUrl(rawUrl: string): string {
  if (!rawUrl.startsWith('file:')) return rawUrl;
  const rawPath = rawUrl.slice('file:'.length);
  if (path.isAbsolute(rawPath)) {
    return `file:${rawPath.replace(/\\/g, '/')}`;
  }
  const absolute = path.resolve(process.cwd(), rawPath);
  const dir = path.dirname(absolute);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return `file:${absolute.replace(/\\/g, '/')}`;
}

function rowsToObjects<T>(result: ResultSet): T[] {
  const columns = result.columns;
  return result.rows.map((row) => {
    const record: RowRecord = {};
    for (let index = 0; index < columns.length; index += 1) {
      record[columns[index]!] = row[index];
    }
    return record as T;
  });
}

function createTxApi(executor: { execute: (stmt: InStatement) => Promise<ResultSet> }): TxApi {
  return {
    async all<T = RowRecord>(sql: string, args: InArgs = []): Promise<T[]> {
      return rowsToObjects<T>(await executor.execute({ sql, args }));
    },
    async get<T = RowRecord>(sql: string, args: InArgs = []): Promise<T | undefined> {
      const rows = rowsToObjects<T>(await executor.execute({ sql, args }));
      return rows[0];
    },
    async run(sql: string, args: InArgs = []): Promise<ResultSet> {
      return executor.execute({ sql, args });
    },
  };
}

export interface CreateDbOptions {
  url?: string;
  authToken?: string;
}

export function createDb(options: CreateDbOptions = {}): Db {
  const url = resolveDatabaseUrl(options.url ?? config.db.url);
  if (url.startsWith('file:')) {
    const dir = path.dirname(url.slice('file:'.length));
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  }
  const client = createClient({
    url,
    authToken: options.authToken ?? config.db.authToken,
  });

  let ready: Promise<void> | null = null;
  const ensureReady = (): Promise<void> => {
    if (!ready) {
      ready = (async () => {
        if (url.startsWith('file:')) {
          await client.execute('PRAGMA journal_mode = WAL');
          await client.execute('PRAGMA foreign_keys = ON');
          await client.execute('PRAGMA busy_timeout = 8000');
          await client.execute('PRAGMA synchronous = NORMAL');
        } else {
          // Remote Turso: foreign_keys is a per-connection setting but Turso
          // enforces it by default; keep the call cheap and best-effort.
          try {
            await client.execute('PRAGMA foreign_keys = ON');
          } catch {
            /* ignore */
          }
        }
      })();
    }
    return ready;
  };

  const serial: TxApi = {
    async all<T = RowRecord>(sql: string, args: InArgs = []): Promise<T[]> {
      await ensureReady();
      return rowsToObjects<T>(await client.execute({ sql, args }));
    },
    async get<T = RowRecord>(sql: string, args: InArgs = []): Promise<T | undefined> {
      await ensureReady();
      const rows = rowsToObjects<T>(await client.execute({ sql, args }));
      return rows[0];
    },
    async run(sql: string, args: InArgs = []): Promise<ResultSet> {
      await ensureReady();
      return client.execute({ sql, args });
    },
  };

  return {
    ...serial,
    client,
    url,
    async batch(statements: InStatement[]): Promise<ResultSet[]> {
      await ensureReady();
      return client.batch(statements);
    },
    async transaction<T>(fn: (tx: TxApi) => Promise<T>): Promise<T> {
      await ensureReady();
      const tx = await client.transaction('write');
      try {
        const result = await fn(createTxApi(tx));
        await tx.commit();
        return result;
      } catch (error) {
        try {
          await tx.rollback();
        } catch {
          /* rollback best-effort */
        }
        throw error;
      }
    },
  };
}

let singleton: Db | null = null;

export function getDb(): Db {
  if (!singleton) singleton = createDb();
  return singleton;
}

export async function closeDb(): Promise<void> {
  if (singleton) {
    singleton.client.close();
    singleton = null;
  }
}
