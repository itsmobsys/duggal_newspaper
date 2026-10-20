import Link from 'next/link';
import { formatDate, weekdayFor } from '@/lib/format';
import type { CategoryView, PublicSettings } from '@/lib/types';

export interface MastheadProps {
  settings: PublicSettings;
  categories: CategoryView[];
  editionDate: string;
}

/**
 * The front page furniture: dateline, wordmark, section nav. Deliberately a
 * server component — there is no interactivity beyond links, so it ships zero
 * JavaScript.
 */
export function Masthead({ settings, categories, editionDate }: MastheadProps): React.JSX.Element {
  return (
    <header className="masthead">
      <div className="container masthead-bar">
        <div className="masthead-meta">
          <span>
            {weekdayFor(editionDate, settings.site.timezone)},{' '}
            {formatDate(`${editionDate}T12:00:00Z`, settings.site.timezone)}
          </span>
          <span className="dot" aria-hidden="true" />
          <span>Autonomous edition</span>
        </div>
        <div className="masthead-meta">
          <Link href="/submit">Submit a story</Link>
          <span className="dot" aria-hidden="true" />
          <Link href="/status">Track submission</Link>
        </div>
      </div>

      <div className="container">
        <Link className="brand" href="/" aria-label={`${settings.site.name} — front page`}>
          <span className="brand-title">
            Duggal <em>Badmosh</em> Daily
          </span>
          <span className="brand-tagline">{settings.site.tagline}</span>
        </Link>
      </div>

      <nav className="site-nav" aria-label="Sections">
        <div className="container">
          <ul>
            <li>
              <Link className="nav-link" href="/">
                Front Page
              </Link>
            </li>
            {categories.map((category) => (
              <li key={category.slug}>
                <Link className="nav-link" href={`/category/${category.slug}`}>
                  {category.name}
                </Link>
              </li>
            ))}
            <li>
              <Link className="nav-link" href="/latest">
                Latest
              </Link>
            </li>
            <li>
              <Link className="nav-link" href="/editions">
                Editions
              </Link>
            </li>
            <li>
              <Link className="nav-link" href="/awards">
                Awards
              </Link>
            </li>
            <li>
              <Link className="nav-link" href="/photos">
                Photos
              </Link>
            </li>
            <li>
              <Link className="nav-link" href="/archive">
                Archive
              </Link>
            </li>
            <li>
              <Link className="nav-link nav-link--submit" href="/submit">
                Submit
              </Link>
            </li>
          </ul>
        </div>
      </nav>
    </header>
  );
}
