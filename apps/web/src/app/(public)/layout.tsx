import type { Metadata } from 'next';
import { Masthead } from '@/components/Masthead';
import { SiteFooter } from '@/components/SiteFooter';
import { BreakingTicker } from '@/components/BreakingTicker';
import { NukeNotice } from '@/components/NukeNotice';
import { todayIn } from '@/lib/format';
import { getCategories, listBreaking } from '@/lib/queries';
import { getPublicSettings } from '@/lib/settings';

export const revalidate = 60;

/**
 * While the site is taken down the notice is the only public page, so it must
 * never be indexed or cached as if it were the front page.
 */
export async function generateMetadata(): Promise<Metadata> {
  const settings = await getPublicSettings();
  if (!settings.site.nuke) return {};
  return {
    title: 'Website down',
    description: 'Website down because something happened. Check Discord for website news.',
    robots: { index: false, follow: false },
  };
}

/**
 * Public shell: dateline + wordmark + sections + ticker, then the page, then the
 * footer. Only the pages themselves decide their own caching, but the shell
 * reads live settings so the masthead can never drift from the admin console.
 *
 * This is also the single takedown guard: when `site.nuke` is on, every public
 * page is replaced by the notice before any content is fetched. The console
 * lives in the separate (admin) layout and stays fully usable.
 */
export default async function PublicLayout({
  children,
}: Readonly<{ children: React.ReactNode }>): Promise<React.JSX.Element> {
  const settings = await getPublicSettings();

  if (settings.site.nuke) {
    return <NukeNotice discord={settings.site.contactDiscord} />;
  }

  const [categories, breaking] = await Promise.all([
    getCategories(),
    listBreaking(Math.max(settings.appearance.tickerCount, 1)),
  ]);

  return (
    <>
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <Masthead
        settings={settings}
        categories={categories}
        editionDate={todayIn(settings.site.timezone)}
      />
      <BreakingTicker items={breaking} />
      <main id="main-content" tabIndex={-1}>
        {children}
      </main>
      <SiteFooter settings={settings} categories={categories} />
    </>
  );
}
