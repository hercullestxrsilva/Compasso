import type { ScaleMode } from '../domain';

/** Solfège names used in Brazil, keyed by letter name. */
const letters: Record<string, string> = { C: 'Dó', D: 'Ré', E: 'Mi', F: 'Fá', G: 'Sol', A: 'Lá', B: 'Si' };

/** "F#" -> "Fá♯", "Bb" -> "Si♭". Tonics are stored in letter notation, as printed in most scale books. */
export function tonicName(tonic: string) {
  const letter = letters[tonic[0]?.toUpperCase()];
  if (!letter) return tonic;
  const accidental = tonic.slice(1);
  return letter + (accidental === '#' ? '♯' : accidental === 'b' ? '♭' : '');
}

/** "F#" -> "F♯": the letter name, with typographic accidentals. */
export const tonicLetter = (tonic: string) => tonic.replace('#', '♯').replace(/^([A-G])b$/, '$1♭');

export const modeLabels: Record<ScaleMode, string> = {
  major: 'Maior',
  'natural-minor': 'Natural',
  'harmonic-minor': 'Harmônica',
  'melodic-minor': 'Melódica',
};

export const isMinor = (mode: ScaleMode) => mode !== 'major';

/** "Dó maior", "Lá menor harmônica". */
export function scaleTitle(tonic: string, mode: ScaleMode) {
  const name = tonicName(tonic);
  return mode === 'major' ? `${name} maior` : `${name} menor ${modeLabels[mode].toLowerCase()}`;
}

// Key signatures by tonic: positive = sharps, negative = flats.
const majorSignatures: Record<string, number> = {
  C: 0,
  G: 1,
  D: 2,
  A: 3,
  E: 4,
  B: 5,
  'F#': 6,
  'C#': 7,
  F: -1,
  Bb: -2,
  Eb: -3,
  Ab: -4,
  Db: -5,
  Gb: -6,
  Cb: -7,
};
const minorSignatures: Record<string, number> = {
  A: 0,
  E: 1,
  B: 2,
  'F#': 3,
  'C#': 4,
  'G#': 5,
  'D#': 6,
  'A#': 7,
  D: -1,
  G: -2,
  C: -3,
  F: -4,
  Bb: -5,
  Eb: -6,
  Ab: -7,
};

/** Number of sharps (positive) or flats (negative) in the key signature, or undefined for an unknown tonic. */
export function keySignature(tonic: string, mode: ScaleMode): number | undefined {
  return (mode === 'major' ? majorSignatures : minorSignatures)[tonic];
}

/** "sem alterações", "2♯", "3♭". */
export function signatureLabel(count: number | undefined) {
  if (count === undefined) return '';
  if (count === 0) return 'sem alterações';
  return count > 0 ? `${count}♯` : `${-count}♭`;
}

/**
 * Order of the key picker: the circle of fifths, sharps side first (starting with the key without accidentals),
 * then the flats side, each by number of accidentals. Unknown tonics go last, alphabetically.
 */
export function keyOrder(tonic: string, mode: ScaleMode) {
  const count = keySignature(tonic, mode);
  if (count === undefined) return 100;
  return count >= 0 ? count : 10 - count;
}

/** The side of the circle a key sits on, used to split the picker in two rows. */
export const keySide = (tonic: string, mode: ScaleMode): 'sharps' | 'flats' =>
  (keySignature(tonic, mode) ?? 0) < 0 ? 'flats' : 'sharps';

/** What a scale exercise asks for, shown under its name. */
export const SCALE_GOAL = 'Duas oitavas, mãos juntas, com o dedilhado indicado.';

/** Suggested cycle for a two-octave scale in eighth notes: four bars of 4/4 with the eighth-note click. */
export const SCALE_PRACTICE = { bars: 4, subdivision: 2 } as const;
