import { safeQuery, safeQueryOne } from './db';
import { todayIn } from './format';
import { excerptFrom } from './prose';
import {
  buildSearchSnippet,
  containsPattern,
  normaliseSearchQuery,
  prefixPattern,
  type SearchHit,
} from './search';
import type {
  ArticleDetail,
  ArticleImageView,
  ArticleListItem,
  ArticleVoteCounts,
  AwardView,
  CategoryView,
  CommunityReview,
  EditionView,
  Page,
  ReviewSummary,
} from './types';

/** Raw shapes returned by libsql. Columns are snake_case; views are camelCase. */

interface ArticleRow {
  id: string;
  slug: string;
  headline: string;
  dek: string | null;
  body: string;
  category_slug: string;
  category_name: string | null;
  category_accent: string | null;
  author_display: string;
  identity_mode: string;
  tags: string;
  breaking: number;
  featured: number;
  placement: string;
  reading_minutes: number;
  edition_date: string;
  published_at: string | null;
  source_url: string | null;
  editor_note?: string | null;
  ai_model?: string | null;
  ai_generated?: number;
  image_count?: number;
}

interface ImageRow {
  article_id: string;
  id: string;
  url: string;
  thumb_url: string | null;
  width: number | null;
  height: number | null;
  caption: string | null;
  alt_text: string | null;
  attribution: string | null;
}

interface EditionRow {
  edition_date: string;
  headline: string | null;
  summary: string | null;
  mood: string | null;
  article_count: number;
  lead_article_id: string | null;
  generated_by: string;
  status: string;
  updated_at: string;
}

interface AwardRow {
  id: string;
  title: string;
  category: string | null;
  winner_name: string;
  citation: string | null;
  edition_date: string | null;
  article_id: string | null;
  auto_generated: number;
  sort_order: number;
}

const ARTICLE_COLUMNS = `
  a.id, a.slug, a.headline, a.dek, a.body, a.category_slug, a.author_display, a.identity_mode,
  a.tags, a.breaking, a.featured, a.placement, a.reading_minutes, a.edition_date, a.published_at,
  a.source_url, c.name AS category_name, c.accent AS category_accent,
  (SELECT COUNT(*) FROM article_images ai WHERE ai.article_id = a.id) AS image_count`;

const ARTICLE_JOIN = `
  FROM articles a
  LEFT JOIN categories c ON c.slug = a.category_slug`;

function toIdentityMode(value: string): ArticleListItem['identityMode'] {
  if (value === 'anonymous' || value === 'discord') return value;
  return 'named';
}

function toPlacement(value: string): ArticleListItem['placement'] {
  if (value === 'lead' || value === 'top') return value;
  return 'standard';
}

function parseTags(raw: string): string[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((tag): tag is string => typeof tag === 'string').slice(0, 8);
  } catch {
    return [];
  }
}

function toImage(row: ImageRow): ArticleImageView {
  return {
    id: row.id,
    url: row.url,
    thumbUrl: row.thumb_url,
    width: row.width,
    height: row.height,
    caption: row.caption,
    alt: row.alt_text,
    attribution: row.attribution,
  };
}

function toListItem(row: ArticleRow, image: ArticleImageView | null): ArticleListItem {
  return {
    id: row.id,
    slug: row.slug,
    headline: row.headline,
    dek: row.dek,
    excerpt: excerptFrom(row.dek || row.body, 230),
    categorySlug: row.category_slug,
    categoryName: row.category_name ?? row.category_slug,
    categoryAccent: row.category_accent,
    authorDisplay: row.author_display,
    identityMode: toIdentityMode(row.identity_mode),
    tags: parseTags(row.tags),
    breaking: row.breaking === 1,
    featured: row.featured === 1,
    placement: toPlacement(row.placement),
    readingMinutes: row.reading_minutes || 1,
    editionDate: row.edition_date,
    publishedAt: row.published_at,
    sourceUrl: row.source_url,
    image,
    imageCount: Number(row.image_count ?? 0),
  };
}

/** Fetch cover images for a batch of articles in one query. */
async function attachImages(rows: ArticleRow[]): Promise<ArticleListItem[]> {
  if (rows.length === 0) return [];
  const placeholders = rows.map(() => '?').join(', ');
  const images = await safeQuery<ImageRow>(
    `SELECT article_id, id, url, thumb_url, width, height, caption, alt_text, attribution
     FROM article_images WHERE article_id IN (${placeholders})
     ORDER BY article_id, position ASC`,
    rows.map((row) => row.id),
  );
  const byArticle = new Map<string, ArticleImageView>();
  for (const image of images) {
    if (!byArticle.has(image.article_id)) byArticle.set(image.article_id, toImage(image));
  }
  return rows.map((row) => toListItem(row, byArticle.get(row.id) ?? null));
}

function escapeLike(input: string): string {
  return input.replace(/[\\%_]/g, (match) => `\\${match}`);
}

export interface ArticleFilters {
  category?: string;
  query?: string;
  tag?: string;
  breaking?: boolean;
  editionDate?: string;
  /** `YYYY-MM` — matches the edition the story ran in, not the UTC month. */
  editionMonth?: string;
  excludeId?: string;
  limit?: number;
  offset?: number;
  /** `recent` = newest first; `ranked` = front-page hierarchy. */
  order?: 'recent' | 'ranked';
}

interface WhereClause {
  sql: string;
  args: Array<string | number>;
}

function buildArticleWhere(filters: ArticleFilters): WhereClause {
  const clauses: string[] = ["a.status = 'published'"];
  const args: Array<string | number> = [];

  if (filters.category) {
    clauses.push('a.category_slug = ?');
    args.push(filters.category);
  }
  if (filters.breaking) clauses.push('a.breaking = 1');
  if (filters.editionDate) {
    clauses.push('a.edition_date = ?');
    args.push(filters.editionDate);
  }
  if (filters.editionMonth) {
    clauses.push('substr(a.edition_date, 1, 7) = ?');
    args.push(filters.editionMonth);
  }
  if (filters.excludeId) {
    clauses.push('a.id <> ?');
    args.push(filters.excludeId);
  }
  if (filters.tag) {
    clauses.push("a.tags LIKE ? ESCAPE '\\'");
    args.push(`%"${escapeLike(filters.tag.toLowerCase())}"%`);
  }
  if (filters.query) {
    const pattern = `%${escapeLike(filters.query)}%`;
    clauses.push(
      "(a.headline LIKE ? ESCAPE '\\' OR a.dek LIKE ? ESCAPE '\\' OR a.body LIKE ? ESCAPE '\\' OR a.tags LIKE ? ESCAPE '\\')",
    );
    args.push(pattern, pattern, pattern, pattern);
  }

  return { sql: clauses.join(' AND '), args };
}

export async function listArticles(filters: ArticleFilters = {}): Promise<Page<ArticleListItem>> {
  const limit = Math.min(Math.max(filters.limit ?? 12, 1), 60);
  const offset = Math.max(filters.offset ?? 0, 0);
  const where = buildArticleWhere(filters);

  const order =
    filters.order === 'ranked'
      ? "CASE a.placement WHEN 'lead' THEN 0 WHEN 'top' THEN 1 ELSE 2 END, a.rank_score DESC, a.published_at DESC"
      : 'a.published_at DESC';

  const [rows, totalRow] = await Promise.all([
    safeQuery<ArticleRow>(
      `SELECT ${ARTICLE_COLUMNS} ${ARTICLE_JOIN}
       WHERE ${where.sql}
       ORDER BY ${order}
       LIMIT ? OFFSET ?`,
      [...where.args, limit, offset],
    ),
    safeQueryOne<{ total: number }>(
      `SELECT COUNT(*) AS total ${ARTICLE_JOIN} WHERE ${where.sql}`,
      where.args,
    ),
  ]);

  return {
    items: await attachImages(rows),
    total: Number(totalRow?.total ?? 0),
    limit,
    offset,
  };
}

interface SearchRow {
  slug: string;
  headline: string;
  dek: string | null;
  body: string;
  category_slug: string;
  category_name: string | null;
  category_accent: string | null;
  published_at: string | null;
  reading_minutes: number;
}

/**
 * Search every published article in one query — the page never searches only
 * what it has already loaded. Headline matches rank above tag/category matches,
 * which rank above a mention buried in the body.
 */
export async function searchArticles(
  query: string,
  limit = 6,
): Promise<{ hits: SearchHit[]; hasMore: boolean }> {
  const cleaned = normaliseSearchQuery(query);
  if (cleaned.length < 2) return { hits: [], hasMore: false };

  const capped = Math.min(Math.max(limit, 1), 12);
  const contains = containsPattern(cleaned);
  const prefix = prefixPattern(cleaned);

  const rows = await safeQuery<SearchRow>(
    `SELECT a.slug, a.headline, a.dek, a.body, a.category_slug,
            c.name AS category_name, c.accent AS category_accent,
            a.published_at, a.reading_minutes
     FROM articles a
     LEFT JOIN categories c ON c.slug = a.category_slug
     WHERE a.status = 'published'
       AND (
         a.headline LIKE ? ESCAPE '\\'
         OR a.dek LIKE ? ESCAPE '\\'
         OR a.body LIKE ? ESCAPE '\\'
         OR a.tags LIKE ? ESCAPE '\\'
         OR c.name LIKE ? ESCAPE '\\'
       )
     ORDER BY
       CASE
         WHEN lower(a.headline) = lower(?) THEN 0
         WHEN a.headline LIKE ? ESCAPE '\\' THEN 1
         WHEN a.tags LIKE ? ESCAPE '\\' OR c.name LIKE ? ESCAPE '\\' THEN 2
         WHEN a.dek LIKE ? ESCAPE '\\' THEN 3
         ELSE 4
       END,
       a.published_at DESC
     LIMIT ?`,
    [
      contains,
      contains,
      contains,
      contains,
      contains,
      cleaned,
      prefix,
      contains,
      contains,
      contains,
      capped + 1,
    ],
  );

  return {
    hits: rows.slice(0, capped).map((row) => ({
      slug: row.slug,
      headline: row.headline,
      dek: row.dek,
      categoryName: row.category_name ?? row.category_slug,
      categoryAccent: row.category_accent,
      publishedAt: row.published_at,
      readingMinutes: row.reading_minutes,
      snippet: buildSearchSnippet(row.body, cleaned),
    })),
    hasMore: rows.length > capped,
  };
}

export async function getCategories(): Promise<CategoryView[]> {
  const rows = await safeQuery<{
    slug: string;
    name: string;
    description: string | null;
    accent: string | null;
    sort_order: number;
    published_count: number;
  }>(
    `SELECT c.slug, c.name, c.description, c.accent, c.sort_order,
       (SELECT COUNT(*) FROM articles a WHERE a.category_slug = c.slug AND a.status = 'published')
         AS published_count
     FROM categories c
     WHERE c.enabled = 1
     ORDER BY c.sort_order ASC, c.name ASC`,
  );
  return rows.map((row) => ({
    slug: row.slug,
    name: row.name,
    description: row.description,
    accent: row.accent,
    sortOrder: row.sort_order,
    publishedCount: Number(row.published_count ?? 0),
  }));
}

export async function getCategory(slug: string): Promise<CategoryView | null> {
  const row = await safeQueryOne<{
    slug: string;
    name: string;
    description: string | null;
    accent: string | null;
    sort_order: number;
    published_count: number;
  }>(
    `SELECT c.slug, c.name, c.description, c.accent, c.sort_order,
       (SELECT COUNT(*) FROM articles a WHERE a.category_slug = c.slug AND a.status = 'published')
         AS published_count
     FROM categories c WHERE c.slug = ? AND c.enabled = 1`,
    [slug],
  );
  if (!row) return null;
  return {
    slug: row.slug,
    name: row.name,
    description: row.description,
    accent: row.accent,
    sortOrder: row.sort_order,
    publishedCount: Number(row.published_count ?? 0),
  };
}

export async function getArticle(slug: string): Promise<ArticleDetail | null> {
  const row = await safeQueryOne<ArticleRow>(
    `SELECT ${ARTICLE_COLUMNS}, a.editor_note, a.ai_model, a.ai_generated ${ARTICLE_JOIN}
     WHERE a.slug = ? AND a.status = 'published'`,
    [slug],
  );
  if (!row) return null;

  const images = await safeQuery<ImageRow>(
    `SELECT article_id, id, url, thumb_url, width, height, caption, alt_text, attribution
     FROM article_images WHERE article_id = ? ORDER BY position ASC`,
    [row.id],
  );
  const views = images.map(toImage);
  return {
    ...toListItem(row, views[0] ?? null),
    body: row.body,
    editorNote: row.editor_note ?? null,
    aiModel: row.ai_model ?? null,
    aiGenerated: row.ai_generated === 1,
    images: views,
  };
}

export async function getRelatedArticles(
  article: Pick<ArticleListItem, 'id' | 'categorySlug'>,
  limit = 3,
): Promise<ArticleListItem[]> {
  const sameCategory = await listArticles({
    category: article.categorySlug,
    excludeId: article.id,
    limit,
  });
  if (sameCategory.items.length >= limit) return sameCategory.items;
  const fallback = await listArticles({ excludeId: article.id, limit });
  const seen = new Set(sameCategory.items.map((item) => item.id));
  return [...sameCategory.items, ...fallback.items.filter((item) => !seen.has(item.id))].slice(
    0,
    limit,
  );
}

function toEdition(row: EditionRow): EditionView {
  return {
    editionDate: row.edition_date,
    headline: row.headline,
    summary: row.summary,
    mood: row.mood,
    articleCount: Number(row.article_count ?? 0),
    leadArticleId: row.lead_article_id,
    generatedBy: row.generated_by,
    status: row.status === 'draft' ? 'draft' : 'published',
    updatedAt: row.updated_at,
  };
}

/** Today's edition, or the most recent published one while the robot is still typing. */
export async function getCurrentEdition(timeZone: string): Promise<EditionView | null> {
  const today = todayIn(timeZone);
  const row = await safeQueryOne<EditionRow>(
    `SELECT * FROM editions
     WHERE status = 'published' AND edition_date <= ?
     ORDER BY edition_date DESC LIMIT 1`,
    [today],
  );
  return row ? toEdition(row) : null;
}

export async function getEdition(date: string): Promise<EditionView | null> {
  const row = await safeQueryOne<EditionRow>(
    "SELECT * FROM editions WHERE edition_date = ? AND status = 'published'",
    [date],
  );
  return row ? toEdition(row) : null;
}

export async function getEditionArticles(date: string): Promise<ArticleListItem[]> {
  const rows = await safeQuery<ArticleRow>(
    `SELECT ${ARTICLE_COLUMNS} ${ARTICLE_JOIN}
     WHERE a.status = 'published' AND a.edition_date = ?
     ORDER BY CASE a.placement WHEN 'lead' THEN 0 WHEN 'top' THEN 1 ELSE 2 END,
       a.rank_score DESC, a.published_at DESC
     LIMIT 60`,
    [date],
  );
  return attachImages(rows);
}

export async function listEditions(limit = 12, offset = 0): Promise<Page<EditionView>> {
  const capped = Math.min(Math.max(limit, 1), 40);
  const safeOffset = Math.max(offset, 0);
  const [rows, total] = await Promise.all([
    safeQuery<EditionRow>(
      `SELECT * FROM editions WHERE status = 'published'
       ORDER BY edition_date DESC LIMIT ? OFFSET ?`,
      [capped, safeOffset],
    ),
    safeQueryOne<{ total: number }>(
      "SELECT COUNT(*) AS total FROM editions WHERE status = 'published'",
    ),
  ]);
  return {
    items: rows.map(toEdition),
    total: Number(total?.total ?? 0),
    limit: capped,
    offset: safeOffset,
  };
}

export async function getLatestAwards(limit = 8): Promise<AwardView[]> {
  const rows = await safeQuery<AwardRow>(
    `SELECT id, title, category, winner_name, citation, edition_date, article_id,
       auto_generated, sort_order
     FROM awards WHERE active = 1
     ORDER BY edition_date DESC, sort_order ASC, created_at DESC
     LIMIT ?`,
    [Math.min(Math.max(limit, 1), 40)],
  );
  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    category: row.category,
    winnerName: row.winner_name,
    citation: row.citation,
    editionDate: row.edition_date,
    articleId: row.article_id,
    autoGenerated: row.auto_generated === 1,
    sortOrder: row.sort_order,
  }));
}

export interface PhotoView {
  id: string;
  url: string;
  thumbUrl: string | null;
  width: number | null;
  height: number | null;
  caption: string | null;
  alt: string | null;
  attribution: string | null;
  articleSlug: string;
  articleHeadline: string;
  publishedAt: string | null;
}

export async function listPhotos(limit = 24, offset = 0): Promise<Page<PhotoView>> {
  const capped = Math.min(Math.max(limit, 1), 60);
  const safeOffset = Math.max(offset, 0);
  const [rows, total] = await Promise.all([
    safeQuery<{
      id: string;
      url: string;
      thumb_url: string | null;
      width: number | null;
      height: number | null;
      caption: string | null;
      alt_text: string | null;
      attribution: string | null;
      article_slug: string;
      article_headline: string;
      published_at: string | null;
    }>(
      `SELECT ai.id, ai.url, ai.thumb_url, ai.width, ai.height, ai.caption, ai.alt_text,
         ai.attribution, a.slug AS article_slug, a.headline AS article_headline, a.published_at
       FROM article_images ai
       JOIN articles a ON a.id = ai.article_id
       WHERE a.status = 'published'
       ORDER BY a.published_at DESC, ai.position ASC
       LIMIT ? OFFSET ?`,
      [capped, safeOffset],
    ),
    safeQueryOne<{ total: number }>(
      `SELECT COUNT(*) AS total FROM article_images ai
       JOIN articles a ON a.id = ai.article_id WHERE a.status = 'published'`,
    ),
  ]);
  return {
    items: rows.map((row) => ({
      id: row.id,
      url: row.url,
      thumbUrl: row.thumb_url,
      width: row.width,
      height: row.height,
      caption: row.caption,
      alt: row.alt_text,
      attribution: row.attribution,
      articleSlug: row.article_slug,
      articleHeadline: row.article_headline,
      publishedAt: row.published_at,
    })),
    total: Number(total?.total ?? 0),
    limit: capped,
    offset: safeOffset,
  };
}

export interface ArchiveMonth {
  month: string;
  count: number;
}

export async function getArchiveMonths(): Promise<ArchiveMonth[]> {
  const rows = await safeQuery<{ month: string; count: number }>(
    `SELECT strftime('%Y-%m', published_at) AS month, COUNT(*) AS count
     FROM articles
     WHERE status = 'published' AND published_at IS NOT NULL
     GROUP BY month ORDER BY month DESC LIMIT 60`,
  );
  return rows
    .filter((row) => typeof row.month === 'string' && row.month.length === 7)
    .map((row) => ({ month: row.month, count: Number(row.count ?? 0) }));
}

export async function getTagCloud(limit = 24): Promise<Array<{ tag: string; count: number }>> {
  const rows = await safeQuery<{ tags: string }>(
    `SELECT tags FROM articles WHERE status = 'published' ORDER BY published_at DESC LIMIT 300`,
  );
  const counts = new Map<string, number>();
  for (const row of rows) {
    for (const tag of parseTags(row.tags)) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag))
    .slice(0, limit);
}

export interface SiteStats {
  articles: number;
  contributors: number;
  editions: number;
  photos: number;
}

export async function getSiteStats(): Promise<SiteStats> {
  const row = await safeQueryOne<{
    articles: number;
    contributors: number;
    editions: number;
    photos: number;
  }>(
    `SELECT
       (SELECT COUNT(*) FROM articles WHERE status = 'published') AS articles,
       (SELECT COUNT(DISTINCT author_display) FROM articles WHERE status = 'published') AS contributors,
       (SELECT COUNT(*) FROM editions WHERE status = 'published') AS editions,
       (SELECT COUNT(*) FROM article_images) AS photos`,
  );
  return {
    articles: Number(row?.articles ?? 0),
    contributors: Number(row?.contributors ?? 0),
    editions: Number(row?.editions ?? 0),
    photos: Number(row?.photos ?? 0),
  };
}

/** Everything the sitemap needs, in one place. */
export async function getSitemapData(): Promise<{
  articles: Array<{ slug: string; publishedAt: string | null }>;
  categories: Array<{ slug: string }>;
  editions: Array<{ editionDate: string; updatedAt: string }>;
}> {
  const [articles, categories, editions] = await Promise.all([
    safeQuery<{ slug: string; published_at: string | null }>(
      "SELECT slug, published_at FROM articles WHERE status = 'published' ORDER BY published_at DESC LIMIT 5000",
    ),
    safeQuery<{ slug: string }>(
      'SELECT slug FROM categories WHERE enabled = 1 ORDER BY sort_order',
    ),
    safeQuery<{ edition_date: string; updated_at: string }>(
      "SELECT edition_date, updated_at FROM editions WHERE status = 'published' ORDER BY edition_date DESC LIMIT 400",
    ),
  ]);
  return {
    articles: articles.map((row) => ({ slug: row.slug, publishedAt: row.published_at })),
    categories: categories.map((row) => ({ slug: row.slug })),
    editions: editions.map((row) => ({ editionDate: row.edition_date, updatedAt: row.updated_at })),
  };
}

export async function listBreaking(limit: number): Promise<ArticleListItem[]> {
  const { items } = await listArticles({ breaking: true, limit });
  return items;
}

export interface FrontPage {
  lead: ArticleListItem | null;
  top: ArticleListItem[];
  latest: ArticleListItem[];
  breaking: ArticleListItem[];
  edition: EditionView | null;
}

/**
 * Front-page composition. Breaking news wins the lead while it is fresh; after
 * that the edition's chosen lead takes over, then the newest story. Everything
 * is live from the database, so a new submission never waits for a deploy.
 */
export async function getFrontPage(options: {
  limit: number;
  tickerCount: number;
  timeZone: string;
}): Promise<FrontPage> {
  const { limit, tickerCount, timeZone } = options;
  const [recent, breaking, edition] = await Promise.all([
    listArticles({ limit: Math.max(limit, 6) }),
    listBreaking(Math.max(tickerCount, 1)),
    getCurrentEdition(timeZone),
  ]);

  const items = recent.items;
  const now = Date.now();
  const freshBreaking =
    breaking.find(
      (item) => item.publishedAt && now - new Date(item.publishedAt).getTime() < 36 * 3600 * 1000,
    ) ?? null;

  let lead: ArticleListItem | null = freshBreaking;
  if (!lead && edition?.leadArticleId) {
    lead = items.find((item) => item.id === edition.leadArticleId) ?? null;
  }
  if (!lead) lead = items[0] ?? null;

  const rest = items.filter((item) => item.id !== lead?.id);
  const top = rest.slice(0, 4);
  const latest = rest.slice(4);

  return { lead, top, latest, breaking, edition };
}

/** Edition rows for the archive strip on the front page. */
export async function getRecentEditions(limit = 7): Promise<EditionView[]> {
  const page = await listEditions(limit, 0);
  return page.items;
}

// --------------------------------------------------------------- community

interface ReviewRow {
  id: string;
  display_name: string | null;
  avatar_url: string | null;
  rating: number;
  body: string;
  status: string;
  created_at: string;
  updated_at: string;
}

function toCommunityReview(row: ReviewRow): CommunityReview {
  return {
    id: row.id,
    displayName: row.display_name,
    avatarUrl: row.avatar_url,
    rating: Number(row.rating),
    body: row.body,
    status: row.status === 'pending' || row.status === 'hidden' ? row.status : 'published',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Vote counts for one story. The reader's own vote is filled in client-side
 * because the server render must not depend on a personal cookie (it would
 * turn every article into a dynamic render).
 */
export async function getArticleVoteCounts(articleId: string): Promise<ArticleVoteCounts> {
  const row = await safeQueryOne<{ likes: number; dislikes: number }>(
    `SELECT
       COALESCE(SUM(CASE WHEN value = 1 THEN 1 ELSE 0 END), 0) AS likes,
       COALESCE(SUM(CASE WHEN value = -1 THEN 1 ELSE 0 END), 0) AS dislikes
     FROM article_votes WHERE article_id = ?`,
    [articleId],
  );
  return {
    articleId,
    likes: Number(row?.likes ?? 0),
    dislikes: Number(row?.dislikes ?? 0),
    myVote: null,
    authenticated: false,
  };
}

/** Published ratings only: pending and hidden reviews never count. */
export async function getReviewSummary(articleId: string): Promise<ReviewSummary> {
  const rows = await safeQuery<{ rating: number; count: number }>(
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

export async function listPublishedReviews(
  articleId: string,
  limit = 10,
  offset = 0,
): Promise<CommunityReview[]> {
  const capped = Math.min(Math.max(limit, 1), 50);
  const safeOffset = Math.max(offset, 0);
  const rows = await safeQuery<ReviewRow>(
    `SELECT id, display_name, avatar_url, rating, body, status, created_at, updated_at
     FROM article_reviews
     WHERE article_id = ? AND status = 'published'
     ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    [articleId, capped, safeOffset],
  );
  return rows.map(toCommunityReview);
}
