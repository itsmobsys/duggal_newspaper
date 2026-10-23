import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Db } from '../db/client.js';
import type { ArticleReviewRow } from '../db/types.js';
import { AppError, badRequest, notFound, tooManyRequests } from '../lib/errors.js';
import { newId } from '../lib/id.js';
import { consumeRateLimit } from '../lib/rate-limit.js';
import { containsAnyTerm, extractUrls, isLikelySpamText, stripHtmlLike } from '../lib/text.js';
import { nowIso } from '../lib/time.js';
import { loadSettings, type Settings } from '../settings.js';
import { revalidateWeb } from '../services/publishing.js';
import {
  sessionTokenFromRequest,
  validateUserSession,
  type SessionUser,
} from '../services/user-sessions.js';
import { assertSiteLive, clientIpHash } from './helpers.js';

/**
 * Reader engagement: one like/dislike and one written review per Discord member
 * per story. Identity comes from the reader session minted by the website; the
 * browser never sends a member id. Reads are public (counts and published
 * reviews); writes require a session.
 */

const VoteSchema = z.object({
  articleId: z.string().trim().min(4).max(80),
  value: z.union([z.literal(-1), z.literal(0), z.literal(1)]),
});

const ReviewSchema = z.object({
  articleId: z.string().trim().min(4).max(80),
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
  avatarUrl: string | null;
  rating: number;
  body: string;
  status: 'published' | 'pending' | 'hidden';
  createdAt: string;
  updatedAt: string;
}

async function optionalMember(db: Db, request: FastifyRequest): Promise<SessionUser | null> {
  return validateUserSession(db, sessionTokenFromRequest(request));
}

async function requireMember(db: Db, request: FastifyRequest): Promise<SessionUser> {
  const member = await optionalMember(db, request);
  if (!member) {
    throw new AppError(
      401,
      'AUTH_REQUIRED',
      'Log in with Discord to like, dislike or review a story.',
    );
  }
  return member;
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

async function voteTotals(db: Db, articleId: string, memberId: string | null): Promise<VoteTotals> {
  const row = await db.get<{ likes: number; dislikes: number }>(
    `SELECT
       COALESCE(SUM(CASE WHEN value = 1 THEN 1 ELSE 0 END), 0) AS likes,
       COALESCE(SUM(CASE WHEN value = -1 THEN 1 ELSE 0 END), 0) AS dislikes
     FROM article_votes WHERE article_id = ?`,
    [articleId],
  );

  let myVote: -1 | 1 | null = null;
  if (memberId) {
    const mine = await db.get<{ value: number }>(
      'SELECT value FROM article_votes WHERE article_id = ? AND member_id = ?',
      [articleId, memberId],
    );
    if (mine?.value === 1) myVote = 1;
    else if (mine?.value === -1) myVote = -1;
  }

  return {
    likes: Number(row?.likes ?? 0),
    dislikes: Number(row?.dislikes ?? 0),
    myVote,
  };
}

function publicReview(row: ArticleReviewRow): PublicReview {
  return {
    id: row.id,
    displayName: row.display_name,
    avatarUrl: row.avatar_url,
    rating: Number(row.rating),
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

export async function registerCommunityRoutes(app: FastifyInstance, db: Db): Promise<void> {
  // ------------------------------------------------------------------- votes
  app.get<{ Params: { articleId: string } }>('/public/votes/:articleId', async (request, reply) => {
    const article = await publishedArticle(db, request.params.articleId);
    const member = await optionalMember(db, request);
    const totals = await voteTotals(db, article.id, member?.memberId ?? null);
    reply.header('Cache-Control', 'no-store');
    return { articleId: article.id, ...totals, authenticated: Boolean(member) };
  });

  app.post('/public/votes', async (request, reply) => {
    const body = VoteSchema.parse(request.body ?? {});
    const member = await requireMember(db, request);
    await assertSiteLive(db);
    await guard(db, `vote:${member.memberId}`, 240, 3600, 'Too many votes. Try again later.');

    const article = await publishedArticle(db, body.articleId);
    const now = nowIso();

    if (body.value === 0) {
      await db.run('DELETE FROM article_votes WHERE article_id = ? AND member_id = ?', [
        article.id,
        member.memberId,
      ]);
    } else {
      await db.run(
        `INSERT INTO article_votes (id, article_id, member_id, value, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(article_id, member_id) DO UPDATE SET
           value = excluded.value,
           updated_at = excluded.updated_at`,
        [newId('vote'), article.id, member.memberId, body.value, now, now],
      );
    }

    reply.header('Cache-Control', 'no-store');
    return {
      articleId: article.id,
      ...(await voteTotals(db, article.id, member.memberId)),
      authenticated: true,
    };
  });

  // ----------------------------------------------------------------- reviews
  app.get('/public/reviews', async (request, reply) => {
    const query = ReviewQuerySchema.parse(request.query ?? {});
    const article = await publishedArticle(db, query.articleId);
    const member = await optionalMember(db, request);
    const limit = query.limit ?? 10;
    const offset = query.offset ?? 0;

    // Fetch one extra row to tell the UI whether "load more" is worth showing.
    const rows = await db.all<ArticleReviewRow>(
      `SELECT id, article_id, member_id, display_name, avatar_url, rating, body, status,
              moderation_reason, created_at, updated_at
         FROM article_reviews
        WHERE article_id = ? AND status = 'published'
        ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      [article.id, limit + 1, offset],
    );

    const myReview = member
      ? await db.get<ArticleReviewRow>(
          `SELECT id, article_id, member_id, display_name, avatar_url, rating, body, status,
                  moderation_reason, created_at, updated_at
             FROM article_reviews WHERE article_id = ? AND member_id = ?`,
          [article.id, member.memberId],
        )
      : undefined;

    reply.header('Cache-Control', 'no-store');
    return {
      articleId: article.id,
      summary: await reviewSummary(db, article.id),
      reviews: rows.slice(0, limit).map(publicReview),
      hasMore: rows.length > limit,
      myReview: myReview ? publicReview(myReview) : null,
      authenticated: Boolean(member),
      viewer: member ? { displayName: member.displayName, avatarUrl: member.avatarUrl } : null,
    };
  });

  app.post('/public/reviews', async (request, reply) => {
    const body = ReviewSchema.parse(request.body ?? {});
    assertNotBot(body);
    const member = await requireMember(db, request);
    await assertSiteLive(db);

    const settings = await loadSettings(db);
    if (!settings['community.reviews_enabled']) {
      throw badRequest('Reader reviews are switched off right now.', 'REVIEWS_DISABLED');
    }

    const maxChars = settings['community.review_max_chars'];
    const cleanBody = stripHtmlLike(body.body);
    if (cleanBody.length < 20) {
      throw badRequest('Write at least 20 characters. A reaction is not a review.');
    }
    if (cleanBody.length > maxChars) {
      throw badRequest(`Keep the review under ${maxChars} characters.`);
    }

    const ipHash = clientIpHash(request);
    await guard(
      db,
      `review:member:${member.memberId}`,
      6,
      3600,
      'Too many reviews. Try again later.',
    );
    await guard(db, `review:ip:${ipHash}`, 30, 3600, 'Too many reviews from this connection.');

    const article = await publishedArticle(db, body.articleId);
    const displayName = member.displayName.slice(0, 80);
    const moderation = moderateReview(cleanBody, displayName, settings);
    const now = nowIso();

    await db.run(
      `INSERT INTO article_reviews
         (id, article_id, member_id, display_name, avatar_url, rating, body, status,
          moderation_reason, ip_hash, user_agent, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(article_id, member_id) DO UPDATE SET
         display_name = excluded.display_name,
         avatar_url = excluded.avatar_url,
         rating = excluded.rating,
         body = excluded.body,
         status = excluded.status,
         moderation_reason = excluded.moderation_reason,
         ip_hash = excluded.ip_hash,
         user_agent = excluded.user_agent,
         updated_at = excluded.updated_at`,
      [
        newId('rev'),
        article.id,
        member.memberId,
        displayName,
        member.avatarUrl,
        body.rating,
        cleanBody,
        moderation.status,
        moderation.reason,
        ipHash,
        (request.headers['user-agent'] ?? '').slice(0, 300),
        now,
        now,
      ],
    );

    const saved = await db.get<ArticleReviewRow>(
      `SELECT id, article_id, member_id, display_name, avatar_url, rating, body, status,
              moderation_reason, created_at, updated_at
         FROM article_reviews WHERE article_id = ? AND member_id = ?`,
      [article.id, member.memberId],
    );
    if (!saved) throw new AppError(500, 'REVIEW_NOT_SAVED', 'The review could not be saved.');

    // The article page server-renders the summary and JSON-LD, so a new review
    // should invalidate it. Votes are reflected client-side instead.
    void revalidateWeb([`/article/${article.slug}`]);

    reply.code(201);
    reply.header('Cache-Control', 'no-store');
    return {
      review: publicReview(saved),
      summary: await reviewSummary(db, article.id),
      published: moderation.status === 'published',
      message:
        moderation.status === 'published'
          ? 'Review published. Try to be interesting.'
          : 'Your review is held for a human because it looks like spam or contains a blocked phrase.',
      authenticated: true,
    };
  });

  app.delete<{ Params: { articleId: string } }>(
    '/public/reviews/:articleId',
    async (request, reply) => {
      const member = await requireMember(db, request);
      await assertSiteLive(db);
      const article = await publishedArticle(db, request.params.articleId);
      const result = await db.run(
        'DELETE FROM article_reviews WHERE article_id = ? AND member_id = ?',
        [article.id, member.memberId],
      );
      if (result.rowsAffected === 0) throw notFound('You have not reviewed this story.');

      void revalidateWeb([`/article/${article.slug}`]);
      reply.header('Cache-Control', 'no-store');
      return { ok: true, summary: await reviewSummary(db, article.id) };
    },
  );
}
