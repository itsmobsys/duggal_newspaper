import type { Db } from '../db/client.js';
import type { UploadRow } from '../db/types.js';
import { config } from '../config.js';
import { hashUploadToken, safeEqual, sha256Hex } from '../lib/crypto.js';
import { badRequest, notFound, unauthorized } from '../lib/errors.js';
import { newId, randomToken } from '../lib/id.js';
import { nowIso } from '../lib/time.js';
import { processImage } from './images.js';
import { buildStorageKey, getStorage } from './storage.js';

export interface UploadTicket {
  uploadId: string;
  token: string;
  uploadUrl: string;
}

export interface UploadMetadata {
  id: string;
  url: string;
  thumbUrl: string;
  width: number;
  height: number;
  bytes: number;
  mime: string;
}

export async function createUploadTickets(
  db: Db,
  input: {
    files: Array<{ name?: string; type?: string; size?: number }>;
    ipHash: string;
  },
): Promise<UploadTicket[]> {
  if (input.files.length === 0) return [];
  if (input.files.length > config.maxImagesPerSubmission) {
    throw badRequest(
      `Maximum ${config.maxImagesPerSubmission} photos per submission.`,
      'TOO_MANY_IMAGES',
    );
  }

  const expiresAt = new Date(Date.now() + config.uploadTicketTtlMinutes * 60 * 1000).toISOString();
  const tickets: UploadTicket[] = [];

  for (const file of input.files) {
    if (file.type && !['image/jpeg', 'image/png', 'image/webp', 'image/jpg'].includes(file.type)) {
      throw badRequest('Photos must be JPEG, PNG or WebP.', 'IMAGE_UNSUPPORTED_FORMAT');
    }
    if (file.size && file.size > config.maxUploadBytes) {
      throw badRequest(
        `Each photo must be smaller than ${Math.floor(config.maxUploadBytes / (1024 * 1024))} MB.`,
        'IMAGE_TOO_LARGE',
      );
    }

    const id = newId('upl');
    const token = randomToken(24);
    await db.run(
      `INSERT INTO uploads (id, token_hash, status, original_name, ip_hash, expires_at, created_at)
       VALUES (?, ?, 'pending', ?, ?, ?, ?)`,
      [
        id,
        hashUploadToken(token),
        file.name?.slice(0, 200) ?? null,
        input.ipHash,
        expiresAt,
        nowIso(),
      ],
    );
    tickets.push({
      uploadId: id,
      token,
      uploadUrl: `${config.apiPublicUrl}/public/uploads/${id}`,
    });
  }

  return tickets;
}

export async function storeUpload(
  db: Db,
  input: {
    uploadId: string;
    token: string;
    buffer: Buffer;
    contentType: string;
    ipHash: string;
  },
): Promise<UploadMetadata> {
  const row = await db.get<UploadRow>('SELECT * FROM uploads WHERE id = ?', [input.uploadId]);
  if (!row) throw notFound('Upload ticket not found.');
  if (!row.token_hash || !safeEqual(hashUploadToken(input.token), row.token_hash)) {
    throw unauthorized('Invalid upload token.', 'UPLOAD_TOKEN_INVALID');
  }
  if (row.status !== 'pending') {
    throw badRequest('This upload ticket has already been used.', 'UPLOAD_ALREADY_USED');
  }
  if (new Date(row.expires_at).getTime() < Date.now()) {
    throw badRequest('Upload ticket expired. Please reselect the photo.', 'UPLOAD_EXPIRED');
  }
  if (input.buffer.byteLength > config.maxUploadBytes) {
    throw badRequest('Photo is too large.', 'IMAGE_TOO_LARGE');
  }

  const processed = await processImage(input.buffer);
  const storage = getStorage();
  const date = new Date();
  const fullKey = buildStorageKey({
    scope: 'uploads',
    date,
    submissionId: row.id,
    imageId: row.id,
    variant: 'full',
  });
  const thumbKey = buildStorageKey({
    scope: 'uploads',
    date,
    submissionId: row.id,
    imageId: row.id,
    variant: 'thumb',
  });

  const [full, thumb] = await Promise.all([
    storage.put(fullKey, processed.full, 'image/webp'),
    storage.put(thumbKey, processed.thumb, 'image/webp'),
  ]);

  await db.run(
    `UPDATE uploads SET status = 'stored', storage_key = ?, thumb_key = ?, url = ?, thumb_url = ?,
       mime = ?, bytes = ?, width = ?, height = ?, checksum = ?, stored_at = ?
     WHERE id = ? AND status = 'pending'`,
    [
      full.key,
      thumb.key,
      full.url,
      thumb.url,
      'image/webp',
      full.bytes,
      processed.width,
      processed.height,
      processed.checksum,
      nowIso(),
      row.id,
    ],
  );

  await db.run(
    `INSERT INTO audit_logs (id, actor, action, target_type, target_id, detail, ip_hash, created_at)
     VALUES (?, 'system', 'upload.stored', 'upload', ?, ?, ?, ?)`,
    [
      newId('aud'),
      row.id,
      JSON.stringify({
        bytes: full.bytes,
        width: processed.width,
        height: processed.height,
        sha: sha256Hex(processed.full).slice(0, 12),
      }),
      input.ipHash,
      nowIso(),
    ],
  );

  return {
    id: row.id,
    url: full.url,
    thumbUrl: thumb.url,
    width: processed.width,
    height: processed.height,
    bytes: full.bytes,
    mime: 'image/webp',
  };
}

export interface ClaimedUpload {
  row: UploadRow;
}

export async function claimUploads(db: Db, uploadIds: string[]): Promise<UploadRow[]> {
  const unique = [...new Set(uploadIds)];
  if (unique.length === 0) return [];
  const rows = await db.all<UploadRow>(
    `SELECT * FROM uploads WHERE id IN (${unique.map(() => '?').join(',')})`,
    unique,
  );
  if (rows.length !== unique.length) {
    throw badRequest(
      'One or more photos could not be found. Re-upload and try again.',
      'UPLOAD_MISSING',
    );
  }
  const now = Date.now();
  for (const row of rows) {
    if (row.status !== 'stored' || row.submission_id) {
      throw badRequest(
        'One or more photos were already used. Re-upload and try again.',
        'UPLOAD_CLAIMED',
      );
    }
    if (new Date(row.expires_at).getTime() < now) {
      throw badRequest('A photo upload expired. Re-upload and try again.', 'UPLOAD_EXPIRED');
    }
    if (!row.url || !row.storage_key) {
      throw badRequest(
        'A photo is missing its stored file. Re-upload and try again.',
        'UPLOAD_INCOMPLETE',
      );
    }
  }
  return rows.sort((a, b) => unique.indexOf(a.id) - unique.indexOf(b.id));
}
