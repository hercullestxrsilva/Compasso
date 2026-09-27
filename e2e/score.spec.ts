import { expect, test, type Page } from '@playwright/test';
import {
  addPiece,
  countRows,
  drag,
  expectPainted,
  fixture,
  mainHeading,
  mainNav,
  press,
  scoreOverlay,
  scorePage,
} from './helpers';

/** A tap on the iPad project, a click on the desktop one, at a point of the page. */
async function pressAt(page: Page, { x, y }: { x: number; y: number }) {
  if (test.info().project.use.hasTouch) await page.touchscreen.tap(x, y);
  else await page.mouse.click(x, y);
}

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

// Notices ("Partitura salva neste dispositivo.") appear at the bottom centre of the window for 5 s. The viewer
// places its bar (Largura, Página inteira, zoom) at the bottom of the window, so notices rise above it.
test('a notice does not cover the controls under the score', async ({ page }) => {
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

test('the Texto tool opens its dialog with the caret in the text field, wherever the page is pressed', async ({
  page,
}) => {
  await addPiece(page, 'Com dedilhado', 'partitura-teste.pdf');
  await expectPainted(scorePage(page, 'partitura-teste'));
  const overlay = scoreOverlay(page);
  await page
    .getByRole('group', { name: 'Ferramentas da partitura' })
    .getByRole('button', { name: 'Texto', exact: true })
    .click();
  const textForm = page.getByRole('dialog', { name: 'Anotação na partitura' });
  const field = textForm.getByLabel('Texto');
  await press(overlay, [0.5, 0.2]);
  await expect(field).toBeFocused();
  // Where the dialog's own controls will appear. The press that places a note must not reach them: the
  // font size field would take the focus, and Cancelar would close the dialog at once.
  const centre = async (name: string) => {
    const box = (await textForm
      .getByRole(name === 'Cancelar' ? 'button' : 'spinbutton', { name })
      .boundingBox())!;
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  };
  const spots = [await centre('Tamanho da fonte'), await centre('Cancelar')];
  await page.keyboard.press('Escape');
  await expect(textForm).toBeHidden();
  for (const spot of spots) {
    const onScore = await overlay.evaluate(
      (svg, { x, y }) => svg.contains(document.elementFromPoint(x, y)),
      spot,
    );
    expect(onScore, 'the spot is on the score').toBe(true);
    await pressAt(page, spot);
    await expect(textForm).toBeVisible();
    await expect(field).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(textForm).toBeHidden();
  }

  await pressAt(page, spots[0]);
  await page.keyboard.type('dedilhado 1-2-4');
  await page.keyboard.press('Enter');
  await expect(textForm).toBeHidden();
  await expect(overlay.getByText('dedilhado 1-2-4')).toBeVisible();
});

test('going back from a score in full screen also leaves the browser full screen', async ({ page }) => {
  await addPiece(page, 'Tela cheia e voltar', 'partitura-teste.pdf');
  await expectPainted(scorePage(page, 'partitura-teste'));
  await page.getByRole('button', { name: 'Tela cheia', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Partitura em tela cheia: partitura-teste' })).toBeVisible();
  const native = await page.evaluate(() => document.fullscreenElement !== null);
  test.skip(!native, 'This browser kept the full screen inside the page (CSS), as iPad Safari does.');

  await page.goBack();
  await expect(mainHeading(page)).toHaveText('Repertório');
  await expect.poll(() => page.evaluate(() => document.fullscreenElement === null)).toBe(true);
});

test('two fingers pan a zoomed score with any tool, and one finger still draws', async ({ page }) => {
  test.skip(!test.info().project.use.hasTouch, 'A touch gesture.');
  await addPiece(page, 'Ampliada no iPad', 'partitura-teste.pdf');
  await expectPainted(scorePage(page, 'partitura-teste'));
  const zoomIn = page
    .getByRole('group', { name: 'Tamanho da partitura' })
    .getByRole('button', { name: 'Aumentar zoom' });
  await zoomIn.click();
  await zoomIn.click();
  const scroller = page.locator('.score-scroll');
  const tools = page.getByRole('group', { name: 'Ferramentas da partitura' });
  const box = (await scroller.boundingBox())!;
  const x = box.x + box.width / 2,
    y = box.y + box.height * 0.7;
  const cdp = await page.context().newCDPSession(page);
  /** Two fingers, 120 px apart, dragged 300 px up one step per frame. */
  const twoFingerDrag = async () => {
    const start = Date.now() / 1000;
    const at = (dy: number) => [
      { x: x - 60, y: y + dy, id: 1 },
      { x: x + 60, y: y + dy, id: 2 },
    ];
    const send = (type: 'touchStart' | 'touchMove' | 'touchEnd', dy: number | null, frame: number) =>
      cdp.send('Input.dispatchTouchEvent', {
        type,
        touchPoints: dy === null ? [] : at(dy),
        timestamp: start + frame * 0.016,
      });
    await send('touchStart', 0, 0);
    for (let i = 1; i <= 10; i++) await send('touchMove', -30 * i, i);
    await send('touchMove', -300, 20);
    await send('touchEnd', null, 21);
  };
  for (const tool of ['Caneta', 'Marca-texto', 'Selecionar e mover anotações', /^Borracha/, /^Navegar/]) {
    await tools.getByRole('button', { name: tool, exact: typeof tool === 'string' }).click();
    await scroller.evaluate(element => element.scrollTo({ top: 300 }));
    await twoFingerDrag();
    await expect
      .poll(() => scroller.evaluate(element => element.scrollTop), { message: `${tool} pans` })
      .toBeGreaterThan(450);
  }
  await cdp.detach();
  // Two fingers left no ink behind; one finger with the pen draws, as before.
  expect((await countRows(page)).annotations).toBe(0);
  await tools.getByRole('button', { name: 'Caneta', exact: true }).click();
  await drag(page, scroller, [0.3, 0.4], [0.5, 0.42]);
  await expect.poll(async () => (await countRows(page)).annotations).toBe(1);
});
