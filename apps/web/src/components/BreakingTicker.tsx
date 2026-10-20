import Link from 'next/link';
import type { ArticleListItem } from '@/lib/types';

export interface BreakingTickerProps {
  items: ArticleListItem[];
}

/** Red news bar. Scrolls horizontally on phones instead of wrapping. */
export function BreakingTicker({ items }: BreakingTickerProps): React.JSX.Element | null {
  if (items.length === 0) return null;

  return (
    <div className="ticker" role="region" aria-label="Breaking news">
      <p className="ticker-label">
        <span className="pulse" aria-hidden="true" />
        Breaking
      </p>
      <div className="ticker-track">
        {items.map((item) => (
          <Link key={item.id} className="ticker-item" href={`/article/${item.slug}`}>
            {item.headline}
          </Link>
        ))}
      </div>
    </div>
  );
}
