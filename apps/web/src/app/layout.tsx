import type { Metadata, Viewport } from 'next';
import './globals.css';
import { getPublicSettings, siteUrl } from '@/lib/settings';

/**
 * Applies the stored theme before first paint so the wrong palette never
 * flashes. Deliberately tiny and inline; keep in sync with lib/theme.ts.
 */
const THEME_BOOTSTRAP = `(function(){try{var m=localStorage.getItem('dbd-theme');if(m!=='light'&&m!=='dark')m='system';var d=window.matchMedia('(prefers-color-scheme: dark)').matches;var r=document.documentElement;r.dataset.theme=m==='system'?(d?'dark':'light'):m;r.dataset.themeMode=m;}catch(e){}})();`;

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f7f2e7' },
    { media: '(prefers-color-scheme: dark)', color: '#14110d' },
  ],
};

export async function generateMetadata(): Promise<Metadata> {
  const settings = await getPublicSettings();
  const base = siteUrl(settings);
  return {
    metadataBase: new URL(base),
    title: {
      default: settings.site.name,
      template: `%s · ${settings.site.name}`,
    },
    description: settings.site.description,
    applicationName: settings.site.name,
    generator: 'Next.js',
    referrer: 'strict-origin-when-cross-origin',
    openGraph: {
      type: 'website',
      siteName: settings.site.name,
      title: settings.site.name,
      description: settings.site.description,
      url: base,
      locale: 'en_IN',
    },
    twitter: {
      card: 'summary_large_image',
      title: settings.site.name,
      description: settings.site.description,
    },
    robots: {
      index: true,
      follow: true,
      googleBot: { index: true, follow: true, 'max-image-preview': 'large' },
    },
    formatDetection: { telephone: false, email: false, address: false },
  };
}

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>): React.JSX.Element {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Preload the display and body faces the first screen needs. */}
        <link
          rel="preload"
          href="/fonts/sourceserif-normal-400.woff2"
          as="font"
          type="font/woff2"
          crossOrigin="anonymous"
        />
        <link
          rel="preload"
          href="/fonts/playfair-normal-700-900.woff2"
          as="font"
          type="font/woff2"
          crossOrigin="anonymous"
        />
        {/* Applies a stored theme before paint, so the palette never flashes. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
