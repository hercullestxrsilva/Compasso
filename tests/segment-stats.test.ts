import { describe, expect, it } from 'vitest';
import { defaultConfig, type Session } from '../src/domain';
import { plural, relativeDay, segmentStats } from '../src/segment-stats';

const session = (overrides: Partial<Session>): Session => ({
  id: crypto.randomUUID(),
  segmentId: 'seg',
  title: 'Trecho',
  hand: 'both',
  config: { ...defaultConfig },
  startedAt: '2026-09-20T10:00:00.000Z',
  endedAt: '2026-09-20T10:10:00.000Z',
  activeSeconds: 300,
  completedRepetitions: 3,
  note: '',
  completed: true,
  ...overrides,
});

describe('segment stats', () => {
  it('summarises sessions per segment', () => {
    const stats = segmentStats([
      session({
        startedAt: '2026-09-18T10:00:00.000Z',
        config: { ...defaultConfig, bpm: 80 },
        note: 'Troquei o dedilhado no c. 19',
        rating: 'difficult',
      }),
      session({
        startedAt: '2026-09-21T10:00:00.000Z',
        endedAt: '2026-09-21T10:20:00.000Z',
        config: { ...defaultConfig, bpm: 72 },
        note: '  ',
        nextStep: 'Mão esquerda sozinha',
      }),
      session({ segmentId: 'other', config: { ...defaultConfig, bpm: 100 } }),
      session({ segmentId: undefined }),
    ]);
    expect(stats.size).toBe(2);
    expect(stats.get('seg')).toEqual({
      count: 2,
      totalSeconds: 600,
      lastAt: '2026-09-21T10:20:00.000Z',
      lastBpm: 72,
      bestBpm: 80,
      lastRating: 'difficult',
      lastNote: 'Troquei o dedilhado no c. 19',
      nextStep: 'Mão esquerda sozinha',
    });
    expect(stats.get('other')?.count).toBe(1);
  });

  it('writes counts and days in Portuguese', () => {
    expect(plural(1, 'sessão', 'sessões')).toBe('1 sessão');
    expect(plural(3, 'sessão', 'sessões')).toBe('3 sessões');
    expect(plural(0, 'marcação', 'marcações')).toBe('0 marcações');
    const today = new Date(2026, 8, 26, 15);
    expect(relativeDay(new Date(2026, 8, 26, 8).toISOString(), today)).toBe('hoje');
    expect(relativeDay(new Date(2026, 8, 25, 22).toISOString(), today)).toBe('ontem');
    expect(relativeDay(new Date(2026, 8, 21, 9).toISOString(), today)).toBe('há 5 dias');
    expect(relativeDay(new Date(2026, 7, 1, 9).toISOString(), today)).toMatch(/^em /);
  });
});
