import type { ScaleMode } from '../domain';
import { SCALE_GOAL, scaleTitle } from './scales';

/** A region of the file: page (1-based), then x, y, width and height as fractions of the page. */
type LayoutRegion = readonly [page: number, x: number, y: number, w: number, h: number];
type LayoutRow = readonly [tonic: string, mode: ScaleMode, region: LayoutRegion];

/**
 * A scale book whose pages were measured once, so importing it splits it into one exercise per scale.
 * Only the positions are kept here — the PDFs themselves are copyrighted and never ship with the app.
 */
export interface KnownLayout {
  id: string;
  title: string;
  source: string;
  /** SHA-256 of the files known to have this layout. */
  fingerprints: readonly string[];
  /** Another download of the same edition: PDF title, page count and page size (points). */
  signature: { title: string; pages: number; width: number; height: number };
  rows: readonly LayoutRow[];
}

export const knownLayouts: readonly KnownLayout[] = [
  {
    id: 'pianostreet-major-two-octaves',
    title: 'Escalas maiores',
    source: 'Piano Street · Op 111 Productions',
    fingerprints: ['3ee2356480c26e205151b80b7a8aefad69b367d314c816c5f0989f15ef07e615'],
    signature: {
      title: 'Piano Scales - 12 major keys with standard fingering',
      pages: 2,
      width: 595,
      height: 842,
    },
    rows: [
      ['C', 'major', [1, 0.0627, 0.1049, 0.8792, 0.1432]],
      ['G', 'major', [1, 0.0627, 0.2481, 0.8792, 0.1466]],
      ['D', 'major', [1, 0.0622, 0.3947, 0.8798, 0.1369]],
      ['A', 'major', [1, 0.0627, 0.5316, 0.8787, 0.1458]],
      ['E', 'major', [1, 0.0622, 0.6774, 0.8792, 0.1362]],
      ['B', 'major', [1, 0.0627, 0.8169, 0.8787, 0.1462]],
      ['F#', 'major', [2, 0.0627, 0.101, 0.8787, 0.1405]],
      ['Db', 'major', [2, 0.0627, 0.2453, 0.8787, 0.1427]],
      ['Ab', 'major', [2, 0.0622, 0.389, 0.8792, 0.1452]],
      ['Eb', 'major', [2, 0.0627, 0.5342, 0.8787, 0.1356]],
      ['Bb', 'major', [2, 0.0622, 0.6724, 0.8792, 0.146]],
      ['F', 'major', [2, 0.0627, 0.8184, 0.8787, 0.1361]],
    ],
  },
  {
    id: 'enovative-minor-two-octaves',
    title: 'Escalas menores',
    source: 'eNovativePiano',
    fingerprints: ['1c4c9f2f716361e4f91f7c16660f2ecac382ab220f535293199b90ab3689b8f7'],
    signature: { title: 'Scales - Two Octave Minor Master.musx', pages: 15, width: 612, height: 792 },
    rows: [
      ['A', 'natural-minor', [1, 0.0626, 0.1376, 0.8894, 0.1839]],
      ['A', 'harmonic-minor', [1, 0.0626, 0.3418, 0.8911, 0.1911]],
      ['A', 'melodic-minor', [1, 0.0626, 0.5446, 0.8911, 0.1919]],
      ['D', 'natural-minor', [2, 0.0626, 0.0918, 0.8927, 0.1991]],
      ['D', 'harmonic-minor', [2, 0.0626, 0.2967, 0.8927, 0.1978]],
      ['D', 'melodic-minor', [2, 0.0626, 0.4983, 0.8927, 0.2029]],
      ['G', 'natural-minor', [3, 0.0626, 0.0905, 0.8927, 0.2088]],
      ['G', 'harmonic-minor', [3, 0.0626, 0.2993, 0.8927, 0.2054]],
      ['G', 'melodic-minor', [3, 0.0626, 0.5047, 0.8927, 0.2104]],
      ['C', 'natural-minor', [4, 0.0626, 0.0905, 0.8927, 0.1919]],
      ['C', 'harmonic-minor', [4, 0.0626, 0.2942, 0.8927, 0.1907]],
      ['C', 'melodic-minor', [4, 0.0626, 0.5021, 0.8927, 0.1894]],
      ['F', 'natural-minor', [5, 0.061, 0.0951, 0.8927, 0.1932]],
      ['F', 'harmonic-minor', [5, 0.061, 0.2955, 0.8927, 0.1982]],
      ['F', 'melodic-minor', [5, 0.061, 0.5008, 0.8927, 0.1974]],
      ['Bb', 'natural-minor', [6, 0.061, 0.093, 0.8927, 0.1915]],
      ['Bb', 'harmonic-minor', [6, 0.061, 0.2959, 0.8927, 0.1936]],
      ['Bb', 'melodic-minor', [6, 0.061, 0.5017, 0.8927, 0.1928]],
      ['Eb', 'natural-minor', [7, 0.061, 0.0905, 0.8927, 0.1965]],
      ['Eb', 'harmonic-minor', [7, 0.061, 0.2967, 0.8927, 0.1936]],
      ['Eb', 'melodic-minor', [7, 0.061, 0.5034, 0.8927, 0.1915]],
      ['Ab', 'natural-minor', [8, 0.061, 0.0913, 0.8927, 0.1953]],
      ['Ab', 'harmonic-minor', [8, 0.061, 0.2967, 0.8927, 0.1965]],
      ['Ab', 'melodic-minor', [8, 0.061, 0.5004, 0.8927, 0.1978]],
      ['E', 'natural-minor', [9, 0.061, 0.0918, 0.8927, 0.1944]],
      ['E', 'harmonic-minor', [9, 0.061, 0.2963, 0.8927, 0.1949]],
      ['E', 'melodic-minor', [9, 0.061, 0.5021, 0.8927, 0.1957]],
      ['B', 'natural-minor', [10, 0.061, 0.0939, 0.8927, 0.2044]],
      ['B', 'harmonic-minor', [10, 0.061, 0.2983, 0.8927, 0.2034]],
      ['B', 'melodic-minor', [10, 0.061, 0.5025, 0.8927, 0.2041]],
      ['F#', 'natural-minor', [11, 0.061, 0.0922, 0.8927, 0.2016]],
      ['F#', 'harmonic-minor', [11, 0.061, 0.2967, 0.8927, 0.2008]],
      ['F#', 'melodic-minor', [11, 0.061, 0.5025, 0.8927, 0.2016]],
      ['C#', 'natural-minor', [12, 0.061, 0.0926, 0.8927, 0.1999]],
      ['C#', 'harmonic-minor', [12, 0.061, 0.295, 0.8927, 0.2033]],
      ['C#', 'melodic-minor', [12, 0.061, 0.5004, 0.8927, 0.2024]],
      ['G#', 'natural-minor', [13, 0.061, 0.0913, 0.8927, 0.2003]],
      ['G#', 'harmonic-minor', [13, 0.0654, 0.2976, 0.8883, 0.1978]],
      ['G#', 'melodic-minor', [13, 0.061, 0.5021, 0.8927, 0.1991]],
      ['D#', 'natural-minor', [14, 0.061, 0.0934, 0.8927, 0.197]],
      ['D#', 'harmonic-minor', [14, 0.061, 0.2971, 0.8927, 0.1978]],
      ['D#', 'melodic-minor', [14, 0.061, 0.5029, 0.8927, 0.1961]],
      ['A#', 'natural-minor', [15, 0.061, 0.0955, 0.8927, 0.1919]],
      ['A#', 'harmonic-minor', [15, 0.061, 0.298, 0.8927, 0.1949]],
      ['A#', 'melodic-minor', [15, 0.061, 0.5021, 0.8927, 0.1928]],
    ],
  },
];

export interface FileFacts {
  sha256: string;
  /** Title from the PDF metadata, if any. */
  title?: string;
  pages: number;
  /** Size of the first page in points. */
  width: number;
  height: number;
}

/** The known layout of a file: by its exact fingerprint, or by the edition's title, page count and size. */
export function findLayout(facts: FileFacts): KnownLayout | undefined {
  const exact = knownLayouts.find(l => l.fingerprints.includes(facts.sha256));
  if (exact) return exact;
  return knownLayouts.find(({ signature: s }) => {
    const title = facts.title?.trim().toLowerCase();
    return (
      !!title &&
      title === s.title.toLowerCase() &&
      facts.pages === s.pages &&
      Math.abs(facts.width - s.width) < 2 &&
      Math.abs(facts.height - s.height) < 2
    );
  });
}

export interface ExerciseDraft {
  title: string;
  goal: string;
  region: { page: number; x: number; y: number; w: number; h: number };
  exercise: { order: number; tonic?: string; mode?: ScaleMode };
}

export function layoutExercises(layout: KnownLayout): ExerciseDraft[] {
  return layout.rows.map(([tonic, mode, [page, x, y, w, h]], order) => ({
    title: scaleTitle(tonic, mode),
    goal: SCALE_GOAL,
    region: { page, x, y, w, h },
    exercise: { order, tonic, mode },
  }));
}
