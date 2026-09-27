import { describe, expect, it } from 'vitest';
import { defaultConfig, type Piece, type Segment, type Session, type Task } from '../src/domain';
import {
  buildDailyPlan,
  dueReviews,
  pickFocus,
  planToRoutine,
  reasonText,
  reviewStatus,
} from '../src/practice/plan';

const today = '2026-09-26';
const piece = (id: string, status: Piece['status'] = 'studying'): Piece => ({
  id,
  title: `Peça ${id}`,
  composer: '',
  status,
  tags: '',
  createdAt: '2026-01-01',
  updatedAt: '2026-01-01',
});
const segment = (id: string, extra: Partial<Segment> = {}): Segment => ({
  id,
  pieceId: 'p1',
  scoreId: 's',
  title: `Trecho ${id}`,
  measures: '',
  goal: '',
  difficulty: '',
  hand: 'both',
  regions: [],
  bpm: 60,
  reviewDate: '',
  createdAt: `2026-01-01T10:00:0${id.length}`,
  ...extra,
});
const session = (
  segmentId: string | undefined,
  startedAt: string,
  extra: Partial<Session> = {},
): Session => ({
  id: `${segmentId}-${startedAt}`,
  segmentId,
  pieceId: 'p1',
  title: 'x',
  hand: 'both',
  config: defaultConfig,
  startedAt,
  endedAt: startedAt,
  activeSeconds: 300,
  completedRepetitions: 5,
  note: '',
  completed: true,
  ...extra,
});
const task = (segmentId: string, extra: Partial<Task> = {}): Task => ({
  id: `t-${segmentId}`,
  pieceId: 'p1',
  segmentId,
  title: `Tarefa ${segmentId}`,
  done: false,
  dueDate: '',
  createdAt: '2026-09-01',
  ...extra,
});

describe('review ordering', () => {
  it('lists due reviews oldest first with the days overdue', () => {
    const segments = [
      segment('a', { reviewDate: '2026-09-25' }),
      segment('b', { reviewDate: '2026-09-20' }),
      segment('c', { reviewDate: today }),
      segment('d', { reviewDate: '2026-09-30' }),
      segment('e'),
    ];
    expect(dueReviews(segments, today).map(r => [r.segment.id, r.daysOverdue])).toEqual([
      ['b', 6],
      ['a', 1],
      ['c', 0],
    ]);
  });
  it('classifies review dates relative to today', () => {
    expect(reviewStatus('', today)).toBe('none');
    expect(reviewStatus('2026-09-25', today)).toBe('overdue');
    expect(reviewStatus(today, today)).toBe('today');
    expect(reviewStatus('2026-10-03', today)).toBe('soon');
    expect(reviewStatus('2026-10-04', today)).toBe('later');
  });
});

describe('daily plan', () => {
  const pieces = [piece('p1'), piece('p2', 'learned')];

  it('orders overdue reviews, difficult trechos, tasks and recent pieces', () => {
    const segments = [
      segment('recent'),
      segment('task'),
      segment('hard', { rating: 'difficult' }),
      segment('due', { reviewDate: today }),
      segment('late', { reviewDate: '2026-09-20' }),
    ];
    const plan = buildDailyPlan({
      segments,
      sessions: [session('recent', '2026-09-24T18:00:00')],
      tasks: [task('task')],
      pieces,
      today,
      budget: 60,
    });
    expect(plan.items.map(i => i.segment.id)).toEqual(['late', 'due', 'hard', 'task', 'recent']);
    expect(plan.items[0].reasons).toEqual([{ kind: 'overdue', days: 6 }]);
    expect(plan.items[0].pieceTitle).toBe('Peça p1');
  });

  it('merges the reasons of a trecho that qualifies twice', () => {
    const plan = buildDailyPlan({
      segments: [segment('a', { reviewDate: '2026-09-24', rating: 'difficult' })],
      sessions: [],
      tasks: [task('a')],
      pieces,
      today,
      budget: 15,
    });
    expect(plan.items).toHaveLength(1);
    expect(plan.items[0].reasons.map(r => r.kind)).toEqual(['overdue', 'difficult', 'task']);
  });

  it('stays within the budget and reports what was left out', () => {
    const segments = Array.from({ length: 8 }, (_, i) => segment(`r${i}`, { reviewDate: `2026-09-1${i}` }));
    const plan = buildDailyPlan({ segments, sessions: [], tasks: [], pieces, today, budget: 15 });
    expect(plan.minutes).toBeLessThanOrEqual(15);
    expect(plan.items.map(i => i.minutes)).toEqual([5, 5, 5]);
    expect(plan.leftover).toBe(5);
    expect(plan.leftoverReviews.map(r => [r.segment.id, r.daysOverdue])).toEqual([
      ['r3', 13],
      ['r4', 12],
      ['r5', 11],
      ['r6', 10],
      ['r7', 9],
    ]);
    expect(plan.leftoverReviews[0].pieceTitle).toBe('Peça p1');
  });

  it('spreads spare time over few items without exceeding ten minutes each', () => {
    const plan = buildDailyPlan({
      segments: [segment('a', { reviewDate: today })],
      sessions: [],
      tasks: [],
      pieces,
      today,
      budget: 45,
    });
    expect(plan.items[0].minutes).toBe(10);
    expect(plan.minutes).toBe(10);
  });

  it('ignores difficult trechos of pieces not in study and finished tasks', () => {
    const plan = buildDailyPlan({
      segments: [segment('old', { pieceId: 'p2', rating: 'difficult' }), segment('t')],
      sessions: [],
      tasks: [task('t', { done: true }), task('missing')],
      pieces,
      today,
      budget: 30,
    });
    // 't' only comes back as a piece in study to resume, not for its finished task.
    expect(plan.items.map(i => [i.segment.id, i.reasons])).toEqual([['t', [{ kind: 'resume' }]]]);
  });

  it('brings back pieces in study after a break, the most recently practised first', () => {
    const plan = buildDailyPlan({
      segments: [
        segment('a1', { pieceId: 'a', createdAt: '2026-01-02' }),
        segment('a0', { pieceId: 'a', createdAt: '2026-01-01' }),
        segment('b1', { pieceId: 'b' }),
        segment('c1', { pieceId: 'c', rating: 'comfortable' }),
        segment('d1', { pieceId: 'd' }),
        segment('e1', { pieceId: 'e' }),
      ],
      sessions: [
        session('a1', '2026-09-01T10:00:00', { pieceId: 'a' }),
        session('b1', '2026-09-10T10:00:00', { pieceId: 'b' }),
      ],
      tasks: [],
      pieces: [piece('a'), piece('b'), piece('c'), piece('d'), piece('e'), piece('f', 'planned')],
      today,
      budget: 60,
    });
    // b was practised last; in a, the never-practised a0 comes before a1; c has only comfortable trechos.
    expect(plan.items.map(i => i.segment.id)).toEqual(['b1', 'a0', 'd1']);
    expect(plan.items.every(i => i.reasons[0].kind === 'resume')).toBe(true);
  });

  it('does not resume set-aside pieces when the plan already has enough', () => {
    const plan = buildDailyPlan({
      segments: [
        segment('r1', { reviewDate: today }),
        segment('r2', { reviewDate: today }),
        segment('r3', { reviewDate: today }),
        segment('x', { pieceId: 'x' }),
      ],
      sessions: [],
      tasks: [],
      pieces: [piece('p1'), piece('x')],
      today,
      budget: 60,
    });
    expect(plan.items.map(i => i.segment.id)).toEqual(['r1', 'r2', 'r3']);
  });

  it('picks the least recently practised open trecho of a recent piece', () => {
    const plan = buildDailyPlan({
      segments: [segment('a'), segment('b'), segment('c', { rating: 'comfortable' })],
      sessions: [
        session('a', '2026-09-25T10:00:00'),
        session('b', '2026-09-22T10:00:00'),
        session('c', '2026-09-10T10:00:00'),
      ],
      tasks: [],
      pieces,
      today,
      budget: 30,
    });
    expect(plan.items.map(i => i.segment.id)).toEqual(['b']);
    expect(plan.items[0].lastPractice).toBe('2026-09-22T10:00:00');
  });

  it('describes reasons in Portuguese with real plurals', () => {
    expect(reasonText({ kind: 'overdue', days: 1 })).toBe('revisão atrasada 1 dia');
    expect(reasonText({ kind: 'overdue', days: 3 })).toBe('revisão atrasada 3 dias');
    expect(reasonText({ kind: 'task', title: 'Dedilhado' })).toBe('tarefa: Dedilhado');
    expect(reasonText({ kind: 'recent' })).toBe('peça praticada nesta semana');
    expect(reasonText({ kind: 'resume' })).toBe('retomar a peça');
  });

  it('converts the plan into routine steps', () => {
    const plan = buildDailyPlan({
      segments: [segment('a', { reviewDate: today, hand: 'left', practiceConfig: { bpm: 72 } })],
      sessions: [],
      tasks: [],
      pieces,
      today,
      budget: 5,
    });
    expect(planToRoutine(plan.items)).toEqual([{ segmentId: 'a', minutes: 5, hand: 'left', bpm: 72 }]);
  });
});

describe('focus card', () => {
  const pieces = [piece('p1')];
  it('continues from the latest session', () => {
    const segments = [segment('a'), segment('b', { reviewDate: '2026-09-01' })];
    const focus = pickFocus(
      segments,
      [session('a', '2026-09-20T10:00:00'), session('b', '2026-09-10T10:00:00')],
      pieces,
      today,
    );
    expect(focus?.segment.id).toBe('a');
    expect(focus?.source).toBe('resume');
    expect(focus?.session?.startedAt).toBe('2026-09-20T10:00:00');
  });
  it('falls back to the most overdue review when the last trecho felt comfortable', () => {
    const segments = [
      segment('a', { rating: 'comfortable' }),
      segment('b', { reviewDate: '2026-09-21' }),
      segment('c', { reviewDate: '2026-09-11' }),
    ];
    const focus = pickFocus(segments, [session('a', '2026-09-20T10:00:00')], pieces, today);
    expect(focus).toMatchObject({ source: 'review', segment: { id: 'c' } });
  });
  it('suggests an open trecho of a piece in study when there is no history', () => {
    const focus = pickFocus([segment('done', { rating: 'comfortable' }), segment('open')], [], pieces, today);
    expect(focus).toMatchObject({ source: 'suggestion', segment: { id: 'open' } });
    expect(pickFocus([], [], pieces, today)).toBeUndefined();
  });
});
