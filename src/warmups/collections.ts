import { db, removeSegment, storeAsset } from '../db';
import { now, uid, type Piece, type Region, type Segment, type WarmupKind } from '../domain';
import type { ExerciseDraft } from './layouts';
import { SCALE_PRACTICE } from './scales';
import { exerciseName, pageExercises } from './detect';

export interface CollectionSummary {
  count: number;
  /** Modes of its scales, if any. */
  modes: Set<string>;
}

/**
 * Order of the collections in Aquecimento: major scales first (the usual start of a warm-up), then minor
 * scales, then études and anything else; within each group, the order they were imported.
 */
export function collectionRank(piece: Pick<Piece, 'warmup'>, summary?: CollectionSummary) {
  const modes = summary?.modes;
  if (modes?.has('major')) return 0;
  if (modes && modes.size > 0) return 1;
  return piece.warmup?.kind === 'scales' ? 1 : piece.warmup?.kind === 'etudes' ? 2 : 3;
}

/** Exercises of a collection in their order (circle of fifths for scales, number for études). */
export function sortExercises<S extends Pick<Segment, 'exercise' | 'createdAt'>>(list: S[]) {
  return [...list].sort(
    (a, b) =>
      (a.exercise?.order ?? Number.MAX_SAFE_INTEGER) - (b.exercise?.order ?? Number.MAX_SAFE_INTEGER) ||
      a.createdAt.localeCompare(b.createdAt),
  );
}

function segmentFrom(
  draft: ExerciseDraft,
  pieceId: string,
  scoreId: string,
  kind: WarmupKind,
  createdAt: string,
): Segment {
  const scale = !!draft.exercise.mode;
  return {
    id: uid(),
    pieceId,
    scoreId,
    title: draft.title,
    measures: '',
    goal: draft.goal,
    difficulty: kind === 'scales' || scale ? 'Dedilhado' : 'Leitura',
    hand: 'both',
    regions: [draft.region],
    bpm: 60,
    reviewDate: '',
    createdAt,
    exercise: draft.exercise,
    // Two octaves in eighth notes: four bars, with the eighth-note click.
    ...(scale ? { practiceConfig: { ...SCALE_PRACTICE, bpm: 60 } } : {}),
  };
}

/** Stores the file and creates the collection with its exercises in one transaction. Returns the piece id. */
export async function createCollection({
  file,
  title,
  kind,
  fingerprint,
  source,
  drafts,
}: {
  file: File;
  title: string;
  kind: WarmupKind;
  fingerprint?: string;
  source?: string;
  drafts: ExerciseDraft[];
}) {
  const pieceId = uid(),
    scoreId = uid(),
    at = Date.now();
  const stamp = (offset: number) => new Date(at + offset).toISOString();
  await db.transaction('rw', [db.pieces, db.assets, db.scores, db.segments], async () => {
    const asset = await storeAsset(file);
    const piece: Piece = {
      id: pieceId,
      title: title.trim(),
      composer: '',
      status: 'studying',
      tags: '',
      createdAt: stamp(0),
      updatedAt: stamp(0),
      warmup: { kind, ...(fingerprint ? { fingerprint } : {}), ...(source ? { source } : {}) },
    };
    await db.pieces.add(piece);
    await db.scores.add({ id: scoreId, pieceId, assetId: asset.id, title: file.name, createdAt: stamp(0) });
    // Creation times follow the order too, so every list sorted by date keeps the book's order.
    await db.segments.bulkAdd(drafts.map((d, i) => segmentFrom(d, pieceId, scoreId, kind, stamp(i + 1))));
  });
  return pieceId;
}

/** A new exercise marked on the score, named after its position ("Nº 4"). */
export async function addExercise(piece: Piece, scoreId: string, region: Region) {
  const kind = piece.warmup?.kind ?? 'other';
  const existing = await db.segments.where('pieceId').equals(piece.id).toArray();
  const order = existing.reduce((max, s) => Math.max(max, s.exercise?.order ?? -1), -1) + 1;
  const segment = segmentFrom(
    { title: exerciseName(kind, order + 1), goal: '', region, exercise: { order } },
    piece.id,
    scoreId,
    kind,
    now(),
  );
  await db.segments.add(segment);
  return segment;
}

/** Adds one exercise per page (used when a book of études is imported without marks). */
export async function addPageExercises(piece: Piece, scoreId: string, pages: number) {
  const kind = piece.warmup?.kind ?? 'other';
  const existing = await db.segments.where('pieceId').equals(piece.id).count();
  const at = Date.now();
  await db.segments.bulkAdd(
    pageExercises(pages, kind, existing).map((draft, i) =>
      segmentFrom(draft, piece.id, scoreId, kind, new Date(at + i).toISOString()),
    ),
  );
}

/** Swaps an exercise with its neighbour in the collection order. */
export async function moveExercise(list: Segment[], index: number, delta: -1 | 1) {
  const ordered = sortExercises(list);
  const a = ordered[index],
    b = ordered[index + delta];
  if (!a || !b) return;
  await db.transaction('rw', db.segments, async () => {
    // Renumber the whole list first, so collections marked before this existed get distinct positions.
    for (const [i, s] of ordered.entries()) {
      const order = s.id === a.id ? index + delta : s.id === b.id ? index : i;
      await db.segments.update(s.id, { exercise: { ...s.exercise, order } });
    }
  });
}

export const renameExercise = (id: string, title: string) => db.segments.update(id, { title: title.trim() });
export const deleteExercise = removeSegment;
export const renameCollection = (id: string, title: string) =>
  db.pieces.update(id, { title: title.trim(), updatedAt: now() });
