import { SITE_DESCRIPTION_FALLBACK, SITE_NAME_FALLBACK } from '@/lib/constants';
import { listArticles } from '@/lib/queries';
import { defaultPublicSettings, getPublicSettings, siteUrl } from '@/lib/settings';
import type { PublicSettings } from '@/lib/types';

/**
 * RSS 2.0 feed for the newspaper.
 *
 * Hand-written XML: no feed dependency, no HTML in descriptions, no remote
 * images fetched at render time. `<media:content>` is emitted only when the
 * story has an image whose extension maps to a known image type.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const FEED_LIMIT = 40;

/**
 * Characters that are illegal in XML 1.0: most C0 controls, the C1 range and
 * the two noncharacters at the end of the BMP. SQLite does not validate text,
 * so a stray byte order mark or control code can otherwise make the feed
 * unparseable for every reader at once.
 */
// eslint-disable-next-line no-control-regex -- stripping control characters is the entire point
const ILLEGAL_XML_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\uFFFE\uFFFF]/g;

function clean(value: string | null | undefined): string {
  if (!value) return '';
  return value.replace(ILLEGAL_XML_CHARS, '').replace(/\s+/g, ' ').trim();
}

/** Escape text for element content and attribute values. */
function escapeXml(value: string): string {
  return clean(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function rfc822(value: string | null | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toUTCString();
}

function imageMime(url: string): string | null {
  const pathname = url.split(/[?#]/)[0]?.toLowerCase() ?? '';
  if (pathname.endsWith('.webp')) return 'image/webp';
  if (pathname.endsWith('.png')) return 'image/png';
  if (pathname.endsWith('.jpg') || pathname.endsWith('.jpeg')) return 'image/jpeg';
  if (pathname.endsWith('.gif')) return 'image/gif';
  if (pathname.endsWith('.avif')) return 'image/avif';
  return null;
}

interface MediaContent {
  url: string;
  mime: string;
}

/** Resolve a submitted image to an absolute http(s) URL, or drop it. */
function mediaFor(base: string, rawUrl: string | null | undefined): MediaContent | null {
  const trimmed = rawUrl?.trim();
  if (!trimmed || trimmed.startsWith('data:')) return null;
  const absolute = /^https?:\/\//i.test(trimmed)
    ? trimmed
    : trimmed.startsWith('//')
      ? `https:${trimmed}`
      : trimmed.startsWith('/')
        ? `${base}${trimmed}`
        : null;
  if (!absolute) return null;
  const mime = imageMime(absolute);
  return mime ? { url: absolute, mime } : null;
}

interface FeedItem {
  title: string;
  link: string;
  description: string;
  pubDate: string | null;
  category: string;
  media: MediaContent | null;
}

function renderItem(item: FeedItem): string {
  const lines = [
    '    <item>',
    `      <title>${escapeXml(item.title)}</title>`,
    `      <link>${escapeXml(item.link)}</link>`,
    `      <guid isPermaLink="true">${escapeXml(item.link)}</guid>`,
  ];

  if (item.pubDate) lines.push(`      <pubDate>${escapeXml(item.pubDate)}</pubDate>`);

  lines.push(
    `      <description>${escapeXml(item.description)}</description>`,
    `      <category>${escapeXml(item.category)}</category>`,
  );

  if (item.media) {
    lines.push(
      `      <media:content url="${escapeXml(item.media.url)}" medium="image" type="${item.media.mime}" />`,
    );
  }

  lines.push('    </item>');
  return lines.join('\n');
}

function feedXml(options: { base: string; settings: PublicSettings; items: FeedItem[] }): string {
  const { base, settings, items } = options;
  const newest = items.find((item) => item.pubDate !== null);
  const lastBuildDate = newest?.pubDate ?? new Date().toUTCString();
  const hasMedia = items.some((item) => item.media !== null);

  const namespaces = ['xmlns:atom="http://www.w3.org/2005/Atom"'];
  if (hasMedia) namespaces.push('xmlns:media="http://search.yahoo.com/mrss/"');

  const description =
    clean(settings.site.description) || clean(settings.site.tagline) || SITE_DESCRIPTION_FALLBACK;
  const title = clean(settings.site.name) || SITE_NAME_FALLBACK;

  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<rss version="2.0" ${namespaces.join(' ')}>`,
    '  <channel>',
    `    <title>${escapeXml(title)}</title>`,
    `    <link>${escapeXml(base)}</link>`,
    `    <description>${escapeXml(description)}</description>`,
    '    <language>en-IN</language>',
    `    <lastBuildDate>${escapeXml(lastBuildDate)}</lastBuildDate>`,
    '    <generator>Duggal Badmosh Newsroom</generator>',
    `    <atom:link href="${escapeXml(`${base}/rss.xml`)}" rel="self" type="application/rss+xml" />`,
    ...items.map(renderItem),
    '  </channel>',
    '</rss>',
    '',
  ];

  return lines.join('\n');
}

export async function GET(): Promise<Response> {
  let settings = defaultPublicSettings();
  try {
    settings = await getPublicSettings();
  } catch {
    // Fall back to the canonical defaults; a feed with no items still parses.
  }

  // An empty setting would produce relative links, which RSS readers reject.
  const base = siteUrl(settings) || siteUrl(defaultPublicSettings());
  const items: FeedItem[] = [];

  try {
    const page = await listArticles({ limit: FEED_LIMIT });
    for (const article of page.items.slice(0, FEED_LIMIT)) {
      const link = `${base}/article/${encodeURIComponent(article.slug)}`;
      items.push({
        title: clean(article.headline) || 'Untitled story',
        link,
        description: clean(article.dek) || clean(article.excerpt) || article.headline,
        pubDate: rfc822(article.publishedAt),
        category: article.categoryName,
        media: mediaFor(base, article.image?.url ?? article.image?.thumbUrl),
      });
    }
  } catch {
    // A dead database yields an empty (but valid) channel rather than a 500.
  }

  const xml = feedXml({ base, settings, items });

  return new Response(xml, {
    status: 200,
    headers: {
      'content-type': 'application/rss+xml; charset=utf-8',
      'cache-control': 'public, s-maxage=300, stale-while-revalidate=600',
    },
  });
}
