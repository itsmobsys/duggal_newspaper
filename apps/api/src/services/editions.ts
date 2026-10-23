import type { Db } from '../db/client.js';
import type { EditionRow } from '../db/types.js';
import { logger } from '../lib/logger.js';
import { truncate } from '../lib/text.js';
import { editionDateFor, nowIso } from '../lib/time.js';
import { loadSettings } from '../settings.js';
import { chatJson } from './ai/client.js';
import { AiEditionSchema } from './ai/schema.js';
import { buildEditionSystemPrompt, buildEditionUserPrompt } from './ai/prompt.js';
import { revalidateWeb } from './publishing.js';

interface StoryPreview {
  id: string;
  slug: string;
  headline: string;
  dek: string | null;
  category_slug: string;
  author_display: string;
  breaking: number;
  has_photo: number;
  published_at: string;
}

export async function buildEdition(
  db: Db,
  date: string,
  log: typeof logger,
  options: { force?: boolean } = {},
): Promise<void> {
  const settings = await loadSettings(db);
  // `force` is an explicit admin action ("build the paper now"). It overrides
  // the autonomy gates, which exist for unattended runs only.
  if (!options.force && (!settings['autonomy.enabled'] || !settings['autonomy.daily_edition'])) {
    return;
  }

  const stories = await db.all<StoryPreview>(
    `SELECT a.id, a.slug, a.headline, a.dek, a.category_slug, a.author_display, a.breaking,
       (SELECT COUNT(*) FROM article_images ai WHERE ai.article_id = a.id) > 0 AS has_photo,
       a.published_at
     FROM articles a
     WHERE a.status = 'published' AND a.edition_date = ?
     ORDER BY a.breaking DESC, a.published_at DESC
     LIMIT 25`,
    [date],
  );

  if (stories.length === 0) {
    log.info({ date }, 'no stories for edition; skipping');
    return;
  }

  const existing = await db.get<EditionRow>('SELECT * FROM editions WHERE edition_date = ?', [
    date,
  ]);
  const canUpgrade = existing && (existing.generated_by !== 'ai' || options.force === true);
  if (existing && !canUpgrade) {
    await db.run('UPDATE editions SET article_count = ?, updated_at = ? WHERE edition_date = ?', [
      stories.length,
      nowIso(),
      date,
    ]);
    return;
  }

  const validSlugs = new Set(stories.map((story) => story.slug));
  let edition;
  try {
    const result = await chatJson({
      purpose: 'build_edition',
      system: buildEditionSystemPrompt(),
      user: buildEditionUserPrompt({
        editionDate: date,
        stories: stories.map((story) => ({
          slug: story.slug,
          headline: story.headline,
          dek: story.dek,
          category: story.category_slug,
          author: story.author_display,
          breaking: story.breaking === 1,
          hasPhoto: story.has_photo === 1,
          publishedAt: story.published_at,
        })),
      }),
      schema: AiEditionSchema,
      maxTokens: 1800,
      temperature: 0.85,
    });
    edition = result.data;
  } catch (error) {
    log.warn(
      { error: error instanceof Error ? error.message : String(error) },
      'AI edition generation failed; using deterministic layout',
    );
    // Never downgrade a finished AI edition to a fallback during a manual
    // rebuild. Keep the existing paper and just refresh its story count.
    if (existing && existing.generated_by === 'ai') {
      await db.run('UPDATE editions SET article_count = ?, updated_at = ? WHERE edition_date = ?', [
        stories.length,
        nowIso(),
        date,
      ]);
      return;
    }
    await writeFallbackEdition(db, date, stories);
    void revalidateWeb(['/', '/editions', `/edition/${date}`]);
    return;
  }

  const rankings = edition.rankings.filter((ranking) => validSlugs.has(ranking.slug));
  const leadSlug = validSlugs.has(edition.lead_article_slug)
    ? edition.lead_article_slug
    : (rankings.find((ranking) => ranking.placement === 'lead')?.slug ??
      rankings.sort((a, b) => b.rank - a.rank)[0]?.slug ??
      stories[0]!.slug);

  const lead = stories.find((story) => story.slug === leadSlug) ?? stories[0]!;
  const now = nowIso();

  await db.transaction(async (tx) => {
    await tx.run(
      `INSERT INTO editions (edition_date, headline, summary, mood, lead_article_id, article_count,
         generated_by, ai_model, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'ai', ?, 'published', ?, ?)
       ON CONFLICT(edition_date) DO UPDATE SET headline = excluded.headline, summary = excluded.summary,
         mood = excluded.mood, lead_article_id = excluded.lead_article_id,
         article_count = excluded.article_count, generated_by = 'ai', ai_model = excluded.ai_model,
         updated_at = excluded.updated_at`,
      [
        date,
        truncate(edition.headline, 140),
        truncate(edition.summary, 1800),
        truncate(edition.mood, 40),
        lead.id,
        stories.length,
        'minimaxai/minimax-m3.1-flash',
        now,
        now,
      ],
    );

    // Reset previous rankings for the day, then apply the AI's ordering.
    await tx.run(
      `UPDATE articles SET placement = 'standard', rank_score = 40,
         updated_at = ? WHERE edition_date = ? AND status = 'published'`,
      [now, date],
    );

    let topCount = 0;
    for (const ranking of rankings.sort((a, b) => b.rank - a.rank)) {
      let placement: 'lead' | 'top' | 'standard' = ranking.placement;
      if (ranking.slug === leadSlug) placement = 'lead';
      else if (placement === 'lead') placement = 'top';
      if (placement === 'top') {
        if (topCount >= 3) placement = 'standard';
        else topCount += 1;
      }
      await tx.run(
        `UPDATE articles SET rank_score = ?, placement = ?, editor_note = ?, updated_at = ?
         WHERE slug = ? AND edition_date = ?`,
        [
          Math.max(0, Math.min(100, Math.round(ranking.rank))),
          placement,
          ranking.editor_note ? truncate(ranking.editor_note, 220) : null,
          now,
          ranking.slug,
          date,
        ],
      );
    }

    await tx.run(
      `UPDATE articles SET placement = 'lead', rank_score = MAX(rank_score, 90), updated_at = ?
       WHERE id = ?`,
      [now, lead.id],
    );

    await tx.run(
      `INSERT INTO audit_logs (id, actor, action, target_type, target_id, detail, ip_hash, created_at)
       VALUES (?, 'ai-editor', 'edition.publish', 'edition', ?, ?, NULL, ?)`,
      [
        `aud_${Date.now().toString(32)}${Math.random().toString(32).slice(2, 8)}`,
        date,
        JSON.stringify({ stories: stories.length, lead: lead.slug, mood: edition.mood }),
        now,
      ],
    );
  });

  log.info({ date, stories: stories.length, lead: lead.slug }, 'edition built');
  void revalidateWeb(['/', '/editions', `/edition/${date}`]);
}

async function writeFallbackEdition(db: Db, date: string, stories: StoryPreview[]): Promise<void> {
  const now = nowIso();
  const ranked = [...stories].sort((a, b) => {
    const score = (story: StoryPreview) =>
      (story.breaking ? 50 : 0) +
      (story.has_photo ? 20 : 0) +
      new Date(story.published_at).getTime() / 1e13;
    return score(b) - score(a);
  });
  const lead = ranked[0]!;

  await db.transaction(async (tx) => {
    await tx.run(
      `INSERT INTO editions (edition_date, headline, summary, mood, lead_article_id, article_count,
         generated_by, ai_model, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'fallback', NULL, 'published', ?, ?)
       ON CONFLICT(edition_date) DO UPDATE SET headline = excluded.headline, summary = excluded.summary,
         lead_article_id = excluded.lead_article_id, article_count = excluded.article_count,
         generated_by = 'fallback', updated_at = excluded.updated_at`,
      [
        date,
        truncate(`Today's paper: ${lead.headline}`, 140),
        'The AI editor is temporarily offline, so this edition is laid out by the night desk. The stories below are real submissions and remain fully readable. The robot will be back.',
        'understaffed',
        lead.id,
        stories.length,
        now,
        now,
      ],
    );
    await tx.run(
      `UPDATE articles SET placement = 'standard', rank_score = 40, updated_at = ?
       WHERE edition_date = ? AND status = 'published'`,
      [now, date],
    );
    await tx.run(
      `UPDATE articles SET placement = 'lead', rank_score = 90, updated_at = ? WHERE id = ?`,
      [now, lead.id],
    );
    let topCount = 0;
    for (const story of ranked.slice(1)) {
      if (topCount >= 3) break;
      await tx.run(
        `UPDATE articles SET placement = 'top', rank_score = 70, updated_at = ? WHERE id = ?`,
        [now, story.id],
      );
      topCount += 1;
    }
  });
}

export async function ensureEditionRow(db: Db, date: string): Promise<EditionRow | null> {
  return (
    (await db.get<EditionRow>('SELECT * FROM editions WHERE edition_date = ?', [date])) ?? null
  );
}

export async function latestEditions(db: Db, limit = 12): Promise<EditionRow[]> {
  return db.all<EditionRow>(
    `SELECT * FROM editions WHERE status = 'published' ORDER BY edition_date DESC LIMIT ?`,
    [limit],
  );
}

export function todayEditionDate(timezone: string): string {
  return editionDateFor(new Date(), timezone);
}
