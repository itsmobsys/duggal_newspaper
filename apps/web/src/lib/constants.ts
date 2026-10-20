/** Shared constants for the website. Values that must match the API contract. */

export const SITE_NAME_FALLBACK = 'Duggal Badmosh Daily Newspaper';
export const SITE_TAGLINE_FALLBACK = 'Khabrein kam, kand zyada.';
export const SITE_DESCRIPTION_FALLBACK =
  'The internet’s least responsible newspaper. Written by an AI, fed by the Discord, trusted by absolutely nobody.';

/** Admin session cookie (httpOnly, set by the BFF). */
export const COOKIE_ADMIN_SESSION = 'dbd_admin';
/** Pseudonymous reader identity for votes and reviews (httpOnly). */
export const COOKIE_VOTER = 'dbd_voter';
/** Production-safe reader cookie name: no subdomain can overwrite it. */
export const COOKIE_VOTER_SECURE = '__Host-dbd_voter';
/** CSRF double-submit cookie (readable by the admin UI). */
export const COOKIE_CSRF = 'dbd_csrf';
/** Header the admin UI echoes back for the CSRF double-submit check. */
export const CSRF_HEADER = 'x-csrf-token';
/** Header the API uses when calling our revalidation endpoint. */
export const REVALIDATE_HEADER = 'x-revalidate-secret';

export const ADMIN_SESSION_MAX_AGE_SECONDS = 60 * 60 * 72;

/** Number of stories per listing page. */
export const PAGE_SIZE = 12;

/** How long (seconds) an ISR page may be stale before it revalidates. */
export const REVALIDATE_SECONDS = 60;
