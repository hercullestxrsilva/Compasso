import type { Annotation } from './domain';

export type AnnotationChange = Partial<Pick<Annotation, 'points' | 'text' | 'fontSize'>>;

/** One user action on the annotations of a score, kept so it can be undone and redone. */
export type AnnotationOp =
  | { type: 'create'; annotation: Annotation }
  | { type: 'delete'; annotation: Annotation }
  | { type: 'update'; annotation: Annotation; before: AnnotationChange; after: AnnotationChange };

export interface AnnotationStore {
  put(annotation: Annotation): Promise<unknown>;
  delete(id: string): Promise<unknown>;
  update(id: string, changes: AnnotationChange): Promise<unknown>;
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
      await apply(store, op, direction);
      to.push(op);
      return op;
    } catch (error) {
      from.push(op);
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
