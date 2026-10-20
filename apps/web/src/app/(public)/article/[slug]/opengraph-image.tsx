import { ImageResponse } from 'next/og';
import { SITE_NAME_FALLBACK } from '@/lib/constants';
import { formatDate } from '@/lib/format';
import { getArticle } from '@/lib/queries';
import { getPublicSettings } from '@/lib/settings';

/**
 * Per-story social card. The article's own photo is never fetched: remote
 * images would be slow, occasionally CSP-hostile and expensive, so the
 * category accent carries the colour instead.
 */

export const revalidate = 3600;
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';
export const alt = 'Duggal Badmosh Daily Newspaper story card';

const PAPER = '#f7f2e7';
const INK = '#17130e';
const INK_SOFT = '#3d352b';
const RULE_SOFT = '#cabda5';
const ACCENT_FALLBACK = '#c81e1e';
const ACCENT_INK = '#fff8f3';

/** Keep only real hex colours from the database; anything else is ignored. */
function accentFor(value: string | null | undefined): string {
  const candidate = value?.trim() ?? '';
  if (/^#[0-9a-f]{6}$/i.test(candidate) || /^#[0-9a-f]{3}$/i.test(candidate)) return candidate;
  return ACCENT_FALLBACK;
}

/** Control characters are stripped before Satori ever sees the string. */
// eslint-disable-next-line no-control-regex -- stripping control characters is the entire point
const CONTROL_CHARS = /[\u0000-\u001F\u007F-\u009F]/g;

/** Collapse whitespace, strip control characters, trim on a code-point boundary. */
function clampText(value: string | null | undefined, max: number): string {
  const text = (value ?? '').replace(CONTROL_CHARS, ' ').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  const chars = Array.from(text);
  if (chars.length <= max) return text;
  return `${chars
    .slice(0, max - 1)
    .join('')
    .trimEnd()}…`;
}

function safeDate(value: string | null | undefined, timeZone: string): string {
  if (!value) return '';
  try {
    return formatDate(value, timeZone || 'Asia/Kolkata');
  } catch {
    try {
      return formatDate(value);
    } catch {
      return '';
    }
  }
}

function mastheadFor(timeZone: string): string {
  const zones =
    timeZone && timeZone !== 'Asia/Kolkata' ? [timeZone, 'Asia/Kolkata'] : ['Asia/Kolkata'];
  for (const zone of zones) {
    try {
      return new Intl.DateTimeFormat('en-GB', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        timeZone: zone,
      }).format(new Date());
    } catch {
      // Try the next zone.
    }
  }
  return '';
}

export default async function ArticleOpengraphImage({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<ImageResponse> {
  const { slug } = await params;

  let siteName = SITE_NAME_FALLBACK;
  let timeZone = 'Asia/Kolkata';
  let article: Awaited<ReturnType<typeof getArticle>> = null;

  try {
    const settings = await getPublicSettings();
    siteName = settings.site.name.trim() || SITE_NAME_FALLBACK;
    timeZone = settings.site.timezone || 'Asia/Kolkata';
  } catch {
    // Brand fallbacks are enough.
  }

  try {
    article = await getArticle(slug);
  } catch {
    article = null;
  }

  const accent = accentFor(article?.categoryAccent);
  const kicker = clampText(article?.categoryName, 40) || 'The paper';
  const headline = clampText(article?.headline, 120) || 'This story has left the newsroom.';
  const author = clampText(article?.authorDisplay, 60);
  // `||` rather than `??`: an empty publishedAt string should still fall back
  // to the edition dateline instead of rendering no date at all.
  const date = safeDate(article?.publishedAt || article?.editionDate, timeZone);
  const today = mastheadFor(timeZone);
  const headlineChars = Array.from(headline).length;
  const headlineSize = headlineChars <= 58 ? 66 : headlineChars <= 96 ? 56 : 48;

  return new ImageResponse(
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        backgroundColor: PAPER,
        color: INK,
        padding: '52px 64px 52px',
        fontFamily: 'Georgia, serif',
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          fontFamily: 'sans-serif',
          fontSize: 21,
          letterSpacing: 2,
          textTransform: 'uppercase',
          color: INK_SOFT,
        }}
      >
        <span>{clampText(siteName, 44)}</span>
        <span>{today}</span>
      </div>

      <div style={{ display: 'flex', height: 8, backgroundColor: INK, marginTop: 16 }} />

      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'flex-start',
          flexGrow: 1,
          flexShrink: 1,
          paddingTop: 30,
        }}
      >
        <div
          style={{
            display: 'flex',
            backgroundColor: accent,
            color: ACCENT_INK,
            padding: '10px 18px',
            fontFamily: 'sans-serif',
            fontSize: 22,
            fontWeight: 700,
            letterSpacing: 3,
            textTransform: 'uppercase',
          }}
        >
          <span>{kicker}</span>
        </div>

        <div
          style={{
            display: 'flex',
            marginTop: 26,
            fontSize: headlineSize,
            lineHeight: 1.08,
            fontWeight: 700,
            letterSpacing: -1,
          }}
        >
          {headline}
        </div>
      </div>

      <div style={{ display: 'flex', height: 2, backgroundColor: RULE_SOFT, marginBottom: 18 }} />

      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          fontFamily: 'sans-serif',
          fontSize: 22,
          color: INK_SOFT,
          marginBottom: 16,
        }}
      >
        <span>{author ? `By ${author}` : 'From the newsroom'}</span>
        <span>{date}</span>
      </div>

      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          backgroundColor: INK,
          color: PAPER,
          padding: '18px 22px',
          fontFamily: 'sans-serif',
          fontSize: 20,
          letterSpacing: 2,
          textTransform: 'uppercase',
        }}
      >
        <span>{clampText(siteName, 44)}</span>
        <span>AI newsroom / reader submissions</span>
      </div>
    </div>,
    { ...size },
  );
}
