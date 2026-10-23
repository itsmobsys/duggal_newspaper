import { describe, expect, it } from 'vitest';
import {
  buildSubmissionSystemPrompt,
  buildSubmissionUserPrompt,
  isOwnerIdentity,
} from '../src/services/ai/prompt.js';

/**
 * Boink owns the site, so his submissions are reported straight instead of
 * being turned into a roast. These tests pin the detection and the override.
 */

const CATEGORIES = [{ slug: 'general', name: 'General', description: 'Anything' }];

function systemPrompt(options: { owner?: boolean; anonymous?: boolean } = {}): string {
  return buildSubmissionSystemPrompt({
    categories: CATEGORIES,
    voiceNotes: '',
    minParagraphs: 3,
    maxParagraphs: 5,
    anonymous: options.anonymous ?? false,
    owner: options.owner,
  });
}

function userPrompt(authorName: string, discordHandle: string | null): string {
  return buildSubmissionUserPrompt({
    submission: {
      headline: 'Something happened',
      story: 'A thing happened and people had opinions about it.',
      authorName,
      identityMode: 'discord',
      discordHandle,
      categorySlug: null,
      sourceUrl: null,
      submittedAt: '2026-10-23T00:00:00.000Z',
      timezone: 'Asia/Kolkata',
      serverName: null,
    },
    categories: CATEGORIES,
    serverName: null,
  });
}

describe('isOwnerIdentity', () => {
  it('recognises Boink by name or handle, in any casing or punctuation', () => {
    for (const value of ['boink', 'Boink', 'BOINK', 'Boink_2068', 'boink_2068', 'Boink 2068']) {
      expect(isOwnerIdentity(value), value).toBe(true);
    }
  });

  it('ignores everyone else and empty values', () => {
    for (const value of ['boinkfan', 'notboink', 'someone', '', null, undefined]) {
      expect(isOwnerIdentity(value), String(value)).toBe(false);
    }
  });
});

describe('buildSubmissionSystemPrompt owner rule', () => {
  it('adds the straight-news override for the owner', () => {
    const prompt = systemPrompt({ owner: true });
    expect(prompt).toContain('OWNER SUBMISSION');
    expect(prompt).toContain('This section overrides "THE MOST IMPORTANT RULE"');
    expect(prompt).toContain('If he means business');
  });

  it('leaves everyone else on the comedy brief', () => {
    const prompt = systemPrompt({ owner: false });
    expect(prompt).not.toContain('OWNER SUBMISSION');
    expect(prompt).toContain('THE MOST IMPORTANT RULE: ACTUALLY BE FUNNY');
  });

  it('never claims ownership on an anonymous submission', () => {
    const prompt = systemPrompt({ owner: true, anonymous: true });
    expect(prompt).not.toContain('OWNER SUBMISSION');
  });
});

describe('buildSubmissionUserPrompt owner instruction', () => {
  it('asks for straight news when Boink files', () => {
    const prompt = userPrompt('Boink', 'boink_2068');
    expect(prompt).toContain("Rewrite this as the owner's own news piece.");
    expect(prompt).not.toContain('genuinely funny front-page story');
    expect(prompt).toContain('This submitter owns the website.');
  });

  it('keeps the comedy brief for a normal submitter', () => {
    const prompt = userPrompt('Some Member', 'member_1234');
    expect(prompt).toContain('genuinely funny front-page story');
    expect(prompt).not.toContain('This submitter owns the website.');
  });
});
