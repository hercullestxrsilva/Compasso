import { expect, test } from '@playwright/test';
import { addPiece, mainHeading, mainNav } from './helpers';

test('the study clock runs across screens and reloads, pauses, and records the session', async ({ page }) => {
  const pieceId = await addPiece(page, 'Kinderszenen nº 1', 'partitura-teste.pdf');
  const clock = page.getByRole('group', { name: 'Relógio da sessão de estudo' });

  await page.getByRole('button', { name: 'Iniciar estudo' }).click();
  await expect(clock.getByRole('button', { name: 'Pausar o relógio de estudo' })).toBeVisible();
  await expect(clock.getByRole('timer')).toContainText('0:0');

  // Other screens and a reload keep the same session.
  await mainNav(page).getByRole('button', { name: 'Aquecimento' }).click();
  await expect(mainHeading(page)).toHaveText('Aquecimento');
  await expect(clock).toBeVisible();
  await page.reload();
  await expect(page.getByRole('group', { name: 'Relógio da sessão de estudo' })).toBeVisible();

  await clock.getByRole('button', { name: 'Pausar o relógio de estudo' }).click();
  await expect(clock.getByRole('button', { name: 'Continuar o relógio de estudo' })).toBeVisible();
  const time = clock.getByRole('timer').locator('strong');
  const paused = await time.innerText();
  await page.waitForTimeout(1500);
  await expect(time).toHaveText(paused);
  await clock.getByRole('button', { name: 'Continuar o relógio de estudo' }).click();
  await expect(clock.getByRole('button', { name: 'Pausar o relógio de estudo' })).toBeVisible();

  // Ending on the piece's page suggests that piece; the time can be corrected before saving.
  await page.goto(`/#/repertorio/${pieceId}`);
  await expect(mainHeading(page)).toHaveText('Kinderszenen nº 1');
  await page.getByRole('button', { name: 'Encerrar a sessão de estudo' }).click();
  const dialog = page.getByRole('dialog', { name: 'Registrar sessão de estudo' });
  await expect(dialog.getByLabel('O que você estudou?').locator('option:checked')).toHaveText(
    'Kinderszenen nº 1',
  );
  await dialog.getByLabel('Tempo a registrar (minutos)').fill('25');
  await dialog.getByLabel('Anotação (opcional)').fill('Leitura das duas primeiras linhas');
  await dialog.getByRole('button', { name: 'Salvar sessão' }).click();
  await expect(page.getByText('25 minutos de estudo registrados.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Iniciar estudo' })).toBeVisible();

  await mainNav(page).getByRole('button', { name: 'Evolução' }).click();
  await expect(page.getByText('Estudo · Kinderszenen nº 1')).toBeVisible();
  await expect(page.getByText('Leitura das duas primeiras linhas')).toBeVisible();
  await mainNav(page).getByRole('button', { name: 'Hoje' }).click();
  await expect(page.locator('.stat').first()).toContainText('25');
});
