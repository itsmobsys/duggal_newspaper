import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { SessionUser } from './user';

/**
 * Server-only Discord OAuth2 helpers. Scope is `identify` — we never request
 * email or guilds. Secrets stay in env vars and never reach the browser.
 */

const DISCORD_API = 'https://discord.com/api';
const DISCORD_CDN = 'https://cdn.discordapp.com';
const DISCORD_AUTHORIZE = 'https://discord.com/oauth2/authorize';

export const DISCORD_SCOPE = 'identify';
const STATE_MAX_AGE_SECONDS = 60 * 10;

export interface OAuthHandshake {
  state: string;
  verifier: string;
  next: string;
}

export function oauthConfigured(): boolean {
  return Boolean(
    process.env.DISCORD_CLIENT_ID?.trim() && process.env.DISCORD_CLIENT_SECRET?.trim(),
  );
}

export function discordRedirectUri(origin: string): string {
  const configured = process.env.DISCORD_REDIRECT_URI?.trim();
  return configured || `${origin}/api/auth/discord/callback`;
}

/** Only same-site relative paths are accepted, so `?next=` cannot become an open redirect. */
export function safeNextPath(value: string | null | undefined): string {
  if (!value) return '/submit';
  if (!value.startsWith('/') || value.startsWith('//') || value.includes('\\')) return '/submit';
  return value.slice(0, 200);
}

export function createHandshake(next: string): { handshake: OAuthHandshake; cookie: string } {
  const handshake: OAuthHandshake = {
    state: randomBytes(24).toString('base64url'),
    verifier: randomBytes(32).toString('base64url'),
    next: safeNextPath(next),
  };
  return { handshake, cookie: encodeHandshake(handshake) };
}

export function encodeHandshake(handshake: OAuthHandshake): string {
  return Buffer.from(JSON.stringify(handshake), 'utf8').toString('base64url');
}

export function decodeHandshake(value: string | undefined): OAuthHandshake | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as unknown;
    if (!parsed || typeof parsed !== 'object') return null;
    const candidate = parsed as Partial<OAuthHandshake>;
    if (typeof candidate.state !== 'string' || typeof candidate.verifier !== 'string') return null;
    if (candidate.state.length < 16 || candidate.verifier.length < 32) return null;
    return {
      state: candidate.state,
      verifier: candidate.verifier,
      next: safeNextPath(candidate.next),
    };
  } catch {
    return null;
  }
}

export function stateMatches(expected: string, received: string | null): boolean {
  if (!received) return false;
  const left = Buffer.from(expected, 'utf8');
  const right = Buffer.from(received, 'utf8');
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export function authorizeUrl(origin: string, handshake: OAuthHandshake): string {
  const challenge = createHash('sha256').update(handshake.verifier).digest('base64url');
  const params = new URLSearchParams({
    client_id: process.env.DISCORD_CLIENT_ID?.trim() ?? '',
    response_type: 'code',
    redirect_uri: discordRedirectUri(origin),
    scope: DISCORD_SCOPE,
    state: handshake.state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    prompt: 'consent',
  });
  return `${DISCORD_AUTHORIZE}?${params.toString()}`;
}

export function stateCookieOptions(): {
  httpOnly: boolean;
  secure: boolean;
  sameSite: 'lax';
  path: string;
  maxAge: number;
} {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: STATE_MAX_AGE_SECONDS,
  };
}

interface DiscordTokenResponse {
  access_token?: string;
  token_type?: string;
  scope?: string;
  error?: string;
  error_description?: string;
}

interface DiscordUser {
  id?: string;
  username?: string;
  global_name?: string | null;
  avatar?: string | null;
}

export interface DiscordIdentity {
  discordId: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
}

export async function exchangeCode(
  code: string,
  verifier: string,
  origin: string,
): Promise<string | null> {
  const body = new URLSearchParams({
    client_id: process.env.DISCORD_CLIENT_ID?.trim() ?? '',
    client_secret: process.env.DISCORD_CLIENT_SECRET?.trim() ?? '',
    grant_type: 'authorization_code',
    code,
    redirect_uri: discordRedirectUri(origin),
    code_verifier: verifier,
  });
  const response = await fetch(`${DISCORD_API}/oauth2/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: body.toString(),
    cache: 'no-store',
  });
  if (!response.ok) return null;
  const data = (await response.json()) as DiscordTokenResponse;
  if (!data.access_token) return null;
  return data.access_token;
}

export async function fetchDiscordIdentity(accessToken: string): Promise<DiscordIdentity | null> {
  const response = await fetch(`${DISCORD_API}/users/@me`, {
    headers: { authorization: `Bearer ${accessToken}`, accept: 'application/json' },
    cache: 'no-store',
  });
  if (!response.ok) return null;
  const user = (await response.json()) as DiscordUser;
  const discordId = (user.id ?? '').trim();
  const username = (user.username ?? '').trim();
  if (!/^\d{15,21}$/.test(discordId)) return null;
  if (!/^[A-Za-z0-9._]{2,32}$/.test(username)) return null;
  const globalName = (user.global_name ?? '').trim();
  return {
    discordId,
    username: username.toLowerCase(),
    displayName: globalName || username,
    avatarUrl: avatarUrlFor(discordId, user.avatar ?? null),
  };
}

function avatarUrlFor(discordId: string, avatar: string | null): string | null {
  if (!avatar || !/^[A-Za-z0-9_]{20,64}$/.test(avatar)) return null;
  const extension = avatar.startsWith('a_') ? 'gif' : 'png';
  return `${DISCORD_CDN}/avatars/${discordId}/${avatar}.${extension}?size=128`;
}

export type { SessionUser };
