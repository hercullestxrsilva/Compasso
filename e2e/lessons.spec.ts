import { expect, test } from '@playwright/test';
import { fixture, mainHeading } from './helpers';

test('registers a lesson with imported audio and a note at a moment of it', async ({ page }) => {
  await page.goto('/#/aulas');
  await expect(mainHeading(page)).toHaveText('Suas aulas');
  await page.getByRole('button', { name: 'Registrar aula' }).first().click();
  const form = page.getByRole('dialog', { name: 'Registrar aula' });
  await form.getByLabel('Título').fill('Aula de técnica');
  await form.getByLabel('Professor(a)').fill('Ana');
  await form.getByRole('button', { name: 'Criar aula' }).click();
  await expect(mainHeading(page)).toHaveText('Aula de técnica');
  await expect(page).toHaveURL(/#\/aulas\/[^/]+$/);

  const audioPanel = page.getByRole('region', { name: 'Áudio da aula' });
  await audioPanel.getByLabel('Importar áudio').setInputFiles(fixture('audio-teste.wav'));
  await expect(page.getByText('Áudio salvo neste dispositivo.')).toBeVisible();
  const player = audioPanel.locator('audio');
  await expect.poll(() => player.evaluate((audio: HTMLAudioElement) => audio.duration)).toBeCloseTo(3, 1);

  // Skipping ahead lands on the end of the 3 s file; a note written now is stamped with that moment.
  await audioPanel.getByRole('button', { name: 'Avançar 5 segundos' }).click();
  await page.getByLabel('Nova anotação').fill('Soltar o punho no acorde final.');
  await expect(page.getByRole('group', { name: 'Tempo da anotação' })).toContainText('Marcar em 0:03');
  await page.getByRole('button', { name: 'Salvar anotação' }).click();
  await expect(page.getByRole('button', { name: 'Ouvir a partir de 0:03' })).toBeVisible();

  await page.reload();
  await expect(mainHeading(page)).toHaveText('Aula de técnica');
  await expect(page.getByText('Soltar o punho no acorde final.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Ouvir a partir de 0:03' })).toBeEnabled();
  await expect(audioPanel.getByText('audio-teste.wav')).toBeVisible();
});
