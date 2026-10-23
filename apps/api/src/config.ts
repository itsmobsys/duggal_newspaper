import { existsSync } from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
import { z } from 'zod';

// Support a single root .env (recommended) plus an app-local override.
function loadEnvFiles(): void {
  const candidates = [
    path.resolve(process.cwd(), '.env'),
    path.resolve(process.cwd(), '../../.env'),
    path.resolve(process.cwd(), '../.env'),
  ];
  for (const file of candidates) {
    if (existsSync(file)) {
      // dotenv never overrides already-set values, so the first file wins.
      dotenv.config({ path: file });
    }
  }
}

loadEnvFiles();

const DEV_SERVICE_SECRET = 'dev-only-insecure-service-secret-do-not-deploy-0001';
const DEV_WORKER_TOKEN = 'dev-only-insecure-worker-token-do-not-deploy-0001';
const DEV_SESSION_PEPPER = 'dev-only-insecure-session-pepper-do-not-deploy-0001';

function csv(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
}

const rawSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(8080),
  HOST: z.string().default('0.0.0.0'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

  WEB_ORIGIN: z.string().default('http://localhost:3000'),
  API_PUBLIC_URL: z.string().default('http://localhost:8080'),

  TURSO_DATABASE_URL: z.string().default('file:../../data/duggal.db'),
  TURSO_AUTH_TOKEN: z.string().optional(),

  NVIDIA_API_KEY: z.string().optional(),
  NVIDIA_BASE_URL: z.string().default('https://integrate.api.nvidia.com/v1'),
  NVIDIA_MODEL: z.string().default('minimaxai/minimax-m3.1-flash'),
  AI_MAX_RPM: z.coerce.number().int().min(1).max(600).default(28),
  AI_TIMEOUT_MS: z.coerce.number().int().min(5_000).max(600_000).default(180_000),
  AI_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(8).default(5),
  AI_TEMPERATURE: z.coerce.number().min(0).max(1.5).default(0.9),
  AI_MAX_TOKENS: z.coerce.number().int().min(256).max(8192).default(2600),
  // The model reasons before answering: it spends completion tokens thinking before
  // it writes the answer. This headroom is added to AI_MAX_TOKENS so the
  // answer budget is not eaten by reasoning tokens (which yields empty content).
  AI_REASONING_HEADROOM_TOKENS: z.coerce.number().int().min(0).max(16_000).default(6000),
  AI_JSON_MODE: z
    .enum(['true', 'false'])
    .default('true')
    .transform((value) => value === 'true'),

  SERVICE_SECRET: z.string().optional(),
  WORKER_TICK_TOKEN: z.string().optional(),
  SESSION_PEPPER: z.string().optional(),
  ADMIN_SESSION_TTL_HOURS: z.coerce.number().int().min(1).max(720).default(72),
  USER_SESSION_TTL_HOURS: z.coerce.number().int().min(1).max(2160).default(720),

  // Vercel Blob (Hobby) - the public store that serves every site photo.
  BLOB_READ_WRITE_TOKEN: z.string().optional(),
  // Optional private store used to keep the untouched original uploads.
  BLOB_PRIVATE_READ_WRITE_TOKEN: z.string().optional(),
  // Blob keys are immutable, so a long cache is safe. Cannot be under 60s.
  BLOB_CACHE_MAX_AGE_SECONDS: z.coerce.number().int().min(60).max(31_536_000).default(31_536_000),
  ALLOW_LOCAL_STORAGE: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
  LOCAL_STORAGE_DIR: z.string().default('../../.storage'),

  MAX_UPLOAD_BYTES: z.coerce
    .number()
    .int()
    .min(1024)
    .max(25 * 1024 * 1024)
    .default(8 * 1024 * 1024),
  MAX_IMAGES_PER_SUBMISSION: z.coerce.number().int().min(1).max(8).default(4),
  UPLOAD_TICKET_TTL_MINUTES: z.coerce.number().int().min(1).max(120).default(30),

  SITE_TIMEZONE: z.string().default('Asia/Kolkata'),
  WORKER_ENABLED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((value) => value === 'true'),
  WORKER_INTERVAL_MS: z.coerce.number().int().min(0).max(300_000).default(20_000),
  WORKER_LEASE_MS: z.coerce.number().int().min(10_000).max(900_000).default(300_000),
  WORKER_MAX_JOBS_PER_TICK: z.coerce.number().int().min(1).max(20).default(4),
  WORKER_BUDGET_MS: z.coerce.number().int().min(5_000).max(240_000).default(90_000),
  /**
   * Seconds between self-pings that stop Render Free from sleeping
   * (~15 idle minutes). 0 disables the self-ping entirely.
   */
  KEEP_WARM_MS: z.coerce.number().int().min(0).max(900_000).default(240_000),
  /** Absolute URL used for the self-ping; defaults to the Render service URL. */
  SELF_URL: z.string().url().optional(),
  TRUST_PROXY: z
    .enum(['true', 'false'])
    .default('true')
    .transform((value) => value === 'true'),

  REVALIDATE_URL: z.string().optional(),
  REVALIDATE_SECRET: z.string().optional(),
});

const raw = rawSchema.parse(process.env);
const isProduction = raw.NODE_ENV === 'production';

// Render's free instance sleeps after roughly 15 idle minutes; the cold start
// makes the first public click feel broken. Whenever we know a public URL to
// hit, ping our own /healthz every KEEP_WARM_MS (default 4 min); 0 disables.
const renderUrl = process.env.RENDER_EXTERNAL_URL ?? process.env.RENDER_EXTERNAL_HOSTNAME ?? '';
const selfUrl = (raw.SELF_URL ?? renderUrl).replace(/\/$/, '');
const keepWarmMs = selfUrl ? raw.KEEP_WARM_MS : 0;

function requiredInProduction(
  value: string | undefined,
  name: string,
  devFallback: string,
): string {
  if (value && value.length > 0) {
    if (isProduction && value.length < 24) {
      throw new Error(`${name} must be at least 24 characters in production.`);
    }
    return value;
  }
  if (isProduction) {
    throw new Error(
      `${name} is required in production. Generate one with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`,
    );
  }
  return devFallback;
}

const serviceSecret = requiredInProduction(
  raw.SERVICE_SECRET,
  'SERVICE_SECRET',
  DEV_SERVICE_SECRET,
);
const workerTickToken = requiredInProduction(
  raw.WORKER_TICK_TOKEN,
  'WORKER_TICK_TOKEN',
  DEV_WORKER_TOKEN,
);
const sessionPepper = requiredInProduction(
  raw.SESSION_PEPPER,
  'SESSION_PEPPER',
  DEV_SESSION_PEPPER,
);

if (isProduction && serviceSecret === workerTickToken) {
  throw new Error('SERVICE_SECRET and WORKER_TICK_TOKEN must be different values.');
}

const blobConfigured = Boolean(raw.BLOB_READ_WRITE_TOKEN);
const blobOriginalsConfigured = Boolean(raw.BLOB_PRIVATE_READ_WRITE_TOKEN);

if (isProduction && blobConfigured && !blobOriginalsConfigured) {
  // Not fatal: originals fall back to the public store with a random suffix.
  console.warn(
    '[config] BLOB_PRIVATE_READ_WRITE_TOKEN is not set. Original uploads will be kept in the ' +
      'public Blob store (unguessable URL). Add a private Blob store token to keep them ' +
      'unreachable without authentication.',
  );
}

if (isProduction && !blobConfigured && !raw.ALLOW_LOCAL_STORAGE) {
  // Do not crash the API (health checks and the admin console must still work),
  // but make the misconfiguration impossible to miss.
  console.error(
    '[config] FATAL CONFIG: photo storage is not configured. Uploads will be rejected. ' +
      'Create a Vercel Blob store and set BLOB_READ_WRITE_TOKEN (and optionally ' +
      'BLOB_PRIVATE_READ_WRITE_TOKEN for originals).',
  );
}

export interface AppConfig {
  env: 'development' | 'test' | 'production';
  isProduction: boolean;
  port: number;
  host: string;
  logLevel: string;
  webOrigins: string[];
  apiPublicUrl: string;
  db: { url: string; authToken?: string };
  ai: {
    apiKey?: string;
    baseUrl: string;
    model: string;
    maxRpm: number;
    timeoutMs: number;
    maxAttempts: number;
    temperature: number;
    maxTokens: number;
    reasoningHeadroomTokens: number;
    jsonMode: boolean;
  };
  serviceSecret: string;
  workerTickToken: string;
  sessionPepper: string;
  adminSessionTtlHours: number;
  userSessionTtlHours: number;
  storage: {
    mode: 'blob' | 'local';
    /** Token for the public Blob store that serves site photos. */
    blobToken?: string;
    /** Token for the optional private store that keeps original uploads. */
    originalsToken?: string;
    cacheMaxAgeSeconds: number;
    localDir: string;
    configured: boolean;
  };
  maxUploadBytes: number;
  maxImagesPerSubmission: number;
  uploadTicketTtlMinutes: number;
  siteTimezone: string;
  worker: {
    enabled: boolean;
    intervalMs: number;
    leaseMs: number;
    maxJobsPerTick: number;
    budgetMs: number;
  };
  /** Interval in ms for the keep-warm self-ping; 0 disabled. */
  keepWarmMs: number;
  /** Absolute URL the self-ping calls; falls back to the Render public URL. */
  selfUrl: string;
  trustProxy: boolean;
  revalidate: { url?: string; secret?: string };
}

function resolveLocalDir(value: string): string {
  const candidates = [
    path.resolve(process.cwd(), value),
    path.resolve(process.cwd(), '../../.storage'),
    path.resolve(process.cwd(), '../.storage'),
  ];
  return candidates.find((candidate) => existsSync(candidate)) ?? candidates[0]!;
}

export const config: AppConfig = {
  env: raw.NODE_ENV,
  isProduction,
  port: raw.PORT,
  host: raw.HOST,
  logLevel: raw.LOG_LEVEL,
  webOrigins: csv(raw.WEB_ORIGIN),
  apiPublicUrl: raw.API_PUBLIC_URL.replace(/\/$/, ''),
  db: {
    url: raw.TURSO_DATABASE_URL,
    authToken: raw.TURSO_AUTH_TOKEN || undefined,
  },
  ai: {
    apiKey: raw.NVIDIA_API_KEY || undefined,
    baseUrl: raw.NVIDIA_BASE_URL.replace(/\/$/, ''),
    model: raw.NVIDIA_MODEL,
    maxRpm: raw.AI_MAX_RPM,
    timeoutMs: raw.AI_TIMEOUT_MS,
    maxAttempts: raw.AI_MAX_ATTEMPTS,
    temperature: raw.AI_TEMPERATURE,
    maxTokens: raw.AI_MAX_TOKENS,
    reasoningHeadroomTokens: raw.AI_REASONING_HEADROOM_TOKENS,
    jsonMode: raw.AI_JSON_MODE,
  },
  serviceSecret,
  workerTickToken,
  sessionPepper,
  adminSessionTtlHours: raw.ADMIN_SESSION_TTL_HOURS,
  userSessionTtlHours: raw.USER_SESSION_TTL_HOURS,
  storage: {
    mode: blobConfigured ? 'blob' : 'local',
    blobToken: raw.BLOB_READ_WRITE_TOKEN || undefined,
    originalsToken: raw.BLOB_PRIVATE_READ_WRITE_TOKEN || undefined,
    cacheMaxAgeSeconds: raw.BLOB_CACHE_MAX_AGE_SECONDS,
    localDir: resolveLocalDir(raw.LOCAL_STORAGE_DIR),
    configured: blobConfigured || raw.ALLOW_LOCAL_STORAGE,
  },
  maxUploadBytes: raw.MAX_UPLOAD_BYTES,
  maxImagesPerSubmission: raw.MAX_IMAGES_PER_SUBMISSION,
  uploadTicketTtlMinutes: raw.UPLOAD_TICKET_TTL_MINUTES,
  siteTimezone: raw.SITE_TIMEZONE,
  worker: {
    enabled: raw.WORKER_ENABLED,
    intervalMs: raw.WORKER_INTERVAL_MS,
    leaseMs: raw.WORKER_LEASE_MS,
    maxJobsPerTick: raw.WORKER_MAX_JOBS_PER_TICK,
    budgetMs: raw.WORKER_BUDGET_MS,
  },
  trustProxy: raw.TRUST_PROXY,
  revalidate: { url: raw.REVALIDATE_URL, secret: raw.REVALIDATE_SECRET },
  selfUrl,
  keepWarmMs,
};

export const AI_MODEL_ID = config.ai.model;
export const REQUIRED_MODEL_ID = 'minimaxai/minimax-m3.1-flash';

export function assertAiConfigured(): void {
  if (!config.ai.apiKey) {
    throw new AiConfigError(
      'NVIDIA_API_KEY is not set. Add it to the server environment to enable the AI newsroom.',
    );
  }
}

export class AiConfigError extends Error {
  readonly code = 'AI_NOT_CONFIGURED';
  constructor(message: string) {
    super(message);
    this.name = 'AiConfigError';
  }
}
