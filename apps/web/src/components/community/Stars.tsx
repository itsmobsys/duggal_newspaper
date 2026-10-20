import styles from './community.module.css';

export interface StarsProps {
  value: number;
  /** Optional compact size for dense list rows. */
  compact?: boolean;
  /** Hide the accessible label when a parent already describes the rating. */
  label?: string;
}

/** Static star display. Interactive stars live inside the review form. */
export function Stars({ value, compact = false, label }: StarsProps): React.JSX.Element {
  const filled = Math.max(0, Math.min(5, Math.round(value)));
  const text = label ?? `${value.toFixed(1)} out of 5 stars`;
  return (
    <span
      className={`${styles.stars} ${compact ? styles.starsCompact : ''}`}
      role="img"
      aria-label={text}
    >
      {[1, 2, 3, 4, 5].map((star) => (
        <span
          key={star}
          className={star <= filled ? styles.starOn : styles.starOff}
          aria-hidden="true"
        >
          ★
        </span>
      ))}
    </span>
  );
}
