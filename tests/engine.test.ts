import { afterEach, describe, expect, it, vi } from 'vitest';
import { PracticeEngine } from '../src/practice/engine';
import { defaultConfig } from '../src/domain';
let time = 0;
interface Click {
  time: number;
  frequency: number;
  cancelledAt?: number;
}
const clicks: Click[] = [];
const contexts: FakeAudio[] = [];
class FakeAudio {
  state = 'running';
  destination = {};
  listeners: (() => void)[] = [];
  added = 0;
  constructor() {
    contexts.push(this);
  }
  get currentTime() {
    return time;
  }
  async resume() {}
  async close() {
    this.state = 'closed';
  }
  addEventListener(_: string, fn: () => void) {
    this.added++;
    this.listeners.push(fn);
  }
  removeEventListener(_: string, fn: () => void) {
    this.listeners = this.listeners.filter(l => l !== fn);
  }
  createOscillator() {
    let click: Click | undefined;
    return {
      frequency: { value: 0 },
      connect() {},
      disconnect() {},
      onended: null,
      start(t: number) {
        click = { time: t, frequency: this.frequency.value };
        clicks.push(click);
      },
      stop(t?: number) {
        if (t === undefined && click && click.cancelledAt === undefined) click.cancelledAt = time;
      },
    };
  }
  createGain() {
    return {
      gain: {
        value: 1,
        setValueAtTime(v: number) {
          this.value = v;
        },
        exponentialRampToValueAtTime() {},
      },
      connect() {},
      disconnect() {},
    };
  }
}
/** Clicks that actually sounded: not cancelled before their time. */
const heard = () => clicks.filter(c => c.cancelledAt === undefined || c.time < c.cancelledAt);
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  time = 0;
  clicks.splice(0);
  contexts.splice(0);
});
function setup() {
  vi.useFakeTimers();
  vi.stubGlobal('AudioContext', FakeAudio);
}
function advance(seconds: number) {
  for (let i = 0; i < Math.round(seconds * 40); i++) {
    time += 0.025;
    vi.advanceTimersByTime(25);
  }
}
const increasing = (list: Click[]) => list.every((c, i) => i === 0 || c.time > list[i - 1].time + 0.01);
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
  it('accents the count-in downbeat', async () => {
    setup();
    const engine = new PracticeEngine({ ...defaultConfig, bpm: 120, bars: 1, repetitions: 1 }, () => {});
    await engine.start();
    advance(5);
    expect(clicks.slice(0, 4).map(c => c.frequency)).toEqual([1500, 1050, 1050, 1050]);
    expect(clicks[4].frequency).toBe(1250);
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
describe('restarting and resuming', () => {
  const config = { ...defaultConfig, bpm: 120, bars: 2, repetitions: 1 };
  it('restarts the repetition with its count-in, without duplicate clicks, keeping the played time', async () => {
    setup();
    let done = false;
    const engine = new PracticeEngine(config, (_, complete) => {
      done ||= complete;
    });
    await engine.start();
    advance(3);
    expect(engine.activeSeconds).toBeCloseTo(0.92, 1);
    engine.restartRound();
    expect(engine.elapsed).toBe(0);
    advance(10);
    expect(done).toBe(true);
    const sounded = heard();
    expect(increasing(sounded)).toBe(true);
    // Two count-ins were heard, the second right after the restart.
    const downbeats = sounded.filter(c => c.frequency === 1500);
    expect(downbeats).toHaveLength(2);
    expect(downbeats[1].time).toBeCloseTo(3.08, 1);
    // Four beats of the full count-in + eight of the passage after the restart.
    expect(sounded.filter(c => c.time > 3)).toHaveLength(12);
    expect(engine.activeSeconds).toBeCloseTo(4.92, 1);
    await engine.destroy();
  });
  it('resumes a bar-based repetition from its count-in by default', async () => {
    setup();
    const engine = new PracticeEngine(config, () => {});
    await engine.start();
    advance(3);
    engine.pause();
    advance(2);
    await engine.resume();
    expect(engine.elapsed).toBe(0);
    advance(1);
    const after = heard().filter(c => c.time > 5);
    expect(after[0].frequency).toBe(1500);
    expect(after[0].time).toBeCloseTo(5.08, 1);
    await engine.destroy();
  });
  it('resumes exactly where it stopped when asked to', async () => {
    setup();
    const engine = new PracticeEngine(config, () => {});
    await engine.start();
    advance(3);
    engine.pause();
    const at = engine.elapsed;
    await engine.resume(false);
    expect(engine.elapsed).toBeCloseTo(at, 5);
    await engine.destroy();
  });
  it('resumes a timed repetition with one bar of pre-roll from the interrupted bar', async () => {
    setup();
    const engine = new PracticeEngine(
      { ...defaultConfig, bpm: 120, mode: 'seconds', seconds: 60, repetitions: 1 },
      () => {},
    );
    await engine.start();
    advance(7.5); // elapsed 7.42: practice started at 2 s, bars last 2 s, so bar 3 began at 6 s
    engine.pause();
    await engine.resume();
    expect(engine.elapsed).toBeCloseTo(6, 5);
    expect(engine.preroll?.beatsPerBar).toBe(4);
    advance(1);
    // The clock waits during the pre-roll.
    expect(engine.elapsed).toBeCloseTo(6, 5);
    advance(1.2);
    expect(engine.preroll).toBeNull();
    expect(engine.elapsed).toBeGreaterThan(6);
    const after = heard().filter(c => c.time > 7.5);
    expect(after.slice(0, 5).map(c => c.frequency)).toEqual([1500, 1050, 1050, 1050, 1250]);
    expect(increasing(after)).toBe(true);
    await engine.destroy();
  });
});
describe('engine lifecycle', () => {
  it('listens to audio interruptions once per engine and pauses on them', async () => {
    setup();
    let interrupted = 0;
    const engine = new PracticeEngine(defaultConfig, () => {}, {
      onInterrupted: () => interrupted++,
    });
    await engine.start();
    engine.pause();
    await engine.start();
    engine.pause();
    await engine.start();
    const ctx = contexts[0];
    expect(ctx.added).toBe(1);
    ctx.state = 'suspended';
    ctx.listeners.forEach(l => l());
    expect(engine.running).toBe(false);
    expect(interrupted).toBe(1);
    await engine.destroy();
    expect(ctx.listeners).toHaveLength(0);
    expect(ctx.state).toBe('closed');
  });
  it('does not close a shared audio context', async () => {
    setup();
    const shared = new FakeAudio() as unknown as AudioContext;
    const engine = new PracticeEngine(defaultConfig, () => {}, { context: shared });
    await engine.start();
    await engine.destroy();
    expect(contexts[0].state).toBe('running');
    expect(contexts).toHaveLength(1);
  });
  it('runs a silent timer without audio when the metronome is off', async () => {
    setup();
    let done = false;
    const engine = new PracticeEngine(
      { ...defaultConfig, metronome: false, mode: 'seconds', seconds: 5, repetitions: 1 },
      (_, complete) => {
        done ||= complete;
      },
      { clock: () => time },
    );
    await engine.start();
    expect(engine.rounds[0].practiceStart).toBe(0);
    advance(6);
    expect(done).toBe(true);
    expect(clicks).toHaveLength(0);
    expect(contexts).toHaveLength(0);
    expect(engine.activeSeconds).toBeCloseTo(5);
  });
  it('changes the tempo of the following repetitions during a rest', async () => {
    setup();
    const engine = new PracticeEngine(
      { ...defaultConfig, bpm: 120, bars: 1, countInBars: 0, repetitions: 2, restSeconds: 2 },
      () => {},
    );
    await engine.start();
    advance(3); // first repetition lasts 2 s, now resting
    expect(engine.retime(-60)).toBe(true);
    expect(engine.rounds.map(r => r.bpm)).toEqual([120, 60]);
    advance(8);
    const second = heard().filter(c => c.time > 4);
    expect(second.map(c => Number((c.time - second[0].time).toFixed(2)))).toEqual([0, 1, 2, 3]);
    await engine.destroy();
  });
  it('applies the master volume', async () => {
    setup();
    const engine = new PracticeEngine(defaultConfig, () => {}, { volume: 0.5 });
    await engine.start();
    const output = (engine as unknown as { output: { gain: { value: number } } }).output;
    expect(output.gain.value).toBe(0.5);
    engine.setVolume(1.5);
    expect(output.gain.value).toBe(1.5);
    await engine.destroy();
  });
});
