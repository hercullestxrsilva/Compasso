import { buildTimeline, positionAt } from './timeline';
import type { PracticeConfig } from '../domain';
export class PracticeEngine {
  context: AudioContext | null = null;
  private timer?: ReturnType<typeof setInterval>;
  private nodes = new Set<OscillatorNode>();
  private base = 0; private offset = 0; private scheduledUntil = 0;
  config: PracticeConfig; rounds; running = false;
  onUpdate: (elapsed: number, complete: boolean) => void;
  constructor(config: PracticeConfig, update: (elapsed: number, complete: boolean) => void) { this.config = config; this.rounds = buildTimeline(config); this.onUpdate = update; }
  get elapsed() { return Math.min(this.rounds.at(-1)!.end, this.offset + (this.running && this.context ? Math.max(0, this.context.currentTime - this.base) : 0)); }
  async start() {
    this.context ??= new AudioContext(); await this.context.resume();
    if (this.context.state !== 'running') throw new Error('Toque em iniciar novamente para ativar o áudio.');
    this.base = this.context.currentTime + 0.08; this.scheduledUntil = this.offset - 0.000001; this.running = true;
    this.tick(); this.timer = setInterval(() => this.tick(), 25);
  }
  private tick() {
    if (!this.running || !this.context) return;
    const elapsed = this.elapsed, end = Math.min(this.rounds.at(-1)!.end, elapsed + 0.12);
    for (const round of this.rounds) {
      if (round.start > end || round.practiceEnd < this.scheduledUntil) continue;
      const step = round.beatSeconds / this.config.subdivision;
      for (const [from, to, preparation] of [[round.start, round.practiceStart, true], [round.practiceStart, round.practiceEnd, false]] as const) {
        const first = Math.max(0, Math.floor((this.scheduledUntil - from) / step) + 1);
        const last = Math.floor((Math.min(end, to - 0.000001) - from) / step);
        for (let i = first; i <= last; i++) {
          const time = from + i * step;
          const bar = Math.floor(i / (round.beatsPerBar * this.config.subdivision));
          if (!preparation && this.config.silentBars > 0 && bar % (this.config.audibleBars + this.config.silentBars) >= this.config.audibleBars) continue;
          this.click(this.base + time - this.offset, i % (round.beatsPerBar * this.config.subdivision) === 0, i % this.config.subdivision !== 0, preparation);
        }
      }
    }
    this.scheduledUntil = end;
    const complete = positionAt(this.rounds, elapsed).phase === 'complete';
    if (complete) this.pause();
    this.onUpdate(elapsed, complete);
  }
  private click(time: number, accent: boolean, subdivision: boolean, preparation: boolean) {
    const ctx = this.context!; if (time < ctx.currentTime - 0.02) return;
    const oscillator = ctx.createOscillator(), gain = ctx.createGain();
    oscillator.frequency.value = preparation ? 1050 : accent ? 1250 : subdivision ? 600 : 850;
    const at = Math.max(ctx.currentTime, time); gain.gain.setValueAtTime(subdivision ? .035 : .14, at); gain.gain.exponentialRampToValueAtTime(.001, at + .04);
    oscillator.connect(gain); gain.connect(ctx.destination); this.nodes.add(oscillator);
    oscillator.onended = () => { this.nodes.delete(oscillator); oscillator.disconnect(); gain.disconnect(); };
    oscillator.start(at); oscillator.stop(at + .045);
  }
  pause() { this.offset = this.elapsed; this.running = false; clearInterval(this.timer); for (const node of this.nodes) { try { node.stop(); } catch { /* already ended */ } } this.nodes.clear(); }
  async destroy() { this.pause(); await this.context?.close(); this.context = null; }
}
