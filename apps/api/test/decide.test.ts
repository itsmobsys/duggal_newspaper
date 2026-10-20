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
    review: { needed: false, reasons: [] },
    summary: 'Short summary.',
    ...overrides,
  };
}

function heuristics(overrides: Partial<HeuristicSignals> = {}): HeuristicSignals {
  return {
    spamScore: 0.05,
    reviewReasons: [],
    blockedDomain: false,
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

  it('holds when the AI quotes a rule from the concrete hold list', () => {
    const decision = decideOutcome({
      ...baseInput,
      ai: aiResult({
        review: { needed: true, reasons: ['Contains a credible threat: "I will burn your car".'] },
      }),
    });
    expect(decision.action).toBe('hold');
    expect(decision.reasons[0]).toMatch(/credible threat/i);
  });

  it('publishes a held story once an editor overrides the flags', () => {
    const ai = aiResult({
      review: {
        needed: true,
        reasons: ['Contains explicit sexual content about a real person: "his dick got tight".'],
      },
    });
    const held = decideOutcome({ ...baseInput, ai });
    expect(held.action).toBe('hold');

    const overridden = decideOutcome({ ...baseInput, ai, editorOverride: true });
    expect(overridden.action).toBe('publish');
  });

  it('rejects obvious spam', () => {
    const decision = decideOutcome({
      ...baseInput,
      ai: aiResult(),
      heuristics: heuristics({ spamScore: 0.97, linkCount: 4 }),
    });
    expect(decision.action).toBe('reject');
  });

  it('publishes repeat submissions of the same story', () => {
    // Duplicate detection was removed on purpose: the same news may run as often as people send it.
    const decision = decideOutcome({
      ...baseInput,
      ai: aiResult(),
      heuristics: heuristics({ spamScore: 0.4 }),
    });
    expect(decision.action).toBe('publish');
  });

  it('holds when heuristics flag a concrete review reason', () => {
    const decision = decideOutcome({
      ...baseInput,
      ai: aiResult(),
      heuristics: heuristics({ reviewReasons: ['Contains personal contact details'] }),
    });
    expect(decision.action).toBe('hold');
    expect(decision.reasons[0]).toMatch(/personal contact details/i);
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

describe('editorial policy: ordinary chaos publishes', () => {
  const spiky = [
    'The admin is a clown and everyone knows it.',
    'Rumour has it the mods take bribes in Robux.',
    'This is an unverified claim about the owner\u2019s reputation.',
    'Sarcastic, profane roast of the whole staff: they are useless.',
  ];

  for (const story of spiky) {
    it(`publishes when the AI raises no concrete hold: ${story.slice(0, 32)}`, () => {
      const decision = decideOutcome({
        ...baseInput,
        ai: aiResult({ body: story }),
        heuristics: heuristics(),
      });
      expect(decision.action).toBe('publish');
      expect(decision.reasons).toEqual([]);
    });
  }

  it('does not gate on a misleading-risk score', () => {
    const decision = decideOutcome({
      ...baseInput,
      ai: aiResult(),
      heuristics: heuristics({ spamScore: 0.1, reviewReasons: [] }),
    });
    expect(decision.action).toBe('publish');
  });

  it('keeps every AI hold reason verbatim and specific', () => {
    const reasons = [
      'Contains private data: home address "12 Reaper Lane".',
      'Contains fraud instructions: "send your seed phrase here".',
    ];
    const decision = decideOutcome({
      ...baseInput,
      ai: aiResult({ review: { needed: true, reasons } }),
    });
    expect(decision.action).toBe('hold');
    expect(decision.reasons).toEqual(reasons);
  });

  it('holds when the AI flags a rule but gives no reason', () => {
    const decision = decideOutcome({
      ...baseInput,
      ai: aiResult({ review: { needed: true, reasons: [] } }),
    });
    expect(decision.action).toBe('hold');
    expect(decision.reasons[0]).toMatch(/hold list/i);
  });
});
