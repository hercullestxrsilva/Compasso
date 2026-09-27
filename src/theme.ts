export type ThemeChoice = 'system' | 'light' | 'dark';

const KEY = 'compasso:theme';

/** Browser chrome colour per scheme (the sidebar's --nav-bg); index.html declares the same two values. */
export const CHROME_COLORS = { light: '#123b40', dark: '#0b1618' } as const;

export function getThemeChoice(): ThemeChoice {
  try {
    const value = localStorage.getItem(KEY);
    return value === 'light' || value === 'dark' ? value : 'system';
  } catch {
    return 'system';
  }
}

/**
 * Keeps the Safari toolbar, the status bar and native controls in step with the page. An explicit choice paints
 * both theme-color tags with that theme; "system" gives each tag back the colour of its own media query.
 */
function syncMeta(choice: ThemeChoice) {
  document
    .querySelector('meta[name="color-scheme"]')
    ?.setAttribute('content', choice === 'system' ? 'light dark' : choice);
  document.querySelectorAll('meta[name="theme-color"]').forEach(meta => {
    const own = (meta.getAttribute('media') ?? '').includes('dark') ? 'dark' : 'light';
    meta.setAttribute('content', CHROME_COLORS[choice === 'system' ? own : choice]);
  });
}

/**
 * Applies the theme on <html>: data-theme="light" | "dark" when chosen explicitly, no attribute to follow the
 * system (CSS handles prefers-color-scheme). index.html runs the same logic inline before first paint.
 */
export function applyTheme(choice: ThemeChoice = getThemeChoice()) {
  const root = document.documentElement;
  if (choice === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', choice);
  syncMeta(choice);
}

export function setThemeChoice(choice: ThemeChoice) {
  try {
    if (choice === 'system') localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, choice);
  } catch {
    // Private mode or blocked storage: the choice still applies to this visit.
  }
  applyTheme(choice);
}
