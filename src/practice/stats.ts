import {
  formatDate,
  localDay,
  type Hand,
  type Lesson,
  type Note,
  type Piece,
  type Rating,
  type Recording,
  type Segment,
  type Session,
  type Task,
} from '../domain';
import { buildTimeline } from './timeline';

/** "1 peça" / "3 peças". */
export const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export const ratingLabels: Record<Rating, string> = {
  difficult: 'Difícil',
  improving: 'Melhorando',
  comfortable: 'Confortável',
};

/** Hand in running text: "mão esquerda", "mãos juntas". */
export const handPhrase: Record<Hand, string> = {
  left: 'mão esquerda',
  right: 'mão direita',
  both: 'mãos juntas',
};

/** Local calendar day (YYYY-MM-DD) of an ISO timestamp. */
export const dayOf = (iso: string) => localDay(new Date(iso));

const dayNumber = (day: string) =>
  Date.UTC(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10))) / 86400000;

/** Whole calendar days from `from` to `to` (YYYY-MM-DD); negative when `to` is earlier. */
export const daysBetween = (from: string, to: string) => Math.round(dayNumber(to) - dayNumber(from));

export function addDays(day: string, n: number) {
  const d = new Date(`${day}T12:00:00`);
  d.setDate(d.getDate() + n);
  return localDay(d);
}

/** The `n` days ending at `today`, oldest first. */
export const lastDays = (today: string, n: number) =>
  Array.from({ length: n }, (_, i) => addDays(today, i - n + 1));

/** "hoje", "ontem", "há 3 dias", then the date itself after a week. */
export function relativeDay(isoOrDay: string, today: string) {
  const n = daysBetween(isoOrDay.length === 10 ? isoOrDay : dayOf(isoOrDay), today);
  return n <= 0 ? 'hoje' : n === 1 ? 'ontem' : n < 7 ? `há ${n} dias` : `em ${formatDate(isoOrDay)}`;
}

/** "45 min" or "1 h 20 min". */
export function formatMinutes(seconds: number) {
  const total = Math.round(seconds / 60);
  if (total < 60) return `${total} min`;
  const h = Math.floor(total / 60),
    m = total % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

/**
 * Tempo actually reached in a session: the fastest completed repetition (the timeline may speed up
 * between rounds), or the first round when none was completed. Null with the metronome off or no practice.
 */
export function reachedBpm(s: Pick<Session, 'config' | 'completedRepetitions' | 'activeSeconds'>) {
  if (s.config.metronome === false || !(s.activeSeconds > 0)) return null;
  const rounds = buildTimeline(s.config);
  if (!rounds.length) return s.config.bpm;
  const played = rounds.slice(0, Math.min(rounds.length, Math.max(1, s.completedRepetitions)));
  return Math.max(...played.map(r => r.bpm));
}

/** Kind of practice; old sessions have no kind, so infer it from the segment link. */
export const sessionKind = (s: Pick<Session, 'kind' | 'segmentId'>) =>
  s.kind ?? (s.segmentId ? 'segment' : 'free');

/** Seconds of active practice per day for the given days. */
export function secondsByDay(sessions: Session[], days: string[]) {
  const totals = new Map(days.map(d => [d, 0]));
  for (const s of sessions) {
    const day = dayOf(s.startedAt);
    if (totals.has(day)) totals.set(day, totals.get(day)! + s.activeSeconds);
  }
  return days.map(d => totals.get(d)!);
}

/** A day counts towards the streak with at least one minute of active practice. */
const STREAK_SECONDS = 60;

/**
 * Consecutive days with practice ending today, or ending yesterday while today is still open
 * (so the streak does not look broken in the morning).
 */
export function practiceStreak(sessions: Session[], today: string) {
  const totals = new Map<string, number>();
  for (const s of sessions) {
    const day = dayOf(s.startedAt);
    totals.set(day, (totals.get(day) ?? 0) + s.activeSeconds);
  }
  const practised = (day: string) => (totals.get(day) ?? 0) >= STREAK_SECONDS;
  const includesToday = practised(today);
  let day = includesToday ? today : addDays(today, -1),
    days = 0;
  while (practised(day)) {
    days++;
    day = addDays(day, -1);
  }
  return { days, includesToday };
}

export type WeeklyGoal =
  { mode: 'days'; days: number; dayMinutes: number } | { mode: 'minutes'; minutes: number };
export const defaultGoal = { mode: 'days', days: 5, dayMinutes: 15 } as const satisfies WeeklyGoal;

const clampInt = (value: unknown, min: number, max: number, fallback: number) =>
  typeof value === 'number' && Number.isFinite(value)
    ? Math.min(max, Math.max(min, Math.round(value)))
    : fallback;

/** Reads a stored goal, falling back to the default for anything missing or malformed. */
export function parseGoal(raw: string | null | undefined): WeeklyGoal {
  try {
    const value = JSON.parse(raw ?? '');
    if (value?.mode === 'minutes')
      return { mode: 'minutes', minutes: clampInt(value.minutes, 10, 3000, 120) };
    if (value?.mode === 'days')
      return {
        mode: 'days',
        days: clampInt(value.days, 1, 7, defaultGoal.days),
        dayMinutes: clampInt(value.dayMinutes, 1, 240, defaultGoal.dayMinutes),
      };
  } catch {
    /* Not stored yet or not JSON. */
  }
  return { ...defaultGoal };
}

/** Progress over the given days (normally the last 7): days that met the daily minimum, or total minutes. */
export function goalProgress(goal: WeeklyGoal, daySeconds: number[]) {
  if (goal.mode === 'days') {
    const dayMet = daySeconds.map(s => s >= goal.dayMinutes * 60);
    const done = dayMet.filter(Boolean).length;
    return { done, target: goal.days, met: done >= goal.days, dayMet, lineMinutes: goal.dayMinutes };
  }
  const done = Math.round(daySeconds.reduce((a, b) => a + b, 0) / 60);
  return {
    done,
    target: goal.minutes,
    met: done >= goal.minutes,
    dayMet: daySeconds.map(() => false),
    lineMinutes: Math.ceil(goal.minutes / 7),
  };
}

export interface DayPoint {
  day: string;
  /** Highest tempo reached that day, or null when only timer (no metronome) sessions happened. */
  bpm: number | null;
  seconds: number;
  sessions: number;
}

/** Per-day tempo and practice time for one segment, oldest first. */
export function segmentDays(sessions: Session[], segmentId: string): DayPoint[] {
  const byDay = new Map<string, DayPoint>();
  for (const s of sessions) {
    if (s.segmentId !== segmentId || !(s.activeSeconds > 0)) continue;
    const day = dayOf(s.startedAt);
    const point = byDay.get(day) ?? { day, bpm: null, seconds: 0, sessions: 0 };
    const bpm = reachedBpm(s);
    point.seconds += s.activeSeconds;
    point.sessions++;
    if (bpm !== null) point.bpm = Math.max(point.bpm ?? 0, bpm);
    byDay.set(day, point);
  }
  return [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day));
}

export interface SegmentSummary {
  segmentId: string;
  sessions: number;
  seconds: number;
  days: DayPoint[];
  firstBpm: number | null;
  lastBpm: number | null;
  maxBpm: number | null;
  firstRating?: Rating;
  lastRating?: Rating;
  lastPractice?: string;
  /** Latest session notes with their dates, newest first. */
  notes: { at: string; text: string }[];
  nextStep?: string;
}

/** Sessions of one segment in [from, to] (YYYY-MM-DD, inclusive) summarised for review. */
export function summarizeSegment(
  sessions: Session[],
  segmentId: string,
  from = '0000-01-01',
  to = '9999-12-31',
): SegmentSummary {
  const own = sessions
    .filter(s => s.segmentId === segmentId && s.activeSeconds > 0)
    .filter(s => {
      const day = dayOf(s.startedAt);
      return day >= from && day <= to;
    })
    .sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  const days = segmentDays(own, segmentId);
  const tempos = days.map(d => d.bpm).filter((b): b is number => b !== null);
  const rated = own.filter(s => s.rating);
  const newest = [...own].reverse();
  return {
    segmentId,
    sessions: own.length,
    seconds: own.reduce((sum, s) => sum + s.activeSeconds, 0),
    days,
    firstBpm: tempos[0] ?? null,
    lastBpm: tempos.at(-1) ?? null,
    maxBpm: tempos.length ? Math.max(...tempos) : null,
    firstRating: rated[0]?.rating,
    lastRating: rated.at(-1)?.rating,
    lastPractice: own.at(-1)?.startedAt,
    notes: newest
      .filter(s => s.note.trim())
      .slice(0, 3)
      .map(s => ({ at: s.startedAt, text: s.note.trim() })),
    nextStep: newest.find(s => s.nextStep?.trim())?.nextStep?.trim(),
  };
}

/** Day of the most recent lesson up to today, the default start of the "next lesson" report. */
export function lastLessonDay(lessons: Pick<Lesson, 'date'>[], today: string) {
  const past = lessons.map(l => l.date.slice(0, 10)).filter(d => d && d <= today);
  return past.length ? past.reduce((a, b) => (a > b ? a : b)) : undefined;
}

/** Notes written as questions (ending in "?") since `from`, oldest first and without duplicates. */
export function detectQuestions(notes: Note[], from: string) {
  const seen = new Set<string>();
  return [...notes]
    .filter(n => n.text.trim().endsWith('?') && dayOf(n.createdAt) >= from)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .map(n => n.text.trim().replace(/\s+/g, ' '))
    .filter(q => {
      if (seen.has(q)) return false;
      seen.add(q);
      return true;
    });
}

export interface ReportInput {
  from: string;
  to: string;
  sessions: Session[];
  segments: Segment[];
  pieces: Piece[];
  tasks: Task[];
  recordings: Recording[];
  questions: string[];
}

const longDate = (day: string) =>
  new Date(`${day}T12:00:00`).toLocaleDateString('pt-BR', { day: 'numeric', month: 'long', year: 'numeric' });
const oneLine = (text: string) => text.replace(/\s+/g, ' ').trim();

function tempoLine(s: SegmentSummary) {
  if (s.firstBpm === null || s.lastBpm === null) return 'sem metrônomo no período';
  const change = s.firstBpm === s.lastBpm ? `${s.lastBpm} BPM` : `${s.firstBpm} → ${s.lastBpm} BPM`;
  return s.maxBpm !== null && s.maxBpm > s.lastBpm ? `${change} (máximo ${s.maxBpm})` : change;
}

/** Markdown summary of the practice in [from, to], to bring to the next lesson. */
export function buildLessonReport(input: ReportInput) {
  const { from, to } = input;
  const inRange = (iso: string) => {
    const day = dayOf(iso);
    return day >= from && day <= to;
  };
  const sessions = input.sessions.filter(s => inRange(s.startedAt) && s.activeSeconds > 0);
  const pieceTitle = (id?: string) => input.pieces.find(p => p.id === id)?.title;
  const totalSeconds = sessions.reduce((sum, s) => sum + s.activeSeconds, 0);
  const practiceDays = new Set(sessions.map(s => dayOf(s.startedAt))).size;
  const lines = [
    '# Preparação para a próxima aula',
    '',
    `**Período:** ${longDate(from)} a ${longDate(to)}  `,
    sessions.length
      ? `**Prática:** ${formatMinutes(totalSeconds)} em ${plural(practiceDays, 'dia', 'dias')} · ${plural(sessions.length, 'sessão', 'sessões')}`
      : '**Prática:** nenhuma sessão registrada no período.',
    '',
  ];

  const segmentIds = [...new Set(sessions.filter(s => s.segmentId).map(s => s.segmentId!))];
  const summaries = segmentIds
    .map(id => ({ segment: input.segments.find(s => s.id === id), summary: summarizeSegment(sessions, id) }))
    .sort((a, b) => b.summary.seconds - a.summary.seconds);
  lines.push('## Trechos estudados', '');
  if (!summaries.length) lines.push('Nenhum trecho praticado no período.', '');
  for (const { segment, summary } of summaries) {
    const title = segment?.title ?? sessions.find(s => s.segmentId === summary.segmentId)?.title ?? 'Trecho';
    const context = [pieceTitle(segment?.pieceId), segment?.measures && `c. ${segment.measures}`]
      .filter(Boolean)
      .join(', ');
    lines.push(`### ${oneLine(title)}${context ? ` (${oneLine(context)})` : ''}`, '');
    lines.push(
      `- **Tempo:** ${formatMinutes(summary.seconds)} em ${plural(summary.sessions, 'sessão', 'sessões')} (${plural(summary.days.length, 'dia', 'dias')})`,
    );
    lines.push(`- **Andamento:** ${tempoLine(summary)}`);
    if (summary.lastRating)
      lines.push(
        `- **Como foi:** ${
          summary.firstRating && summary.firstRating !== summary.lastRating
            ? `${ratingLabels[summary.firstRating]} → ${ratingLabels[summary.lastRating]}`
            : ratingLabels[summary.lastRating]
        }`,
      );
    if (segment?.goal.trim()) lines.push(`- **Objetivo:** ${oneLine(segment.goal)}`);
    if (summary.notes.length) {
      lines.push('- **Últimas observações:**');
      for (const n of summary.notes) lines.push(`  - ${formatDate(n.at)}: ${oneLine(n.text)}`);
    }
    if (summary.nextStep) lines.push(`- **Próximo passo:** ${oneLine(summary.nextStep)}`);
    lines.push('');
  }

  const others = sessions.filter(s => !s.segmentId);
  if (others.length) {
    lines.push('## Outras práticas', '');
    const groups = new Map<string, Session[]>();
    for (const s of others) {
      const key =
        sessionKind(s) === 'piece'
          ? `Peça inteira: ${oneLine(pieceTitle(s.pieceId) ?? s.title)}`
          : 'Prática livre';
      groups.set(key, [...(groups.get(key) ?? []), s]);
    }
    for (const [label, group] of groups)
      lines.push(
        `- ${label} — ${formatMinutes(group.reduce((sum, s) => sum + s.activeSeconds, 0))} em ${plural(group.length, 'sessão', 'sessões')}`,
      );
    lines.push('');
  }

  const pending = input.tasks
    .filter(t => !t.done)
    .sort(
      (a, b) =>
        (a.dueDate || '9999').localeCompare(b.dueDate || '9999') || a.createdAt.localeCompare(b.createdAt),
    );
  lines.push('## Tarefas pendentes', '');
  if (!pending.length) lines.push('Nenhuma tarefa pendente.');
  for (const t of pending) {
    const context = [pieceTitle(t.pieceId), input.segments.find(s => s.id === t.segmentId)?.title]
      .filter((x): x is string => Boolean(x))
      .map(oneLine)
      .join(' · ');
    lines.push(
      `- [ ] ${oneLine(t.title)}${context ? ` (${context})` : ''}${t.dueDate ? ` — até ${formatDate(t.dueDate)}` : ''}`,
    );
  }
  lines.push('');

  const questions = input.questions.map(oneLine).filter(Boolean);
  lines.push('## Perguntas para o professor', '');
  if (!questions.length) lines.push('Nenhuma pergunta anotada.');
  for (const q of questions) lines.push(`- ${q}`);
  lines.push('');

  const recordings = input.recordings
    .filter(r => inRange(r.createdAt))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  if (recordings.length) {
    lines.push('## Gravações do período', '');
    for (const r of recordings) {
      const session = r.sessionId ? input.sessions.find(s => s.id === r.sessionId) : undefined;
      const bpm = r.bpm ?? (session && reachedBpm(session)),
        hand = r.hand ?? session?.hand;
      const details = [
        input.segments.find(s => s.id === r.segmentId)?.title,
        bpm && `${bpm} BPM`,
        hand && handPhrase[hand],
      ].filter(Boolean);
      lines.push(
        `- ${formatDate(r.createdAt)} · ${oneLine(r.title)}${details.length ? ` (${details.join(', ')})` : ''}`,
      );
    }
    lines.push('');
  }
  return lines.join('\n');
}
