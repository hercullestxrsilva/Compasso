// Renders the PWA / home-screen PNG icons from brand/icone-app.svg with the installed Chrome (no downloads).
// Run with: node scripts/icons.mjs   (set E2E_BROWSER=msedge to use Edge instead)
import { readFile, writeFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';

const svg = (await readFile('brand/icone-app.svg', 'utf8'))
  .replace(/<metadata>[\s\S]*?<\/metadata>/, '')
  .replace(/ width="1024" height="1024"/, ' width="100%" height="100%"');

// Full-bleed squares: iOS and Android apply their own masks; the symbol sits inside the maskable safe zone.
const browser = await chromium.launch({ channel: process.env.E2E_BROWSER || 'chrome' });
try {
  for (const size of [180, 192, 512]) {
    const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
    await page.setContent(`<style>html,body{margin:0;height:100%}svg{display:block}</style>${svg}`);
    await writeFile(`public/icon-${size}.png`, await page.screenshot({ type: 'png' }));
    await page.close();
  }
} finally {
  await browser.close();
}
console.log('PWA icons generated from brand/icone-app.svg.');
