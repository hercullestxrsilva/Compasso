import { expect, test, type Page } from '@playwright/test';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { drag, expectPainted, fixture, mainHeading, mainNav, scoreOverlay } from './helpers';

/** A one-page scale book with printed titles, like the books the app splits by their text. */
async function scaleBook() {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const page = pdf.addPage([595, 842]);
  const titles = ['C Major', 'G Major', 'A minor', 'A harmonic minor'];
  titles.forEach((title, i) => {
    const top = 90 + i * 180;
    page.drawText(title, { x: 60, y: 842 - top, size: 12, font });
    // A grand staff under each title, so every crop has ink.
    for (const staff of [30, 90])
      for (let line = 0; line < 5; line++)
        page.drawLine({
          start: { x: 60, y: 842 - (top + staff + line * 8) },
          end: { x: 535, y: 842 - (top + staff + line * 8) },
          thickness: 1,
          color: rgb(0, 0, 0),
        });
  });
  return Buffer.from(await pdf.save());
}

async function openImport(page: Page) {
  await page.goto('/#/aquecimento');
  await expect(mainHeading(page)).toHaveText('Aquecimento');
  await page.getByRole('button', { name: 'Importar PDF' }).first().click();
  return page.getByRole('dialog', { name: 'Importar para o aquecimento' });
}

test('a scale book is split by its titles, and a scale goes straight to practice', async ({ page }) => {
  const dialog = await openImport(page);
  await dialog
    .locator('input[type=file]')
    .setInputFiles({ name: 'escalas.pdf', mimeType: 'application/pdf', buffer: await scaleBook() });
  await expect(dialog.getByText('Encontramos 4 escalas pelos títulos do PDF.')).toBeVisible();
  await dialog.getByLabel('Nome da coleção').fill('Minhas escalas');
  await dialog.getByRole('button', { name: 'Importar', exact: true }).click();
  await expect(dialog).toBeHidden();

  await expect(page.getByRole('tab', { name: /Minhas escalas/ })).toHaveAttribute('aria-selected', 'true');
  // Major and minor forms share the collection: a switch chooses the form, chips choose the key.
  await page.getByRole('button', { name: 'Menor harmônica' }).click();
  await expect(page.getByRole('heading', { level: 2 })).toHaveText('Lá menor harmônica');
  await page.getByRole('button', { name: 'Maior', exact: true }).click();
  await page.getByRole('button', { name: /^Sol maior/ }).click();
  await expect(page.getByRole('heading', { level: 2 })).toHaveText('Sol maior');
  await expectPainted(page.getByRole('img', { name: 'Partitura: Sol maior' }));

  await page.getByRole('button', { name: 'Praticar Sol maior' }).click();
  await expect(page).toHaveURL(/#\/praticar\//);
  const target = page.getByLabel('O que vamos estudar?');
  await expect(target.locator('option:checked')).toHaveText('Sol maior');
  await expect(target.locator('optgroup', { has: page.locator('option:checked') })).toHaveAttribute(
    'label',
    'Aquecimento · Minhas escalas',
  );

  // Warm-ups stay out of the repertoire and open the day's plan.
  await mainNav(page).getByRole('button', { name: 'Repertório' }).click();
  await expect(page.getByText('Minhas escalas')).toHaveCount(0);
  await mainNav(page).getByRole('button', { name: 'Hoje' }).click();
  await expect(page.getByText('aquecimento do dia')).toBeVisible();
});

test('a book of études is split by page, then refined by hand', async ({ page }) => {
  const dialog = await openImport(page);
  await dialog.locator('input[type=file]').setInputFiles(fixture('partitura-teste.pdf'));
  await expect(dialog.getByText(/Não reconhecemos a divisão deste arquivo \(2 páginas\)/)).toBeVisible();
  await expect(dialog.getByLabel('Tipo')).toHaveValue('etudes');
  await dialog.getByLabel('Nome da coleção').fill('Czerny op. 599');
  await dialog.getByRole('button', { name: 'Importar', exact: true }).click();
  await expect(dialog).toBeHidden();

  await expect(page.getByRole('button', { name: 'Nº 1', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Nº 2', exact: true }).click();
  await expect(page.getByRole('heading', { level: 2 })).toHaveText('Nº 2');

  await page.getByRole('button', { name: 'Organizar exercícios' }).click();
  await expect(page.getByRole('heading', { name: 'Organizar exercícios' })).toBeVisible();
  // The editor opens with the marking tool: one drag makes the next exercise.
  await drag(page, scoreOverlay(page), [0.1, 0.2], [0.9, 0.35]);
  await expect(page.getByText('Nº 3 marcado.')).toBeVisible();
  const name = page.getByLabel('Nome do exercício 3');
  await name.fill('Estudo em Dó');
  await name.press('Enter');
  await page.getByRole('button', { name: 'Subir Estudo em Dó' }).click();
  await expect(page.getByLabel('Nome do exercício 2')).toHaveValue('Estudo em Dó');
  await page.getByRole('button', { name: 'Concluir' }).click();
  await expect(page.locator('.exercise-chips .key-chip strong')).toHaveText(['Nº 1', 'Estudo em Dó', 'Nº 2']);

  await page.getByRole('button', { name: 'Excluir coleção' }).click();
  const confirm = page.getByRole('dialog', { name: 'Excluir coleção?' });
  await confirm.getByRole('button', { name: 'Excluir coleção' }).click();
  await expect(page.getByText('Seu aquecimento começa aqui')).toBeVisible();
});
