import type { Metadata, Viewport } from 'next';
import './globals.css';
import { getPublicSettings, siteUrl } from '@/lib/settings';

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
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
