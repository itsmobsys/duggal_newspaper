import type { Db } from '../db/client.js';
import {
  containsAnyTerm,
  countMatches,
  extractUrls,
  hostnameOf,
  isLikelySpamText,
  isSafeExternalUrl,
  normalizeForHash,
  similarity,
} from '../lib/text.js';
import type { Settings } from '../settings.js';
import type { HeuristicSignals } from './ai/decide.js';
import { contentHash } from '../lib/text.js';

const ALLEGATION_TERMS = [
  'scam',
  'fraud',
  'stole',
  'stealing',
  'theft',
  'hacked',
  'hacker',
  'blackmail',
  'extortion',
  'abuse',
  'abused',
  'assault',
  'harass',
  'harassed',
  'rape',
  'molest',
  'murder',
  'killed',
  'threat',
  'threatened',
  'police case',
  'fir',
  'arrested',
  'lawsuit',
  'defame',
  'leaked',
  'leak',
  'cheated',
  'cheating',
  'affair',
  'pregnant',
  'std',
  'hiv',
  'cancer',
  'diagnosis',
  'suicide',
  'self harm',
  'kill myself',
  'bomb',
  'shoot',
  'weapon',
  'nude',
  'nudes',
  'sex',
  'minor',
  'underage',
];

const PRIVACY_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  {
    pattern: /\b(?:\+?91[-\s]?)?[6-9]\d{9}\b/g,
    reason: 'Contains what looks like a phone number.',
  },
  {
    pattern: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
    reason: 'Contains an email address.',
  },
  {
    pattern:
      /\b(?:\d{1,5}\s+[A-Za-z][A-Za-z.]+\s+(?:road|street|lane|marg|nagar|colony|sector|block|flat|house))\b/gi,
    reason: 'Contains what looks like a home address.',
  },
  {
    pattern: /\b(?:aadhaar|aadhar|pan card|passport number|upi id|account number)\b/gi,
    reason: 'Contains a government or financial identifier.',
  },
  {
    pattern: /\b(?:latitude|longitude|coordinates)\s*[:=]?\s*-?\d+(?:\.\d+)?/gi,
    reason: 'Contains location coordinates.',
  },
];

const DANGER_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  {
    pattern: /\b(?:kill (?:him|her|them|yourself)|shoot up|bomb threat|blow up|mass shooting)\b/gi,
    reason: 'Contains a threat of violence.',
  },
  {
    pattern:
      /\b(?:how to (?:make|build) (?:a )?(?:bomb|explosive|gun)|synthesize (?:meth|drugs))\b/gi,
    reason: 'Contains instructions for dangerous activity.',
  },
  {
    pattern: /\b(?:child porn|cp links?|underage nudes?)\b/gi,
    reason: 'Contains sexual content involving minors.',
  },
];

const SPAM_PATTERNS: Array<{ pattern: RegExp; weight: number; reason: string }> = [
  { pattern: /https?:\/\//gi, weight: 0.12, reason: 'Contains links.' },
  { pattern: /\b(?:dm|inbox|ping) me\b/gi, weight: 0.2, reason: 'Contains a DM solicitation.' },
  {
    pattern: /\b(?:telegram|whatsapp|instagram)\b/gi,
    weight: 0.15,
    reason: 'Pushes off-platform contact.',
  },
  {
    pattern: /\b(?:free|guaranteed)\s+(?:money|crypto|profit|returns?)\b/gi,
    weight: 0.5,
    reason: 'Promises money.',
  },
  {
    pattern: /\b(?:click here|buy now|limited offer|promo code)\b/gi,
    weight: 0.3,
    reason: 'Contains ad copy.',
  },
  { pattern: /(.)\1{9,}/g, weight: 0.2, reason: 'Contains repeated characters.' },
];

export interface HeuristicInput {
  headline: string;
  story: string;
  sourceUrl: string | null;
  settings: Settings;
}

export interface HeuristicReport extends HeuristicSignals {
  contentHash: string;
  urls: string[];
  dangerous: string[];
  privacy: string[];
  banned: string[];
  allCapsRatio: number;
  chars: number;
}

export function analyzeHeuristics(input: HeuristicInput): HeuristicReport {
  const fullText = `${input.headline}\n${input.story}`;
  const urls = extractUrls(input.story);
  const reasons: string[] = [];
  const dangerous: string[] = [];
  const privacy: string[] = [];
  const banned = containsAnyTerm(fullText, input.settings['content.banned_words']).concat(
    containsAnyTerm(fullText, input.settings['content.hold_keywords']),
  );

  let spamScore = 0;

  for (const rule of SPAM_PATTERNS) {
    const matches = countMatches(fullText, rule.pattern);
    if (matches > 0) spamScore += rule.weight * Math.min(3, matches);
  }
  if (isLikelySpamText(fullText)) spamScore += 0.45;
  if (urls.length > 3) spamScore += 0.2;
  if (banned.length > 0) spamScore += 0.35;

  const letters = fullText.replace(/[^A-Za-z]/g, '');
  const upper = fullText.replace(/[^A-Z]/g, '');
  const allCapsRatio = letters.length > 40 ? upper.length / letters.length : 0;
  if (allCapsRatio > 0.7 && fullText.length > 200) {
    spamScore += 0.15;
    reasons.push('Mostly ALL CAPS.');
  }

  const normalized = normalizeForHash(fullText);
  const hasAllegation = ALLEGATION_TERMS.some((term) => normalized.includes(term));

  for (const rule of PRIVACY_PATTERNS) {
    const hits = fullText.match(rule.pattern);
    if (hits && hits.length > 0) {
      privacy.push(rule.reason);
    }
  }
  for (const rule of DANGER_PATTERNS) {
    if (rule.pattern.test(fullText)) dangerous.push(rule.reason);
  }

  // Allegations alone are only a risk signal when they target someone specific
  // (a named entity, a handle, or a "he/she/they did X" construction).
  const hasTarget =
    /(?:@[a-z0-9_.]{2,32}|\b(?:he|she|they)\b|\b[a-z][a-z0-9_.]{2,}\s+(?:scammed|stole|abused|harassed|cheated|leaked))/i.test(
      fullText,
    );
  let misleadingRisk = 0;
  if (hasAllegation && hasTarget) {
    misleadingRisk = 0.75;
    reasons.push('Contains an allegation about an identifiable person.');
  } else if (
    /\b(?:breaking|confirmed|exclusive|sources say)\b/i.test(fullText) &&
    !input.sourceUrl
  ) {
    misleadingRisk = 0.45;
  }

  for (const reason of privacy) {
    reasons.push(reason);
    misleadingRisk = Math.max(misleadingRisk, 0.7);
  }
  for (const reason of dangerous) {
    reasons.push(reason);
    misleadingRisk = Math.max(misleadingRisk, 0.95);
  }
  if (banned.length > 0) {
    reasons.push(`Contains publisher-flagged phrase(s): ${banned.join(', ')}.`);
  }

  let blockedDomain = false;
  const host = input.sourceUrl ? hostnameOf(input.sourceUrl) : null;
  if (
    host &&
    input.settings['content.blocked_domains'].some(
      (domain) => host === domain || host.endsWith(`.${domain}`),
    )
  ) {
    blockedDomain = true;
  }
  if (input.sourceUrl && !isSafeExternalUrl(input.sourceUrl)) {
    blockedDomain = true;
    reasons.push('Source URL is not a safe public link.');
  }

  spamScore = Math.min(1, Number(spamScore.toFixed(3)));
  misleadingRisk = Math.min(1, Number(misleadingRisk.toFixed(3)));

  return {
    spamScore,
    misleadingRisk,
    reviewReasons: reasons,
    blockedDomain,
    duplicateOf: null,
    duplicateScore: 0,
    linkCount: urls.length,
    contentHash: contentHash(fullText),
    urls,
    dangerous,
    privacy,
    banned,
    allCapsRatio,
    chars: fullText.length,
  };
}

export interface DuplicateCheck {
  duplicateOf: string | null;
  duplicateScore: number;
}

/**
 * Compare against recent submissions (same content hash or trigram similarity).
 * Keeps the query bounded so the free tier stays cheap.
 */
export async function findDuplicate(
  db: Db,
  input: { headline: string; story: string; contentHash: string },
  threshold: number,
): Promise<DuplicateCheck> {
  const exact = await db.get<{ id: string }>(
    `SELECT id FROM submissions WHERE content_hash = ? ORDER BY created_at DESC LIMIT 1`,
    [input.contentHash],
  );
  if (exact) return { duplicateOf: exact.id, duplicateScore: 1 };

  const articleExact = await db.get<{ id: string; submission_id: string | null }>(
    `SELECT id, submission_id FROM articles WHERE original_body IS NOT NULL AND original_body = ? LIMIT 1`,
    [input.story.trim()],
  );
  if (articleExact) {
    return { duplicateOf: articleExact.submission_id, duplicateScore: 1 };
  }

  const recent = await db.all<{ id: string; headline: string; story: string }>(
    `SELECT id, headline, story FROM submissions ORDER BY created_at DESC LIMIT 120`,
  );

  let best: DuplicateCheck = { duplicateOf: null, duplicateScore: 0 };
  for (const row of recent) {
    const score = Math.max(
      similarity(input.story, row.story),
      similarity(input.headline, row.headline) * 0.85,
    );
    if (score > best.duplicateScore) {
      best = { duplicateOf: row.id, duplicateScore: Number(score.toFixed(3)) };
    }
  }
  if (best.duplicateScore < threshold) {
    return { duplicateOf: null, duplicateScore: best.duplicateScore };
  }
  return best;
}
