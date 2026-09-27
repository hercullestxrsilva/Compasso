import { expect, test } from '@playwright/test';
import {
  addPiece,
  drag,
  expectPainted,
  mainHeading,
  mainNav,
  press,
  scoreOverlay,
  scorePage,
  seedLibrary,
} from './helpers';

test('marks a trecho, practises it with the metronome and finds the session in Evolução', async ({
  page,
}) => {
  await addPiece(page, 'Sonatina em Sol', 'partitura-teste.pdf');
  await expectPainted(scorePage(page, 'partitura-teste'));

  // Marcar trecho: drag a rectangle over the passage, then describe it.
  await page.getByRole('button', { name: 'Marcar trecho para praticar' }).click();
  await drag(page, scoreOverlay(page), [0.1, 0.36], [0.9, 0.45]);
  const segmentForm = page.getByRole('dialog', { name: 'Novo trecho de estudo' });
  await segmentForm.getByLabel('Nome do trecho').fill('Compassos 1 a 4');
  await segmentForm.getByLabel('Compassos').fill('1–4');
  await segmentForm.getByRole('button', { name: 'Salvar trecho' }).click();
  await expect(segmentForm).toBeHidden();

  // The trecho is drawn on the score; tapping it offers to practise it.
  const mark = scoreOverlay(page).getByRole('button', { name: 'Trecho Compassos 1 a 4' });
  await expect(mark).toBeVisible();
  await press(mark, [0.5, 0.5]);
  const sheet = page.getByRole('dialog', { name: 'Compassos 1 a 4' });
  await sheet.getByRole('button', { name: 'Praticar' }).click();
  await expect(page).toHaveURL(/#\/praticar\/[^/]+$/);
  await expect(mainHeading(page)).toHaveText('Hora de praticar');
  await expect(page.getByRole('heading', { level: 2, name: 'Compassos 1 a 4' })).toBeVisible();

  // A short cycle: 20 bars at 240 BPM (20 s), one repetition, no count-in.
  await page.getByRole('button', { name: 'Configurar ciclos' }).click();
  const cycle = page.getByRole('dialog', { name: 'Seu ciclo de prática' });
  await cycle.getByLabel('BPM inicial').fill('240');
  await cycle.getByLabel('Compassos por repetição').fill('20');
  await cycle.getByLabel(/^Repetições/).fill('1');
  await cycle.getByLabel('Compassos de preparação').fill('0');
  await cycle.getByLabel('Pausa entre repetições (s)').fill('0');
  await expect(cycle.getByText('0:20 de sessão · 0:20 de prática')).toBeVisible();
  await cycle.getByRole('button', { name: 'Aplicar' }).click();
  await expect(cycle).toBeHidden();

  await page.getByRole('button', { name: 'Iniciar prática' }).click();
  await expect(page.getByText('Em prática', { exact: true })).toBeVisible();
  // Past 6 s, above the 5 s a session needs to be kept, and well before the end: then stop it.
  const progress = page.getByRole('progressbar', { name: 'Progresso da sessão' });
  await expect
    .poll(async () => Number(await progress.getAttribute('aria-valuenow')), { timeout: 20_000 })
    .toBeGreaterThanOrEqual(30);
  await page.getByRole('button', { name: 'Encerrar', exact: true }).click();

  const review = page.getByRole('dialog', { name: 'Como foi a prática?' });
  await expect(review.getByText('A sessão foi salva como parcial.')).toBeVisible();
  await review.getByRole('button', { name: 'Melhorando' }).click();
  await review.getByLabel('O que você percebeu?').fill('A mão esquerda ficou mais leve.');
  await review.getByLabel('Próximo passo').fill('Tocar com o pedal.');
  await review.getByRole('button', { name: 'Salvar' }).click();
  await expect(review).toBeHidden();
  await expect(page.getByText(/^Reflexão salva/)).toBeVisible();

  await mainNav(page).getByRole('button', { name: 'Evolução' }).click();
  await expect(page).toHaveURL(/#\/evolucao$/);
  await expect(mainHeading(page)).toHaveText('Sua evolução');
  const session = page.locator('.history-row').filter({ hasText: 'Compassos 1 a 4' });
  await expect(session).toHaveCount(1);
  await expect(session.getByText('A mão esquerda ficou mais leve.')).toBeVisible();
  await expect(session.getByText('Tocar com o pedal.')).toBeVisible();
  await expect(session.getByText('Melhorando')).toBeVisible();
  await expect(session.getByText(/240 BPM/)).toBeVisible();

  // Hoje counts the session and suggests the next step written in the review.
  await mainNav(page).getByRole('button', { name: 'Hoje' }).click();
  await expect(mainHeading(page)).toHaveText('Hoje, ao piano.');
  await expect(page.getByText('1 sessão registrada')).toBeVisible();
  await expect(page.getByText('Próximo passo: Tocar com o pedal.')).toBeVisible();
});

test('leaving the screen during a timer-only practice saves the session first', async ({ page }) => {
  await page.goto('/#/praticar');
  await expect(mainHeading(page)).toHaveText('Hora de praticar');
  await page.getByRole('button', { name: 'Só cronômetro' }).click();
  await page.getByRole('button', { name: 'Configurar ciclos' }).click();
  const cycle = page.getByRole('dialog', { name: 'Seu ciclo de prática' });
  await cycle.getByLabel('Segundos por repetição').fill('20');
  await cycle.getByLabel(/^Repetições/).fill('1');
  await cycle.getByLabel('Pausa entre repetições (s)').fill('0');
  await expect(cycle.getByText('0:20 de sessão · 0:20 de prática')).toBeVisible();
  await cycle.getByRole('button', { name: 'Aplicar' }).click();

  await page.getByRole('button', { name: 'Iniciar prática' }).click();
  // 6 s in: enough to be kept (5 s), with time left to leave in the middle of the session.
  const progress = page.getByRole('progressbar', { name: 'Progresso da sessão' });
  await expect
    .poll(async () => Number(await progress.getAttribute('aria-valuenow')), { timeout: 20_000 })
    .toBeGreaterThanOrEqual(30);

  // Evolução is another screen: the app asks, ends the practice, and moves on once it has been rated.
  await mainNav(page).getByRole('button', { name: 'Evolução' }).click();
  const leave = page.getByRole('dialog', { name: 'Prática em andamento' });
  await expect(leave.getByText('Prática · Prática livre')).toBeVisible();
  await leave.getByRole('button', { name: 'Encerrar e sair' }).click();
  const review = page.getByRole('dialog', { name: 'Como foi a prática?' });
  await expect(review.getByText('A sessão foi salva como parcial.')).toBeVisible();
  await expect(page).toHaveURL(/#\/praticar$/);
  await review.getByRole('button', { name: 'Pular' }).click();

  await expect(page).toHaveURL(/#\/evolucao$/);
  await expect(mainHeading(page)).toHaveText('Sua evolução');
  const session = page.locator('.history-row').filter({ hasText: 'Prática livre' });
  await expect(session).toHaveCount(1);
  await expect(session.getByText(/Sem metrônomo/)).toBeVisible();
});

test('Space pauses and continues after the score buttons are clicked, also in full screen', async ({
  page,
}) => {
  await page.goto('/');
  await seedLibrary(page);
  await page.goto('/#/praticar/trecho-seed');
  await expect(mainHeading(page)).toHaveText('Hora de praticar');
  // Trechos are marked on the piece's page: the practice score does not offer a tool it cannot complete.
  await expect(page.getByRole('button', { name: 'Caneta', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Marcar trecho para praticar' })).toHaveCount(0);

  await page.getByRole('button', { name: 'Iniciar prática' }).click();
  await expect(page.getByText('Em prática', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Tela cheia', exact: true }).click();
  const viewer = page.getByRole('region', { name: 'Partitura em tela cheia: partitura-teste' });
  await expect(viewer).toBeVisible();

  await page.keyboard.press('Space');
  await expect(viewer.getByRole('button', { name: 'Continuar' })).toBeVisible();
  await page.keyboard.press('Space');
  await expect(viewer.getByRole('button', { name: 'Pausar' })).toBeVisible();
  await expect(viewer).toBeVisible();

  // A view toggle clicked with the mouse keeps the focus, but Space still belongs to the practice.
  await viewer.getByRole('button', { name: 'Ver página inteira' }).click();
  const toggle = viewer.getByRole('button', { name: 'Focar no trecho' });
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await page.keyboard.press('Space');
  await expect(viewer.getByRole('button', { name: 'Continuar' })).toBeVisible();
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  // Reached with the keyboard, a control keeps its own Space.
  await toggle.focus();
  await page.keyboard.press('Tab');
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Space');
  await expect(viewer.getByRole('button', { name: 'Ver página inteira' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(viewer.getByRole('button', { name: 'Continuar' })).toBeVisible();
});

test('a microphone that cannot be opened is explained in Portuguese', async ({ page }) => {
  await page.goto('/#/praticar');
  await expect(mainHeading(page)).toHaveText('Hora de praticar');
  // The test browsers have no microphone (or no permission to use it).
  await page.getByRole('button', { name: 'Gravar tentativa' }).click();
  const message = page.locator('.attempt-recorder').getByRole('alert');
  await expect(message).toContainText('microfone');
  await expect(message).toContainText('importar um arquivo de áudio');
  await expect(message).not.toContainText(/permission|denied|not found|device/i);
});

test('the cycle dialog footer reaches the bottom edge, with nothing scrolling under it', async ({ page }) => {
  await page.goto('/#/praticar');
  await page.getByRole('button', { name: 'Configurar ciclos' }).click();
  const cycle = page.getByRole('dialog', { name: 'Seu ciclo de prática' });
  await expect(cycle).toBeVisible();
  const gap = await cycle.evaluate(dialog => {
    const footer = dialog.querySelector('footer')!.getBoundingClientRect();
    return dialog.getBoundingClientRect().bottom - dialog.clientTop - footer.bottom;
  });
  expect(gap).toBeLessThanOrEqual(1);
  // Scrolled to the end, the footer stays where it was and the last field is above it.
  await cycle.evaluate(dialog => dialog.scrollTo({ top: dialog.scrollHeight }));
  await expect(cycle.getByRole('button', { name: 'Aplicar' })).toBeInViewport();
});

test('a routine in full screen rates each step there and comes back to full screen after a step without a score', async ({
  page,
}) => {
  await page.goto('/');
  await seedLibrary(page);
  // Short steps: the trecho's cycle is 2 bars at 240 BPM (2 s) with no count-in, repeated to fill about 6 s.
  await page.evaluate(async () => {
    const dbModule = '/src/db.ts';
    const { db } = await import(/* @vite-ignore */ dbModule);
    await db.segments.update('trecho-seed', {
      bpm: 240,
      practiceConfig: { bars: 2, countInBars: 0, restSeconds: 0, repetitions: 1, mode: 'bars' },
    });
    const step = { segmentId: 'trecho-seed', minutes: 0.1 };
    await db.routines.add({
      id: 'rotina-curta',
      title: 'Rotina curta',
      items: [step, step, { label: 'Escalas', minutes: 0.1 }, step],
    });
  });
  await page.goto('/#/praticar/trecho-seed');
  await page.getByRole('button', { name: 'Rotinas de estudo' }).click();
  await page
    .getByRole('dialog', { name: 'Rotinas de estudo' })
    .locator('.routine-card')
    .filter({ hasText: 'Rotina curta' })
    .getByRole('button', { name: 'Começar rotina' })
    .click();
  await page.getByRole('button', { name: 'Tela cheia', exact: true }).click();
  const viewer = page.getByRole('region', { name: /^Partitura em tela cheia/ });
  const console = page.locator('.practice-console');
  await expect(viewer).toBeVisible();

  // Step 1 ends: the overlay on the score offers the one-tap rating of the console hidden behind it.
  await expect(viewer.getByText('Como foi “Entrada da mão esquerda”?')).toBeVisible({ timeout: 20_000 });
  await viewer.getByRole('button', { name: 'Melhorando' }).click();
  await expect(viewer.getByRole('button', { name: 'Melhorando' })).toHaveAttribute('aria-pressed', 'true');
  await expect(viewer.getByText(/^Próxima revisão deste trecho:/)).toBeVisible();
  await viewer.getByRole('button', { name: 'Começar passo 2' }).click();

  // Step 3 is "Escalas", with no score: the console shows it, and step 4 opens the score in full screen again.
  await expect(console.getByRole('button', { name: 'Começar passo 3' })).toBeVisible({ timeout: 20_000 });
  await expect(viewer).toBeHidden();
  await console.getByRole('button', { name: 'Começar passo 3' }).click();
  await expect(viewer.getByText('Como foi “Escalas”?')).toBeVisible({ timeout: 20_000 });
  await viewer.getByRole('button', { name: 'Começar passo 4' }).click();
  await expect(viewer.getByRole('button', { name: 'Pausar' })).toBeVisible();
});
