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
