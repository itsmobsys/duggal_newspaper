import { DeleteObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config.js';
import { serviceUnavailable } from '../lib/errors.js';

export interface StoredObject {
  key: string;
  url: string;
  bytes: number;
  checksum: string;
}

export interface StorageDriver {
  readonly name: string;
  put(key: string, body: Buffer, contentType: string, cacheControl?: string): Promise<StoredObject>;
  delete(key: string): Promise<void>;
  urlFor(key: string): string;
  read(key: string): Promise<Buffer>;
}

let s3Client: S3Client | null = null;

function getS3Client(): S3Client {
  if (!config.storage.endpoint || !config.storage.accessKeyId || !config.storage.secretAccessKey) {
    throw serviceUnavailable('Object storage is not configured.', 'STORAGE_NOT_CONFIGURED');
  }
  if (!s3Client) {
    s3Client = new S3Client({
      region: config.storage.region,
      endpoint: config.storage.endpoint,
      forcePathStyle: config.storage.forcePathStyle,
      credentials: {
        accessKeyId: config.storage.accessKeyId,
        secretAccessKey: config.storage.secretAccessKey,
      },
    });
  }
  return s3Client;
}

class S3Driver implements StorageDriver {
  readonly name = 's3';

  private bucket(): string {
    if (!config.storage.bucket) {
      throw serviceUnavailable(
        'Object storage bucket is not configured.',
        'STORAGE_NOT_CONFIGURED',
      );
    }
    return config.storage.bucket;
  }

  async put(
    key: string,
    body: Buffer,
    contentType: string,
    cacheControl = 'public, max-age=31536000, immutable',
  ): Promise<StoredObject> {
    const client = getS3Client();
    await client.send(
      new PutObjectCommand({
        Bucket: this.bucket(),
        Key: key,
        Body: body,
        ContentType: contentType,
        CacheControl: cacheControl,
        Metadata: { checksum: createHash('sha256').update(body).digest('hex').slice(0, 32) },
      }),
    );
    return {
      key,
      url: this.urlFor(key),
      bytes: body.byteLength,
      checksum: createHash('sha256').update(body).digest('hex'),
    };
  }

  async delete(key: string): Promise<void> {
    const client = getS3Client();
    try {
      await client.send(new DeleteObjectCommand({ Bucket: this.bucket(), Key: key }));
    } catch {
      /* deletion is best-effort */
    }
  }

  urlFor(key: string): string {
    const base = config.storage.publicBaseUrl;
    if (!base) {
      throw serviceUnavailable('S3_PUBLIC_BASE_URL is not configured.', 'STORAGE_NOT_CONFIGURED');
    }
    return `${base}/${key.split('/').map(encodeURIComponent).join('/')}`;
  }

  async read(key: string): Promise<Buffer> {
    const url = this.urlFor(key);
    const response = await fetch(url, { signal: AbortSignal.timeout(20_000) });
    if (!response.ok) {
      throw new Error(`Failed to read stored object (${response.status}).`);
    }
    return Buffer.from(await response.arrayBuffer());
  }
}

class LocalDriver implements StorageDriver {
  readonly name = 'local';
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

  async put(key: string, body: Buffer, _contentType: string): Promise<StoredObject> {
    const full = this.resolve(key);
    if (!existsSync(path.dirname(full))) {
      await mkdir(path.dirname(full), { recursive: true });
    }
    await writeFile(full, body);
    return {
      key,
      url: this.urlFor(key),
      bytes: body.byteLength,
      checksum: createHash('sha256').update(body).digest('hex'),
    };
  }

  async delete(key: string): Promise<void> {
    try {
      await unlink(this.resolve(key));
    } catch {
      /* best effort */
    }
  }

  urlFor(key: string): string {
    return `${config.apiPublicUrl}/media/${key.split('/').map(encodeURIComponent).join('/')}`;
  }

  async read(key: string): Promise<Buffer> {
    return readFile(this.resolve(key));
  }
}

export function getStorage(): StorageDriver {
  if (!config.storage.configured) {
    throw serviceUnavailable(
      'Photo storage is not configured. Ask the administrator to set R2/S3 credentials.',
      'STORAGE_NOT_CONFIGURED',
    );
  }
  return config.storage.mode === 's3' ? new S3Driver() : new LocalDriver();
}

export function storageReady(): boolean {
  return config.storage.configured;
}

export function buildStorageKey(parts: {
  scope: 'uploads' | 'articles';
  date: Date;
  submissionId: string;
  imageId: string;
  variant: 'full' | 'thumb';
}): string {
  const year = parts.date.getUTCFullYear();
  const month = String(parts.date.getUTCMonth() + 1).padStart(2, '0');
  return `${parts.scope}/${year}/${month}/${parts.submissionId}/${parts.imageId}-${parts.variant}.webp`;
}
