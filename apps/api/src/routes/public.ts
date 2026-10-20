import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { config } from '../config.js';
import type { Db } from '../db/client.js';
import type { ArticleRow, CategoryRow, SubmissionRow } from '../db/types.js';
import { hashUploadToken, safeEqual } from '../lib/crypto.js';
import { AppError, badRequest, notFound, tooManyRequests } from '../lib/errors.js';
import { newId, randomToken } from '../lib/id.js';
import { consumeRateLimit } from '../lib/rate-limit.js';
import { nowIso } from '../lib/time.js';
import { hostnameOf, isSafeExternalUrl, sanitizeUserText, stripHtmlLike } from '../lib/text.js';
import { loadSettings, toPublicSettings } from '../settings.js';
import { analyzeHeuristics } from '../services/moderation.js';
import { enqueueJob } from '../services/queue.js';
import {
  assertUploadsAllowed,
  getStorageUsage,
  storageBlockedMessage,
} from '../services/storage-usage.js';
import {
  claimUploads,
  createUploadTickets,
  storeUpload,
  type UploadTicket,
} from '../services/uploads.js';
import { runWorkerTick } from '../services/worker.js';
import { requireUserSession } from '../services/user-sessions.js';
import { clientIpHash, writeAudit } from './helpers.js';

const SubmissionBodySchema = z.object({
  headline: z.string().trim().min(6).max(300),
  story: z.string().trim().min(40).max(50_000),
  categorySlug: z.string().trim().max(64).optional(),
  sourceUrl: z.union([z.string().trim().max(2048), z.literal('')]).optional(),
  anonymous: z.boolean().optional(),
  uploadIds: z.array(z.string().trim().min(4).max(80)).max(8).optional(),
  website: z.string().max(200).optional(),
  formStartedAt: z.number().int().optional(),
  consent: z.literal(true, {
    errorMap: () => ({ message: 'You must confirm the story is yours to share.' }),
  }),
  contactEmail: z.union([z.string().trim().email().max(200), z.literal('')]).optional(),
});

const UploadInitSchema = z.object({
  files: z
    .array(
      z.object({
        name: z.string().max(200).optional(),
        type: z.string().max(80).optional(),
        size: z
          .number()
          .int()
          .min(1)
          .max(50 * 1024 * 1024)
          .optional(),
      }),
    )
    .max(8),
});

const ReportSchema = z.object({
  articleId: z.string().trim().min(4).max(80),
  reason: z.string().trim().min(3).max(120),
  detail: z.string().trim().max(2000).optional(),
  contact: z.string().trim().max(200).optional(),
  website: z.string().max(200).optional(),
});

const CorrectionSchema = z.object({
  articleId: z.string().trim().min(4).max(80),
  summary: z.string().trim().min(10).max(600),
  detail: z.string().trim().max(3000).optional(),
  submittedBy: z.string().trim().max(80).optional(),
  website: z.string().max(200).optional(),
});

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

function kickWorker(delayMs = 5): void {
  if (!config.worker.enabled) return;
  setTimeout(() => {
    void runWorkerTick({ maxJobs: 2 }).catch((error) => {
      // Logged inside the worker; never crash the request path.
      if (process.env.NODE_ENV !== 'test') {
        console.error('[worker] tick failed', error);
      }
    });
  }, delayMs).unref?.();
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

function publicStatusCopy(status: string): string {
  switch (status) {
    case 'received':
      return 'In the newsroom queue.';
    case 'processing':
      return 'The AI editor is rewriting it.';
    case 'queued_review':
      return 'Held by the risk desk.';
    case 'published':
      return 'Printed and online.';
    case 'rejected':
      return 'Spiked by the editor.';
    case 'failed':
      return 'The robot is retrying.';
    default:
      return 'Unknown status.';
  }
}

export async function registerPublicRoutes(app: FastifyInstance, db: Db): Promise<void> {
  // ---------------------------------------------------------------- bootstrap
  app.get('/public/bootstrap', async () => {
    const settings = await loadSettings(db);
    const storage = await getStorageUsage(db, settings);
    const categories = await db.all<CategoryRow>(
      `SELECT slug, name, description, accent, sort_order FROM categories
       WHERE enabled = 1 ORDER BY sort_order ASC, name ASC`,
    );
    return {
      settings: toPublicSettings(settings),
      categories: categories.map((category) => ({
        slug: category.slug,
        name: category.name,
        description: category.description,
        accent: category.accent,
      })),
      limits: {
        maxUploadBytes: config.maxUploadBytes,
        maxImages: Math.min(config.maxImagesPerSubmission, settings['submissions.max_images']),
        uploadTicketTtlMinutes: config.uploadTicketTtlMinutes,
        storageReady: storage.store.ready,
        aiConfigured: Boolean(config.ai.apiKey),
      },
      // Enough for the form to explain itself before a photo is chosen.
      storage: {
        ready: storage.store.ready,
        mode: storage.store.mode,
        originals: storage.store.originals,
        quotaExhausted: storage.exhausted,
        reason: storage.reason,
        message: storage.exhausted ? storageBlockedMessage(storage.reason) : null,
      },
    };
  });

  // ------------------------------------------------------------------ uploads
  app.post('/public/uploads/init', async (request) => {
    const body = UploadInitSchema.parse(request.body ?? {});
    await requireUserSession(db, request);
    const ipHash = clientIpHash(request);
    await guard(
      db,
      `upload-init:${ipHash}`,
      30,
      3600,
      'Too many upload attempts. Try again later.',
    );
    if (!config.storage.configured) {
      throw new AppError(
        503,
        'STORAGE_NOT_CONFIGURED',
        'Photo storage is not configured on the server yet. Stories without photos still work.',
      );
    }
    // Refuse before issuing tickets when the free allowance is spent: the form
    // shows a friendly note and the story can still be filed without photos.
    await assertUploadsAllowed(db);
    if (body.files.length === 0) return { tickets: [] as UploadTicket[] };
    const tickets = await createUploadTickets(db, { files: body.files, ipHash });
    return { tickets };
  });

  app.put<{ Params: { id: string } }>(
    '/public/uploads/:id',
    { bodyLimit: config.maxUploadBytes },
    async (request, reply) => {
      const ipHash = clientIpHash(request);
      await guard(db, `upload-put:${ipHash}`, 60, 3600, 'Too many uploads. Try again later.');

      const auth = request.headers.authorization ?? '';
      const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
      if (!token) throw new AppError(401, 'UPLOAD_TOKEN_REQUIRED', 'Missing upload token.');

      const row = await db.get<{ id: string; token_hash: string; status: string }>(
        'SELECT id, token_hash, status FROM uploads WHERE id = ?',
        [request.params.id],
      );
      if (!row) throw notFound('Upload ticket not found.');
      if (!safeEqual(row.token_hash, hashUploadToken(token))) {
        throw new AppError(401, 'UPLOAD_TOKEN_INVALID', 'Invalid upload token.');
      }

      const buffer = Buffer.isBuffer(request.body) ? request.body : Buffer.alloc(0);
      if (buffer.byteLength === 0) throw badRequest('No image data received.', 'IMAGE_EMPTY');

      // Re-check at write time: a burst of tickets could have drained the
      // allowance between init and this PUT.
      await assertUploadsAllowed(db);

      const metadata = await storeUpload(db, {
        uploadId: request.params.id,
        token,
        buffer,
        contentType: request.headers['content-type'] ?? 'application/octet-stream',
        ipHash,
      });
      reply.header('Cache-Control', 'no-store');
      return metadata;
    },
  );

  // -------------------------------------------------------------- submissions
  app.post('/public/submissions', async (request, reply) => {
    const body = SubmissionBodySchema.parse(request.body ?? {});
    assertNotBot(body);

    // Every submission is tied to a Discord login. Identity details are read
    // from the session (and therefore from Discord), never from the request body.
    const user = await requireUserSession(db, request);

    const ipHash = clientIpHash(request);
    const settings = await loadSettings(db);

    await guard(
      db,
      `submit:min:${ipHash}`,
      3,
      600,
      'Slow down a little. Try again in a few minutes.',
    );
    await guard(db, `submit:hour:${ipHash}`, 8, 3600, 'Submission limit reached for this hour.');
    await guard(db, `submit:day:${ipHash}`, 25, 86400, 'Daily submission limit reached.');

    const headline = stripHtmlLike(body.headline).slice(
      0,
      settings['submissions.max_headline_chars'],
    );
    const story = sanitizeUserText(body.story);
    if (headline.length < 6) throw badRequest('Headline is too short.', 'HEADLINE_TOO_SHORT');
    if (story.length < settings['submissions.min_story_chars']) {
      throw badRequest(
        `Story needs at least ${settings['submissions.min_story_chars']} characters.`,
        'STORY_TOO_SHORT',
      );
    }
    if (story.length > settings['submissions.max_story_chars']) {
      throw badRequest(
        `Story is longer than the ${settings['submissions.max_story_chars']} character limit.`,
        'STORY_TOO_LONG',
      );
    }

    const anonymous = Boolean(body.anonymous);
    if (anonymous && !settings['submissions.anonymous_allowed']) {
      throw badRequest('Anonymous submissions are currently disabled.', 'ANONYMOUS_DISABLED');
    }

    const sourceUrl: string | null = (body.sourceUrl ?? '').trim() || null;
    if (sourceUrl) {
      if (!isSafeExternalUrl(sourceUrl)) {
        throw badRequest('Source URL must be a public http(s) link.', 'SOURCE_URL_INVALID');
      }
      const host = hostnameOf(sourceUrl);
      if (
        host &&
        settings['content.blocked_domains'].some(
          (domain) => host === domain || host.endsWith(`.${domain}`),
        )
      ) {
        throw badRequest('That source domain is blocked.', 'SOURCE_BLOCKED');
      }
    } else if (settings['submissions.require_source_url']) {
      throw badRequest('A source URL is required for this paper.', 'SOURCE_REQUIRED');
    }

    const categories = await db.all<CategoryRow>(
      'SELECT slug FROM categories WHERE enabled = 1 ORDER BY sort_order ASC',
    );
    const allowedCategories = new Set(categories.map((category) => category.slug));
    let categorySlug = (body.categorySlug ?? '').trim() || null;
    if (categorySlug && !allowedCategories.has(categorySlug)) {
      throw badRequest('Unknown category.', 'CATEGORY_INVALID');
    }
    if (!categorySlug) categorySlug = allowedCategories.has('server-news') ? 'server-news' : null;

    const uploadIds = body.uploadIds ?? [];
    if (
      uploadIds.length > Math.min(config.maxImagesPerSubmission, settings['submissions.max_images'])
    ) {
      throw badRequest('Too many photos attached.', 'TOO_MANY_IMAGES');
    }

    const heuristics = analyzeHeuristics({ headline, story, sourceUrl, settings });
    if (heuristics.blockedDomain) {
      throw badRequest('That source link is not allowed.', 'SOURCE_BLOCKED');
    }

    const uploads = await claimUploads(db, uploadIds);
    const now = nowIso();
    const submissionId = newId('sub');
    const publicToken = randomToken(24);
    const identityMode: 'discord' | 'anonymous' = anonymous ? 'anonymous' : 'discord';
    // Store the real Discord identity on the submission; `anonymous` masks it on
    // the public site (see publishing.ts) while the desk can still see who filed.
    const authorDisplay = user.displayName;
    const authorHandle = user.username;
    const memberId = user.memberId;

    await db.run(
      'UPDATE members SET submission_count = submission_count + 1, updated_at = ? WHERE id = ?',
      [now, memberId],
    );

    await db.transaction(async (tx) => {
      await tx.run(
        `INSERT INTO submissions (id, public_token, headline, story, author_name, discord_handle,
           contact_email, category_slug, source_url, anonymous, identity_mode, status, spam_score,
           misleading_risk, content_hash, ip_hash, user_agent, member_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'received', ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          submissionId,
          publicToken,
          headline,
          story,
          authorDisplay.slice(0, 60),
          authorHandle,
          body.contactEmail || null,
          categorySlug,
          sourceUrl,
          anonymous ? 1 : 0,
          identityMode,
          heuristics.spamScore,
          0,
          heuristics.contentHash,
          ipHash,
          (request.headers['user-agent'] ?? '').slice(0, 300),
          memberId,
          now,
          now,
        ],
      );

      let position = 0;
      for (const upload of uploads) {
        await tx.run(
          `INSERT INTO submission_images (id, submission_id, upload_id, storage_key, thumb_key, url, thumb_url,
             mime, bytes, width, height, checksum, attribution, position, created_at,
             original_key, original_url, original_bytes, original_mime, original_store, original_preserved)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            newId('simg'),
            submissionId,
            upload.id,
            upload.storage_key,
            upload.thumb_key,
            upload.url,
            upload.thumb_url,
            upload.mime ?? 'image/webp',
            upload.bytes ?? 0,
            upload.width,
            upload.height,
            upload.checksum,
            identityMode === 'anonymous' ? 'Submitted photo' : `Photo: ${authorDisplay}`,
            position,
            now,
            upload.original_key,
            upload.original_url,
            upload.original_bytes,
            upload.original_mime,
            upload.original_store,
            upload.original_preserved,
          ],
        );
        await tx.run(
          `UPDATE uploads SET status = 'claimed', submission_id = ?, claimed_at = ? WHERE id = ?`,
          [submissionId, now, upload.id],
        );
        position += 1;
      }

      await tx.run(
        `INSERT INTO audit_logs (id, actor, action, target_type, target_id, detail, ip_hash, created_at)
         VALUES (?, 'public', 'submission.create', 'submission', ?, ?, ?, ?)`,
        [
          newId('aud'),
          submissionId,
          JSON.stringify({
            images: uploads.length,
            anonymous,
            category: categorySlug,
            spamScore: heuristics.spamScore,
          }),
          ipHash,
          now,
        ],
      );
    });

    await enqueueJob(db, {
      type: 'process_submission',
      payload: { submissionId },
      idempotencyKey: `process:${submissionId}`,
      priority: 3,
    });
    kickWorker();

    reply.code(201);
    return {
      id: submissionId,
      token: publicToken,
      status: 'received',
      message: 'Received. The AI editor is on it.',
    };
  });

  app.get<{ Params: { token: string } }>('/public/submissions/:token', async (request, reply) => {
    const ipHash = clientIpHash(request);
    await guard(db, `status:${ipHash}`, 240, 3600, 'Too many status checks.');

    const submission = await db.get<SubmissionRow>(
      'SELECT * FROM submissions WHERE public_token = ?',
      [request.params.token],
    );
    if (!submission) throw notFound('Submission not found.');

    const article = submission.article_id
      ? await db.get<ArticleRow>(
          'SELECT id, slug, headline, status, published_at, breaking, category_slug FROM articles WHERE id = ?',
          [submission.article_id],
        )
      : null;

    const images = await db.all<{ id: string; url: string; thumb_url: string | null }>(
      'SELECT id, url, thumb_url FROM submission_images WHERE submission_id = ? ORDER BY position ASC',
      [submission.id],
    );

    kickWorker(20);
    reply.header('Cache-Control', 'no-store');
    let reviewReasons: string[] = [];
    if (submission.status === 'queued_review' && submission.review_reasons) {
      try {
        const parsed = JSON.parse(submission.review_reasons) as unknown;
        if (Array.isArray(parsed)) reviewReasons = parsed.map(String).slice(0, 8);
      } catch {
        reviewReasons = [];
      }
    }
    return {
      id: submission.id,
      headline: submission.headline,
      status: submission.status,
      statusCopy: publicStatusCopy(submission.status),
      reviewReasons,
      aiError:
        submission.status === 'failed'
          ? 'The AI desk is unreachable right now. Your story is safe and will be retried automatically.'
          : null,
      article: article
        ? {
            id: article.id,
            slug: article.slug,
            headline: article.headline,
            category: article.category_slug,
            publishedAt: article.published_at,
            breaking: article.breaking === 1,
          }
        : null,
      images: images.map((image) => ({ id: image.id, url: image.url, thumbUrl: image.thumb_url })),
      createdAt: submission.created_at,
      updatedAt: submission.updated_at,
    };
  });

  // ------------------------------------------------------- reports/corrections
  app.post('/public/reports', async (request, reply) => {
    const body = ReportSchema.parse(request.body ?? {});
    assertNotBot(body);
    const ipHash = clientIpHash(request);
    await guard(db, `report:${ipHash}`, 10, 3600, 'Too many reports. Try again later.');

    const article = await db.get<{ id: string }>('SELECT id FROM articles WHERE id = ?', [
      body.articleId,
    ]);
    if (!article) throw notFound('Article not found.');

    const id = newId('rpt');
    await db.run(
      `INSERT INTO reports (id, article_id, reason, detail, reporter_contact, status, ip_hash, created_at)
       VALUES (?, ?, ?, ?, ?, 'open', ?, ?)`,
      [
        id,
        body.articleId,
        body.reason,
        body.detail ?? null,
        body.contact ?? null,
        ipHash,
        nowIso(),
      ],
    );
    reply.code(201);
    return { id, message: 'Report received. The desk will look at it.' };
  });

  app.post('/public/corrections', async (request, reply) => {
    const body = CorrectionSchema.parse(request.body ?? {});
    assertNotBot(body);
    const ipHash = clientIpHash(request);
    await guard(db, `correction:${ipHash}`, 5, 3600, 'Too many correction requests.');

    const article = await db.get<{ id: string }>(
      `SELECT id FROM articles WHERE id = ? AND status = 'published'`,
      [body.articleId],
    );
    if (!article) throw notFound('Article not found.');

    const id = newId('cor');
    await db.run(
      `INSERT INTO corrections (id, article_id, summary, detail, status, submitted_by, ip_hash, created_at)
       VALUES (?, ?, ?, ?, 'pending', ?, ?, ?)`,
      [
        id,
        body.articleId,
        body.summary,
        body.detail ?? null,
        body.submittedBy ?? null,
        ipHash,
        nowIso(),
      ],
    );
    await writeAudit(db, {
      actor: 'public',
      action: 'correction.request',
      targetType: 'article',
      targetId: body.articleId,
      detail: { correctionId: id },
      ipHash,
    });
    reply.code(201);
    return { id, message: 'Correction request received.' };
  });
}
