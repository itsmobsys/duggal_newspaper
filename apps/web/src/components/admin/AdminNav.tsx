'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const LINKS: Array<{ href: string; label: string; exact?: boolean }> = [
  { href: '/admin', label: 'Overview', exact: true },
  { href: '/admin/publish', label: 'Build now' },
  { href: '/admin/submissions', label: 'Submissions' },
  { href: '/admin/articles', label: 'Articles' },
  { href: '/admin/jobs', label: 'Jobs' },
  { href: '/admin/editions', label: 'Editions' },
  { href: '/admin/awards', label: 'Awards' },
  { href: '/admin/reports', label: 'Reports' },
  { href: '/admin/corrections', label: 'Corrections' },
  { href: '/admin/categories', label: 'Categories' },
  { href: '/admin/settings', label: 'Settings' },
  { href: '/admin/diagnostics', label: 'Diagnostics' },
  { href: '/admin/audit', label: 'Audit log' },
];

export function AdminNav(): React.JSX.Element {
  const pathname = usePathname() ?? '/admin';

  return (
    <nav aria-label="Admin sections">
      <ul className="admin-nav">
        {LINKS.map((link) => {
          const active = link.exact ? pathname === link.href : pathname.startsWith(link.href);
          return (
            <li key={link.href}>
              <Link href={link.href} aria-current={active ? 'page' : undefined}>
                {link.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
