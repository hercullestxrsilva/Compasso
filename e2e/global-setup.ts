import { chromium, type FullConfig } from '@playwright/test';

/**
 * Warms the dev server before the tests start: loads every lazy screen and opens a PDF once, so Vite has
 * transformed the modules and prepared the PDF reader. Without it, eight tests hitting a server that has just
 * started can find a module request stalled behind that preparation and time out on "Abrindo…".
 */
export default async function globalSetup(config: FullConfig) {
  const baseURL = config.projects[0]?.use.baseURL;
  if (!baseURL) return;
  const browser = await chromium.launch({ channel: process.env.E2E_BROWSER || 'chrome' });
  try {
    const page = await browser.newPage();
    await page.goto(baseURL);
    await page.getByRole('heading', { level: 1 }).waitFor({ timeout: 90_000 });
    await page.evaluate(async () => {
      const screens = [
        'PieceDetail',
        'Practice',
        'Lessons',
        'Progress',
        'Settings',
        'Warmups',
        'ScoreViewer',
      ];
      await Promise.all(screens.map(name => import(/* @vite-ignore */ `/src/components/${name}.tsx`)));
      // A path in a variable: resolved by the dev server in the page, not by TypeScript here.
      const render = '/src/pdf/render.ts';
      const { openPdf } = await import(/* @vite-ignore */ render);
      const pdf = await (await fetch('/tests/fixtures/partitura-teste.pdf')).blob();
      const handle = openPdf(pdf);
      await (await handle.promise).getPage(1);
      handle.close();
    });
  } finally {
    await browser.close();
  }
}
