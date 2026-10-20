import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { createDb, type Db } from '../src/db/client.js';
import { runMigrations } from '../src/db/migrate.js';
import { hashToken, signServiceRequest } from '../src/lib/crypto.js';
import { createUserSession, type DiscordIdentity } from '../src/services/user-sessions.js';

let dir: string;
let db: Db;
let app: FastifyInstance;

const FAN: DiscordIdentity = {
  discordId: '424242424242424242',
  username: 'duggal_fan',
  displayName: 'Duggal Fan',
  avatarUrl: 'https://cdn.discordapp.com/avatars/424242424242424242/abcdef.png',
};

const CRITIC: DiscordIdentity = {
  discordId: '515151515151515151',
  username: 'canteen_critic',
  displayName: 'Canteen Critic',
  avatarUrl: null,
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

interface RequestOptions {
  body?: unknown;
  session?: string;
  admin?: string;
  ip?: string;
}

async function api(method: string, url: string, options: RequestOptions = {}) {
  const raw = options.body === undefined ? '' : JSON.stringify(options.body);
  const extra: Record<string, string> = {};
  if (options.session) extra['x-user-session'] = options.session;
  if (options.admin) extra['x-admin-session'] = options.admin;
  if (options.ip) extra['x-forwarded-for'] = options.ip;
  return app.inject({
    method: method as 'GET' | 'POST' | 'PATCH' | 'DELETE',
    url,
    ...(options.body === undefined ? {} : { payload: raw }),
    headers: signed(method, url, raw, extra),
  });
}

let articleSeq = 0;

async function insertArticle(status = 'published'): Promise<{ id: string; slug: string }> {
  articleSeq += 1;
  const id = `art_test_${articleSeq}`;
  const slug = `test-story-${articleSeq}`;
  const now = new Date().toISOString();
  await db.run(
    `INSERT INTO articles
       (id, slug, headline, body, category_slug, author_display, edition_date, status,
        published_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'server-news', 'The Desk', '2026-10-20', ?, ?, ?, ?)`,
    [
      id,
      slug,
      'The Canteen Ran Out Of Samosas',
      'A story body long enough to be a story.',
      status,
      now,
      now,
      now,
    ],
  );
  return { id, slug };
}

async function sessionFor(identity: DiscordIdentity): Promise<string> {
  const created = await createUserSession(db, identity, {
    ipHash: null,
    userAgent: 'vitest',
  });
  return created.token;
}

async function createAdminSession(): Promise<string> {
  const token = 'admin-test-session-token';
  const now = new Date().toISOString();
  const expires = new Date(Date.now() + 3600_000).toISOString();
  await db.run(
    `INSERT INTO admin_users (id, email, name, password_hash, role, disabled, created_at, updated_at)
     VALUES ('usr_test', 'editor@example.com', 'Test Editor', 'unused', 'owner', 0, ?, ?)`,
    [now, now],
  );
  await db.run(
    `INSERT INTO admin_sessions (id, user_id, token_hash, expires_at, revoked, created_at)
     VALUES ('ses_test', 'usr_test', ?, ?, 0, ?)`,
    [hashToken(token), expires, now],
  );
  return token;
}

const CLEAN_REVIEW =
  'The reporting was sharp, the quotes felt earned, and the last paragraph actually landed. More of this, please.';

beforeAll(async () => {
  dir = mkdtempSync(path.join(tmpdir(), 'duggal-community-'));
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
    'article_votes',
    'article_reviews',
    'user_sessions',
    'admin_sessions',
    'admin_users',
    'articles',
    'members',
    'submissions',
    'rate_limits',
    'audit_logs',
    'jobs',
  ]) {
    await db.run(`DELETE FROM ${table}`);
  }
});

describe('article votes', () => {
  it('counts a like, switches to a dislike, and clears the vote', async () => {
    const article = await insertArticle();
    const token = await sessionFor(FAN);

    const liked = await api('POST', '/public/votes', {
      session: token,
      body: { articleId: article.id, value: 1 },
    });
    expect(liked.statusCode).toBe(200);
    expect(liked.json()).toMatchObject({ likes: 1, dislikes: 0, myVote: 1, authenticated: true });

    const swapped = await api('POST', '/public/votes', {
      session: token,
      body: { articleId: article.id, value: -1 },
    });
    expect(swapped.json()).toMatchObject({ likes: 0, dislikes: 1, myVote: -1 });

    const cleared = await api('POST', '/public/votes', {
      session: token,
      body: { articleId: article.id, value: 0 },
    });
    expect(cleared.json()).toMatchObject({ likes: 0, dislikes: 0, myVote: null });

    const rows = await db.get<{ n: number }>('SELECT COUNT(*) AS n FROM article_votes');
    expect(rows?.n).toBe(0);
  });

  it('requires a Discord session before voting', async () => {
    const article = await insertArticle();
    const response = await api('POST', '/public/votes', {
      body: { articleId: article.id, value: 1 },
    });
    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe('AUTH_REQUIRED');
  });

  it('keeps one vote per member and exposes public totals', async () => {
    const article = await insertArticle();
    const fan = await sessionFor(FAN);
    const critic = await sessionFor(CRITIC);

    await api('POST', '/public/votes', {
      session: fan,
      body: { articleId: article.id, value: 1 },
    });
    await api('POST', '/public/votes', {
      session: critic,
      body: { articleId: article.id, value: 1 },
    });

    const anonymous = await api('GET', `/public/votes/${article.id}`);
    expect(anonymous.statusCode).toBe(200);
    expect(anonymous.json()).toMatchObject({
      likes: 2,
      dislikes: 0,
      myVote: null,
      authenticated: false,
    });

    await api('POST', '/public/votes', {
      session: fan,
      body: { articleId: article.id, value: -1 },
    });

    const mine = await api('GET', `/public/votes/${article.id}`, { session: fan });
    expect(mine.json()).toMatchObject({ likes: 1, dislikes: 1, myVote: -1, authenticated: true });
  });

  it('refuses votes on unpublished stories', async () => {
    const article = await insertArticle('draft');
    const token = await sessionFor(FAN);
    const response = await api('POST', '/public/votes', {
      session: token,
      body: { articleId: article.id, value: 1 },
    });
    expect(response.statusCode).toBe(404);
  });
});

describe('article reviews', () => {
  it('publishes a clean review and counts it in the summary', async () => {
    const article = await insertArticle();
    const token = await sessionFor(FAN);

    const created = await api('POST', '/public/reviews', {
      session: token,
      body: {
        articleId: article.id,
        rating: 4,
        body: CLEAN_REVIEW,
        formStartedAt: Date.now() - 60_000,
      },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({
      published: true,
      review: { rating: 4, status: 'published', displayName: FAN.displayName },
    });

    const list = await api('GET', `/public/reviews?articleId=${article.id}`);
    expect(list.statusCode).toBe(200);
    expect(list.json().summary).toMatchObject({ count: 1, average: 4 });
    expect(list.json().reviews).toHaveLength(1);
    expect(list.json().reviews[0].body).toContain('reporting was sharp');
  });

  it('holds reviews with links for a moderator and excludes them from the rating', async () => {
    const article = await insertArticle();
    const token = await sessionFor(FAN);

    const created = await api('POST', '/public/reviews', {
      session: token,
      body: {
        articleId: article.id,
        rating: 5,
        body: 'The full leaked document is at https://example.com/leak and it explains everything.',
        formStartedAt: Date.now() - 60_000,
      },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({ published: false, review: { status: 'pending' } });

    const publicList = await api('GET', `/public/reviews?articleId=${article.id}`);
    expect(publicList.json().summary.count).toBe(0);
    expect(publicList.json().reviews).toHaveLength(0);

    const mine = await api('GET', `/public/reviews?articleId=${article.id}`, { session: token });
    expect(mine.json().myReview).toMatchObject({ status: 'pending', rating: 5 });
  });

  it('lets the author edit and delete their own review', async () => {
    const article = await insertArticle();
    const token = await sessionFor(FAN);

    await api('POST', '/public/reviews', {
      session: token,
      body: {
        articleId: article.id,
        rating: 3,
        body: CLEAN_REVIEW,
        formStartedAt: Date.now() - 60_000,
      },
    });

    const edited = await api('POST', '/public/reviews', {
      session: token,
      body: {
        articleId: article.id,
        rating: 5,
        body: `${CLEAN_REVIEW} On a second read it is better than I first thought.`,
        formStartedAt: Date.now() - 60_000,
      },
    });
    expect(edited.statusCode).toBe(201);
    expect(edited.json().review).toMatchObject({ rating: 5 });

    const list = await api('GET', `/public/reviews?articleId=${article.id}`);
    expect(list.json().summary).toMatchObject({ count: 1, average: 5 });
    expect(list.json().reviews).toHaveLength(1);

    const deleted = await api('DELETE', `/public/reviews/${article.id}`, { session: token });
    expect(deleted.statusCode).toBe(200);

    const after = await api('GET', `/public/reviews?articleId=${article.id}`);
    expect(after.json().summary.count).toBe(0);
    expect(after.json().reviews).toHaveLength(0);
  });

  it('strips HTML from review text', async () => {
    const article = await insertArticle();
    const token = await sessionFor(FAN);

    const created = await api('POST', '/public/reviews', {
      session: token,
      body: {
        articleId: article.id,
        rating: 4,
        body: '<script>alert(1)</script> The piece was solid but the headline oversold it a little.',
        formStartedAt: Date.now() - 60_000,
      },
    });
    expect(created.statusCode).toBe(201);
    const body = (created.json().review as { body: string }).body;
    expect(body).not.toContain('<script>');
    expect(body).toContain('headline oversold it');
  });

  it('requires a session and validates the rating and length', async () => {
    const article = await insertArticle();

    const anonymous = await api('POST', '/public/reviews', {
      body: { articleId: article.id, rating: 4, body: CLEAN_REVIEW },
    });
    expect(anonymous.statusCode).toBe(401);

    const token = await sessionFor(FAN);
    const badRating = await api('POST', '/public/reviews', {
      session: token,
      body: { articleId: article.id, rating: 6, body: CLEAN_REVIEW },
    });
    expect(badRating.statusCode).toBe(400);
    expect(badRating.json().error.code).toBe('VALIDATION_ERROR');

    const tooShort = await api('POST', '/public/reviews', {
      session: token,
      body: { articleId: article.id, rating: 4, body: 'Loved it.' },
    });
    expect(tooShort.statusCode).toBe(400);
  });

  it('rejects reviews on unpublished stories', async () => {
    const article = await insertArticle('unpublished');
    const token = await sessionFor(FAN);
    const response = await api('POST', '/public/reviews', {
      session: token,
      body: { articleId: article.id, rating: 4, body: CLEAN_REVIEW },
    });
    expect(response.statusCode).toBe(404);
  });
});

describe('review moderation', () => {
  it('lets an admin publish and hide a pending review', async () => {
    const article = await insertArticle();
    const token = await sessionFor(FAN);
    const admin = await createAdminSession();

    const created = await api('POST', '/public/reviews', {
      session: token,
      body: {
        articleId: article.id,
        rating: 5,
        body: 'Read the whole thing at https://example.com/leak before the desk quietly deletes it.',
        formStartedAt: Date.now() - 60_000,
      },
    });
    const reviewId = (created.json().review as { id: string }).id;

    const queue = await api('GET', '/admin/reviews?status=pending', { admin });
    expect(queue.statusCode).toBe(200);
    expect(queue.json().total).toBe(1);
    expect(queue.json().reviews[0]).toMatchObject({ id: reviewId, slug: article.slug });

    const published = await api('PATCH', `/admin/reviews/${reviewId}`, {
      admin,
      body: { status: 'published' },
    });
    expect(published.statusCode).toBe(200);

    const publicList = await api('GET', `/public/reviews?articleId=${article.id}`);
    expect(publicList.json().summary.count).toBe(1);
    expect(publicList.json().reviews).toHaveLength(1);

    const hidden = await api('PATCH', `/admin/reviews/${reviewId}`, {
      admin,
      body: { status: 'hidden' },
    });
    expect(hidden.statusCode).toBe(200);

    const after = await api('GET', `/public/reviews?articleId=${article.id}`);
    expect(after.json().summary.count).toBe(0);
    expect(after.json().reviews).toHaveLength(0);
  });

  it('keeps the moderation queue behind an admin session', async () => {
    const response = await api('GET', '/admin/reviews?status=pending');
    expect(response.statusCode).toBe(401);
  });
});
