import type { Piece, RoutineItem, Segment, Session, Task } from '../domain';
import { addDays, dayOf, daysBetween, plural } from './stats';

export type PlanReason =
  | { kind: 'overdue'; days: number }
  | { kind: 'due' }
  | { kind: 'difficult' }
  | { kind: 'task'; title: string }
  | { kind: 'recent' }
  | { kind: 'resume' }
  | { kind: 'warmup' };

export interface PlanItem {
  segment: Segment;
  pieceTitle?: string;
  minutes: number;
  reasons: PlanReason[];
  lastPractice?: string;
}

export interface DailyPlan {
  items: PlanItem[];
  minutes: number;
  /** Candidates left out because the budget ran out. */
  leftover: number;
  /** Due or overdue reviews among the leftovers, so they can still be reached from the plan. */
  leftoverReviews: { segment: Segment; pieceTitle?: string; daysOverdue: number }[];
}

export interface PlanInput {
  segments: Segment[];
  sessions: Session[];
  tasks: Task[];
  pieces: Piece[];
  today: string;
  /** Minutes available today. */
  budget: number;
}

/** Base minutes per kind of item; items are cut to what is left of the budget. */
const baseMinutes: Record<PlanReason['kind'], number> = {
  overdue: 5,
  due: 5,
  difficult: 6,
  task: 5,
  recent: 4,
  resume: 4,
  warmup: 5,
};
/** Shortest step worth scheduling. */
const MIN_ITEM = 3;
/** Spare budget is spread over the items up to this length, so a long plan does not turn into one marathon. */
const MAX_ITEM = 10;
/** A piece practised in these many days counts as "recent". */
const RECENT_DAYS = 7;
/** Below this many candidates, pieces in study that were set aside are brought back (e.g. after a break). */
const MIN_CANDIDATES = 3;

export type ReviewStatus = 'overdue' | 'today' | 'soon' | 'later' | 'none';

export function reviewStatus(reviewDate: string, today: string): ReviewStatus {
  if (!reviewDate) return 'none';
  const days = daysBetween(today, reviewDate);
  return days < 0 ? 'overdue' : days === 0 ? 'today' : days <= 7 ? 'soon' : 'later';
}

/** Reviews due today or earlier, oldest date first (so the most overdue come first). */
export function dueReviews(segments: Segment[], today: string) {
  return segments
    .filter(s => s.reviewDate && s.reviewDate <= today)
    .sort((a, b) => a.reviewDate.localeCompare(b.reviewDate) || a.title.localeCompare(b.title, 'pt-BR'))
    .map(segment => ({ segment, daysOverdue: daysBetween(segment.reviewDate, today) }));
}

/** Latest practice (ISO timestamp) per segment. */
export function lastPracticeBySegment(sessions: Session[]) {
  const last = new Map<string, string>();
  for (const s of sessions)
    if (s.segmentId && s.activeSeconds > 0 && (last.get(s.segmentId) ?? '') < s.startedAt)
      last.set(s.segmentId, s.startedAt);
  return last;
}

/** Warm-up exercises (scales, études), in collection order: collections as imported, then each book's order. */
function warmupSegments(segments: Segment[], pieces: Piece[]) {
  const collections = new Map(pieces.filter(p => p.warmup).map(p => [p.id, p.createdAt]));
  return segments
    .filter(s => collections.has(s.pieceId))
    .sort(
      (a, b) =>
        collections.get(a.pieceId)!.localeCompare(collections.get(b.pieceId)!) ||
        (a.exercise?.order ?? Number.MAX_SAFE_INTEGER) - (b.exercise?.order ?? Number.MAX_SAFE_INTEGER) ||
        a.createdAt.localeCompare(b.createdAt),
    );
}

/**
 * Today's warm-up: an exercise whose review is due, otherwise the one practised least recently — never practised
 * first, in book order — so the days rotate through the circle of fifths.
 */
export function pickWarmup(
  warmups: Segment[],
  last: Map<string, string>,
  today: string,
): { segment: Segment; reasons: PlanReason[] } | undefined {
  const due = dueReviews(warmups, today)[0];
  if (due)
    return {
      segment: due.segment,
      reasons: [
        { kind: 'warmup' },
        due.daysOverdue > 0 ? { kind: 'overdue', days: due.daysOverdue } : { kind: 'due' },
      ],
    };
  // Array sort is stable: exercises never practised (or practised on the same day) keep the book's order.
  const next = [...warmups].sort((a, b) => (last.get(a.id) ?? '').localeCompare(last.get(b.id) ?? ''))[0];
  return next && { segment: next, reasons: [{ kind: 'warmup' }] };
}

export function buildDailyPlan({
  segments: all,
  sessions,
  tasks,
  pieces,
  today,
  budget,
}: PlanInput): DailyPlan {
  const byId = new Map(all.map(s => [s.id, s]));
  const pieceById = new Map(pieces.map(p => [p.id, p]));
  const last = lastPracticeBySegment(sessions);
  const candidates = new Map<string, { segment: Segment; reasons: PlanReason[] }>();
  const add = (segment: Segment, reason: PlanReason) => {
    const existing = candidates.get(segment.id);
    if (existing) existing.reasons.push(reason);
    else candidates.set(segment.id, { segment, reasons: [reason] });
  };

  // One warm-up opens the plan; the rest of the plan is about the repertoire.
  const warmup = pickWarmup(warmupSegments(all, pieces), last, today);
  if (warmup) candidates.set(warmup.segment.id, { segment: warmup.segment, reasons: warmup.reasons });
  const segments = all.filter(s => !pieceById.get(s.pieceId)?.warmup);

  for (const { segment, daysOverdue } of dueReviews(segments, today))
    add(segment, daysOverdue > 0 ? { kind: 'overdue', days: daysOverdue } : { kind: 'due' });

  segments
    .filter(s => s.rating === 'difficult' && pieceById.get(s.pieceId)?.status === 'studying')
    // Most recently practised first: yesterday's struggle is the best thing to consolidate today.
    .sort((a, b) => (last.get(b.id) ?? '').localeCompare(last.get(a.id) ?? ''))
    .forEach(s => add(s, { kind: 'difficult' }));

  tasks
    .filter(t => !t.done && t.segmentId && byId.has(t.segmentId))
    .sort(
      (a, b) =>
        (a.dueDate || '9999').localeCompare(b.dueDate || '9999') || a.createdAt.localeCompare(b.createdAt),
    )
    .forEach(t => add(byId.get(t.segmentId!)!, { kind: 'task', title: t.title }));

  const lastByPiece = new Map<string, string>();
  for (const s of sessions)
    if (s.pieceId && s.activeSeconds > 0 && (lastByPiece.get(s.pieceId) ?? '') < s.startedAt)
      lastByPiece.set(s.pieceId, s.startedAt);
  /** The least recently practised trecho of a piece that is not yet comfortable (never practised first). */
  const openTrecho = (pieceId: string) =>
    segments
      .filter(s => s.pieceId === pieceId && s.rating !== 'comfortable' && !candidates.has(s.id))
      .sort(
        (a, b) =>
          (last.get(a.id) ?? '').localeCompare(last.get(b.id) ?? '') ||
          a.createdAt.localeCompare(b.createdAt),
      )[0];

  // One step per recently practised piece.
  const since = addDays(today, -RECENT_DAYS);
  const recentPieces = [...lastByPiece.entries()]
    .filter(([, startedAt]) => dayOf(startedAt) >= since)
    .sort((a, b) => b[1].localeCompare(a[1]))
    .map(([pieceId]) => pieceId);
  for (const pieceId of recentPieces) {
    const pick = openTrecho(pieceId);
    if (pick) add(pick, { kind: 'recent' });
  }

  // After a break the passes above can leave the plan empty exactly when it helps most: bring back the pieces
  // in study, the most recently practised first.
  pieces
    .filter(p => p.status === 'studying' && !p.warmup && !recentPieces.includes(p.id))
    .sort((a, b) => (lastByPiece.get(b.id) ?? '').localeCompare(lastByPiece.get(a.id) ?? ''))
    .forEach(p => {
      if (candidates.size >= MIN_CANDIDATES) return;
      const pick = openTrecho(p.id);
      if (pick) add(pick, { kind: 'resume' });
    });

  const items: PlanItem[] = [];
  const leftoverReviews: DailyPlan['leftoverReviews'] = [];
  let remaining = Math.max(0, Math.floor(budget)),
    leftover = 0;
  for (const { segment, reasons } of candidates.values()) {
    if (remaining < MIN_ITEM) {
      leftover++;
      const review = reasons.find(r => r.kind === 'overdue' || r.kind === 'due');
      if (review)
        leftoverReviews.push({
          segment,
          pieceTitle: pieceById.get(segment.pieceId)?.title,
          daysOverdue: review.kind === 'overdue' ? review.days : 0,
        });
      continue;
    }
    const minutes = Math.min(remaining, Math.max(...reasons.map(r => baseMinutes[r.kind])));
    remaining -= minutes;
    items.push({
      segment,
      pieceTitle: pieceById.get(segment.pieceId)?.title,
      minutes,
      reasons,
      lastPractice: last.get(segment.id),
    });
  }
  // A warm-up stays short: spare minutes go to the repertoire.
  const cap = (item: PlanItem) =>
    item.reasons.some(r => r.kind === 'warmup') ? baseMinutes.warmup : MAX_ITEM;
  for (let grew = true; remaining > 0 && grew;) {
    grew = false;
    for (const item of items)
      if (remaining > 0 && item.minutes < cap(item)) {
        item.minutes++;
        remaining--;
        grew = true;
      }
  }
  return { items, minutes: items.reduce((sum, i) => sum + i.minutes, 0), leftover, leftoverReviews };
}

export function reasonText(reason: PlanReason) {
  switch (reason.kind) {
    case 'overdue':
      return `revisão atrasada ${plural(reason.days, 'dia', 'dias')}`;
    case 'due':
      return 'revisão de hoje';
    case 'difficult':
      return 'difícil na última sessão';
    case 'task':
      return `tarefa: ${reason.title}`;
    case 'recent':
      return 'peça praticada nesta semana';
    case 'resume':
      return 'retomar a peça';
    case 'warmup':
      return 'aquecimento do dia';
  }
}

export type FocusSource = 'resume' | 'review' | 'suggestion';

/**
 * The trecho for the "Hoje" card: where the student stopped (latest session, unless it already felt
 * comfortable), otherwise the most overdue review, otherwise a trecho of a piece in study that is not comfortable.
 */
export function pickFocus(
  all: Segment[],
  sessions: Session[],
  pieces: Piece[],
  today: string,
): { segment: Segment; source: FocusSource; session?: Session } | undefined {
  // The card is about the repertoire: scales and études have their own place in the plan.
  const warmups = new Set(pieces.filter(p => p.warmup).map(p => p.id));
  const segments = all.filter(s => !warmups.has(s.pieceId));
  const byId = new Map(segments.map(s => [s.id, s]));
  const latest = sessions
    .filter(s => s.segmentId && byId.has(s.segmentId) && s.activeSeconds > 0)
    .reduce<Session | undefined>((a, b) => (!a || b.startedAt > a.startedAt ? b : a), undefined);
  const resumed = latest && byId.get(latest.segmentId!);
  if (resumed && resumed.rating !== 'comfortable')
    return { segment: resumed, source: 'resume', session: latest };
  const review = dueReviews(segments, today)[0];
  if (review) return { segment: review.segment, source: 'review' };
  const studying = new Set(pieces.filter(p => p.status === 'studying').map(p => p.id));
  const suggestion = segments
    .filter(s => studying.has(s.pieceId) && s.rating !== 'comfortable')
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];
  if (suggestion) return { segment: suggestion, source: 'suggestion' };
  return resumed ? { segment: resumed, source: 'resume', session: latest } : undefined;
}

/** The plan as routine steps, so it can be saved and run from Praticar. */
export const planToRoutine = (items: PlanItem[]): RoutineItem[] =>
  items.map(i => ({
    segmentId: i.segment.id,
    minutes: i.minutes,
    hand: i.segment.hand,
    bpm: i.segment.practiceConfig?.bpm ?? i.segment.bpm,
  }));
