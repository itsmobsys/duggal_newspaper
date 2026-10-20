import { config } from '../../config.js';
import { AiUnavailableError } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';
import { sanitizeUserText } from '../../lib/text.js';
import type { z } from 'zod';

export interface AiUsageEvent {
  purpose: string;
  model: string;
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
  durationMs: number;
  attempts: number;
  status: 'ok' | 'error' | 'rate_limited';
  errorCode: string | null;
}

export type UsageSink = (event: AiUsageEvent) => Promise<void> | void;

export interface ChatJsonOptions<T extends z.ZodTypeAny> {
  purpose: string;
  system: string;
  user: string;
  schema: T;
  maxTokens?: number;
  temperature?: number;
  /** Overrides AI_MAX_ATTEMPTS, for probes that must answer fast. */
  maxAttempts?: number;
  onUsage?: UsageSink;
  timeoutMs?: number;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Hard ceiling for a single completion (reasoning + answer). */
const MAX_COMPLETION_TOKENS = 16_384;

/**
 * Removes anything that looks like a credential before text reaches a log line.
 * Upstream error bodies and messages are untrusted.
 */
export function redactSecrets(input: string): string {
  return input
    .replace(/nvapi-[A-Za-z0-9_-]+/gi, 'nvapi-[redacted]')
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [redacted]')
    .replace(
      /("?(?:api[_-]?key|authorization|access[_-]?token|token|secret)"?\s*[:=]\s*"?)([^",}\s]+)/gi,
      '$1[redacted]',
    );
}

/** Single-line, redacted, bounded preview of an upstream body. */
export function sanitizeUpstreamBody(body: string, maxLength = 500): string {
  return redactSecrets(body.replace(/\s+/g, ' ').trim()).slice(0, maxLength);
}

/** Non-sensitive facts about one completed request, safe to log. */
export interface CompletionDiagnostics {
  purpose: string;
  model: string;
  httpStatus: number | null;
  durationMs: number;
  choices: number;
  finishReason: string | null;
  contentLength: number;
  reasoningLength: number;
  completionTokens: number | null;
  reasoningTokens: number | null;
  truncated: boolean;
}

/** Sliding-window client-side limiter so we never hammer the free tier. */
const requestTimestamps: number[] = [];
let limiterChain: Promise<void> = Promise.resolve();

async function acquireSlot(): Promise<void> {
  const previous = limiterChain;
  let release: () => void = () => {};
  limiterChain = new Promise<void>((resolve) => {
    release = resolve;
  });
  await previous;
  try {
    for (;;) {
      const now = Date.now();
      while (requestTimestamps.length > 0 && now - requestTimestamps[0]! > 60_000) {
        requestTimestamps.shift();
      }
      if (requestTimestamps.length < config.ai.maxRpm) {
        requestTimestamps.push(now);
        return;
      }
      const oldest = requestTimestamps[0] ?? now;
      const waitMs = Math.max(250, 60_000 - (now - oldest) + 100);
      if (waitMs > 90_000) {
        throw new AiUnavailableError(
          'AI client rate limit is saturated; the job will be retried later.',
          'AI_RATE_LIMIT',
          true,
        );
      }
      await sleep(waitMs);
    }
  } finally {
    release();
  }
}

export function resetRateLimiterForTests(): void {
  requestTimestamps.length = 0;
  limiterChain = Promise.resolve();
}

/** Extract the first balanced JSON object from a model response. */
export function extractJsonObject(raw: string): string | null {
  const withoutFences = raw
    .replace(/^\s*```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim();

  const start = withoutFences.indexOf('{');
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < withoutFences.length; index += 1) {
    const char = withoutFences[index]!;
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }
    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === '{') depth += 1;
    if (char === '}') {
      depth -= 1;
      if (depth === 0) return withoutFences.slice(start, index + 1);
    }
  }
  return null;
}

function contentToText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === 'string') return part;
        if (part && typeof part === 'object' && 'text' in part) {
          return String((part as { text?: unknown }).text ?? '');
        }
        return '';
      })
      .join('');
  }
  return '';
}

function retryAfterMs(headers: Headers): number | null {
  const value = headers.get('retry-after');
  if (!value) return null;
  const seconds = Number.parseInt(value, 10);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(value);
  if (Number.isFinite(date)) return Math.max(0, date - Date.now());
  return null;
}

function backoffMs(attempt: number): number {
  const base = Math.min(45_000, 1500 * 2 ** (attempt - 1));
  return base + Math.floor(Math.random() * 750);
}

interface RawCallResult {
  content: string;
  usage: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
    reasoning_tokens?: number;
    completion_tokens_details?: { reasoning_tokens?: number };
  } | null;
  durationMs: number;
}

interface CallState {
  jsonMode: boolean;
}

async function rawCall(input: {
  purpose: string;
  system: string;
  user: string;
  maxTokens: number;
  temperature: number;
  timeoutMs: number;
  jsonMode: boolean;
  repair?: { previous: string; error: string };
}): Promise<RawCallResult> {
  if (!config.ai.apiKey) {
    throw new AiUnavailableError(
      'NVIDIA_API_KEY is not configured. AI processing cannot run.',
      'AI_NOT_CONFIGURED',
      false,
    );
  }

  const textPart = input.repair
    ? `${input.user}\n\n---\nYour previous answer was rejected: ${input.repair.error}\nPrevious answer:\n"""\n${input.repair.previous.slice(0, 12_000)}\n"""\nReturn ONLY the corrected JSON object. No markdown, no commentary.`
    : input.user;

  // Text only: photos never leave our storage, so the model can never inspect
  // or describe an image.
  const body: Record<string, unknown> = {
    model: config.ai.model,
    messages: [
      { role: 'system', content: input.system },
      { role: 'user', content: textPart },
    ],
    temperature: input.temperature,
    top_p: 0.95,
    max_tokens: input.maxTokens,
    stream: false,
  };
  if (input.jsonMode) {
    body.response_format = { type: 'json_object' };
  }

  const startedAt = Date.now();
  let response: Response;
  try {
    response = await fetch(`${config.ai.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.ai.apiKey}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(input.timeoutMs),
    });
  } catch (error) {
    const isTimeout =
      error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
    const message = isTimeout
      ? `NVIDIA API timed out after ${input.timeoutMs}ms.`
      : `NVIDIA API network error: ${error instanceof Error ? error.message : String(error)}`;
    logger.warn(
      {
        purpose: input.purpose,
        model: config.ai.model,
        httpStatus: null,
        durationMs: Date.now() - startedAt,
        errorCode: isTimeout ? 'AI_TIMEOUT' : 'AI_NETWORK',
        error: redactSecrets(message),
      },
      'NVIDIA API transport failure',
    );
    throw new AiUnavailableError(message, isTimeout ? 'AI_TIMEOUT' : 'AI_NETWORK', true);
  }

  const durationMs = Date.now() - startedAt;
  const text = await response.text();

  if (!response.ok) {
    const lower = text.toLowerCase();
    let code = `AI_HTTP_${response.status}`;
    let retryable =
      response.status === 408 ||
      response.status === 409 ||
      response.status === 429 ||
      response.status >= 500;
    let message = `NVIDIA API returned ${response.status}: ${text.slice(0, 400)}`;

    if (response.status === 400 && lower.includes('response_format')) {
      code = 'AI_JSON_MODE_UNSUPPORTED';
      retryable = false;
    } else if (response.status === 401 || response.status === 403) {
      code = 'AI_AUTH';
      retryable = false;
      message = 'NVIDIA API rejected the key (401/403). Check NVIDIA_API_KEY and its model access.';
    } else if (response.status === 404) {
      code = 'AI_MODEL_UNAVAILABLE';
      retryable = false;
      message = `Model "${config.ai.model}" is not available on this NVIDIA account (404). Verify model access; no substitute model will be used.`;
    } else if (response.status === 402) {
      code = 'AI_PAYMENT_REQUIRED';
      retryable = false;
      message =
        'NVIDIA API requires billing/credits for this request. No paid upgrade is attempted automatically.';
    } else if (response.status === 429) {
      code = 'AI_RATE_LIMITED';
    } else if (lower.includes('context') && lower.includes('length')) {
      code = 'AI_CONTEXT_TOO_LONG';
      retryable = false;
    }

    const error = new AiUnavailableError(message, code, retryable);
    (error as AiUnavailableError & { retryAfterMs?: number }).retryAfterMs =
      retryAfterMs(response.headers) ?? undefined;
    (error as AiUnavailableError & { durationMs?: number }).durationMs = durationMs;
    logger.warn(
      {
        purpose: input.purpose,
        model: config.ai.model,
        httpStatus: response.status,
        durationMs,
        errorCode: code,
        upstreamBody: sanitizeUpstreamBody(text),
      },
      'NVIDIA API request failed',
    );
    throw error;
  }

  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    logger.warn(
      {
        purpose: input.purpose,
        model: config.ai.model,
        httpStatus: response.status,
        durationMs,
        errorCode: 'AI_BAD_ENVELOPE',
        upstreamBody: sanitizeUpstreamBody(text),
      },
      'NVIDIA API returned a non-JSON envelope',
    );
    throw new AiUnavailableError(
      'NVIDIA API returned a non-JSON envelope.',
      'AI_BAD_ENVELOPE',
      true,
    );
  }

  const envelope = data as {
    error?: { message?: string };
    choices?: Array<{
      finish_reason?: string;
      message?: { content?: unknown; reasoning_content?: unknown; reasoning?: unknown };
    }>;
    usage?: RawCallResult['usage'];
  };

  if (envelope.error) {
    const message = envelope.error.message ?? 'unknown';
    logger.warn(
      {
        purpose: input.purpose,
        model: config.ai.model,
        httpStatus: response.status,
        durationMs,
        errorCode: 'AI_API_ERROR',
        upstreamBody: sanitizeUpstreamBody(message),
      },
      'NVIDIA API returned an error envelope',
    );
    throw new AiUnavailableError(`NVIDIA API error: ${message}`, 'AI_API_ERROR', true);
  }

  const choice = envelope.choices?.[0];
  const rawContent = contentToText(choice?.message?.content);
  const reasoning = contentToText(choice?.message?.reasoning_content ?? choice?.message?.reasoning);
  const content = rawContent.trim();
  const finishReason = typeof choice?.finish_reason === 'string' ? choice.finish_reason : null;
  const usage = envelope.usage ?? null;
  const reasoningTokens =
    usage?.completion_tokens_details?.reasoning_tokens ?? usage?.reasoning_tokens ?? null;

  const diagnostics: CompletionDiagnostics = {
    purpose: input.purpose,
    model: config.ai.model,
    httpStatus: response.status,
    durationMs,
    choices: envelope.choices?.length ?? 0,
    finishReason,
    contentLength: rawContent.length,
    reasoningLength: reasoning.length,
    completionTokens: usage?.completion_tokens ?? null,
    reasoningTokens,
    truncated: finishReason === 'length',
  };

  if (diagnostics.truncated) {
    logger.warn(
      { ...diagnostics, contentPreview: sanitizeUpstreamBody(content, 120) },
      'NVIDIA completion hit the token limit',
    );
  } else if (!content) {
    logger.warn(diagnostics, 'NVIDIA completion was empty');
  } else {
    logger.info(diagnostics, 'NVIDIA completion received');
  }

  if (!envelope.choices || envelope.choices.length === 0) {
    throw new AiUnavailableError(
      `NVIDIA API returned no choices (finish_reason: ${finishReason ?? 'none'}).`,
      'AI_BAD_ENVELOPE',
      true,
    );
  }

  if (finishReason === 'length') {
    // Reasoning models can spend the whole completion budget thinking, leaving
    // no room for the answer. Retrying with the same budget always fails, so
    // surface a dedicated code that chatJson answers with a larger budget.
    throw new AiUnavailableError(
      `NVIDIA stopped at the ${input.maxTokens}-token completion limit before finishing the answer` +
        ` (${reasoningTokens ?? 'unknown'} reasoning tokens, ${content.length} answer chars).`,
      'AI_TRUNCATED',
      true,
    );
  }

  if (!content) {
    throw new AiUnavailableError('NVIDIA API returned an empty completion.', 'AI_EMPTY', true);
  }

  return { content, usage, durationMs };
}

/**
 * Calls the configured NVIDIA model and validates the JSON response.
 * Retries transient failures with exponential backoff and performs up to two
 * schema-repair turns. Never switches models.
 */
export async function chatJson<T extends z.ZodTypeAny>(
  options: ChatJsonOptions<T>,
): Promise<{ data: z.infer<T>; raw: string; attempts: number; usage: AiUsageEvent }> {
  const maxAttempts = Math.max(1, options.maxAttempts ?? config.ai.maxAttempts);
  // AI_MAX_TOKENS is the answer budget. This model also bills reasoning against
  // the completion window, so the request budget is answer + reasoning headroom.
  let maxTokens = Math.min(
    MAX_COMPLETION_TOKENS,
    (options.maxTokens ?? config.ai.maxTokens) + config.ai.reasoningHeadroomTokens,
  );
  let budgetEscalations = 0;
  const temperature = options.temperature ?? config.ai.temperature;
  const timeoutMs = options.timeoutMs ?? config.ai.timeoutMs;

  const state: CallState = { jsonMode: config.ai.jsonMode };
  let lastError: unknown = null;
  let attempts = 0;
  let repairCount = 0;
  let previousRaw = '';
  let previousError = '';
  let totalDuration = 0;
  const startedAt = Date.now();

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    attempts = attempt;
    try {
      await acquireSlot();
      const result = await rawCall({
        purpose: options.purpose,
        system: options.system,
        user: options.user,
        maxTokens,
        temperature,
        timeoutMs,
        jsonMode: state.jsonMode,
        repair: repairCount > 0 ? { previous: previousRaw, error: previousError } : undefined,
      });
      totalDuration += result.durationMs;

      const jsonText = extractJsonObject(result.content);
      if (!jsonText) {
        previousRaw = result.content;
        previousError = 'No JSON object found in the response.';
        lastError = new AiUnavailableError(previousError, 'AI_INVALID_JSON', true);
        repairCount += 1;
        if (repairCount > 2) break;
        continue;
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(jsonText);
      } catch (error) {
        previousRaw = result.content;
        previousError = `Malformed JSON: ${error instanceof Error ? error.message : 'parse error'}`;
        lastError = new AiUnavailableError(previousError, 'AI_INVALID_JSON', true);
        repairCount += 1;
        if (repairCount > 2) break;
        continue;
      }

      const validation = options.schema.safeParse(parsed);
      if (!validation.success) {
        const issues = validation.error.issues
          .slice(0, 6)
          .map((issue) => `${issue.path.join('.') || 'root'}: ${issue.message}`)
          .join('; ');
        previousRaw = result.content;
        previousError = `Schema validation failed (${issues}).`;
        lastError = new AiUnavailableError(previousError, 'AI_SCHEMA_INVALID', true);
        repairCount += 1;
        if (repairCount > 2) break;
        continue;
      }

      const usage: AiUsageEvent = {
        purpose: options.purpose,
        model: config.ai.model,
        promptTokens: result.usage?.prompt_tokens ?? null,
        completionTokens: result.usage?.completion_tokens ?? null,
        totalTokens: result.usage?.total_tokens ?? null,
        durationMs: totalDuration,
        attempts,
        status: 'ok',
        errorCode: null,
      };
      if (options.onUsage) await options.onUsage(usage);
      return { data: validation.data as z.infer<T>, raw: result.content, attempts, usage };
    } catch (error) {
      lastError = error;

      if (error instanceof AiUnavailableError && error.code === 'AI_JSON_MODE_UNSUPPORTED') {
        // The model gateway does not accept response_format. Retry without it,
        // without consuming an attempt.
        state.jsonMode = false;
        logger.warn(
          { purpose: options.purpose },
          'NVIDIA gateway rejected response_format; retrying without JSON mode',
        );
        attempt -= 1;
        continue;
      }

      if (error instanceof AiUnavailableError && error.code === 'AI_TRUNCATED') {
        // Reasoning ran past the completion budget. Retrying unchanged is futile,
        // so raise the budget instead of burning an attempt on the same request.
        const nextTokens = Math.min(MAX_COMPLETION_TOKENS, Math.ceil(maxTokens * 1.75));
        if (budgetEscalations < 2 && nextTokens > maxTokens) {
          budgetEscalations += 1;
          logger.warn(
            {
              purpose: options.purpose,
              attempt,
              previousMaxTokens: maxTokens,
              nextMaxTokens: nextTokens,
            },
            'NVIDIA completion truncated; retrying with a larger budget',
          );
          maxTokens = nextTokens;
          attempt -= 1;
          continue;
        }
        break;
      }

      if (error instanceof AiUnavailableError && !error.retryable) {
        break;
      }

      if (attempt < maxAttempts) {
        const retryAfter = (error as AiUnavailableError & { retryAfterMs?: number }).retryAfterMs;
        const delay =
          retryAfter && retryAfter > 0 ? Math.min(retryAfter, 120_000) : backoffMs(attempt);
        logger.warn(
          {
            purpose: options.purpose,
            attempt,
            maxAttempts,
            delayMs: delay,
            code: error instanceof AiUnavailableError ? error.code : 'UNKNOWN',
          },
          'AI call failed; backing off',
        );
        await sleep(delay);
      }
    }
  }

  const errorCode = lastError instanceof AiUnavailableError ? lastError.code : 'AI_FAILED';
  const usage: AiUsageEvent = {
    purpose: options.purpose,
    model: config.ai.model,
    promptTokens: null,
    completionTokens: null,
    totalTokens: null,
    durationMs: Date.now() - startedAt,
    attempts,
    status: errorCode === 'AI_RATE_LIMITED' ? 'rate_limited' : 'error',
    errorCode,
  };
  if (options.onUsage) await options.onUsage(usage);

  if (lastError instanceof AiUnavailableError) throw lastError;
  throw new AiUnavailableError(
    `AI processing failed: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
    errorCode,
    true,
  );
}

export interface ModelAvailability {
  available: boolean;
  model: string;
  modelsSeen: number;
  error?: string;
}

/** Diagnostic helper: verifies the configured model is visible to this API key. */
export async function checkModelAvailability(): Promise<ModelAvailability> {
  if (!config.ai.apiKey) {
    return {
      available: false,
      model: config.ai.model,
      modelsSeen: 0,
      error: 'NVIDIA_API_KEY is not set.',
    };
  }
  try {
    const response = await fetch(`${config.ai.baseUrl}/models`, {
      headers: { Authorization: `Bearer ${config.ai.apiKey}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) {
      return {
        available: false,
        model: config.ai.model,
        modelsSeen: 0,
        error: `Models endpoint returned ${response.status}.`,
      };
    }
    const data = (await response.json()) as { data?: Array<{ id?: string }> };
    const ids = (data.data ?? []).map((item) => item.id ?? '');
    return {
      available: ids.includes(config.ai.model),
      model: config.ai.model,
      modelsSeen: ids.length,
      error: ids.includes(config.ai.model)
        ? undefined
        : 'Model ID is not listed for this API key. Verify access on build.nvidia.com.',
    };
  } catch (error) {
    return {
      available: false,
      model: config.ai.model,
      modelsSeen: 0,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export function sanitizeAiText(input: string, maxLength = 20_000): string {
  return sanitizeUserText(input).slice(0, maxLength);
}
