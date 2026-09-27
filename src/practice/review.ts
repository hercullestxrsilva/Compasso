import type { Rating } from '../domain';

/** Days until the next review for a self-assessment. Comfortable passages space out, up to a month. */
export function reviewInterval(rating: Rating, previousIntervalDays?: number) {
  if (rating === 'difficult') return 1;
  if (rating === 'improving') return 3;
  const previous = previousIntervalDays && previousIntervalDays > 0 ? previousIntervalDays : 0;
  return Math.min(30, Math.max(7, Math.round(previous * 2)));
}

/** Adds whole days to a local 'YYYY-MM-DD' date (noon avoids daylight-saving edges). */
export function addDays(day: string, days: number) {
  const d = new Date(`${day}T12:00:00`);
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function daysBetween(from: string, to: string) {
  return Math.round(
    (new Date(`${to}T12:00:00`).getTime() - new Date(`${from}T12:00:00`).getTime()) / 86_400_000,
  );
}

/**
 * The interval of the review currently scheduled: from the previous session's day to the segment's review
 * date. Undefined when there is no usable schedule.
 */
export function currentInterval(reviewDate: string, previousSessionDay?: string) {
  if (!reviewDate || !previousSessionDay) return undefined;
  const days = daysBetween(previousSessionDay, reviewDate);
  return days > 0 ? days : undefined;
}

/** Next review date ('YYYY-MM-DD') after a session rated `rating` on `today`. */
export function nextReviewDate(rating: Rating, today: string, previousIntervalDays?: number) {
  return addDays(today, reviewInterval(rating, previousIntervalDays));
}
