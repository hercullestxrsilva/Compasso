import { afterEach, describe, expect, it, vi } from 'vitest';
import { PracticeEngine } from '../src/practice/engine';
import { defaultConfig } from '../src/domain';
let time = 0;
const clicks: { time: number; frequency: number }[] = [];
class FakeAudio {
  state = 'running';
  destination = {};
  get currentTime() {
    return time;
  }
  async resume() {}
  async close() {
    this.state = 'closed';
  }
  createOscillator() {
    return {
      frequency: { value: 0 },
      connect() {},
      disconnect() {},
      onended: null,
      start(t: number) {
        clicks.push({ time: t, frequency: this.frequency.value });
      },
      stop() {},
    };
  }
  createGain() {
    return {
      gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} },
      connect() {},
      disconnect() {},
    };
  }
}
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  time = 0;
  clicks.splice(0);
});
function setup() {
  vi.useFakeTimers();
  vi.stubGlobal('AudioContext', FakeAudio);
}
function advance(seconds: number) {
  for (let i = 0; i < seconds * 40; i++) {
    time += 0.025;
    vi.advanceTimersByTime(25);
  }
}
describe('audio scheduling', () => {
  it('schedules each beat once, including after a rest', async () => {
    setup();
    let done = false;
    const engine = new PracticeEngine(
      { ...defaultConfig, bpm: 120, bars: 1, repetitions: 2, restSeconds: 1 },
      (_, complete) => {
        done ||= complete;
      },
    );
    await engine.start();
    advance(10);
    expect(done).toBe(true);
    expect(clicks).toHaveLength(16);
    expect(clicks[0].time).toBeCloseTo(0.08);
    expect(clicks[7].time).toBeCloseTo(3.58);
    expect(clicks[8].time).toBeCloseTo(5.08);
    await engine.destroy();
  });
  it('continues the clock while silent bars omit audible clicks', async () => {
    setup();
    const engine = new PracticeEngine(
      { ...defaultConfig, bpm: 120, bars: 4, countInBars: 0, repetitions: 1, audibleBars: 1, silentBars: 1 },
      () => {},
    );
    await engine.start();
    advance(9);
    expect(clicks).toHaveLength(8);
    expect(clicks.map(c => Number(c.time.toFixed(2)))).toEqual([
      0.08, 0.58, 1.08, 1.58, 4.08, 4.58, 5.08, 5.58,
    ]);
    await engine.destroy();
  });
  it('does not count time while paused', async () => {
    setup();
    const engine = new PracticeEngine(defaultConfig, () => {});
    await engine.start();
    advance(1);
    engine.pause();
    const before = engine.elapsed;
    advance(3);
    expect(engine.elapsed).toBe(before);
    await engine.start();
    advance(1);
    expect(engine.elapsed).toBeCloseTo(before + 0.92, 1);
    await engine.destroy();
  });
});
