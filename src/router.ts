/**
 * Hash routes of the app shell, e.g. #/repertorio/<pieceId> or #/evolucao/revisoes. Pure parse and format, so
 * the address survives a reload and Safari's swipe back. The home-screen app always relaunches at its start
 * address (no hash), so the shell also saves the last screen and reopens it from resumeRoute().
 */
export type View = 'home' | 'library' | 'warmups' | 'practice' | 'lessons' | 'progress' | 'settings';
export type ProgressTab = 'history' | 'recordings' | 'review';

export interface Route {
  view: View;
  /** library: the open piece; warmups: the open collection. */
  pieceId?: string;
  /** warmups: the chosen exercise of the collection. */
  exerciseId?: string;
  /** practice: a segment id, or 'piece:<pieceId>' for the whole piece. */
  target?: string;
  /** lessons: the open lesson. */
  lessonId?: string;
  /** progress: the open tab. */
  tab?: ProgressTab;
}

const viewSlugs: Record<View, string> = {
  home: 'hoje',
  library: 'repertorio',
  warmups: 'aquecimento',
  practice: 'praticar',
  lessons: 'aulas',
  progress: 'evolucao',
  settings: 'preferencias',
};
const tabSlugs: Record<ProgressTab, string> = {
  history: 'historico',
  recordings: 'gravacoes',
  review: 'revisoes',
};
export const viewTitles: Record<View, string> = {
  home: 'Hoje',
  library: 'Repertório',
  warmups: 'Aquecimento',
  practice: 'Praticar',
  lessons: 'Aulas',
  progress: 'Evolução',
  settings: 'Preferências',
};
const views = Object.keys(viewSlugs) as View[];
const tabs = Object.keys(tabSlugs) as ProgressTab[];
const PIECE_PREFIX = 'piece:';
const MAX_ID = 200;

export const isView = (value: string): value is View => views.includes(value as View);

function decode(part: string) {
  try {
    return decodeURIComponent(part);
  } catch {
    return null;
  }
}
/** "Repertório", "REPERTORIO" and "repertorio" all name the same screen. */
const simplify = (text: string) => text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
function cleanId(part: string | undefined) {
  const id = part === undefined ? null : decode(part)?.trim();
  const printable = !!id && [...id].every(c => c.charCodeAt(0) >= 32);
  return id && printable && id.length <= MAX_ID ? id : undefined;
}
function cleanTarget(part: string | undefined) {
  const target = cleanId(part);
  if (!target?.startsWith(PIECE_PREFIX)) return target;
  return target.length > PIECE_PREFIX.length ? target : undefined;
}

/** Keeps only the fields that belong to the route's view. */
export function normalizeRoute(route: Route): Route {
  const { view } = route;
  if (view === 'library' && route.pieceId) return { view, pieceId: route.pieceId };
  if (view === 'warmups' && route.pieceId)
    return route.exerciseId
      ? { view, pieceId: route.pieceId, exerciseId: route.exerciseId }
      : { view, pieceId: route.pieceId };
  if (view === 'practice' && route.target) return { view, target: route.target };
  if (view === 'lessons' && route.lessonId) return { view, lessonId: route.lessonId };
  if (view === 'progress' && route.tab) return { view, tab: route.tab };
  return { view };
}

/** Reads a location hash. Anything unknown falls back to the closest valid screen (Hoje at worst). */
export function parseRoute(hash: string): Route {
  const path = hash.replace(/^#/, '').replace(/[?#].*$/, '');
  const [first, detail, extra] = path.split('/').filter(Boolean);
  const slug = first === undefined ? '' : simplify(decode(first) ?? '');
  const view = views.find(v => viewSlugs[v] === slug);
  if (!view) return { view: 'home' };
  if (view === 'library') return normalizeRoute({ view, pieceId: cleanId(detail) });
  if (view === 'warmups')
    return normalizeRoute({ view, pieceId: cleanId(detail), exerciseId: cleanId(extra) });
  if (view === 'practice') return normalizeRoute({ view, target: cleanTarget(detail) });
  if (view === 'lessons') return normalizeRoute({ view, lessonId: cleanId(detail) });
  if (view === 'progress') {
    const tabSlug = detail === undefined ? '' : simplify(decode(detail) ?? '');
    return normalizeRoute({ view, tab: tabs.find(t => tabSlugs[t] === tabSlug) });
  }
  return { view };
}

/** The canonical hash of a route, e.g. "#/praticar/piece:abc". */
export function formatRoute(route: Route): string {
  const r = normalizeRoute(route);
  const base = `#/${viewSlugs[r.view]}`;
  if (r.pieceId)
    return `${base}/${encodeURIComponent(r.pieceId)}${r.exerciseId ? `/${encodeURIComponent(r.exerciseId)}` : ''}`;
  if (r.target)
    return `${base}/${
      r.target.startsWith(PIECE_PREFIX)
        ? PIECE_PREFIX + encodeURIComponent(r.target.slice(PIECE_PREFIX.length))
        : encodeURIComponent(r.target)
    }`;
  if (r.lessonId) return `${base}/${encodeURIComponent(r.lessonId)}`;
  if (r.tab) return `${base}/${tabSlugs[r.tab]}`;
  return base;
}

export const sameRoute = (a: Route, b: Route) => formatRoute(a) === formatRoute(b);

/**
 * What counts as another screen: a different view, or another piece or lesson. The practice selection and the
 * Evolução tab change inside the same screen.
 */
export function pageKey(route: Route) {
  const r = normalizeRoute(route);
  if (r.view === 'library') return `library/${r.pieceId ?? ''}`;
  if (r.view === 'lessons') return `lessons/${r.lessonId ?? ''}`;
  return r.view;
}

/** "Repertório · Compasso", or "Prelúdio em Dó maior · Compasso" when a piece or lesson is open. */
export function documentTitle(route: Route, detail?: string | null) {
  const name = detail?.trim();
  return `${name || viewTitles[route.view]} · Compasso`;
}

/** How long the last screen is reopened when the home-screen app relaunches at its start address. */
export const RESUME_MAX_AGE = 12 * 60 * 60 * 1000;

/** What the shell saves after each screen change: the address and when it was shown. */
export const resumeRecord = (route: Route, now = Date.now()) =>
  JSON.stringify({ hash: formatRoute(route), at: now });

/**
 * The screen to reopen from a saved record, or null when there is none, it is older than `maxAge` or cannot be
 * read. Hoje is never resumed: the app opens there anyway. A piece or lesson deleted since falls back later,
 * like any old link.
 */
export function resumeRoute(saved: string | null, now = Date.now(), maxAge = RESUME_MAX_AGE): Route | null {
  if (!saved) return null;
  try {
    const { hash, at } = JSON.parse(saved) as { hash?: unknown; at?: unknown };
    if (typeof hash !== 'string' || typeof at !== 'number' || !Number.isFinite(at)) return null;
    // A clock moved back (or a record from the future) does not count as recent.
    if (at > now + 60_000 || now - at > maxAge) return null;
    const route = parseRoute(hash);
    return route.view === 'home' ? null : route;
  } catch {
    return null;
  }
}

/** True for the start address: nothing after "#" (or "#/"), as when the home-screen app launches. */
export const isStartAddress = (hash: string) => !hash.replace(/^#\/?/, '');
