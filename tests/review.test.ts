import { describe, expect, it } from 'vitest';
import { addDays, daysBetween, nextReviewDate, reviewInterval, scheduleReview } from '../src/practice/review';

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
  it('handles month and year boundaries in local dates', () => {
    expect(addDays('2026-12-30', 3)).toBe('2027-01-02');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(daysBetween('2026-09-26', '2026-10-24')).toBe(28);
    expect(daysBetween('2026-10-24', '2026-09-26')).toBe(-28);
  });
});

describe('review after a session', () => {
  const today = '2026-09-26';
  it('starts a new trecho a week away', () => {
    expect(scheduleReview('comfortable', today)).toBe('2026-10-03');
    expect(scheduleReview('comfortable', today, { reviewDate: '' })).toBe('2026-10-03');
  });
  it('doubles the real spacing when the review was due', () => {
    // Practised 14 days ago and due today: four weeks next.
    expect(scheduleReview('comfortable', today, { reviewDate: today, lastDay: '2026-09-12' })).toBe(
      '2026-10-24',
    );
    // Due tomorrow counts as due.
    expect(scheduleReview('comfortable', today, { reviewDate: '2026-09-27', lastDay: '2026-09-19' })).toBe(
      '2026-10-10',
    );
    // Long overdue: capped at a month.
    expect(scheduleReview('comfortable', today, { reviewDate: '2026-08-01', lastDay: '2026-07-01' })).toBe(
      '2026-10-26',
    );
  });
  it('keeps the schedule for a second comfortable session the same day', () => {
    let schedule = { reviewDate: today, lastDay: '2026-09-19' };
    const first = scheduleReview('comfortable', today, schedule);
    expect(first).toBe('2026-10-10');
    // The same trecho again later that day (routine step or evening session): nothing grows.
    schedule = { reviewDate: first, lastDay: '2026-09-19' };
    expect(scheduleReview('comfortable', today, schedule)).toBe(first);
    expect(scheduleReview('comfortable', today, { reviewDate: first })).toBe(first);
  });
  it('gives the same date when a rating is tapped again or changed back', () => {
    const baseline = { reviewDate: '2026-09-29', lastDay: '2026-09-25' };
    const taps = ['comfortable', 'comfortable', 'improving', 'comfortable'] as const;
    const dates = taps.map(r => scheduleReview(r, today, baseline));
    expect(dates).toEqual(['2026-10-03', '2026-10-03', '2026-09-29', '2026-10-03']);
  });
  it('never brings a comfortable review closer than a week, nor pushes it when not due', () => {
    expect(scheduleReview('comfortable', today, { reviewDate: '2026-09-29' })).toBe('2026-10-03');
    expect(scheduleReview('comfortable', today, { reviewDate: '2026-10-20', lastDay: '2026-09-25' })).toBe(
      '2026-10-20',
    );
  });
  it('ignores a same-day session when measuring the spacing', () => {
    expect(scheduleReview('comfortable', today, { reviewDate: today, lastDay: today })).toBe('2026-10-03');
  });
  it('always follows difficult and improving ratings', () => {
    expect(scheduleReview('difficult', today, { reviewDate: '2026-10-20' })).toBe('2026-09-27');
    expect(scheduleReview('improving', today, { reviewDate: '2026-10-20' })).toBe('2026-09-29');
  });
});
