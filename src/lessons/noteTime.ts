/** The time a note refers to; `manual` once the student adjusted or removed it, so it is not re-stamped. */
export type NoteMoment = { at: number | null; manual: boolean };

export interface StampSource {
  /** Seconds into the recording in progress, or null when not recording. */
  recordingElapsed: number | null;
  hasAudio: boolean;
  /** The student played or moved the player at least once. */
  heard: boolean;
  currentTime: number;
}
/**
 * The time a note written now refers to: the live recording time, or the player position once the audio
 * was played or moved. An untouched player would otherwise stamp every note at 0:00.
 */
export function stampTime({ recordingElapsed, hasAudio, heard, currentTime }: StampSource) {
  if (recordingElapsed !== null) return recordingElapsed;
  if (hasAudio && (heard || currentTime > 0)) return currentTime;
  return null;
}

/** Drift after which a stamp taken on focus is renewed by the first key (the student kept listening). */
const DRIFT_SECONDS = 3;
/**
 * The moment for a draft when the student focuses the note field or types its first character: frozen
 * at that point, renewed only if it was set automatically and the audio has moved on since.
 */
export function draftMoment(current: NoteMoment | null, at: number | null): NoteMoment | null {
  if (at === null) return current;
  if (!current) return { at, manual: false };
  if (!current.manual && current.at !== null && Math.abs(at - current.at) > DRIFT_SECONDS)
    return { at, manual: false };
  return current;
}

/** The line shown when the draft has no time yet. */
export function noteTimeHint({
  canStamp,
  hasText,
  removed,
}: {
  canStamp: boolean;
  hasText: boolean;
  /** The student chose "Remover tempo". */
  removed: boolean;
}) {
  if (removed) return 'Esta anotação será salva sem tempo.';
  if (!canStamp) return 'Dê play no áudio para marcar o tempo da anotação.';
  if (hasText) return 'Toque em “Marcar agora” para ligar esta anotação ao áudio.';
  return 'O tempo é marcado quando você começa a escrever.';
}
