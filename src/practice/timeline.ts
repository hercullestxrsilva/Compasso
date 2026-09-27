import type { PracticeConfig } from '../domain';
export interface Round { index: number; bpm: number; start: number; practiceStart: number; practiceEnd: number; end: number; beatSeconds: number; beatsPerBar: number }
export type Phase = 'preparation' | 'practice' | 'rest' | 'complete';
export function beatsPerBar(c: PracticeConfig) { return (c.numerator * 4 / c.denominator) / (c.beatUnit === 'dotted-quarter' ? 1.5 : c.beatUnit === 'eighth' ? 0.5 : 1); }
export function buildTimeline(c: PracticeConfig): Round[] {
  let start = 0;
  return Array.from({ length: c.repetitions }, (_, index) => {
    const bpm = c.increaseEvery > 0 ? Math.min(Math.max(c.bpm, c.targetBpm), c.bpm + Math.floor(index / c.increaseEvery) * c.increaseBpm) : c.bpm;
    const beatSeconds = 60 / bpm, beats = beatsPerBar(c);
    const practiceStart = start + c.countInBars * beats * beatSeconds;
    const practiceEnd = practiceStart + (c.mode === 'bars' ? c.bars * beats * beatSeconds : c.seconds);
    const end = practiceEnd + (index < c.repetitions - 1 ? c.restSeconds : 0);
    const round = { index, bpm, start, practiceStart, practiceEnd, end, beatSeconds, beatsPerBar: beats }; start = end; return round;
  });
}
export function positionAt(rounds: Round[], elapsed: number) {
  const round = rounds.find(r => elapsed < r.end) ?? rounds[rounds.length - 1];
  const phase: Phase = elapsed >= rounds[rounds.length - 1].end ? 'complete' : elapsed < round.practiceStart ? 'preparation' : elapsed < round.practiceEnd ? 'practice' : 'rest';
  const boundary = phase === 'preparation' ? round.practiceStart : phase === 'practice' ? round.practiceEnd : round.end;
  const origin = phase === 'preparation' ? round.start : round.practiceStart;
  const beat = Math.floor(Math.max(0, elapsed - origin) / round.beatSeconds + 1e-7) % round.beatsPerBar;
  return { phase, round, remaining: Math.max(0, boundary - elapsed), beat, elapsed };
}
export function activeSeconds(rounds: Round[], elapsed: number) { return rounds.reduce((s, r) => s + Math.max(0, Math.min(elapsed, r.practiceEnd) - r.practiceStart), 0); }
export function completedRounds(rounds: Round[], elapsed: number) { return rounds.filter(r => elapsed >= r.practiceEnd).length; }
