import { expect, test, type Locator } from '@playwright/test';
import { mainHeading, seedLibrary } from './helpers';

// Trecho names may be up to 160 characters; this one is a realistic 41.
const longName = 'Seção B – entrada da mão esquerda (c. 17)';

test.describe('on a phone in portrait', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('on a phone, long trecho names fit Gravações, the review cards and the routine editor', async ({
    page,
  }) => {
    await page.goto('/');
    await seedLibrary(page);
    await page.evaluate(async title => {
      const dbModule = '/src/db.ts';
      const { db } = await import(/* @vite-ignore */ dbModule);
      await db.segments.update('trecho-seed', { title });
    }, longName);
    const pageWidth = () => page.evaluate(() => document.documentElement.scrollWidth);

    await page.goto('/#/evolucao/gravacoes');
    await expect(page.getByRole('heading', { name: 'Gravar uma tentativa' })).toBeVisible();
    expect(await pageWidth()).toBeLessThanOrEqual(390);

    // Each review card takes the whole width, so its date field shows the full date.
    await page.goto('/#/evolucao/revisoes');
    const card = page.locator('.review-card').first();
    await expect(card).toBeVisible();
    expect((await card.boundingBox())!.width).toBeGreaterThan(300);
    expect(await pageWidth()).toBeLessThanOrEqual(390);

    await page.goto('/#/praticar/trecho-seed');
    await expect(mainHeading(page)).toHaveText('Hora de praticar');
    await page.getByRole('button', { name: 'Rotinas de estudo' }).click();
    await page
      .getByRole('dialog', { name: 'Rotinas de estudo' })
      .getByRole('button', { name: 'Editar' })
      .click();
    const editor = page.getByRole('dialog', { name: 'Editar rotina' });
    const edge = (await editor.boundingBox())!;
    for (const name of ['Trecho', 'Atividade']) {
      const button = (await editor.getByRole('button', { name, exact: true }).boundingBox())!;
      expect(button.x + button.width, `+ ${name} fits`).toBeLessThanOrEqual(edge.x + edge.width);
    }
    expect(await editor.evaluate(dialog => dialog.scrollWidth - dialog.clientWidth)).toBeLessThanOrEqual(0);
  });
});

test.describe('on an 11" iPad in portrait', () => {
  test.use({ viewport: { width: 820, height: 1180 } });

  test('the full-screen practice transport stays on one row', async ({ page }) => {
    await page.goto('/');
    await seedLibrary(page);
    await page.goto('/#/praticar/trecho-seed');
    await page.getByRole('button', { name: 'Tela cheia', exact: true }).click();
    const viewer = page.getByRole('region', { name: /^Partitura em tela cheia/ });
    await viewer.getByRole('button', { name: 'Iniciar prática' }).click();
    const middle = async (target: Locator) => {
      const box = (await target.boundingBox())!;
      return box.y + box.height / 2;
    };
    const row = await middle(viewer.locator('.practice-hud .phase-pill'));
    for (const name of ['Pausar', 'Recomeçar repetição'])
      expect(Math.abs((await middle(viewer.getByRole('button', { name }))) - row), name).toBeLessThan(12);
  });
});
