import Link from 'next/link';
import type { CategoryView, PublicSettings } from '@/lib/types';
import { GitHubLink } from './GitHubLink';

export interface SiteFooterProps {
  settings: PublicSettings;
  categories: CategoryView[];
}

export function SiteFooter({ settings, categories }: SiteFooterProps): React.JSX.Element {
  return (
    <footer className="site-footer">
      <div className="container footer-grid">
        <div className="footer-brand">
          <span className="brand-title">
            Duggal <em>Badmosh</em> Daily
          </span>
          <p>{settings.site.description}</p>
          <p style={{ marginTop: '0.75rem', display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            <Link className="button button--primary" href="/submit">
              Send a story
            </Link>
            <GitHubLink className="github-link--footer" />
          </p>
        </div>

        <div className="footer-links">
          <div>
            <h3>Sections</h3>
            <ul>
              {categories.slice(0, 6).map((category) => (
                <li key={category.slug}>
                  <Link href={`/category/${category.slug}`}>{category.name}</Link>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h3>The Paper</h3>
            <ul>
              <li>
                <Link href="/latest">Latest stories</Link>
              </li>
              {settings.community.leaderboardEnabled ? (
                <li>
                  <Link href="/leaderboard">Weekly leaderboard</Link>
                </li>
              ) : null}
              <li>
                <Link href="/editions">Daily editions</Link>
              </li>
              <li>
                <Link href="/archive">Archive</Link>
              </li>
              <li>
                <Link href="/awards">Community awards</Link>
              </li>
              <li>
                <Link href="/photos">Photo desk</Link>
              </li>
            </ul>
          </div>
          <div>
            <h3>Newsroom</h3>
            <ul>
              <li>
                <Link href="/about">About this paper</Link>
              </li>
              <li>
                <Link href="/standards">Standards &amp; corrections</Link>
              </li>
              <li>
                <Link href="/submit">Submit a story</Link>
              </li>
              <li>
                <Link href="/status">Track a submission</Link>
              </li>
              <li>
                <Link href="/search">Search</Link>
              </li>
            </ul>
          </div>
          <div>
            <h3>Feeds</h3>
            <ul>
              <li>
                <Link href="/rss.xml">RSS</Link>
              </li>
              <li>
                <Link href="/sitemap.xml">Sitemap</Link>
              </li>
              <li>
                <a href="/robots.txt">Robots</a>
              </li>
              <li>
                <Link href="/admin">Admin</Link>
              </li>
            </ul>
          </div>
        </div>
      </div>

      <div className="container footer-bottom">
        <span>
          © {new Date().getFullYear()} {settings.site.name}
        </span>
        <span>Written by a robot. Funded by nobody. Powered by Nemotron.</span>
        <span>No facts were invented in the making of this newspaper.</span>
      </div>
    </footer>
  );
}
