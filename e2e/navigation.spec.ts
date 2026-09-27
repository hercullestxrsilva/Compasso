import { expect, test } from '@playwright/test';
import { addPiece, mainHeading, mainNav } from './helpers';

test('each screen has its own address and Back/Forward move between them', async ({ page }) => {
  await page.goto('/');
  // The start address becomes the canonical one.
  await expect(page).toHaveURL(/#\/hoje$/);
  await expect(mainHeading(page)).toHaveText('Hoje, ao piano.');
  await expect(page).toHaveTitle('Hoje · Compasso');

  await mainNav(page).getByRole('button', { name: 'Repertório' }).click();
  await expect(page).toHaveURL(/#\/repertorio$/);
  await expect(mainHeading(page)).toHaveText('Repertório');
  await expect(page).toHaveTitle('Repertório · Compasso');

  await mainNav(page).getByRole('button', { name: 'Evolução' }).click();
  await expect(page).toHaveURL(/#\/evolucao$/);
  await expect(mainHeading(page)).toHaveText('Sua evolução');
  // A tab changes the address without adding a history entry.
  await page.getByRole('tab', { name: 'Revisões' }).click();
  await expect(page).toHaveURL(/#\/evolucao\/revisoes$/);

  await page.getByRole('button', { name: 'Preferências e dados', exact: true }).click();
  await expect(page).toHaveURL(/#\/preferencias$/);
  await expect(mainHeading(page)).toHaveText('Preferências e dados');

  await page.goBack();
  await expect(page).toHaveURL(/#\/evolucao\/revisoes$/);
  await expect(page.getByRole('tab', { name: 'Revisões' })).toHaveAttribute('aria-selected', 'true');
  await page.goBack();
  await expect(page).toHaveURL(/#\/repertorio$/);
  await expect(mainHeading(page)).toHaveText('Repertório');
  await page.goBack();
  await expect(page).toHaveURL(/#\/hoje$/);
  await expect(mainHeading(page)).toHaveText('Hoje, ao piano.');

  await page.goForward();
  await expect(mainHeading(page)).toHaveText('Repertório');
  await page.goForward();
  await expect(page).toHaveURL(/#\/evolucao\/revisoes$/);
  await expect(page.getByRole('tab', { name: 'Revisões' })).toHaveAttribute('aria-selected', 'true');
});

test('addresses open their screen directly, and unknown ones fall back', async ({ page }) => {
  await page.goto('/#/evolucao/gravacoes');
  await expect(mainHeading(page)).toHaveText('Sua evolução');
  await expect(page.getByRole('tab', { name: 'Minhas gravações' })).toHaveAttribute('aria-selected', 'true');

  await page.goto('/#/praticar');
  await expect(mainHeading(page)).toHaveText('Hora de praticar');

  // Capitals and accents name the same screen; the address is rewritten in its canonical form.
  await page.goto('/#/Repertório');
  await expect(page).toHaveURL(/#\/repertorio$/);
  await expect(mainHeading(page)).toHaveText('Repertório');

  await page.goto('/#/nao-existe');
  await expect(page).toHaveURL(/#\/hoje$/);
  await expect(mainHeading(page)).toHaveText('Hoje, ao piano.');

  // A piece that is not in the library leads back to Repertório.
  await page.goto('/#/repertorio/peca-apagada');
  await expect(page).toHaveURL(/#\/repertorio$/);
  await expect(page.getByText('Esta peça não está mais no seu repertório.')).toBeVisible();
});

test('a piece keeps its address across reloads and its back link returns to the list', async ({ page }) => {
  const id = await addPiece(page, 'Noturno em Mi menor');
  await expect(page).toHaveTitle('Noturno em Mi menor · Compasso');

  await page.reload();
  await expect(mainHeading(page)).toHaveText('Noturno em Mi menor');
  expect(page.url()).toContain(`#/repertorio/${id}`);

  await page.getByRole('main').getByRole('button', { name: 'Repertório' }).click();
  await expect(page).toHaveURL(/#\/repertorio$/);
  await expect(mainHeading(page)).toHaveText('Repertório');
  // The back link went back in history: Forward reopens the piece.
  await page.goForward();
  await expect(mainHeading(page)).toHaveText('Noturno em Mi menor');
});
