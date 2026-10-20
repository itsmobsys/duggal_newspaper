import { createHash } from 'node:crypto';

export function stripControlChars(input: string): string {
  // eslint-disable-next-line no-control-regex -- control characters are exactly what must be stripped
  return input.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '');
}

/** Preserve meaning: normalise newlines/whitespace and strip control characters. */
export function sanitizeUserText(input: string): string {
  return stripControlChars(input.replace(/\r\n?/g, '\n'))
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Remove HTML-looking tags from AI output. We never render HTML, but this
 * keeps stray markup out of headlines and captions.
 */
export function stripHtmlLike(input: string): string {
  return sanitizeUserText(
    input.replace(/<\/?[a-zA-Z][^>]{0,300}>/g, ' ').replace(/<[^>]{0,300}>/g, ' '),
  );
}

export function normalizeWhitespace(input: string): string {
  return input.replace(/\s+/g, ' ').trim();
}

export function normalizeForHash(input: string): string {
  return (
    input
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      // eslint-disable-next-line no-misleading-character-class -- Devanagari range is intentional
      .replace(/[^a-z0-9\u0900-\u097f]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  );
}

export function contentHash(input: string): string {
  return createHash('sha256').update(normalizeForHash(input)).digest('hex');
}

function shingles(input: string, size = 3): Set<string> {
  const words = normalizeForHash(input).split(' ').filter(Boolean);
  const set = new Set<string>();
  if (words.length === 0) return set;
  if (words.length < size) {
    set.add(words.join(' '));
    return set;
  }
  for (let index = 0; index <= words.length - size; index += 1) {
    set.add(words.slice(index, index + size).join(' '));
  }
  return set;
}

/** Jaccard similarity over word trigrams. Returns 0..1. */
export function similarity(a: string, b: string): number {
  const setA = shingles(a);
  const setB = shingles(b);
  if (setA.size === 0 || setB.size === 0) return 0;
  let intersection = 0;
  for (const item of setA) {
    if (setB.has(item)) intersection += 1;
  }
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

export function slugify(input: string, maxLength = 72): string {
  const base = input
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, maxLength)
    .replace(/-+$/g, '');
  return base || 'article';
}

export function truncate(input: string, maxLength: number): string {
  if (input.length <= maxLength) return input;
  const sliced = input.slice(0, Math.max(0, maxLength - 1));
  const lastSpace = sliced.lastIndexOf(' ');
  return `${(lastSpace > maxLength * 0.6 ? sliced.slice(0, lastSpace) : sliced).trimEnd()}…`;
}

export function wordCount(input: string): number {
  return input.trim().split(/\s+/).filter(Boolean).length;
}

export function readingMinutes(input: string): number {
  return Math.max(1, Math.ceil(wordCount(input) / 200));
}

export function extractUrls(input: string): string[] {
  const matches = input.match(/https?:\/\/[^\s<>"')\]]+/gi) ?? [];
  return [...new Set(matches.map((url) => url.replace(/[.,;:!?]+$/, '')))];
}

const PRIVATE_HOST_PATTERNS = [
  /^localhost$/i,
  /^127\./,
  /^0\./,
  /^10\./,
  /^192\.168\./,
  /^169\.254\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^\[?::1\]?$/,
  /^\[?fc00:/i,
  /^\[?fe80:/i,
  /\.local$/i,
  /^metadata\./i,
];

export function isSafeExternalUrl(input: string): boolean {
  try {
    const url = new URL(input);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
    if (url.username || url.password) return false;
    if (input.length > 2048) return false;
    if (!url.hostname.includes('.')) return false;
    if (PRIVATE_HOST_PATTERNS.some((pattern) => pattern.test(url.hostname))) return false;
    return true;
  } catch {
    return false;
  }
}

export function hostnameOf(input: string): string | null {
  try {
    return new URL(input).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return null;
  }
}

export function countMatches(input: string, pattern: RegExp): number {
  const matches = input.match(pattern);
  return matches ? matches.length : 0;
}

export function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function containsAnyTerm(input: string, terms: string[]): string[] {
  const haystack = ` ${normalizeForHash(input)} `;
  const hits: string[] = [];
  for (const term of terms) {
    const needle = normalizeForHash(term);
    if (!needle) continue;
    if (haystack.includes(` ${needle} `) || haystack.includes(needle)) hits.push(term);
  }
  return hits;
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}

export function isLikelySpamText(input: string): boolean {
  const normalized = normalizeForHash(input);
  const patterns = [
    /free (money|crypto|bitcoin|gift|iphone)/,
    /(dm|inbox) me/,
    /telegram|whatsapp/,
    /click (here|link)/,
    /earn (money|rs|rupees|dollars)/,
    /guaranteed (return|profit|income)/,
    /casino|betting|satta|lottery/,
    /loan approved|pre.?approved loan/,
    /work from home/,
  ];
  return patterns.some((pattern) => pattern.test(normalized));
}
