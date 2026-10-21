import { describe, expect, it } from 'vitest';
import {
  nextThemeMode,
  parseThemeMode,
  resolveTheme,
  themeButtonLabel,
  type ThemeMode,
} from '../src/lib/theme';

describe('parseThemeMode', () => {
  it('reads stored choices', () => {
    expect(parseThemeMode('light')).toBe('light');
    expect(parseThemeMode('dark')).toBe('dark');
  });

  it('falls back to following the device', () => {
    expect(parseThemeMode(null)).toBe('system');
    expect(parseThemeMode(undefined)).toBe('system');
    expect(parseThemeMode('DARK')).toBe('system');
    expect(parseThemeMode('sepia')).toBe('system');
  });
});

describe('nextThemeMode', () => {
  it('cycles system, light, dark and back', () => {
    expect(nextThemeMode('system')).toBe('light');
    expect(nextThemeMode('light')).toBe('dark');
    expect(nextThemeMode('dark')).toBe('system');
  });
});

describe('resolveTheme', () => {
  it('follows the device in system mode', () => {
    expect(resolveTheme('system', true)).toBe('dark');
    expect(resolveTheme('system', false)).toBe('light');
  });

  it('ignores the device once a choice is made', () => {
    expect(resolveTheme('light', true)).toBe('light');
    expect(resolveTheme('dark', false)).toBe('dark');
  });
});

describe('themeButtonLabel', () => {
  it('names the current mode and the next one', () => {
    const modes: ThemeMode[] = ['system', 'light', 'dark'];
    for (const mode of modes) {
      const label = themeButtonLabel(mode);
      expect(label).toContain('Theme:');
      expect(label).toContain(`Switch to ${themeButtonLabelTarget(mode)}`);
    }
  });
});

function themeButtonLabelTarget(mode: ThemeMode): string {
  return mode === 'system' ? 'light' : mode === 'light' ? 'dark' : 'follow this device';
}
