import { describe, expect, it } from 'vitest';
import {
  addDays,
  currentInterval,
  daysBetween,
  nextReviewDate,
  reviewInterval,
} from '../src/practice/review';

describe('review scheduling', () => {
  it('reviews difficult passages tomorrow and improving ones in three days', () => {
    expect(nextReviewDate('difficult', '2026-09-26')).toBe('2026-09-27');
    expect(nextReviewDate('improving', '2026-09-26')).toBe('2026-09-29');
    expect(nextReviewDate('improving', '2026-09-26', 20)).toBe('2026-09-29');
  });
  it('spaces comfortable passages out, up to a month', () => {
    expect(reviewInterval('comfortable')).toBe(7);
    expect(reviewInterval('comfortable', 1)).toBe(7);
    expect(reviewInterval('comfortable', 7)).toBe(14);
    expect(reviewInterval('comfortable', 14)).toBe(28);
    expect(reviewInterval('comfortable', 28)).toBe(30);
    expect(reviewInterval('comfortable', -3)).toBe(7);
    expect(nextReviewDate('comfortable', '2026-09-26', 14)).toBe('2026-10-24');
  });
  it('reads the interval of the review that is scheduled now', () => {
    expect(currentInterval('2026-10-10', '2026-09-26')).toBe(14);
    expect(currentInterval('2026-09-20', '2026-09-26')).toBeUndefined();
    expect(currentInterval('', '2026-09-26')).toBeUndefined();
    expect(currentInterval('2026-10-10')).toBeUndefined();
  });
  it('handles month and year boundaries in local dates', () => {
    expect(addDays('2026-12-30', 3)).toBe('2027-01-02');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(daysBetween('2026-09-26', '2026-10-24')).toBe(28);
    expect(daysBetween('2026-10-24', '2026-09-26')).toBe(-28);
  });
});
