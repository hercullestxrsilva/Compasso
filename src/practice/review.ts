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

/** Next review date ('YYYY-MM-DD') after a session rated `rating` on `today`. */
export function nextReviewDate(rating: Rating, today: string, previousIntervalDays?: number) {
  return addDays(today, reviewInterval(rating, previousIntervalDays));
}

/** What a trecho's schedule looked like before this session was rated. */
export interface ReviewSchedule {
  /** The review date it had ('' or undefined when none). */
  reviewDate?: string;
  /** Day of its most recent earlier session, not counting today's. */
  lastDay?: string;
}

/**
 * The review date after rating a session on `today`. A comfortable passage only spaces out when its review
 * was due (overdue, today or tomorrow), doubling the real spacing since it was last practised. Before that
 * (a second session the same day, the same trecho twice in a routine, a rating changed) the schedule is kept,
 * at least a week away, so extra practice never pushes a review out by itself.
 */
export function scheduleReview(rating: Rating, today: string, schedule: ReviewSchedule = {}) {
  if (rating !== 'comfortable') return nextReviewDate(rating, today);
  const { reviewDate, lastDay } = schedule;
  if (reviewDate && daysBetween(today, reviewDate) > 1) {
    const week = addDays(today, 7);
    return reviewDate > week ? reviewDate : week;
  }
  return nextReviewDate(rating, today, lastDay && lastDay < today ? daysBetween(lastDay, today) : undefined);
}
