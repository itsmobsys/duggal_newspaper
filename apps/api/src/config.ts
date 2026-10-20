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
  NVIDIA_MODEL: z.string().default('nvidia/nemotron-3.5-super-vl-120b-a12b'),
  AI_MAX_RPM: z.coerce.number().int().min(1).max(600).default(28),
  AI_TIMEOUT_MS: z.coerce.number().int().min(5_000).max(600_000).default(180_000),
  AI_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(8).default(5),
  AI_TEMPERATURE: z.coerce.number().min(0).max(1.5).default(0.9),
  AI_MAX_TOKENS: z.coerce.number().int().min(256).max(8192).default(2600),
  AI_JSON_MODE: z
    .enum(['true', 'false'])
    .default('true')
    .transform((value) => value === 'true'),
  AI_VISION: z
    .enum(['true', 'false'])
    .default('true')
    .transform((value) => value === 'true'),
  AI_VISION_MAX_IMAGES: z.coerce.number().int().min(0).max(4).default(3),

  SERVICE_SECRET: z.string().optional(),
  WORKER_TICK_TOKEN: z.string().optional(),
  SESSION_PEPPER: z.string().optional(),
  ADMIN_SESSION_TTL_HOURS: z.coerce.number().int().min(1).max(720).default(72),

  S3_ENDPOINT: z.string().optional(),
  S3_REGION: z.string().default('auto'),
  S3_BUCKET: z.string().optional(),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  S3_PUBLIC_BASE_URL: z.string().optional(),
  S3_FORCE_PATH_STYLE: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
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
  TRUST_PROXY: z
    .enum(['true', 'false'])
    .default('true')
    .transform((value) => value === 'true'),

  REVALIDATE_URL: z.string().optional(),
  REVALIDATE_SECRET: z.string().optional(),
});

const raw = rawSchema.parse(process.env);
const isProduction = raw.NODE_ENV === 'production';

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

const s3Configured = Boolean(
  raw.S3_ENDPOINT &&
  raw.S3_BUCKET &&
  raw.S3_ACCESS_KEY_ID &&
  raw.S3_SECRET_ACCESS_KEY &&
  raw.S3_PUBLIC_BASE_URL,
);

if (isProduction && !s3Configured && !raw.ALLOW_LOCAL_STORAGE) {
  // Do not crash the API (health checks and the admin console must still work),
  // but make the misconfiguration impossible to miss.
  console.error(
    '[config] FATAL CONFIG: object storage is not configured. Uploads will be rejected. ' +
      'Set S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY and S3_PUBLIC_BASE_URL.',
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
    jsonMode: boolean;
    vision: boolean;
    visionMaxImages: number;
  };
  serviceSecret: string;
  workerTickToken: string;
  sessionPepper: string;
  adminSessionTtlHours: number;
  storage: {
    mode: 's3' | 'local';
    endpoint?: string;
    region: string;
    bucket?: string;
    accessKeyId?: string;
    secretAccessKey?: string;
    publicBaseUrl?: string;
    forcePathStyle: boolean;
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
    jsonMode: raw.AI_JSON_MODE,
    vision: raw.AI_VISION,
    visionMaxImages: raw.AI_VISION_MAX_IMAGES,
  },
  serviceSecret,
  workerTickToken,
  sessionPepper,
  adminSessionTtlHours: raw.ADMIN_SESSION_TTL_HOURS,
  storage: {
    mode: s3Configured ? 's3' : 'local',
    endpoint: raw.S3_ENDPOINT,
    region: raw.S3_REGION,
    bucket: raw.S3_BUCKET,
    accessKeyId: raw.S3_ACCESS_KEY_ID,
    secretAccessKey: raw.S3_SECRET_ACCESS_KEY,
    publicBaseUrl: raw.S3_PUBLIC_BASE_URL?.replace(/\/$/, ''),
    forcePathStyle: raw.S3_FORCE_PATH_STYLE,
    localDir: resolveLocalDir(raw.LOCAL_STORAGE_DIR),
    configured: s3Configured || raw.ALLOW_LOCAL_STORAGE,
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
};

export const AI_MODEL_ID = config.ai.model;
export const REQUIRED_MODEL_ID = 'nvidia/nemotron-3.5-super-vl-120b-a12b';

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
