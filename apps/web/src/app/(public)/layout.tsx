import { Masthead } from '@/components/Masthead';
import { SiteFooter } from '@/components/SiteFooter';
import { BreakingTicker } from '@/components/BreakingTicker';
import { todayIn } from '@/lib/format';
import { getCategories, listBreaking } from '@/lib/queries';
import { getPublicSettings } from '@/lib/settings';

export const revalidate = 60;

/**
 * Public shell: dateline + wordmark + sections + ticker, then the page, then the
 * footer. Only the pages themselves decide their own caching, but the shell
 * reads live settings so the masthead can never drift from the admin console.
 */
export default async function PublicLayout({
  children,
}: Readonly<{ children: React.ReactNode }>): Promise<React.JSX.Element> {
  const settings = await getPublicSettings();
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
