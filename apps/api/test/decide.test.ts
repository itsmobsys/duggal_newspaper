import { describe, expect, it } from 'vitest';
import { defaultSettings } from '../src/settings.js';
import { decideOutcome, type HeuristicSignals } from '../src/services/ai/decide.js';
import type { AiResult } from '../src/services/ai/schema.js';

function aiResult(overrides: Partial<AiResult> = {}): AiResult {
  return {
    headline: 'Server Owner Declares A New Era For Everyone',
    dek: 'A short summary of the events.',
    body: 'The server owner said many words in the general channel and everyone pretended to listen.',
    category: 'server-news',
    tags: ['server'],
    breaking: false,
    breaking_reason: '',
    image_captions: [],
    review: { needed: false, reasons: [], severity: 'none' },
    safety: { spam_score: 0.02, duplicate_confidence: 0, misleading_risk: 0.02, notes: '' },
    summary: 'Short summary.',
    ...overrides,
  };
}

function heuristics(overrides: Partial<HeuristicSignals> = {}): HeuristicSignals {
  return {
    spamScore: 0.05,
    misleadingRisk: 0.05,
    reviewReasons: [],
    blockedDomain: false,
    duplicateOf: null,
    duplicateScore: 0,
    linkCount: 0,
    ...overrides,
  };
}

const baseInput = {
  settings: defaultSettings(),
  heuristics: heuristics(),
  publishedLastHour: 0,
  breakingLastSixHours: 0,
  aiConfigured: true,
};

describe('decideOutcome', () => {
  it('publishes a routine, low-risk story', () => {
    const decision = decideOutcome({ ...baseInput, ai: aiResult() });
    expect(decision.action).toBe('publish');
    expect(decision.breaking).toBe(false);
  });

  it('never publishes when the AI is not configured', () => {
    const decision = decideOutcome({ ...baseInput, ai: aiResult(), aiConfigured: false });
    expect(decision.action).toBe('hold');
  });

  it('holds high-risk stories for a human editor', () => {
    const decision = decideOutcome({
      ...baseInput,
      ai: aiResult({
        review: { needed: true, reasons: ['Unsupported allegation'], severity: 'high' },
      }),
    });
    expect(decision.action).toBe('hold');
    expect(decision.reasons.join(' ')).toMatch(/high-risk/i);
  });

  it('rejects obvious spam', () => {
    const decision = decideOutcome({
      ...baseInput,
      ai: aiResult({
        safety: { spam_score: 0.99, duplicate_confidence: 0, misleading_risk: 0.1, notes: '' },
      }),
      heuristics: heuristics({ spamScore: 0.97, linkCount: 4 }),
    });
    expect(decision.action).toBe('reject');
  });

  it('holds a likely duplicate of an earlier submission', () => {
    const decision = decideOutcome({
      ...baseInput,
      ai: aiResult(),
      heuristics: heuristics({ duplicateOf: 'sub_earlier', duplicateScore: 0.95 }),
    });
    expect(decision.action).toBe('hold');
    expect(decision.reasons.join(' ')).toMatch(/duplicate/i);
  });

  it('holds when heuristics flag a review reason', () => {
    const decision = decideOutcome({
      ...baseInput,
      ai: aiResult(),
      heuristics: heuristics({ reviewReasons: ['Contains personal contact details'] }),
    });
    expect(decision.action).toBe('hold');
  });

  it('defers instead of publishing past the hourly throttle', () => {
    const settings = defaultSettings();
    const decision = decideOutcome({
      ...baseInput,
      ai: aiResult(),
      settings,
      publishedLastHour: settings['autonomy.max_publishes_per_hour'],
    });
    expect(decision.action).toBe('defer');
    expect(decision.deferredSeconds).toBeGreaterThan(0);
  });

  it('holds when auto-publishing is switched off', () => {
    const settings = defaultSettings();
    settings['content.auto_publish'] = false;
    const decision = decideOutcome({ ...baseInput, ai: aiResult(), settings });
    expect(decision.action).toBe('hold');
  });

  it('only allows breaking when the AI and the publisher agree', () => {
    const allowed = decideOutcome({
      ...baseInput,
      ai: aiResult({ breaking: true, breaking_reason: 'Outage right now' }),
    });
    expect(allowed.breaking).toBe(true);

    const settings = defaultSettings();
    settings['content.breaking_enabled'] = false;
    const blocked = decideOutcome({
      ...baseInput,
      ai: aiResult({ breaking: true, breaking_reason: 'Outage right now' }),
      settings,
    });
    expect(blocked.breaking).toBe(false);
  });
});
