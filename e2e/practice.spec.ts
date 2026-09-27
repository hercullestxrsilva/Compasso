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
