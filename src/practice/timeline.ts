import type { PracticeConfig } from '../domain';
export interface Round {
  index: number;
  bpm: number;
  start: number;
  practiceStart: number;
  practiceEnd: number;
  end: number;
  beatSeconds: number;
  beatsPerBar: number;
}
export type Phase = 'preparation' | 'practice' | 'rest' | 'complete';
export function beatsPerBar(c: PracticeConfig) {
  return (
    (c.numerator * 4) /
    c.denominator /
    (c.beatUnit === 'dotted-quarter' ? 1.5 : c.beatUnit === 'eighth' ? 0.5 : 1)
  );
}
/** Timer-only sessions (metronome off) have no audible count-in. */
export function countInBars(c: PracticeConfig) {
  return c.metronome === false ? 0 : c.countInBars;
}
/** A timer always counts seconds; its `mode` is kept for when the metronome is switched back on. */
export function countsBars(c: PracticeConfig) {
  return c.mode === 'bars' && c.metronome !== false;
}
/** A continuous session still needs an end for the timeline: long enough to never be reached in practice. */
export const LOOP_SECONDS = 4 * 60 * 60;
export const isLoop = (c: PracticeConfig) => c.loop === true;
function makeRound(c: PracticeConfig, index: number, bpm: number, start: number): Round {
  const beatSeconds = 60 / bpm,
    beats = beatsPerBar(c);
  const practiceStart = start + countInBars(c) * beats * beatSeconds;
  if (isLoop(c)) {
    const practiceEnd = practiceStart + LOOP_SECONDS;
    return {
      index,
      bpm,
      start,
      practiceStart,
      practiceEnd,
      end: practiceEnd,
      beatSeconds,
      beatsPerBar: beats,
    };
  }
  const practiceEnd = practiceStart + (countsBars(c) ? c.bars * beats * beatSeconds : c.seconds);
  const end = practiceEnd + (index < c.repetitions - 1 ? c.restSeconds : 0);
  return { index, bpm, start, practiceStart, practiceEnd, end, beatSeconds, beatsPerBar: beats };
}
export function buildTimeline(c: PracticeConfig): Round[] {
  // Continuous: a single round at the starting tempo; repetitions, rests and the tempo ramp do not apply.
  if (isLoop(c)) return [makeRound(c, 0, c.bpm, 0)];
  let start = 0;
  return Array.from({ length: c.repetitions }, (_, index) => {
    const bpm =
      c.increaseEvery > 0
        ? Math.min(Math.max(c.bpm, c.targetBpm), c.bpm + Math.floor(index / c.increaseEvery) * c.increaseBpm)
        : c.bpm;
    const round = makeRound(c, index, bpm, start);
    start = round.end;
    return round;
  });
}
export function positionAt(rounds: Round[], elapsed: number) {
  const round = rounds.find(r => elapsed < r.end) ?? rounds[rounds.length - 1];
  const phase: Phase =
    elapsed >= rounds[rounds.length - 1].end
      ? 'complete'
      : elapsed < round.practiceStart
        ? 'preparation'
        : elapsed < round.practiceEnd
          ? 'practice'
          : 'rest';
  const boundary =
    phase === 'preparation' ? round.practiceStart : phase === 'practice' ? round.practiceEnd : round.end;
  const origin = phase === 'preparation' ? round.start : round.practiceStart;
  const beats = Math.floor(Math.max(0, elapsed - origin) / round.beatSeconds + 1e-7);
  const beat = beats % round.beatsPerBar;
  return {
    phase,
    round,
    remaining: Math.max(0, boundary - elapsed),
    beat,
    /** Beats since the start of the current phase; changes on every beat (used to restart the flash). */
    beatCount: beats,
    /** 1-based bar inside the practice phase (0 outside it). */
    bar: phase === 'practice' ? Math.floor(beats / round.beatsPerBar) + 1 : 0,
    elapsed,
  };
}
/** Same rule as the engine: after `audible` bars, `silent` bars without clicks. */
export function isSilentBar(c: PracticeConfig, bar: number) {
  return c.silentBars > 0 && bar > 0 && (bar - 1) % (c.audibleBars + c.silentBars) >= c.audibleBars;
}
export function activeSeconds(rounds: Round[], elapsed: number) {
  return rounds.reduce((s, r) => s + Math.max(0, Math.min(elapsed, r.practiceEnd) - r.practiceStart), 0);
}
export function completedRounds(rounds: Round[], elapsed: number) {
  return rounds.filter(r => elapsed >= r.practiceEnd).length;
}
/**
 * Highest tempo the student actually played: completed repetitions, plus the current one when at least half
 * of it was played. Undefined when nothing counts yet.
 */
export function maxBpmReached(rounds: Round[], elapsed: number) {
  const played = rounds.filter(
    r => elapsed >= r.practiceEnd || elapsed - r.practiceStart >= (r.practiceEnd - r.practiceStart) / 2,
  );
  return played.length ? Math.max(...played.map(r => r.bpm)) : undefined;
}
/**
 * Where "Continuar" should pick up after a pause, so the student re-enters with a count-in instead of mid-bar.
 * Null means continue exactly where it stopped (timer only, or during a rest).
 */
export function resumePlan(
  rounds: Round[],
  c: PracticeConfig,
  elapsed: number,
): { seekTo: number; prerollBars: number } | null {
  if (c.metronome === false) return null;
  const p = positionAt(rounds, elapsed),
    r = p.round;
  if (p.phase === 'rest' || p.phase === 'complete') return null;
  if (p.phase === 'preparation') return { seekTo: r.start, prerollBars: 0 };
  if (countsBars(c) && !isLoop(c)) return { seekTo: r.start, prerollBars: countInBars(c) ? 0 : 1 };
  // Long repetitions by time, and a continuous cycle: restart the interrupted bar with one bar of count-in.
  const bar = r.beatsPerBar * r.beatSeconds;
  return {
    seekTo: r.practiceStart + Math.floor((elapsed - r.practiceStart) / bar + 1e-7) * bar,
    prerollBars: 1,
  };
}
const clampBpm = (bpm: number) => Math.min(300, Math.max(20, bpm));
/** The cycle after a ± tempo change: its tempo, and a ramp's limit, moved by `delta` BPM. */
export function shiftConfig(c: PracticeConfig, delta: number): PracticeConfig {
  return {
    ...c,
    bpm: clampBpm(c.bpm + delta),
    ...(c.increaseEvery > 0 ? { targetBpm: clampBpm(c.targetBpm + delta) } : {}),
  };
}
/** Rebuilds the repetitions from `fromIndex` on with `delta` BPM, keeping the earlier ones untouched. */
export function shiftTempo(rounds: Round[], c: PracticeConfig, fromIndex: number, delta: number): Round[] {
  let start = rounds[fromIndex]?.start ?? 0;
  return rounds.map(r => {
    if (r.index < fromIndex) return r;
    const round = makeRound(c, r.index, clampBpm(r.bpm + delta), start);
    start = round.end;
    return round;
  });
}
/**
 * Applies a tempo change between repetitions: during a rest it affects the next repetitions; while paused
 * inside a repetition it affects that one too (restarting it in bar mode, keeping the position by time).
 */
export function retimeAt(rounds: Round[], c: PracticeConfig, elapsed: number, delta: number) {
  const p = positionAt(rounds, elapsed);
  if (p.phase === 'complete') return null;
  const index = p.phase === 'rest' ? p.round.index + 1 : p.round.index;
  if (index >= rounds.length) return null;
  const next = shiftTempo(rounds, c, index, delta);
  let at = elapsed;
  if (p.phase === 'preparation') at = next[index].start;
  else if (p.phase === 'practice')
    at = countsBars(c) ? next[index].start : next[index].practiceStart + (elapsed - p.round.practiceStart);
  return { rounds: next, elapsed: at };
}
