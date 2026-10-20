import Link from 'next/link';

export interface SectionHeadingProps {
  title: string;
  href?: string;
  linkLabel?: string;
  id?: string;
}

export function SectionHeading({
  title,
  href,
  linkLabel = 'See all',
  id,
}: SectionHeadingProps): React.JSX.Element {
  return (
    <div className="section-head">
      <h2 id={id}>{title}</h2>
      {href ? <Link href={href}>{linkLabel}</Link> : null}
    </div>
  );
}
