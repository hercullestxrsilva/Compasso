import { expect, test, type Page } from '@playwright/test';
import { addPiece, mainHeading, mainNav, scorePage } from './helpers';

// A small white PNG: a stand-in for a photo of the teacher's notebook or a screenshot of a score.
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==',
  'base64',
);
const image = (name: string) => ({ name, mimeType: 'image/png', buffer: png });

/** Ctrl+V of a screenshot: a paste event carrying an image file. */
async function pasteImage(page: Page, name: string) {
  await page.evaluate(
    async ({ bytes, name }) => {
      const data = new DataTransfer();
      data.items.add(new File([Uint8Array.from(bytes)], name, { type: 'image/png' }));
      window.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data }));
    },
    { bytes: [...png], name },
  );
}

test("the teacher's notes and the week's activities have their place in the lesson", async ({ page }) => {
  const pieceId = await addPiece(page, 'Kinderszenen');

  // From Hoje: register the lesson with a photo of the teacher's notes.
  await mainNav(page).getByRole('button', { name: 'Hoje' }).click();
  await page.getByRole('button', { name: 'Registrar aula e atividades' }).click();
  const form = page.getByRole('dialog', { name: 'Registrar aula' });
  await form.getByLabel('Data').fill('2026-09-22');
  await form.getByLabel('Anotações do professor (opcional)').setInputFiles(image('caderno.png'));
  await expect(form.getByText('caderno.png')).toBeVisible();
  await form.getByRole('button', { name: 'Criar aula' }).click();
  await expect(mainHeading(page)).toHaveText('Aula de 22/9');

  const notes = page.getByRole('region', { name: 'Anotações do professor' });
  await expect(notes.getByRole('button', { name: 'Abrir caderno.png' })).toBeVisible();
  // A second page of notes arrives as a screenshot: Ctrl+V adds it.
  await pasteImage(page, 'image.png');
  await expect(notes.getByRole('button', { name: /^Abrir Print / })).toBeVisible();
  await notes.getByRole('button', { name: 'Abrir caderno.png' }).click();
  const viewer = page.getByRole('dialog', { name: 'caderno.png' });
  await expect(viewer.getByRole('img', { name: 'Anotação do professor: caderno.png' })).toBeVisible();
  await viewer.getByRole('button', { name: 'Fechar', exact: true }).click();

  // The activities, written while looking at the notes.
  const week = page.getByRole('region', { name: 'Atividades da semana' });
  const add = week.getByRole('form', { name: 'Nova atividade' });
  await add.getByLabel('Atividade').fill('Schumann');
  await add
    .getByLabel('Como praticar (opcional)')
    .fill('Frase longa, sem soletrar\nRespirar no fim da ligadura');
  await add.getByLabel('Para').selectOption({ label: 'Kinderszenen' });
  await expect(add.getByLabel('Até')).toHaveValue('2026-09-29');
  await add.getByRole('button', { name: 'Adicionar atividade' }).click();
  await add.getByLabel('Atividade').fill('Escala de Fá');
  await add.getByLabel('Para').selectOption({ label: 'Estudo geral' });
  await add.getByRole('button', { name: 'Adicionar atividade' }).click();

  await expect(week.getByText('Respirar no fim da ligadura')).toBeVisible();
  await expect(week.getByText(/Kinderszenen · (atrasada, era até|até)/)).toBeVisible();
  await week.getByRole('checkbox', { name: 'Escala de Fá' }).click();
  await expect(week.getByRole('checkbox', { name: 'Escala de Fá' })).toHaveAttribute('aria-checked', 'true');
  await expect(week.getByText('1 de 2 por fazer')).toBeVisible();

  // Hoje lists what is left for the week, and "Praticar" opens the piece.
  await mainNav(page).getByRole('button', { name: 'Hoje' }).click();
  const today = page.locator('.week-tasks');
  await expect(today.getByText('Schumann')).toBeVisible();
  await expect(today.getByText('Escala de Fá')).toHaveCount(0);
  await today.getByRole('button', { name: 'Praticar Schumann' }).click();
  await expect(page).toHaveURL(new RegExp(`#/praticar/piece:${pieceId}$`));
});

test('several screenshots of a score become one score with a page each', async ({ page }) => {
  await page.goto('/#/repertorio');
  await page.getByRole('button', { name: 'Adicionar peça', exact: true }).click();
  const form = page.getByRole('dialog', { name: 'Adicionar ao repertório' });
  await form.getByLabel('Nome da peça').fill('Czerny nº 7');
  await form.getByLabel('Partitura (opcional)').setInputFiles([image('pagina-1.png'), image('pagina-2.png')]);
  await expect(form.getByText('pagina-2.png')).toBeVisible();
  await form.getByRole('button', { name: 'Adicionar peça' }).click();
  await expect(mainHeading(page)).toHaveText('Czerny nº 7');
  await expect(scorePage(page, 'Czerny nº 7', 1, 2)).toBeVisible();
});
