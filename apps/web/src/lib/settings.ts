import { SITE_DESCRIPTION_FALLBACK, SITE_NAME_FALLBACK, SITE_TAGLINE_FALLBACK } from './constants';
import { safeQuery } from './db';
import type { PublicSettings } from './types';

/**
 * The website renders from the settings table directly, so only the keys the
 * public site actually needs are mirrored here. Keep this list in sync with
 * `toPublicSettings` in the API (apps/api/src/settings.ts).
 */
export function defaultPublicSettings(): PublicSettings {
  return {
    site: {
      name: SITE_NAME_FALLBACK,
      tagline: SITE_TAGLINE_FALLBACK,
      description: SITE_DESCRIPTION_FALLBACK,
      url: 'http://localhost:3000',
      timezone: 'Asia/Kolkata',
      contactDiscord: '',
    },
    submissions: {
      anonymousAllowed: true,
      discordIdentityAllowed: true,
      requireSourceUrl: false,
      minStoryChars: 120,
      maxStoryChars: 12000,
      maxHeadlineChars: 160,
      maxImages: 4,
      maxImageMb: 8,
    },
    content: { breakingEnabled: true },
    appearance: { frontPageLimit: 24, showAwards: true, tickerCount: 6 },
  };
}

function parseValue(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

function asString(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback;
}

function asBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') return value;
  if (value === 'true' || value === 1 || value === '1') return true;
  if (value === 'false' || value === 0 || value === '0') return false;
  return fallback;
}

function asNumber(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.round(parsed)));
}

/** Load the public settings projection, merged over the defaults. */
export async function getPublicSettings(): Promise<PublicSettings> {
  const values = defaultPublicSettings();
  const rows = await safeQuery<{ key: string; value: string }>('SELECT key, value FROM settings');

  for (const row of rows) {
    const value = parseValue(row.value);
    switch (row.key) {
      case 'site.name':
        values.site.name = asString(value, values.site.name);
        break;
      case 'site.tagline':
        values.site.tagline = asString(value, values.site.tagline);
        break;
      case 'site.description':
        values.site.description = asString(value, values.site.description);
        break;
      case 'site.url':
        values.site.url = asString(value, values.site.url);
        break;
      case 'site.timezone':
        values.site.timezone = asString(value, values.site.timezone);
        break;
      case 'site.contact_discord':
        values.site.contactDiscord = asString(value, values.site.contactDiscord);
        break;
      case 'submissions.anonymous_allowed':
        values.submissions.anonymousAllowed = asBoolean(value, values.submissions.anonymousAllowed);
        break;
      case 'submissions.discord_identity_allowed':
        values.submissions.discordIdentityAllowed = asBoolean(
          value,
          values.submissions.discordIdentityAllowed,
        );
        break;
      case 'submissions.require_source_url':
        values.submissions.requireSourceUrl = asBoolean(value, values.submissions.requireSourceUrl);
        break;
      case 'submissions.min_story_chars':
        values.submissions.minStoryChars = asNumber(
          value,
          values.submissions.minStoryChars,
          40,
          5000,
        );
        break;
      case 'submissions.max_story_chars':
        values.submissions.maxStoryChars = asNumber(
          value,
          values.submissions.maxStoryChars,
          500,
          50000,
        );
        break;
      case 'submissions.max_headline_chars':
        values.submissions.maxHeadlineChars = asNumber(
          value,
          values.submissions.maxHeadlineChars,
          40,
          300,
        );
        break;
      case 'submissions.max_images':
        values.submissions.maxImages = asNumber(value, values.submissions.maxImages, 1, 8);
        break;
      case 'submissions.max_image_mb':
        values.submissions.maxImageMb = asNumber(value, values.submissions.maxImageMb, 1, 25);
        break;
      case 'content.breaking_enabled':
        values.content.breakingEnabled = asBoolean(value, values.content.breakingEnabled);
        break;
      case 'appearance.front_page_limit':
        values.appearance.frontPageLimit = asNumber(value, values.appearance.frontPageLimit, 6, 60);
        break;
      case 'appearance.show_awards':
        values.appearance.showAwards = asBoolean(value, values.appearance.showAwards);
        break;
      case 'appearance.ticker_count':
        values.appearance.tickerCount = asNumber(value, values.appearance.tickerCount, 0, 12);
        break;
      default:
        break;
    }
  }

  // Allow the canonical URL to be pinned by environment for preview builds.
  const envUrl = process.env.NEXT_PUBLIC_SITE_URL;
  if (envUrl) values.site.url = envUrl.replace(/\/$/, '');

  return values;
}

export function siteUrl(settings: PublicSettings): string {
  return (process.env.NEXT_PUBLIC_SITE_URL ?? settings.site.url).replace(/\/$/, '');
}
