import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Db } from '../db/client.js';
import { tooManyRequests } from '../lib/errors.js';
import { consumeRateLimit } from '../lib/rate-limit.js';
import {
  createUserSession,
  revokeUserSession,
  sessionTokenFromRequest,
  validateUserSession,
} from '../services/user-sessions.js';
import { clientIpHash, writeAudit } from './helpers.js';

const DISCORD_ID = /^\d{15,21}$/;
const DISCORD_USERNAME = /^[a-z0-9._]{2,32}$/i;
const DISCORD_CDN = /^https:\/\/(cdn\.discordapp\.com|media\.discordapp\.net)\//i;

/**
 * The website performs the OAuth2 exchange with Discord, then asks the API to
 * mint an opaque session token. Identity fields are accepted only from that
 * trusted, service-signed call — browsers never talk to this endpoint directly
 * because every /public/* request must carry the website's HMAC signature.
 */
const SessionMintSchema = z.object({
  discordId: z.string().trim().regex(DISCORD_ID, 'Discord id looks invalid.'),
  username: z.string().trim().regex(DISCORD_USERNAME, 'Discord username looks invalid.'),
  displayName: z.string().trim().min(1).max(60).optional(),
  avatarUrl: z
    .union([z.string().trim().max(500).regex(DISCORD_CDN, 'Avatar URL looks invalid.'), z.null()])
    .optional(),
});

async function guard(
  db: Db,
  key: string,
  limit: number,
  windowSeconds: number,
  message: string,
): Promise<void> {
  const result = await consumeRateLimit(db, key, limit, windowSeconds);
  if (!result.allowed) throw tooManyRequests(message);
}

export async function registerAuthRoutes(app: FastifyInstance, db: Db): Promise<void> {
  app.post('/public/auth/session', async (request) => {
    const body = SessionMintSchema.parse(request.body ?? {});
    const ipHash = clientIpHash(request);
    await guard(db, `auth-session:${ipHash}`, 20, 600, 'Too many login attempts. Try again soon.');

    const displayName = body.displayName?.trim() || body.username;
    const created = await createUserSession(
      db,
      {
        discordId: body.discordId,
        username: body.username,
        displayName,
        avatarUrl: body.avatarUrl ?? null,
      },
      { ipHash, userAgent: userAgentOf(request) },
    );

    await writeAudit(db, {
      actor: 'system',
      action: 'user.login',
      targetType: 'member',
      targetId: created.user.memberId,
      detail: { discordId: created.user.discordId },
    });

    return {
      token: created.token,
      expiresAt: created.expiresAt,
      user: created.user,
    };
  });

  app.get('/public/auth/me', async (request) => {
    const token = sessionTokenFromRequest(request);
    const user = token ? await validateUserSession(db, token) : null;
    return { user };
  });

  app.post('/public/auth/logout', async (request) => {
    const token = sessionTokenFromRequest(request);
    if (token) await revokeUserSession(db, token);
    return { ok: true };
  });
}

function userAgentOf(request: FastifyRequest): string | null {
  const header = request.headers['user-agent'];
  const value = Array.isArray(header) ? header[0] : header;
  return typeof value === 'string' ? value.slice(0, 300) : null;
}
