import { describe, expect, it } from 'vitest';
import { movePoints } from '../src/annotations';

describe('moving annotations', () => {
  it('preserves the shape and pressure of pen strokes', () => {
    const original = [
      { x: 0.2, y: 0.3, pressure: 0.5 },
      { x: 0.4, y: 0.45, pressure: 0.8 },
    ];
    const moved = movePoints(original, 0.15, -0.1);
    expect(moved[0].x).toBeCloseTo(0.35);
    expect(moved[0].y).toBeCloseTo(0.2);
    expect(moved[1].x).toBeCloseTo(0.55);
    expect(moved[1].y).toBeCloseTo(0.35);
    expect(moved.map(p => p.pressure)).toEqual([0.5, 0.8]);
    expect(original[0].x).toBe(0.2);
  });
  it('clamps the whole annotation at the page edge', () => {
    const moved = movePoints(
      [
        { x: 0.8, y: 0.1 },
        { x: 0.9, y: 0.2 },
      ],
      0.6,
      -0.9,
    );
    expect(moved[0].x).toBeCloseTo(0.9);
    expect(moved[1].x).toBeCloseTo(1);
    expect(moved[0].y).toBeCloseTo(0);
    expect(moved[1].y).toBeCloseTo(0.1);
  });
});
