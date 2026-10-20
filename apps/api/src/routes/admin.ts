import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { config } from '../config.js';
import type { Db } from '../db/client.js';
import type {
  AdminSessionRow,
  AdminUserRow,
  ArticleImageRow,
  ArticleReviewRow,
  ArticleRow,
  AwardRow,
  CategoryRow,
  CorrectionRow,
  EditionRow,
  ReportRow,
  SubmissionRow,
} from '../db/types.js';
import { AiUnavailableError } from '../lib/errors.js';
import { hashToken, verifyPassword } from '../lib/crypto.js';
import { AppError, badRequest, notFound, unauthorized } from '../lib/errors.js';
import { logger } from '../lib/logger.js';
import { newId, randomToken } from '../lib/id.js';
import { consumeRateLimit } from '../lib/rate-limit.js';
import { isSafeExternalUrl, sanitizeUserText, slugify, stripHtmlLike } from '../lib/text.js';
import { editionDateFor, nowIso } from '../lib/time.js';
import {
  SETTING_DEFS,
  invalidateSettingsCache,
  loadSettings,
  settingDefinitions,
  updateSettings,
} from '../settings.js';
import { checkModelAvailability } from '../services/ai/client.js';
import { AiResultSchema, type AiResult } from '../services/ai/schema.js';
import { publishArticle, revalidateWeb } from '../services/publishing.js';
import { enqueueJob, listJobs, queueStats, retryJob } from '../services/queue.js';
import { getSubmissionWithImages, AI_PAUSED_REASON } from '../services/process-submission.js';
import { asStore, readObject, storageStatus } from '../services/storage.js';
import { pruneOriginals } from '../services/storage-maintenance.js';
import { clearStorageDegraded, getStorageUsage } from '../services/storage-usage.js';
import { kickWorkerTick, runWorkerTick } from '../services/worker.js';
import { clientIpHash, parsePagination, writeAudit, type AdminContext } from './helpers.js';

const LoginSchema = z.object({
  email: z.string().trim().email().max(200),
  password: z.string().min(8).max(200),
});

const PruneSchema = z.object({
  force: z.boolean().optional(),
  limit: z.number().int().min(1).max(100).optional(),
});

const SubmissionActionSchema = z.object({
  reason: z.string().trim().max(600).optional(),
});

const ManualPublishSchema = z.object({
  headline: z.string().trim().min(6).max(200).optional(),
  dek: z.string().trim().max(320).optional(),
  body: z.string().trim().min(40).max(30_000).optional(),
  categorySlug: z.string().trim().max(64).optional(),
  tags: z.array(z.string().trim().max(32)).max(8).optional(),
  breaking: z.boolean().optional(),
  placement: z.enum(['lead', 'top', 'standard']).optional(),
  editorNote: z.string().trim().max(220).optional(),
  captions: z.array(z.string().max(240)).max(8).optional(),
});

const EditorOverrideSchema = z.object({
  note: z.string().trim().max(600).optional(),
});

const ArticlePatchSchema = z.object({
  headline: z.string().trim().min(6).max(200).optional(),
  dek: z.string().trim().max(320).optional(),
  body: z.string().trim().min(40).max(40_000).optional(),
  categorySlug: z.string().trim().max(64).optional(),
  tags: z.array(z.string().trim().max(32)).max(10).optional(),
  breaking: z.boolean().optional(),
  featured: z.boolean().optional(),
  placement: z.enum(['lead', 'top', 'standard']).optional(),
  editorNote: z.string().trim().max(220).optional(),
  sourceUrl: z.string().trim().max(2048).optional(),
  status: z.enum(['draft', 'published', 'unpublished', 'deleted']).optional(),
  publishedAt: z.string().trim().max(40).optional(),
});

const CategorySchema = z.object({
  slug: z.string().trim().min(2).max(64).optional(),
  name: z.string().trim().min(2).max(80),
  description: z.string().trim().max(400).optional(),
  accent: z.string().trim().max(20).optional(),
  sortOrder: z.number().int().min(0).max(999).optional(),
  enabled: z.boolean().optional(),
});

const AwardSchema = z.object({
  title: z.string().trim().min(3).max(80),
  category: z.string().trim().max(40).optional(),
  winnerName: z.string().trim().min(1).max(80),
  citation: z.string().trim().max(400).optional(),
  articleId: z.string().trim().max(80).optional(),
  editionDate: z.string().trim().max(20).optional(),
  active: z.boolean().optional(),
  sortOrder: z.number().int().min(0).max(999).optional(),
});

const CorrectionActionSchema = z.object({
  status: z.enum(['accepted', 'rejected']),
  note: z.string().trim().max(1000).optional(),
});

const ReportActionSchema = z.object({
  status: z.enum(['open', 'resolved', 'dismissed']),
  note: z.string().trim().max(1000).optional(),
});

const ReviewModerationSchema = z.object({
  status: z.enum(['published', 'pending', 'hidden']),
});

const SettingsSchema = z.record(z.unknown());

/**
 * "Build the paper now" takes no meaningful options: it processes every waiting
 * submission and rebuilds the edition the front page is currently showing.
 * `editionDate` exists for maintenance (rebuilding yesterday after a bad run).
 */
const PublishNowSchema = z.object({
  editionDate: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});

function parseReviewReasons(value: string | null): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function parseJsonObject(value: string | null): unknown {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

async function requireAdmin(db: Db, request: FastifyRequest): Promise<AdminContext> {
  const token = request.headers['x-admin-session'];
  if (!token || Array.isArray(token)) {
    throw unauthorized('Admin session missing.', 'ADMIN_SESSION_MISSING');
  }
  const session = await db.get<AdminSessionRow & { user_id: string }>(
    `SELECT * FROM admin_sessions WHERE token_hash = ? AND revoked = 0 AND expires_at > ?`,
    [hashToken(token), nowIso()],
  );
  if (!session)
    throw unauthorized('Admin session expired. Sign in again.', 'ADMIN_SESSION_INVALID');

  const user = await db.get<AdminUserRow>('SELECT * FROM admin_users WHERE id = ?', [
    session.user_id,
  ]);
  if (!user || user.disabled === 1) {
    throw unauthorized('Admin account is disabled.', 'ADMIN_DISABLED');
  }
  return { user, sessionId: session.id };
}

function adminId(ctx: AdminContext): string {
  return ctx.user.email;
}

export async function registerAdminRoutes(app: FastifyInstance, db: Db): Promise<void> {
  // ------------------------------------------------------------------- auth
  app.post('/admin/auth/login', async (request, reply) => {
    const body = LoginSchema.parse(request.body ?? {});
    const ipHash = clientIpHash(request);

    const ipLimit = await consumeRateLimit(db, `login:ip:${ipHash}`, 8, 900);
    if (!ipLimit.allowed) {
      throw new AppError(429, 'RATE_LIMITED', 'Too many login attempts. Wait 15 minutes.', {
        details: { retryAfterSeconds: ipLimit.retryAfterSeconds },
      });
    }
    const emailLimit = await consumeRateLimit(
      db,
      `login:email:${body.email.toLowerCase()}`,
      5,
      900,
    );
    if (!emailLimit.allowed) {
      throw new AppError(429, 'RATE_LIMITED', 'Too many login attempts for this account.', {
        details: { retryAfterSeconds: emailLimit.retryAfterSeconds },
      });
    }

    const user = await db.get<AdminUserRow>(
      'SELECT * FROM admin_users WHERE lower(email) = lower(?)',
      [body.email],
    );
    const dummyHash =
      'scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
    const valid = user
      ? await verifyPassword(body.password, user.password_hash)
      : (await verifyPassword(body.password, dummyHash)) && false;

    if (!user || !valid || user.disabled === 1) {
      await writeAudit(db, {
        actor: 'anonymous',
        action: 'admin.login.failed',
        targetType: 'admin_user',
        targetId: body.email,
        ipHash,
      });
      throw unauthorized('Invalid email or password.', 'LOGIN_FAILED');
    }

    const token = randomToken(32);
    const expiresAt = new Date(
      Date.now() + config.adminSessionTtlHours * 3600 * 1000,
    ).toISOString();
    await db.run(
      `INSERT INTO admin_sessions (id, user_id, token_hash, expires_at, ip_hash, user_agent, revoked, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 0, ?)`,
      [
        newId('sess'),
        user.id,
        hashToken(token),
        expiresAt,
        ipHash,
        (request.headers['user-agent'] ?? '').slice(0, 300),
        nowIso(),
      ],
    );
    await db.run('UPDATE admin_users SET last_login_at = ?, updated_at = ? WHERE id = ?', [
      nowIso(),
      nowIso(),
      user.id,
    ]);
    await writeAudit(db, {
      actor: user.email,
      action: 'admin.login',
      targetType: 'admin_user',
      targetId: user.id,
      ipHash,
    });

    reply.header('Cache-Control', 'no-store');
    return {
      token,
      expiresAt,
      user: { id: user.id, email: user.email, name: user.name, role: user.role },
    };
  });

  app.post('/admin/auth/logout', async (request, reply) => {
    const ctx = await requireAdmin(db, request);
    await db.run('UPDATE admin_sessions SET revoked = 1 WHERE id = ?', [ctx.sessionId]);
    await writeAudit(db, {
      actor: adminId(ctx),
      action: 'admin.logout',
      targetType: 'admin_session',
      targetId: ctx.sessionId,
      ipHash: clientIpHash(request),
    });
    reply.header('Cache-Control', 'no-store');
    return { ok: true };
  });

  app.get('/admin/me', async (request) => {
    const ctx = await requireAdmin(db, request);
    return {
      user: {
        id: ctx.user.id,
        email: ctx.user.email,
        name: ctx.user.name,
        role: ctx.user.role,
      },
    };
  });

  // ------------------------------------------------------------------- stats
  app.get('/admin/stats', async (request) => {
    await requireAdmin(db, request);
    const settings = await loadSettings(db);
    const [submissions, articles, queue, reports, corrections, ai, editions] = await Promise.all([
      db.all<{ status: string; count: number }>(
        'SELECT status, COUNT(*) as count FROM submissions GROUP BY status',
      ),
      db.get<{ total: number; published: number; breaking: number }>(
        `SELECT COUNT(*) as total,
           SUM(CASE WHEN status = 'published' THEN 1 ELSE 0 END) as published,
           SUM(CASE WHEN breaking = 1 AND status = 'published' THEN 1 ELSE 0 END) as breaking
         FROM articles`,
      ),
      queueStats(db),
      db.get<{ count: number }>(`SELECT COUNT(*) as count FROM reports WHERE status = 'open'`),
      db.get<{ count: number }>(
        `SELECT COUNT(*) as count FROM corrections WHERE status = 'pending'`,
      ),
      db.get<{ calls: number; tokens: number; errors: number }>(
        `SELECT COUNT(*) as calls, COALESCE(SUM(total_tokens),0) as tokens,
           SUM(CASE WHEN status != 'ok' THEN 1 ELSE 0 END) as errors
         FROM ai_usage WHERE created_at >= ?`,
        [new Date(Date.now() - 86400 * 1000).toISOString()],
      ),
      db.get<{ count: number }>(`SELECT COUNT(*) as count FROM editions`),
    ]);

    const statusMap = new Map(submissions.map((row) => [row.status, Number(row.count)]));
    return {
      submissions: {
        total: [...statusMap.values()].reduce((sum, value) => sum + value, 0),
        received: statusMap.get('received') ?? 0,
        processing: statusMap.get('processing') ?? 0,
        review: statusMap.get('queued_review') ?? 0,
        published: statusMap.get('published') ?? 0,
        rejected: statusMap.get('rejected') ?? 0,
        failed: statusMap.get('failed') ?? 0,
      },
      articles: {
        total: Number(articles?.total ?? 0),
        published: Number(articles?.published ?? 0),
        breaking: Number(articles?.breaking ?? 0),
      },
      queue,
      reports: Number(reports?.count ?? 0),
      corrections: Number(corrections?.count ?? 0),
      ai: {
        configured: Boolean(config.ai.apiKey),
        model: config.ai.model,
        calls24h: Number(ai?.calls ?? 0),
        tokens24h: Number(ai?.tokens ?? 0),
        errors24h: Number(ai?.errors ?? 0),
      },
      editions: Number(editions?.count ?? 0),
      autonomy: {
        enabled: settings['autonomy.enabled'],
        autoPublish: settings['content.auto_publish'],
        editionHour: settings['autonomy.edition_hour'],
        timezone: settings['site.timezone'],
      },
      storage: { ...storageStatus() },
    };
  });

  // ------------------------------------------------------------- submissions
  app.get('/admin/submissions', async (request) => {
    await requireAdmin(db, request);
    const query = request.query as Record<string, string | undefined>;
    const { limit, offset } = parsePagination(query);
    const status = (query.status ?? '').trim();
    const clauses: string[] = [];
    const args: Array<string | number> = [];
    if (status) {
      clauses.push('s.status = ?');
      args.push(status);
    }
    if (query.q) {
      clauses.push('(s.headline LIKE ? OR s.story LIKE ? OR s.author_name LIKE ?)');
      const needle = `%${query.q.slice(0, 100)}%`;
      args.push(needle, needle, needle);
    }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const rows = await db.all<SubmissionRow & { image_count: number }>(
      `SELECT s.*, (SELECT COUNT(*) FROM submission_images si WHERE si.submission_id = s.id) as image_count
       FROM submissions s ${where} ORDER BY s.created_at DESC LIMIT ? OFFSET ?`,
      [...args, limit, offset],
    );
    const total = await db.get<{ count: number }>(
      `SELECT COUNT(*) as count FROM submissions s ${where}`,
      args,
    );
    return {
      total: Number(total?.count ?? 0),
      submissions: rows.map((row) => ({
        id: row.id,
        headline: row.headline,
        authorName: row.author_name,
        discordHandle: row.discord_handle,
        anonymous: row.anonymous === 1,
        category: row.category_slug,
        status: row.status,
        spamScore: row.spam_score,
        reviewReasons: parseReviewReasons(row.review_reasons),
        aiModel: row.ai_model,
        aiAttempts: row.ai_attempts,
        aiLastError: row.ai_last_error,
        articleId: row.article_id,
        imageCount: Number(row.image_count ?? 0),
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      })),
    };
  });

  app.get<{ Params: { id: string } }>('/admin/submissions/:id', async (request) => {
    await requireAdmin(db, request);
    const data = await getSubmissionWithImages(db, request.params.id);
    if (!data) throw notFound('Submission not found.');
    const { submission, images, article } = data;
    return {
      submission: {
        ...submission,
        anonymous: submission.anonymous === 1,
        reviewReasons: parseReviewReasons(submission.review_reasons),
        aiResult: parseJsonObject(submission.ai_result),
        story: submission.story,
      },
      images,
      article,
    };
  });

  app.post<{ Params: { id: string } }>('/admin/submissions/:id/retry', async (request) => {
    const ctx = await requireAdmin(db, request);
    const data = await getSubmissionWithImages(db, request.params.id);
    if (!data) throw notFound('Submission not found.');
    if (data.submission.status === 'published') {
      return { ok: true, message: 'Already published.' };
    }
    await db.run(
      `UPDATE submissions SET status = 'received', ai_last_error = NULL, processed_at = NULL,
         updated_at = ? WHERE id = ?`,
      [nowIso(), request.params.id],
    );
    await enqueueJob(db, {
      type: 'process_submission',
      payload: { submissionId: request.params.id, manual: true },
      idempotencyKey: `process:${request.params.id}`,
      priority: 6,
    });
    await db.run(
      `UPDATE jobs SET status = 'pending', attempts = 0, run_at = ?, locked_until = NULL,
         locked_by = NULL, last_error = NULL, finished_at = NULL, updated_at = ?
       WHERE idempotency_key = ? AND status != 'done'`,
      [nowIso(), nowIso(), `process:${request.params.id}`],
    );
    await writeAudit(db, {
      actor: adminId(ctx),
      action: 'submission.retry',
      targetType: 'submission',
      targetId: request.params.id,
      ipHash: clientIpHash(request),
    });
    void runWorkerTick({ maxJobs: 2 });
    return { ok: true };
  });

  /**
   * "Run it anyway": a human has read the desk's flags and wants the AI to
   * rewrite the story with those concerns cleared. The flags are copied into
   * the override columns before `review_reasons` is emptied, so the audit trail
   * keeps exactly what was waived.
   */
  app.post<{ Params: { id: string } }>('/admin/submissions/:id/approve', async (request) => {
    const ctx = await requireAdmin(db, request);
    const body = EditorOverrideSchema.parse(request.body ?? {});
    const data = await getSubmissionWithImages(db, request.params.id);
    if (!data) throw notFound('Submission not found.');
    if (data.submission.status === 'published') {
      return { ok: true, message: 'Already published.', cleared: 0 };
    }

    const reasons = parseReviewReasons(data.submission.review_reasons);
    const now = nowIso();
    await db.run(
      `UPDATE submissions SET status = 'received', review_reason = NULL, review_reasons = NULL,
         ai_last_error = NULL, processed_at = NULL, ai_attempts = 0,
         editor_override_at = ?, editor_override_by = ?, editor_override_note = ?,
         editor_override_reasons = ?, updated_at = ? WHERE id = ?`,
      [now, adminId(ctx), body.note ?? null, JSON.stringify(reasons), now, request.params.id],
    );

    const idempotencyKey = `process:${request.params.id}:override:${Math.floor(Date.now() / 60_000)}`;
    await enqueueJob(db, {
      type: 'process_submission',
      payload: { submissionId: request.params.id, manual: true, editorOverride: true },
      idempotencyKey,
      priority: 6,
    });
    await db.run(
      `UPDATE jobs SET status = 'pending', attempts = 0, run_at = ?, locked_until = NULL,
         locked_by = NULL, last_error = NULL, finished_at = NULL, updated_at = ?
       WHERE idempotency_key = ? AND status != 'done'`,
      [now, now, idempotencyKey],
    );
    await writeAudit(db, {
      actor: adminId(ctx),
      action: 'submission.override',
      targetType: 'submission',
      targetId: request.params.id,
      detail: { reasons, note: body.note ?? null },
      ipHash: clientIpHash(request),
    });
    void runWorkerTick({ maxJobs: 2 });
    return { ok: true, cleared: reasons.length };
  });

  app.post<{ Params: { id: string } }>('/admin/submissions/:id/reject', async (request) => {
    const ctx = await requireAdmin(db, request);
    const body = SubmissionActionSchema.parse(request.body ?? {});
    const result = await db.run(
      `UPDATE submissions SET status = 'rejected', review_reason = ?, updated_at = ?
       WHERE id = ? AND status != 'published'`,
      [body.reason ?? 'Rejected by an editor.', nowIso(), request.params.id],
    );
    if (result.rowsAffected === 0) throw notFound('Submission not found or already published.');
    await writeAudit(db, {
      actor: adminId(ctx),
      action: 'submission.reject.manual',
      targetType: 'submission',
      targetId: request.params.id,
      detail: { reason: body.reason },
      ipHash: clientIpHash(request),
    });
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>('/admin/submissions/:id/publish', async (request) => {
    const ctx = await requireAdmin(db, request);
    const body = ManualPublishSchema.parse(request.body ?? {});
    const data = await getSubmissionWithImages(db, request.params.id);
    if (!data) throw notFound('Submission not found.');
    const { submission, images } = data;
    if (data.article) return { ok: true, article: data.article, created: false };

    const settings = await loadSettings(db);
    const categories = await db.all<CategoryRow>('SELECT slug FROM categories WHERE enabled = 1');
    const enabled = new Set(categories.map((category) => category.slug));
    const categorySlug = body.categorySlug ?? submission.category_slug ?? 'server-news';
    if (!enabled.has(categorySlug)) throw badRequest('Unknown or disabled category.');

    const stored = parseJsonObject(submission.ai_result);
    const parsedAi = stored ? AiResultSchema.safeParse(stored) : null;
    const baseAi: AiResult = parsedAi?.success
      ? parsedAi.data
      : {
          headline: submission.headline,
          dek: '',
          body: submission.story,
          category: categorySlug,
          tags: [],
          breaking: false,
          breaking_reason: '',
          review: { needed: false, reasons: [] },
          summary: '',
        };

    const imageRows = images.map((image, index) => ({
      ...image,
      caption: body.captions?.[index] ?? image.caption,
    }));

    const published = await publishArticle(db, {
      submission,
      images: imageRows,
      ai: {
        ...baseAi,
        category: categorySlug,
      },
      settings,
      breaking: body.breaking ?? false,
      actor: adminId(ctx),
      overrides: {
        headline: body.headline,
        dek: body.dek,
        body: body.body,
        categorySlug,
        tags: body.tags,
        placement: body.placement,
        editorNote: body.editorNote,
      },
    });

    await writeAudit(db, {
      actor: adminId(ctx),
      action: 'submission.publish.manual',
      targetType: 'submission',
      targetId: submission.id,
      detail: { articleId: published.article.id },
      ipHash: clientIpHash(request),
    });
    return { ok: true, article: published.article, created: published.created };
  });

  // ---------------------------------------------------------------- articles
  app.get('/admin/articles', async (request) => {
    await requireAdmin(db, request);
    const query = request.query as Record<string, string | undefined>;
    const { limit, offset } = parsePagination(query);
    const clauses: string[] = [];
    const args: Array<string | number> = [];
    if (query.status) {
      clauses.push('status = ?');
      args.push(query.status);
    }
    if (query.q) {
      clauses.push('(headline LIKE ? OR author_display LIKE ?)');
      args.push(`%${query.q.slice(0, 100)}%`, `%${query.q.slice(0, 100)}%`);
    }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const rows = await db.all<ArticleRow>(
      `SELECT id, slug, headline, dek, category_slug, author_display, breaking, featured, placement,
        status, edition_date, published_at, views, created_at, updated_at
       FROM articles ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      [...args, limit, offset],
    );
    const total = await db.get<{ count: number }>(
      `SELECT COUNT(*) as count FROM articles ${where}`,
      args,
    );
    return { total: Number(total?.count ?? 0), articles: rows };
  });

  app.get<{ Params: { id: string } }>('/admin/articles/:id', async (request) => {
    await requireAdmin(db, request);
    const article = await db.get<ArticleRow>('SELECT * FROM articles WHERE id = ?', [
      request.params.id,
    ]);
    if (!article) throw notFound('Article not found.');
    const images = await db.all<ArticleImageRow>(
      'SELECT * FROM article_images WHERE article_id = ? ORDER BY position ASC',
      [article.id],
    );
    return { article, images };
  });

  app.patch<{ Params: { id: string } }>('/admin/articles/:id', async (request) => {
    const ctx = await requireAdmin(db, request);
    const body = ArticlePatchSchema.parse(request.body ?? {});
    const article = await db.get<ArticleRow>('SELECT * FROM articles WHERE id = ?', [
      request.params.id,
    ]);
    if (!article) throw notFound('Article not found.');

    if (body.sourceUrl && !isSafeExternalUrl(body.sourceUrl)) {
      throw badRequest('Source URL must be a public http(s) link.');
    }
    if (body.categorySlug) {
      const category = await db.get<{ slug: string }>(
        'SELECT slug FROM categories WHERE slug = ?',
        [body.categorySlug],
      );
      if (!category) throw badRequest('Unknown category.');
    }

    const now = nowIso();
    const publishedAt =
      body.status === 'published' && !article.published_at
        ? (body.publishedAt ?? now)
        : (body.publishedAt ?? article.published_at);

    await db.run(
      `UPDATE articles SET headline = ?, dek = ?, body = ?, category_slug = ?, tags = ?,
         breaking = ?, featured = ?, placement = ?, editor_note = ?, source_url = ?, status = ?,
         published_at = ?, updated_at = ? WHERE id = ?`,
      [
        body.headline ? stripHtmlLike(body.headline) : article.headline,
        body.dek !== undefined ? stripHtmlLike(body.dek) || null : article.dek,
        body.body !== undefined ? sanitizeUserText(body.body) : article.body,
        body.categorySlug ?? article.category_slug,
        body.tags ? JSON.stringify(body.tags) : article.tags,
        body.breaking !== undefined ? (body.breaking ? 1 : 0) : article.breaking,
        body.featured !== undefined ? (body.featured ? 1 : 0) : article.featured,
        body.placement ?? article.placement,
        body.editorNote !== undefined ? body.editorNote || null : article.editor_note,
        body.sourceUrl !== undefined ? body.sourceUrl || null : article.source_url,
        body.status ?? article.status,
        publishedAt,
        now,
        article.id,
      ],
    );

    await writeAudit(db, {
      actor: adminId(ctx),
      action: 'article.update',
      targetType: 'article',
      targetId: article.id,
      detail: { fields: Object.keys(body) },
      ipHash: clientIpHash(request),
    });
    void revalidateWeb([
      '/',
      `/article/${article.slug}`,
      `/category/${body.categorySlug ?? article.category_slug}`,
    ]);
    const updated = await db.get<ArticleRow>('SELECT * FROM articles WHERE id = ?', [article.id]);
    return { ok: true, article: updated };
  });

  app.post<{ Params: { id: string } }>('/admin/articles/:id/unpublish', async (request) => {
    const ctx = await requireAdmin(db, request);
    const article = await db.get<ArticleRow>('SELECT * FROM articles WHERE id = ?', [
      request.params.id,
    ]);
    if (!article) throw notFound('Article not found.');
    await db.run(`UPDATE articles SET status = 'unpublished', updated_at = ? WHERE id = ?`, [
      nowIso(),
      article.id,
    ]);
    await writeAudit(db, {
      actor: adminId(ctx),
      action: 'article.unpublish',
      targetType: 'article',
      targetId: article.id,
      ipHash: clientIpHash(request),
    });
    void revalidateWeb(['/', `/article/${article.slug}`]);
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>('/admin/articles/:id/publish', async (request) => {
    const ctx = await requireAdmin(db, request);
    const article = await db.get<ArticleRow>('SELECT * FROM articles WHERE id = ?', [
      request.params.id,
    ]);
    if (!article) throw notFound('Article not found.');
    const now = nowIso();
    await db.run(
      `UPDATE articles SET status = 'published', published_at = COALESCE(published_at, ?),
         edition_date = COALESCE(edition_date, ?), updated_at = ? WHERE id = ?`,
      [now, editionDateFor(new Date(), 'Asia/Kolkata'), now, article.id],
    );
    await writeAudit(db, {
      actor: adminId(ctx),
      action: 'article.publish.manual',
      targetType: 'article',
      targetId: article.id,
      ipHash: clientIpHash(request),
    });
    void revalidateWeb(['/', `/article/${article.slug}`]);
    return { ok: true };
  });

  app.delete<{ Params: { id: string } }>('/admin/articles/:id', async (request) => {
    const ctx = await requireAdmin(db, request);
    const article = await db.get<ArticleRow>('SELECT * FROM articles WHERE id = ?', [
      request.params.id,
    ]);
    if (!article) throw notFound('Article not found.');
    await db.run(`UPDATE articles SET status = 'deleted', updated_at = ? WHERE id = ?`, [
      nowIso(),
      article.id,
    ]);
    await writeAudit(db, {
      actor: adminId(ctx),
      action: 'article.soft_delete',
      targetType: 'article',
      targetId: article.id,
      ipHash: clientIpHash(request),
    });
    void revalidateWeb(['/', `/article/${article.slug}`]);
    return { ok: true, softDeleted: true };
  });

  app.post<{ Params: { id: string } }>('/admin/articles/:id/correct', async (request) => {
    const ctx = await requireAdmin(db, request);
    const body = z
      .object({
        summary: z.string().trim().min(10).max(600),
        detail: z.string().trim().max(2000).optional(),
      })
      .parse(request.body ?? {});
    const article = await db.get<ArticleRow>('SELECT * FROM articles WHERE id = ?', [
      request.params.id,
    ]);
    if (!article) throw notFound('Article not found.');
    const now = nowIso();
    const stamp = new Date(now).toLocaleDateString('en-IN', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      timeZone: 'Asia/Kolkata',
    });
    await db.transaction(async (tx) => {
      await tx.run(`UPDATE articles SET body = ?, updated_at = ? WHERE id = ?`, [
        `${article.body}\n\nCorrection (${stamp}): ${body.summary}`,
        now,
        article.id,
      ]);
      await tx.run(
        `INSERT INTO corrections (id, article_id, summary, detail, status, submitted_by, admin_id, created_at, applied_at)
         VALUES (?, ?, ?, ?, 'accepted', NULL, ?, ?, ?)`,
        [newId('cor'), article.id, body.summary, body.detail ?? null, ctx.user.email, now, now],
      );
    });
    await writeAudit(db, {
      actor: adminId(ctx),
      action: 'article.correct',
      targetType: 'article',
      targetId: article.id,
      detail: { summary: body.summary },
      ipHash: clientIpHash(request),
    });
    void revalidateWeb(['/', `/article/${article.slug}`]);
    return { ok: true };
  });

  // ------------------------------------------------------------ publish now
  /**
   * One click for "process everything waiting and rebuild the paper".
   *
   * The heavy work (AI rewrites, edition assembly) runs on the durable queue,
   * never inside this HTTP request: Render and Vercel free tiers both kill
   * long requests. The handler only requeues, schedules, kicks a tick and
   * revalidates. The build job waits for the submission queue to drain (up to
   * 15 minutes) so a fresh story cannot miss the edition it triggered.
   */
  app.post('/admin/publish-now', async (request) => {
    const ctx = await requireAdmin(db, request);
    const body = PublishNowSchema.parse(request.body ?? {});
    const settings = await loadSettings(db);
    const date = body.editionDate ?? editionDateFor(new Date(), settings['site.timezone']);
    const queuedAt = Date.now();
    const aiConfigured = Boolean(config.ai.apiKey);

    // Parked because the key was missing — safe to wake only when a key exists.
    const paused = aiConfigured
      ? await db.all<{ id: string }>(
          `SELECT id FROM submissions
           WHERE status = 'queued_review' AND review_reason = ?
           ORDER BY created_at ASC LIMIT 25`,
          [AI_PAUSED_REASON],
        )
      : [];
    const failed = aiConfigured
      ? await db.all<{ id: string }>(
          `SELECT id FROM submissions
           WHERE status = 'failed' AND article_id IS NULL
           ORDER BY updated_at ASC LIMIT 25`,
        )
      : [];
    const received = await db.all<{ id: string }>(
      `SELECT id FROM submissions
       WHERE status = 'received' AND article_id IS NULL
       ORDER BY created_at ASC LIMIT 25`,
    );

    const ids = new Set<string>();
    for (const row of [...paused, ...failed, ...received]) ids.add(row.id);

    for (const id of ids) {
      await db.run(
        `UPDATE submissions SET status = 'received', review_reason = NULL,
           review_reasons = NULL, ai_last_error = NULL, updated_at = ?
         WHERE id = ? AND status != 'published'`,
        [nowIso(), id],
      );
      await enqueueJob(db, {
        type: 'process_submission',
        payload: { submissionId: id, manual: true },
        idempotencyKey: `process:${id}`,
        priority: 5,
      });
    }

    // At most one manual build per minute per edition — double clicks are a
    // no-op instead of a second (paid) AI call.
    const minuteBucket = Math.floor(Date.now() / 60_000);
    await enqueueJob(db, {
      type: 'build_edition',
      payload: { date, force: true, afterQueue: true, queuedAt },
      idempotencyKey: `edition:${date}:manual:${minuteBucket}`,
      once: true,
      // Lower than process_submission (5): one tick can rewrite the stories
      // first, then assemble the paper they belong to.
      priority: 2,
    });

    // Two kicks: one to start rewriting immediately, one to pick up the build
    // after the queue has had time to drain. The external 5-minute pinger and
    // the job's own defer handle anything slower than this.
    kickWorkerTick(5, 12);
    kickWorkerTick(60_000, 12);

    await writeAudit(db, {
      actor: adminId(ctx),
      action: 'news.publish_now',
      targetType: 'edition',
      targetId: date,
      detail: {
        requeued: ids.size,
        parked: paused.length,
        failed: failed.length,
        aiConfigured,
      },
      ipHash: clientIpHash(request),
    });

    // Refresh what is already published right now; publishing each story will
    // revalidate again as it lands.
    void revalidateWeb(['/', '/latest', '/editions', `/edition/${date}`]);

    return {
      ok: true,
      editionDate: date,
      requeued: ids.size,
      parked: paused.length,
      failed: failed.length,
      aiConfigured,
      workerTickRequested: config.worker.enabled,
      buildFollowUpSeconds: 60,
      message:
        ids.size > 0
          ? `Queued ${ids.size} submission${ids.size === 1 ? '' : 's'}. The edition rebuilds automatically once they are processed.`
          : 'Nothing was waiting. The edition rebuild is queued.',
    };
  });

  // -------------------------------------------------------------------- jobs
  app.get('/admin/jobs', async (request) => {
    await requireAdmin(db, request);
    const query = request.query as Record<string, string | undefined>;
    const { limit, offset } = parsePagination(query);
    const status = query.status as 'pending' | 'leased' | 'done' | 'failed' | 'dead' | undefined;
    const jobs = await listJobs(db, { status, type: query.type, limit, offset });
    return { jobs, stats: await queueStats(db) };
  });

  app.post<{ Params: { id: string } }>('/admin/jobs/:id/retry', async (request) => {
    const ctx = await requireAdmin(db, request);
    const ok = await retryJob(db, request.params.id);
    if (!ok) throw notFound('Job not found.');
    await writeAudit(db, {
      actor: adminId(ctx),
      action: 'job.retry',
      targetType: 'job',
      targetId: request.params.id,
      ipHash: clientIpHash(request),
    });
    void runWorkerTick({ maxJobs: 2 });
    return { ok: true };
  });

  app.post('/admin/worker/tick', async (request) => {
    await requireAdmin(db, request);
    const result = await runWorkerTick({ maxJobs: 3 });
    return { ok: true, result };
  });

  // ---------------------------------------------------------------- settings
  app.get('/admin/settings', async (request) => {
    await requireAdmin(db, request);
    const values = await loadSettings(db);
    return { values, definitions: settingDefinitions() };
  });

  app.put('/admin/settings', async (request) => {
    const ctx = await requireAdmin(db, request);
    const patch = SettingsSchema.parse(request.body ?? {});
    const clean: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(patch)) {
      if ((Object.keys(SETTING_DEFS) as string[]).includes(key)) clean[key] = value;
    }
    const values = await updateSettings(db, clean, ctx.user.email);
    invalidateSettingsCache();
    await writeAudit(db, {
      actor: adminId(ctx),
      action: 'settings.update',
      targetType: 'settings',
      targetId: 'global',
      detail: { keys: Object.keys(clean) },
      ipHash: clientIpHash(request),
    });
    void revalidateWeb(['/']);
    return { ok: true, values };
  });

  // -------------------------------------------------------------- categories
  app.get('/admin/categories', async (request) => {
    await requireAdmin(db, request);
    const categories = await db.all<CategoryRow>(
      'SELECT * FROM categories ORDER BY sort_order ASC',
    );
    return { categories };
  });

  app.post('/admin/categories', async (request) => {
    const ctx = await requireAdmin(db, request);
    const body = CategorySchema.parse(request.body ?? {});
    const slug = body.slug ? slugify(body.slug, 40) : slugify(body.name, 40);
    const existing = await db.get<{ slug: string }>('SELECT slug FROM categories WHERE slug = ?', [
      slug,
    ]);
    if (existing) throw badRequest('A category with that slug already exists.');
    const now = nowIso();
    await db.run(
      `INSERT INTO categories (slug, name, description, accent, sort_order, enabled, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        slug,
        body.name,
        body.description ?? null,
        body.accent ?? null,
        body.sortOrder ?? 50,
        body.enabled === false ? 0 : 1,
        now,
        now,
      ],
    );
    await writeAudit(db, {
      actor: adminId(ctx),
      action: 'category.create',
      targetType: 'category',
      targetId: slug,
      ipHash: clientIpHash(request),
    });
    return { ok: true, slug };
  });

  app.patch<{ Params: { slug: string } }>('/admin/categories/:slug', async (request) => {
    const ctx = await requireAdmin(db, request);
    const body = CategorySchema.partial().parse(request.body ?? {});
    const existing = await db.get<CategoryRow>('SELECT * FROM categories WHERE slug = ?', [
      request.params.slug,
    ]);
    if (!existing) throw notFound('Category not found.');
    await db.run(
      `UPDATE categories SET name = ?, description = ?, accent = ?, sort_order = ?, enabled = ?, updated_at = ? WHERE slug = ?`,
      [
        body.name ?? existing.name,
        body.description !== undefined ? body.description || null : existing.description,
        body.accent !== undefined ? body.accent || null : existing.accent,
        body.sortOrder ?? existing.sort_order,
        body.enabled !== undefined ? (body.enabled ? 1 : 0) : existing.enabled,
        nowIso(),
        existing.slug,
      ],
    );
    await writeAudit(db, {
      actor: adminId(ctx),
      action: 'category.update',
      targetType: 'category',
      targetId: existing.slug,
      ipHash: clientIpHash(request),
    });
    void revalidateWeb(['/', `/category/${existing.slug}`]);
    return { ok: true };
  });

  app.delete<{ Params: { slug: string } }>('/admin/categories/:slug', async (request) => {
    const ctx = await requireAdmin(db, request);
    const used = await db.get<{ count: number }>(
      'SELECT COUNT(*) as count FROM articles WHERE category_slug = ?',
      [request.params.slug],
    );
    if (Number(used?.count ?? 0) > 0) {
      await db.run('UPDATE categories SET enabled = 0, updated_at = ? WHERE slug = ?', [
        nowIso(),
        request.params.slug,
      ]);
      return { ok: true, disabledInstead: true };
    }
    await db.run('DELETE FROM categories WHERE slug = ?', [request.params.slug]);
    await writeAudit(db, {
      actor: adminId(ctx),
      action: 'category.delete',
      targetType: 'category',
      targetId: request.params.slug,
      ipHash: clientIpHash(request),
    });
    return { ok: true };
  });

  // ------------------------------------------------------------------ awards
  app.get('/admin/awards', async (request) => {
    await requireAdmin(db, request);
    const awards = await db.all<AwardRow>(
      'SELECT * FROM awards ORDER BY sort_order ASC, created_at DESC',
    );
    return { awards };
  });

  app.post('/admin/awards', async (request) => {
    const ctx = await requireAdmin(db, request);
    const body = AwardSchema.parse(request.body ?? {});
    const id = newId('awd');
    const now = nowIso();
    await db.run(
      `INSERT INTO awards (id, title, category, winner_name, winner_member_id, citation, edition_date,
         article_id, auto_generated, active, sort_order, created_at, updated_at)
       VALUES (?, ?, ?, ?, NULL, ?, ?, ?, 0, ?, ?, ?, ?)`,
      [
        id,
        body.title,
        body.category ?? 'manual',
        body.winnerName,
        body.citation ?? null,
        body.editionDate ?? editionDateFor(new Date(), 'Asia/Kolkata'),
        body.articleId ?? null,
        body.active === false ? 0 : 1,
        body.sortOrder ?? 10,
        now,
        now,
      ],
    );
    await writeAudit(db, {
      actor: adminId(ctx),
      action: 'award.create',
      targetType: 'award',
      targetId: id,
      ipHash: clientIpHash(request),
    });
    void revalidateWeb(['/', '/awards']);
    return { ok: true, id };
  });

  app.patch<{ Params: { id: string } }>('/admin/awards/:id', async (request) => {
    const ctx = await requireAdmin(db, request);
    const body = AwardSchema.partial().parse(request.body ?? {});
    const existing = await db.get<AwardRow>('SELECT * FROM awards WHERE id = ?', [
      request.params.id,
    ]);
    if (!existing) throw notFound('Award not found.');
    await db.run(
      `UPDATE awards SET title = ?, category = ?, winner_name = ?, citation = ?, edition_date = ?,
         article_id = ?, active = ?, sort_order = ?, updated_at = ? WHERE id = ?`,
      [
        body.title ?? existing.title,
        body.category ?? existing.category,
        body.winnerName ?? existing.winner_name,
        body.citation !== undefined ? body.citation || null : existing.citation,
        body.editionDate ?? existing.edition_date,
        body.articleId !== undefined ? body.articleId || null : existing.article_id,
        body.active !== undefined ? (body.active ? 1 : 0) : existing.active,
        body.sortOrder ?? existing.sort_order,
        nowIso(),
        existing.id,
      ],
    );
    await writeAudit(db, {
      actor: adminId(ctx),
      action: 'award.update',
      targetType: 'award',
      targetId: existing.id,
      ipHash: clientIpHash(request),
    });
    void revalidateWeb(['/', '/awards']);
    return { ok: true };
  });

  app.delete<{ Params: { id: string } }>('/admin/awards/:id', async (request) => {
    const ctx = await requireAdmin(db, request);
    await db.run('DELETE FROM awards WHERE id = ?', [request.params.id]);
    await writeAudit(db, {
      actor: adminId(ctx),
      action: 'award.delete',
      targetType: 'award',
      targetId: request.params.id,
      ipHash: clientIpHash(request),
    });
    void revalidateWeb(['/', '/awards']);
    return { ok: true };
  });

  // ---------------------------------------------------------------- reviews
  app.get('/admin/reviews', async (request) => {
    await requireAdmin(db, request);
    const query = request.query as Record<string, string | undefined>;
    const { limit, offset } = parsePagination(query);
    const status = query.status ?? '';
    const reviews = await db.all<
      ArticleReviewRow & { slug: string | null; headline: string | null }
    >(
      `SELECT r.*, a.slug, a.headline FROM article_reviews r
       LEFT JOIN articles a ON a.id = r.article_id
       WHERE (? = '' OR r.status = ?)
       ORDER BY r.created_at DESC LIMIT ? OFFSET ?`,
      [status, status, limit, offset],
    );
    const counts = await db.all<{ status: string; count: number }>(
      'SELECT status, COUNT(*) AS count FROM article_reviews GROUP BY status',
    );
    return { reviews, counts, limit, offset };
  });

  app.patch<{ Params: { id: string } }>('/admin/reviews/:id', async (request) => {
    const ctx = await requireAdmin(db, request);
    const body = ReviewModerationSchema.parse(request.body ?? {});
    const existing = await db.get<
      ArticleReviewRow & { slug: string | null; headline: string | null }
    >(
      `SELECT r.*, a.slug, a.headline FROM article_reviews r
       LEFT JOIN articles a ON a.id = r.article_id WHERE r.id = ?`,
      [request.params.id],
    );
    if (!existing) throw notFound('Review not found.');

    await db.run(
      `UPDATE article_reviews SET status = ?, moderation_reason = ?, updated_at = ? WHERE id = ?`,
      [
        body.status,
        body.status === 'published' ? null : `moderator:${body.status}`,
        nowIso(),
        existing.id,
      ],
    );
    await writeAudit(db, {
      actor: adminId(ctx),
      action: body.status === 'published' ? 'review.publish' : 'review.hide',
      targetType: 'review',
      targetId: existing.id,
      detail: { articleId: existing.article_id, status: body.status },
      ipHash: clientIpHash(request),
    });
    void revalidateWeb(['/leaderboard', ...(existing.slug ? [`/article/${existing.slug}`] : [])]);
    return { ok: true };
  });

  app.delete<{ Params: { id: string } }>('/admin/reviews/:id', async (request) => {
    const ctx = await requireAdmin(db, request);
    const existing = await db.get<
      ArticleReviewRow & { slug: string | null; headline: string | null }
    >(
      `SELECT r.*, a.slug, a.headline FROM article_reviews r
       LEFT JOIN articles a ON a.id = r.article_id WHERE r.id = ?`,
      [request.params.id],
    );
    if (!existing) throw notFound('Review not found.');
    await db.run('DELETE FROM article_reviews WHERE id = ?', [existing.id]);
    await writeAudit(db, {
      actor: adminId(ctx),
      action: 'review.delete',
      targetType: 'review',
      targetId: existing.id,
      detail: { articleId: existing.article_id },
      ipHash: clientIpHash(request),
    });
    void revalidateWeb(['/leaderboard', ...(existing.slug ? [`/article/${existing.slug}`] : [])]);
    return { ok: true };
  });

  // ------------------------------------------------------------ reports/corr.
  app.get('/admin/reports', async (request) => {
    await requireAdmin(db, request);
    const query = request.query as Record<string, string | undefined>;
    const { limit } = parsePagination(query);
    const reports = await db.all<ReportRow & { slug: string | null; headline: string | null }>(
      `SELECT r.*, a.slug, a.headline FROM reports r LEFT JOIN articles a ON a.id = r.article_id
       WHERE (? = '' OR r.status = ?) ORDER BY r.created_at DESC LIMIT ?`,
      [query.status ?? '', query.status ?? '', limit],
    );
    return { reports };
  });

  app.patch<{ Params: { id: string } }>('/admin/reports/:id', async (request) => {
    const ctx = await requireAdmin(db, request);
    const body = ReportActionSchema.parse(request.body ?? {});
    const status = body.status === 'open' ? 'open' : body.status;
    await db.run(
      `UPDATE reports SET status = ?, resolution_note = ?, resolved_at = ?, resolved_by = ?
       WHERE id = ?`,
      [
        status,
        body.note ?? null,
        status === 'open' ? null : nowIso(),
        status === 'open' ? null : ctx.user.email,
        request.params.id,
      ],
    );
    await writeAudit(db, {
      actor: adminId(ctx),
      action: 'report.resolve',
      targetType: 'report',
      targetId: request.params.id,
      detail: { status },
      ipHash: clientIpHash(request),
    });
    return { ok: true };
  });

  app.get('/admin/corrections', async (request) => {
    await requireAdmin(db, request);
    const corrections = await db.all<
      CorrectionRow & { slug: string | null; headline: string | null }
    >(
      `SELECT c.*, a.slug, a.headline FROM corrections c LEFT JOIN articles a ON a.id = c.article_id
       ORDER BY c.created_at DESC LIMIT 100`,
    );
    return { corrections };
  });

  app.patch<{ Params: { id: string } }>('/admin/corrections/:id', async (request) => {
    const ctx = await requireAdmin(db, request);
    const body = CorrectionActionSchema.parse(request.body ?? {});
    const correction = await db.get<CorrectionRow>('SELECT * FROM corrections WHERE id = ?', [
      request.params.id,
    ]);
    if (!correction) throw notFound('Correction not found.');
    const now = nowIso();

    if (body.status === 'accepted') {
      const article = await db.get<ArticleRow>('SELECT * FROM articles WHERE id = ?', [
        correction.article_id,
      ]);
      if (!article) throw notFound('Article not found.');
      const stamp = new Date(now).toLocaleDateString('en-IN', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        timeZone: 'Asia/Kolkata',
      });
      await db.run(`UPDATE articles SET body = ?, updated_at = ? WHERE id = ?`, [
        `${article.body}\n\nCorrection (${stamp}): ${correction.summary}`,
        now,
        article.id,
      ]);
      void revalidateWeb(['/', `/article/${article.slug}`]);
    }

    await db.run(`UPDATE corrections SET status = ?, admin_id = ?, applied_at = ? WHERE id = ?`, [
      body.status,
      ctx.user.email,
      body.status === 'accepted' ? now : null,
      correction.id,
    ]);
    await writeAudit(db, {
      actor: adminId(ctx),
      action: 'correction.resolve',
      targetType: 'correction',
      targetId: correction.id,
      detail: { status: body.status, note: body.note },
      ipHash: clientIpHash(request),
    });
    return { ok: true };
  });

  // ----------------------------------------------------------------- editions
  app.get('/admin/editions', async (request) => {
    await requireAdmin(db, request);
    const editions = await db.all<EditionRow>(
      'SELECT * FROM editions ORDER BY edition_date DESC LIMIT 60',
    );
    return { editions };
  });

  app.post('/admin/editions/rebuild', async (request) => {
    const ctx = await requireAdmin(db, request);
    const body = z
      .object({
        date: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional(),
      })
      .parse(request.body ?? {});
    const settings = await loadSettings(db);
    const date = body.date ?? editionDateFor(new Date(), settings['site.timezone']);
    await enqueueJob(db, {
      type: 'build_edition',
      payload: { date, manual: true },
      priority: 8,
    });
    await writeAudit(db, {
      actor: adminId(ctx),
      action: 'edition.rebuild',
      targetType: 'edition',
      targetId: date,
      ipHash: clientIpHash(request),
    });
    void runWorkerTick({ maxJobs: 2 });
    return { ok: true, date };
  });

  // -------------------------------------------------------------- audit / ai
  app.get('/admin/audit', async (request) => {
    await requireAdmin(db, request);
    const { limit, offset } = parsePagination(request.query);
    const logs = await db.all<{
      id: string;
      actor: string;
      action: string;
      target_type: string | null;
      target_id: string | null;
      detail: string | null;
      created_at: string;
    }>('SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT ? OFFSET ?', [limit, offset]);
    return { logs };
  });

  app.get('/admin/ai/health', async (request) => {
    await requireAdmin(db, request);
    const availability = await checkModelAvailability();
    return {
      ...availability,
      configuredBaseUrl: config.ai.baseUrl,
      rpmLimit: config.ai.maxRpm,
      jsonMode: config.ai.jsonMode,
    };
  });

  app.post('/admin/ai/test', async (request) => {
    const ctx = await requireAdmin(db, request);
    try {
      const { chatJson } = await import('../services/ai/client.js');
      const result = await chatJson({
        purpose: 'admin_test',
        system: 'You are a test endpoint. Reply with JSON only.',
        user: 'Return {"ok": true, "message": "newsroom online"} exactly.',
        schema: z.object({ ok: z.boolean(), message: z.string() }),
        maxTokens: 100,
        temperature: 0,
        // This is a latency probe from a serverless proxy: fail fast with a
        // clear AI_TIMEOUT instead of hanging for the full worker budget.
        timeoutMs: 40_000,
        maxAttempts: 1,
      });
      await writeAudit(db, {
        actor: adminId(ctx),
        action: 'ai.test',
        targetType: 'ai',
        targetId: config.ai.model,
        detail: { ok: true },
        ipHash: clientIpHash(request),
      });
      return { ok: true, result: result.data, attempts: result.attempts };
    } catch (error) {
      return {
        ok: false,
        error:
          error instanceof AiUnavailableError
            ? { code: error.code, message: error.message }
            : {
                code: 'AI_FAILED',
                message: error instanceof Error ? error.message : String(error),
              },
      };
    }
  });

  // ------------------------------------------------------------------- storage
  app.get('/admin/storage', async (request) => {
    await requireAdmin(db, request);
    const usage = await getStorageUsage(db);
    const [history, counts] = await Promise.all([
      db.all<{
        month: string;
        advanced_ops: number;
        simple_ops: number;
        bytes_uploaded: number;
        bytes_pruned: number;
      }>(
        `SELECT month, advanced_ops, simple_ops, bytes_uploaded, bytes_pruned
         FROM storage_usage ORDER BY month DESC LIMIT 6`,
      ),
      db.get<{ photos: number; originals: number; expired: number }>(
        `SELECT
           (SELECT COUNT(*) FROM article_images) AS photos,
           (SELECT COUNT(*) FROM article_images WHERE original_preserved = 1) AS originals,
           (SELECT COUNT(*) FROM uploads WHERE status = 'expired') AS expired`,
      ),
    ]);
    return {
      usage,
      history,
      counts: counts ?? { photos: 0, originals: 0, expired: 0 },
      config: {
        mode: config.storage.mode,
        cacheMaxAgeSeconds: config.storage.cacheMaxAgeSeconds,
        privateOriginalsStore: Boolean(config.storage.originalsToken),
        maxUploadBytes: config.maxUploadBytes,
        maxImagesPerSubmission: config.maxImagesPerSubmission,
      },
    };
  });

  app.post('/admin/storage/prune', async (request) => {
    const ctx = await requireAdmin(db, request);
    const body = PruneSchema.parse(request.body ?? {});
    const result = await pruneOriginals(db, logger, {
      force: body.force,
      limit: body.limit,
    });
    const usage = await getStorageUsage(db);
    await writeAudit(db, {
      actor: adminId(ctx),
      action: 'storage.prune',
      targetType: 'storage',
      targetId: 'vercel-blob',
      detail: { ...result, reason: body.force ? 'admin-force' : result.reason },
      ipHash: clientIpHash(request),
    });
    return { ...result, usage };
  });

  app.post('/admin/storage/recheck', async (request) => {
    const ctx = await requireAdmin(db, request);
    const cleared = clearStorageDegraded();
    const usage = await getStorageUsage(db);
    await writeAudit(db, {
      actor: adminId(ctx),
      action: 'storage.recheck',
      targetType: 'storage',
      targetId: 'vercel-blob',
      detail: { degraded: cleared, exhausted: usage.exhausted, reason: usage.reason },
      ipHash: clientIpHash(request),
    });
    return { usage, degraded: cleared };
  });

  /**
   * Download the untouched original a user filed. Admin-only: originals may
   * still carry EXIF/GPS and are deliberately never served by the public site.
   */
  app.get<{ Params: { id: string } }>('/admin/originals/:id', async (request, reply) => {
    const ctx = await requireAdmin(db, request);
    const id = request.params.id;

    let row = await db.get<{
      original_key: string | null;
      original_url: string | null;
      original_store: string | null;
      original_mime: string | null;
      original_preserved: number;
    }>(
      `SELECT original_key, original_url, original_store, original_mime, original_preserved
       FROM uploads WHERE id = ?`,
      [id],
    );

    if (!row) {
      const image = await db.get<{
        upload_id: string | null;
        original_key: string | null;
        original_url: string | null;
        original_store: string | null;
        original_mime: string | null;
        original_preserved: number;
      }>(
        `SELECT upload_id, original_key, original_url, original_store, original_mime, original_preserved
         FROM article_images WHERE id = ?`,
        [id],
      );
      if (image?.upload_id) {
        row = await db.get(
          `SELECT original_key, original_url, original_store, original_mime, original_preserved
           FROM uploads WHERE id = ?`,
          [image.upload_id],
        );
      }
      if (!row && image) row = image;
    }

    if (!row?.original_preserved || !row.original_key) {
      throw notFound('No preserved original for that photo. It may have been pruned.');
    }

    const buffer = await readObject(
      row.original_key,
      row.original_url,
      asStore(row.original_store),
    );
    const mime = row.original_mime ?? 'application/octet-stream';
    const extension = mime === 'image/png' ? 'png' : mime === 'image/webp' ? 'webp' : 'jpg';

    await writeAudit(db, {
      actor: adminId(ctx),
      action: 'storage.original.download',
      targetType: 'upload',
      targetId: id,
      detail: { bytes: buffer.byteLength, store: row.original_store },
      ipHash: clientIpHash(request),
    });

    reply.header('Content-Type', mime);
    reply.header('Content-Disposition', `attachment; filename="${id}-original.${extension}"`);
    reply.header('Cache-Control', 'private, no-store');
    return reply.send(buffer);
  });

  // --------------------------------------------------------------- diagnostics
  app.get('/admin/diagnostics', async (request) => {
    await requireAdmin(db, request);
    const recentErrors = await db.all<{
      id: string;
      type: string;
      last_error: string;
      attempts: number;
    }>(
      `SELECT id, type, last_error, attempts FROM jobs WHERE status IN ('failed','dead')
       ORDER BY updated_at DESC LIMIT 10`,
    );
    return {
      storage: { ...storageStatus(), usage: await getStorageUsage(db) },
      ai: { configured: Boolean(config.ai.apiKey), model: config.ai.model },
      worker: config.worker,
      timezone: config.siteTimezone,
      recentErrors,
      version: process.env.RENDER_GIT_COMMIT ?? process.env.GIT_COMMIT ?? 'dev',
    };
  });
}

export { requireAdmin };
