import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { createDb, type Db } from '../src/db/client.js';
import { runMigrations } from '../src/db/migrate.js';
import { sha256Hex, signServiceRequest } from '../src/lib/crypto.js';
import {
  createUserSession,
  revokeUserSession,
  upsertDiscordMember,
  validateUserSession,
  type DiscordIdentity,
} from '../src/services/user-sessions.js';

let dir: string;
let db: Db;
let app: FastifyInstance;

const IDENTITY: DiscordIdentity = {
  discordId: '424242424242424242',
  username: 'duggal_fan',
  displayName: 'Duggal Fan',
  avatarUrl: 'https://cdn.discordapp.com/avatars/424242424242424242/abcdef.png?size=128',
};

function signed(
  method: string,
  url: string,
  body: string,
  extra: Record<string, string> = {},
): Record<string, string> {
  const { timestamp, signature } = signServiceRequest(method, url, body);
  return {
    'content-type': 'application/json',
    'x-service-timestamp': timestamp,
    'x-service-signature': signature,
    ...extra,
  };
}

function submissionBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    headline: 'The Canteen Ran Out Of Samosas And Nobody Was Fine',
    story:
      'At 1:42pm the canteen ran out of samosas. A queue formed immediately, then a second queue, then a rumour that the hostel kitchen had a secret tray. It did not.',
    sourceUrl: '',
    anonymous: false,
    consent: true,
    website: '',
    formStartedAt: Date.now() - 60_000,
    ...overrides,
  };
}

async function post(pathname: string, body: unknown, extra: Record<string, string> = {}) {
  const raw = JSON.stringify(body);
  return app.inject({
    method: 'POST',
    url: pathname,
    payload: raw,
    headers: signed('POST', pathname, raw, extra),
  });
}

beforeAll(async () => {
  dir = mkdtempSync(path.join(tmpdir(), 'duggal-auth-'));
  db = createDb({ url: `file:${path.join(dir, 'test.db')}` });
  await runMigrations(db);
  app = await buildApp({ db, quiet: true });
  await app.ready();
});

afterAll(async () => {
  await app.close();
  db.client.close();
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    // Windows keeps the SQLite handle briefly; the OS temp cleaner will get it.
  }
});

beforeEach(async () => {
  for (const table of [
    'user_sessions',
    'submissions',
    'members',
    'rate_limits',
    'audit_logs',
    'jobs',
  ]) {
    await db.run(`DELETE FROM ${table}`);
  }
});

describe('user sessions', () => {
  it('mints an opaque token and stores only its hash', async () => {
    const created = await createUserSession(db, IDENTITY, {
      ipHash: 'ip-hash',
      userAgent: 'vitest',
    });

    expect(created.token.startsWith('dbd_us_')).toBe(true);
    expect(created.user).toMatchObject({
      discordId: IDENTITY.discordId,
      username: IDENTITY.username,
      displayName: IDENTITY.displayName,
    });

    const row = await db.get<{ token_hash: string }>(
      'SELECT token_hash FROM user_sessions WHERE member_id = ?',
      [created.user.memberId],
    );
    expect(row?.token_hash).toBe(sha256Hex(`user-session:${created.token}`));
    expect(row?.token_hash).not.toBe(created.token);

    const resolved = await validateUserSession(db, created.token);
    expect(resolved).toMatchObject({
      memberId: created.user.memberId,
      discordId: IDENTITY.discordId,
      displayName: IDENTITY.displayName,
    });
  });

  it('refuses expired and revoked tokens', async () => {
    const expired = await createUserSession(db, IDENTITY, { ipHash: null, userAgent: null });
    await db.run('UPDATE user_sessions SET expires_at = ? WHERE member_id = ?', [
      new Date(Date.now() - 60_000).toISOString(),
      expired.user.memberId,
    ]);
    expect(await validateUserSession(db, expired.token)).toBeNull();
    const revoked = await db.get<{ revoked_at: string | null }>(
      'SELECT revoked_at FROM user_sessions WHERE member_id = ?',
      [expired.user.memberId],
    );
    expect(revoked?.revoked_at).toBeTruthy();

    const live = await createUserSession(db, IDENTITY, { ipHash: null, userAgent: null });
    await revokeUserSession(db, live.token);
    expect(await validateUserSession(db, live.token)).toBeNull();
    expect(await validateUserSession(db, 'dbd_us_forged')).toBeNull();
  });

  it('refreshes the member row instead of duplicating Discord accounts', async () => {
    const first = await upsertDiscordMember(db, IDENTITY);
    const second = await upsertDiscordMember(db, {
      ...IDENTITY,
      displayName: 'Renamed Fan',
      avatarUrl: null,
    });
    expect(second).toBe(first);
    const members = await db.all<{ display_name: string }>('SELECT display_name FROM members');
    expect(members).toHaveLength(1);
    expect(members[0]?.display_name).toBe('Renamed Fan');
  });
});

describe('submission authentication', () => {
  it('rejects submissions with no Discord session', async () => {
    const response = await post('/public/submissions', submissionBody(), {
      'x-forwarded-for': '203.0.113.10',
    });
    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe('AUTH_REQUIRED');
    const count = await db.get<{ n: number }>('SELECT COUNT(*) AS n FROM submissions');
    expect(count?.n).toBe(0);
  });

  it('rejects direct API requests that lack the service signature', async () => {
    const session = await createUserSession(db, IDENTITY, { ipHash: null, userAgent: null });
    const response = await app.inject({
      method: 'POST',
      url: '/public/submissions',
      payload: JSON.stringify(submissionBody()),
      headers: {
        'content-type': 'application/json',
        'x-user-session': session.token,
      },
    });
    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe('SERVICE_SIGNATURE_INVALID');
  });

  it('uses the Discord identity and ignores identity fields in the body', async () => {
    const session = await createUserSession(db, IDENTITY, { ipHash: null, userAgent: null });
    const response = await post(
      '/public/submissions',
      submissionBody({
        authorName: 'Mallory',
        discordHandle: 'mallory',
        discordId: '999999999999999999',
        identityMode: 'named',
        memberId: 'mem_forged',
      }),
      { 'x-user-session': session.token, 'x-forwarded-for': '203.0.113.20' },
    );
    expect(response.statusCode).toBe(201);

    const row = await db.get<{
      author_name: string;
      discord_handle: string | null;
      identity_mode: string;
      member_id: string | null;
    }>(
      'SELECT author_name, discord_handle, identity_mode, member_id FROM submissions WHERE id = ?',
      [response.json().id],
    );
    expect(row).toMatchObject({
      author_name: IDENTITY.displayName,
      discord_handle: IDENTITY.username,
      identity_mode: 'discord',
      member_id: session.user.memberId,
    });
  });

  it('keeps the account on anonymous submissions', async () => {
    const session = await createUserSession(db, IDENTITY, { ipHash: null, userAgent: null });
    const response = await post('/public/submissions', submissionBody({ anonymous: true }), {
      'x-user-session': session.token,
      'x-forwarded-for': '203.0.113.21',
    });
    expect(response.statusCode).toBe(201);

    const row = await db.get<{
      author_name: string;
      identity_mode: string;
      member_id: string | null;
    }>('SELECT author_name, identity_mode, member_id FROM submissions WHERE id = ?', [
      response.json().id,
    ]);
    expect(row?.identity_mode).toBe('anonymous');
    expect(row?.author_name).toBe(IDENTITY.displayName);
    expect(row?.member_id).toBe(session.user.memberId);
  });

  it('requires a session before handing out upload tickets', async () => {
    const response = await post(
      '/public/uploads/init',
      { files: [{ name: 'photo.jpg', type: 'image/jpeg', size: 4096 }] },
      { 'x-forwarded-for': '203.0.113.22' },
    );
    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe('AUTH_REQUIRED');
  });
});

describe('auth endpoints', () => {
  it('refuses to mint a session for unsigned callers', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/public/auth/session',
      payload: JSON.stringify(IDENTITY),
      headers: { 'content-type': 'application/json' },
    });
    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe('SERVICE_SIGNATURE_INVALID');
  });

  it('mints, resolves and revokes a session', async () => {
    const minted = await post('/public/auth/session', IDENTITY, {
      'x-forwarded-for': '203.0.113.23',
    });
    expect(minted.statusCode).toBe(200);
    const body = minted.json() as { token: string; user: { discordId: string } };
    expect(body.token.startsWith('dbd_us_')).toBe(true);
    expect(body.user.discordId).toBe(IDENTITY.discordId);

    const me = await app.inject({
      method: 'GET',
      url: '/public/auth/me',
      headers: signed('GET', '/public/auth/me', '', { 'x-user-session': body.token }),
    });
    expect(me.statusCode).toBe(200);
    expect(me.json().user.displayName).toBe(IDENTITY.displayName);

    const loggedOut = await post(
      '/public/auth/logout',
      {},
      {
        'x-user-session': body.token,
        'x-forwarded-for': '203.0.113.23',
      },
    );
    expect(loggedOut.statusCode).toBe(200);

    const after = await app.inject({
      method: 'GET',
      url: '/public/auth/me',
      headers: signed('GET', '/public/auth/me', '', { 'x-user-session': body.token }),
    });
    expect(after.statusCode).toBe(200);
    expect(after.json().user).toBeNull();
  });
});
