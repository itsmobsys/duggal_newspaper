/**
 * Whitelist for post-login navigation. Shared by the server login page and the
 * client form, and deliberately free of React so it can live in both worlds.
 */
export function safeAdminNext(raw: string): string {
  if (!raw.startsWith('/admin')) return '/admin';
  if (raw.startsWith('//') || raw.includes('\\')) return '/admin';
  if (raw === '/admin/login' || raw.startsWith('/admin/login?')) return '/admin';
  return raw.slice(0, 500);
}
