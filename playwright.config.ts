import { defineConfig } from '@playwright/test';

/**
 * End-to-end smoke suite (npm run test:e2e). It drives the browser already installed on the machine, so
 * nothing is downloaded: Google Chrome by default, Microsoft Edge with E2E_BROWSER=msedge. Every test gets
 * a new browser context, so it starts with empty IndexedDB and localStorage.
 */
const PORT = 5240;
const baseURL = `http://127.0.0.1:${PORT}`;
const channel = process.env.E2E_BROWSER || 'chrome';

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  timeout: 60_000,
  // The dev server compiles each screen on its first request: with many workers starting at once, the first
  // screens can take longer than usual to appear.
  expect: { timeout: 15_000 },
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL,
    channel,
    locale: 'pt-BR',
    timezoneId: 'America/Sao_Paulo',
    colorScheme: 'light',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'desktop', use: { viewport: { width: 1440, height: 900 } } },
    // 12.9" iPad in portrait: CSS size of the screen, touch input.
    { name: 'ipad', use: { viewport: { width: 1024, height: 1366 }, hasTouch: true, deviceScaleFactor: 2 } },
  ],
  webServer: {
    // The PDF.js decoders and fonts (public/pdfjs) are prepared first, as `npm run dev` does.
    command: `node scripts/pdf-assets.mjs && npx vite --config e2e/vite.config.ts --host 127.0.0.1 --port ${PORT} --strictPort`,
    url: baseURL,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
