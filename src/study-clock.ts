import { useSyncExternalStore } from 'react';

/**
 * The study clock: one session of study for the whole app, with pause. It lives in localStorage (wall-clock
 * timestamps), so it keeps counting across screens, reloads and the home-screen app being closed, and every
 * tab shows the same clock.
 */
export interface StudyClock {
  /** When the session started (ISO). */
  startedAt: string;
  /** Running periods; the last one has no end while the clock runs. Milliseconds since the epoch. */
  spans: { from: number; to?: number }[];
}

const KEY = 'compasso:study-clock';
const listeners = new Set<() => void>();
let snapshot: StudyClock | null = read();

function read(): StudyClock | null {
  try {
    const value = JSON.parse(localStorage.getItem(KEY) ?? 'null') as StudyClock | null;
    return value && typeof value.startedAt === 'string' && Array.isArray(value.spans) ? value : null;
  } catch {
    return null;
  }
}
function write(next: StudyClock | null) {
  snapshot = next;
  try {
    if (next) localStorage.setItem(KEY, JSON.stringify(next));
    else localStorage.removeItem(KEY);
  } catch {
    /* Blocked storage: the clock still works in this tab until it is closed. */
  }
  for (const listener of listeners) listener();
}

export const isRunning = (clock: StudyClock | null) => !!clock && clock.spans.at(-1)?.to === undefined;

/** Seconds of study so far: the running periods, without the pauses. */
export function studySeconds(clock: StudyClock | null, now = Date.now()) {
  if (!clock) return 0;
  return clock.spans.reduce((sum, s) => sum + Math.max(0, (s.to ?? now) - s.from), 0) / 1000;
}

export function startClock(now = Date.now()) {
  if (snapshot) return;
  write({ startedAt: new Date(now).toISOString(), spans: [{ from: now }] });
}
export function pauseClock(now = Date.now()) {
  if (!snapshot || !isRunning(snapshot)) return;
  write({
    ...snapshot,
    spans: snapshot.spans.map((s, i, all) => (i === all.length - 1 ? { ...s, to: now } : s)),
  });
}
export function resumeClock(now = Date.now()) {
  if (!snapshot || isRunning(snapshot)) return;
  write({ ...snapshot, spans: [...snapshot.spans, { from: now }] });
}
/** Stops the clock for good (the caller saves or discards what it measured). */
export function clearClock() {
  write(null);
}

/** Seconds of the clock's running periods that fall inside [from, to] (ms), e.g. a Praticar session. */
export function overlapSeconds(clock: StudyClock, from: number, to: number, now = Date.now()) {
  return (
    clock.spans.reduce((sum, s) => sum + Math.max(0, Math.min(to, s.to ?? now) - Math.max(from, s.from)), 0) /
    1000
  );
}

export const getClock = () => snapshot;

export function subscribeClock(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
// Another tab started, paused or ended the clock.
if (typeof window !== 'undefined')
  window.addEventListener('storage', e => {
    if (e.key !== KEY) return;
    snapshot = read();
    for (const listener of listeners) listener();
  });

export const useStudyClock = () => useSyncExternalStore(subscribeClock, getClock, getClock);
