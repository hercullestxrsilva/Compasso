import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  clampZoom,
  fitPageZoom,
  forgetPieceView,
  forgetViewState,
  isEditableTarget,
  loadLastScore,
  loadViewState,
  pageKeyAction,
  readFlag,
  saveLastScore,
  saveViewState,
  writeFlag,
} from '../src/score-view';

function memoryStorage() {
  const data = new Map<string, string>();
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    removeItem: (key: string) => void data.delete(key),
  };
}

afterEach(() => vi.unstubAllGlobals());

describe('score view state', () => {
  it('remembers page, zoom and fit per score', () => {
    vi.stubGlobal('localStorage', memoryStorage());
    expect(loadViewState('a')).toEqual({});
    saveViewState('a', { page: 3, zoom: 1.5, fit: null });
    saveViewState('b', { page: 1, zoom: 1, fit: 'page' });
    expect(loadViewState('a')).toEqual({ page: 3, zoom: 1.5, fit: null });
    expect(loadViewState('b').fit).toBe('page');
    forgetViewState('a');
    expect(loadViewState('a')).toEqual({});
  });

  it('ignores damaged values and unavailable storage', () => {
    const storage = memoryStorage();
    vi.stubGlobal('localStorage', storage);
    storage.setItem('compasso:score-view:x', '{"page":-2,"zoom":99,"fit":"huge"}');
    expect(loadViewState('x')).toEqual({ zoom: 3 });
    storage.setItem('compasso:score-view:x', 'not json');
    expect(loadViewState('x')).toEqual({});
    vi.stubGlobal('localStorage', {
      getItem() {
        throw new Error('blocked');
      },
      setItem() {
        throw new Error('blocked');
      },
    });
    expect(loadViewState('x')).toEqual({});
    expect(() => saveViewState('x', { page: 1, zoom: 1, fit: 'width' })).not.toThrow();
    expect(readFlag('flag')).toBeUndefined();
    expect(() => writeFlag('flag', true)).not.toThrow();
  });

  it('remembers the last opened version of a piece and forgets deleted pieces', () => {
    vi.stubGlobal('localStorage', memoryStorage());
    expect(loadLastScore('piece')).toBe('');
    saveLastScore('piece', 'score-2');
    saveViewState('score-2', { page: 4, zoom: 1, fit: 'width' });
    expect(loadLastScore('piece')).toBe('score-2');
    forgetPieceView('piece', ['score-2']);
    expect(loadLastScore('piece')).toBe('');
    expect(loadViewState('score-2')).toEqual({});
  });

  it('stores on/off preferences', () => {
    vi.stubGlobal('localStorage', memoryStorage());
    expect(readFlag('pencil')).toBeUndefined();
    writeFlag('pencil', true);
    expect(readFlag('pencil')).toBe(true);
    writeFlag('pencil', false);
    expect(readFlag('pencil')).toBe(false);
  });
});

describe('zoom', () => {
  it('fits a whole page into the visible height', () => {
    // 1000 px wide, 700 px tall viewer, A4 page: the page must shrink to 700 / 1414.
    expect(fitPageZoom(1000, 700, 1.414)).toBeCloseTo(0.495, 3);
    // A short page already fits at full width.
    expect(fitPageZoom(1000, 900, 0.5)).toBe(1);
    expect(fitPageZoom(0, 700, 1.4)).toBe(1);
  });

  it('keeps manual zoom within limits', () => {
    expect(clampZoom(10)).toBe(3);
    expect(clampZoom(0.1)).toBe(0.4);
    expect(clampZoom(1.234)).toBe(1.23);
    expect(clampZoom(Number.NaN)).toBe(1);
  });
});

describe('page-turn keys', () => {
  it('maps keyboard and pedal keys', () => {
    expect(pageKeyAction({ key: 'ArrowRight' })).toEqual({ direction: 1, scrollFirst: false });
    expect(pageKeyAction({ key: 'ArrowLeft' })).toEqual({ direction: -1, scrollFirst: false });
    expect(pageKeyAction({ key: 'PageDown' })).toEqual({ direction: 1, scrollFirst: true });
    expect(pageKeyAction({ key: 'ArrowDown' })).toEqual({ direction: 1, scrollFirst: true });
    expect(pageKeyAction({ key: 'PageUp' })).toEqual({ direction: -1, scrollFirst: true });
    expect(pageKeyAction({ key: 'ArrowUp' })).toEqual({ direction: -1, scrollFirst: true });
  });

  it('leaves Space and shortcuts alone', () => {
    expect(pageKeyAction({ key: ' ' })).toBeNull();
    expect(pageKeyAction({ key: 'ArrowRight', metaKey: true })).toBeNull();
    expect(pageKeyAction({ key: 'ArrowLeft', altKey: true })).toBeNull();
    expect(pageKeyAction({ key: 'PageDown', ctrlKey: true })).toBeNull();
  });

  it('recognises text fields and other form controls', () => {
    const element = (match: boolean, isContentEditable = false) =>
      ({ isContentEditable, closest: () => (match ? {} : null) }) as unknown as EventTarget;
    expect(isEditableTarget(element(true))).toBe(true);
    expect(isEditableTarget(element(false, true))).toBe(true);
    expect(isEditableTarget(element(false))).toBe(false);
    expect(isEditableTarget(null)).toBe(false);
    expect(isEditableTarget({} as EventTarget)).toBe(false);
  });
});
