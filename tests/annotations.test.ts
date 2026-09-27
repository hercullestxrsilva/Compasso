import { describe, expect, it } from 'vitest';
import { movePoints } from '../src/annotations';

describe('moving annotations', () => {
  it('preserves the shape and pressure of pen strokes', () => {
    const original = [{ x: .2, y: .3, pressure: .5 }, { x: .4, y: .45, pressure: .8 }];
    const moved = movePoints(original, .15, -.1);
    expect(moved[0].x).toBeCloseTo(.35);
    expect(moved[0].y).toBeCloseTo(.2);
    expect(moved[1].x).toBeCloseTo(.55);
    expect(moved[1].y).toBeCloseTo(.35);
    expect(moved.map(p => p.pressure)).toEqual([.5, .8]);
    expect(original[0].x).toBe(.2);
  });
  it('clamps the whole annotation at the page edge', () => {
    const moved = movePoints([{ x: .8, y: .1 }, { x: .9, y: .2 }], .6, -.9);
    expect(moved[0].x).toBeCloseTo(.9);
    expect(moved[1].x).toBeCloseTo(1);
    expect(moved[0].y).toBeCloseTo(0);
    expect(moved[1].y).toBeCloseTo(.1);
  });
});
