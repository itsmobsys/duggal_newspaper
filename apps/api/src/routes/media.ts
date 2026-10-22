import type { FastifyInstance } from 'fastify';
import { config } from '../config.js';
import type { Db } from '../db/client.js';
import { notFound } from '../lib/errors.js';
import { getStorage, readObject } from '../services/storage.js';

const MIME_BY_EXTENSION: Record<string, string> = {
  '.webp': 'image/webp',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
};

/**
 * Media server. Development reads files from disk. In production photos are
 * normally served by the public Blob CDN, but a store created with private
 * access cannot be fetched by a browser - those bytes are proxied here instead.
 */
export async function registerMediaRoutes(app: FastifyInstance, _db: Db): Promise<void> {
  app.get<{ Params: { '*': string } }>('/media/*', async (request, reply) => {
    if (!config.storage.configured) {
      throw notFound('Media is not configured in this environment.');
    }

    const key = (request.params['*'] ?? '').replace(/^\/+/, '');
    // Only the derived photo renditions are public. Untouched originals and any
    // other object in the store stay behind the admin auth check, so this proxy
    // cannot be used to enumerate or fetch them.
    if (!key.startsWith('uploads/photos/') || key.includes('..')) {
      throw notFound('Media not found.');
    }

    const storage = getStorage();
    let buffer: Buffer;
    try {
      // A private store has no browser-readable URL, and the driver may not
      // have learned that yet on a fresh process. Reading by key with the store
      // token works immediately and keeps photo links stable across restarts.
      buffer =
        config.storage.mode === 'blob'
          ? await readObject(key, null, 'private')
          : await storage.read(key);
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
