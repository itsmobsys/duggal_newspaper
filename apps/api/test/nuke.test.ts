import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { createDb, type Db } from '../src/db/client.js';
import { runMigrations } from '../src/db/migrate.js';
import { hashPassword, hashToken, signServiceRequest } from '../src/lib/crypto.js';
import { invalidateSettingsCache } from '../src/settings.js';
import { createUserSession, type DiscordIdentity } from '../src/services/user-sessions.js';

let dir: string;
let db: Db;
let app: FastifyInstance;

const PASSWORD = 'open-the-vault-please';
const READER: DiscordIdentity = {
  discordId: '909090909090909090',
  username: 'reader_one',
  displayName: 'Reader One',
  avatarUrl: null,
};

interface RequestOptions {
  body?: unknown;
  session?: string;
  admin?: string;
}

function signed(method: string, url: string, body: string, extra: Record<string, string> = {}) {
  const { timestamp, signature } = signServiceRequest(method, url, body);
  return {
    'content-type': 'application/json',
    'x-service-timestamp': timestamp,
    'x-service-signature': signature,
    ...extra,
  };
}

async function api(method: string, url: string, options: RequestOptions = {}) {
  const raw = options.body === undefined ? '' : JSON.stringify(options.body);
  const extra: Record<string, string> = {};
  if (options.session) extra['x-user-session'] = options.session;
  if (options.admin) extra['x-admin-session'] = options.admin;
  return app.inject({
    method: method as 'GET' | 'POST' | 'PATCH' | 'DELETE',
    url,
    ...(options.body === undefined ? {} : { payload: raw }),
    headers: signed(method, url, raw, extra),
  });
}

async function seedAdmin(): Promise<string> {
  const token = 'admin-nuke-session-token';
  const now = new Date().toISOString();
  const expires = new Date(Date.now() + 3600_000).toISOString();
  const hash = await hashPassword(PASSWORD);
  await db.run(
    `INSERT INTO admin_users (id, email, name, password_hash, role, disabled, created_at, updated_at)
     VALUES ('usr_nuke', 'owner@example.com', 'Owner', ?, 'owner', 0, ?, ?)`,
    [hash, now, now],
  );
  await db.run(
    `INSERT INTO admin_sessions (id, user_id, token_hash, expires_at, revoked, created_at)
     VALUES ('ses_nuke', 'usr_nuke', ?, ?, 0, ?)`,
    [hashToken(token), expires, now],
  );
  return token;
}

async function auditActions(): Promise<string[]> {
  const rows = await db.all<{ action: string }>(
    'SELECT action FROM audit_logs ORDER BY created_at ASC, rowid ASC',
  );
  return rows.map((row) => row.action);
}

async function storedNuke(): Promise<string | null> {
  const row = await db.get<{ value: string }>("SELECT value FROM settings WHERE key = 'site.nuke'");
  return row ? row.value : null;
}

beforeAll(async () => {
  dir = mkdtempSync(path.join(tmpdir(), 'duggal-nuke-'));
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
    'admin_sessions',
    'admin_users',
    'user_sessions',
    'members',
    'articles',
    'rate_limits',
    'audit_logs',
    'settings',
  ]) {
    await db.run(`DELETE FROM ${table}`);
  }
  invalidateSettingsCache();
});

describe('site takedown switch', () => {
  it('refuses reads without an admin session', async () => {
    const response = await api('GET', '/admin/nuke');
    expect(response.statusCode).toBe(401);
  });

  it('refuses writes without an admin session', async () => {
    const response = await api('POST', '/admin/nuke', {
      body: { active: true, password: PASSWORD },
    });
    expect(response.statusCode).toBe(401);
    expect(await storedNuke()).toBeNull();
  });

  it('rejects a wrong password without flipping the switch', async () => {
    const admin = await seedAdmin();
    const response = await api('POST', '/admin/nuke', {
      admin,
      body: { active: true, password: 'not-the-password' },
    });

    expect(response.statusCode).toBe(401);
    expect(await storedNuke()).toBeNull();
    expect(await auditActions()).toContain('site.nuke_denied');
  });

  it('takes the site down, audits it, and refuses public writes', async () => {
    const admin = await seedAdmin();
    const session = await createUserSession(db, READER, { ipHash: null, userAgent: 'vitest' });
    const now = new Date().toISOString();
    await db.run(
      `INSERT INTO articles
         (id, slug, headline, body, category_slug, author_display, edition_date, status,
          published_at, created_at, updated_at)
       VALUES ('art_nuke', 'nuke-story', 'Story', 'Body long enough.', 'server-news', 'Desk',
               '2026-10-20', 'published', ?, ?, ?)`,
      [now, now, now],
    );

    const down = await api('POST', '/admin/nuke', {
      admin,
      body: { active: true, password: PASSWORD },
    });
    expect(down.statusCode).toBe(200);
    expect(down.json()).toMatchObject({ ok: true, active: true });

    const read = await api('GET', '/admin/nuke', { admin });
    expect(read.json()).toEqual({ active: true });
    expect(await storedNuke()).toBe('true');
    expect(await auditActions()).toContain('site.nuke');

    const vote = await api('POST', '/public/votes', {
      session: session.token,
      body: { articleId: 'art_nuke', value: 1 },
    });
    expect(vote.statusCode).toBe(503);
    expect(vote.json()).toMatchObject({ error: { code: 'SITE_DOWN' } });

    const upload = await api('POST', '/public/uploads/init', {
      session: session.token,
      body: { files: [{ name: 'photo.jpg', type: 'image/jpeg', size: 1000 }] },
    });
    expect(upload.statusCode).toBe(503);
  });

  it('brings the site back and audits the restore', async () => {
    const admin = await seedAdmin();
    await api('POST', '/admin/nuke', { admin, body: { active: true, password: PASSWORD } });
    const up = await api('POST', '/admin/nuke', {
      admin,
      body: { active: false, password: PASSWORD },
    });

    expect(up.statusCode).toBe(200);
    expect(up.json()).toMatchObject({ ok: true, active: false });
    expect(await storedNuke()).toBe('false');
    expect(await auditActions()).toContain('site.restore');
  });

  it('rate limits repeated attempts', async () => {
    const admin = await seedAdmin();
    let last = 0;
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const response = await api('POST', '/admin/nuke', {
        admin,
        body: { active: true, password: 'wrong-every-time' },
      });
      last = response.statusCode;
    }
    expect(last).toBe(429);
  });
});
