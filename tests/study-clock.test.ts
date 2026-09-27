import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearClock,
  getClock,
  isRunning,
  overlapSeconds,
  pauseClock,
  resumeClock,
  startClock,
  studySeconds,
  subscribeClock,
  type StudyClock,
} from '../src/study-clock';

describe('study clock', () => {
  beforeEach(() => clearClock());

  it('counts running time only, across pauses', () => {
    const t0 = Date.parse('2026-09-27T10:00:00Z');
    const clock: StudyClock = {
      startedAt: new Date(t0).toISOString(),
      spans: [
        { from: t0, to: t0 + 10 * 60_000 },
        { from: t0 + 15 * 60_000, to: t0 + 25 * 60_000 },
        { from: t0 + 30 * 60_000 },
      ],
    };
    expect(isRunning(clock)).toBe(true);
    expect(studySeconds(clock, t0 + 35 * 60_000)).toBe(25 * 60);
    expect(studySeconds(null)).toBe(0);
    // A Praticar session from 0:05 to 0:20 overlaps 5 + 5 minutes of running time; the pause is excluded.
    expect(overlapSeconds(clock, t0 + 5 * 60_000, t0 + 20 * 60_000, t0 + 35 * 60_000)).toBe(10 * 60);
  });

  it('starts, pauses, resumes and clears, telling its listeners each time', () => {
    let changes = 0;
    const stop = subscribeClock(() => changes++);
    startClock(1_000);
    expect(isRunning(getClock())).toBe(true);
    pauseClock(61_000);
    pauseClock(70_000); // already paused: ignored
    expect(isRunning(getClock())).toBe(false);
    resumeClock(121_000);
    startClock(999_999); // a session is already open: ignored
    pauseClock(181_000);
    expect(studySeconds(getClock(), 999_999)).toBe(120);
    expect(getClock()?.startedAt).toBe(new Date(1_000).toISOString());
    clearClock();
    expect(getClock()).toBe(null);
    stop();
    expect(changes).toBe(5);
  });
});
