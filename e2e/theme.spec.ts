import { expect, test, type Page } from '@playwright/test';
import { addPiece, mainHeading, mainNav } from './helpers';

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

/** Contrast ratio between an element's text colour and its background (both opaque). */
const contrast = (page: Page, selector: string) =>
  page
    .locator(selector)
    .first()
    .evaluate(element => {
      const style = getComputedStyle(element);
      const channels = (color: string) => {
        const values = color.match(/[\d.]+/g)!.map(Number);
        // color(srgb r g b) is written in 0–1, rgb(r, g, b) in 0–255.
        return color.startsWith('color(') ? values.slice(0, 3) : values.slice(0, 3).map(v => v / 255);
      };
      const luminance = (color: string) => {
        const [r, g, b] = channels(color).map(c => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
        return 0.2126 * r + 0.7152 * g + 0.0722 * b;
      };
      const [a, b] = [luminance(style.color), luminance(style.backgroundColor)].sort((x, y) => y - x);
      return (a + 0.05) / (b + 0.05);
    });

test('in the dark theme the backup warning and the active Preferências item stay readable', async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await addPiece(page, 'Sem cópia');
  await mainNav(page).getByRole('button', { name: 'Hoje' }).click();
  await expect(page.getByText('Sem backup ainda')).toBeVisible();
  expect(await contrast(page, '.topbar .backup-pill.stale')).toBeGreaterThanOrEqual(4.5);

  const activeBackground = () =>
    page.evaluate(
      () => getComputedStyle(document.querySelector('.sidebar [aria-current="page"]')!).backgroundColor,
    );
  await expect.poll(activeBackground).not.toBe('rgba(0, 0, 0, 0)');
  const home = await activeBackground();
  await page.getByRole('button', { name: 'Preferências e dados', exact: true }).click();
  await expect(mainHeading(page)).toHaveText('Preferências e dados');
  await expect.poll(activeBackground).toBe(home);
});
