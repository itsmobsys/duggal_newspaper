import { describe, expect, it } from 'vitest';
import {
  contentHash,
  hostnameOf,
  isLikelySpamText,
  isSafeExternalUrl,
  readingMinutes,
  slugify,
  similarity,
  stripHtmlLike,
} from '../src/lib/text.js';

describe('text helpers', () => {
  it('strips control characters while keeping newlines', () => {
    expect(stripHtmlLike('Hello\u0000 world\n\n<b>bold</b>')).toBe('Hello world\n\nbold');
  });

  it('slugifies headlines and strips unsafe characters', () => {
    expect(slugify('Server Owner Declares “New Era”!!')).toBe('server-owner-declares-new-era');
    expect(slugify('   ')).toBe('article');
    expect(slugify('a'.repeat(200)).length).toBeLessThanOrEqual(72);
  });

  it('produces a stable content hash regardless of case and punctuation', () => {
    expect(contentHash('Hello, World!')).toBe(contentHash('hello world'));
    expect(contentHash('one')).not.toBe(contentHash('two'));
  });

  it('scores near-duplicates highly and unrelated text lowly', () => {
    const original =
      'The server owner discovered the general channel and declared a new era for everyone.';
    const nearDuplicate =
      'The server owner discovered the general channel, then declared a new era for everyone.';
    const unrelated = 'A ranked match was lost and blamed on lag, matchmaking and the moon phase.';
    expect(similarity(original, nearDuplicate)).toBeGreaterThan(0.5);
    expect(similarity(original, unrelated)).toBeLessThan(0.3);
  });

  it('rejects local and non-http URLs', () => {
    expect(isSafeExternalUrl('https://example.com/story')).toBe(true);
    expect(isSafeExternalUrl('javascript:alert(1)')).toBe(false);
    expect(isSafeExternalUrl('http://localhost:3000/secret')).toBe(false);
    expect(isSafeExternalUrl('http://127.0.0.1/admin')).toBe(false);
    expect(isSafeExternalUrl('not a url')).toBe(false);
  });

  it('extracts a hostname safely', () => {
    expect(hostnameOf('https://news.example.com/a?b=1')).toBe('news.example.com');
    expect(hostnameOf('nonsense')).toBeNull();
  });

  it('flags obvious spammy text', () => {
    expect(isLikelySpamText('BUY NOW!!! free crypto giveaway click here click here')).toBe(true);
    expect(isLikelySpamText('We played a ranked match and lost because of lag.')).toBe(false);
  });

  it('estimates reading time with a floor of one minute', () => {
    expect(readingMinutes('short')).toBe(1);
    expect(readingMinutes('word '.repeat(600))).toBeGreaterThanOrEqual(3);
  });
});
