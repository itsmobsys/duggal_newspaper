import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { LoginForm } from '@/components/admin/LoginForm';
import { getCurrentAdmin } from '@/lib/admin-server';
import { safeAdminNext } from '@/lib/admin-next';
import { getPublicSettings } from '@/lib/settings';
import styles from '@/components/admin/admin.module.css';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Sign in',
  robots: { index: false, follow: false, nocache: true },
};

interface LoginPageProps {
  searchParams: Promise<{ next?: string | string[] }>;
}

/**
 * The login screen lives in the `(auth)` group so it renders without the
 * console shell. The `next` target is whitelisted here and again in the client
 * component before navigation.
 */
export default async function AdminLoginPage({
  searchParams,
}: LoginPageProps): Promise<React.JSX.Element> {
  const query = await searchParams;
  const rawNext = Array.isArray(query.next) ? query.next[0] : query.next;
  const next = safeAdminNext(rawNext ?? '/admin');

  // Validate the cookie against the API rather than trusting its presence:
  // an expired cookie must show the form, not bounce back into the console.
  const admin = await getCurrentAdmin();
  if (admin) redirect(next);

  const settings = await getPublicSettings();

  return (
    <div className={styles.loginWrap}>
      <main className={styles.loginCard}>
        <p className={styles.loginKicker}>{settings.site.name}</p>
        <h1>Newsroom sign-in</h1>
        <p className={styles.loginIntro}>
          Sign in with your newsroom credentials to review submissions, publish stories and check
          the desk.
        </p>
        <LoginForm next={next} />
      </main>
    </div>
  );
}
