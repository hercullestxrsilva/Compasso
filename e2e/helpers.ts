import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test, type Locator, type Page } from '@playwright/test';

/** Absolute path of a file in tests/fixtures. */
export const fixture = (name: string) => fileURLToPath(new URL(`../tests/fixtures/${name}`, import.meta.url));

export const mainHeading = (page: Page) => page.getByRole('heading', { level: 1 });
export const mainNav = (page: Page) => page.getByRole('navigation', { name: 'Navegação principal' });

/**
 * Adds a piece through Repertório › Adicionar peça, optionally with a score from tests/fixtures, and waits
 * for its page to open. Returns the piece id read from the address (#/repertorio/<id>).
 */
export async function addPiece(page: Page, title: string, score?: string) {
  await page.goto('/#/repertorio');
  await expect(mainHeading(page)).toHaveText('Repertório');
  await page.getByRole('button', { name: 'Adicionar peça', exact: true }).click();
  const form = page.getByRole('dialog', { name: 'Adicionar ao repertório' });
  await form.getByLabel('Nome da peça').fill(title);
  if (score) await form.getByLabel('Partitura (opcional)').setInputFiles(fixture(score));
  await form.getByRole('button', { name: 'Adicionar peça' }).click();
  await expect(form).toBeHidden();
  await expect(mainHeading(page)).toHaveText(title);
  const id = /#\/repertorio\/([^/]+)$/.exec(page.url())?.[1];
  expect(id, 'the piece page has its own address').toBeTruthy();
  return decodeURIComponent(id!);
}

/** The rendered page of a score, e.g. "Partitura partitura-teste, página 1 de 2". */
export const scorePage = (page: Page, title: string, pageNumber = 1, pages = 2) =>
  page.getByRole('img', { name: `Partitura ${title}, página ${pageNumber} de ${pages}` });

/** The SVG layer over the score that holds annotations and trechos. */
export const scoreOverlay = (page: Page) => page.getByRole('group', { name: 'Anotações e trechos' });

/** Waits until the canvas shows ink: enough dark pixels that the page is not blank. */
export async function expectPainted(canvas: Locator) {
  await expect
    .poll(
      () =>
        canvas.evaluate((element: HTMLCanvasElement) => {
          const { width, height } = element;
          if (!width || !height) return 0;
          const data = element.getContext('2d')!.getImageData(0, 0, width, height).data;
          let dark = 0;
          for (let i = 0; i < data.length; i += 4)
            if (data[i + 3] > 200 && data[i] + data[i + 1] + data[i + 2] < 3 * 160) dark++;
          return dark / (width * height);
        }),
      { message: 'the score page has visible ink' },
    )
    .toBeGreaterThan(0.002);
}

const usesTouch = () => !!test.info().project.use.hasTouch;

/** A point of an element given as fractions of its box, in page coordinates. */
async function pointIn(target: Locator, [fx, fy]: readonly [number, number]) {
  const box = await target.boundingBox();
  if (!box) throw new Error('The element is not on screen.');
  return { x: box.x + fx * box.width, y: box.y + fy * box.height };
}

/** A tap on the iPad project, a click on the desktop one; `at` is a fraction of the element's box. */
export async function press(target: Locator, at: readonly [number, number]) {
  const box = await target.boundingBox();
  if (!box) throw new Error('The element is not on screen.');
  const position = { x: at[0] * box.width, y: at[1] * box.height };
  if (usesTouch()) await target.tap({ position });
  else await target.click({ position });
}

/**
 * Drags across an element from one point to another (fractions of its box): a finger on the iPad project,
 * the mouse on the desktop one. Playwright has no touch drag, so the finger goes through the DevTools
 * protocol, which Chrome and Edge both speak.
 */
export async function drag(
  page: Page,
  target: Locator,
  from: readonly [number, number],
  to: readonly [number, number],
) {
  const a = await pointIn(target, from),
    b = await pointIn(target, to);
  const steps = 8;
  const along = (i: number) => ({ x: a.x + ((b.x - a.x) * i) / steps, y: a.y + ((b.y - a.y) * i) / steps });
  if (!usesTouch()) {
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    for (let i = 1; i <= steps; i++) await page.mouse.move(along(i).x, along(i).y);
    await page.mouse.up();
    return;
  }
  // The finger moves one step per frame (16 ms) and rests at the end before lifting. Events sent all at once
  // would look like a fling to Chrome, which then swallows the next tap to stop it.
  const cdp = await page.context().newCDPSession(page);
  const start = Date.now() / 1000;
  const touch = (
    type: 'touchStart' | 'touchMove' | 'touchEnd',
    points: { x: number; y: number }[],
    frame: number,
  ) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points, timestamp: start + frame * 0.016 });
  try {
    await touch('touchStart', [a], 0);
    for (let i = 1; i <= steps; i++) await touch('touchMove', [along(i)], i);
    await touch('touchMove', [b], steps + 10);
    await touch('touchEnd', [], steps + 11);
  } finally {
    await cdp.detach();
  }
}

/*
 * The two helpers below reach the app's IndexedDB through its own database module (src/db.ts), which the
 * Vite dev server serves at /src/db.ts. The path is a variable so TypeScript and Vite leave the import alone.
 */

/** Rows in each table of the app's database ('compasso-piano'). */
export function countRows(page: Page): Promise<Record<string, number>> {
  return page.evaluate(async () => {
    const dbModule = '/src/db.ts';
    const { db } = await import(/* @vite-ignore */ dbModule);
    const tables: { name: string; count: () => Promise<number> }[] = db.tables;
    return Object.fromEntries(
      await Promise.all(tables.map(async table => [table.name, await table.count()])),
    );
  });
}

/**
 * Fills the library with one record of every kind a backup carries: piece, score with its PDF, annotation,
 * trecho, preset, session, lesson with its audio, note, task, recording and routine.
 */
export async function seedLibrary(page: Page) {
  const pdf = [...readFileSync(fixture('partitura-teste.pdf'))],
    wav = [...readFileSync(fixture('audio-teste.wav'))];
  await page.evaluate(
    async ({ pdf, wav }) => {
      const dbModule = '/src/db.ts';
      const { db } = await import(/* @vite-ignore */ dbModule);
      const now = new Date(),
        at = now.toISOString();
      // Today in the browser's time zone, as the app writes dates (YYYY-MM-DD).
      const day = [now.getFullYear(), now.getMonth() + 1, now.getDate()]
        .map(n => String(n).padStart(2, '0'))
        .join('-');
      const config = {
        bpm: 72,
        numerator: 4,
        denominator: 4,
        beatUnit: 'quarter',
        subdivision: 1,
        mode: 'bars',
        bars: 4,
        seconds: 60,
        repetitions: 3,
        countInBars: 1,
        restSeconds: 5,
        increaseEvery: 0,
        increaseBpm: 2,
        targetBpm: 90,
        silentBars: 0,
        audibleBars: 4,
      };
      const file = (bytes: number[], name: string, mime: string) => ({
        id: crypto.randomUUID(),
        name,
        mime,
        size: bytes.length,
        blob: new Blob([new Uint8Array(bytes)], { type: mime }),
        createdAt: at,
      });
      const score = file(pdf, 'partitura-teste.pdf', 'application/pdf'),
        lessonAudio = file(wav, 'aula.wav', 'audio/wav'),
        take = file(wav, 'tentativa.wav', 'audio/wav');
      const ids = {
        piece: 'peca-seed',
        score: 'partitura-seed',
        segment: 'trecho-seed',
        lesson: 'aula-seed',
      };
      await db.transaction('rw', db.tables, async () => {
        await db.assets.bulkAdd([score, lessonAudio, take]);
        await db.pieces.add({
          id: ids.piece,
          title: 'Invenção nº 1',
          composer: 'J. S. Bach',
          status: 'studying',
          tags: 'barroco',
          createdAt: at,
          updatedAt: at,
        });
        await db.scores.add({
          id: ids.score,
          pieceId: ids.piece,
          assetId: score.id,
          title: 'partitura-teste',
          createdAt: at,
        });
        await db.annotations.add({
          id: crypto.randomUUID(),
          scoreId: ids.score,
          page: 1,
          layer: 'Professor',
          kind: 'text',
          color: '#c0392b',
          width: 2.4,
          points: [{ x: 0.3, y: 0.3 }],
          text: 'respirar aqui',
          fontSize: 24,
          createdAt: at,
        });
        await db.segments.add({
          id: ids.segment,
          pieceId: ids.piece,
          scoreId: ids.score,
          title: 'Entrada da mão esquerda',
          measures: '1–4',
          goal: 'Legato',
          difficulty: 'Ritmo',
          hand: 'left',
          regions: [{ page: 1, x: 0.1, y: 0.35, w: 0.8, h: 0.1 }],
          bpm: 72,
          reviewDate: day,
          createdAt: at,
        });
        await db.presets.add({ id: crypto.randomUUID(), name: 'Lento', segmentId: ids.segment, config });
        await db.sessions.add({
          id: crypto.randomUUID(),
          pieceId: ids.piece,
          segmentId: ids.segment,
          kind: 'segment',
          title: 'Entrada da mão esquerda',
          hand: 'left',
          config,
          startedAt: at,
          endedAt: at,
          activeSeconds: 120,
          completedRepetitions: 3,
          rating: 'improving',
          note: 'Mais leve no polegar.',
          completed: true,
        });
        await db.lessons.add({
          id: ids.lesson,
          title: 'Aula de setembro',
          date: day,
          teacher: 'Ana',
          pieceId: ids.piece,
          assetId: lessonAudio.id,
          transcript: '',
          summary: '',
          createdAt: at,
        });
        await db.notes.add({
          id: crypto.randomUUID(),
          lessonId: ids.lesson,
          pieceId: ids.piece,
          text: 'Pulso firme',
          source: 'mine',
          timestamp: 1.5,
          createdAt: at,
        });
        await db.tasks.add({
          id: crypto.randomUUID(),
          pieceId: ids.piece,
          segmentId: ids.segment,
          title: 'Mão esquerda sozinha',
          done: false,
          dueDate: '',
          createdAt: at,
        });
        await db.recordings.add({
          id: crypto.randomUUID(),
          assetId: take.id,
          segmentId: ids.segment,
          title: 'Tentativa',
          createdAt: at,
          bpm: 72,
          hand: 'left',
        });
        await db.routines.add({
          id: crypto.randomUUID(),
          title: 'Aquecimento',
          items: [
            { segmentId: ids.segment, minutes: 5 },
            { label: 'Escalas', minutes: 3 },
          ],
        });
      });
    },
    { pdf, wav },
  );
}
