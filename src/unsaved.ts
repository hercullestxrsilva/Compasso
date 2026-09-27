/**
 * Work on the current screen that leaving it would discard, such as assistant suggestions not yet kept. Screens
 * register it while it exists and clear it on unmount; the app shell asks before any navigation (sidebar, Back,
 * swipe) while one is registered. Unlike an activity, nothing runs and nothing is shown in the top bar.
 */
export interface UnsavedWork {
  /** Title of the "leave?" question, e.g. "Sair sem guardar as sugestões?". */
  title: string;
  /** What would be lost, in a sentence. */
  message: string;
}

const entries = new Map<string, UnsavedWork>();

/** Registers (or updates) unsaved work under a stable key. Pass null to clear it. */
export function setUnsaved(key: string, work: UnsavedWork | null) {
  if (work) entries.set(key, work);
  else entries.delete(key);
}

export function getUnsaved(): UnsavedWork[] {
  return [...entries.values()];
}
