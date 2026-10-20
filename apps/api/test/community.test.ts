import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { createDb, type Db } from '../src/db/client.js';
import { runMigrations } from '../src/db/migrate.js';
import { signServiceRequest } from '../src/lib/crypto.js';
import { weekBoundsFor } from '../src/lib/time.js';

let dir: string;
let db: Db;
let app: FastifyInstance;
let leaderboard: typeof import('../../web/src/lib/queries.js').getWeeklyLeaderboard;

const ARTICLE_ID = 'art_community';
const ARTICLE_SLUG = 'community-test-story';
const VOTER_A = 'voter-token-aaaaaaaaaaaaaaaa';
const VOTER_B = 'voter-token-bbbbbbbbbbbbbbbb';
const VOTER_C = 'voter-token-cccccccccccccccc';

function signedHeaders(
  method: string,
  url: string,
  rawBody: string,
  token: string,
): Record<string, string> {
  const { timestamp, signature } = signServiceRequest(method, url, rawBody);
  return {
    'x-service-timestamp': timestamp,
    'x-service-signature': signature,
    'x-voter-token': token,
    ...(rawBody ? { 'content-type': 'application/json' } : {}),
  };
}

async function call(
  method: 'GET' | 'POST' | 'DELETE',
  url: string,
  body?: unknown,
  token = VOTER_A,
): Promise<Awaited<ReturnType<FastifyInstance['inject']>>> {
  const raw = body === undefined ? '' : JSON.stringify(body);
  return app.inject({
    method,
    url,
    payload: raw || undefined,
    headers: signedHeaders(method, url, raw, token),
  });
}

beforeAll(async () => {
  dir = mkdtempSync(path.join(tmpdir(), 'dbd-community-'));
  const dbPath = path.join(dir, 'test.db');
  db = createDb({ url: `file:${dbPath}` });
  await runMigrations(db);
  app = await buildApp({ db, quiet: true });

  const now = new Date().toISOString();
  const today = now.slice(0, 10);
  await db.run(
    `INSERT INTO articles (id, slug, headline, body, category_slug, author_display, identity_mode,
       tags, status, edition_date, published_at, created_at, updated_at)
     VALUES (?, ?, 'A story readers can rank', 'Body text for the community tests.', 'server-news',
       'Test Reporter', 'named', '[]', 'published', ?, ?, ?, ?)`,
    [ARTICLE_ID, ARTICLE_SLUG, today, now, now, now],
  );

  // The website owns the leaderboard query. Point its read-only client at the
  // same temporary database and import it after the environment is set.
  process.env.TURSO_DATABASE_URL = `file:${dbPath.replace(/\\/g, '/')}`;
  delete process.env.TURSO_AUTH_TOKEN;
  ({ getWeeklyLeaderboard: leaderboard } = await import('../../web/src/lib/queries.js'));
});

afterAll(async () => {
  await app.close();
  db.client.close();
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    // Windows may keep the SQLite handle briefly; the temp cleaner will get it.
  }
});

describe('calendar week', () => {
  it('runs Monday 00:00 through Sunday 23:59 in Asia/Kolkata', () => {
    const wednesday = weekBoundsFor(new Date('2026-10-21T10:00:00Z'), 'Asia/Kolkata');
    expect(wednesday.startDate).toBe('2026-10-19');
    expect(wednesday.endDate).toBe('2026-10-25');
    expect(wednesday.startIso).toBe('2026-10-18T18:30:00.000Z');
    expect(wednesday.endIso).toBe('2026-10-25T18:30:00.000Z');

    // Sunday night is still the same week; Monday midnight starts the next one.
    const sunday = weekBoundsFor(new Date('2026-10-25T18:29:00Z'), 'Asia/Kolkata');
    expect(sunday.startDate).toBe('2026-10-19');
    const monday = weekBoundsFor(new Date('2026-10-25T18:30:00Z'), 'Asia/Kolkata');
    expect(monday.startDate).toBe('2026-10-26');
    expect(monday.endDate).toBe('2026-11-01');
  });
});

describe('reader votes', () => {
  it('records one vote per browser and lets it change or clear', async () => {
    const liked = await call('POST', '/public/votes', { articleId: ARTICLE_ID, value: 1 }, VOTER_B);
    expect(liked.statusCode).toBe(200);
    expect(liked.json()).toMatchObject({ likes: 1, dislikes: 0, myVote: 1 });

    const disliked = await call(
      'POST',
      '/public/votes',
      { articleId: ARTICLE_ID, value: -1 },
      VOTER_B,
    );
    expect(disliked.json()).toMatchObject({ likes: 0, dislikes: 1, myVote: -1 });

    const cleared = await call(
      'POST',
      '/public/votes',
      { articleId: ARTICLE_ID, value: 0 },
      VOTER_B,
    );
    expect(cleared.json()).toMatchObject({ likes: 0, dislikes: 0, myVote: null });

    const state = await call('GET', `/public/votes/${ARTICLE_ID}`, undefined, VOTER_B);
    expect(state.json()).toMatchObject({ likes: 0, dislikes: 0, myVote: null });
  });
});

describe('reader reviews', () => {
  it('publishes a clean review, updates it in place and deletes it', async () => {
    const created = await call(
      'POST',
      '/public/reviews',
      {
        articleId: ARTICLE_ID,
        displayName: 'Test Reader',
        rating: 4,
        body: 'This is a considered review with enough words to pass the minimum length check.',
        formStartedAt: Date.now() - 60_000,
      },
      VOTER_A,
    );
    expect(created.statusCode).toBe(201);
    const createdBody = created.json() as {
      published: boolean;
      review: { status: string; rating: number };
      summary: { count: number; average: number };
    };
    expect(createdBody.published).toBe(true);
    expect(createdBody.review.status).toBe('published');
    expect(createdBody.summary).toMatchObject({ count: 1, average: 4 });

    const updated = await call(
      'POST',
      '/public/reviews',
      {
        articleId: ARTICLE_ID,
        rating: 5,
        body: 'An edited review, still long enough, now with five stars instead of four.',
        formStartedAt: Date.now() - 60_000,
      },
      VOTER_A,
    );
    expect(updated.statusCode).toBe(200);
    expect(updated.json()).toMatchObject({
      published: true,
      review: { rating: 5 },
      summary: { count: 1, average: 5 },
    });

    const listed = await call('GET', `/public/reviews?articleId=${ARTICLE_ID}`, undefined, VOTER_A);
    const listedBody = listed.json() as {
      reviews: unknown[];
      myReview: { rating: number } | null;
      summary: { count: number };
    };
    expect(listedBody.reviews).toHaveLength(1);
    expect(listedBody.myReview?.rating).toBe(5);
    expect(listedBody.summary.count).toBe(1);

    const removed = await call('DELETE', `/public/reviews/${ARTICLE_ID}`, undefined, VOTER_A);
    expect(removed.statusCode).toBe(200);
    expect(removed.json()).toMatchObject({ ok: true, summary: { count: 0, average: 0 } });
  });

  it('holds suspicious reviews until a human or a clean edit clears them', async () => {
    const held = await call(
      'POST',
      '/public/reviews',
      {
        articleId: ARTICLE_ID,
        rating: 2,
        body: 'Read the real story at https://example.com and send me your details for a prize.',
        formStartedAt: Date.now() - 60_000,
      },
      VOTER_C,
    );
    expect(held.statusCode).toBe(201);
    const heldBody = held.json() as {
      published: boolean;
      review: { status: string };
      summary: { count: number };
    };
    expect(heldBody.published).toBe(false);
    expect(heldBody.review.status).toBe('pending');
    expect(heldBody.summary.count).toBe(0);

    const cleaned = await call(
      'POST',
      '/public/reviews',
      {
        articleId: ARTICLE_ID,
        rating: 3,
        body: 'Edited to remove the link and the spam. This review is now plain and readable.',
        formStartedAt: Date.now() - 60_000,
      },
      VOTER_C,
    );
    expect(cleaned.json()).toMatchObject({
      published: true,
      review: { status: 'published', rating: 3 },
      summary: { count: 1, average: 3 },
    });
  });
});

describe('weekly ranking', () => {
  it('uses net votes and caps the review term at ten published reviews', async () => {
    await db.run('DELETE FROM article_reviews');
    await db.run('DELETE FROM article_votes');
    await db.run('DELETE FROM rate_limits');

    const now = new Date();
    const iso = now.toISOString();
    const today = iso.slice(0, 10);
    const lastWeek = new Date(now.getTime() - 10 * 24 * 3600 * 1000).toISOString();

    await db.run(
      `INSERT INTO articles (id, slug, headline, body, category_slug, author_display, identity_mode,
         tags, status, edition_date, published_at, created_at, updated_at)
       VALUES ('art_runner_up', 'runner-up-story', 'The runner-up', 'Body.', 'server-news',
         'Reporter', 'named', '[]', 'published', ?, ?, ?, ?)`,
      [today, iso, iso, iso],
    );
    await db.run(
      `INSERT INTO articles (id, slug, headline, body, category_slug, author_display, identity_mode,
         tags, status, edition_date, published_at, created_at, updated_at)
       VALUES ('art_last_week', 'last-week-story', 'Last week', 'Body.', 'server-news',
         'Reporter', 'named', '[]', 'published', ?, ?, ?, ?)`,
      [today, lastWeek, lastWeek, lastWeek],
    );

    for (let index = 0; index < 10; index += 1) {
      await db.run(
        `INSERT INTO article_votes (id, article_id, voter_hash, value, created_at, updated_at)
         VALUES (?, ?, ?, 1, ?, ?)`,
        [`vote_like_${index}`, ARTICLE_ID, `hash-like-${index}`, iso, iso],
      );
    }
    for (let index = 0; index < 2; index += 1) {
      await db.run(
        `INSERT INTO article_votes (id, article_id, voter_hash, value, created_at, updated_at)
         VALUES (?, ?, ?, -1, ?, ?)`,
        [`vote_dislike_${index}`, ARTICLE_ID, `hash-dislike-${index}`, iso, iso],
      );
    }
    for (let index = 0; index < 12; index += 1) {
      await db.run(
        `INSERT INTO article_reviews (id, article_id, voter_hash, display_name, rating, body,
           status, moderation_reason, ip_hash, user_agent, created_at, updated_at)
         VALUES (?, ?, ?, 'Reader', 5, 'Five stars from a real reader.', 'published', NULL, NULL, NULL, ?, ?)`,
        [`review_hi_${index}`, ARTICLE_ID, `hash-review-${index}`, iso, iso],
      );
    }
    await db.run(
      `INSERT INTO article_reviews (id, article_id, voter_hash, display_name, rating, body,
         status, moderation_reason, ip_hash, user_agent, created_at, updated_at)
       VALUES ('review_pending', ?, 'hash-pending', 'Held', 1, 'This must not count yet.', 'pending',
         'spam', NULL, NULL, ?, ?)`,
      [ARTICLE_ID, iso, iso],
    );
    for (let index = 0; index < 9; index += 1) {
      await db.run(
        `INSERT INTO article_votes (id, article_id, voter_hash, value, created_at, updated_at)
         VALUES (?, 'art_runner_up', ?, 1, ?, ?)`,
        [`vote_runner_${index}`, `hash-runner-${index}`, iso, iso],
      );
    }
    for (let index = 0; index < 20; index += 1) {
      await db.run(
        `INSERT INTO article_votes (id, article_id, voter_hash, value, created_at, updated_at)
         VALUES (?, 'art_last_week', ?, 1, ?, ?)`,
        [`vote_last_${index}`, `hash-last-${index}`, lastWeek, lastWeek],
      );
    }

    const entries = await leaderboard(25, 'Asia/Kolkata', now);
    const winner = entries.find((entry) => entry.id === ARTICLE_ID);
    const runnerUp = entries.find((entry) => entry.id === 'art_runner_up');
    expect(entries[0]?.id).toBe(ARTICLE_ID);
    expect(winner).toMatchObject({
      likes: 10,
      dislikes: 2,
      reviewCount: 12,
      averageRating: 5,
      score: 28, // (10 - 2) + (5 - 3) * min(12, 10)
      rank: 1,
    });
    expect(runnerUp).toMatchObject({ likes: 9, reviewCount: 0, score: 9, rank: 2 });
    expect(entries.some((entry) => entry.id === 'art_last_week')).toBe(false);
  });
});
