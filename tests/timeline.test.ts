import { describe, expect, it } from 'vitest';
import { defaultConfig, configSchema } from '../src/domain';
import {
  activeSeconds,
  beatsPerBar,
  buildTimeline,
  completedRounds,
  isSilentBar,
  maxBpmReached,
  positionAt,
  resumePlan,
  retimeAt,
  shiftTempo,
} from '../src/practice/timeline';
describe('musical practice timeline', () => {
  it('accounts for preparation on all rounds and no final rest', () => {
    const r = buildTimeline(defaultConfig);
    expect(r[0].practiceEnd - r[0].practiceStart).toBe(32);
    expect(r.at(-1)?.end).toBe(220);
    expect(activeSeconds(r, 220)).toBe(160);
    expect(completedRounds(r, 220)).toBe(5);
  });
  it('distinguishes compound meter beat units', () => {
    expect(beatsPerBar({ ...defaultConfig, numerator: 6, denominator: 8, beatUnit: 'dotted-quarter' })).toBe(
      2,
    );
    expect(beatsPerBar({ ...defaultConfig, numerator: 6, denominator: 8, beatUnit: 'eighth' })).toBe(6);
  });
  it('applies progressive tempo only between configured repetitions', () => {
    const r = buildTimeline({ ...defaultConfig, increaseEvery: 2, increaseBpm: 10, targetBpm: 75 });
    expect(r.map(r => r.bpm)).toEqual([60, 60, 70, 70, 75]);
  });
  it('does not lower initial tempo when cap is configured lower', () => {
    expect(
      buildTimeline({ ...defaultConfig, bpm: 100, targetBpm: 60, increaseEvery: 1 }).every(
        r => r.bpm === 100,
      ),
    ).toBe(true);
  });
  it('classifies phase transitions at exact boundaries', () => {
    const r = buildTimeline(defaultConfig);
    expect(positionAt(r, 0).phase).toBe('preparation');
    expect(positionAt(r, 4).phase).toBe('practice');
    expect(positionAt(r, 36).phase).toBe('rest');
    expect(positionAt(r, 46).phase).toBe('preparation');
    expect(positionAt(r, 220).phase).toBe('complete');
  });
  it('preserves exact second durations independent of the meter', () => {
    const r = buildTimeline({ ...defaultConfig, mode: 'seconds', seconds: 17, bpm: 73, repetitions: 1 });
    expect(r[0].practiceEnd - r[0].practiceStart).toBeCloseTo(17);
    expect(r[0].end).toBe(r[0].practiceEnd);
  });
  it('only counts active time for interrupted sessions', () => {
    const r = buildTimeline(defaultConfig);
    expect(activeSeconds(r, 2)).toBe(0);
    expect(activeSeconds(r, 10)).toBe(6);
    expect(activeSeconds(r, 40)).toBe(32);
    expect(completedRounds(r, 35)).toBe(0);
  });
  it('validates unsafe values before scheduling', () => {
    expect(configSchema.safeParse({ ...defaultConfig, bpm: 0 }).success).toBe(false);
    expect(configSchema.safeParse({ ...defaultConfig, repetitions: 100000 }).success).toBe(false);
    expect(configSchema.safeParse({ ...defaultConfig, denominator: 3 }).success).toBe(false);
  });
  it('reports the bar inside the passage and which bars are silent', () => {
    const c = { ...defaultConfig, audibleBars: 2, silentBars: 1 };
    const r = buildTimeline(c);
    expect(positionAt(r, 2).bar).toBe(0);
    expect(positionAt(r, 4).bar).toBe(1);
    expect(positionAt(r, 14.5).bar).toBe(3);
    expect(positionAt(r, 14.5).beat).toBe(2);
    expect([1, 2, 3, 4, 5, 6].map(b => isSilentBar(c, b))).toEqual([false, false, true, false, false, true]);
    expect(isSilentBar(defaultConfig, 3)).toBe(false);
  });
  it('has no count-in when only the timer is used', () => {
    const r = buildTimeline({ ...defaultConfig, metronome: false, mode: 'seconds', seconds: 30 });
    expect(r[0].practiceStart).toBe(0);
    expect(r[0].practiceEnd).toBe(30);
  });
});
describe('resuming, restarting and changing tempo', () => {
  it('resumes a bar-based repetition from its count-in', () => {
    const r = buildTimeline(defaultConfig);
    expect(resumePlan(r, defaultConfig, 10)).toEqual({ seekTo: 0, prerollBars: 0 });
    expect(resumePlan(r, defaultConfig, 50)).toEqual({ seekTo: 46, prerollBars: 0 });
    expect(resumePlan(r, defaultConfig, 40)).toBeNull();
    const noCountIn = { ...defaultConfig, countInBars: 0 };
    expect(resumePlan(buildTimeline(noCountIn), noCountIn, 10)).toEqual({ seekTo: 0, prerollBars: 1 });
  });
  it('resumes a timed repetition from the interrupted bar with a pre-roll, and a timer where it stopped', () => {
    const c = { ...defaultConfig, mode: 'seconds' as const, seconds: 300, repetitions: 1 };
    expect(resumePlan(buildTimeline(c), c, 4 + 4 * 10 + 1.5)).toEqual({ seekTo: 44, prerollBars: 1 });
    const timer = { ...c, metronome: false };
    expect(resumePlan(buildTimeline(timer), timer, 100)).toBeNull();
  });
  it('shifts the tempo of later repetitions only', () => {
    const c = { ...defaultConfig, repetitions: 3 };
    const r = buildTimeline(c);
    const next = shiftTempo(r, c, 1, 20);
    expect(next.map(x => x.bpm)).toEqual([60, 80, 80]);
    expect(next[0]).toBe(r[0]);
    expect(next[1].start).toBe(r[1].start);
    expect(next[1].practiceEnd - next[1].practiceStart).toBeCloseTo(24);
    expect(next[2].start).toBeCloseTo(next[1].end);
    expect(shiftTempo(r, c, 0, -100)[0].bpm).toBe(20);
  });
  it('retimes between repetitions and restarts a paused bar-based repetition', () => {
    const r = buildTimeline(defaultConfig);
    const inRest = retimeAt(r, defaultConfig, 40, 10)!;
    expect(inRest.elapsed).toBe(40);
    expect(inRest.rounds.map(x => x.bpm)).toEqual([60, 70, 70, 70, 70]);
    const inside = retimeAt(r, defaultConfig, 20, -10)!;
    expect(inside.elapsed).toBe(0);
    expect(inside.rounds[0].bpm).toBe(50);
    const timed = { ...defaultConfig, mode: 'seconds' as const, seconds: 60 };
    const kept = retimeAt(buildTimeline(timed), timed, 30, 60)!;
    expect(kept.rounds[0].practiceStart).toBe(2);
    expect(kept.elapsed).toBe(28);
    expect(retimeAt(r, defaultConfig, 220, 5)).toBeNull();
  });
  it('knows the highest tempo that was really played', () => {
    const c = { ...defaultConfig, increaseEvery: 1, increaseBpm: 4, targetBpm: 80 };
    const r = buildTimeline(c);
    expect(maxBpmReached(r, 5)).toBeUndefined();
    expect(maxBpmReached(r, 36)).toBe(60);
    expect(maxBpmReached(r, r[2].practiceStart + 1)).toBe(64);
    expect(maxBpmReached(r, r[2].practiceEnd - 1)).toBe(68);
  });
});
