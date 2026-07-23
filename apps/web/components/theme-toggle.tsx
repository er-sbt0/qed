'use client';

import { useEffect, useState, type ReactNode } from 'react';

/**
 * Theme selector: light ↔ dark.
 *
 * The choice is persisted in localStorage under `math-ai-theme`; the pre-paint
 * script in layout.tsx reads it back on the next load.
 *
 * Mounted with state "light" (no DOM read during render, so no hydration
 * mismatch) and synced from the actual attribute once on mount — the same
 * ordering as the pre-paint script, which may have set it before hydration.
 */
type ThemeMode = 'light' | 'dark';

const STORAGE_KEY = 'math-ai-theme';
const ORDER: readonly ThemeMode[] = ['light', 'dark'];

/**
 * Inline SVGs, not text glyphs: ☀/☾ fall back to the platform emoji font
 * in some browsers, which ignores CSS `color` and renders a muddy blob at
 * 13px. `currentColor` keeps them in the accent.
 */
const GLYPH: Record<ThemeMode, ReactNode> = {
  light: (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="8" cy="8" r="3.2" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <g stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
        <line x1="13.2" y1="8" x2="14.7" y2="8" />
        <line x1="11.68" y1="11.68" x2="12.74" y2="12.74" />
        <line x1="8" y1="13.2" x2="8" y2="14.7" />
        <line x1="4.32" y1="11.68" x2="3.26" y2="12.74" />
        <line x1="2.8" y1="8" x2="1.3" y2="8" />
        <line x1="4.32" y1="4.32" x2="3.26" y2="3.26" />
        <line x1="8" y1="2.8" x2="8" y2="1.3" />
        <line x1="11.68" y1="4.32" x2="12.74" y2="3.26" />
      </g>
    </svg>
  ),
  dark: (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M14 8.53 A6 6 0 1 1 7.47 2 A4.67 4.67 0 0 0 14 8.53 Z" fill="currentColor" />
    </svg>
  ),
};

const LABEL: Record<ThemeMode, string> = {
  light: 'Light',
  dark: 'Dark',
};

export function ThemeToggle() {
  const [mode, setMode] = useState<ThemeMode>('light');

  useEffect(() => {
    const t = document.documentElement.dataset.theme;
    setMode(t === 'dark' ? 'dark' : 'light');
  }, []);

  const cycle = () => {
    const next = ORDER[(ORDER.indexOf(mode) + 1) % ORDER.length]!;
    setMode(next);
    document.documentElement.dataset.theme = next;
    localStorage.setItem(STORAGE_KEY, next);
  };

  return (
    <button
      type="button"
      className="nav-item theme-toggle"
      onClick={cycle}
      aria-label={`Theme: ${LABEL[mode]}`}
      title={`Switch to ${mode === 'light' ? 'dark' : 'light'} theme`}
    >
      <span className="theme-glyph" aria-hidden="true">
        {GLYPH[mode]}
      </span>
      {LABEL[mode]}
    </button>
  );
}
