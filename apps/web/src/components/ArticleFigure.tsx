import type { ArticleImageView } from '@/lib/types';

export interface ArticleFigureProps {
  image: ArticleImageView;
  priority?: boolean;
  className?: string;
}

export function ArticleFigure({
  image,
  priority = false,
  className,
}: ArticleFigureProps): React.JSX.Element {
  const alt = image.alt ?? image.caption ?? 'Photograph submitted with the story.';
  return (
    <figure className={`media-frame ${className ?? ''}`.trim()}>
      {/* Deliberate: no optimizer on the free tier; dimensions are stored. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={image.url}
        alt={alt}
        width={image.width ?? 1200}
        height={image.height ?? 800}
        loading={priority ? 'eager' : 'lazy'}
        decoding="async"
        fetchPriority={priority ? 'high' : 'auto'}
      />
      {image.caption || image.attribution ? (
        <figcaption>
          {image.caption}
          {image.attribution ? <span className="credit">{image.attribution}</span> : null}
        </figcaption>
      ) : null}
    </figure>
  );
}
