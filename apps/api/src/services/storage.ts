import { del, get, put } from '@vercel/blob';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config.js';
import { serviceUnavailable } from '../lib/errors.js';
import { logger } from '../lib/logger.js';

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

/** Blob's exact wording when a store was created with private access. */
const PRIVATE_STORE_REJECTION = /public access on a private store/i;

/**
 * True when Blob refused a write because the store itself is private. A store's
 * access mode is fixed when it is created, so a token for a private store in
 * `BLOB_READ_WRITE_TOKEN` can never accept public writes.
 */
export function isPrivateStoreError(error: unknown): boolean {
  return error instanceof Error && PRIVATE_STORE_REJECTION.test(error.message);
}

/** URL this API serves an object from, for stores that are not public. */
export function mediaObjectUrl(key: string): string {
  const base = config.apiPublicUrl.replace(/\/+$/, '');
  return `${base}/media/${key.split('/').map(encodeURIComponent).join('/')}`;
}

export class BlobDriver implements StorageDriver {
  private access: 'public' | 'private';

  constructor(
    private readonly token: string,
    store: 'public' | 'private',
  ) {
    this.access = store;
  }

  get name(): string {
    return `blob:${this.access}`;
  }

  get store(): 'public' | 'private' {
    return this.access;
  }

  async put(key: string, body: Buffer, options: PutOptions): Promise<StoredObject> {
    try {
      return await this.write(key, body, options);
    } catch (error) {
      // `BLOB_READ_WRITE_TOKEN` is normally a public store, but pointing it at a
      // private one is a legal setup. Adopt the store's real access mode instead
      // of failing every photo upload, and serve the photos through the media
      // proxy (a private Blob URL cannot be loaded by a browser).
      //
      // An upload writes the full image and the thumbnail concurrently, so the
      // first rejection can flip the access mode while a sibling write is still
      // in flight. Retry on the rejection itself rather than on the current mode,
      // otherwise the losing write rethrows and the whole upload fails.
      if (!isPrivateStoreError(error)) throw error;
      const adopting = this.access !== 'private';
      this.access = 'private';
      if (adopting) {
        logger.warn(
          { key, store: 'private' },
          'Blob store is private; writing photos with private access and serving them through /media',
        );
      }
      return this.write(key, body, options);
    }
  }

  private async write(key: string, body: Buffer, options: PutOptions): Promise<StoredObject> {
    const result = await put(key, body, {
      access: this.access,
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
      store: this.access,
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
      url: mediaObjectUrl(key),
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
    // Photos live in the private store too when `BLOB_READ_WRITE_TOKEN` points
    // at one, so fall back to the primary token before giving up.
    const token = config.storage.originalsToken ?? config.storage.blobToken;
    return token ? blobDriver(token, 'private') : null;
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
  /**
   * How photos are actually reached. `private` means the store rejected public
   * writes and the API serves the bytes from `/media`; `none` means no store.
   */
  photos: 'public' | 'private' | 'local' | 'none';
}

export function storageStatus(): StorageStatus {
  if (testStorage) {
    return {
      ready: true,
      mode: 'local',
      originals: testOriginals ? 'private' : 'public',
      photos: testStorage.store,
    };
  }
  return {
    ready: config.storage.configured,
    mode: config.storage.mode,
    originals: !config.storage.configured
      ? 'none'
      : config.storage.originalsToken
        ? 'private'
        : 'public',
    photos: photoAccess(),
  };
}

function photoAccess(): StorageStatus['photos'] {
  if (!config.storage.configured) return 'none';
  if (config.storage.mode === 'local') return 'local';
  return config.storage.blobToken ? blobDriver(config.storage.blobToken, 'public').store : 'none';
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
