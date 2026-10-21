/**
 * Photos live on the Render API origin. Serving them through a same-origin
 * path lets Vercel's edge cache the immutable files, so most readers never
 * wait on a Render round trip (or a free-tier cold start).
 *
 * If the API origin is unknown, the stored absolute URL is used unchanged.
 */
const API_BASE_URL = (process.env.API_BASE_URL ?? '').replace(/\/$/, '');

export function mediaSrc(url: string | null | undefined): string {
  if (!url) return '';
  if (!API_BASE_URL) return url;

  try {
    const parsed = new URL(url);
    const api = new URL(API_BASE_URL);
    if (parsed.origin !== api.origin) return url;
    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return url;
  }
}
