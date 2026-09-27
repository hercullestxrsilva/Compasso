import { expect, test } from '@playwright/test';
import {
  addPiece,
  countRows,
  drag,
  expectPainted,
  fixture,
  mainNav,
  press,
  scoreOverlay,
  scorePage,
} from './helpers';

test('adds a piece with a PDF score and renders its pages', async ({ page }) => {
  await addPiece(page, 'Prelúdio de teste', 'partitura-teste.pdf');

  await expectPainted(scorePage(page, 'partitura-teste', 1));
  await page.getByRole('button', { name: 'Próxima página (superior)' }).click();
  await expectPainted(scorePage(page, 'partitura-teste', 2));
  await expect(page.getByRole('button', { name: 'Próxima página (superior)' })).toBeDisabled();

  // The piece is listed in Repertório with its score.
  await mainNav(page).getByRole('button', { name: 'Repertório' }).click();
  await expect(page).toHaveURL(/#\/repertorio$/);
  await expect(page.getByRole('button', { name: 'Prelúdio de teste', exact: true })).toBeVisible();
  await expect(page.getByText('1 partitura')).toBeVisible();
});

test('renders a scanned score that needs the JPEG 2000 decoder', async ({ page }) => {
  await addPiece(page, 'Digitalizada', 'partitura-jpeg2000.pdf');
  await expectPainted(scorePage(page, 'partitura-jpeg2000', 1));
});

test('pen, highlighter and text annotations undo, redo, survive a reload and erase', async ({ page }) => {
  await addPiece(page, 'Estudo anotado', 'partitura-teste.pdf');
  await expectPainted(scorePage(page, 'partitura-teste'));
  const overlay = scoreOverlay(page);
  // Marks of the default layer, "Minhas notas", drawn in its colour.
  const pen = overlay.locator('path[stroke="#087e8b"][stroke-width="2.4"]');
  const highlight = overlay.locator('path[stroke="#087e8b"][stroke-width="18"]');
  const note = overlay.getByText('dedo 1 no dó');
  const tools = page.getByRole('group', { name: 'Ferramentas da partitura' });
  const undo = page.getByRole('button', { name: 'Desfazer', exact: true });
  const redo = page.getByRole('button', { name: 'Refazer', exact: true });

  await tools.getByRole('button', { name: 'Caneta', exact: true }).click();
  await drag(page, overlay, [0.2, 0.3], [0.6, 0.34]);
  await expect(pen).toHaveCount(1);

  await tools.getByRole('button', { name: 'Marca-texto', exact: true }).click();
  await drag(page, overlay, [0.2, 0.45], [0.7, 0.45]);
  await expect(highlight).toHaveCount(1);

  await tools.getByRole('button', { name: 'Texto', exact: true }).click();
  await press(overlay, [0.3, 0.2]);
  const textForm = page.getByRole('dialog', { name: 'Anotação na partitura' });
  await textForm.getByLabel('Texto').fill('dedo 1 no dó');
  await textForm.getByLabel('Tamanho da fonte').fill('24');
  await textForm.getByRole('button', { name: 'Salvar anotação' }).click();
  await expect(textForm).toBeHidden();
  await expect(note).toBeVisible();
  await expect(note).toHaveAttribute('font-size', '24');

  await undo.click();
  await expect(note).toHaveCount(0);
  await undo.click();
  await expect(highlight).toHaveCount(0);
  await expect(pen).toHaveCount(1);
  await undo.click();
  await expect(pen).toHaveCount(0);
  await expect(undo).toBeDisabled();

  await redo.click();
  await expect(pen).toHaveCount(1);
  await redo.click();
  await expect(highlight).toHaveCount(1);
  await redo.click();
  await expect(note).toBeVisible();
  await expect(redo).toBeDisabled();
  await expect.poll(async () => (await countRows(page)).annotations).toBe(3);

  await page.reload();
  await expectPainted(scorePage(page, 'partitura-teste'));
  await expect(pen).toHaveCount(1);
  await expect(highlight).toHaveCount(1);
  await expect(note).toBeVisible();

  // Borracha removes a mark of the active layer; Desfazer brings it back.
  await tools.getByRole('button', { name: /^Borracha/ }).click();
  await press(overlay, [0.4, 0.32]);
  await expect(pen).toHaveCount(0);
  await expect(highlight).toHaveCount(1);
  await undo.click();
  await expect(pen).toHaveCount(1);
  await expect.poll(async () => (await countRows(page)).annotations).toBe(3);
});

test('moves a text annotation with Mover and undoes the move', async ({ page }) => {
  await addPiece(page, 'Estudo movido', 'partitura-teste.pdf');
  await expectPainted(scorePage(page, 'partitura-teste'));
  const overlay = scoreOverlay(page);
  const tools = page.getByRole('group', { name: 'Ferramentas da partitura' });
  await tools.getByRole('button', { name: 'Texto', exact: true }).click();
  await press(overlay, [0.3, 0.2]);
  const textForm = page.getByRole('dialog', { name: 'Anotação na partitura' });
  await textForm.getByLabel('Texto').fill('crescendo');
  await textForm.getByRole('button', { name: 'Salvar anotação' }).click();
  const label = overlay.getByText('crescendo');
  await expect(label).toBeVisible();
  /** Centre of the text, as a fraction of the page. */
  const where = async () => {
    const [text, sheet] = [(await label.boundingBox())!, (await overlay.boundingBox())!];
    return {
      x: (text.x + text.width / 2 - sheet.x) / sheet.width,
      y: (text.y + text.height / 2 - sheet.y) / sheet.height,
    };
  };

  await tools.getByRole('button', { name: 'Selecionar e mover anotações' }).click();
  const start = await where();
  await drag(page, overlay, [start.x, start.y], [start.x + 0.3, start.y + 0.2]);
  await expect(page.getByText('Texto “crescendo” · Minhas notas')).toBeVisible();
  await expect.poll(async () => (await where()).x - start.x).toBeCloseTo(0.3, 1);
  expect((await where()).y - start.y).toBeCloseTo(0.2, 1);

  await page.getByRole('button', { name: 'Desfazer', exact: true }).click();
  await expect.poll(async () => (await where()).x - start.x).toBeCloseTo(0, 2);
});

test('fits the page, zooms and opens the score in full screen', async ({ page }) => {
  await addPiece(page, 'Leitura ampliada', 'partitura-teste.pdf');
  await expectPainted(scorePage(page, 'partitura-teste'));
  const size = page.getByRole('group', { name: 'Tamanho da partitura' });
  const zoomValue = size.getByText(/^\d+%$/);
  await expect(zoomValue).toHaveText('100%');

  await size.getByRole('button', { name: 'Página inteira' }).click();
  await expect(size.getByRole('button', { name: 'Página inteira' })).toHaveAttribute('aria-pressed', 'true');
  await expect(zoomValue).not.toHaveText('100%');
  await size.getByRole('button', { name: 'Ajustar à largura' }).click();
  await expect(zoomValue).toHaveText('100%');
  await size.getByRole('button', { name: 'Aumentar zoom' }).click();
  await expect(zoomValue).toHaveText('125%');
  await expectPainted(scorePage(page, 'partitura-teste'));

  await page.getByRole('button', { name: 'Tela cheia', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Partitura em tela cheia: partitura-teste' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('region', { name: 'Partitura: partitura-teste' })).toBeVisible();

  await page.getByRole('button', { name: 'Tela cheia', exact: true }).click();
  await page.getByRole('button', { name: 'Sair da tela cheia' }).click();
  await expect(page.getByRole('region', { name: 'Partitura: partitura-teste' })).toBeVisible();
  // The view (zoom) is remembered for this score.
  await page.reload();
  await expect(zoomValue).toHaveText('125%');
});

// BUG: notices ("Partitura salva neste dispositivo.", "Peça salva…", "Trecho salvo…") appear at the bottom
// centre of the window for 5 s, right over the bar under the score (Largura, Página inteira, zoom), which the
// viewer places at the bottom of the window. A tap there in the meantime hits the notice instead.
test.fixme('a notice does not cover the controls under the score', async ({ page }) => {
  await addPiece(page, 'Com aviso', 'partitura-teste.pdf');
  await expectPainted(scorePage(page, 'partitura-teste'));
  await page.getByLabel('Importar outra versão da partitura').setInputFiles(fixture('partitura-teste.pdf'));
  const notice = page.getByText('Partitura salva neste dispositivo.');
  await expect(notice).toBeVisible();
  const controls = page.getByRole('group', { name: 'Tamanho da partitura' }).getByRole('button');
  for (const control of await controls.all()) {
    const covered = await control.evaluate(element => {
      const box = element.getBoundingClientRect();
      const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
      return !!hit && !element.contains(hit);
    });
    expect(covered, `${await control.getAttribute('aria-label')} is covered by the notice`).toBe(false);
  }
  await expect(notice).toBeVisible();
});
