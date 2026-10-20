import type { FastifyInstance } from 'fastify';
import { config } from '../config.js';
import type { Db } from '../db/client.js';
import { notFound } from '../lib/errors.js';
import { getStorage } from '../services/storage.js';

const MIME_BY_EXTENSION: Record<string, string> = {
  '.webp': 'image/webp',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
};

/**
 * Local-development media server. In production photos live in R2/S3 and are
 * served from the bucket's public URL, so this route is intentionally inert.
 */
export async function registerMediaRoutes(app: FastifyInstance, _db: Db): Promise<void> {
  app.get<{ Params: { '*': string } }>('/media/*', async (request, reply) => {
    if (config.storage.mode !== 'local' || !config.storage.configured) {
      throw notFound('Media is served from object storage in this environment.');
    }

    const key = (request.params['*'] ?? '').replace(/^\/+/, '');
    if (!key) throw notFound('Media not found.');

    let buffer: Buffer;
    try {
      buffer = await getStorage().read(key);
    } catch {
      throw notFound('Media not found.');
    }

    const dot = key.lastIndexOf('.');
    const extension = dot >= 0 ? key.slice(dot).toLowerCase() : '';
    reply.header('Content-Type', MIME_BY_EXTENSION[extension] ?? 'application/octet-stream');
    reply.header('Cache-Control', 'public, max-age=31536000, immutable');
    reply.header('Content-Length', String(buffer.byteLength));
    return reply.send(buffer);
  });
}
