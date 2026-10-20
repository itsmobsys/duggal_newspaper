import type { FastifyRequest } from 'fastify';
import { config } from '../config.js';
import type { Db } from '../db/client.js';
import { sha256Hex } from '../lib/crypto.js';
import { unauthorized } from '../lib/errors.js';
import { newId, randomToken } from '../lib/id.js';
import { nowIso } from '../lib/time.js';

/**
 * User sessions are opaque random tokens minted by the API after the website
 * has completed a Discord OAuth2 exchange. The website keeps the token in an
 * httpOnly cookie; the API only ever stores its hash.
 */
export const USER_SESSION_PREFIX = 'dbd_us_';
const MAX_TOKEN_LENGTH = 128;
const TOUCH_INTERVAL_MS = 5 * 60_000;

export interface DiscordIdentity {
  discordId: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
}

export interface SessionUser {
  memberId: string;
  discordId: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
}

export interface CreatedUserSession {
  token: string;
  expiresAt: string;
  user: SessionUser;
}

function sessionTokenHash(token: string): string {
  return sha256Hex(`user-session:${token}`);
}

export function sessionTokenFromRequest(request: FastifyRequest): string {
  const header = request.headers['x-user-session'];
  const value = Array.isArray(header) ? header[0] : header;
  if (typeof value !== 'string') return '';
  return value.split(',')[0]?.trim() ?? '';
}

export async function upsertDiscordMember(db: Db, identity: DiscordIdentity): Promise<string> {
  const now = nowIso();
  const existing = await db.get<{ id: string }>(
    'SELECT id FROM members WHERE discord_id = ? LIMIT 1',
    [identity.discordId],
  );
  if (existing) {
    await db.run(
      `UPDATE members SET display_name = ?, discord_username = ?, global_name = ?, avatar_url = ?, updated_at = ?
        WHERE id = ?`,
      [
        identity.displayName,
        identity.username,
        identity.displayName,
        identity.avatarUrl,
        now,
        existing.id,
      ],
    );
    return existing.id;
  }

  const memberId = newId('mem');
  try {
    await db.run(
      `INSERT INTO members (id, display_name, discord_username, discord_id, global_name, avatar_url,
         submission_count, published_count, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 0, 0, ?, ?)`,
      [
        memberId,
        identity.displayName,
        identity.username,
        identity.discordId,
        identity.displayName,
        identity.avatarUrl,
        now,
        now,
      ],
    );
    return memberId;
  } catch {
    // Two logins can race on the same Discord account; the unique index wins
    // one of them, so fall back to the stored row instead of failing the login.
    const raced = await db.get<{ id: string }>(
      'SELECT id FROM members WHERE discord_id = ? LIMIT 1',
      [identity.discordId],
    );
    if (!raced) throw new Error('Could not store the Discord member.');
    return raced.id;
  }
}

export async function createUserSession(
  db: Db,
  identity: DiscordIdentity,
  context: { ipHash: string | null; userAgent: string | null },
): Promise<CreatedUserSession> {
  const memberId = await upsertDiscordMember(db, identity);
  const token = `${USER_SESSION_PREFIX}${randomToken(32)}`;
  const now = nowIso();
  const expiresAt = new Date(Date.now() + config.userSessionTtlHours * 3_600_000).toISOString();

  await db.run(
    `INSERT INTO user_sessions (id, member_id, token_hash, created_at, last_seen_at, expires_at, ip_hash, user_agent)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      newId('usess'),
      memberId,
      sessionTokenHash(token),
      now,
      now,
      expiresAt,
      context.ipHash,
      context.userAgent,
    ],
  );

  return {
    token,
    expiresAt,
    user: {
      memberId,
      discordId: identity.discordId,
      username: identity.username,
      displayName: identity.displayName,
      avatarUrl: identity.avatarUrl,
    },
  };
}

export async function validateUserSession(db: Db, token: string): Promise<SessionUser | null> {
  if (!token || token.length > MAX_TOKEN_LENGTH || !token.startsWith(USER_SESSION_PREFIX)) {
    return null;
  }

  const row = await db.get<{
    session_id: string;
    expires_at: string;
    last_seen_at: string;
    member_id: string;
    discord_id: string | null;
    discord_username: string | null;
    display_name: string;
    global_name: string | null;
    avatar_url: string | null;
  }>(
    `SELECT s.id AS session_id, s.expires_at, s.last_seen_at,
            m.id AS member_id, m.discord_id, m.discord_username, m.display_name, m.global_name, m.avatar_url
       FROM user_sessions s
       JOIN members m ON m.id = s.member_id
      WHERE s.token_hash = ? AND s.revoked_at IS NULL
      LIMIT 1`,
    [sessionTokenHash(token)],
  );

  if (!row) return null;
  if (Date.parse(row.expires_at) <= Date.now()) {
    await db.run('UPDATE user_sessions SET revoked_at = ? WHERE id = ?', [
      nowIso(),
      row.session_id,
    ]);
    return null;
  }
  // Legacy members without a Discord id cannot be trusted for identity.
  if (!row.discord_id) return null;

  if (Date.now() - Date.parse(row.last_seen_at) > TOUCH_INTERVAL_MS) {
    await db.run('UPDATE user_sessions SET last_seen_at = ? WHERE id = ?', [
      nowIso(),
      row.session_id,
    ]);
  }

  return {
    memberId: row.member_id,
    discordId: row.discord_id,
    username: row.discord_username ?? row.display_name,
    displayName: row.global_name ?? row.display_name,
    avatarUrl: row.avatar_url,
  };
}

export async function revokeUserSession(db: Db, token: string): Promise<void> {
  if (!token || token.length > MAX_TOKEN_LENGTH) return;
  await db.run(
    'UPDATE user_sessions SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL',
    [nowIso(), sessionTokenHash(token)],
  );
}

export async function requireUserSession(db: Db, request: FastifyRequest): Promise<SessionUser> {
  const user = await validateUserSession(db, sessionTokenFromRequest(request));
  if (!user) {
    throw unauthorized('Log in with Discord to send a story.', 'AUTH_REQUIRED');
  }
  return user;
}
