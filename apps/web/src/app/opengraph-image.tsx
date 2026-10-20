import { ImageResponse } from 'next/og';
import { SITE_NAME_FALLBACK, SITE_TAGLINE_FALLBACK } from '@/lib/constants';
import { getPublicSettings } from '@/lib/settings';

/**
 * Default social card for the whole paper: newsprint cream, a heavy black
 * masthead rule, the wordmark, the tagline and a red newsroom strip.
 *
 * Everything is inline style because ImageResponse renders through Satori and
 * never loads the site stylesheet. No custom fonts are fetched: Georgia /
 * sans-serif resolve to whatever the renderer already has.
 */

export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';
export const alt = 'Duggal Badmosh Daily Newspaper — front page';
export const revalidate = 3600;

const PAPER = '#f7f2e7';
const INK = '#17130e';
const INK_SOFT = '#3d352b';
const RULE_SOFT = '#cabda5';
const ACCENT = '#c81e1e';
const ACCENT_INK = '#fff8f3';

/** Control characters are stripped before Satori ever sees the string. */
// eslint-disable-next-line no-control-regex -- stripping control characters is the entire point
const CONTROL_CHARS = /[\u0000-\u001F\u007F-\u009F]/g;

/** Collapse whitespace, strip controls and truncate on a code-point boundary. */
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

/** Today's dateline in the newsroom timezone, falling back to Asia/Kolkata. */
function dateline(timeZone: string): string {
  const zones =
    timeZone && timeZone !== 'Asia/Kolkata' ? [timeZone, 'Asia/Kolkata'] : ['Asia/Kolkata'];
  for (const zone of zones) {
    try {
      return new Intl.DateTimeFormat('en-GB', {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        year: 'numeric',
        timeZone: zone,
      }).format(new Date());
    } catch {
      // Bad timezone from settings — try the next one.
    }
  }
  return new Intl.DateTimeFormat('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'Asia/Kolkata',
  }).format(new Date());
}

export default async function OpengraphImage(): Promise<ImageResponse> {
  let name = SITE_NAME_FALLBACK;
  let tagline = SITE_TAGLINE_FALLBACK;
  let timeZone = 'Asia/Kolkata';

  try {
    const settings = await getPublicSettings();
    name = settings.site.name.trim() || SITE_NAME_FALLBACK;
    tagline = settings.site.tagline.trim() || SITE_TAGLINE_FALLBACK;
    timeZone = settings.site.timezone || 'Asia/Kolkata';
  } catch {
    // The database is optional for a brand card.
  }

  const date = dateline(timeZone);
  // A punning administrator can type a paragraph into the site name; the card
  // must still be readable rather than letting Satori clip it mid-glyph.
  const displayName = clampText(name, 72);
  const displayTagline = clampText(tagline, 120);
  const nameSize = displayName.length > 34 ? 66 : displayName.length > 26 ? 76 : 88;

  return new ImageResponse(
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        backgroundColor: PAPER,
        color: INK,
        padding: '52px 64px 56px',
        fontFamily: 'Georgia, serif',
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          fontFamily: 'sans-serif',
          fontSize: 22,
          letterSpacing: 3,
          textTransform: 'uppercase',
          color: INK_SOFT,
        }}
      >
        <span>Daily edition</span>
        <span>{date}</span>
      </div>

      <div style={{ display: 'flex', height: 10, backgroundColor: INK, marginTop: 18 }} />

      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          flexGrow: 1,
          flexShrink: 1,
          paddingTop: 18,
        }}
      >
        <div
          style={{
            display: 'flex',
            fontSize: nameSize,
            lineHeight: 1.02,
            fontWeight: 700,
            letterSpacing: -2,
          }}
        >
          {displayName}
        </div>
        <div
          style={{
            display: 'flex',
            marginTop: 24,
            fontSize: 34,
            fontStyle: 'italic',
            color: INK_SOFT,
          }}
        >
          {displayTagline}
        </div>
      </div>

      <div style={{ display: 'flex', height: 2, backgroundColor: RULE_SOFT, marginBottom: 22 }} />

      <div
        style={{
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          backgroundColor: ACCENT,
          color: ACCENT_INK,
          padding: '18px 22px',
          fontFamily: 'sans-serif',
          fontSize: 24,
          letterSpacing: 2,
          textTransform: 'uppercase',
        }}
      >
        <span>AI newsroom / reader submissions</span>
      </div>
    </div>,
    { ...size },
  );
}
