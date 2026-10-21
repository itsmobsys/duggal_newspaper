'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  THEME_STORAGE_KEY,
  nextThemeMode,
  parseThemeMode,
  resolveTheme,
  themeButtonLabel,
  type ThemeMode,
} from '@/lib/theme';

const DARK_QUERY = '(prefers-color-scheme: dark)';

/**
 * Cycles system → light → dark and remembers the choice. The class is applied
 * to <html> by the inline script in layout.tsx before first paint, so the page
 * never flashes the wrong palette; this component only re-applies it on click.
 */
export function ThemeToggle(): React.JSX.Element {
  const [mode, setMode] = useState<ThemeMode>('system');
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setMode(parseThemeMode(window.localStorage.getItem(THEME_STORAGE_KEY)));
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready) return;
    const media = window.matchMedia(DARK_QUERY);
    const apply = (): void => {
      const resolved = resolveTheme(mode, media.matches);
      const root = document.documentElement;
      root.dataset.theme = resolved;
      root.dataset.themeMode = mode;
      const color = resolved === 'dark' ? '#14110d' : '#f7f2e7';
      document
        .querySelectorAll('meta[name="theme-color"]')
        .forEach((meta) => meta.setAttribute('content', color));
    };
    apply();
    if (mode !== 'system') return;
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, [mode, ready]);

  const cycle = useCallback(() => {
    setMode((current) => {
      const next = nextThemeMode(current);
      try {
        window.localStorage.setItem(THEME_STORAGE_KEY, next);
      } catch {
        // Private mode or blocked storage: the choice still applies for this page.
      }
      return next;
    });
  }, []);

  const label = themeButtonLabel(mode);

  return (
    <button
      type="button"
      className="theme-toggle"
      data-mode={mode}
      onClick={cycle}
      aria-label={label}
      title={label}
    >
      <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true" focusable="false">
        {mode === 'light' && (
          <>
            <circle cx="8" cy="8" r="3.1" fill="currentColor" />
            <g stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
              <path d="M8 1.2v1.7M8 13.1v1.7M1.2 8h1.7M13.1 8h1.7" />
              <path d="M3.2 3.2l1.2 1.2M11.6 11.6l1.2 1.2M12.8 3.2l-1.2 1.2M4.4 11.6l-1.2 1.2" />
            </g>
          </>
        )}
        {mode === 'dark' && (
          <path d="M13.3 9.7A5.6 5.6 0 0 1 6.3 2.7a5.6 5.6 0 1 0 7 7Z" fill="currentColor" />
        )}
        {mode === 'system' && (
          <>
            <circle cx="8" cy="8" r="5.4" fill="none" stroke="currentColor" strokeWidth="1.4" />
            <path d="M8 2.6a5.4 5.4 0 0 1 0 10.8Z" fill="currentColor" />
          </>
        )}
      </svg>
    </button>
  );
}
