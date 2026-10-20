import { config } from '../config.js';
import type { Db } from '../db/client.js';
import type { ArticleRow, CategoryRow, SubmissionImageRow, SubmissionRow } from '../db/types.js';
import { AiUnavailableError, DeferJobError } from '../lib/errors.js';
import { logger } from '../lib/logger.js';
import { nowIso } from '../lib/time.js';
import { loadSettings } from '../settings.js';
import { decideOutcome } from './ai/decide.js';
import { chatJson } from './ai/client.js';
import { AiResultSchema } from './ai/schema.js';
import {
  buildSubmissionSystemPrompt,
  buildSubmissionUserPrompt,
  type PromptCategory,
} from './ai/prompt.js';
import { analyzeHeuristics, findDuplicate } from './moderation.js';
import { findCategorySlug, publishArticle } from './publishing.js';
import { toVisionDataUrl } from './images.js';
import { getStorage } from './storage.js';
import type { AiImageInput } from './ai/client.js';
import type { Settings } from '../settings.js';

/**
 * Marker stored on submissions that were paused because no AI key is configured.
 * The scheduler re-queues these automatically once AI becomes available, so a
 * submission is never lost just because the newsroom was offline.
 */
export const AI_PAUSED_REASON =
  'AI newsroom is paused because NVIDIA_API_KEY is not configured. This story will be processed automatically once the key is added.';

export async function processSubmission(
  db: Db,
  submissionId: string,
  log: typeof logger,
): Promise<void> {
  const submission = await db.get<SubmissionRow>('SELECT * FROM submissions WHERE id = ?', [
    submissionId,
  ]);
  if (!submission) throw new Error(`Submission ${submissionId} not found.`);
  if (submission.status === 'published') return;

  const settings = await loadSettings(db);
  const categories = await db.all<CategoryRow>(
    'SELECT * FROM categories WHERE enabled = 1 ORDER BY sort_order ASC, name ASC',
  );
  const enabledSlugs = new Set(categories.map((category) => category.slug));
  const promptCategories: PromptCategory[] = categories.map((category) => ({
    slug: category.slug,
    name: category.name,
    description: category.description,
  }));

  const images = await db.all<SubmissionImageRow>(
    'SELECT * FROM submission_images WHERE submission_id = ? ORDER BY position ASC',
    [submission.id],
  );

  await db.run(
    `UPDATE submissions SET status = 'processing', ai_attempts = ai_attempts + 1,
       ai_last_error = NULL, updated_at = ? WHERE id = ?`,
    [nowIso(), submission.id],
  );

  const heuristics = analyzeHeuristics({
    headline: submission.headline,
    story: submission.story,
    sourceUrl: submission.source_url,
    settings,
  });

  const duplicate = await findDuplicate(
    db,
    {
      headline: submission.headline,
      story: submission.story,
      contentHash: heuristics.contentHash,
    },
    settings['moderation.duplicate_threshold'],
  );

  const visionImages = await buildVisionImages(images, settings, log);
  const anonymous = submission.anonymous === 1 || submission.identity_mode === 'anonymous';

  const system = buildSubmissionSystemPrompt({
    categories: promptCategories,
    voiceNotes: settings['ai.voice_notes'],
    minParagraphs: settings['ai.body_paragraphs_min'],
    maxParagraphs: Math.max(settings['ai.body_paragraphs_min'], settings['ai.body_paragraphs_max']),
    anonymous,
  });
  const user = buildSubmissionUserPrompt({
    submission: {
      headline: submission.headline,
      story: submission.story,
      authorName: submission.author_name,
      identityMode: submission.identity_mode,
      discordHandle: submission.discord_handle,
      categorySlug: submission.category_slug,
      sourceUrl: submission.source_url,
      imageCount: images.length,
      submittedAt: submission.created_at,
      timezone: settings['site.timezone'],
      serverName: settings['site.name'],
    },
    categories: promptCategories,
    serverName: settings['site.name'],
  });

  let ai;
  try {
    const result = await chatJson({
      purpose: 'process_submission',
      system,
      user,
      images: visionImages,
      schema: AiResultSchema,
      onUsage: async (usage) => {
        await db.run(
          `INSERT INTO ai_usage (id, job_id, purpose, model, prompt_tokens, completion_tokens,
             total_tokens, duration_ms, attempts, status, error_code, created_at)
           VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            `aiu_${Date.now().toString(32)}${Math.random().toString(32).slice(2, 8)}`,
            usage.purpose,
            usage.model,
            usage.promptTokens,
            usage.completionTokens,
            usage.totalTokens,
            usage.durationMs,
            usage.attempts,
            usage.status,
            usage.errorCode,
            nowIso(),
          ],
        );
      },
    });
    ai = result.data;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const code = error instanceof AiUnavailableError ? error.code : 'AI_FAILED';
    const now = nowIso();

    // A missing key is a configuration state, not a story failure. Pause the
    // submission and let the scheduler pick it up again once AI is available.
    if (code === 'AI_NOT_CONFIGURED') {
      await db.run(
        `UPDATE submissions SET status = 'queued_review', review_reason = ?, review_reasons = ?,
           ai_attempts = CASE WHEN ai_attempts > 0 THEN ai_attempts - 1 ELSE 0 END,
           ai_last_error = ?, updated_at = ? WHERE id = ?`,
        [
          AI_PAUSED_REASON,
          JSON.stringify([AI_PAUSED_REASON]),
          message.slice(0, 1000),
          now,
          submission.id,
        ],
      );
      log.warn({ submissionId: submission.id }, 'submission paused: AI is not configured');
      return;
    }

    await db.run(
      `UPDATE submissions SET status = 'received',
         ai_attempts = CASE WHEN ai_attempts > 0 THEN ai_attempts - 1 ELSE 0 END,
         ai_last_error = ?, updated_at = ? WHERE id = ?`,
      [message.slice(0, 1000), now, submission.id],
    );

    // Transient outages (timeouts, 429s, 5xx, malformed responses) are retried
    // via the queue without consuming an attempt. Safety beats speed, so a
    // story waits rather than being published blind or dropped.
    if (error instanceof AiUnavailableError && error.retryable) {
      const seconds = code === 'AI_RATE_LIMITED' ? 120 : 600;
      log.warn({ submissionId: submission.id, code, seconds }, 'AI unavailable; deferring job');
      throw new DeferJobError(seconds, message);
    }

    // Non-retryable configuration problems (bad key, missing model access,
    // billing, oversized story) would loop forever, so hand them to an editor.
    const reason = `AI could not process this submission (${code}). Held for manual review.`;
    await db.run(
      `UPDATE submissions SET status = 'queued_review', review_reason = ?, review_reasons = ?,
         updated_at = ? WHERE id = ?`,
      [reason, JSON.stringify([reason, message.slice(0, 300)]), nowIso(), submission.id],
    );
    log.error(
      { submissionId: submission.id, code, message },
      'AI failed non-retryably; held for review',
    );
    return;
  }

  const publishedLastHour = await db.get<{ count: number }>(
    `SELECT COUNT(*) as count FROM articles WHERE status = 'published' AND published_at >= ?`,
    [new Date(Date.now() - 3600 * 1000).toISOString()],
  );
  const breakingRecent = await db.get<{ count: number }>(
    `SELECT COUNT(*) as count FROM articles WHERE breaking = 1 AND status = 'published' AND published_at >= ?`,
    [new Date(Date.now() - 6 * 3600 * 1000).toISOString()],
  );

  const decision = decideOutcome({
    ai,
    settings,
    heuristics: {
      ...heuristics,
      duplicateOf: duplicate.duplicateOf,
      duplicateScore: duplicate.duplicateScore,
    },
    publishedLastHour: Number(publishedLastHour?.count ?? 0),
    breakingLastSixHours: Number(breakingRecent?.count ?? 0),
    aiConfigured: Boolean(config.ai.apiKey),
  });

  const categorySlug = await findCategorySlug(
    db,
    ai.category,
    submission.category_slug,
    enabledSlugs,
  );
  ai.category = categorySlug;
  ai.tags = ai.tags.slice(0, 6);

  const now = nowIso();
  await db.run(
    `UPDATE submissions SET spam_score = ?, misleading_risk = ?, duplicate_of = ?,
       duplicate_score = ?, content_hash = ?, updated_at = ? WHERE id = ?`,
    [
      decision.spamScore,
      decision.misleadingRisk,
      decision.duplicateOf,
      duplicate.duplicateScore,
      heuristics.contentHash,
      now,
      submission.id,
    ],
  );

  if (decision.action === 'reject') {
    await db.run(
      `UPDATE submissions SET status = 'rejected', review_reason = ?, review_reasons = ?,
         ai_model = ?, processed_at = ?, updated_at = ? WHERE id = ?`,
      [
        decision.reasons.join(' ').slice(0, 900) || 'Rejected by the autonomous editor.',
        JSON.stringify(decision.reasons),
        config.ai.model,
        now,
        now,
        submission.id,
      ],
    );
    await db.run(
      `INSERT INTO audit_logs (id, actor, action, target_type, target_id, detail, ip_hash, created_at)
       VALUES (?, 'ai-editor', 'submission.reject', 'submission', ?, ?, ?, ?)`,
      [
        `aud_${Date.now().toString(32)}${Math.random().toString(32).slice(2, 8)}`,
        submission.id,
        JSON.stringify({ reasons: decision.reasons, spamScore: decision.spamScore }),
        submission.ip_hash,
        now,
      ],
    );
    log.info({ submissionId: submission.id, reasons: decision.reasons }, 'submission rejected');
    return;
  }

  if (decision.action === 'defer') {
    // Throttled: restore the submission and let the queue retry without
    // treating the wait as a failed AI attempt.
    const deferredAt = nowIso();
    await db.run(
      `UPDATE submissions SET status = 'received',
         ai_attempts = CASE WHEN ai_attempts > 0 THEN ai_attempts - 1 ELSE 0 END,
         ai_last_error = NULL, updated_at = ? WHERE id = ?`,
      [deferredAt, submission.id],
    );
    throw new DeferJobError(decision.deferredSeconds, decision.reasons.join(' ') || 'Throttled.');
  }

  if (decision.action === 'hold') {
    const reasons = [...new Set(decision.reasons.filter(Boolean))];
    await db.run(
      `UPDATE submissions SET status = 'queued_review', review_reason = ?, review_reasons = ?,
         ai_model = ?, processed_at = ?, ai_last_error = NULL, updated_at = ? WHERE id = ?`,
      [
        reasons.join(' ').slice(0, 900) || 'Held for review.',
        JSON.stringify(reasons),
        config.ai.model,
        now,
        now,
        submission.id,
      ],
    );
    await db.run(
      `INSERT INTO audit_logs (id, actor, action, target_type, target_id, detail, ip_hash, created_at)
       VALUES (?, 'ai-editor', 'submission.hold', 'submission', ?, ?, ?, ?)`,
      [
        `aud_${Date.now().toString(32)}${Math.random().toString(32).slice(2, 8)}`,
        submission.id,
        JSON.stringify({ reasons, severity: ai.review.severity }),
        submission.ip_hash,
        now,
      ],
    );
    log.info({ submissionId: submission.id, reasons }, 'submission held for review');
    return;
  }

  const published = await publishArticle(db, {
    submission,
    images,
    ai,
    settings,
    breaking: decision.breaking,
    actor: 'ai-editor',
  });

  await db.run(
    `UPDATE submissions SET ai_model = ?, ai_last_error = NULL, processed_at = ?,
       updated_at = ? WHERE id = ?`,
    [config.ai.model, now, now, submission.id],
  );

  log.info(
    {
      submissionId: submission.id,
      articleId: published.article.id,
      slug: published.article.slug,
      breaking: decision.breaking,
      created: published.created,
    },
    'submission published',
  );
}

async function buildVisionImages(
  images: SubmissionImageRow[],
  settings: Settings,
  log: typeof logger,
): Promise<AiImageInput[]> {
  if (!config.ai.vision || images.length === 0) return [];
  const limit = Math.min(
    images.length,
    config.ai.visionMaxImages,
    settings['submissions.max_images'],
  );
  const storage = getStorage();
  const inputs: AiImageInput[] = [];

  for (let index = 0; index < limit; index += 1) {
    const image = images[index]!;
    try {
      const buffer = await storage.read(image.storage_key, image.url);
      inputs.push({ index, dataUrl: await toVisionDataUrl(buffer) });
    } catch (error) {
      log.warn(
        { imageId: image.id, error: error instanceof Error ? error.message : String(error) },
        'could not prepare image for vision analysis',
      );
    }
  }
  return inputs;
}

export async function getSubmissionWithImages(
  db: Db,
  id: string,
): Promise<{
  submission: SubmissionRow;
  images: SubmissionImageRow[];
  article: ArticleRow | null;
} | null> {
  const submission = await db.get<SubmissionRow>('SELECT * FROM submissions WHERE id = ?', [id]);
  if (!submission) return null;
  const images = await db.all<SubmissionImageRow>(
    'SELECT * FROM submission_images WHERE submission_id = ? ORDER BY position ASC',
    [id],
  );
  const article = submission.article_id
    ? ((await db.get<ArticleRow>('SELECT * FROM articles WHERE id = ?', [submission.article_id])) ??
      null)
    : null;
  return { submission, images, article };
}
