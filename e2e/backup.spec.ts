import { expect, test } from '@playwright/test';
import {
  countRows,
  expectPainted,
  mainHeading,
  mainNav,
  scoreOverlay,
  scorePage,
  seedLibrary,
} from './helpers';

test('exports a .zip backup and restores it in another browser profile', async ({ page, browser }) => {
  // Without the save dialog of desktop Chrome and Edge, the backup is handed over as a download, as it is on
  // the iPad; Playwright can then keep the file.
  await page.addInitScript(() => {
    Object.defineProperty(window, 'showSaveFilePicker', { value: undefined, configurable: true });
  });
  await page.goto('/#/preferencias');
  await expect(mainHeading(page)).toHaveText('Preferências e dados');
  await seedLibrary(page);
  const before = await countRows(page);
  expect(before).toMatchObject({ pieces: 1, scores: 1, assets: 3, sessions: 1, lessons: 1, recordings: 1 });
  await expect(page.getByText('Seu acervo existe só aqui.')).toBeVisible();

  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Exportar backup' }).click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/^compasso-backup-\d{4}-\d{2}-\d{2}\.zip$/);
  const backup = test.info().outputPath(file.suggestedFilename());
  await file.saveAs(backup);
  await expect(page.getByText(/^Download do backup iniciado/)).toBeVisible();
  await expect(page.getByText('Última exportação: hoje')).toBeVisible();

  // A new context has its own, empty IndexedDB: another browser, or another device.
  const other = await (await browser.newContext()).newPage();
  await other.goto('/#/preferencias');
  await expect(mainHeading(other)).toHaveText('Preferências e dados');
  expect((await countRows(other)).pieces).toBe(0);

  await other.getByLabel('Restaurar arquivo').setInputFiles(backup);
  const confirm = other.getByRole('dialog', { name: 'Restaurar este backup?' });
  await expect(confirm.getByRole('listitem')).toHaveText(['1 peça', '1 aula', '1 gravação', '1 sessão']);
  await expect(
    confirm.getByText('Este navegador ainda não tem dados, então nada será perdido.'),
  ).toBeVisible();
  await confirm.getByRole('button', { name: 'Substituir e restaurar' }).click();
  await expect(other.getByText('Backup restaurado neste navegador.')).toBeVisible();
  expect(await countRows(other)).toEqual(before);

  // The restored piece opens with its score file and its annotation.
  await mainNav(other).getByRole('button', { name: 'Repertório' }).click();
  await other.getByRole('button', { name: 'Invenção nº 1', exact: true }).click();
  await expect(mainHeading(other)).toHaveText('Invenção nº 1');
  await expectPainted(scorePage(other, 'partitura-teste'));
  await expect(scoreOverlay(other).getByText('respirar aqui')).toBeVisible();
  await other.context().close();
});
