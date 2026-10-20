import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from '../src/db/client.js';
import { runMigrations } from '../src/db/migrate.js';
import { AppError } from '../src/lib/errors.js';
import { logger } from '../src/lib/logger.js';
import { nowIso } from '../src/lib/time.js';
import {
  buildStorageKey,
  isPrivateStoreError,
  resetStorageForTests,
  setStorageForTests,
  storageStatus,
  type OriginalsTarget,
  type PutOptions,
  type StorageDriver,
  type StoredObject,
} from '../src/services/storage.js';
import {
  classifyBlobError,
  clearStorageDegraded,
  getStorageDegraded,
  getStorageUsage,
  recordAdvancedOps,
} from '../src/services/storage-usage.js';
import { pruneOriginals } from '../src/services/storage-maintenance.js';
import { createUploadTickets, storeUpload } from '../src/services/uploads.js';

/** In-memory stand-in for Vercel Blob: records writes, can fail on demand. */
class FakeDriver implements StorageDriver {
  readonly name = 'fake';
  store: StoredObject['store'];
  readonly puts: Array<{ key: string; bytes: number; contentType: string }> = [];
  readonly deletes: string[] = [];
  failOn: ((key: string) => Error | null) | null = null;

  constructor(store: StoredObject['store'] = 'public') {
    this.store = store;
  }

  async put(key: string, body: Buffer, options: PutOptions): Promise<StoredObject> {
    const failure = this.failOn?.(key);
    if (failure) throw failure;
    this.puts.push({ key, bytes: body.byteLength, contentType: options.contentType });
    return {
      key,
      url: `https://blob.test/${key}`,
      bytes: body.byteLength,
      checksum: 'fake-checksum',
      store: this.store,
    };
  }

  async delete(key: string): Promise<void> {
    this.deletes.push(key);
  }

  async read(): Promise<Buffer> {
    return Buffer.from('fake');
  }
}

let dir: string;
let db: Db;
let publicStore: FakeDriver;
let privateStore: FakeDriver;

function originalsTarget(driver: FakeDriver): OriginalsTarget {
  return { driver, access: 'private', addRandomSuffix: false };
}

beforeAll(async () => {
  dir = mkdtempSync(path.join(tmpdir(), 'dbd-storage-'));
  db = createDb({ url: `file:${path.join(dir, 'test.db')}` });
  await runMigrations(db);
});

afterAll(() => {
  resetStorageForTests();
  db.client.close();
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    // Windows can hold SQLite handles briefly; the OS temp cleaner handles it.
  }
});

beforeEach(async () => {
  await db.run('DELETE FROM article_images');
  await db.run('DELETE FROM articles');
  await db.run('DELETE FROM uploads');
  await db.run('DELETE FROM storage_usage');
  await db.run('DELETE FROM audit_logs');
  clearStorageDegraded();

  publicStore = new FakeDriver('public');
  privateStore = new FakeDriver('private');
  setStorageForTests(publicStore, originalsTarget(privateStore));
});

async function jpegFixture(): Promise<Buffer> {
  return sharp({
    create: { width: 200, height: 150, channels: 3, background: { r: 180, g: 20, b: 20 } },
  })
    .jpeg({ quality: 80 })
    .toBuffer();
}

async function ticketFor(size: number): Promise<{ uploadId: string; token: string }> {
  const tickets = await createUploadTickets(db, {
    files: [{ name: 'photo.jpg', type: 'image/jpeg', size }],
    ipHash: 'ip-test',
  });
  const ticket = tickets[0];
  if (!ticket) throw new Error('no ticket created');
  return { uploadId: ticket.uploadId, token: ticket.token };
}

describe('buildStorageKey', () => {
  it('keeps derivatives and originals in separate, date-partitioned folders', () => {
    const date = new Date('2026-03-04T10:00:00Z');
    expect(
      buildStorageKey({
        scope: 'uploads',
        date,
        submissionId: 'upl_1',
        imageId: 'upl_1',
        variant: 'full',
      }),
    ).toBe('uploads/photos/2026/03/upl_1/upl_1-full.webp');

    expect(
      buildStorageKey({
        scope: 'uploads',
        date,
        submissionId: 'upl_1',
        imageId: 'upl_1',
        variant: 'original',
        extension: 'jpg',
      }),
    ).toBe('uploads/originals/2026/03/upl_1/upl_1-original.jpg');
  });
});

describe('storeUpload', () => {
  it('writes optimised full, thumb and the untouched original', async () => {
    const jpeg = await jpegFixture();
    const ticket = await ticketFor(jpeg.byteLength);

    const stored = await storeUpload(db, {
      uploadId: ticket.uploadId,
      token: ticket.token,
      buffer: jpeg,
      contentType: 'image/jpeg',
      ipHash: 'ip-test',
    });

    expect(publicStore.puts).toHaveLength(2);
    expect(privateStore.puts).toHaveLength(1);
    expect(publicStore.puts.map((write) => write.contentType)).toEqual([
      'image/webp',
      'image/webp',
    ]);

    const original = privateStore.puts[0];
    expect(original?.contentType).toBe('image/jpeg');
    expect(original?.key).toContain('originals');
    expect(original?.bytes).toBe(jpeg.byteLength);

    const row = await db.get<{
      status: string;
      original_preserved: number;
      original_key: string;
      original_store: string;
      original_bytes: number;
      url: string;
    }>(
      'SELECT status, original_preserved, original_key, original_store, original_bytes, url FROM uploads WHERE id = ?',
      [ticket.uploadId],
    );
    expect(row?.status).toBe('stored');
    expect(row?.original_preserved).toBe(1);
    expect(row?.original_store).toBe('private');
    expect(row?.original_bytes).toBe(jpeg.byteLength);
    expect(row?.original_key).toBe(original?.key);
    expect(stored.url).toMatch(/^https:\/\/blob\.test\//);

    const usage = await getStorageUsage(db);
    // Two derivatives + one original = three advanced (put) operations.
    expect(usage.ops.advanced).toBe(3);
    expect(usage.counters.bytesUploaded).toBeGreaterThan(0);
    expect(usage.exhausted).toBe(false);
  });

  it('keeps the upload when only the original fails', async () => {
    const jpeg = await jpegFixture();
    const ticket = await ticketFor(jpeg.byteLength);
    privateStore.failOn = (key) =>
      key.includes('originals') ? new Error('origin store offline') : null;

    await expect(
      storeUpload(db, {
        uploadId: ticket.uploadId,
        token: ticket.token,
        buffer: jpeg,
        contentType: 'image/jpeg',
        ipHash: 'ip-test',
      }),
    ).resolves.toBeTruthy();

    const row = await db.get<{ status: string; original_preserved: number }>(
      'SELECT status, original_preserved FROM uploads WHERE id = ?',
      [ticket.uploadId],
    );
    expect(row?.status).toBe('stored');
    expect(row?.original_preserved).toBe(0);

    const usage = await getStorageUsage(db);
    expect(usage.ops.advanced).toBe(2);
    // A generic original failure is not a quota problem: intake stays open.
    expect(getStorageDegraded().active).toBe(false);
  });

  it('refuses photos with a text-only-friendly error when Blob quota is gone', async () => {
    const jpeg = await jpegFixture();
    const ticket = await ticketFor(jpeg.byteLength);
    publicStore.failOn = () => new Error('Vercel Blob: quota exceeded for this store');

    let caught: unknown = null;
    try {
      await storeUpload(db, {
        uploadId: ticket.uploadId,
        token: ticket.token,
        buffer: jpeg,
        contentType: 'image/jpeg',
        ipHash: 'ip-test',
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(AppError);
    expect((caught as AppError).statusCode).toBe(503);
    expect((caught as AppError).code).toBe('STORAGE_QUOTA_EXHAUSTED');
    expect((caught as AppError).message).toMatch(/without photos/i);
    expect(getStorageDegraded().active).toBe(true);

    const row = await db.get<{ status: string }>('SELECT status FROM uploads WHERE id = ?', [
      ticket.uploadId,
    ]);
    expect(row?.status).toBe('pending');
  });

  it('returns CDN URLs when the store is public', async () => {
    const jpeg = await jpegFixture();
    const ticket = await ticketFor(jpeg.byteLength);

    const result = await storeUpload(db, {
      uploadId: ticket.uploadId,
      token: ticket.token,
      buffer: jpeg,
      contentType: 'image/jpeg',
      ipHash: 'ip-test',
    });

    expect(result.url).toMatch(/^https:\/\/blob\.test\/uploads\/photos\//);
    expect(result.thumbUrl).toMatch(/-thumb\.webp$/);
  });

  it('serves photos through /media when the store only accepts private writes', async () => {
    const jpeg = await jpegFixture();
    const ticket = await ticketFor(jpeg.byteLength);

    // A private store cannot hand the browser a usable Blob URL, so the API has
    // to proxy the bytes instead of returning a link that will 401/502.
    setStorageForTests(privateStore);

    const result = await storeUpload(db, {
      uploadId: ticket.uploadId,
      token: ticket.token,
      buffer: jpeg,
      contentType: 'image/jpeg',
      ipHash: 'ip-test',
    });

    expect(result.url).toMatch(/\/media\/uploads\/photos\/.*\.webp$/);
    expect(result.thumbUrl).toMatch(/\/media\/uploads\/photos\/.*-thumb\.webp$/);
    expect(result.url).not.toContain('/public/uploads/');

    const row = await db.get<{ url: string; thumb_url: string }>(
      'SELECT url, thumb_url FROM uploads WHERE id = ?',
      [ticket.uploadId],
    );
    expect(row?.url).toBe(result.url);
    expect(row?.thumb_url).toBe(result.thumbUrl);
  });

  it('reports photo access so diagnostics can show whether /media is proxying', () => {
    expect(storageStatus().photos).toBe('public');
    setStorageForTests(privateStore);
    expect(storageStatus().photos).toBe('private');
    expect(storageStatus().originals).toBe('public');
  });
});

describe('classifyBlobError', () => {
  it('separates quota and auth from ordinary failures', () => {
    expect(classifyBlobError(new Error('quota exceeded')).kind).toBe('quota');
    expect(classifyBlobError(new Error('This store has been suspended')).kind).toBe('quota');
    expect(classifyBlobError(new Error('forbidden')).kind).toBe('other');
  });

  it('recognises a private store rejection and explains it instead of a generic 502', () => {
    const error = new Error(
      'Vercel Blob: Cannot use public access on a private store. The store is configured with private access.',
    );
    expect(isPrivateStoreError(error)).toBe(true);
    expect(isPrivateStoreError(new Error('quota exceeded'))).toBe(false);
    expect(classifyBlobError(error)).toEqual({
      kind: 'auth',
      message: 'The Blob store is private; photo writes must use private access.',
    });
  });
});

describe('storage usage', () => {
  it('marks uploads exhausted once the advanced-op budget is spent', async () => {
    await recordAdvancedOps(db, 1_700, 1024);
    const usage = await getStorageUsage(db);
    expect(usage.exhausted).toBe(true);
    expect(usage.reason).toBe('ops');
    expect(usage.headroom.advancedOps).toBe(0);
  });

  it('reports the months operations and bytes', async () => {
    await recordAdvancedOps(db, 3, 4096);
    const usage = await getStorageUsage(db);
    expect(usage.ops.advanced).toBe(3);
    expect(usage.counters.bytesUploaded).toBe(4096);
    expect(usage.bytes.total).toBe(0);
  });
});

async function insertArticleWithOriginal(input: {
  imageId: string;
  originalKey: string;
  originalBytes: number;
  createdAt: string;
}): Promise<void> {
  const articleId = `art_${input.imageId}`;
  const now = nowIso();
  await db.run(
    `INSERT INTO articles (id, slug, headline, body, author_display, edition_date, created_at, updated_at)
     VALUES (?, ?, 'Test', 'Body', 'Tester', '2026-10-20', ?, ?)`,
    [articleId, `slug-${input.imageId}`, now, now],
  );
  await db.run(
    `INSERT INTO article_images
       (id, article_id, storage_key, url, mime, bytes, created_at,
        original_key, original_url, original_bytes, original_mime, original_store, original_preserved)
     VALUES (?, ?, ?, ?, 'image/webp', 100, ?, ?, ?, ?, 'image/jpeg', 'private', 1)`,
    [
      input.imageId,
      articleId,
      `articles/photos/${input.imageId}.webp`,
      `https://blob.test/${input.imageId}.webp`,
      input.createdAt,
      input.originalKey,
      `https://blob.test/${input.originalKey}`,
      input.originalBytes,
    ],
  );
}

describe('pruneOriginals', () => {
  it('deletes originals past the retention window and frees the bytes', async () => {
    await insertArticleWithOriginal({
      imageId: 'img_old',
      originalKey: 'articles/originals/old.jpg',
      originalBytes: 700,
      createdAt: '2020-01-01T00:00:00.000Z',
    });

    const result = await pruneOriginals(db, logger, { limit: 10 });

    expect(result.reason).toBe('retention');
    expect(result.pruned).toBe(1);
    expect(result.bytesFreed).toBe(700);
    expect(privateStore.deletes).toEqual(['articles/originals/old.jpg']);

    const row = await db.get<{ original_preserved: number; original_pruned_at: string }>(
      'SELECT original_preserved, original_pruned_at FROM article_images WHERE id = ?',
      ['img_old'],
    );
    expect(row?.original_preserved).toBe(0);
    expect(row?.original_pruned_at).toBeTruthy();

    // The rendered photo itself is never touched.
    expect(publicStore.deletes).toEqual([]);

    const usage = await getStorageUsage(db);
    expect(usage.counters.bytesPruned).toBe(700);
  });

  it('trims oldest-first when forced, even inside the retention window', async () => {
    await insertArticleWithOriginal({
      imageId: 'img_fresh',
      originalKey: 'articles/originals/fresh.jpg',
      originalBytes: 300,
      createdAt: nowIso(),
    });

    const result = await pruneOriginals(db, logger, { force: true, limit: 10 });

    expect(result.reason).toBe('capacity');
    expect(result.pruned).toBe(1);
    expect(privateStore.deletes).toEqual(['articles/originals/fresh.jpg']);
  });
});
