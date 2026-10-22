import { COOKIE_AUTH_HINT } from './constants';

/**
 * True when the browser holds the non-httpOnly session hint. Logged-out readers
 * (the vast majority) then skip the /api/auth/me and community bootstrap calls
 * entirely, instead of paying a server round trip to be told "no user".
 */
export function hasSessionHint(): boolean {
  if (typeof document === 'undefined') return false;
  return document.cookie.split('; ').some((row) => row === `${COOKIE_AUTH_HINT}=1`);
}
