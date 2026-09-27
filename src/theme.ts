export type ThemeChoice = 'system' | 'light' | 'dark';

const KEY = 'compasso:theme';

export function getThemeChoice(): ThemeChoice {
  try {
    const value = localStorage.getItem(KEY);
    return value === 'light' || value === 'dark' ? value : 'system';
  } catch {
    return 'system';
  }
}

/**
 * Applies the theme on <html>: data-theme="light" | "dark" when chosen explicitly, no attribute to follow the
 * system (CSS handles prefers-color-scheme). index.html runs the same logic inline before first paint.
 */
export function applyTheme(choice: ThemeChoice = getThemeChoice()) {
  const root = document.documentElement;
  if (choice === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', choice);
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
