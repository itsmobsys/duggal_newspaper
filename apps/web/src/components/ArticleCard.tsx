import Link from 'next/link';
import type { ArticleListItem } from '@/lib/types';
import { formatDateShort, readingLabel } from '@/lib/format';
import { clampHeadline } from '@/lib/prose';
import { mediaSrc } from '@/lib/media';

type Variant = 'lead' | 'top' | 'standard' | 'compact';

export interface ArticleCardProps {
  article: ArticleListItem;
  variant?: Variant;
  showDek?: boolean;
  showMeta?: boolean;
  priority?: boolean;
  timeZone?: string;
}

function media(article: ArticleListItem, priority: boolean): React.ReactNode {
  const image = article.image;
  if (!image) {
    return (
      <span className="media-placeholder" aria-hidden="true">
        <span>{article.categoryName}</span>
      </span>
    );
  }
  return (
    // Deliberate: there is no image optimizer on the free tier, and every photo
    // carries stored width/height so the browser reserves space (no CLS).
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={mediaSrc(image.thumbUrl ?? image.url)}
      alt={image.alt ?? image.caption ?? article.headline}
      width={image.width ?? 1200}
      height={image.height ?? 675}
      loading={priority ? 'eager' : 'lazy'}
      decoding="async"
      fetchPriority={priority ? 'high' : 'auto'}
    />
  );
}

/**
 * The workhorse story card. All variants share the same semantic markup and
 * rely on CSS for the visual hierarchy, so the reading order is always
 * kicker → headline → dek → byline.
 */
export function ArticleCard({
  article,
  variant = 'standard',
  showDek = true,
  showMeta = true,
  priority = false,
  timeZone = 'Asia/Kolkata',
}: ArticleCardProps): React.JSX.Element {
  const headline = clampHeadline(article.headline);
  const showImage = variant !== 'compact' || Boolean(article.image);

  return (
    <article className={`card card--${variant}`}>
      {showImage ? (
        <Link
          className="card-media"
          href={`/article/${article.slug}`}
          tabIndex={-1}
          aria-hidden="true"
        >
          {media(article, priority)}
        </Link>
      ) : null}

      <div className="card-body">
        <p className="card-kicker">
          {article.breaking ? (
            <>
              <span>Breaking</span>
              <span className="sep">/</span>
            </>
          ) : null}
          <Link href={`/category/${article.categorySlug}`}>{article.categoryName}</Link>
        </p>

        <h3 className="card-headline">
          <Link href={`/article/${article.slug}`}>{headline}</Link>
        </h3>

        {showDek && article.dek && variant !== 'compact' ? (
          <p className="card-dek">{article.dek}</p>
        ) : null}

        {showMeta ? (
          <p className="card-meta">
            <span className="who">{article.authorDisplay}</span>
            <span className="dot" aria-hidden="true" />
            <span>{formatDateShort(article.publishedAt, timeZone)}</span>
            <span className="dot" aria-hidden="true" />
            <span>{readingLabel(article.readingMinutes)}</span>
          </p>
        ) : null}
      </div>
    </article>
  );
}
