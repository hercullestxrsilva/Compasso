import type { Point, Region } from './domain';

/**
 * Annotations are stored normalized (x and y from 0 to 1 of the page width and height). The overlay draws
 * them in units of page-width/1000 on both axes, so text and strokes scale uniformly with the page and
 * match the PDF export, which converts the same units with the page width.
 */
export const OVERLAY_WIDTH = 1000;

export function overlayHeight(ratio: number) {
  return OVERLAY_WIDTH * ratio;
}

export function overlayViewBox(ratio: number) {
  return `0 0 ${OVERLAY_WIDTH} ${round(overlayHeight(ratio))}`;
}

/** Maps a stored point into overlay units. */
export function toOverlay(point: { x: number; y: number }, ratio: number) {
  return { x: point.x * OVERLAY_WIDTH, y: point.y * overlayHeight(ratio) };
}

export function overlayPath(points: Point[], ratio: number) {
  return points
    .map((p, i) => {
      const at = toOverlay(p, ratio);
      return `${i ? 'L' : 'M'}${round(at.x)},${round(at.y)}`;
    })
    .join(' ');
}

export function overlayRect(region: { x: number; y: number; w: number; h: number }, ratio: number) {
  return {
    x: region.x * OVERLAY_WIDTH,
    y: region.y * overlayHeight(ratio),
    width: region.w * OVERLAY_WIDTH,
    height: region.h * overlayHeight(ratio),
  };
}

/** Converts a pointer position into a stored point, clamped to the page. */
export function pointFromClient(
  clientX: number,
  clientY: number,
  rect: { left: number; top: number; width: number; height: number },
): Point {
  return {
    x: clamp01((clientX - rect.left) / rect.width),
    y: clamp01((clientY - rect.top) / rect.height),
  };
}

/** Move an entire annotation without changing the spacing between its points. */
export function movePoints(points: Point[], requestedX: number, requestedY: number): Point[] {
  let minX = 1,
    maxX = 0,
    minY = 1,
    maxY = 0;
  for (const point of points) {
    minX = Math.min(minX, point.x);
    maxX = Math.max(maxX, point.x);
    minY = Math.min(minY, point.y);
    maxY = Math.max(maxY, point.y);
  }
  const dx = Math.max(-minX, Math.min(1 - maxX, requestedX));
  const dy = Math.max(-minY, Math.min(1 - maxY, requestedY));
  return points.map(p => ({ ...p, x: p.x + dx, y: p.y + dy }));
}

/** 'lead-in' keeps about one bar before the trecho visible; 'system' shows the full width of the page. */
export type FocusContext = 'lead-in' | 'system';
/** Share of the page width added before the trecho: roughly one bar of a 4-bar system. */
export const LEAD_IN = 0.22;
const MARGIN = 0.025;

/** The part of the page shown when focusing on a trecho, in normalized page coordinates. */
export function focusCrop(region: Region, context: FocusContext = 'lead-in') {
  const left = context === 'system' ? 0 : Math.max(0, region.x - LEAD_IN);
  const right = context === 'system' ? 1 : Math.min(1, region.x + region.w + MARGIN);
  const top = Math.max(0, region.y - MARGIN);
  const bottom = Math.min(1, region.y + region.h + MARGIN);
  return { x: left, y: top, w: Math.max(0.01, right - left), h: Math.max(0.01, bottom - top) };
}

export function sameRegion(a: Region | undefined, b: Region | undefined) {
  return !!a && !!b && a.page === b.page && a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;
}

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}

function round(value: number) {
  return Math.round(value * 100) / 100;
}
