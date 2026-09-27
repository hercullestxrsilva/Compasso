import {
  activeSeconds,
  buildTimeline,
  completedRounds,
  positionAt,
  resumePlan,
  retimeAt,
  type Round,
} from './timeline';
import type { PracticeConfig } from '../domain';
export interface EngineOptions {
  /** Shared AudioContext (e.g. one for a whole routine, so later steps start without a tap). Not closed by destroy(). */
  context?: AudioContext | null;
  /** Master volume; 1 is the default level. */
  volume?: number;
  /** Time source in seconds, used when the metronome is off (timer only). */
  clock?: () => number;
  /** The system suspended the audio while running; the engine has already paused itself. */
  onInterrupted?: () => void;
}
export interface Preroll {
  remaining: number;
  beat: number;
  beatsPerBar: number;
}
export class PracticeEngine {
  context: AudioContext | null;
  private ownsContext: boolean;
  private output: GainNode | null = null;
  private volume: number;
  private clock: () => number;
  private onInterrupted?: () => void;
  private listening = false;
  private timer?: ReturnType<typeof setInterval>;
  private nodes = new Set<OscillatorNode>();
  private base = 0;
  private offset = 0;
  private scheduledUntil = 0;
  private prerollSeconds = 0;
  /** Practice seconds discarded by seeking backwards (restarting a repetition); they were really played. */
  private credit = 0;
  config: PracticeConfig;
  rounds: Round[];
  running = false;
  onUpdate: (elapsed: number, complete: boolean) => void;
  constructor(
    config: PracticeConfig,
    update: (elapsed: number, complete: boolean) => void,
    options: EngineOptions = {},
  ) {
    this.config = config;
    this.rounds = buildTimeline(config);
    this.onUpdate = update;
    this.context = options.context ?? null;
    this.ownsContext = !options.context;
    this.volume = options.volume ?? 1;
    this.clock = options.clock ?? (() => performance.now() / 1000);
    this.onInterrupted = options.onInterrupted;
  }
  get silent() {
    return this.config.metronome === false;
  }
  private now() {
    return !this.silent && this.context ? this.context.currentTime : this.clock();
  }
  get total() {
    return this.rounds.at(-1)!.end;
  }
  get elapsed() {
    return Math.min(this.total, this.offset + (this.running ? Math.max(0, this.now() - this.base) : 0));
  }
  get activeSeconds() {
    return activeSeconds(this.rounds, this.elapsed) + this.credit;
  }
  get completedRepetitions() {
    return completedRounds(this.rounds, this.elapsed);
  }
  /** Count-in played before resuming (not part of the timeline), or null. */
  get preroll(): Preroll | null {
    if (!this.running || !this.prerollSeconds) return null;
    const t = this.now();
    if (t >= this.base) return null;
    const round = positionAt(this.rounds, this.offset).round;
    const from = this.base - this.prerollSeconds;
    return {
      remaining: this.base - t,
      beat: Math.floor(Math.max(0, t - from) / round.beatSeconds + 1e-7) % round.beatsPerBar,
      beatsPerBar: round.beatsPerBar,
    };
  }
  async start({ prerollBars = 0 }: { prerollBars?: number } = {}) {
    if (this.running) return;
    if (!this.silent) {
      if (!this.context) {
        this.context = new AudioContext();
        this.ownsContext = true;
      }
      await this.context.resume();
      if (this.context.state !== 'running')
        throw new Error('Toque em iniciar novamente para ativar o áudio.');
      this.listen();
      if (!this.output) {
        this.output = this.context.createGain();
        this.output.gain.value = this.volume;
        this.output.connect(this.context.destination);
      }
    }
    this.running = true;
    this.anchor(this.offset, prerollBars);
    this.timer = setInterval(() => this.tick(), 25);
  }
  /** Continues after a pause; by default re-enters with a count-in (see resumePlan). */
  async resume(withCountIn = true) {
    const plan = withCountIn ? resumePlan(this.rounds, this.config, this.elapsed) : null;
    if (plan) this.seek(plan.seekTo);
    await this.start({ prerollBars: plan?.prerollBars ?? 0 });
  }
  /** Restarts the current repetition from its count-in (one bar of pre-roll when it has none). */
  restartRound() {
    const round = positionAt(this.rounds, this.elapsed).round;
    this.seek(round.start, !this.silent && this.config.countInBars === 0 ? 1 : 0);
  }
  seek(time: number, prerollBars = 0) {
    const from = this.elapsed,
      target = Math.min(this.total, Math.max(0, time));
    this.credit += Math.max(0, activeSeconds(this.rounds, from) - activeSeconds(this.rounds, target));
    if (this.running) this.anchor(target, prerollBars);
    else {
      this.offset = target;
      this.onUpdate(target, false);
    }
  }
  /** Changes the tempo by `delta` BPM between repetitions (see retimeAt). Returns false when not possible. */
  retime(delta: number) {
    const from = this.elapsed;
    const plan = retimeAt(this.rounds, this.config, from, delta);
    if (!plan) return false;
    this.credit += Math.max(0, activeSeconds(this.rounds, from) - activeSeconds(plan.rounds, plan.elapsed));
    this.rounds = plan.rounds;
    if (this.running) this.anchor(plan.elapsed, 0);
    else {
      this.offset = plan.elapsed;
      this.onUpdate(plan.elapsed, false);
    }
    return true;
  }
  setVolume(volume: number) {
    this.volume = volume;
    if (this.output && this.context) this.output.gain.setValueAtTime(volume, this.context.currentTime);
  }
  /** Makes timeline position `from` sound after an optional pre-roll, and schedules from there. */
  private anchor(from: number, prerollBars: number) {
    this.stopNodes();
    const round = positionAt(this.rounds, from).round;
    this.prerollSeconds = this.silent ? 0 : prerollBars * round.beatsPerBar * round.beatSeconds;
    this.offset = from;
    this.base = this.now() + (this.silent ? 0 : 0.08) + this.prerollSeconds;
    this.scheduledUntil = from - 0.000001;
    if (this.prerollSeconds) {
      const step = round.beatSeconds / this.config.subdivision,
        perBar = round.beatsPerBar * this.config.subdivision;
      const count = Math.round(this.prerollSeconds / step);
      for (let i = 0; i < count; i++)
        this.click(
          this.base - this.prerollSeconds + i * step,
          i % perBar === 0,
          i % this.config.subdivision !== 0,
          true,
        );
    }
    this.tick();
  }
  private listen() {
    if (this.listening || !this.context) return;
    this.listening = true;
    this.context.addEventListener('statechange', this.onStateChange);
  }
  private onStateChange = () => {
    if (this.running && !this.silent && this.context?.state !== 'running') {
      this.pause();
      this.onUpdate(this.elapsed, false);
      this.onInterrupted?.();
    }
  };
  private tick() {
    if (!this.running) return;
    const elapsed = this.elapsed,
      end = Math.min(this.total, elapsed + 0.12);
    if (!this.silent && this.context)
      for (const round of this.rounds) {
        if (round.start > end || round.practiceEnd < this.scheduledUntil) continue;
        const step = round.beatSeconds / this.config.subdivision;
        for (const [from, to, preparation] of [
          [round.start, round.practiceStart, true],
          [round.practiceStart, round.practiceEnd, false],
        ] as const) {
          const first = Math.max(0, Math.floor((this.scheduledUntil - from) / step) + 1);
          const last = Math.floor((Math.min(end, to - 0.000001) - from) / step);
          for (let i = first; i <= last; i++) {
            const time = from + i * step;
            const bar = Math.floor(i / (round.beatsPerBar * this.config.subdivision));
            if (
              !preparation &&
              this.config.silentBars > 0 &&
              bar % (this.config.audibleBars + this.config.silentBars) >= this.config.audibleBars
            )
              continue;
            this.click(
              this.base + time - this.offset,
              i % (round.beatsPerBar * this.config.subdivision) === 0,
              i % this.config.subdivision !== 0,
              preparation,
            );
          }
        }
      }
    this.scheduledUntil = end;
    const complete = positionAt(this.rounds, elapsed).phase === 'complete';
    if (complete) this.pause();
    this.onUpdate(elapsed, complete);
  }
  private click(time: number, accent: boolean, subdivision: boolean, preparation: boolean) {
    const ctx = this.context!;
    if (time < ctx.currentTime - 0.02) return;
    const oscillator = ctx.createOscillator(),
      gain = ctx.createGain();
    // The count-in downbeat is higher so "1" is recognisable before the passage starts.
    oscillator.frequency.value = preparation
      ? accent
        ? 1500
        : 1050
      : accent
        ? 1250
        : subdivision
          ? 600
          : 850;
    const at = Math.max(ctx.currentTime, time);
    gain.gain.setValueAtTime(subdivision ? 0.035 : accent ? 0.18 : 0.14, at);
    gain.gain.exponentialRampToValueAtTime(0.001, at + 0.04);
    oscillator.connect(gain);
    gain.connect(this.output ?? ctx.destination);
    this.nodes.add(oscillator);
    oscillator.onended = () => {
      this.nodes.delete(oscillator);
      oscillator.disconnect();
      gain.disconnect();
    };
    oscillator.start(at);
    oscillator.stop(at + 0.045);
  }
  private stopNodes() {
    for (const node of this.nodes) {
      try {
        node.stop();
      } catch {
        /* already ended */
      }
    }
    this.nodes.clear();
  }
  pause() {
    this.offset = this.elapsed;
    this.running = false;
    this.prerollSeconds = 0;
    clearInterval(this.timer);
    this.stopNodes();
  }
  async destroy() {
    this.pause();
    if (this.listening) this.context?.removeEventListener('statechange', this.onStateChange);
    this.listening = false;
    this.output?.disconnect();
    this.output = null;
    if (this.ownsContext) await this.context?.close();
    this.context = null;
  }
}
