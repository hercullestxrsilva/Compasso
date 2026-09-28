import { expect, test } from '@playwright/test';
import { mainHeading, mainNav } from './helpers';

// Chrome's built-in fake camera and microphone: the whole flow runs without real devices.
test.use({
  launchOptions: { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] },
  permissions: ['camera', 'microphone'],
});

test('records a video of the practice and keeps it in the app', async ({ page }) => {
  await page.goto('/#/praticar');
  await expect(mainHeading(page)).toHaveText('Hora de praticar');
  await page.getByRole('button', { name: 'Gravar vídeo' }).click();
  const dialog = page.getByRole('dialog', { name: 'Gravar vídeo' });
  // The preview shows the camera, and the cameras on the system are listed.
  await expect
    .poll(() => dialog.getByLabel('Imagem da câmera').evaluate((v: HTMLVideoElement) => v.videoWidth))
    .toBeGreaterThan(0);
  await expect(dialog.getByLabel('Câmera').locator('option')).not.toHaveCount(0);

  // A browser that can write into folders offers one; this test keeps the video in the app.
  const inApp = dialog.getByRole('radio', { name: /Neste app/ });
  if (await inApp.count()) await inApp.check();
  await dialog.getByRole('button', { name: 'Gravar', exact: true }).click();
  await expect(dialog.getByRole('timer')).toBeVisible();
  await page.waitForTimeout(2500);
  await dialog.getByRole('button', { name: /^Parar ·/ }).click();
  await expect(dialog.getByText(/foi guardado no app/)).toBeVisible();
  await dialog.getByRole('button', { name: 'Fechar', exact: true }).last().click();

  await mainNav(page).getByRole('button', { name: 'Evolução' }).click();
  await page.getByRole('tab', { name: 'Minhas gravações' }).click();
  const video = page.locator('video.recording-video');
  await expect(video).toHaveCount(1);
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.readyState)).toBeGreaterThan(0);
});
