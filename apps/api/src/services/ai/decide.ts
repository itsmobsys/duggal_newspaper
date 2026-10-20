import type { AiResult } from './schema.js';
import type { Settings } from '../../settings.js';

export type DecisionAction = 'publish' | 'hold' | 'reject' | 'defer';

export interface HeuristicSignals {
  spamScore: number;
  misleadingRisk: number;
  reviewReasons: string[];
  blockedDomain: boolean;
  duplicateOf: string | null;
  duplicateScore: number;
  linkCount: number;
}

export interface DecisionInput {
  ai: AiResult;
  settings: Settings;
  heuristics: HeuristicSignals;
  publishedLastHour: number;
  breakingLastSixHours: number;
  aiConfigured: boolean;
}

export interface Decision {
  action: DecisionAction;
  reasons: string[];
  breaking: boolean;
  spamScore: number;
  misleadingRisk: number;
  duplicateOf: string | null;
  deferredSeconds: number;
}

/**
 * The autonomous editor's final gate. Pure function so the rules are testable
 * and auditable. Safety always beats autonomy.
 */
export function decideOutcome(input: DecisionInput): Decision {
  const { ai, settings, heuristics } = input;
  const spamScore = Math.max(ai.safety.spam_score, heuristics.spamScore);
  const misleadingRisk = Math.max(ai.safety.misleading_risk, heuristics.misleadingRisk);
  const duplicateOf = heuristics.duplicateOf;

  const breakingAllowed =
    ai.breaking &&
    settings['content.breaking_enabled'] &&
    ai.review.severity === 'none' &&
    !ai.review.needed &&
    input.breakingLastSixHours < 2;

  const base = {
    breaking: breakingAllowed,
    spamScore,
    misleadingRisk,
    duplicateOf,
    deferredSeconds: 0,
  };

  if (!input.aiConfigured) {
    return {
      ...base,
      action: 'hold',
      reasons: ['AI is not configured; nothing can be published responsibly.'],
    };
  }

  if (heuristics.blockedDomain) {
    return { ...base, action: 'reject', reasons: ['Source domain is blocked by the publisher.'] };
  }

  if (spamScore >= 0.95 && sideSpam(ai, heuristics)) {
    return { ...base, action: 'reject', reasons: ['High-confidence spam.'] };
  }

  if (settings['moderation.hold_high_risk'] && ai.review.severity === 'high') {
    return {
      ...base,
      action: 'hold',
      reasons: [
        ...ai.review.reasons,
        ...heuristics.reviewReasons,
        'High-risk content requires a human editor.',
      ],
    };
  }

  if (ai.review.needed) {
    return {
      ...base,
      action: 'hold',
      reasons: [...ai.review.reasons, ...heuristics.reviewReasons].filter(Boolean),
    };
  }

  if (heuristics.reviewReasons.length > 0) {
    return { ...base, action: 'hold', reasons: heuristics.reviewReasons };
  }

  if (duplicateOf && heuristics.duplicateScore >= settings['moderation.duplicate_threshold']) {
    return {
      ...base,
      action: 'hold',
      reasons: [
        `Likely duplicate (${Math.round(heuristics.duplicateScore * 100)}% match) of an earlier submission.`,
      ],
    };
  }

  if (spamScore >= settings['moderation.spam_threshold']) {
    return { ...base, action: 'hold', reasons: ['Spam score above the publishing threshold.'] };
  }

  if (misleadingRisk >= settings['moderation.misleading_threshold']) {
    return {
      ...base,
      action: 'hold',
      reasons: [
        `Misleading-claim risk ${Math.round(misleadingRisk * 100)}% is above the publishing threshold.`,
      ],
    };
  }

  if (!settings['autonomy.enabled'] || !settings['content.auto_publish']) {
    return { ...base, action: 'hold', reasons: ['Auto-publishing is disabled in site settings.'] };
  }

  if (input.publishedLastHour >= settings['autonomy.max_publishes_per_hour']) {
    return {
      ...base,
      action: 'defer',
      reasons: ['Publishing throttle reached; retrying shortly.'],
      deferredSeconds: 300,
    };
  }

  return { ...base, action: 'publish', reasons: [] };
}

function sideSpam(ai: AiResult, heuristics: HeuristicSignals): boolean {
  if (heuristics.spamScore >= 0.9) return true;
  return ai.safety.spam_score >= 0.95 && heuristics.linkCount >= 3;
}
