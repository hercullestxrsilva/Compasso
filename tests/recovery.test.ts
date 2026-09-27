import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import { db, removePiece } from '../src/db';
import { clearCapture, recoverCapture } from '../src/components/Recorder';
import {
  defaultDestination,
  recoverCaptureToAttempt,
  recoverCaptureToLesson,
} from '../src/components/CaptureRecovery';
import { saveLessonDetails } from '../src/components/Lessons';
afterEach(async () => {
  await Promise.all(db.tables.map(t => t.clear()));
});
async function interrupted(origin: Partial<import('../src/domain').Capture> = {}) {
  await db.captures.put({
    id: 'capture',
    title: 'Gravação 26-09-2026 14h03',
    mime: 'audio/webm',
    createdAt: '2026-09-26T17:03:00.000Z',
    ...origin,
  });
  await db.captureChunks.bulkPut([
    { id: 'c1', captureId: 'capture', index: 1, blob: new Blob(['B']) },
    { id: 'c0', captureId: 'capture', index: 0, blob: new Blob(['A']) },
  ]);
}
const lesson = (assetId?: string) => ({
  id: 'lesson',
  title: 'Aula de interpretação',
  date: '2026-09-26',
  teacher: '',
  pieceId: '',
  assetId,
  transcript: '',
  summary: '',
  createdAt: '2026-09-26',
});
describe('recovering interrupted captures', () => {
  it('replaces the lesson audio and removes the capture', async () => {
    await interrupted({ origin: 'lesson', lessonId: 'lesson' });
    await db.assets.put({
      id: 'old',
      name: 'antiga.webm',
      mime: 'audio/webm',
      size: 1,
      blob: new Blob(['x']),
      createdAt: '2026-09-20',
    });
    await db.lessons.put(lesson('old'));
    await recoverCaptureToLesson('capture', 'lesson');
    const saved = await db.lessons.get('lesson');
    expect(saved?.assetId).not.toBe('old');
    expect(await db.assets.get('old')).toBeUndefined();
    const asset = await db.assets.get(saved!.assetId!);
    expect(asset?.name).toBe('Gravação 26-09-2026 14h03.webm');
    expect(await asset!.blob.text()).toBe('AB');
    expect(await db.captures.count()).toBe(0);
    expect(await db.captureChunks.count()).toBe(0);
  });
  it('keeps the capture when the lesson no longer exists', async () => {
    await interrupted({ origin: 'lesson', lessonId: 'gone' });
    await expect(recoverCaptureToLesson('capture', 'gone')).rejects.toThrow('não existe mais');
    expect(await db.captureChunks.count()).toBe(2);
    expect(await db.assets.count()).toBe(0);
  });
  it('turns an attempt into a practice recording linked to its segment', async () => {
    await interrupted({ origin: 'attempt', segmentId: 'segment' });
    await db.segments.put({
      id: 'segment',
      pieceId: 'piece',
      scoreId: 'score',
      title: 'Entrada da mão esquerda',
      measures: '1-8',
      goal: '',
      difficulty: '',
      hand: 'left',
      regions: [],
      bpm: 60,
      reviewDate: '2026-09-26',
      createdAt: '2026-09-26',
    });
    await recoverCaptureToAttempt('capture', 'segment');
    const [recording] = await db.recordings.toArray();
    expect(recording.segmentId).toBe('segment');
    expect(recording.createdAt).toBe('2026-09-26T17:03:00.000Z');
    expect(recording.title).toContain('Entrada da mão esquerda');
    expect(await (await db.assets.get(recording.assetId))!.blob.text()).toBe('AB');
    expect(await db.captures.count()).toBe(0);
  });
  it('suggests the original place, and nothing for captures without origin', () => {
    const capture = { id: 'c', title: 't', mime: 'audio/webm', createdAt: '2026-09-26' };
    const lessons = [{ id: 'lesson' }],
      segments = [{ id: 'segment' }];
    expect(defaultDestination({ ...capture, origin: 'lesson', lessonId: 'lesson' }, lessons, segments)).toBe(
      'lesson:lesson',
    );
    expect(defaultDestination({ ...capture, origin: 'lesson', lessonId: 'gone' }, lessons, segments)).toBe(
      '',
    );
    expect(
      defaultDestination({ ...capture, origin: 'attempt', segmentId: 'segment' }, lessons, segments),
    ).toBe('attempt:segment');
    expect(defaultDestination({ ...capture, origin: 'attempt', segmentId: 'gone' }, lessons, segments)).toBe(
      'attempt:',
    );
    // A practice take recorded without origin must not become a lesson's audio in one tap.
    expect(defaultDestination(capture, lessons, segments)).toBe('');
  });
});
describe('editing a lesson', () => {
  it('moves the notes and tasks it created when its piece changes', async () => {
    await db.lessons.put(lesson());
    await db.notes.bulkPut([
      { id: 'n1', lessonId: 'lesson', text: 'Pulso solto', source: 'mine', createdAt: '2026-09-26' },
      { id: 'n2', pieceId: 'other', text: 'Outra peça', source: 'mine', createdAt: '2026-09-26' },
    ]);
    await db.tasks.put({
      id: 't1',
      pieceId: '',
      lessonId: 'lesson',
      title: 'Mão esquerda sozinha',
      done: false,
      dueDate: '',
      createdAt: '2026-09-26',
    });
    await saveLessonDetails(lesson(), {
      title: 'Aula 2',
      date: '2026-09-27',
      teacher: 'Ana',
      pieceId: 'piece',
    });
    expect(await db.lessons.get('lesson')).toMatchObject({
      title: 'Aula 2',
      teacher: 'Ana',
      pieceId: 'piece',
    });
    expect((await db.notes.get('n1'))?.pieceId).toBe('piece');
    expect((await db.notes.get('n2'))?.pieceId).toBe('other');
    expect((await db.tasks.get('t1'))?.pieceId).toBe('piece');
  });
});
describe('recording and relation recovery', () => {
  it('reassembles stored chunks in capture order', async () => {
    await db.captures.put({ id: 'capture', title: 'teste', mime: 'audio/webm', createdAt: '2026-09-26' });
    await db.captureChunks.bulkPut([
      { id: 'second', captureId: 'capture', index: 1, blob: new Blob(['B']) },
      { id: 'first', captureId: 'capture', index: 0, blob: new Blob(['A']) },
    ]);
    expect(await (await recoverCapture('capture')).text()).toBe('AB');
    await clearCapture('capture');
    expect(await db.captureChunks.count()).toBe(0);
  });
  it('does not erase lesson notes when deleting a related piece', async () => {
    await db.pieces.put({
      id: 'piece',
      title: 'Teste',
      composer: '',
      status: 'studying',
      tags: '',
      createdAt: '2026-09-26',
      updatedAt: '2026-09-26',
    });
    await db.notes.bulkPut([
      {
        id: 'lesson-note',
        pieceId: 'piece',
        lessonId: 'lesson',
        text: 'Keep this lesson note',
        source: 'mine',
        createdAt: '2026-09-26',
      },
      { id: 'piece-note', pieceId: 'piece', text: 'Piece note', source: 'mine', createdAt: '2026-09-26' },
    ]);
    await removePiece('piece');
    expect((await db.notes.get('lesson-note'))?.text).toBe('Keep this lesson note');
    expect((await db.notes.get('lesson-note'))?.pieceId).toBeUndefined();
    expect(await db.notes.get('piece-note')).toBeUndefined();
  });
});
