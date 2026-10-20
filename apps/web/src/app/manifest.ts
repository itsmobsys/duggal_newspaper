import type { MetadataRoute } from 'next';
import { SITE_DESCRIPTION_FALLBACK, SITE_NAME_FALLBACK } from '@/lib/constants';

/**
 * Installable-web-app manifest. Static on purpose: the name and palette are
 * part of the brand, and a manifest that hits the database on every request
 * would be a needless dependency for phones that just want an icon.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: SITE_NAME_FALLBACK,
    short_name: 'Duggal Badmosh',
    description: SITE_DESCRIPTION_FALLBACK,
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: '#f7f2e7',
    theme_color: '#17130e',
    icons: [{ src: '/icon.svg', sizes: 'any', type: 'image/svg+xml' }],
    categories: ['news'],
    lang: 'en-IN',
    dir: 'ltr',
  };
}
