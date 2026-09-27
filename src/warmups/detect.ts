import type { ScaleMode } from '../domain';
import { findLayout, layoutExercises, type ExerciseDraft, type KnownLayout } from './layouts';
import { SCALE_GOAL, scaleTitle } from './scales';

const ptLetters: Record<string, string> = { do: 'C', re: 'D', mi: 'E', fa: 'F', sol: 'G', la: 'A', si: 'B' };
const plain = (text: string) => text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const EN =
  /^([a-g])\s*(#|♯|b|♭)?\s*[-–]?\s*(major|natural minor|harmonic minor|melodic minor|minor)(?:\s+scales?)?$/;
const PT =
  /^(do|re|mi|fa|sol|la|si)\s*(#|♯|b|♭|sustenido|bemol)?\s+(maior|menor(?:\s+(natural|harmonica|melodica))?)$/;

/** "C Major", "F# harmonic minor", "Ré menor melódica" -> tonic and mode; anything else -> null. */
export function parseScaleLabel(text: string): { tonic: string; mode: ScaleMode } | null {
  const t = plain(text).replace(/\s+/g, ' ').trim();
  const sharp = (a?: string) => (!a ? '' : ['#', '♯', 'sustenido'].includes(a) ? '#' : 'b');
  const en = EN.exec(t);
  if (en) {
    const kind = en[3];
    const mode: ScaleMode =
      kind === 'major'
        ? 'major'
        : kind.startsWith('harmonic')
          ? 'harmonic-minor'
          : kind.startsWith('melodic')
            ? 'melodic-minor'
            : 'natural-minor';
    return { tonic: en[1].toUpperCase() + sharp(en[2]), mode };
  }
  const pt = PT.exec(t);
  if (pt) {
    const form = pt[4];
    const mode: ScaleMode =
      pt[3] === 'maior'
        ? 'major'
        : form === 'harmonica'
          ? 'harmonic-minor'
          : form === 'melodica'
            ? 'melodic-minor'
            : 'natural-minor';
    return { tonic: ptLetters[pt[1]] + sharp(pt[2]), mode };
  }
  return null;
}

/** A line of text on a page, with its top and bottom measured from the top of the page, in points. */
export interface TextLine {
  page: number;
  text: string;
  x: number;
  top: number;
  bottom: number;
  pageWidth: number;
  pageHeight: number;
}

/** Labels closer than this belong to a list (a table of contents), not to scales printed one under the other. */
const MIN_GAP = 36;

/**
 * One exercise per scale title found in the text: each runs from its title down to the next title on the same
 * page (or near the bottom of the page). The width is the usual music area, as the text says nothing about it.
 */
export function exercisesFromLines(lines: TextLine[]): ExerciseDraft[] {
  const labels = lines
    .map(line => ({ line, scale: parseScaleLabel(line.text) }))
    .filter((l): l is { line: TextLine; scale: NonNullable<typeof l.scale> } => !!l.scale)
    .sort((a, b) => a.line.page - b.line.page || a.line.top - b.line.top);
  const pages = new Map<number, typeof labels>();
  for (const label of labels) pages.set(label.line.page, [...(pages.get(label.line.page) ?? []), label]);
  const drafts: ExerciseDraft[] = [];
  for (const list of pages.values()) {
    if (list.some((l, i) => i > 0 && l.line.top - list[i - 1].line.top < MIN_GAP)) continue;
    list.forEach(({ line, scale }, i) => {
      const H = line.pageHeight;
      const top = Math.max(0, line.top - 6);
      const next = list[i + 1];
      const bottom = next ? next.line.top - 6 : H * 0.965;
      if (bottom - top < MIN_GAP) return;
      drafts.push({
        title: scaleTitle(scale.tonic, scale.mode),
        goal: SCALE_GOAL,
        region: { page: line.page, x: 0.04, y: top / H, w: 0.92, h: (bottom - top) / H },
        exercise: { order: drafts.length, tonic: scale.tonic, mode: scale.mode },
      });
    });
  }
  return drafts;
}

type TextItem = { str: string; x: number; top: number; bottom: number; width: number };

/**
 * Joins text items that sit on the same line, so "C" + "Major" reads as one title. Items are grouped into rows
 * first (a few points of tolerance) and read left to right; a wide gap starts another line (another column).
 */
export function linesFromItems(
  items: TextItem[],
  page: number,
  pageWidth: number,
  pageHeight: number,
): TextLine[] {
  const rows: TextItem[][] = [];
  for (const item of items.filter(i => i.str.trim()).sort((a, b) => a.top - b.top)) {
    const row = rows.at(-1);
    if (row && Math.abs(row[0].top - item.top) < 3) row.push(item);
    else rows.push([item]);
  }
  const lines: TextLine[] = [];
  for (const row of rows) {
    let current: (TextLine & { right: number }) | undefined;
    const close = () => {
      if (!current) return;
      const { right: _right, ...line } = current;
      lines.push(line);
    };
    for (const item of row.sort((a, b) => a.x - b.x)) {
      if (current && item.x - current.right < 24) {
        current.text += (item.x - current.right > 1 ? ' ' : '') + item.str.trim();
        current.right = Math.max(current.right, item.x + item.width);
        current.top = Math.min(current.top, item.top);
        current.bottom = Math.max(current.bottom, item.bottom);
      } else {
        close();
        current = {
          page,
          text: item.str.trim(),
          x: item.x,
          top: item.top,
          bottom: item.bottom,
          right: item.x + item.width,
          pageWidth,
          pageHeight,
        };
      }
    }
    close();
  }
  return lines;
}

export type Detection =
  | { kind: 'known'; layout: KnownLayout; exercises: ExerciseDraft[] }
  | { kind: 'labels'; exercises: ExerciseDraft[] }
  | { kind: 'none' };

export interface Inspection {
  sha256: string;
  pages: number;
  /** Title from the PDF metadata, when it looks like a real title. */
  title?: string;
  detection: Detection;
}

export async function sha256(blob: Blob) {
  try {
    const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
    return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
  } catch {
    // crypto.subtle only exists on HTTPS and localhost; the edition can still be recognised by its signature.
    return '';
  }
}

const isPdf = (file: File) => file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
/** Scale books rarely pass this; reading the text of a whole method would only slow the import down. */
const MAX_TEXT_PAGES = 40;

/** Fingerprint, page count and how the file can be split into exercises. */
export async function inspectFile(file: File): Promise<Inspection> {
  const hash = await sha256(file);
  if (!isPdf(file)) return { sha256: hash, pages: 1, detection: { kind: 'none' } };
  const { openPdf } = await import('../pdf/render');
  const handle = openPdf(file);
  try {
    const doc = await handle.promise;
    const first = (await doc.getPage(1)).getViewport({ scale: 1 });
    const info = (await doc.getMetadata().catch(() => null))?.info as { Title?: unknown } | undefined;
    const title = typeof info?.Title === 'string' ? info.Title.trim() : undefined;
    const layout = findLayout({
      sha256: hash,
      title,
      pages: doc.numPages,
      width: first.width,
      height: first.height,
    });
    const pdfTitle = title && !/\.(musx|mus|sib|docx?|pdf)$/i.test(title) ? title : undefined;
    if (layout)
      return {
        sha256: hash,
        pages: doc.numPages,
        title: pdfTitle,
        detection: { kind: 'known', layout, exercises: layoutExercises(layout) },
      };
    const lines: TextLine[] = [];
    for (let p = 1; p <= Math.min(doc.numPages, MAX_TEXT_PAGES); p++) {
      const page = await doc.getPage(p);
      const viewport = page.getViewport({ scale: 1 });
      const content = await page.getTextContent();
      const items = content.items.flatMap(item => {
        if (!('str' in item)) return [];
        // PDF coordinates grow upwards; the viewport transform turns the baseline into a top-down position.
        const [x, y] = viewport.convertToViewportPoint(item.transform[4], item.transform[5]);
        return [{ str: item.str, x, top: y - item.height, bottom: y, width: item.width }];
      });
      lines.push(...linesFromItems(items, p, viewport.width, viewport.height));
      page.cleanup();
    }
    const exercises = exercisesFromLines(lines);
    return {
      sha256: hash,
      pages: doc.numPages,
      title: pdfTitle,
      detection: exercises.length >= 2 ? { kind: 'labels', exercises } : { kind: 'none' },
    };
  } finally {
    handle.close();
  }
}

/** One exercise per page: the quick way to split a book of études (Czerny, Hanon…) before refining it. */
export function pageExercises(
  pages: number,
  kind: 'scales' | 'etudes' | 'other',
  start = 0,
): ExerciseDraft[] {
  return Array.from({ length: pages }, (_, i) => ({
    title: exerciseName(kind, start + i + 1),
    goal: '',
    region: { page: i + 1, x: 0, y: 0, w: 1, h: 1 },
    exercise: { order: start + i },
  }));
}

/** Default name of the n-th exercise of a collection. */
export const exerciseName = (kind: 'scales' | 'etudes' | 'other', n: number) =>
  kind === 'etudes' ? `Nº ${n}` : kind === 'scales' ? `Escala ${n}` : `Parte ${n}`;
