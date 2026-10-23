import type { Db } from '../db/client.js';
import type { ArticleRow, SubmissionImageRow, SubmissionRow } from '../db/types.js';
import { newId, shortCode } from '../lib/id.js';
import { logger } from '../lib/logger.js';
import { slugify, stripHtmlLike, truncate, readingMinutes } from '../lib/text.js';
import { nextEditionDate, nowIso } from '../lib/time.js';
import type { Settings } from '../settings.js';
import { config } from '../config.js';
import type { AiResult } from './ai/schema.js';

export interface PublishInput {
  submission: SubmissionRow;
  images: SubmissionImageRow[];
  ai: AiResult;
  settings: Settings;
  breaking: boolean;
  actor: string;
  overrides?: {
    headline?: string;
    dek?: string;
    body?: string;
    categorySlug?: string;
    tags?: string[];
    placement?: 'lead' | 'top' | 'standard';
    editorNote?: string;
  };
  memberId?: string | null;
}

export interface PublishedArticle {
  article: ArticleRow;
  created: boolean;
}

const BYLINE_PREFIX = /^(?:by|written by|words by|reported by|story by|from)\s+(.+)$/i;
const BYLINE_STOPWORDS = new Set([
  'a',
  'an',
  'and',
  'are',
  'as',
  'at',
  'for',
  'from',
  'her',
  'his',
  'in',
  'is',
  'it',
  'its',
  'my',
  'of',
  'on',
  'our',
  'that',
  'the',
  'their',
  'this',
  'to',
  'was',
  'were',
  'with',
  'your',
]);

/**
 * Submitters sometimes type a byline above their story ("By boink"). The site
 * renders the byline itself, so keeping it in the body duplicates it and parks
 * the drop cap on its first letter. Drop such leading lines, but only when they
 * really look like a name: "By the time he arrived" must survive.
 */
function looksLikeByline(paragraph: string, author: string): boolean {
  const match = BYLINE_PREFIX.exec(paragraph.trim());
  if (!match) return false;
  const name = (match[1] ?? '').trim();
  if (!name || name.length > 60 || /[.!?]$/.test(name)) return false;
  if (author && name.replace(/^@/, '').toLowerCase() === author.replace(/^@/, '').toLowerCase()) {
    return true;
  }
  const words = name.split(/\s+/);
  if (words.length > 4) return false;
  return !words.some((word) =>
    BYLINE_STOPWORDS.has(word.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '')),
  );
}

export function normaliseBody(body: string, author = ''): string {
  const paragraphs = stripHtmlLike(body)
    .replace(/\r\n?/g, '\n')
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.replace(/\s+/g, ' ').trim())
    .filter(Boolean);

  let start = 0;
  while (start < 2) {
    const paragraph = paragraphs[start];
    if (!paragraph || !looksLikeByline(paragraph, author)) break;
    start += 1;
  }

  return paragraphs.slice(start).join('\n\n');
}

function cleanTags(tags: string[]): string[] {
  return [...new Set(tags.map((tag) => tag.toLowerCase().replace(/^#/, '').trim()).filter(Boolean))]
    .slice(0, 8)
    .map((tag) => truncate(tag, 32));
}

async function uniqueSlug(db: Db, headline: string): Promise<string> {
  const base = slugify(headline, 70);
  const existing = await db.get<{ id: string }>('SELECT id FROM articles WHERE slug = ?', [base]);
  if (!existing) return base;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const candidate = `${base.slice(0, 64)}-${shortCode(3)}`;
    const clash = await db.get<{ id: string }>('SELECT id FROM articles WHERE slug = ?', [
      candidate,
    ]);
    if (!clash) return candidate;
  }
  return `${base.slice(0, 54)}-${shortCode(5)}`;
}

export async function publishArticle(db: Db, input: PublishInput): Promise<PublishedArticle> {
  const { submission, settings, ai } = input;

  if (submission.article_id) {
    const existing = await db.get<ArticleRow>('SELECT * FROM articles WHERE id = ?', [
      submission.article_id,
    ]);
    if (existing) return { article: existing, created: false };
  }

  const existingBySubmission = await db.get<ArticleRow>(
    'SELECT * FROM articles WHERE submission_id = ? ORDER BY created_at DESC LIMIT 1',
    [submission.id],
  );
  if (existingBySubmission) return { article: existingBySubmission, created: false };

  const headline = stripHtmlLike(input.overrides?.headline ?? ai.headline) || 'Untitled kand';
  const dek = stripHtmlLike(input.overrides?.dek ?? ai.dek) || null;
  const body = normaliseBody(input.overrides?.body ?? ai.body, input.submission.author_name);
  if (!body) throw new Error('Refusing to publish an empty article body.');
  /**
   * An editor who types the body is the author of that text: it must not be
   * stamped as AI copy. Headline/dek/tags may still come from the model, but
   * `ai_generated` and `ai_model` describe the body.
   */
  const humanBody = Boolean(input.overrides?.body?.trim());
  const aiModel = humanBody ? null : config.ai.model;

  const categorySlug = input.overrides?.categorySlug ?? ai.category;
  const tags = cleanTags(input.overrides?.tags ?? ai.tags);
  const anonymous = submission.anonymous === 1 || submission.identity_mode === 'anonymous';
  const authorDisplay = anonymous ? 'Anonymous' : submission.author_name;
  const slug = await uniqueSlug(db, headline);
  const now = nowIso();
  const editionDate = nextEditionDate(new Date(), settings['site.timezone']);
  const articleId = newId('art');

  await db.transaction(async (tx) => {
    await tx.run(
      `INSERT INTO articles (id, slug, submission_id, headline, dek, body, original_body, category_slug,
         author_display, author_member_id, identity_mode, tags, breaking, featured, placement, rank_score,
         editor_note, status, source_url, ai_model, ai_generated, reading_minutes, edition_date, views,
         published_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, 'published', ?, ?, ?, ?, ?, 0, ?, ?, ?)`,
      [
        articleId,
        slug,
        submission.id,
        headline,
        dek,
        body,
        submission.story,
        categorySlug,
        authorDisplay,
        submission.member_id,
        submission.identity_mode,
        JSON.stringify(tags),
        input.breaking ? 1 : 0,
        input.overrides?.placement ?? 'standard',
        Math.round(55 + Math.random() * 8),
        input.overrides?.editorNote ?? null,
        submission.source_url,
        aiModel,
        humanBody ? 0 : 1,
        readingMinutes(body),
        editionDate,
        now,
        now,
        now,
      ],
    );

    let position = 0;
    for (const image of input.images) {
      await tx.run(
        `INSERT INTO article_images (id, article_id, upload_id, storage_key, thumb_key, url, thumb_url,
           mime, bytes, width, height, checksum, caption, alt_text, attribution, position, created_at,
           original_key, original_url, original_bytes, original_mime, original_store, original_preserved)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          newId('aimg'),
          articleId,
          image.upload_id,
          image.storage_key,
          image.thumb_key,
          image.url,
          image.thumb_url,
          image.mime,
          image.bytes,
          image.width,
          image.height,
          image.checksum,
          image.caption ?? 'A photo submitted with the story.',
          image.alt_text ?? 'Submitted photograph attached to the story.',
          anonymous ? 'Submitted photo' : `Photo: ${authorDisplay}`,
          position,
          now,
          image.original_key,
          image.original_url,
          image.original_bytes,
          image.original_mime,
          image.original_store,
          image.original_preserved,
        ],
      );
      position += 1;
    }

    // Stories can land after the nightly build has already assembled the edition.
    // Bump the counter so the archive and edition pages stay accurate.
    await tx.run(
      `UPDATE editions SET article_count = article_count + 1, updated_at = ? WHERE edition_date = ?`,
      [now, editionDate],
    );

    await tx.run(
      `UPDATE submissions SET status = 'published', article_id = ?, processed_at = ?, ai_model = ?,
         review_reason = NULL, review_reasons = NULL, updated_at = ? WHERE id = ?`,
      [articleId, now, aiModel, now, submission.id],
    );

    if (submission.member_id) {
      await tx.run(
        `UPDATE members SET published_count = published_count + 1, updated_at = ? WHERE id = ?`,
        [now, submission.member_id],
      );
    }

    await tx.run(
      `INSERT INTO audit_logs (id, actor, action, target_type, target_id, detail, ip_hash, created_at)
       VALUES (?, ?, 'article.publish', 'article', ?, ?, NULL, ?)`,
      [
        newId('aud'),
        input.actor,
        articleId,
        JSON.stringify({
          submissionId: submission.id,
          model: aiModel,
          autonomous: input.actor === 'ai-editor',
          manualBody: humanBody,
        }),
        now,
      ],
    );
  });

  const article = await db.get<ArticleRow>('SELECT * FROM articles WHERE id = ?', [articleId]);
  if (!article) throw new Error('Article insert failed.');

  void revalidateWeb([
    '/',
    `/article/${article.slug}`,
    `/category/${article.category_slug}`,
    '/archive',
    '/editions',
    `/edition/${editionDate}`,
  ]);
  return { article, created: true };
}

export async function revalidateWeb(
  paths: string[],
  options: { layout?: boolean } = {},
): Promise<void> {
  const url = process.env.REVALIDATE_URL;
  const secret = process.env.REVALIDATE_SECRET;
  if (!url || !secret) return;
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-revalidate-secret': secret },
      body: JSON.stringify({ paths, ...(options.layout ? { layout: true } : {}) }),
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) {
      logger.warn({ status: response.status }, 'revalidation webhook returned non-OK');
    }
  } catch (error) {
    logger.warn(
      { error: error instanceof Error ? error.message : String(error) },
      'revalidation webhook failed',
    );
  }
}

export async function findCategorySlug(
  db: Db,
  requested: string,
  fallback: string | null,
  enabledSlugs: Set<string>,
): Promise<string> {
  const wanted = requested.trim().toLowerCase();
  if (enabledSlugs.has(wanted)) return wanted;

  const all = await db.all<{ slug: string; name: string }>(
    'SELECT slug, name FROM categories WHERE enabled = 1',
  );
  const byName = all.find((category) => category.name.toLowerCase() === wanted);
  if (byName) return byName.slug;

  if (fallback && enabledSlugs.has(fallback)) return fallback;
  if (enabledSlugs.has('server-news')) return 'server-news';
  return all[0]?.slug ?? 'server-news';
}
