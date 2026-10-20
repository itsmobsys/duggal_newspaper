export interface SiteSearchProps {
  action?: string;
  defaultValue?: string;
  label?: string;
  placeholder?: string;
  compact?: boolean;
}

/** Plain GET form: search works with JavaScript disabled and is linkable. */
export function SiteSearch({
  action = '/search',
  defaultValue = '',
  label = 'Search the paper',
  placeholder = 'Search headlines, stories and tags…',
  compact = false,
}: SiteSearchProps): React.JSX.Element {
  return (
    <form action={action} method="get" role="search" className="stack" style={{ gap: 6 }}>
      <label className="field-label" htmlFor="site-search-input">
        {label}
      </label>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <input
          id="site-search-input"
          className="input"
          type="search"
          name="q"
          defaultValue={defaultValue}
          placeholder={placeholder}
          maxLength={120}
          style={{ flex: '1 1 220px' }}
        />
        <button className={compact ? 'button button--sm' : 'button'} type="submit">
          Search
        </button>
      </div>
    </form>
  );
}
