import Link from 'next/link';

export interface EmptyStateProps {
  title: string;
  message: string;
  actionHref?: string;
  actionLabel?: string;
}

export function EmptyState({
  title,
  message,
  actionHref,
  actionLabel,
}: EmptyStateProps): React.JSX.Element {
  return (
    <div className="empty-state">
      <h2>{title}</h2>
      <p>{message}</p>
      {actionHref && actionLabel ? (
        <p style={{ marginTop: '1rem' }}>
          <Link className="button" href={actionHref}>
            {actionLabel}
          </Link>
        </p>
      ) : null}
    </div>
  );
}
