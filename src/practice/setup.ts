import { configSchema, defaultConfig, type Piece, type PracticeConfig, type Segment } from '../domain';

export const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** What the practice screen is pointed at: '' is free practice, 'piece:<id>' a whole piece, else a segment id. */
export type Target = { kind: 'free' } | { kind: 'piece'; id: string } | { kind: 'segment'; id: string };
export function parseTarget(value: string): Target {
  if (!value) return { kind: 'free' };
  if (value.startsWith('piece:')) return { kind: 'piece', id: value.slice(6) };
  return { kind: 'segment', id: value };
}
export const pieceTarget = (pieceId: string) => `piece:${pieceId}`;

/** Bar count of a measure range such as "17–20" (4 bars); undefined when it is not a range. */
export function barsFromMeasures(measures: string) {
  const m = /(\d+)\s*[–—-]\s*(\d+)/.exec(measures);
  if (!m) return undefined;
  const bars = Number(m[2]) - Number(m[1]) + 1;
  return bars >= 1 && bars <= 128 ? bars : undefined;
}

/** A complete, valid config from partial or older data; invalid values fall back to `base`. */
export function completeConfig(
  partial: Partial<PracticeConfig> | undefined,
  base = defaultConfig,
): PracticeConfig {
  const parsed = configSchema.safeParse({ ...base, ...partial });
  if (parsed.success) return parsed.data;
  const out: PracticeConfig = { ...base };
  for (const [key, value] of Object.entries(partial ?? {}))
    if (configSchema.safeParse({ ...out, [key]: value }).success) Object.assign(out, { [key]: value });
  return out;
}

/** What a segment remembers between sessions: everything but the tempo, which belongs to the segment. */
export function rememberedConfig(c: PracticeConfig): Partial<PracticeConfig> {
  const { bpm: _bpm, ...rest } = c;
  return rest;
}

/** Same values, whatever the key order (so an unchanged cycle is not written again). */
export function sameConfig(a: Partial<PracticeConfig> = {}, b: Partial<PracticeConfig> = {}) {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)] as (keyof PracticeConfig)[]);
  return [...keys].every(key => a[key] === b[key]);
}

/** Switches between metronome and timer only, keeping the rest of the cycle (bars come back with the clicks). */
export function withMetronome(c: PracticeConfig, on: boolean): PracticeConfig {
  const { metronome: _metronome, ...rest } = c;
  return on ? rest : { ...rest, metronome: false };
}

const clampBpm = (bpm: number) => Math.min(300, Math.max(20, Math.round(bpm) || defaultConfig.bpm));

/** A segment's cycle: its remembered settings (or the defaults, sized to its measures) at its own BPM. */
export function segmentConfig(segment: Pick<Segment, 'bpm' | 'measures' | 'practiceConfig'>): PracticeConfig {
  const base = segment.practiceConfig
    ? completeConfig(segment.practiceConfig)
    : { ...defaultConfig, bars: barsFromMeasures(segment.measures) ?? defaultConfig.bars };
  return { ...base, bpm: clampBpm(segment.bpm) };
}

/** A run-through of a whole piece defaults to a quiet 10-minute timer. */
export const pieceDefaultConfig: PracticeConfig = {
  ...defaultConfig,
  metronome: false,
  mode: 'seconds',
  seconds: 600,
  repetitions: 1,
};

/** Validates a typed number without rewriting what the student is typing. */
export function parseNumber(text: string, min: number, max: number, integer = true) {
  const clean = text.trim().replace(',', '.');
  if (!clean) return { error: 'Informe um número.' };
  const value = Number(clean);
  if (!Number.isFinite(value)) return { error: 'Use apenas números.' };
  if (integer && !Number.isInteger(value)) return { error: 'Use um número inteiro.' };
  if (value < min || value > max) return { error: `Use um valor entre ${min} e ${max}.` };
  return { value };
}
/** On blur: the nearest valid value, or `fallback` when the text is not a number. */
export function settleNumber(text: string, min: number, max: number, integer: boolean, fallback: number) {
  const value = Number(text.trim().replace(',', '.'));
  if (!text.trim() || !Number.isFinite(value)) return fallback;
  const clamped = Math.min(max, Math.max(min, value));
  return integer ? Math.round(clamped) : clamped;
}

/**
 * Tap tempo: keeps the recent taps (a pause longer than 3 s starts over) and suggests the BPM of their median
 * interval once there are at least two.
 */
export function tapTempo(taps: number[], at: number) {
  const last = taps.at(-1);
  const recent = last !== undefined && at - last <= 3 && at > last ? [...taps.slice(-5), at] : [at];
  if (recent.length < 2) return { taps: recent, bpm: undefined };
  const intervals = recent
    .slice(1)
    .map((t, i) => t - recent[i])
    .sort((a, b) => a - b);
  const mid = Math.floor(intervals.length / 2);
  const median = intervals.length % 2 ? intervals[mid] : (intervals[mid - 1] + intervals[mid]) / 2;
  return { taps: recent, bpm: Math.min(300, Math.max(20, Math.round(60 / median))) };
}

const statusOrder = { studying: 0, planned: 1, learned: 2 } as const;
/** Pieces (studying first) with their segments in the order they were marked; orphans come last. */
export function groupByPiece<S extends Pick<Segment, 'pieceId' | 'createdAt'>>(
  pieces: Piece[],
  segments: S[],
) {
  const sorted = [...pieces].sort(
    (a, b) => statusOrder[a.status] - statusOrder[b.status] || a.title.localeCompare(b.title, 'pt-BR'),
  );
  const bySegment = (a: S, b: S) => a.createdAt.localeCompare(b.createdAt);
  const groups: { piece?: Piece; segments: S[] }[] = sorted.map(piece => ({
    piece,
    segments: segments.filter(s => s.pieceId === piece.id).sort(bySegment),
  }));
  const known = new Set(pieces.map(p => p.id));
  const orphans = segments.filter(s => !known.has(s.pieceId)).sort(bySegment);
  if (orphans.length) groups.push({ segments: orphans });
  return groups;
}

interface DeviceSettings {
  free?: Partial<PracticeConfig>;
  pieces?: Record<string, Partial<PracticeConfig>>;
  volume?: number;
  resumeWithCountIn?: boolean;
}
const storageKey = 'compasso.practice';
/** Per-device practice preferences (localStorage); always usable even when storage is blocked. */
export function readDevice(): DeviceSettings {
  try {
    const value = JSON.parse(localStorage.getItem(storageKey) ?? '{}');
    return value && typeof value === 'object' ? value : {};
  } catch {
    return {};
  }
}
export function writeDevice(patch: DeviceSettings) {
  try {
    const next = { ...readDevice(), ...patch };
    // Keep the per-piece memory small.
    if (next.pieces) next.pieces = Object.fromEntries(Object.entries(next.pieces).slice(-40));
    localStorage.setItem(storageKey, JSON.stringify(next));
  } catch {
    /* Private mode or blocked storage: preferences simply are not remembered. */
  }
}
export function deviceVolume() {
  const v = readDevice().volume;
  return typeof v === 'number' && v >= 0 && v <= 2 ? v : 1;
}
