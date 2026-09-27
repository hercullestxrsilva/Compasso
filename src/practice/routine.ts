import {
  defaultConfig,
  hands,
  type Hand,
  type PracticeConfig,
  type RoutineItem,
  type Segment,
} from '../domain';
import { buildTimeline } from './timeline';
import { segmentConfig } from './setup';

/** Seconds between routine steps before the next one starts by itself. */
export const TRANSITION_SECONDS = 10;

export interface StepPlan {
  config: PracticeConfig;
  hand: Hand;
  title: string;
  segmentId?: string;
  pieceId?: string;
}

const clampSeconds = (s: number) => Math.min(3600, Math.max(5, Math.round(s)));

/** Repeats a cycle as many times as fit in about `seconds` (at least once); a timer becomes one block. */
export function fitToDuration(c: PracticeConfig, seconds: number): PracticeConfig {
  if (c.metronome === false) return { ...c, mode: 'seconds', seconds: clampSeconds(seconds), repetitions: 1 };
  const one = buildTimeline({ ...c, repetitions: 1 })[0].end;
  const repetitions = Math.round((seconds + c.restSeconds) / (one + c.restSeconds));
  return { ...c, repetitions: Math.min(100, Math.max(1, repetitions)) };
}

/**
 * The practice for one routine step. A segment keeps its own cycle (meter, count-in, rests, silent bars),
 * repeated to fill the step, at the step's BPM and hand. A free item ("Escalas") is a timer, with a
 * metronome only when the step has a BPM. Null when the step's segment no longer exists.
 */
export function resolveStep(item: RoutineItem, segment?: Segment): StepPlan | null {
  const seconds = item.minutes * 60;
  if (item.segmentId) {
    if (!segment) return null;
    const base = segmentConfig(segment);
    return {
      config: fitToDuration({ ...base, bpm: item.bpm ?? base.bpm }, seconds),
      hand: item.hand ?? segment.hand,
      title: segment.title,
      segmentId: segment.id,
      pieceId: segment.pieceId,
    };
  }
  return {
    config: {
      ...defaultConfig,
      ...(item.bpm ? { bpm: item.bpm } : { metronome: false }),
      mode: 'seconds',
      seconds: clampSeconds(seconds),
      repetitions: 1,
    },
    hand: item.hand ?? 'both',
    title: item.label?.trim() || 'Atividade livre',
  };
}

/** The first playable step at or after `from` (skipping steps whose segment was deleted), or -1. */
export function nextStepIndex(items: RoutineItem[], from: number, segments: Segment[]) {
  for (let i = Math.max(0, from); i < items.length; i++) {
    const id = items[i].segmentId;
    if (!id || segments.some(s => s.id === id)) return i;
  }
  return -1;
}

/** "Direita · 64 BPM · 3 min" */
export function stepDetail(item: RoutineItem, plan: StepPlan | null) {
  return [
    plan && (item.segmentId || item.hand) ? hands[plan.hand] : '',
    plan ? (plan.config.metronome === false ? 'Só cronômetro' : `${plan.config.bpm} BPM`) : '',
    `${formatMinutes(item.minutes)} min`,
  ]
    .filter(Boolean)
    .join(' · ');
}

export const formatMinutes = (minutes: number) =>
  minutes.toLocaleString('pt-BR', { maximumFractionDigits: 1 });
/** Total minutes of a routine, formatted ("12" or "7,5"). */
export const routineMinutes = (items: RoutineItem[]) =>
  formatMinutes(items.reduce((s, x) => s + x.minutes, 0));
