import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { imagesToPdf, isImageFile, isPdfFile, prepareDocuments } from '../src/files';
import {
  activityLabel,
  activityTarget,
  defaultDue,
  defaultLessonTitle,
  sortActivities,
} from '../src/lessons/activities';
import type { Piece, Segment, Task } from '../src/domain';

// A 1×1 white PNG, standing in for what the browser draws from a photo or screenshot.
const PNG = Uint8Array.from(
  atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg=='),
  c => c.charCodeAt(0),
);
const encode = async () => PNG;
const file = (name: string, type: string) => new File([new Uint8Array([1, 2, 3])], name, { type });
const pages = async (f: File) =>
  (await PDFDocument.load(new Uint8Array(await f.arrayBuffer()))).getPageCount();

describe('scores and exercises from images', () => {
  it('recognises PDFs and images by type or name', () => {
    expect(isPdfFile(file('a.pdf', ''))).toBe(true);
    expect(isImageFile(file('print.png', 'image/png'))).toBe(true);
    expect(isImageFile(file('foto.HEIC', ''))).toBe(true);
    expect(isImageFile(file('notas.txt', 'text/plain'))).toBe(false);
  });
  it('joins screenshots into one PDF, a page each', async () => {
    const pdf = await imagesToPdf(
      [file('p1.png', 'image/png'), file('p2.png', 'image/png')],
      'Estudo nº 7',
      encode,
    );
    expect(pdf.name).toBe('Estudo nº 7.pdf');
    expect(pdf.type).toBe('application/pdf');
    expect(await pages(pdf)).toBe(2);
  });
  it('keeps PDFs and a single common image as they are, and joins several images', async () => {
    const pdf = file('livro.pdf', 'application/pdf'),
      png = file('print.png', 'image/png');
    expect(await prepareDocuments([pdf], 'x', encode)).toEqual([pdf]);
    expect(await prepareDocuments([png], 'x', encode)).toEqual([png]);
    const [kept, joined] = await prepareDocuments(
      [pdf, png, file('print2.jpg', 'image/jpeg'), file('print3.webp', 'image/webp')],
      'Kinderszenen',
      encode,
    );
    expect(kept).toBe(pdf);
    expect(joined.name).toBe('Kinderszenen.pdf');
    expect(await pages(joined)).toBe(3);
    // A photo format not every browser shows becomes a PDF even alone.
    expect((await prepareDocuments([file('foto.heic', 'image/heic')], 'x', encode))[0].name).toBe('foto.pdf');
    await expect(prepareDocuments([file('notas.txt', 'text/plain')], 'x', encode)).rejects.toThrow(
      'não é um PDF nem uma imagem',
    );
  });
});

describe('activities of the week', () => {
  const pieces = [
    { id: 'schumann', title: 'Kinderszenen', warmup: undefined },
    { id: 'maiores', title: 'Escalas maiores', warmup: { kind: 'scales' } },
  ] as Piece[];
  const segments = [{ id: 'fa', pieceId: 'maiores', title: 'Fá maior' }] as Segment[];
  it('are due by the next lesson and named after its date', () => {
    expect(defaultDue('2026-09-22')).toBe('2026-09-29');
    expect(defaultDue('')).toBe('');
    expect(defaultLessonTitle('2026-09-22')).toBe('Aula de 22/9');
  });
  it('practise their exercise, their piece or their warm-up collection', () => {
    expect(activityTarget({ pieceId: 'maiores', segmentId: 'fa' }, pieces)).toEqual({
      kind: 'segment',
      id: 'fa',
    });
    expect(activityTarget({ pieceId: 'schumann' }, pieces)).toEqual({ kind: 'piece', id: 'schumann' });
    expect(activityTarget({ pieceId: 'maiores' }, pieces)).toEqual({ kind: 'warmup', id: 'maiores' });
    expect(activityTarget({ pieceId: '' }, pieces)).toBe(null);
    expect(activityLabel({ pieceId: 'maiores', segmentId: 'fa' }, pieces, segments)).toBe(
      'Escalas maiores · Fá maior',
    );
    expect(activityLabel({ pieceId: '' }, pieces, segments)).toBe('');
  });
  it('list pending ones first, by due date, then in the order written', () => {
    const t = (id: string, dueDate: string, done = false): Task => ({
      id,
      pieceId: '',
      title: id,
      done,
      dueDate,
      createdAt: id,
    });
    expect(
      sortActivities([
        t('c', ''),
        t('a', '2026-09-29', true),
        t('b', '2026-09-29'),
        t('d', '2026-09-24'),
      ]).map(x => x.id),
    ).toEqual(['d', 'b', 'c', 'a']);
  });
});
