import { expect, test } from '@playwright/test';
import { addPiece, mainHeading, mainNav, seedLibrary } from './helpers';

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

test('a note typed but not saved is not thrown away without asking', async ({ page }) => {
  await addPiece(page, 'Com rascunho');
  await page.getByRole('tab', { name: 'Notas' }).click();
  const draft = page.getByLabel('Nova observação');
  await draft.fill('Pedal só no segundo tempo');

  await mainNav(page).getByRole('button', { name: 'Hoje' }).click();
  const ask = page.getByRole('dialog', { name: 'Sair sem salvar a nota?' });
  await expect(ask).toBeVisible();
  await ask.getByRole('button', { name: 'Continuar aqui' }).click();
  await expect(ask).toBeHidden();
  await expect(mainHeading(page)).toHaveText('Com rascunho');
  await expect(draft).toHaveValue('Pedal só no segundo tempo');
  // Back asks too.
  await page.goBack();
  await expect(ask).toBeVisible();
  await ask.getByRole('button', { name: 'Sair sem guardar' }).click();
  await expect(mainHeading(page)).toHaveText('Repertório');

  // In a lesson: its own back link and the sidebar ask, and a saved note leaves freely.
  await seedLibrary(page);
  await page.goto('/#/aulas/aula-seed');
  await expect(mainHeading(page)).toHaveText('Aula de setembro');
  const note = page.getByLabel('Nova anotação');
  await note.fill('Dedilhado 1-3-5 na subida');
  await page.getByRole('button', { name: 'Todas as aulas' }).click();
  const askLesson = page.getByRole('dialog', { name: 'Sair sem salvar a anotação?' });
  await expect(askLesson).toBeVisible();
  await askLesson.getByRole('button', { name: 'Continuar aqui' }).click();
  await mainNav(page).getByRole('button', { name: 'Evolução' }).click();
  await expect(askLesson).toBeVisible();
  await askLesson.getByRole('button', { name: 'Continuar aqui' }).click();
  await expect(note).toHaveValue('Dedilhado 1-3-5 na subida');
  await page.getByRole('button', { name: 'Salvar anotação' }).click();
  await expect(note).toHaveValue('');
  await mainNav(page).getByRole('button', { name: 'Evolução' }).click();
  await expect(mainHeading(page)).toHaveText('Sua evolução');
});
