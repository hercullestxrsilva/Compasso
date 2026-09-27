import { expect, test } from '@playwright/test';
import { mainHeading, seedLibrary } from './helpers';

const screens = [
  ['#/hoje', 'Hoje, ao piano.'],
  ['#/repertorio', 'Repertório'],
  ['#/repertorio/peca-seed', 'Invenção nº 1'],
  ['#/praticar/trecho-seed', 'Hora de praticar'],
  ['#/praticar/piece:peca-seed', 'Hora de praticar'],
  ['#/aulas', 'Suas aulas'],
  ['#/aulas/aula-seed', 'Aula de setembro'],
  ['#/evolucao/historico', 'Sua evolução'],
  ['#/evolucao/gravacoes', 'Sua evolução'],
  ['#/evolucao/revisoes', 'Sua evolução'],
  ['#/preferencias', 'Preferências e dados'],
] as const;

test('every screen opens with a full library and no script errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await expect(mainHeading(page)).toHaveText('Hoje, ao piano.');
  await seedLibrary(page);

  for (const [hash, heading] of screens) {
    await page.goto(`/${hash}`);
    await expect(mainHeading(page), hash).toHaveText(heading);
    await expect(page.getByText('Precisamos reabrir esta tela.')).toBeHidden();
  }
  // The seeded library shows up where it belongs.
  await page.goto('/#/evolucao/historico');
  await expect(page.locator('.history-row').filter({ hasText: 'Entrada da mão esquerda' })).toHaveCount(1);
  await page.goto('/#/evolucao/revisoes');
  await expect(page.getByText('Entrada da mão esquerda').first()).toBeVisible();
  expect(errors).toEqual([]);
});

test('Hoje moves on to the new day at midnight without a reload', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-09-27T23:50:00-03:00') });
  await page.goto('/#/hoje');
  await expect(mainHeading(page)).toHaveText('Hoje, ao piano.');
  await page.evaluate(async () => {
    const dbModule = '/src/db.ts';
    const { db } = await import(/* @vite-ignore */ dbModule);
    await db.sessions.add({
      id: 'sessao-de-domingo',
      kind: 'free',
      title: 'Prática livre',
      hand: 'both',
      config: {},
      startedAt: new Date('2026-09-27T23:00:00-03:00').toISOString(),
      endedAt: new Date('2026-09-27T23:20:00-03:00').toISOString(),
      activeSeconds: 1200,
      completedRepetitions: 1,
      note: '',
      completed: true,
    });
  });
  const today = page.locator('.stat').filter({ hasText: 'Prática de hoje' });
  await expect(page.getByText('DOMINGO, 27 DE SETEMBRO')).toBeVisible();
  await expect(today.locator('strong')).toHaveText('20 min');

  await page.clock.fastForward('15:00');
  await expect(page.getByText('SEGUNDA-FEIRA, 28 DE SETEMBRO')).toBeVisible();
  await expect(today.locator('strong')).toHaveText('0 min');
});
