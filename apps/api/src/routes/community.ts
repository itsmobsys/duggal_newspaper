import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Db } from '../db/client.js';
import type { ArticleReviewRow } from '../db/types.js';
import { hashVoterToken } from '../lib/crypto.js';
import { AppError, badRequest, notFound, tooManyRequests } from '../lib/errors.js';
import { newId } from '../lib/id.js';
import { consumeRateLimit } from '../lib/rate-limit.js';
import {
  containsAnyTerm,
  extractUrls,
  isLikelySpamText,
  sanitizeUserText,
  stripHtmlLike,
} from '../lib/text.js';
import { nowIso } from '../lib/time.js';
import { loadSettings, type Settings } from '../settings.js';
import { revalidateWeb } from '../services/publishing.js';
import { clientIpHash } from './helpers.js';

const VoteSchema = z.object({
  articleId: z.string().trim().min(4).max(80),
  value: z.union([z.literal(-1), z.literal(0), z.literal(1)]),
});

const ReviewSchema = z.object({
  articleId: z.string().trim().min(4).max(80),
  displayName: z.string().trim().max(40).optional().or(z.literal('')),
  rating: z.number().int().min(1).max(5),
  body: z.string().trim().min(20).max(3000),
  website: z.string().max(200).optional(),
  formStartedAt: z.number().int().optional(),
});

const ReviewQuerySchema = z.object({
  articleId: z.string().trim().min(4).max(80),
  limit: z.coerce.number().int().min(1).max(50).optional(),
  offset: z.coerce.number().int().min(0).max(10_000).optional(),
});

interface VoteTotals {
  likes: number;
  dislikes: number;
  myVote: -1 | 1 | null;
}

interface ReviewSummary {
  count: number;
  average: number;
  distribution: Array<{ rating: number; count: number }>;
}

interface PublicReview {
  id: string;
  displayName: string | null;
  rating: number;
  body: string;
  status: 'published' | 'pending' | 'hidden';
  createdAt: string;
  updatedAt: string;
}

const VOTER_PATTERN = /^[A-Za-z0-9_-]{20,120}$/;

function voterHash(request: FastifyRequest): string {
  const header = request.headers['x-voter-token'];
  const token = Array.isArray(header) ? header[0] : header;
  if (!token || !VOTER_PATTERN.test(token)) {
    throw badRequest('A browser identity is required for this action.', 'VOTER_REQUIRED');
  }
  return hashVoterToken(token);
}

async function guard(
  db: Db,
  key: string,
  limit: number,
  windowSeconds: number,
  message: string,
): Promise<void> {
  const result = await consumeRateLimit(db, key, limit, windowSeconds);
  if (!result.allowed) {
    throw new AppError(429, 'RATE_LIMITED', message, {
      details: { retryAfterSeconds: result.retryAfterSeconds, resetAt: result.resetAt },
    });
  }
}

function assertNotBot(body: { website?: string; formStartedAt?: number }): void {
  if (body.website && body.website.trim().length > 0) {
    throw badRequest('Spam check failed.', 'SPAM_DETECTED');
  }
  if (body.formStartedAt) {
    const elapsed = Date.now() - body.formStartedAt;
    if (elapsed >= 0 && elapsed < 2000) {
      throw tooManyRequests('That was suspiciously fast. Take a breath and try again.', 5);
    }
  }
}

async function publishedArticle(db: Db, articleId: string): Promise<{ id: string; slug: string }> {
  const article = await db.get<{ id: string; slug: string; status: string }>(
    'SELECT id, slug, status FROM articles WHERE id = ?',
    [articleId],
  );
  if (!article || article.status !== 'published') throw notFound('Article not found.');
  return article;
}

async function voteTotals(db: Db, articleId: string, hash: string): Promise<VoteTotals> {
  const row = await db.get<{ likes: number; dislikes: number }>(
    `SELECT
       COALESCE(SUM(CASE WHEN value = 1 THEN 1 ELSE 0 END), 0) AS likes,
       COALESCE(SUM(CASE WHEN value = -1 THEN 1 ELSE 0 END), 0) AS dislikes
     FROM article_votes WHERE article_id = ?`,
    [articleId],
  );
  const mine = await db.get<{ value: number }>(
    'SELECT value FROM article_votes WHERE article_id = ? AND voter_hash = ?',
    [articleId, hash],
  );
  return {
    likes: Number(row?.likes ?? 0),
    dislikes: Number(row?.dislikes ?? 0),
    myVote: mine?.value === 1 ? 1 : mine?.value === -1 ? -1 : null,
  };
}

function publicReview(row: ArticleReviewRow): PublicReview {
  return {
    id: row.id,
    displayName: row.display_name,
    rating: row.rating,
    body: row.body,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function reviewSummary(db: Db, articleId: string): Promise<ReviewSummary> {
  const rows = await db.all<{ rating: number; count: number }>(
    `SELECT rating, COUNT(*) AS count FROM article_reviews
     WHERE article_id = ? AND status = 'published'
     GROUP BY rating ORDER BY rating ASC`,
    [articleId],
  );
  const byRating = new Map(rows.map((row) => [Number(row.rating), Number(row.count)]));
  let count = 0;
  let total = 0;
  const distribution = [1, 2, 3, 4, 5].map((rating) => {
    const ratingCount = byRating.get(rating) ?? 0;
    count += ratingCount;
    total += rating * ratingCount;
    return { rating, count: ratingCount };
  });
  return {
    count,
    average: count > 0 ? Math.round((total / count) * 100) / 100 : 0,
    distribution,
  };
}

function moderateReview(
  body: string,
  displayName: string | null,
  settings: Settings,
): { status: 'published' | 'pending'; reason: string | null } {
  const terms = [...settings['content.banned_words'], ...settings['content.hold_keywords']];
  const text = `${displayName ?? ''}\n${body}`;
  if (containsAnyTerm(text, terms).length > 0) {
    return { status: 'pending', reason: 'banned_words' };
  }
  if (extractUrls(body).length > 0 || /\bwww\.[^\s]+/i.test(body)) {
    return { status: 'pending', reason: 'links' };
  }
  if (isLikelySpamText(body)) {
    return { status: 'pending', reason: 'spam' };
  }
  return { status: 'published', reason: null };
}

let lastLeaderboardRevalidation = 0;

/** Votes can arrive in bursts; one cache bust every 30 seconds is enough. */
function revalidateLeaderboardSoon(): void {
  const now = Date.now();
  if (now - lastLeaderboardRevalidation < 30_000) return;
  lastLeaderboardRevalidation = now;
  void revalidateWeb(['/leaderboard']);
}

export async function registerCommunityRoutes(app: FastifyInstance, db: Db): Promise<void> {
  // ------------------------------------------------------------------- votes
  app.get<{ Params: { articleId: string } }>('/public/votes/:articleId', async (request, reply) => {
    const article = await publishedArticle(db, request.params.articleId);
    const totals = await voteTotals(db, article.id, voterHash(request));
    reply.header('Cache-Control', 'no-store');
    return { articleId: article.id, ...totals };
  });

  app.post('/public/votes', async (request, reply) => {
    const body = VoteSchema.parse(request.body ?? {});
    const hash = voterHash(request);
    const ipHash = clientIpHash(request);
    const settings = await loadSettings(db);
    if (!settings['community.voting_enabled']) {
      throw new AppError(403, 'VOTING_DISABLED', 'Voting is switched off right now.');
    }

    await guard(db, `vote:voter:${hash}`, 120, 3600, 'You are voting very quickly. Try later.');
    await guard(db, `vote:ip:${ipHash}`, 300, 3600, 'Too many votes from this connection.');

    const article = await publishedArticle(db, body.articleId);
    const now = nowIso();

    if (body.value === 0) {
      await db.run('DELETE FROM article_votes WHERE article_id = ? AND voter_hash = ?', [
        article.id,
        hash,
      ]);
    } else {
      await db.run(
        `INSERT INTO article_votes (id, article_id, voter_hash, value, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(article_id, voter_hash) DO UPDATE SET
           value = excluded.value,
           updated_at = excluded.updated_at`,
        [newId('vote'), article.id, hash, body.value, now, now],
      );
    }

    revalidateLeaderboardSoon();
    reply.header('Cache-Control', 'no-store');
    return { articleId: article.id, ...(await voteTotals(db, article.id, hash)) };
  });

  // ----------------------------------------------------------------- reviews
  app.get('/public/reviews', async (request, reply) => {
    const query = ReviewQuerySchema.parse(request.query ?? {});
    const article = await publishedArticle(db, query.articleId);
    const limit = query.limit ?? 10;
    const offset = query.offset ?? 0;
    const hash = voterHash(request);

    const [summary, reviews, mine] = await Promise.all([
      reviewSummary(db, article.id),
      db.all<ArticleReviewRow>(
        `SELECT * FROM article_reviews
         WHERE article_id = ? AND status = 'published'
         ORDER BY created_at DESC LIMIT ? OFFSET ?`,
        [article.id, limit, offset],
      ),
      db.get<ArticleReviewRow>(
        'SELECT * FROM article_reviews WHERE article_id = ? AND voter_hash = ?',
        [article.id, hash],
      ),
    ]);

    reply.header('Cache-Control', 'no-store');
    return {
      articleId: article.id,
      summary,
      reviews: reviews.map(publicReview),
      myReview: mine ? publicReview(mine) : null,
      limit,
      offset,
    };
  });

  app.post('/public/reviews', async (request, reply) => {
    const body = ReviewSchema.parse(request.body ?? {});
    assertNotBot(body);
    const hash = voterHash(request);
    const ipHash = clientIpHash(request);
    const settings = await loadSettings(db);
    if (!settings['community.reviews_enabled']) {
      throw new AppError(403, 'REVIEWS_DISABLED', 'Reviews are switched off right now.');
    }

    await guard(db, `review:voter:${hash}`, 5, 3600, 'Too many reviews. Try again later.');
    await guard(db, `review:voter:day:${hash}`, 20, 86400, 'Daily review limit reached.');
    await guard(db, `review:ip:${ipHash}`, 10, 3600, 'Too many reviews from this connection.');
    await guard(db, `review:ip:day:${ipHash}`, 30, 86400, 'Daily review limit reached.');

    const article = await publishedArticle(db, body.articleId);
    const maxChars = settings['community.review_max_chars'];
    const cleanBody = sanitizeUserText(stripHtmlLike(body.body)).slice(0, maxChars);
    if (cleanBody.length < 20) {
      throw badRequest('Review is too short after cleanup.', 'REVIEW_TOO_SHORT');
    }

    const displayName = body.displayName
      ? sanitizeUserText(stripHtmlLike(body.displayName)).slice(0, 40) || null
      : null;
    const moderation = moderateReview(cleanBody, displayName, settings);
    const existing = await db.get<ArticleReviewRow>(
      'SELECT * FROM article_reviews WHERE article_id = ? AND voter_hash = ?',
      [article.id, hash],
    );
    // Editing a review that a human hid sends it back to the queue, rather than
    // letting the author silently un-hide it.
    const status = existing?.status === 'hidden' ? 'pending' : moderation.status;
    const reason = existing?.status === 'hidden' ? 'edited_after_hide' : moderation.reason;
    const now = nowIso();
    const id = existing?.id ?? newId('rev');

    if (existing) {
      await db.run(
        `UPDATE article_reviews
         SET display_name = ?, rating = ?, body = ?, status = ?, moderation_reason = ?,
             ip_hash = ?, user_agent = ?, updated_at = ?
         WHERE id = ?`,
        [
          displayName,
          body.rating,
          cleanBody,
          status,
          reason,
          ipHash,
          (request.headers['user-agent'] ?? '').slice(0, 300),
          now,
          id,
        ],
      );
    } else {
      await db.run(
        `INSERT INTO article_reviews (id, article_id, voter_hash, display_name, rating, body,
           status, moderation_reason, ip_hash, user_agent, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          article.id,
          hash,
          displayName,
          body.rating,
          cleanBody,
          status,
          reason,
          ipHash,
          (request.headers['user-agent'] ?? '').slice(0, 300),
          now,
          now,
        ],
      );
    }

    const saved = await db.get<ArticleReviewRow>('SELECT * FROM article_reviews WHERE id = ?', [
      id,
    ]);
    if (!saved) throw new Error('Review write failed.');
    revalidateLeaderboardSoon();
    reply.code(existing ? 200 : 201);
    reply.header('Cache-Control', 'no-store');
    return {
      review: publicReview(saved),
      published: saved.status === 'published',
      message:
        saved.status === 'published'
          ? existing
            ? 'Review updated.'
            : 'Review published.'
          : 'Review held for moderation.',
      summary: await reviewSummary(db, article.id),
    };
  });

  app.delete<{ Params: { articleId: string } }>(
    '/public/reviews/:articleId',
    async (request, reply) => {
      const hash = voterHash(request);
      await guard(db, `review:delete:${hash}`, 30, 3600, 'Too many review changes.');
      const article = await publishedArticle(db, request.params.articleId);
      await db.run('DELETE FROM article_reviews WHERE article_id = ? AND voter_hash = ?', [
        article.id,
        hash,
      ]);
      revalidateLeaderboardSoon();
      reply.header('Cache-Control', 'no-store');
      return { ok: true, summary: await reviewSummary(db, article.id) };
    },
  );
}
