import type { Metadata } from 'next';
import Link from 'next/link';
import { AdminNav } from '@/components/admin/AdminNav';
import { LogoutButton } from '@/components/admin/LogoutButton';
import { getCurrentAdmin } from '@/lib/admin-server';
import { getPublicSettings } from '@/lib/settings';
import styles from '@/components/admin/admin.module.css';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: { default: 'Newsroom console', template: '%s · Newsroom console' },
  robots: { index: false, follow: false, nocache: true },
};

/**
 * Console shell. The sidebar is rendered through `AdminNav` (a client
 * component so it can mark the current section with aria-current), while the
 * signed-in operator comes from the API — the cookie alone proves nothing.
 */
export default async function AdminLayout({
  children,
}: Readonly<{ children: React.ReactNode }>): Promise<React.JSX.Element> {
  const [admin, settings] = await Promise.all([getCurrentAdmin(), getPublicSettings()]);

  return (
    <>
      <a className="skip-link" href="#main">
        Skip to console content
      </a>
      <div className="admin-shell">
        <header className="admin-topbar">
          <div>
            <Link className="brandline" href="/admin">
              {settings.site.name}
            </Link>
            <span className={styles.consoleLabel}>Console</span>
          </div>
          <div className={styles.topbarActions}>
            <Link className={styles.topbarLink} href="/" target="_blank" rel="noopener noreferrer">
              View site ↗
            </Link>
            <span className={styles.whoami}>
              {admin ? `${admin.name || admin.email} · ${admin.role}` : 'Session active'}
            </span>
            <LogoutButton />
          </div>
        </header>

        <aside className="admin-sidebar" aria-label="Console sections">
          <AdminNav />
        </aside>

        <main id="main" className="admin-main" tabIndex={-1}>
          {children}
        </main>
      </div>
    </>
  );
}
