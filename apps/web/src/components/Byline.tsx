import { formatDateTime, readingLabel } from '@/lib/format';

export interface BylineProps {
  author: string;
  publishedAt: string | null;
  readingMinutes: number;
  timeZone?: string;
  editionDate?: string;
}

export function Byline({
  author,
  publishedAt,
  readingMinutes,
  timeZone = 'Asia/Kolkata',
  editionDate,
}: BylineProps): React.JSX.Element {
  return (
    <p className="byline">
      <span>
        By <span className="author">{author}</span>
      </span>
      <span aria-hidden="true">·</span>
      <time dateTime={publishedAt ?? undefined}>{formatDateTime(publishedAt, timeZone)}</time>
      <span aria-hidden="true">·</span>
      <span>{readingLabel(readingMinutes)}</span>
      {editionDate ? (
        <>
          <span aria-hidden="true">·</span>
          <span>Edition {editionDate}</span>
        </>
      ) : null}
    </p>
  );
}
