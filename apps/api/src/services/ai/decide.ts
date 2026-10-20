import type { AiResult } from './schema.js';
import type { Settings } from '../../settings.js';

export type DecisionAction = 'publish' | 'hold' | 'reject' | 'defer';

export interface HeuristicSignals {
  spamScore: number;
  reviewReasons: string[];
  blockedDomain: boolean;
  linkCount: number;
}

export interface DecisionInput {
  ai: AiResult;
  settings: Settings;
  heuristics: HeuristicSignals;
  publishedLastHour: number;
  breakingLastSixHours: number;
  aiConfigured: boolean;
  /** A human cleared the desk's flags; the AI review hold no longer applies. */
  editorOverride?: boolean;
}

export interface Decision {
  action: DecisionAction;
  reasons: string[];
  breaking: boolean;
  spamScore: number;
  deferredSeconds: number;
}

/**
 * The autonomous editor's final gate. Pure function so the rules are testable
 * and auditable.
 *
 * Editorial policy: the desk publishes by default. A hold needs a concrete
 * violation from the short list in the editor prompt, or a mechanical problem
 * with the submission itself. "Unverified", "risky", "controversial" and
 * "could offend someone" are not reasons: the copy is already hedged, and
 * protecting reputations is not the desk's job.
 */
export function decideOutcome(input: DecisionInput): Decision {
  const { ai, settings, heuristics } = input;
  const spamScore = heuristics.spamScore;

  const breakingAllowed =
    ai.breaking &&
    settings['content.breaking_enabled'] &&
    !ai.review.needed &&
    input.breakingLastSixHours < 2;

  const base = {
    breaking: breakingAllowed,
    spamScore,
    deferredSeconds: 0,
  };

  if (!input.aiConfigured) {
    return {
      ...base,
      action: 'hold',
      reasons: ['AI is not configured; nothing can be published until a model is connected.'],
    };
  }

  if (heuristics.blockedDomain) {
    return { ...base, action: 'reject', reasons: ['Source domain is blocked by the publisher.'] };
  }

  if (spamScore >= 0.95 && sideSpam(heuristics)) {
    return {
      ...base,
      action: 'reject',
      reasons: ['High-confidence spam: ad copy, link farming or off-platform solicitation.'],
    };
  }

  if (ai.review.needed && !input.editorOverride) {
    return {
      ...base,
      action: 'hold',
      reasons: ai.review.reasons.length
        ? ai.review.reasons
        : ['The editor flagged a rule from the hold list without quoting it.'],
    };
  }

  if (heuristics.reviewReasons.length > 0) {
    return { ...base, action: 'hold', reasons: heuristics.reviewReasons };
  }

  if (spamScore >= settings['moderation.spam_threshold']) {
    return {
      ...base,
      action: 'hold',
      reasons: [
        `Spam score ${Math.round(spamScore * 100)}% is above the ${Math.round(
          settings['moderation.spam_threshold'] * 100,
        )}% threshold. Remove ad copy, repeated links or contact solicitation and resubmit.`,
      ],
    };
  }

  if (!settings['autonomy.enabled'] || !settings['content.auto_publish']) {
    return {
      ...base,
      action: 'hold',
      reasons: ['Auto-publishing is switched off in site settings.'],
    };
  }

  if (input.publishedLastHour >= settings['autonomy.max_publishes_per_hour']) {
    return {
      ...base,
      action: 'defer',
      reasons: ['Hourly publishing limit reached; retrying shortly.'],
      deferredSeconds: 300,
    };
  }

  return { ...base, action: 'publish', reasons: [] };
}

function sideSpam(heuristics: HeuristicSignals): boolean {
  return heuristics.spamScore >= 0.9 || heuristics.linkCount >= 3;
}
