'use client';

import { useEffect, useState } from 'react';

type Theme = 'light' | 'dark';

/**
 * Floating light/dark switch. Mounted once in the root layout (outside the
 * Amex-vs-ops header swap) so it appears on every page, including anonymous
 * ones like /login and /ops. The actual `data-theme` is first set by the inline
 * pre-hydration script in layout.tsx (no flash); this control just flips it and
 * persists the choice to localStorage under `zkd-theme`.
 */
export default function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>('dark');

  // Read whatever the pre-hydration script already stamped on <html>.
  useEffect(() => {
    const current = document.documentElement.getAttribute('data-theme');
    if (current === 'light' || current === 'dark') setTheme(current);
  }, []);

  const toggle = () => {
    const next: Theme = document.documentElement.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', next);
    try { localStorage.setItem('zkd-theme', next); } catch { /* private mode — session-only */ }
    setTheme(next);
  };

  const nextLabel = theme === 'light' ? 'dark' : 'light';
  return (
    <button
      type="button"
      className="theme-toggle"
      onClick={toggle}
      aria-label={`Switch to ${nextLabel} theme`}
      title={`Switch to ${nextLabel} theme`}
    >
      <span aria-hidden>{theme === 'light' ? '☾' : '☀'}</span>
    </button>
  );
}
