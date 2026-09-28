import Dexie, { type Table } from 'dexie';
import type {
  Piece,
  Asset,
  Score,
  Annotation,
  Segment,
  Preset,
  Session,
  Lesson,
  Note,
  Task,
  Recording,
  Routine,
  Capture,
} from './domain';
class PianoDB extends Dexie {
  pieces!: Table<Piece>;
  assets!: Table<Asset>;
  scores!: Table<Score>;
  annotations!: Table<Annotation>;
  segments!: Table<Segment>;
  presets!: Table<Preset>;
  sessions!: Table<Session>;
  lessons!: Table<Lesson>;
  notes!: Table<Note>;
  tasks!: Table<Task>;
  recordings!: Table<Recording>;
  routines!: Table<Routine>;
  captures!: Table<Capture>;
  captureChunks!: Table<{ id: string; captureId: string; index: number; blob: Blob }>;
  /** Device-only handles, e.g. the folder chosen for videos. Not part of backups. */
  handles!: Table<{ id: string; handle: FileSystemDirectoryHandle; name: string }>;
  constructor() {
    super('compasso-piano');
    this.version(1).stores({
      pieces: 'id,status,updatedAt',
      assets: 'id',
      scores: 'id,pieceId,assetId',
      annotations: 'id,scoreId,[scoreId+page]',
      segments: 'id,pieceId,scoreId,reviewDate',
      presets: 'id,segmentId',
      sessions: 'id,pieceId,segmentId,startedAt',
      lessons: 'id,pieceId,date',
      notes: 'id,pieceId,lessonId',
      tasks: 'id,pieceId,segmentId,lessonId',
      recordings: 'id,segmentId',
      routines: 'id',
    });
    this.version(2).stores({ captures: 'id', captureChunks: 'id,captureId' });
    this.version(3).stores({ handles: 'id' });
  }
}
export const db = new PianoDB();
export async function removePiece(id: string) {
  await db.transaction(
    'rw',
    [
      db.pieces,
      db.scores,
      db.annotations,
      db.segments,
      db.notes,
      db.tasks,
      db.presets,
      db.assets,
      db.lessons,
    ],
    async () => {
      const scores = await db.scores.where('pieceId').equals(id).toArray();
      const segments = await db.segments.where('pieceId').equals(id).toArray();
      for (const score of scores) {
        await db.annotations.where('scoreId').equals(score.id).delete();
        await db.assets.delete(score.assetId);
      }
      for (const segment of segments) await db.presets.where('segmentId').equals(segment.id).delete();
      await db.scores.where('pieceId').equals(id).delete();
      await db.segments.where('pieceId').equals(id).delete();
      await db.notes
        .where('pieceId')
        .equals(id)
        .filter(note => !note.lessonId)
        .delete();
      await db.notes.where('pieceId').equals(id).modify({ pieceId: undefined });
      await db.tasks
        .where('pieceId')
        .equals(id)
        .filter(task => !task.lessonId)
        .delete();
      await db.tasks.where('pieceId').equals(id).modify({ pieceId: '', segmentId: undefined });
      await db.lessons.where('pieceId').equals(id).modify({ pieceId: '' });
      await db.pieces.delete(id);
    },
  );
}
/** Deletes a trecho (or warm-up exercise) with its saved configurations; tasks keep existing unlinked. */
export async function removeSegment(id: string) {
  await db.transaction('rw', [db.segments, db.presets, db.tasks], async () => {
    await db.segments.delete(id);
    await db.presets.where('segmentId').equals(id).delete();
    await db.tasks.where('segmentId').equals(id).modify({ segmentId: undefined });
  });
}
export async function storeAsset(file: File) {
  if (file.size > 100 * 1024 * 1024) throw new Error('Escolha um arquivo de até 100 MB.');
  const asset: Asset = {
    id: crypto.randomUUID(),
    name: file.name,
    mime: file.type,
    size: file.size,
    blob: file,
    createdAt: new Date().toISOString(),
  };
  await db.assets.add(asset);
  return asset;
}
