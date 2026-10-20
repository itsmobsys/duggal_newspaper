import type { Db } from './db/client.js';
import { AppError } from './lib/errors.js';

export type SettingType = 'string' | 'number' | 'boolean' | 'stringlist';

export interface SettingDef {
  type: SettingType;
  default: string | number | boolean | string[];
  label: string;
  description: string;
  group:
    | 'Site'
    | 'Submissions'
    | 'Content'
    | 'Autonomy'
    | 'Moderation'
    | 'AI'
    | 'Appearance'
    | 'Community'
    | 'Storage';
  public?: boolean;
  min?: number;
  max?: number;
  multiline?: boolean;
}

export interface SettingsValues {
  'site.name': string;
  'site.tagline': string;
  'site.description': string;
  'site.url': string;
  'site.contact_discord': string;
  'site.timezone': string;

  'submissions.anonymous_allowed': boolean;
  'submissions.require_source_url': boolean;
  'submissions.min_story_chars': number;
  'submissions.max_story_chars': number;
  'submissions.max_headline_chars': number;
  'submissions.max_images': number;
  'submissions.max_image_mb': number;

  'content.breaking_enabled': boolean;
  'content.auto_publish': boolean;
  'content.banned_words': string[];
  'content.blocked_domains': string[];
  'content.hold_keywords': string[];

  'autonomy.enabled': boolean;
  'autonomy.daily_edition': boolean;
  'autonomy.edition_hour': number;
  'autonomy.awards_enabled': boolean;
  'autonomy.awards_weekday': number;
  'autonomy.recover_failed_daily': boolean;
  'autonomy.max_publishes_per_hour': number;

  'moderation.spam_threshold': number;

  'ai.voice_notes': string;
  'ai.body_paragraphs_min': number;
  'ai.body_paragraphs_max': number;

  'appearance.front_page_limit': number;
  'appearance.show_awards': boolean;
  'appearance.ticker_count': number;

  'community.voting_enabled': boolean;
  'community.reviews_enabled': boolean;
  'community.review_max_chars': number;

  'storage.soft_limit_mb': number;
  'storage.monthly_advanced_op_limit': number;
  'storage.preserve_originals': boolean;
  'storage.original_retention_days': number;
  'storage.block_uploads_when_full': boolean;
}

export const SETTING_DEFS: { [K in keyof SettingsValues]: SettingDef } = {
  'site.name': {
    type: 'string',
    default: 'Duggal Badmosh Daily Newspaper',
    label: 'Newspaper name',
    description: 'Masthead text.',
    group: 'Site',
    public: true,
  },
  'site.tagline': {
    type: 'string',
    default: 'Khabrein kam, kand zyada.',
    label: 'Tagline',
    description: 'Sits under the masthead.',
    group: 'Site',
    public: true,
  },
  'site.description': {
    type: 'string',
    default:
      'The internet’s least responsible newspaper. Written by an AI, fed by the Discord, trusted by absolutely nobody.',
    label: 'Meta description',
    description: 'Used for SEO and social previews.',
    group: 'Site',
    public: true,
    multiline: true,
  },
  'site.url': {
    type: 'string',
    default: 'http://localhost:3000',
    label: 'Public site URL',
    description: 'Canonical URL, no trailing slash. Used in sitemap and Open Graph tags.',
    group: 'Site',
    public: true,
  },
  'site.contact_discord': {
    type: 'string',
    default: '',
    label: 'Discord invite or contact',
    description: 'Optional link shown in the footer and on the standards page.',
    group: 'Site',
    public: true,
  },
  'site.timezone': {
    type: 'string',
    default: 'Asia/Kolkata',
    label: 'Newsroom timezone',
    description: 'IANA timezone used for editions and display dates.',
    group: 'Site',
    public: true,
  },

  'submissions.anonymous_allowed': {
    type: 'boolean',
    default: true,
    label: 'Allow anonymous submissions',
    description: 'When off, the anonymous option is hidden and rejected server-side.',
    group: 'Submissions',
    public: true,
  },
  'submissions.require_source_url': {
    type: 'boolean',
    default: false,
    label: 'Require a source URL',
    description: 'Rejects submissions without a source link.',
    group: 'Submissions',
  },
  'submissions.min_story_chars': {
    type: 'number',
    default: 120,
    label: 'Minimum story length',
    description: 'Characters. Blocks low-effort spam.',
    group: 'Submissions',
    min: 40,
    max: 5000,
    public: true,
  },
  'submissions.max_story_chars': {
    type: 'number',
    default: 12000,
    label: 'Maximum story length',
    description: 'Characters.',
    group: 'Submissions',
    min: 500,
    max: 50000,
    public: true,
  },
  'submissions.max_headline_chars': {
    type: 'number',
    default: 160,
    label: 'Maximum headline length',
    description: 'Characters.',
    group: 'Submissions',
    min: 40,
    max: 300,
    public: true,
  },
  'submissions.max_images': {
    type: 'number',
    default: 4,
    label: 'Maximum photos per submission',
    description: 'Also capped by the server MAX_IMAGES_PER_SUBMISSION env var.',
    group: 'Submissions',
    min: 1,
    max: 8,
    public: true,
  },
  'submissions.max_image_mb': {
    type: 'number',
    default: 8,
    label: 'Maximum photo size (MB)',
    description: 'Also capped by MAX_UPLOAD_BYTES.',
    group: 'Submissions',
    min: 1,
    max: 25,
    public: true,
  },

  'content.breaking_enabled': {
    type: 'boolean',
    default: true,
    label: 'Allow BREAKING labels',
    description: 'The AI may mark genuinely urgent stories as breaking.',
    group: 'Content',
    public: true,
  },
  'content.auto_publish': {
    type: 'boolean',
    default: true,
    label: 'Auto-publish routine stories',
    description:
      'The core autonomy switch. When off, AI-processed stories wait in the review queue instead of going live.',
    group: 'Content',
  },
  'content.banned_words': {
    type: 'stringlist',
    default: [],
    label: 'Banned phrases',
    description: 'Submissions containing these are held for review. One per line.',
    group: 'Content',
    multiline: true,
  },
  'content.blocked_domains': {
    type: 'stringlist',
    default: [],
    label: 'Blocked source domains',
    description: 'Source URLs from these hosts are rejected (e.g. known scam domains).',
    group: 'Content',
    multiline: true,
  },
  'content.hold_keywords': {
    type: 'stringlist',
    default: [],
    label: 'Extra hold keywords',
    description: 'Additional phrases that force human review (allegations, privacy, safety).',
    group: 'Content',
    multiline: true,
  },

  'autonomy.enabled': {
    type: 'boolean',
    default: true,
    label: 'Autonomous newsroom',
    description:
      'AI curates the front page, writes editions and hands out awards with no human input.',
    group: 'Autonomy',
  },
  'autonomy.daily_edition': {
    type: 'boolean',
    default: true,
    label: 'Generate a daily edition',
    description:
      'The AI editor assembles the next edition at the edition hour so it is live at midnight.',
    group: 'Autonomy',
  },
  'autonomy.edition_hour': {
    type: 'number',
    default: 23,
    label: 'Edition build hour (newsroom time)',
    description:
      '0-23. When the AI starts assembling the edition that goes live at the next midnight. 23 = 11 PM IST, ready by 12 AM.',
    group: 'Autonomy',
    min: 0,
    max: 23,
  },
  'autonomy.awards_enabled': {
    type: 'boolean',
    default: true,
    label: 'Automatic community awards',
    description: 'Weekly awards such as Most Unhinged Member and Biggest Yapper.',
    group: 'Autonomy',
  },
  'autonomy.awards_weekday': {
    type: 'number',
    default: 1,
    label: 'Awards weekday',
    description: '0 = Sunday, 1 = Monday … 6 = Saturday.',
    group: 'Autonomy',
    min: 0,
    max: 6,
  },
  'autonomy.recover_failed_daily': {
    type: 'boolean',
    default: true,
    label: 'Retry failed AI jobs daily',
    description: 'Requeues submissions whose AI processing exhausted its attempts.',
    group: 'Autonomy',
  },
  'autonomy.max_publishes_per_hour': {
    type: 'number',
    default: 12,
    label: 'Publishing throttle (per hour)',
    description: 'Flood guard. Excess stories stay queued and publish as capacity frees up.',
    group: 'Autonomy',
    min: 1,
    max: 200,
  },

  'moderation.spam_threshold': {
    type: 'number',
    default: 0.8,
    label: 'Spam hold threshold',
    description: '0-1.',
    group: 'Moderation',
    min: 0.3,
    max: 1,
  },
  'ai.voice_notes': {
    type: 'string',
    default:
      'Lean into Discord-brain: 3AM thoughts, pings nobody asked for, "bhai scene kya hai", fake importance for trivial things. Never punch down at protected groups.',
    label: 'Extra voice notes for the AI editor',
    description: 'Appended to the system prompt. Keep it style-only: never factual instructions.',
    group: 'AI',
    multiline: true,
  },
  'ai.body_paragraphs_min': {
    type: 'number',
    default: 3,
    label: 'Minimum body paragraphs',
    description: '',
    group: 'AI',
    min: 1,
    max: 12,
  },
  'ai.body_paragraphs_max': {
    type: 'number',
    default: 7,
    label: 'Maximum body paragraphs',
    description: '',
    group: 'AI',
    min: 2,
    max: 20,
  },

  'appearance.front_page_limit': {
    type: 'number',
    default: 24,
    label: 'Front page story count',
    description: '',
    group: 'Appearance',
    public: true,
    min: 6,
    max: 60,
  },
  'appearance.show_awards': {
    type: 'boolean',
    default: true,
    label: 'Show awards on the front page',
    description: '',
    group: 'Appearance',
    public: true,
  },
  'appearance.ticker_count': {
    type: 'number',
    default: 6,
    label: 'Ticker headline count',
    description: '',
    group: 'Appearance',
    public: true,
    min: 0,
    max: 12,
  },

  'community.voting_enabled': {
    type: 'boolean',
    default: true,
    label: 'Enable likes and dislikes',
    description: 'Global switch for story votes. Existing counts are kept when turned off.',
    group: 'Community',
    public: true,
  },
  'community.reviews_enabled': {
    type: 'boolean',
    default: true,
    label: 'Enable reader reviews',
    description: 'Lets signed-in readers rate stories and leave a written review.',
    group: 'Community',
    public: true,
  },
  'community.review_max_chars': {
    type: 'number',
    default: 1200,
    label: 'Maximum review length',
    description: 'Characters. Shorter reviews are easier to moderate and read.',
    group: 'Community',
    public: true,
    min: 200,
    max: 3000,
  },

  // Vercel Blob Hobby is free but hard-capped (1 GB, 2,000 advanced operations
  // per month); going over locks the store for 30 days. These thresholds keep
  // the paper comfortably inside the allowance. Photos are refused past the
  // soft limit, but text-only submissions always keep working.
  'storage.soft_limit_mb': {
    type: 'number',
    default: 800,
    label: 'Photo storage soft limit (MB)',
    description:
      'Stop accepting photos past this size. Hobby allows 1,000 MB per month in total. Older originals can be pruned to free room.',
    group: 'Storage',
    min: 50,
    max: 1024,
  },
  'storage.monthly_advanced_op_limit': {
    type: 'number',
    default: 1600,
    label: 'Monthly upload quota (advanced operations)',
    description:
      'Each stored photo uses two or three operations. Hobby allows 2,000 per month, and exceeding it blocks Blob for 30 days.',
    group: 'Storage',
    min: 100,
    max: 2000,
  },
  'storage.preserve_originals': {
    type: 'boolean',
    default: true,
    label: 'Keep the original upload',
    description:
      'Store the untouched file beside the optimized WebP. Originals are never shown on the site; they exist for verification and takedowns.',
    group: 'Storage',
  },
  'storage.original_retention_days': {
    type: 'number',
    default: 90,
    label: 'Original retention (days)',
    description: 'Originals older than this are pruned on the hourly maintenance tick.',
    group: 'Storage',
    min: 7,
    max: 730,
  },
  'storage.block_uploads_when_full': {
    type: 'boolean',
    default: true,
    label: 'Refuse photos when the free quota is full',
    description:
      'Recommended. Story text is still accepted; only photos pause until the next month or a prune.',
    group: 'Storage',
  },
};

export type SettingKey = keyof SettingsValues;
export type Settings = SettingsValues;

const SETTING_KEYS = Object.keys(SETTING_DEFS) as SettingKey[];

export function defaultSettings(): SettingsValues {
  const values: Record<string, unknown> = {};
  for (const key of SETTING_KEYS) {
    values[key] = SETTING_DEFS[key].default;
  }
  return values as unknown as SettingsValues;
}

function coerce(key: SettingKey, input: unknown): string | number | boolean | string[] {
  const def = SETTING_DEFS[key];
  switch (def.type) {
    case 'boolean': {
      if (typeof input === 'boolean') return input;
      if (input === 'true' || input === 1 || input === '1') return true;
      if (input === 'false' || input === 0 || input === '0') return false;
      throw new AppError(400, 'INVALID_SETTING', `${key} must be true or false.`);
    }
    case 'number': {
      const value = typeof input === 'number' ? input : Number(input);
      if (!Number.isFinite(value)) {
        throw new AppError(400, 'INVALID_SETTING', `${key} must be a number.`);
      }
      if (def.min !== undefined && value < def.min) {
        throw new AppError(400, 'INVALID_SETTING', `${key} must be at least ${def.min}.`);
      }
      if (def.max !== undefined && value > def.max) {
        throw new AppError(400, 'INVALID_SETTING', `${key} must be at most ${def.max}.`);
      }
      return Math.round(value);
    }
    case 'stringlist': {
      if (Array.isArray(input)) {
        return [...new Set(input.map((item) => String(item).trim()).filter(Boolean))].slice(0, 200);
      }
      if (typeof input === 'string') {
        return [
          ...new Set(
            input
              .split('\n')
              .map((line) => line.trim())
              .filter(Boolean),
          ),
        ].slice(0, 200);
      }
      throw new AppError(400, 'INVALID_SETTING', `${key} must be a list of strings.`);
    }
    case 'string':
    default: {
      if (typeof input !== 'string') {
        throw new AppError(400, 'INVALID_SETTING', `${key} must be text.`);
      }
      return input.slice(0, 4000);
    }
  }
}

function decode(key: SettingKey, raw: string): unknown {
  const def = SETTING_DEFS[key];
  try {
    const parsed = JSON.parse(raw);
    return coerce(key, parsed);
  } catch {
    // Legacy / hand-edited values: fall back to the raw string for text settings.
    if (def.type === 'string') return raw;
    return def.default;
  }
}

let cache: { values: SettingsValues; loadedAt: number } | null = null;
const CACHE_TTL_MS = 10_000;

export function invalidateSettingsCache(): void {
  cache = null;
}

export async function loadSettings(db: Db): Promise<Settings> {
  if (cache && Date.now() - cache.loadedAt < CACHE_TTL_MS) return cache.values;
  const values = defaultSettings();
  const rows = await db.all<{ key: string; value: string }>('SELECT key, value FROM settings');
  for (const row of rows) {
    if ((SETTING_KEYS as string[]).includes(row.key)) {
      const key = row.key as SettingKey;
      (values as unknown as Record<string, unknown>)[key] = decode(key, row.value);
    }
  }
  cache = { values, loadedAt: Date.now() };
  return values;
}

export async function updateSettings(
  db: Db,
  patch: Record<string, unknown>,
  actor: string,
): Promise<Settings> {
  const entries = Object.entries(patch);
  if (entries.length === 0) throw new AppError(400, 'EMPTY_PATCH', 'No settings supplied.');
  for (const [key] of entries) {
    if (!(SETTING_KEYS as string[]).includes(key)) {
      throw new AppError(400, 'UNKNOWN_SETTING', `Unknown setting: ${key}`);
    }
  }
  const now = new Date().toISOString();
  await db.transaction(async (tx) => {
    for (const [key, input] of entries) {
      const typedKey = key as SettingKey;
      const value = coerce(typedKey, input);
      await tx.run(
        `INSERT INTO settings (key, value, updated_at, updated_by) VALUES (?, ?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at,
           updated_by = excluded.updated_by`,
        [typedKey, JSON.stringify(value), now, actor],
      );
    }
  });
  invalidateSettingsCache();
  return loadSettings(db);
}

export interface PublicSettings {
  site: {
    name: string;
    tagline: string;
    description: string;
    url: string;
    timezone: string;
    contactDiscord: string;
  };
  submissions: {
    anonymousAllowed: boolean;
    minStoryChars: number;
    maxStoryChars: number;
    maxHeadlineChars: number;
    maxImages: number;
    maxImageMb: number;
  };
  content: { breakingEnabled: boolean };
  appearance: { frontPageLimit: number; showAwards: boolean; tickerCount: number };
  community: { votingEnabled: boolean; reviewsEnabled: boolean; reviewMaxChars: number };
}

export function toPublicSettings(settings: Settings): PublicSettings {
  return {
    site: {
      name: settings['site.name'],
      tagline: settings['site.tagline'],
      description: settings['site.description'],
      url: settings['site.url'],
      timezone: settings['site.timezone'],
      contactDiscord: settings['site.contact_discord'],
    },
    submissions: {
      anonymousAllowed: settings['submissions.anonymous_allowed'],
      minStoryChars: settings['submissions.min_story_chars'],
      maxStoryChars: settings['submissions.max_story_chars'],
      maxHeadlineChars: settings['submissions.max_headline_chars'],
      maxImages: settings['submissions.max_images'],
      maxImageMb: settings['submissions.max_image_mb'],
    },
    content: { breakingEnabled: settings['content.breaking_enabled'] },
    appearance: {
      frontPageLimit: settings['appearance.front_page_limit'],
      showAwards: settings['appearance.show_awards'],
      tickerCount: settings['appearance.ticker_count'],
    },
    community: {
      votingEnabled: settings['community.voting_enabled'],
      reviewsEnabled: settings['community.reviews_enabled'],
      reviewMaxChars: settings['community.review_max_chars'],
    },
  };
}

export function settingDefinitions(): Array<SettingDef & { key: SettingKey }> {
  return SETTING_KEYS.map((key) => ({ key, ...SETTING_DEFS[key] }));
}
