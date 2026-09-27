import { describe, expect, it } from 'vitest';
import { defaultConfig, type Recording, type Segment, type Session, type Task } from '../src/domain';
import {
  addDays,
  buildLessonReport,
  daysBetween,
  detectQuestions,
  formatMinutes,
  goalProgress,
  lastDays,
  lastLessonDay,
  parseGoal,
  plural,
  practiceStreak,
  reachedBpm,
  relativeDay,
  secondsByDay,
  segmentDays,
  summarizeSegment,
} from '../src/practice/stats';

const session = (startedAt: string, extra: Partial<Session> = {}): Session => ({
  id: startedAt,
  segmentId: 'a',
  pieceId: 'p1',
  title: 'Trecho A',
  hand: 'both',
  config: defaultConfig,
  startedAt,
  endedAt: startedAt,
  activeSeconds: 600,
  completedRepetitions: 5,
  note: '',
  completed: true,
  ...extra,
});

describe('dates and text', () => {
  it('counts calendar days across month boundaries', () => {
    expect(daysBetween('2026-09-28', '2026-10-02')).toBe(4);
    expect(daysBetween('2026-10-02', '2026-09-28')).toBe(-4);
    expect(addDays('2026-09-30', 1)).toBe('2026-10-01');
    expect(lastDays('2026-10-01', 3)).toEqual(['2026-09-29', '2026-09-30', '2026-10-01']);
  });
  it('uses real plurals and readable durations', () => {
    expect(plural(1, 'sessão', 'sessões')).toBe('1 sessão');
    expect(plural(0, 'sessão', 'sessões')).toBe('0 sessões');
    expect(formatMinutes(45 * 60)).toBe('45 min');
    expect(formatMinutes(80 * 60)).toBe('1 h 20 min');
    expect(formatMinutes(120 * 60)).toBe('2 h');
  });
  it('describes recent days relative to today', () => {
    expect(relativeDay('2026-09-26T08:00:00', '2026-09-26')).toBe('hoje');
    expect(relativeDay('2026-09-25', '2026-09-26')).toBe('ontem');
    expect(relativeDay('2026-09-22T08:00:00', '2026-09-26')).toBe('há 4 dias');
    expect(relativeDay('2026-09-12', '2026-09-26')).toMatch(/^em 12/);
  });
});

describe('tempo reached', () => {
  it('takes the fastest completed repetition of a progressive cycle', () => {
    const config = { ...defaultConfig, increaseEvery: 1, increaseBpm: 4, targetBpm: 90 };
    expect(reachedBpm({ config, completedRepetitions: 3, activeSeconds: 90 })).toBe(68);
    expect(reachedBpm({ config, completedRepetitions: 5, activeSeconds: 160 })).toBe(76);
  });
  it('uses the starting tempo when no repetition was completed', () => {
    expect(reachedBpm({ config: defaultConfig, completedRepetitions: 0, activeSeconds: 12 })).toBe(60);
  });
  it('ignores timer-only sessions and sessions without practice', () => {
    expect(
      reachedBpm({
        config: { ...defaultConfig, metronome: false },
        completedRepetitions: 3,
        activeSeconds: 99,
      }),
    ).toBeNull();
    expect(reachedBpm({ config: defaultConfig, completedRepetitions: 0, activeSeconds: 0 })).toBeNull();
  });
  it('groups a segment by day with the best tempo and total time', () => {
    const days = segmentDays(
      [
        session('2026-09-20T09:00:00', { config: { ...defaultConfig, bpm: 64 } }),
        session('2026-09-20T19:00:00', { config: { ...defaultConfig, bpm: 70 }, activeSeconds: 300 }),
        session('2026-09-18T09:00:00', { config: { ...defaultConfig, metronome: false } }),
        session('2026-09-19T09:00:00', { segmentId: 'other' }),
      ],
      'a',
    );
    expect(days).toEqual([
      { day: '2026-09-18', bpm: null, seconds: 600, sessions: 1 },
      { day: '2026-09-20', bpm: 70, seconds: 900, sessions: 2 },
    ]);
  });
  it('summarises ratings, notes and next steps within a period', () => {
    const summary = summarizeSegment(
      [
        session('2026-09-10T09:00:00', { rating: 'difficult', note: 'Muito cedo' }),
        session('2026-09-20T09:00:00', { rating: 'difficult', note: 'Pulso irregular' }),
        session('2026-09-22T09:00:00', {
          rating: 'improving',
          note: 'Mais regular',
          nextStep: 'Subir para 66',
          config: { ...defaultConfig, bpm: 64 },
        }),
      ],
      'a',
      '2026-09-15',
      '2026-09-26',
    );
    expect(summary).toMatchObject({
      sessions: 2,
      seconds: 1200,
      firstBpm: 60,
      lastBpm: 64,
      maxBpm: 64,
      firstRating: 'difficult',
      lastRating: 'improving',
      nextStep: 'Subir para 66',
    });
    expect(summary.notes.map(n => n.text)).toEqual(['Mais regular', 'Pulso irregular']);
  });
});

describe('consistency', () => {
  const sessions = [
    session('2026-09-26T08:00:00', { activeSeconds: 30 }),
    session('2026-09-25T08:00:00', { activeSeconds: 1200 }),
    session('2026-09-24T08:00:00', { activeSeconds: 600 }),
    session('2026-09-24T20:00:00', { activeSeconds: 600 }),
    session('2026-09-22T08:00:00', { activeSeconds: 900 }),
  ];
  it('counts a streak up to yesterday while today is still open', () => {
    expect(practiceStreak(sessions, '2026-09-26')).toEqual({ days: 2, includesToday: false });
    expect(practiceStreak(sessions, '2026-09-25')).toEqual({ days: 2, includesToday: true });
    expect(practiceStreak(sessions, '2026-09-28')).toEqual({ days: 0, includesToday: false });
  });
  it('measures a days goal and a minutes goal over the last days', () => {
    const seconds = secondsByDay(sessions, lastDays('2026-09-26', 7));
    expect(seconds).toEqual([0, 0, 900, 0, 1200, 1200, 30]);
    const days = goalProgress({ mode: 'days', days: 5, dayMinutes: 15 }, seconds);
    expect(days).toMatchObject({ done: 3, target: 5, met: false, lineMinutes: 15 });
    expect(days.dayMet).toEqual([false, false, true, false, true, true, false]);
    expect(goalProgress({ mode: 'minutes', minutes: 60 }, seconds)).toMatchObject({
      done: 56,
      met: false,
      lineMinutes: 9,
    });
  });
  it('reads stored goals defensively', () => {
    expect(parseGoal(null)).toEqual({ mode: 'days', days: 5, dayMinutes: 15 });
    expect(parseGoal('not json')).toEqual({ mode: 'days', days: 5, dayMinutes: 15 });
    expect(parseGoal('{"mode":"days","days":12,"dayMinutes":0}')).toEqual({
      mode: 'days',
      days: 7,
      dayMinutes: 1,
    });
    expect(parseGoal('{"mode":"minutes","minutes":150}')).toEqual({ mode: 'minutes', minutes: 150 });
  });
});

describe('next lesson report', () => {
  const segments: Segment[] = [
    {
      id: 'a',
      pieceId: 'p1',
      scoreId: 's',
      title: 'Entrada da mão esquerda',
      measures: '1-8',
      goal: 'Pulso estável',
      difficulty: '',
      hand: 'left',
      regions: [],
      bpm: 60,
      reviewDate: '',
      createdAt: '2026-09-01',
    },
  ];
  const tasks: Task[] = [
    {
      id: 't1',
      pieceId: 'p1',
      segmentId: 'a',
      title: 'Estudar com metrônomo',
      done: false,
      dueDate: '2026-09-30',
      createdAt: '2026-09-12',
    },
    { id: 't2', pieceId: 'p1', title: 'Feita', done: true, dueDate: '', createdAt: '2026-09-12' },
  ];
  const recordings: Recording[] = [
    { id: 'r', assetId: 'x', segmentId: 'a', title: 'Tentativa', createdAt: '2026-09-21T10:00:00', bpm: 64 },
    {
      id: 'r2',
      assetId: 'y',
      title: 'Na prática',
      createdAt: '2026-09-23T09:10:00',
      sessionId: '2026-09-23T09:00:00',
    },
    { id: 'old', assetId: 'z', title: 'Antiga', createdAt: '2026-09-02T10:00:00' },
  ];
  it('finds the last lesson and the questions written since then', () => {
    expect(
      lastLessonDay([{ date: '2026-09-12' }, { date: '2026-09-19' }, { date: '2026-10-03' }], '2026-09-26'),
    ).toBe('2026-09-19');
    expect(lastLessonDay([], '2026-09-26')).toBeUndefined();
    expect(
      detectQuestions(
        [
          { id: '1', text: 'Posso usar pedal aqui?', source: 'mine', createdAt: '2026-09-20T10:00:00' },
          { id: '2', text: 'Posso usar  pedal aqui?', source: 'ai', createdAt: '2026-09-21T10:00:00' },
          { id: '3', text: 'Nota sem pergunta', source: 'mine', createdAt: '2026-09-21T10:00:00' },
          { id: '4', text: 'Antiga?', source: 'mine', createdAt: '2026-09-01T10:00:00' },
        ],
        '2026-09-19',
      ),
    ).toEqual(['Posso usar pedal aqui?']);
  });
  it('builds a Markdown summary per trecho for the period', () => {
    const text = buildLessonReport({
      from: '2026-09-19',
      to: '2026-09-26',
      sessions: [
        session('2026-09-20T09:00:00', { rating: 'difficult', note: 'Pulso\nirregular' }),
        session('2026-09-23T09:00:00', {
          rating: 'improving',
          nextStep: 'Subir para 70',
          config: { ...defaultConfig, bpm: 66 },
        }),
        session('2026-09-10T09:00:00', { rating: 'comfortable' }),
        session('2026-09-24T09:00:00', { segmentId: undefined, kind: 'free', activeSeconds: 300 }),
      ],
      segments,
      pieces: [
        {
          id: 'p1',
          title: 'Noturno',
          composer: '',
          status: 'studying',
          tags: '',
          createdAt: '',
          updatedAt: '',
        },
      ],
      tasks,
      recordings,
      questions: ['Posso usar pedal aqui?'],
    });
    expect(text).toContain('# Preparação para a próxima aula');
    expect(text).toContain('**Prática:** 25 min em 3 dias · 3 sessões');
    expect(text).toContain('### Entrada da mão esquerda (Noturno, c. 1-8)');
    expect(text).toContain('- **Tempo:** 20 min em 2 sessões (2 dias)');
    expect(text).toContain('- **Andamento:** 60 → 66 BPM');
    expect(text).toContain('- **Como foi:** Difícil → Melhorando');
    expect(text).toContain(': Pulso irregular');
    expect(text).toContain('- **Próximo passo:** Subir para 70');
    expect(text).toContain('- Prática livre — 5 min em 1 sessão');
    expect(text).toContain('- [ ] Estudar com metrônomo (Noturno · Entrada da mão esquerda) — até');
    expect(text).not.toContain('Feita');
    expect(text).toContain('- Posso usar pedal aqui?');
    expect(text).toContain('Tentativa (Entrada da mão esquerda, 64 BPM)');
    expect(text).toContain('Na prática (66 BPM, mãos juntas)');
    expect(text).not.toContain('Antiga');
  });
});
