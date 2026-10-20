import { ImageResponse } from 'next/og';
import { SITE_NAME_FALLBACK } from '@/lib/constants';
import { editionHeading, pluralise } from '@/lib/format';
import { getEdition } from '@/lib/queries';
import { getPublicSettings } from '@/lib/settings';

/**
 * Social card for a single dated edition: the day number huge on the left,
 * the edition headline and story count on the right. Missing editions still
 * get a card — opening a shared link must never produce a broken image.
 */

export const revalidate = 3600;
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';
export const alt = 'Duggal Badmosh Daily Newspaper edition card';

const PAPER = '#f7f2e7';
const INK = '#17130e';
const INK_SOFT = '#3d352b';
const INK_MUTE = '#6b6154';
const RULE_SOFT = '#cabda5';
const ACCENT = '#c81e1e';
const ACCENT_INK = '#fff8f3';

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Control characters are stripped before Satori ever sees the string. */
// eslint-disable-next-line no-control-regex -- stripping control characters is the entire point
const CONTROL_CHARS = /[\u0000-\u001F\u007F-\u009F]/g;

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

function monthName(dateIso: string): string {
  try {
    return new Intl.DateTimeFormat('en-GB', {
      month: 'long',
      timeZone: 'UTC',
    }).format(new Date(`${dateIso}T12:00:00Z`));
  } catch {
    return '';
  }
}

function headingFor(dateIso: string, timeZone: string): string {
  try {
    return editionHeading(dateIso, timeZone || 'Asia/Kolkata');
  } catch {
    try {
      return editionHeading(dateIso);
    } catch {
      return dateIso;
    }
  }
}

export default async function EditionOpengraphImage({
  params,
}: {
  params: Promise<{ date: string }>;
}): Promise<ImageResponse> {
  const { date } = await params;

  let siteName = SITE_NAME_FALLBACK;
  let timeZone = 'Asia/Kolkata';
  let edition: Awaited<ReturnType<typeof getEdition>> = null;

  try {
    const settings = await getPublicSettings();
    siteName = settings.site.name.trim() || SITE_NAME_FALLBACK;
    timeZone = settings.site.timezone || 'Asia/Kolkata';
  } catch {
    // Keep the fallback masthead.
  }

  try {
    edition = await getEdition(date);
  } catch {
    edition = null;
  }

  const match = ISO_DATE.exec(date);
  const validDate = match !== null;
  const day = match?.[3] ?? '—';
  const month = validDate ? monthName(date) : '';
  const year = match?.[1] ?? '';
  const heading = validDate ? headingFor(date, timeZone) : 'The Duggal Badmosh archive';
  const kicker = edition ? 'Edition' : 'Back issues';
  const headline =
    clampText(edition?.headline, 96) || clampText(heading, 96) || 'The Duggal Badmosh archive';
  const count = edition ? pluralise(edition.articleCount, 'story', 'stories') : 'From the archive';
  const headlineChars = Array.from(headline).length;
  const headlineSize = headlineChars <= 56 ? 56 : headlineChars <= 80 ? 48 : 42;

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
        <span>{validDate ? heading : 'Edition archive'}</span>
      </div>

      <div style={{ display: 'flex', height: 8, backgroundColor: INK, marginTop: 16 }} />

      <div
        style={{
          display: 'flex',
          flexDirection: 'row',
          alignItems: 'center',
          flexGrow: 1,
          flexShrink: 1,
          paddingTop: 26,
        }}
      >
        {validDate ? (
          <>
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                width: 330,
                flexShrink: 0,
              }}
            >
              <div
                style={{
                  display: 'flex',
                  fontSize: 168,
                  lineHeight: 0.92,
                  fontWeight: 700,
                  letterSpacing: -6,
                }}
              >
                {day}
              </div>
              <div
                style={{
                  display: 'flex',
                  marginTop: 14,
                  fontFamily: 'sans-serif',
                  fontSize: 30,
                  fontWeight: 700,
                  letterSpacing: 3,
                  textTransform: 'uppercase',
                  color: ACCENT,
                }}
              >
                {month}
              </div>
              <div
                style={{
                  display: 'flex',
                  marginTop: 4,
                  fontFamily: 'sans-serif',
                  fontSize: 28,
                  letterSpacing: 4,
                  color: INK_MUTE,
                }}
              >
                {year}
              </div>
            </div>

            <div
              style={{
                display: 'flex',
                width: 2,
                alignSelf: 'stretch',
                backgroundColor: RULE_SOFT,
                margin: '0 40px',
              }}
            />
          </>
        ) : null}

        <div style={{ display: 'flex', flexDirection: 'column', flexGrow: 1, flexShrink: 1 }}>
          <div
            style={{
              display: 'flex',
              backgroundColor: ACCENT,
              color: ACCENT_INK,
              padding: '8px 16px',
              fontFamily: 'sans-serif',
              fontSize: 20,
              fontWeight: 700,
              letterSpacing: 3,
              textTransform: 'uppercase',
              alignSelf: 'flex-start',
            }}
          >
            <span>{kicker}</span>
          </div>

          <div
            style={{
              display: 'flex',
              marginTop: 22,
              fontSize: headlineSize,
              lineHeight: 1.1,
              fontWeight: 700,
              letterSpacing: -1,
            }}
          >
            {headline}
          </div>

          <div
            style={{
              display: 'flex',
              marginTop: 24,
              fontFamily: 'sans-serif',
              fontSize: 24,
              letterSpacing: 2,
              textTransform: 'uppercase',
              color: INK_SOFT,
            }}
          >
            {count}
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', height: 2, backgroundColor: RULE_SOFT, marginBottom: 16 }} />

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
