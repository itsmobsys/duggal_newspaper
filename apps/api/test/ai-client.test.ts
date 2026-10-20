import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { config } from '../src/config.js';
import { AiUnavailableError } from '../src/lib/errors.js';
import { chatJson, redactSecrets, sanitizeUpstreamBody } from '../src/services/ai/client.js';

/**
 * Regression tests for the production AI outage (2026-10-20):
 * the reasoning model spent the whole completion budget on reasoning tokens,
 * returned an empty answer with finish_reason=length, and every retry used the
 * same budget. Production evidence: two ai_usage rows, AI_EMPTY, attempts=5,
 * 69s and 321s wasted on a single submission.
 */

const schema = z.object({ ok: z.boolean(), message: z.string() });
const okBody = JSON.stringify({ ok: true, message: 'newsroom online' });

const saved = { ...config.ai };

interface SentRequest {
  url: string;
  body: Record<string, unknown>;
}

function completion(options: {
  content: string;
  finishReason?: string;
  reasoning?: string;
  completionTokens?: number;
  reasoningTokens?: number;
}): Response {
  return new Response(
    JSON.stringify({
      id: 'chatcmpl-test',
      model: config.ai.model,
      choices: [
        {
          index: 0,
          finish_reason: options.finishReason ?? 'stop',
          message: {
            role: 'assistant',
            content: options.content,
            ...(options.reasoning === undefined ? {} : { reasoning_content: options.reasoning }),
          },
        },
      ],
      usage: {
        prompt_tokens: 1200,
        completion_tokens: options.completionTokens ?? 40,
        total_tokens: 1240,
        ...(options.reasoningTokens === undefined
          ? {}
          : { completion_tokens_details: { reasoning_tokens: options.reasoningTokens } }),
      },
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
}

/** Installs a fetch stub that replays the given responses in order. */
function stubFetch(responses: Array<Response | (() => Response)>): SentRequest[] {
  const sent: SentRequest[] = [];
  const mock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    sent.push({
      url: String(url),
      body: init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {},
    });
    const next = responses.shift();
    if (!next) throw new Error('unexpected extra fetch call');
    return typeof next === 'function' ? next() : next;
  });
  vi.stubGlobal('fetch', mock);
  return sent;
}

beforeAll(() => {
  config.ai.apiKey = 'nvapi-test-key';
  config.ai.maxRpm = 10_000;
});

beforeEach(() => {
  config.ai.maxTokens = 2600;
  config.ai.reasoningHeadroomTokens = 6000;
  config.ai.maxAttempts = 5;
  config.ai.jsonMode = true;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

afterAll(() => {
  Object.assign(config.ai, saved);
});

describe('completion budget', () => {
  it('reserves reasoning headroom on top of the answer budget', async () => {
    const sent = stubFetch([completion({ content: okBody })]);

    const result = await chatJson({
      purpose: 'admin_test',
      system: 'system',
      user: 'user',
      schema,
      maxTokens: 100,
      temperature: 0,
      maxAttempts: 1,
    });

    expect(result.data).toEqual({ ok: true, message: 'newsroom online' });
    expect(sent).toHaveLength(1);
    expect(sent[0]?.body.max_tokens).toBe(100 + 6000);
  });

  it('escalates the budget when reasoning exhausts it, instead of repeating AI_EMPTY', async () => {
    const sent = stubFetch([
      // Exactly the production failure: 2600-token budget, all reasoning, no answer.
      completion({
        content: '',
        finishReason: 'length',
        reasoning: 'thinking...',
        completionTokens: 8600,
        reasoningTokens: 8600,
      }),
      completion({ content: okBody }),
    ]);

    const result = await chatJson({
      purpose: 'process_submission',
      system: 'system',
      user: 'user',
      schema,
    });

    expect(result.data.ok).toBe(true);
    // A budget bump is not a failed attempt, so the reported count stays at 1.
    expect(result.attempts).toBe(1);
    expect(sent).toHaveLength(2);
    expect(sent[0]?.body.max_tokens).toBe(8600);
    expect(sent[1]?.body.max_tokens).toBe(Math.ceil(8600 * 1.75));
  });

  it('stops after two escalations and reports AI_TRUNCATED', async () => {
    const truncated = () =>
      completion({
        content: '',
        finishReason: 'length',
        completionTokens: 9000,
        reasoningTokens: 9000,
      });
    const sent = stubFetch([truncated(), truncated(), truncated()]);

    const error = await chatJson({
      purpose: 'process_submission',
      system: 'system',
      user: 'user',
      schema,
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(AiUnavailableError);
    expect((error as AiUnavailableError).code).toBe('AI_TRUNCATED');
    expect((error as AiUnavailableError).retryable).toBe(true);
    expect(sent.map((request) => request.body.max_tokens)).toEqual([
      8600,
      15_050,
      16_384, // MAX_COMPLETION_TOKENS ceiling
    ]);
  });

  it('still reports AI_EMPTY when the model stops without content', async () => {
    const sent = stubFetch([completion({ content: '   ' })]);

    const error = await chatJson({
      purpose: 'admin_test',
      system: 'system',
      user: 'user',
      schema,
      maxAttempts: 1,
    }).catch((caught: unknown) => caught);

    expect((error as AiUnavailableError).code).toBe('AI_EMPTY');
    expect(sent).toHaveLength(1);
  });

  it('keeps JSON mode working and drops it once when the gateway rejects response_format', async () => {
    const sent = stubFetch([
      new Response(JSON.stringify({ error: { message: 'response_format is not supported' } }), {
        status: 400,
        headers: { 'content-type': 'application/json' },
      }),
      completion({ content: okBody }),
    ]);

    const result = await chatJson({
      purpose: 'admin_test',
      system: 'system',
      user: 'user',
      schema,
      maxAttempts: 1,
    });

    expect(result.data.ok).toBe(true);
    expect(sent).toHaveLength(2);
    expect(sent[0]?.body.response_format).toEqual({ type: 'json_object' });
    expect(sent[1]?.body.response_format).toBeUndefined();
  });
});

describe('safe diagnostics', () => {
  it('redacts API keys and bearer tokens', () => {
    const text =
      'failed: Authorization: Bearer nvapi-abcdef1234567890 and {"api_key":"nvapi-zzz999","access_token":"tok_live_1"}';
    const clean = redactSecrets(text);

    expect(clean).not.toContain('nvapi-abcdef1234567890');
    expect(clean).not.toContain('nvapi-zzz999');
    expect(clean).not.toContain('tok_live_1');
    expect(clean).toContain('[redacted]');
  });

  it('collapses and bounds upstream error bodies', () => {
    const clean = sanitizeUpstreamBody(`line one\n\n  line two\t${'x'.repeat(2000)}`, 120);

    expect(clean).not.toContain('\n');
    expect(clean.length).toBe(120);
  });
});
