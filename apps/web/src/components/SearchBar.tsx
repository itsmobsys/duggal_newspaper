'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useId, useRef, useState } from 'react';
import {
  SEARCH_MAX_LENGTH,
  isSearchable,
  normaliseSearchQuery,
  searchHref,
  type SearchPayload,
} from '@/lib/search';

const DEBOUNCE_MS = 200;
const CACHE_SIZE = 24;
const RESULT_LIMIT = 6;

type Status = 'idle' | 'loading' | 'ready' | 'error';

function highlight(text: string, query: string): React.ReactNode {
  const index = text.toLowerCase().indexOf(query.toLowerCase());
  if (index < 0 || !query) return text;
  return (
    <>
      {text.slice(0, index)}
      <mark>{text.slice(index, index + query.length)}</mark>
      {text.slice(index + query.length)}
    </>
  );
}

/**
 * The masthead search. Results come from `/api/search`, which reads every
 * published article in one query — the bar keeps its own cache and debounces,
 * so typing a six-letter word costs one request, not six.
 */
export function SearchBar({ defaultValue = '' }: { defaultValue?: string }): React.JSX.Element {
  const router = useRouter();
  const inputId = useId();
  const listId = `${inputId}-results`;
  const [query, setQuery] = useState(defaultValue);
  const [payload, setPayload] = useState<SearchPayload | null>(null);
  const [status, setStatus] = useState<Status>('idle');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const cacheRef = useRef(new Map<string, SearchPayload>());
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const cleaned = normaliseSearchQuery(query);
  const searchable = isSearchable(cleaned);
  const results = payload?.results ?? [];
  const showPanel = open && cleaned.length > 0;

  useEffect(() => {
    if (!searchable) {
      setStatus('idle');
      setPayload(null);
      setActive(-1);
      return;
    }

    const cached = cacheRef.current.get(cleaned);
    if (cached) {
      setPayload(cached);
      setStatus('ready');
      setActive(-1);
      return;
    }

    const controller = new AbortController();
    setStatus('loading');

    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch(
          `/api/search?q=${encodeURIComponent(cleaned)}&limit=${RESULT_LIMIT}`,
          { signal: controller.signal, headers: { accept: 'application/json' } },
        );
        if (!response.ok) throw new Error(`search failed: ${response.status}`);
        const next = (await response.json()) as SearchPayload;
        if (controller.signal.aborted) return;

        const cache = cacheRef.current;
        cache.set(cleaned, next);
        if (cache.size > CACHE_SIZE) {
          const oldest = cache.keys().next().value;
          if (oldest) cache.delete(oldest);
        }
        setPayload(next);
        setStatus('ready');
        setActive(-1);
      } catch {
        if (controller.signal.aborted) return;
        setStatus('error');
        setPayload({ query: cleaned, results: [], hasMore: false });
        setActive(-1);
      }
    }, DEBOUNCE_MS);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [cleaned, searchable]);

  useEffect(() => {
    function onPointerDown(event: PointerEvent): void {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, []);

  function go(href: string): void {
    setOpen(false);
    setActive(-1);
    router.push(href);
  }

  function clear(): void {
    setQuery('');
    setPayload(null);
    setStatus('idle');
    setOpen(false);
    setActive(-1);
    inputRef.current?.focus();
  }

  function onSubmit(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const picked = active >= 0 ? results[active] : undefined;
    if (picked) {
      go(`/article/${picked.slug}`);
      return;
    }
    go(searchHref(cleaned));
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>): void {
    if (event.key === 'Escape') {
      setOpen(false);
      setActive(-1);
      return;
    }
    if (event.key === 'ArrowDown') {
      if (!results.length) return;
      event.preventDefault();
      setOpen(true);
      setActive((current) => (current + 1) % results.length);
      return;
    }
    if (event.key === 'ArrowUp') {
      if (!results.length) return;
      event.preventDefault();
      setOpen(true);
      setActive((current) => (current <= 0 ? results.length - 1 : current - 1));
    }
  }

  const statusText = !cleaned
    ? ''
    : !searchable
      ? 'Type at least two characters to search.'
      : status === 'loading'
        ? 'Searching the archive.'
        : status === 'error'
          ? 'Search is unavailable right now.'
          : status === 'ready'
            ? `${results.length}${payload?.hasMore ? ' or more' : ''} result${
                results.length === 1 ? '' : 's'
              } for ${cleaned}.`
            : '';

  return (
    <div className="search-bar" ref={rootRef}>
      <form
        action="/search"
        className="search-bar-form"
        method="get"
        onSubmit={onSubmit}
        role="search"
      >
        <label className="visually-hidden" htmlFor={inputId}>
          Search the paper
        </label>
        <span aria-hidden="true" className="search-bar-icon">
          ⌕
        </span>
        <input
          aria-activedescendant={active >= 0 ? `${inputId}-hit-${active}` : undefined}
          aria-autocomplete="list"
          aria-controls={listId}
          aria-expanded={showPanel}
          autoComplete="off"
          className="search-bar-input"
          id={inputId}
          maxLength={SEARCH_MAX_LENGTH}
          name="q"
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
          }}
          onFocus={() => {
            if (cleaned) setOpen(true);
          }}
          onKeyDown={onKeyDown}
          placeholder="Search headlines, stories, tags…"
          ref={inputRef}
          role="combobox"
          type="search"
          value={query}
        />
        {query ? (
          <button
            aria-label="Clear search"
            className="search-bar-clear"
            onClick={clear}
            type="button"
          >
            ×
          </button>
        ) : null}
        <button className="button button--sm search-bar-submit" type="submit">
          Search
        </button>
      </form>

      {showPanel ? (
        <div
          aria-busy={status === 'loading'}
          aria-label="Search results"
          className="search-bar-panel"
          id={listId}
          role="listbox"
        >
          {results.length > 0 ? (
            <>
              <ul className="search-bar-list">
                {results.map((hit, index) => (
                  <li
                    aria-selected={index === active}
                    className="search-bar-option"
                    id={`${inputId}-hit-${index}`}
                    key={hit.slug}
                    onMouseEnter={() => setActive(index)}
                    role="option"
                  >
                    <Link
                      href={`/article/${hit.slug}`}
                      onClick={() => setOpen(false)}
                      tabIndex={-1}
                    >
                      <span className="search-bar-kicker">
                        <b>{hit.categoryName}</b>
                        {hit.readingMinutes ? <span>{hit.readingMinutes} min</span> : null}
                      </span>
                      <span className="search-bar-headline">
                        {highlight(hit.headline, cleaned)}
                      </span>
                      {hit.snippet ? (
                        <span className="search-bar-snippet">{hit.snippet}</span>
                      ) : null}
                    </Link>
                  </li>
                ))}
              </ul>
              <Link
                className="search-bar-all"
                href={searchHref(cleaned)}
                onClick={() => setOpen(false)}
              >
                {payload?.hasMore ? 'More in the archive' : 'Search the archive'} for “{cleaned}” →
              </Link>
            </>
          ) : !searchable ? (
            <p className="search-bar-note">
              Keep typing — the morgue needs at least <strong>two letters</strong>.
            </p>
          ) : status === 'loading' ? (
            <p className="search-bar-note">Digging through the morgue…</p>
          ) : status === 'error' ? (
            <p className="search-bar-note">
              Search is taking a smoke break. Hit <strong>Enter</strong> to try the old archive.
            </p>
          ) : (
            <>
              <p className="search-bar-note">
                <strong>Nothing in the morgue</strong> for “{cleaned}”. Try a shorter word, a
                player&apos;s name, or a section like “bakloli”.
              </p>
              <Link className="search-bar-all" href="/search" onClick={() => setOpen(false)}>
                Browse the whole archive →
              </Link>
            </>
          )}
        </div>
      ) : null}

      <p aria-live="polite" className="visually-hidden" role="status">
        {statusText}
      </p>
    </div>
  );
}
