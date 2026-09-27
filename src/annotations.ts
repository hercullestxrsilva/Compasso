import type { Point } from './domain';

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
