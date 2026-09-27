import { describe, expect, it } from 'vitest';
import {
  AnnotationHistory,
  forgetHistory,
  historyFor,
  type AnnotationChange,
  type AnnotationStore,
} from '../src/annotation-history';
import type { Annotation } from '../src/domain';

function memoryStore() {
  const rows = new Map<string, Annotation>();
  const store: AnnotationStore = {
    async put(annotation) {
      rows.set(annotation.id, structuredClone(annotation));
    },
    async delete(id) {
      rows.delete(id);
    },
    async update(id, changes: AnnotationChange) {
      const row = rows.get(id);
      if (row) rows.set(id, { ...row, ...structuredClone(changes) });
    },
  };
  return { rows, store };
}

const annotation = (id: string, x = 0.1): Annotation => ({
  id,
  scoreId: 's',
  page: 1,
  layer: 'Minhas notas',
  kind: 'pen',
  color: '#000000',
  width: 2.4,
  points: [
    { x, y: 0.1 },
    { x: x + 0.1, y: 0.2 },
  ],
  createdAt: '2026-01-01T00:00:00.000Z',
});

describe('annotation history', () => {
  it('undoes and redoes creation, moves, edits and deletions in order', async () => {
    const { rows, store } = memoryStore();
    const history = new AnnotationHistory();
    const a = annotation('a'),
      b = { ...annotation('b'), kind: 'text' as const, text: 'p', fontSize: 20 };
    await store.put(a);
    history.record({ type: 'create', annotation: a });
    await store.put(b);
    history.record({ type: 'create', annotation: b });
    const moved = [
      { x: 0.5, y: 0.5 },
      { x: 0.6, y: 0.6 },
    ];
    await store.update('a', { points: moved });
    history.record({ type: 'update', annotation: a, before: { points: a.points }, after: { points: moved } });
    await store.update('b', { text: 'pp', fontSize: 30 });
    history.record({
      type: 'update',
      annotation: b,
      before: { text: 'p', fontSize: 20 },
      after: { text: 'pp', fontSize: 30 },
    });
    await store.delete('a');
    history.record({ type: 'delete', annotation: { ...a, points: moved } });

    expect(rows.has('a')).toBe(false);
    await history.undo(store); // deletion
    expect(rows.get('a')?.points).toEqual(moved);
    await history.undo(store); // text edit
    expect(rows.get('b')).toMatchObject({ text: 'p', fontSize: 20 });
    await history.undo(store); // move
    expect(rows.get('a')?.points).toEqual(a.points);
    await history.undo(store); // create b
    expect(rows.has('b')).toBe(false);
    await history.undo(store); // create a
    expect(rows.size).toBe(0);
    expect(history.canUndo).toBe(false);
    expect(await history.undo(store)).toBeUndefined();

    for (let i = 0; i < 5; i++) await history.redo(store);
    expect(rows.has('a')).toBe(false);
    expect(rows.get('b')).toMatchObject({ text: 'pp', fontSize: 30 });
    expect(history.canRedo).toBe(false);
  });

  it('restores an erased annotation on undo instead of deleting another one', async () => {
    const { rows, store } = memoryStore();
    const history = new AnnotationHistory();
    const a = annotation('a'),
      b = annotation('b', 0.4);
    await store.put(a);
    await store.put(b);
    await store.delete('b');
    history.record({ type: 'delete', annotation: b });
    await history.undo(store);
    expect([...rows.keys()].sort()).toEqual(['a', 'b']);
    await history.redo(store);
    expect([...rows.keys()]).toEqual(['a']);
  });

  it('clears the redo stack on a new action and keeps a failed step', async () => {
    const { store } = memoryStore();
    const history = new AnnotationHistory();
    history.record({ type: 'create', annotation: annotation('a') });
    await history.undo(store);
    expect(history.canRedo).toBe(true);
    history.record({ type: 'create', annotation: annotation('b') });
    expect(history.canRedo).toBe(false);

    const failing: AnnotationStore = {
      ...store,
      delete: async () => Promise.reject(new Error('disco cheio')),
    };
    await expect(history.undo(failing)).rejects.toThrow('disco cheio');
    expect(history.canUndo).toBe(true);
  });

  it('notifies subscribers and limits its size', async () => {
    const history = new AnnotationHistory(2);
    let calls = 0;
    const stop = history.subscribe(() => calls++);
    history.record({ type: 'create', annotation: annotation('a') });
    history.record({ type: 'create', annotation: annotation('b') });
    history.record({ type: 'create', annotation: annotation('c') });
    stop();
    expect(calls).toBe(3);
    const { rows, store } = memoryStore();
    await store.put(annotation('a'));
    await history.undo(store);
    await history.undo(store);
    expect(history.canUndo).toBe(false);
    expect(rows.has('a')).toBe(true);
  });

  it('keeps one history per score until the score is forgotten', () => {
    const first = historyFor('score-1');
    expect(historyFor('score-1')).toBe(first);
    expect(historyFor('score-2')).not.toBe(first);
    forgetHistory('score-1');
    expect(historyFor('score-1')).not.toBe(first);
  });
});
