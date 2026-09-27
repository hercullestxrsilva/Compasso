import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CHROME_COLORS, applyTheme, setThemeChoice } from '../src/theme';

class FakeElement {
  attributes = new Map<string, string>();
  constructor(init: Record<string, string> = {}) {
    for (const [key, value] of Object.entries(init)) this.attributes.set(key, value);
  }
  getAttribute(name: string) {
    return this.attributes.get(name) ?? null;
  }
  setAttribute(name: string, value: string) {
    this.attributes.set(name, value);
  }
  removeAttribute(name: string) {
    this.attributes.delete(name);
  }
}

/** The <head> of index.html as a page loads it. */
function fakeDocument() {
  const scheme = new FakeElement({ name: 'color-scheme', content: 'light dark' });
  const light = new FakeElement({
    name: 'theme-color',
    media: '(prefers-color-scheme: light)',
    content: CHROME_COLORS.light,
  });
  const dark = new FakeElement({
    name: 'theme-color',
    media: '(prefers-color-scheme: dark)',
    content: CHROME_COLORS.dark,
  });
  const documentElement = new FakeElement();
  return {
    scheme,
    light,
    dark,
    documentElement,
    querySelector: (selector: string) => (selector.includes('color-scheme') ? scheme : null),
    querySelectorAll: () => [light, dark],
  };
}

function memoryStorage() {
  const data = new Map<string, string>();
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    removeItem: (key: string) => void data.delete(key),
  };
}

afterEach(() => vi.unstubAllGlobals());

describe('theme', () => {
  it('paints the browser chrome with the chosen theme and gives it back to the system', () => {
    const doc = fakeDocument();
    vi.stubGlobal('document', doc);
    vi.stubGlobal('localStorage', memoryStorage());

    setThemeChoice('dark');
    expect(doc.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(doc.scheme.getAttribute('content')).toBe('dark');
    expect(doc.light.getAttribute('content')).toBe(CHROME_COLORS.dark);
    expect(doc.dark.getAttribute('content')).toBe(CHROME_COLORS.dark);

    setThemeChoice('light');
    expect(doc.scheme.getAttribute('content')).toBe('light');
    expect(doc.dark.getAttribute('content')).toBe(CHROME_COLORS.light);

    setThemeChoice('system');
    expect(doc.documentElement.getAttribute('data-theme')).toBeNull();
    expect(doc.scheme.getAttribute('content')).toBe('light dark');
    expect(doc.light.getAttribute('content')).toBe(CHROME_COLORS.light);
    expect(doc.dark.getAttribute('content')).toBe(CHROME_COLORS.dark);
  });

  it('follows the stored choice and survives blocked storage', () => {
    const doc = fakeDocument();
    vi.stubGlobal('document', doc);
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('blocked');
      },
    });
    applyTheme();
    expect(doc.documentElement.getAttribute('data-theme')).toBeNull();
    expect(doc.scheme.getAttribute('content')).toBe('light dark');
  });

  it('uses the same chrome colours as the tags and the inline script in index.html', () => {
    const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
    for (const color of Object.values(CHROME_COLORS))
      expect(html.split(color).length).toBeGreaterThanOrEqual(3);
  });
});
