import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { findLayout, knownLayouts, layoutExercises } from '../src/warmups/layouts';
import {
  exerciseName,
  exercisesFromLines,
  linesFromItems,
  pageExercises,
  parseScaleLabel,
  type TextLine,
} from '../src/warmups/detect';
import {
  keyOrder,
  keySide,
  keySignature,
  scaleTitle,
  signatureLabel,
  tonicName,
} from '../src/warmups/scales';
import { sortExercises } from '../src/warmups/collections';

const [major, minor] = knownLayouts;

describe('known scale books', () => {
  it('split the major book into the 12 keys and the minor book into 15 keys × 3 forms', () => {
    expect(major.rows).toHaveLength(12);
    expect(minor.rows).toHaveLength(45);
    expect(layoutExercises(major).map(e => e.title)).toEqual([
      'Dó maior',
      'Sol maior',
      'Ré maior',
      'Lá maior',
      'Mi maior',
      'Si maior',
      'Fá♯ maior',
      'Ré♭ maior',
      'Lá♭ maior',
      'Mi♭ maior',
      'Si♭ maior',
      'Fá maior',
    ]);
    expect(
      layoutExercises(minor)
        .slice(0, 6)
        .map(e => e.title),
    ).toEqual([
      'Lá menor natural',
      'Lá menor harmônica',
      'Lá menor melódica',
      'Ré menor natural',
      'Ré menor harmônica',
      'Ré menor melódica',
    ]);
  });
  it('keep every region on its page, in reading order, without overlaps', () => {
    for (const layout of knownLayouts) {
      const exercises = layoutExercises(layout);
      expect(new Set(exercises.map(e => e.title)).size).toBe(exercises.length);
      exercises.forEach((e, i) => {
        const { page, x, y, w, h } = e.region;
        expect(page).toBeGreaterThanOrEqual(1);
        expect(page).toBeLessThanOrEqual(layout.signature.pages);
        expect(x).toBeGreaterThanOrEqual(0);
        expect(y).toBeGreaterThanOrEqual(0);
        expect(x + w).toBeLessThanOrEqual(1);
        expect(y + h).toBeLessThanOrEqual(1);
        // A two-octave grand staff: taller than a line of text, shorter than half a page.
        expect(h).toBeGreaterThan(0.1);
        expect(h).toBeLessThan(0.3);
        expect(e.exercise.order).toBe(i);
        // Neighbouring scales meet halfway through the blank paper between them.
        const next = exercises[i + 1]?.region;
        if (next?.page === page) expect(next.y).toBeGreaterThanOrEqual(y + h - 0.0002);
      });
    }
  });
  it('recognise a file by fingerprint or by the edition signature', () => {
    const facts = { sha256: '', title: undefined, pages: 2, width: 595.3, height: 841.9 };
    expect(findLayout({ ...facts, sha256: major.fingerprints[0] })?.id).toBe(major.id);
    expect(findLayout({ ...facts, title: 'Piano Scales - 12 major keys with standard fingering' })?.id).toBe(
      major.id,
    );
    expect(
      findLayout({ ...facts, title: 'Piano Scales - 12 major keys with standard fingering', pages: 3 }),
    ).toBe(undefined);
    expect(findLayout(facts)).toBe(undefined);
    expect(
      findLayout({
        sha256: 'x',
        title: 'Scales - Two Octave Minor Master.musx',
        pages: 15,
        width: 612,
        height: 792,
      })?.id,
    ).toBe(minor.id);
  });
});

describe('scale names', () => {
  it('uses Brazilian solfège with typographic accidentals', () => {
    expect(tonicName('F#')).toBe('Fá♯');
    expect(tonicName('Bb')).toBe('Si♭');
    expect(scaleTitle('C', 'major')).toBe('Dó maior');
    expect(scaleTitle('G#', 'melodic-minor')).toBe('Sol♯ menor melódica');
  });
  it('knows each key signature and orders the picker by the circle of fifths', () => {
    expect(keySignature('D', 'major')).toBe(2);
    expect(keySignature('Db', 'major')).toBe(-5);
    expect(keySignature('A#', 'natural-minor')).toBe(7);
    expect(keySignature('Eb', 'harmonic-minor')).toBe(-6);
    expect(keySignature('H', 'major')).toBe(undefined);
    expect(signatureLabel(0)).toBe('sem alterações');
    expect(signatureLabel(-3)).toBe('3♭');
    const tonics = ['F', 'C', 'D', 'Bb', 'G'];
    expect(tonics.sort((a, b) => keyOrder(a, 'major') - keyOrder(b, 'major'))).toEqual([
      'C',
      'G',
      'D',
      'F',
      'Bb',
    ]);
    expect(keySide('C', 'major')).toBe('sharps');
    expect(keySide('F', 'major')).toBe('flats');
  });
});

describe('scale titles in a PDF', () => {
  it('reads English and Portuguese scale titles', () => {
    expect(parseScaleLabel('C Major')).toEqual({ tonic: 'C', mode: 'major' });
    expect(parseScaleLabel('B Major')).toEqual({ tonic: 'B', mode: 'major' });
    expect(parseScaleLabel('Bb major')).toEqual({ tonic: 'Bb', mode: 'major' });
    expect(parseScaleLabel('F# Harmonic Minor')).toEqual({ tonic: 'F#', mode: 'harmonic-minor' });
    expect(parseScaleLabel('A minor')).toEqual({ tonic: 'A', mode: 'natural-minor' });
    expect(parseScaleLabel('E♭ melodic minor scale')).toEqual({ tonic: 'Eb', mode: 'melodic-minor' });
    expect(parseScaleLabel('Ré menor melódica')).toEqual({ tonic: 'D', mode: 'melodic-minor' });
    expect(parseScaleLabel('Fá sustenido maior')).toEqual({ tonic: 'F#', mode: 'major' });
    expect(parseScaleLabel('Sol♭ maior')).toEqual({ tonic: 'Gb', mode: 'major' });
    expect(parseScaleLabel('Lá menor')).toEqual({ tonic: 'A', mode: 'natural-minor' });
    expect(parseScaleLabel('Allegro moderato')).toBe(null);
    expect(parseScaleLabel('Czerny Op. 599')).toBe(null);
  });
  it('joins text pieces that sit on the same line', () => {
    const lines = linesFromItems(
      [
        { str: 'Major', x: 90, top: 100, bottom: 110, width: 30 },
        { str: 'C', x: 76, top: 100.5, bottom: 110, width: 9 },
        { str: '1', x: 95, top: 120, bottom: 127, width: 4 },
      ],
      1,
      595,
      842,
    );
    expect(lines.map(l => l.text)).toEqual(['C Major', '1']);
  });
  it('turns each title into a region down to the next title', () => {
    const line = (text: string, top: number, page = 1): TextLine => ({
      page,
      text,
      x: 70,
      top,
      bottom: top + 11,
      pageWidth: 595,
      pageHeight: 842,
    });
    const drafts = exercisesFromLines([
      line('G Major', 220),
      line('C Major', 100),
      line('D Major', 340),
      line('Allegro', 500),
      line('A Major', 100, 2),
    ]);
    expect(drafts.map(d => d.title)).toEqual(['Dó maior', 'Sol maior', 'Ré maior', 'Lá maior']);
    expect(drafts[0].region.y * 842).toBeCloseTo(94);
    expect((drafts[0].region.y + drafts[0].region.h) * 842).toBeCloseTo(214);
    expect(drafts[3].region.page).toBe(2);
    expect(drafts.map(d => d.exercise.order)).toEqual([0, 1, 2, 3]);
  });
  it('ignores a list of titles (a table of contents)', () => {
    const toc = ['C Major', 'G Major', 'D Major'].map((text, i) => ({
      page: 1,
      text,
      x: 70,
      top: 100 + i * 16,
      bottom: 110 + i * 16,
      pageWidth: 595,
      pageHeight: 842,
    }));
    expect(exercisesFromLines(toc)).toEqual([]);
  });
});

describe('études and other books', () => {
  it('splits a book one exercise per page, numbering after the existing ones', () => {
    expect(pageExercises(2, 'etudes').map(e => [e.title, e.region.page, e.exercise.order])).toEqual([
      ['Nº 1', 1, 0],
      ['Nº 2', 2, 1],
    ]);
    expect(pageExercises(1, 'other', 3)[0].title).toBe('Parte 4');
    expect(exerciseName('scales', 2)).toBe('Escala 2');
  });
  it('keeps the book order, then the marking order', () => {
    const list = [
      { id: 'b', exercise: { order: 1 }, createdAt: '2026-01-01' },
      { id: 'late', createdAt: '2026-01-01' },
      { id: 'a', exercise: { order: 0 }, createdAt: '2026-01-02' },
    ];
    expect(sortExercises(list).map(e => e.id)).toEqual(['a', 'b', 'late']);
  });
});

describe('collection order', () => {
  it('puts major scales first, then minor scales, then études and the rest', async () => {
    const { collectionRank } = await import('../src/warmups/collections');
    const scales = { warmup: { kind: 'scales' as const } };
    const summary = (...modes: string[]) => ({ count: modes.length, modes: new Set(modes) });
    const ranks = [
      collectionRank(scales, summary('natural-minor', 'harmonic-minor')),
      collectionRank({ warmup: { kind: 'etudes' as const } }, summary()),
      collectionRank(scales, summary('major')),
      collectionRank({ warmup: { kind: 'other' as const } }),
      collectionRank(scales, summary('major', 'natural-minor')),
    ];
    expect(ranks).toEqual([1, 2, 0, 3, 0]);
  });
});
