'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { hasSessionHint } from '@/lib/session-hint';
import type { SessionUser } from '@/lib/user';
import styles from './AccountMenu.module.css';

/**
 * The account corner of the masthead. Rendered on the client so a reader's
 * session never turns an otherwise static front page into a dynamic render.
 */
export function AccountMenu(): React.JSX.Element | null {
  const [user, setUser] = useState<SessionUser | null | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    if (!hasSessionHint()) {
      setUser(null);
      return;
    }
    fetch('/api/auth/me', { cache: 'no-store' })
      .then((response) => (response.ok ? response.json() : null))
      .then((data: { user: SessionUser | null } | null) => {
        if (!cancelled) setUser(data?.user ?? null);
      })
      .catch(() => {
        if (!cancelled) setUser(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (user === undefined) {
    return <span className={styles.placeholder} aria-hidden="true" />;
  }

  if (!user) {
    return (
      <a className={styles.login} href="/api/auth/discord">
        Login with Discord
      </a>
    );
  }

  return (
    <span className={styles.account}>
      {user.avatarUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img className={styles.avatar} src={user.avatarUrl} alt="" width={20} height={20} />
      ) : (
        <span className={styles.avatar} aria-hidden="true" />
      )}
      <Link className={styles.name} href="/submit" title={`Signed in as @${user.username}`}>
        {user.displayName}
      </Link>
      <form action="/api/auth/logout" method="post">
        <button className={styles.logout} type="submit">
          Log out
        </button>
      </form>
    </span>
  );
}
