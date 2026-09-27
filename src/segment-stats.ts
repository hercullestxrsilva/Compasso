import { formatDate, localDay, type Rating, type Session } from './domain';

export interface SegmentStats {
  count: number;
  totalSeconds: number;
  lastAt: string;
  lastBpm: number;
  bestBpm: number;
  lastRating?: Rating;
  /** Most recent non-empty session note. */
  lastNote?: string;
  /** Next step written after the most recent session that has one. */
  nextStep?: string;
}

/** Practice summary per segment id, built from the sessions of those segments. */
export function segmentStats(sessions: Session[]) {
  const bySegment = new Map<string, Session[]>();
  for (const session of sessions) {
    if (!session.segmentId) continue;
    const list = bySegment.get(session.segmentId) ?? [];
    list.push(session);
    bySegment.set(session.segmentId, list);
  }
  const stats = new Map<string, SegmentStats>();
  for (const [segmentId, list] of bySegment) {
    list.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
    const last = list[0];
    stats.set(segmentId, {
      count: list.length,
      totalSeconds: list.reduce((sum, s) => sum + (s.activeSeconds || 0), 0),
      lastAt: last.endedAt || last.startedAt,
      lastBpm: last.config.bpm,
      bestBpm: Math.max(...list.map(s => s.config.bpm)),
      lastRating: list.find(s => s.rating)?.rating,
      lastNote: list.find(s => s.note?.trim())?.note.trim(),
      nextStep: list.find(s => s.nextStep?.trim())?.nextStep?.trim(),
    });
  }
  return stats;
}

export function plural(count: number, one: string, many: string) {
  return `${count} ${count === 1 ? one : many}`;
}

/** "hoje", "ontem", "há 3 dias" or a short date for older days. */
export function relativeDay(iso: string, today = new Date()) {
  const day = localDay(new Date(iso));
  const days = Math.round(
    (Date.parse(`${localDay(today)}T12:00:00`) - Date.parse(`${day}T12:00:00`)) / 86_400_000,
  );
  if (days <= 0) return 'hoje';
  if (days === 1) return 'ontem';
  if (days < 14) return `há ${days} dias`;
  return `em ${formatDate(iso)}`;
}

export const ratingLabels: Record<Rating, string> = {
  difficult: 'Difícil',
  improving: 'Melhorando',
  comfortable: 'Confortável',
};
