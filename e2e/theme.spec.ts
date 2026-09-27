import { expect, test, type Page } from '@playwright/test';
import { mainHeading } from './helpers';

/** Relative luminance (0 black – 1 white) of the page background. */
const backgroundLuminance = (page: Page) =>
  page.evaluate(() => {
    const [r, g, b] = getComputedStyle(document.body)
      .backgroundColor.match(/[\d.]+/g)!
      .map(Number)
      .map(c => c / 255);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  });

test('the theme chosen in Preferências applies at once and survives a reload', async ({ page }) => {
  await page.goto('/#/preferencias');
  await expect(mainHeading(page)).toHaveText('Preferências e dados');
  const theme = page.getByRole('group', { name: 'Tema do aplicativo' });
  const html = page.locator('html');
  await expect(theme.getByRole('radio', { name: 'Sistema' })).toBeChecked();
  expect(await backgroundLuminance(page)).toBeGreaterThan(0.5);

  await theme.getByText('Escuro').click();
  await expect(html).toHaveAttribute('data-theme', 'dark');
  await expect.poll(() => backgroundLuminance(page)).toBeLessThan(0.1);
  await expect(page.locator('meta[name="theme-color"]').first()).toHaveAttribute('content', '#0b1618');

  await page.reload();
  await expect(mainHeading(page)).toHaveText('Preferências e dados');
  await expect(html).toHaveAttribute('data-theme', 'dark');
  await expect(theme.getByRole('radio', { name: 'Escuro' })).toBeChecked();
  expect(await backgroundLuminance(page)).toBeLessThan(0.1);

  // "Sistema" follows the device: dark here, since the emulated system is dark now.
  await page.emulateMedia({ colorScheme: 'dark' });
  await theme.getByText('Sistema').click();
  await expect(html).not.toHaveAttribute('data-theme');
  expect(await backgroundLuminance(page)).toBeLessThan(0.1);
  await theme.getByText('Claro').click();
  await expect(html).toHaveAttribute('data-theme', 'light');
  await expect.poll(() => backgroundLuminance(page)).toBeGreaterThan(0.5);

  await page.reload();
  await expect(html).toHaveAttribute('data-theme', 'light');
  await expect(theme.getByRole('radio', { name: 'Claro' })).toBeChecked();
});
