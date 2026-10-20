import { del, get, put } from '@vercel/blob';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config.js';
import { serviceUnavailable } from '../lib/errors.js';

/**
 * Photo storage built on Vercel Blob (Hobby plan).
 *
 * Two stores can be involved:
 *  - the public store (`BLOB_READ_WRITE_TOKEN`) serves every photo the site
 *    renders, as optimized WebP plus a thumbnail;
 *  - an optional private store (`BLOB_PRIVATE_READ_WRITE_TOKEN`) keeps the
 *    untouched original upload, which may still carry EXIF/GPS metadata.
 *    Without that second token originals are kept in the public store under an
 *    unguessable random suffix instead - see `getOriginalsTarget()`.
 *
 * The Hobby allowance is 1 GB of storage, 2,000 advanced operations (uploads,
 * copies, lists) and 10 GB of transfer per month. Exceeding it locks the store
 * out for 30 days, so `storage-usage.ts` accounts for every operation and the
 * intake refuses photos before the allowance is gone. Deletes are free.
 */

export interface StoredObject {
  key: string;
  url: string;
  bytes: number;
  checksum: string;
  /** Which Blob store holds the object (originals may live in a private one). */
  store: 'public' | 'private' | 'local';
}

export interface PutOptions {
  contentType: string;
  /** Blob only: append a random suffix so the URL cannot be guessed. */
  addRandomSuffix?: boolean;
  cacheMaxAgeSeconds?: number;
}

export interface StorageDriver {
  readonly name: string;
  readonly store: StoredObject['store'];
  put(key: string, body: Buffer, options: PutOptions): Promise<StoredObject>;
  delete(key: string): Promise<void>;
  /** Reads an object back. `url` is required for Blob stores. */
  read(key: string, url?: string): Promise<Buffer>;
}

/** Where preserved originals go, and whether that place is private. */
export interface OriginalsTarget {
  driver: StorageDriver;
  access: 'private' | 'public';
  addRandomSuffix: boolean;
}

let testStorage: StorageDriver | null = null;
let testOriginals: OriginalsTarget | null = null;

/** Test seam: inject a fake driver instead of talking to Vercel Blob. */
export function setStorageForTests(
  driver: StorageDriver,
  originals: OriginalsTarget | null = null,
): void {
  testStorage = driver;
  testOriginals = originals;
}

export function resetStorageForTests(): void {
  testStorage = null;
  testOriginals = null;
}

class BlobDriver implements StorageDriver {
  readonly name: string;

  constructor(
    private readonly token: string,
    readonly store: 'public' | 'private',
  ) {
    this.name = `blob:${store}`;
  }

  async put(key: string, body: Buffer, options: PutOptions): Promise<StoredObject> {
    const result = await put(key, body, {
      access: this.store,
      token: this.token,
      contentType: options.contentType,
      addRandomSuffix: options.addRandomSuffix ?? false,
      allowOverwrite: true,
      cacheControlMaxAge: options.cacheMaxAgeSeconds ?? config.storage.cacheMaxAgeSeconds,
    });
    return {
      key: result.pathname,
      url: result.url,
      bytes: body.byteLength,
      checksum: createHash('sha256').update(body).digest('hex'),
      store: this.store,
    };
  }

  async delete(key: string): Promise<void> {
    try {
      await del(key, { token: this.token });
    } catch {
      /* deletion is best-effort: the row is marked pruned either way */
    }
  }

  async read(key: string, url?: string): Promise<Buffer> {
    const target = url ?? key;
    if (this.store === 'public') {
      // Public blobs are plain CDN URLs; a direct fetch needs no token.
      const response = await fetch(target, { signal: AbortSignal.timeout(20_000) });
      if (!response.ok) {
        throw new Error(`Failed to read stored photo (${response.status}).`);
      }
      return Buffer.from(await response.arrayBuffer());
    }

    const result = await get(target, {
      access: 'private',
      token: this.token,
      useCache: false,
    });
    if (!result || result.statusCode !== 200) {
      throw new Error('Stored original could not be read.');
    }
    return Buffer.from(await new Response(result.stream).arrayBuffer());
  }
}

class LocalDriver implements StorageDriver {
  readonly name = 'local';
  readonly store = 'local' as const;
  private readonly root = config.storage.localDir;

  private resolve(key: string): string {
    const safe = key
      .split('/')
      .filter((part) => part && part !== '.' && part !== '..')
      .join(path.sep);
    const full = path.resolve(this.root, safe);
    if (!full.startsWith(path.resolve(this.root))) {
      throw new Error('Invalid storage key.');
    }
    return full;
  }

  async put(key: string, body: Buffer, _options: PutOptions): Promise<StoredObject> {
    const full = this.resolve(key);
    if (!existsSync(path.dirname(full))) {
      await mkdir(path.dirname(full), { recursive: true });
    }
    await writeFile(full, body);
    return {
      key,
      url: `${config.apiPublicUrl}/media/${key.split('/').map(encodeURIComponent).join('/')}`,
      bytes: body.byteLength,
      checksum: createHash('sha256').update(body).digest('hex'),
      store: 'local',
    };
  }

  async delete(key: string): Promise<void> {
    try {
      await unlink(this.resolve(key));
    } catch {
      /* best effort */
    }
  }

  async read(key: string): Promise<Buffer> {
    return readFile(this.resolve(key));
  }
}

const blobDrivers = new Map<string, BlobDriver>();
const localDriver = new LocalDriver();

function blobDriver(token: string, store: 'public' | 'private'): BlobDriver {
  const cacheKey = `${store}:${token}`;
  let driver = blobDrivers.get(cacheKey);
  if (!driver) {
    driver = new BlobDriver(token, store);
    blobDrivers.set(cacheKey, driver);
  }
  return driver;
}

function requireBlobToken(): string {
  if (!config.storage.blobToken) {
    throw serviceUnavailable(
      'Photo storage is not configured. Set BLOB_READ_WRITE_TOKEN from your Vercel Blob store.',
      'STORAGE_NOT_CONFIGURED',
    );
  }
  return config.storage.blobToken;
}

/** The public store that serves every photo on the site. */
export function getStorage(): StorageDriver {
  if (testStorage) return testStorage;
  if (!config.storage.configured) {
    throw serviceUnavailable(
      'Photo storage is not configured. Set BLOB_READ_WRITE_TOKEN from your Vercel Blob store.',
      'STORAGE_NOT_CONFIGURED',
    );
  }
  if (config.storage.mode === 'local') return localDriver;
  return blobDriver(requireBlobToken(), 'public');
}

/**
 * Where a preserved original should be written, or `null` when no storage is
 * configured at all. A private store token keeps originals out of reach of
 * anyone without credentials; without it they still go somewhere unguessable.
 */
export function getOriginalsTarget(): OriginalsTarget | null {
  if (testOriginals) return testOriginals;
  if (testStorage) return { driver: testStorage, access: 'public', addRandomSuffix: false };
  if (!config.storage.configured) return null;
  if (config.storage.originalsToken) {
    return {
      driver: blobDriver(config.storage.originalsToken, 'private'),
      access: 'private',
      addRandomSuffix: false,
    };
  }
  if (config.storage.mode === 'local') {
    return { driver: localDriver, access: 'public', addRandomSuffix: false };
  }
  return {
    driver: blobDriver(requireBlobToken(), 'public'),
    access: 'public',
    addRandomSuffix: true,
  };
}

export function storageReady(): boolean {
  return testStorage !== null || config.storage.configured;
}

/**
 * Resolve a driver for an object that was written earlier. Old rows may point
 * at a store that is no longer the default (e.g. originals moved from the
 * public store to a private one), so the recorded `store` decides.
 */
function driverFor(store: StoredObject['store']): StorageDriver | null {
  if (store === 'private' && testOriginals) return testOriginals.driver;
  if (testStorage) return testStorage;
  if (store === 'private') {
    return config.storage.originalsToken
      ? blobDriver(config.storage.originalsToken, 'private')
      : null;
  }
  if (!config.storage.configured) return null;
  if (config.storage.mode === 'local') return localDriver;
  return config.storage.blobToken ? blobDriver(config.storage.blobToken, 'public') : null;
}

export function asStore(value: string | null | undefined): StoredObject['store'] | null {
  return value === 'public' || value === 'private' || value === 'local' ? value : null;
}

/** Delete one object from the store it actually lives in. Best effort. */
export async function deleteObject(
  key: string | null,
  store: StoredObject['store'] | null,
): Promise<void> {
  if (!key || !store) return;
  const driver = driverFor(store);
  if (!driver) return;
  await driver.delete(key);
}

/** Read one object back from the store it actually lives in. */
export async function readObject(
  key: string,
  url: string | null,
  store: StoredObject['store'] | null,
): Promise<Buffer> {
  const driver = driverFor(store ?? 'public');
  if (!driver) {
    throw serviceUnavailable('That photo is no longer in storage.', 'STORAGE_OBJECT_GONE');
  }
  return driver.read(key, url ?? undefined);
}

export interface StorageStatus {
  ready: boolean;
  mode: 'blob' | 'local';
  /** Where originals can be kept: a private store, the public store, or nowhere. */
  originals: 'private' | 'public' | 'none';
}

export function storageStatus(): StorageStatus {
  if (testStorage) {
    return { ready: true, mode: 'local', originals: testOriginals ? 'private' : 'public' };
  }
  return {
    ready: config.storage.configured,
    mode: config.storage.mode,
    originals: !config.storage.configured
      ? 'none'
      : config.storage.originalsToken
        ? 'private'
        : 'public',
  };
}

export function buildStorageKey(parts: {
  scope: 'uploads' | 'articles';
  date: Date;
  submissionId: string;
  imageId: string;
  variant: 'full' | 'thumb' | 'original';
  /** Required for `original`, which keeps the upload's own format. */
  extension?: string;
}): string {
  const year = parts.date.getUTCFullYear();
  const month = String(parts.date.getUTCMonth() + 1).padStart(2, '0');
  const extension =
    parts.variant === 'original' ? (parts.extension ?? 'bin') : (parts.extension ?? 'webp');
  const folder = parts.variant === 'original' ? 'originals' : 'photos';
  return `${parts.scope}/${folder}/${year}/${month}/${parts.submissionId}/${parts.imageId}-${parts.variant}.${extension}`;
}
