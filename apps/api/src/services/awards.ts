import type { Db } from '../db/client.js';
import { newId } from '../lib/id.js';
import { logger } from '../lib/logger.js';
import { truncate } from '../lib/text.js';
import { editionDateFor, nowIso } from '../lib/time.js';
import { loadSettings } from '../settings.js';
import { chatJson } from './ai/client.js';
import { buildAwardsSystemPrompt, buildAwardsUserPrompt } from './ai/prompt.js';
import { AiAwardsSchema } from './ai/schema.js';
import { revalidateWeb } from './publishing.js';

interface CandidateRow {
  name: string;
  articleCount: number;
  words: number;
}

interface AwardStoryRow {
  slug: string;
  headline: string;
  author_display: string;
  category_slug: string;
  excerpt: string;
}

export async function buildWeeklyAwards(db: Db, log: typeof logger): Promise<void> {
  const settings = await loadSettings(db);
  if (!settings['autonomy.enabled'] || !settings['autonomy.awards_enabled']) return;

  const now = new Date();
  const weekEnd = now.toISOString();
  const weekStart = new Date(now.getTime() - 7 * 86400 * 1000).toISOString();
  const editionDate = editionDateFor(now, settings['site.timezone']);

  const candidates = await db.all<CandidateRow>(
    `SELECT author_display AS name, COUNT(*) AS articleCount,
       SUM(LENGTH(body) - LENGTH(REPLACE(body, ' ', '')) + 1) AS words
     FROM articles
     WHERE status = 'published' AND published_at >= ? AND identity_mode != 'anonymous'
     GROUP BY author_display
     ORDER BY articleCount DESC, words DESC
     LIMIT 20`,
    [weekStart],
  );

  if (candidates.length < 3) {
    log.info({ candidates: candidates.length }, 'not enough candidates for awards');
    return;
  }

  const stories = await db.all<AwardStoryRow>(
    `SELECT slug, headline, author_display, category_slug, substr(body, 1, 240) AS excerpt
     FROM articles
     WHERE status = 'published' AND published_at >= ?
     ORDER BY breaking DESC, published_at DESC
     LIMIT 40`,
    [weekStart],
  );

  if (stories.length < 3) return;

  let awards;
  try {
    const result = await chatJson({
      purpose: 'weekly_awards',
      system: buildAwardsSystemPrompt(),
      user: buildAwardsUserPrompt({
        weekStart: weekStart.slice(0, 10),
        weekEnd: weekEnd.slice(0, 10),
        candidates: candidates.map((candidate) => ({
          name: candidate.name,
          articleCount: Number(candidate.articleCount),
          words: Number(candidate.words),
        })),
        stories: stories.map((story) => ({
          slug: story.slug,
          headline: story.headline,
          author: story.author_display,
          category: story.category_slug,
          excerpt: story.excerpt,
        })),
      }),
      schema: AiAwardsSchema,
      maxTokens: 1400,
      temperature: 0.95,
    });
    awards = result.data.awards;
  } catch (error) {
    log.warn(
      { error: error instanceof Error ? error.message : String(error) },
      'awards generation failed; no awards written this week',
    );
    return;
  }

  const candidateNames = new Map(
    candidates.map((candidate) => [candidate.name.toLowerCase(), candidate.name]),
  );
  const storyBySlug = new Map(stories.map((story) => [story.slug, story]));
  const articleIds = new Map(
    (
      await db.all<{ id: string; slug: string }>(
        `SELECT id, slug FROM articles WHERE slug IN (${stories.map(() => '?').join(',') || "''"})`,
        stories.map((story) => story.slug),
      )
    ).map((row) => [row.slug, row.id]),
  );

  const valid = awards
    .map((award) => {
      const winner = candidateNames.get(award.winner_name.toLowerCase());
      if (!winner) return null;
      return { ...award, winner_name: winner };
    })
    .filter((award): award is NonNullable<typeof award> => Boolean(award))
    .slice(0, 6);

  if (valid.length === 0) {
    log.warn('AI awards referenced no valid candidates; refusing to fabricate winners');
    return;
  }

  const timestamp = nowIso();
  await db.transaction(async (tx) => {
    await tx.run(`DELETE FROM awards WHERE auto_generated = 1 AND edition_date = ?`, [editionDate]);
    let order = 0;
    for (const award of valid) {
      const story = award.article_slug ? storyBySlug.get(award.article_slug) : undefined;
      await tx.run(
        `INSERT INTO awards (id, title, category, winner_name, winner_member_id, citation,
           edition_date, article_id, auto_generated, active, sort_order, created_at, updated_at)
         VALUES (?, ?, ?, ?, NULL, ?, ?, ?, 1, 1, ?, ?, ?)`,
        [
          newId('awd'),
          truncate(award.title, 80),
          'weekly',
          truncate(award.winner_name, 80),
          truncate(award.citation, 400),
          editionDate,
          story ? (articleIds.get(story.slug) ?? null) : null,
          order,
          timestamp,
          timestamp,
        ],
      );
      order += 1;
    }
    await tx.run(
      `INSERT INTO audit_logs (id, actor, action, target_type, target_id, detail, ip_hash, created_at)
       VALUES (?, 'ai-editor', 'awards.publish', 'edition', ?, ?, NULL, ?)`,
      [
        newId('aud'),
        editionDate,
        JSON.stringify({
          awards: valid.map((award) => ({ title: award.title, winner: award.winner_name })),
        }),
        timestamp,
      ],
    );
  });

  log.info({ count: valid.length, editionDate }, 'weekly awards published');
  void revalidateWeb(['/', '/awards']);
}
