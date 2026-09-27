import type { Annotation } from './domain';

export type AnnotationChange = Partial<Pick<Annotation, 'points' | 'text' | 'fontSize'>>;

/** One user action on the annotations of a score, kept so it can be undone and redone. */
export type AnnotationOp =
  | { type: 'create'; annotation: Annotation }
  | { type: 'delete'; annotation: Annotation }
  | { type: 'update'; annotation: Annotation; before: AnnotationChange; after: AnnotationChange };

export interface AnnotationStore {
  get(id: string): Promise<Annotation | undefined>;
  put(annotation: Annotation): Promise<unknown>;
  delete(id: string): Promise<unknown>;
  update(id: string, changes: AnnotationChange): Promise<unknown>;
}

/**
 * The annotations no longer are what the history expects (a restored backup, a deleted version…).
 * The history is dropped rather than overwriting the current data with old values.
 */
export class StaleHistoryError extends Error {
  constructor() {
    super('As anotações mudaram desde a última ação.');
    this.name = 'StaleHistoryError';
  }
}

function samePoints(a: Annotation['points'] | undefined, b: Annotation['points'] | undefined) {
  if (!a || !b) return a === b;
  return a.length === b.length && a.every((p, i) => p.x === b[i].x && p.y === b[i].y);
}

function matches(row: Annotation | undefined, expected: AnnotationChange) {
  if (!row) return false;
  return (
    (!('points' in expected) || samePoints(row.points, expected.points)) &&
    (!('text' in expected) || row.text === expected.text) &&
    (!('fontSize' in expected) || row.fontSize === expected.fontSize)
  );
}

function snapshot({ points, text, fontSize }: Annotation): AnnotationChange {
  return { points, text, fontSize };
}

/** Whether the stored row is in the state this op left it in (undo) or found it in (redo). */
function inExpectedState(row: Annotation | undefined, op: AnnotationOp, direction: 'undo' | 'redo') {
  switch (op.type) {
    case 'create':
      return direction === 'undo' ? matches(row, snapshot(op.annotation)) : !row;
    case 'delete':
      return direction === 'undo' ? !row : matches(row, snapshot(op.annotation));
    case 'update':
      return matches(row, direction === 'undo' ? op.after : op.before);
  }
}

function apply(store: AnnotationStore, op: AnnotationOp, direction: 'undo' | 'redo') {
  switch (op.type) {
    case 'create':
      return direction === 'undo' ? store.delete(op.annotation.id) : store.put(op.annotation);
    case 'delete':
      return direction === 'undo' ? store.put(op.annotation) : store.delete(op.annotation.id);
    case 'update':
      return store.update(op.annotation.id, direction === 'undo' ? op.before : op.after);
  }
}

/** A linear undo/redo history for one score. It lives in memory only. */
export class AnnotationHistory {
  private past: AnnotationOp[] = [];
  private future: AnnotationOp[] = [];
  private busy = false;
  private listeners = new Set<() => void>();
  /** Changes on every update, for useSyncExternalStore. */
  version = 0;

  constructor(private readonly limit = 200) {}

  get canUndo() {
    return !this.busy && this.past.length > 0;
  }
  get canRedo() {
    return !this.busy && this.future.length > 0;
  }

  record(op: AnnotationOp) {
    this.past.push(op);
    if (this.past.length > this.limit) this.past.shift();
    this.future = [];
    this.changed();
  }

  /** Reverts the last operation and returns it (undefined when there is nothing to undo). */
  undo(store: AnnotationStore) {
    return this.step(store, this.past, this.future, 'undo');
  }

  redo(store: AnnotationStore) {
    return this.step(store, this.future, this.past, 'redo');
  }

  clear() {
    this.past = [];
    this.future = [];
    this.changed();
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  private async step(
    store: AnnotationStore,
    from: AnnotationOp[],
    to: AnnotationOp[],
    direction: 'undo' | 'redo',
  ) {
    if (this.busy) return undefined;
    const op = from.pop();
    if (!op) return undefined;
    this.busy = true;
    this.changed();
    try {
      if (!inExpectedState(await store.get(op.annotation.id), op, direction)) {
        this.past = [];
        this.future = [];
        throw new StaleHistoryError();
      }
      await apply(store, op, direction);
      to.push(op);
      return op;
    } catch (error) {
      if (!(error instanceof StaleHistoryError)) from.push(op);
      throw error;
    } finally {
      this.busy = false;
      this.changed();
    }
  }

  private changed() {
    this.version++;
    for (const listener of this.listeners) listener();
  }
}

const histories = new Map<string, AnnotationHistory>();

export function historyFor(scoreId: string) {
  let history = histories.get(scoreId);
  if (!history) {
    history = new AnnotationHistory();
    histories.set(scoreId, history);
  }
  return history;
}

/** Drops the history of a deleted score. */
export function forgetHistory(scoreId: string) {
  histories.get(scoreId)?.clear();
  histories.delete(scoreId);
}
