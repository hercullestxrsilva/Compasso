import { z } from 'zod';
export const statuses = { planned: 'Quero estudar', studying: 'Estudando', learned: 'Estudadas' } as const;
export type PieceStatus = keyof typeof statuses;
export const hands = { left: 'Esquerda', right: 'Direita', both: 'Ambas' } as const;
export type Hand = keyof typeof hands;
export type Rating = 'difficult' | 'improving' | 'comfortable';
export interface Piece {
  id: string;
  title: string;
  composer: string;
  status: PieceStatus;
  tags: string;
  createdAt: string;
  updatedAt: string;
}
export interface Asset {
  id: string;
  name: string;
  mime: string;
  size: number;
  blob: Blob;
  createdAt: string;
}
export interface Score {
  id: string;
  pieceId: string;
  assetId: string;
  title: string;
  createdAt: string;
}
export interface Point {
  x: number;
  y: number;
  pressure?: number;
}
export interface Annotation {
  id: string;
  scoreId: string;
  page: number;
  layer: string;
  kind: 'pen' | 'highlight' | 'text';
  color: string;
  width: number;
  points: Point[];
  text?: string;
  fontSize?: number;
  createdAt: string;
}
export interface Region {
  page: number;
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface Segment {
  id: string;
  pieceId: string;
  scoreId: string;
  title: string;
  measures: string;
  goal: string;
  difficulty: string;
  hand: Hand;
  regions: Region[];
  bpm: number;
  rating?: Rating;
  reviewDate: string;
  createdAt: string;
}
export interface PracticeConfig {
  bpm: number;
  numerator: number;
  denominator: number;
  beatUnit: 'quarter' | 'dotted-quarter' | 'eighth';
  subdivision: number;
  mode: 'bars' | 'seconds';
  bars: number;
  seconds: number;
  repetitions: number;
  countInBars: number;
  restSeconds: number;
  increaseEvery: number;
  increaseBpm: number;
  targetBpm: number;
  silentBars: number;
  audibleBars: number;
}
export const defaultConfig: PracticeConfig = {
  bpm: 60,
  numerator: 4,
  denominator: 4,
  beatUnit: 'quarter',
  subdivision: 1,
  mode: 'bars',
  bars: 8,
  seconds: 60,
  repetitions: 5,
  countInBars: 1,
  restSeconds: 10,
  increaseEvery: 0,
  increaseBpm: 2,
  targetBpm: 90,
  silentBars: 0,
  audibleBars: 4,
};
export interface Preset {
  id: string;
  name: string;
  segmentId?: string;
  config: PracticeConfig;
}
export interface Session {
  id: string;
  pieceId?: string;
  segmentId?: string;
  title: string;
  hand: Hand;
  config: PracticeConfig;
  startedAt: string;
  endedAt: string;
  activeSeconds: number;
  completedRepetitions: number;
  rating?: Rating;
  note: string;
  completed: boolean;
}
export interface Lesson {
  id: string;
  title: string;
  date: string;
  teacher: string;
  pieceId: string;
  assetId?: string;
  transcript: string;
  summary: string;
  createdAt: string;
}
export interface Note {
  id: string;
  pieceId?: string;
  lessonId?: string;
  text: string;
  source: 'mine' | 'teacher' | 'ai';
  timestamp?: number;
  createdAt: string;
}
export interface Task {
  id: string;
  pieceId: string;
  segmentId?: string;
  lessonId?: string;
  title: string;
  done: boolean;
  dueDate: string;
  createdAt: string;
}
export interface Recording {
  id: string;
  assetId: string;
  segmentId?: string;
  title: string;
  createdAt: string;
}
export interface Routine {
  id: string;
  title: string;
  items: { segmentId: string; minutes: number }[];
}
export const uid = () => crypto.randomUUID();
export const now = () => new Date().toISOString();
export const localDay = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export function formatDate(s: string) {
  return new Date(s.length === 10 ? `${s}T12:00:00` : s).toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: 'short',
  });
}
export function clock(seconds: number) {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
export const configSchema = z.object({
  bpm: z.number().min(20).max(300),
  numerator: z.number().int().min(1).max(12),
  denominator: z.union([z.literal(2), z.literal(4), z.literal(8), z.literal(16)]),
  beatUnit: z.enum(['quarter', 'dotted-quarter', 'eighth']),
  subdivision: z.number().int().min(1).max(4),
  mode: z.enum(['bars', 'seconds']),
  bars: z.number().int().min(1).max(128),
  seconds: z.number().min(5).max(3600),
  repetitions: z.number().int().min(1).max(100),
  countInBars: z.number().int().min(0).max(4),
  restSeconds: z.number().min(0).max(300),
  increaseEvery: z.number().int().min(0).max(20),
  increaseBpm: z.number().min(1).max(20),
  targetBpm: z.number().min(20).max(300),
  silentBars: z.number().int().min(0).max(8),
  audibleBars: z.number().int().min(1).max(16),
});
