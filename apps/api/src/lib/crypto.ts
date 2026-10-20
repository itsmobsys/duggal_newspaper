import {
  createHash,
  createHmac,
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
  type ScryptOptions,
} from 'node:crypto';
import { config } from '../config.js';

function scryptAsync(
  password: string,
  salt: Buffer,
  keylen: number,
  options: ScryptOptions,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(password, salt, keylen, options, (error, derivedKey) => {
      if (error) reject(error);
      else resolve(derivedKey);
    });
  });
}

const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_KEYLEN = 64;

export function sha256Hex(input: string | Buffer): string {
  return createHash('sha256').update(input).digest('hex');
}

export function hmacHex(secret: string, message: string): string {
  return createHmac('sha256', secret).update(message).digest('hex');
}

export function safeEqual(a: string, b: string): boolean {
  const bufferA = Buffer.from(a);
  const bufferB = Buffer.from(b);
  if (bufferA.length !== bufferB.length) return false;
  return timingSafeEqual(bufferA, bufferB);
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = await scryptAsync(password.normalize('NFKC'), salt, SCRYPT_KEYLEN, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    maxmem: 64 * 1024 * 1024,
  });
  return [
    'scrypt',
    SCRYPT_N,
    SCRYPT_R,
    SCRYPT_P,
    salt.toString('base64url'),
    derived.toString('base64url'),
  ].join('$');
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  try {
    const [scheme, n, r, p, saltB64, hashB64] = stored.split('$');
    if (scheme !== 'scrypt' || !n || !r || !p || !saltB64 || !hashB64) return false;
    const derived = await scryptAsync(
      password.normalize('NFKC'),
      Buffer.from(saltB64, 'base64url'),
      Buffer.from(hashB64, 'base64url').length,
      {
        N: Number(n),
        r: Number(r),
        p: Number(p),
        maxmem: 64 * 1024 * 1024,
      },
    );
    const expected = Buffer.from(hashB64, 'base64url');
    if (derived.length !== expected.length) return false;
    return timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
}

/** Stable, non-reversible client fingerprint used for rate limiting and abuse review. */
export function hashIp(ip: string | undefined): string {
  return hmacHex(config.sessionPepper, `ip:${ip ?? 'unknown'}`).slice(0, 40);
}

export function hashToken(token: string): string {
  return sha256Hex(`session:${token}`);
}

export function hashUploadToken(token: string): string {
  return sha256Hex(`upload:${token}`);
}

/** Pseudonymous browser identity. The raw voter cookie never reaches the database. */
export function hashVoterToken(token: string): string {
  return sha256Hex(`voter:${token}`);
}

export interface SignedRequest {
  timestamp: string;
  signature: string;
}

/**
 * Service-to-service request signature. Prevents anyone who discovers the
 * Render URL from calling public/admin endpoints without the shared secret,
 * and binds the signature to method, path, body and time.
 */
export function signServiceRequest(
  method: string,
  pathWithQuery: string,
  body: string,
): SignedRequest {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const bodyHash = sha256Hex(body);
  const canonical = [timestamp, method.toUpperCase(), pathWithQuery, bodyHash].join('\n');
  return { timestamp, signature: hmacHex(config.serviceSecret, canonical) };
}

export function verifyServiceRequest(
  method: string,
  pathWithQuery: string,
  body: string,
  timestamp: string | undefined,
  signature: string | undefined,
  maxSkewSeconds = 300,
): boolean {
  if (!timestamp || !signature) return false;
  const ts = Number.parseInt(timestamp, 10);
  if (!Number.isFinite(ts)) return false;
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - ts) > maxSkewSeconds) return false;
  const bodyHash = sha256Hex(body);
  const canonical = [timestamp, method.toUpperCase(), pathWithQuery, bodyHash].join('\n');
  const expected = hmacHex(config.serviceSecret, canonical);
  return safeEqual(expected, signature);
}

export function constantTimeTokenMatch(provided: string, expected: string): boolean {
  return safeEqual(sha256Hex(provided), sha256Hex(expected));
}
