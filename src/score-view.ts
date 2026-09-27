/** Viewer preferences and input mapping for the score viewer, kept free of React so they can be tested. */

export type FitMode = 'width' | 'page';
export interface ScoreViewState {
  page: number;
  /** Zoom relative to the fit-width size, used when fit is null. */
  zoom: number;
  fit: FitMode | null;
}

export const MIN_ZOOM = 0.4;
export const MAX_ZOOM = 3;

export function clampZoom(zoom: number) {
  if (!Number.isFinite(zoom)) return 1;
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(zoom * 100) / 100));
}

/**
 * Height of the score area outside full screen (px). With the window scrolled to the top, the score and
 * the bar below it (pages, fit, zoom) fit on screen, so "Página inteira" shows a whole page with the page
 * controls in reach. A viewer lower on the page is sized as if scrolled part of the way into view.
 */
export function scoreAreaHeight(viewport: number, top: number, below: number) {
  const available = viewport - Math.min(Math.max(0, top), viewport * 0.35) - below - 12;
  return Math.round(Math.max(Math.min(viewport * 0.6, 420), available));
}

/** Zoom (relative to the fit-width size) that shows the whole page in the visible height. */
export function fitPageZoom(width: number, height: number, ratio: number) {
  if (!(width > 0) || !(height > 0) || !(ratio > 0)) return 1;
  return Math.max(0.2, Math.min(1, height / (width * ratio)));
}

const viewKey = (scoreId: string) => `compasso:score-view:${scoreId}`;

export function loadViewState(scoreId: string): Partial<ScoreViewState> {
  try {
    const raw = localStorage.getItem(viewKey(scoreId));
    if (!raw) return {};
    const value = JSON.parse(raw) as Record<string, unknown>;
    const state: Partial<ScoreViewState> = {};
    if (typeof value.page === 'number' && Number.isInteger(value.page) && value.page >= 1)
      state.page = value.page;
    if (typeof value.zoom === 'number' && Number.isFinite(value.zoom)) state.zoom = clampZoom(value.zoom);
    if (value.fit === 'width' || value.fit === 'page' || value.fit === null) state.fit = value.fit;
    return state;
  } catch {
    return {};
  }
}

export function saveViewState(scoreId: string, state: ScoreViewState) {
  try {
    localStorage.setItem(viewKey(scoreId), JSON.stringify(state));
  } catch {
    /* private mode or full storage: the viewer still works */
  }
}

export function forgetViewState(scoreId: string) {
  try {
    localStorage.removeItem(viewKey(scoreId));
  } catch {
    /* nothing to clean */
  }
}

const lastScoreKey = (pieceId: string) => `compasso:piece-score:${pieceId}`;

/** The score version last opened for a piece, so the piece reopens on it. */
export function loadLastScore(pieceId: string) {
  try {
    return localStorage.getItem(lastScoreKey(pieceId)) ?? '';
  } catch {
    return '';
  }
}

export function saveLastScore(pieceId: string, scoreId: string) {
  try {
    localStorage.setItem(lastScoreKey(pieceId), scoreId);
  } catch {
    /* the default version is shown next time */
  }
}

/** Removes what the viewer remembered about a deleted piece and its scores. */
export function forgetPieceView(pieceId: string, scoreIds: string[]) {
  try {
    localStorage.removeItem(lastScoreKey(pieceId));
  } catch {
    /* nothing to clean */
  }
  for (const id of scoreIds) forgetViewState(id);
}

export const PENCIL_ONLY_KEY = 'compasso:pencil-only';
export const SHOW_SEGMENTS_KEY = 'compasso:show-segments';

/** Reads a stored on/off preference; undefined when it was never chosen or storage is unavailable. */
export function readFlag(key: string): boolean | undefined {
  try {
    const value = localStorage.getItem(key);
    return value === '1' ? true : value === '0' ? false : undefined;
  } catch {
    return undefined;
  }
}

export function writeFlag(key: string, value: boolean) {
  try {
    localStorage.setItem(key, value ? '1' : '0');
  } catch {
    /* the choice lasts for this visit only */
  }
}

export interface PageKeyAction {
  direction: 1 | -1;
  /** Scroll through a page that does not fit before turning it (arrow up/down and page up/down). */
  scrollFirst: boolean;
}

/**
 * Keys sent by keyboards and Bluetooth page-turner pedals. Space is deliberately not used: it is reserved
 * for starting and pausing practice.
 */
export function pageKeyAction(event: {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
}): PageKeyAction | null {
  if (event.ctrlKey || event.metaKey || event.altKey) return null;
  switch (event.key) {
    case 'ArrowRight':
      return { direction: 1, scrollFirst: false };
    case 'ArrowLeft':
      return { direction: -1, scrollFirst: false };
    case 'PageDown':
    case 'ArrowDown':
      return { direction: 1, scrollFirst: true };
    case 'PageUp':
    case 'ArrowUp':
      return { direction: -1, scrollFirst: true };
    default:
      return null;
  }
}

const scoreExtension = /\.(pdf|png|jpe?g|webp)$/i;

/** Title for a score imported from a file: the name without its extension ("Op. 28 No. 4.pdf"). */
export function titleFromFileName(name: string) {
  return name.trim().replace(scoreExtension, '').trim() || name.trim();
}

/** Name of the annotated PDF export. Only a real file extension is removed, never "K. 545". */
export function exportFileName(title: string) {
  const base = titleFromFileName(title).replace(/[\\/:*?"<>|]+/g, '-');
  return `${base || 'partitura'}-anotada.pdf`;
}

/** True when keys typed at this target belong to a text field or another form control. */
export function isEditableTarget(target: EventTarget | null) {
  if (!target || typeof (target as Element).closest !== 'function') return false;
  const element = target as HTMLElement;
  return (
    element.isContentEditable === true ||
    !!element.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])')
  );
}
