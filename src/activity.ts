import { useSyncExternalStore } from 'react';

/**
 * Something that must not be interrupted by in-app navigation (a lesson recording, a running practice).
 * Screens register it with setActivity; the app shell reads it to warn before leaving and to show a mini-bar.
 */
export interface Activity {
  kind: 'recording' | 'practice';
  /** Short human label, e.g. "Gravação da aula" or "Prática · Entrada da mão esquerda". */
  label: string;
  /** Optional live detail such as elapsed time or repetition, e.g. "12:34". */
  detail?: string;
  /** Stops the activity cleanly (saving what was captured). Called when the user chooses "Encerrar e sair". */
  stop?: () => void | Promise<void>;
}

const activities = new Map<string, Activity>();
const listeners = new Set<() => void>();
let snapshot: Activity[] = [];

function emit() {
  snapshot = [...activities.values()];
  for (const listener of listeners) listener();
}

/** Registers (or updates) an activity under a stable key. Pass null to clear it. */
export function setActivity(key: string, activity: Activity | null) {
  if (activity) activities.set(key, activity);
  else if (!activities.delete(key)) return;
  emit();
}

export function getActivities() {
  return snapshot;
}

export function subscribeActivities(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useActivities() {
  return useSyncExternalStore(subscribeActivities, getActivities, getActivities);
}
