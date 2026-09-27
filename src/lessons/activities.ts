import type { Piece, Segment, Task } from '../domain';
import { addDays } from '../practice/stats';

/** Activities are due by the next lesson: a week after the lesson they came from. */
export const defaultDue = (lessonDate: string) => (lessonDate ? addDays(lessonDate, 7) : '');

export type ActivityTarget =
  { kind: 'segment'; id: string } | { kind: 'piece'; id: string } | { kind: 'warmup'; id: string };

/** Where "Praticar" takes an activity: its trecho or exercise, its whole piece, or its warm-up collection. */
export function activityTarget(
  task: Pick<Task, 'pieceId' | 'segmentId'>,
  pieces: Piece[],
): ActivityTarget | null {
  if (task.segmentId) return { kind: 'segment', id: task.segmentId };
  const piece = pieces.find(p => p.id === task.pieceId);
  if (!piece) return null;
  return piece.warmup ? { kind: 'warmup', id: piece.id } : { kind: 'piece', id: piece.id };
}

/** "Escalas maiores · Fá maior", "Kinderszenen" or '' for a general activity. */
export function activityLabel(
  task: Pick<Task, 'pieceId' | 'segmentId'>,
  pieces: Piece[],
  segments: Segment[],
) {
  const segment = task.segmentId ? segments.find(s => s.id === task.segmentId) : undefined;
  const piece = pieces.find(p => p.id === (segment?.pieceId ?? task.pieceId));
  return [piece?.title, segment?.title].filter(Boolean).join(' · ');
}

/** Pending first by due date (no date last), then in the order they were written. */
export function sortActivities(tasks: Task[]) {
  return [...tasks].sort(
    (a, b) =>
      Number(a.done) - Number(b.done) ||
      (a.dueDate || '9999').localeCompare(b.dueDate || '9999') ||
      a.createdAt.localeCompare(b.createdAt),
  );
}

/** "Aula de 22/9": the title of a lesson registered without one. */
export function defaultLessonTitle(date: string) {
  const [, month, day] = date.split('-').map(Number);
  return month && day ? `Aula de ${day}/${month}` : 'Aula';
}
