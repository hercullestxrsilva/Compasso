import { describe, expect, it } from 'vitest';
import {
  focusCrop,
  LEAD_IN,
  movePoints,
  overlayPath,
  overlayRect,
  overlayViewBox,
  pointFromClient,
  sameRegion,
  toOverlay,
} from '../src/annotations';

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

describe('overlay coordinates', () => {
  const a4 = 297 / 210;

  it('keeps the viewBox in the page proportions so drawings are not stretched', () => {
    expect(overlayViewBox(a4)).toBe('0 0 1000 1414.29');
    expect(overlayViewBox(1)).toBe('0 0 1000 1000');
  });

  it('scales both axes by the same screen size per unit', () => {
    const sheetWidth = 700,
      sheetHeight = sheetWidth * a4;
    const [, , vbWidth, vbHeight] = overlayViewBox(a4).split(' ').map(Number);
    expect(sheetWidth / vbWidth).toBeCloseTo(sheetHeight / vbHeight, 3);
  });

  it('maps stored points and back without migration', () => {
    const stored = { x: 0.25, y: 0.5 };
    const at = toOverlay(stored, a4);
    expect(at.x).toBeCloseTo(250);
    expect(at.y).toBeCloseTo(707.14, 1);
    // A pointer at the same place on a 700 px wide sheet produces the same stored point.
    const rect = { left: 10, top: 20, width: 700, height: 700 * a4 };
    const back = pointFromClient(10 + 0.25 * 700, 20 + 0.5 * 700 * a4, rect);
    expect(back.x).toBeCloseTo(stored.x);
    expect(back.y).toBeCloseTo(stored.y);
    expect(pointFromClient(-50, 5000, rect)).toEqual({ x: 0, y: 1 });
  });

  it('builds paths and rectangles in the same units', () => {
    expect(
      overlayPath(
        [
          { x: 0, y: 0 },
          { x: 0.5, y: 1 },
        ],
        2,
      ),
    ).toBe('M0,0 L500,2000');
    expect(overlayRect({ x: 0.1, y: 0.2, w: 0.3, h: 0.1 }, 2)).toEqual({
      x: 100,
      y: 400,
      width: 300,
      height: 200,
    });
  });
});

describe('focus crop', () => {
  const region = { page: 1, x: 0.5, y: 0.3, w: 0.2, h: 0.1 };

  it('keeps the bar before the trecho visible', () => {
    const crop = focusCrop(region);
    expect(crop.x).toBeCloseTo(0.5 - LEAD_IN);
    expect(crop.x + crop.w).toBeCloseTo(0.725);
    expect(crop.y).toBeCloseTo(0.275);
    expect(crop.h).toBeCloseTo(0.15);
  });

  it('stops at the page edge and can show the whole system', () => {
    expect(focusCrop({ ...region, x: 0.05 }).x).toBe(0);
    const system = focusCrop(region, 'system');
    expect(system.x).toBe(0);
    expect(system.w).toBe(1);
  });

  it('compares regions by value', () => {
    expect(sameRegion(region, { ...region })).toBe(true);
    expect(sameRegion(region, { ...region, page: 2 })).toBe(false);
    expect(sameRegion(region, undefined)).toBe(false);
  });
});
