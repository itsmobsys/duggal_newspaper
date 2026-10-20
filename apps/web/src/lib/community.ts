import { randomBytes } from 'node:crypto';
import type { NextRequest, NextResponse } from 'next/server';
import { COOKIE_VOTER, COOKIE_VOTER_SECURE } from './constants';

/**
 * Reader identity without accounts.
 *
 * The browser holds one random, httpOnly token. The BFF forwards it to the API,
 * which stores only a SHA-256 hash. Clearing cookies resets the identity, which
 * is fine: there is nothing to sign in to, and the rate limiter still protects
 * the newsroom.
 */

export function voterCookieName(): string {
  return process.env.NODE_ENV === 'production' ? COOKIE_VOTER_SECURE : COOKIE_VOTER;
}

export function newVoterToken(): string {
  return randomBytes(32).toString('base64url');
}

const VOTER_TOKEN_PATTERN = /^[A-Za-z0-9_-]{20,120}$/;

export function readVoterToken(request: NextRequest): string | null {
  const value = request.cookies.get(voterCookieName())?.value;
  // Treat a corrupt cookie as absent so the BFF can issue a fresh identity
  // instead of forwarding a token the API will always reject.
  return value && VOTER_TOKEN_PATTERN.test(value) ? value : null;
}

export function setVoterCookie(response: NextResponse, token: string): void {
  response.cookies.set(voterCookieName(), token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 365,
  });
}
