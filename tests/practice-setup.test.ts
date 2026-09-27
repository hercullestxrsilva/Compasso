import { describe, expect, it } from 'vitest';
import { defaultConfig, type Piece, type Segment } from '../src/domain';
import {
  barsFromMeasures,
  completeConfig,
  groupByPiece,
  parseNumber,
  parseTarget,
  plural,
  rememberedConfig,
  sameConfig,
  segmentConfig,
  settleNumber,
  tapTempo,
  withMetronome,
} from '../src/practice/setup';
import {
  fitToDuration,
  nextStepIndex,
  resolveStep,
  routineMinutes,
  stepDetail,
} from '../src/practice/routine';
import { buildTimeline } from '../src/practice/timeline';

const segment = (patch: Partial<Segment> = {}): Segment => ({
  id: 's1',
  pieceId: 'p1',
  scoreId: '',
  title: 'Entrada',
  measures: '17–20',
  goal: '',
  difficulty: '',
  hand: 'right',
  regions: [],
  bpm: 72,
  reviewDate: '',
  createdAt: '2026-09-01',
  ...patch,
});
const piece = (id: string, title: string, status: Piece['status']): Piece => ({
  id,
  title,
  composer: '',
  status,
  tags: '',
  createdAt: '',
  updatedAt: '',
});

describe('practice setup', () => {
  it('switches to the timer and back without losing a bar-based cycle', () => {
    const bars = { ...defaultConfig, mode: 'bars' as const, bars: 8 };
    const timer = withMetronome(bars, false);
    expect(timer.metronome).toBe(false);
    const back = withMetronome(timer, true);
    expect(back).toEqual(bars);
    expect(back.mode).toBe('bars');
    expect(back.bars).toBe(8);
    expect('metronome' in back).toBe(false);
  });
  it('compares remembered cycles by value', () => {
    const a = rememberedConfig(defaultConfig);
    const reordered = Object.fromEntries(Object.entries(a).reverse());
    expect(sameConfig(a, reordered)).toBe(true);
    expect(sameConfig(a, { ...a, bars: 2 })).toBe(false);
    expect(sameConfig(a, { ...a, metronome: false })).toBe(false);
    expect(sameConfig(a, undefined)).toBe(false);
  });
  it('reads what the selector points at', () => {
    expect(parseTarget('')).toEqual({ kind: 'free' });
    expect(parseTarget('piece:abc')).toEqual({ kind: 'piece', id: 'abc' });
    expect(parseTarget('abc')).toEqual({ kind: 'segment', id: 'abc' });
  });
  it('sizes a new segment from its measures and uses its BPM', () => {
    expect(barsFromMeasures('17–20')).toBe(4);
    expect(barsFromMeasures('c. 5 - 12')).toBe(8);
    expect(barsFromMeasures('7')).toBeUndefined();
    expect(barsFromMeasures('20-17')).toBeUndefined();
    const c = segmentConfig(segment());
    expect(c.bars).toBe(4);
    expect(c.bpm).toBe(72);
    expect(c.numerator).toBe(4);
  });
  it('restores the remembered cycle of a segment, but not an older tempo', () => {
    const remembered = rememberedConfig({ ...defaultConfig, bpm: 50, numerator: 3, bars: 6, silentBars: 1 });
    expect(remembered).not.toHaveProperty('bpm');
    const c = segmentConfig(segment({ practiceConfig: remembered }));
    expect(c).toMatchObject({ bpm: 72, numerator: 3, bars: 6, silentBars: 1 });
  });
  it('drops invalid remembered values instead of breaking the session', () => {
    const c = completeConfig({ numerator: 99, bars: 3, denominator: 3 } as never);
    expect(c.numerator).toBe(defaultConfig.numerator);
    expect(c.denominator).toBe(4);
    expect(c.bars).toBe(3);
  });
  it('validates typed numbers without rewriting them', () => {
    expect(parseNumber('1', 20, 300)).toEqual({ error: 'Use um valor entre 20 e 300.' });
    expect(parseNumber('120', 20, 300)).toEqual({ value: 120 });
    expect(parseNumber('', 20, 300).error).toBe('Informe um número.');
    expect(parseNumber('7,5', 1, 10).error).toBe('Use um número inteiro.');
    expect(parseNumber('7,5', 1, 10, false)).toEqual({ value: 7.5 });
    expect(settleNumber('5', 20, 300, true, 60)).toBe(20);
    expect(settleNumber('abc', 20, 300, true, 60)).toBe(60);
    expect(settleNumber('88.6', 20, 300, true, 60)).toBe(89);
  });
  it('suggests a tempo from taps and starts over after a long pause', () => {
    let state = tapTempo([], 10);
    expect(state.bpm).toBeUndefined();
    for (const t of [10.5, 11, 11.52, 12]) state = tapTempo(state.taps, t);
    expect(state.bpm).toBe(120);
    expect(tapTempo(state.taps, 20)).toEqual({ taps: [20], bpm: undefined });
    expect(tapTempo([0], 0.1).bpm).toBe(300);
  });
  it('groups segments by piece, studying pieces first', () => {
    const groups = groupByPiece(
      [
        piece('a', 'Valsa', 'learned'),
        piece('b', 'Noturno', 'studying'),
        piece('c', 'Arabesque', 'studying'),
      ],
      [
        segment({ id: '1', pieceId: 'a' }),
        segment({ id: '2', pieceId: 'b', createdAt: '2026-09-03' }),
        segment({ id: '3', pieceId: 'b', createdAt: '2026-09-02' }),
        segment({ id: '4', pieceId: 'gone' }),
      ],
    );
    expect(groups.map(g => g.piece?.title)).toEqual(['Arabesque', 'Noturno', 'Valsa', undefined]);
    expect(groups[1].segments.map(s => s.id)).toEqual(['3', '2']);
    expect(groups[3].segments.map(s => s.id)).toEqual(['4']);
  });
  it('writes Portuguese plurals', () => {
    expect(plural(1, 'repetição', 'repetições')).toBe('1 repetição');
    expect(plural(3, 'repetição', 'repetições')).toBe('3 repetições');
  });
});

describe('routine steps', () => {
  it('keeps the segment cycle, repeated to fill the step, at the step tempo and hand', () => {
    const s = segment({ practiceConfig: rememberedConfig({ ...defaultConfig, numerator: 3, bars: 4 }) });
    const plan = resolveStep({ segmentId: 's1', minutes: 3, bpm: 60, hand: 'left' }, s)!;
    expect(plan).toMatchObject({ hand: 'left', title: 'Entrada', segmentId: 's1', pieceId: 'p1' });
    expect(plan.config).toMatchObject({ bpm: 60, numerator: 3, bars: 4, mode: 'bars' });
    const total = buildTimeline(plan.config).at(-1)!.end;
    expect(Math.abs(total - 180)).toBeLessThan(15);
    expect(resolveStep({ segmentId: 's1', minutes: 3 }, s)!.hand).toBe('right');
    expect(resolveStep({ segmentId: 'gone', minutes: 3 }, undefined)).toBeNull();
  });
  it('turns a free item into a timer, with a metronome only when it has a BPM', () => {
    const quiet = resolveStep({ label: ' Escalas ', minutes: 5 })!;
    expect(quiet.title).toBe('Escalas');
    expect(quiet.config).toMatchObject({ metronome: false, mode: 'seconds', seconds: 300, repetitions: 1 });
    expect(buildTimeline(quiet.config).at(-1)!.end).toBe(300);
    const clicked = resolveStep({ label: 'Arpejos', minutes: 2, bpm: 80 })!;
    expect(clicked.config.metronome).toBeUndefined();
    expect(clicked.config.bpm).toBe(80);
    expect(stepDetail({ label: 'Escalas', minutes: 5 }, quiet)).toBe('Só cronômetro · 5 min');
    expect(
      stepDetail({ segmentId: 's1', minutes: 3 }, resolveStep({ segmentId: 's1', minutes: 3 }, segment())),
    ).toBe('Direita · 72 BPM · 3 min');
  });
  it('formats routine minutes in Portuguese', () => {
    expect(
      routineMinutes([
        { label: 'a', minutes: 5 },
        { label: 'b', minutes: 2.5 },
      ]),
    ).toBe('7,5');
    expect(routineMinutes([{ label: 'a', minutes: 5 }])).toBe('5');
  });
  it('plays a long passage at least once', () => {
    expect(fitToDuration({ ...defaultConfig, bars: 64 }, 60).repetitions).toBe(1);
  });
  it('skips steps whose segment was deleted', () => {
    const items = [
      { segmentId: 'gone', minutes: 1 },
      { label: 'Escalas', minutes: 1 },
      { segmentId: 's1', minutes: 1 },
    ];
    expect(nextStepIndex(items, 0, [segment()])).toBe(1);
    expect(nextStepIndex(items, 2, [segment()])).toBe(2);
    expect(nextStepIndex(items, 2, [])).toBe(-1);
  });
});
