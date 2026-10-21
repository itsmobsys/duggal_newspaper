export type ThemeMode = 'system' | 'light' | 'dark';
export type ResolvedTheme = 'light' | 'dark';

/** localStorage key shared by the toggle and the no-flash script in layout.tsx. */
export const THEME_STORAGE_KEY = 'dbd-theme';

export const THEME_ORDER: readonly ThemeMode[] = ['system', 'light', 'dark'];

const MODE_LABEL: Record<ThemeMode, string> = {
  system: 'follow this device',
  light: 'light',
  dark: 'dark',
};

const NEXT_LABEL: Record<ThemeMode, string> = {
  system: 'light',
  light: 'dark',
  dark: 'follow this device',
};

/** Anything that is not a stored light/dark choice means "follow the device". */
export function parseThemeMode(value: string | null | undefined): ThemeMode {
  return value === 'light' || value === 'dark' ? value : 'system';
}

/** system → light → dark → system. */
export function nextThemeMode(mode: ThemeMode): ThemeMode {
  const index = THEME_ORDER.indexOf(mode);
  return THEME_ORDER[(index + 1) % THEME_ORDER.length] ?? 'system';
}

export function resolveTheme(mode: ThemeMode, systemPrefersDark: boolean): ResolvedTheme {
  if (mode === 'system') return systemPrefersDark ? 'dark' : 'light';
  return mode;
}

export function themeButtonLabel(mode: ThemeMode): string {
  return `Theme: ${MODE_LABEL[mode]}. Switch to ${NEXT_LABEL[mode]}.`;
}
