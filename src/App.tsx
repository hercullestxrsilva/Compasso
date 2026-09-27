import {
  Component,
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ErrorInfo,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  LayoutDashboard,
  LibraryBig,
  Flame,
  AudioLines,
  Headphones,
  ChartNoAxesCombined,
  Settings2,
  Menu,
  X,
  WifiOff,
  Check,
  AlertTriangle,
  Info,
} from 'lucide-react';
import BrandSymbol from './components/BrandSymbol';
import StudyClock from './components/StudyClock';
import Dashboard from './components/Dashboard';
import { Library, PieceForm } from './components/Library';
import { ConfirmProvider, Modal, useTopModal, type Notify, type NotifyTone } from './components/common';
import { TopbarActivity, TopbarStatus, activityHead, byUrgency } from './components/Topbar';
import { db } from './db';
import { isWarmup } from './domain';
import type { ActivityTarget } from './lessons/activities';
import { getActivities, useActivities, type Activity } from './activity';
import { getUnsaved, type UnsavedWork } from './unsaved';
import { applyTheme } from './theme';
import {
  documentTitle,
  formatRoute,
  isStartAddress,
  isView,
  pageKey,
  parseRoute,
  resumeRecord,
  resumeRoute,
  sameRoute,
  type ProgressTab,
  type Route,
  type View,
} from './router';
import './styles/shell.css';

// The heavy screens (score viewer, PDF.js, audio, cloud client) load on first use, so the app opens faster.
const loadPieceDetail = () => import('./components/PieceDetail'),
  loadPractice = () => import('./components/Practice'),
  loadLessons = () => import('./components/Lessons'),
  loadProgress = () => import('./components/Progress'),
  loadSettings = () => import('./components/Settings'),
  loadWarmups = () => import('./components/Warmups');
const PieceDetail = lazy(loadPieceDetail),
  Practice = lazy(loadPractice),
  Lessons = lazy(loadLessons),
  Progress = lazy(loadProgress),
  Settings = lazy(loadSettings),
  Warmups = lazy(loadWarmups);

// The theme chosen in Preferências applies before the first render.
applyTheme();

const nav: readonly (readonly [View, string, typeof LayoutDashboard])[] = [
  ['home', 'Hoje', LayoutDashboard],
  ['library', 'Repertório', LibraryBig],
  ['warmups', 'Aquecimento', Flame],
  ['practice', 'Praticar', AudioLines],
  ['lessons', 'Aulas', Headphones],
  ['progress', 'Evolução', ChartNoAxesCombined],
];
const CAPTURES_ANCHOR = 'gravacoes-recuperaveis';
const MAX_TOASTS = 3;
/** Where the last screen is saved, so the home-screen app reopens it after iPadOS closes it. */
const RESUME_KEY = 'compasso:lastRoute';
/** How long "Encerrar e sair" waits for a recording or a session to be saved before leaving anyway. */
const STOP_TIMEOUT = 15000;

class ErrorBoundary extends Component<{ children: ReactNode }, { error: boolean }> {
  state = { error: false };
  static getDerivedStateFromError() {
    return { error: true };
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(error, info);
  }
  render() {
    return this.state.error ? (
      <div className="empty">
        <h1>Precisamos reabrir esta tela.</h1>
        <p>Seus dados salvos continuam no dispositivo.</p>
        <button className="btn" onClick={() => location.reload()}>
          Reabrir aplicativo
        </button>
      </div>
    ) : (
      this.props.children
    );
  }
}

/** Shown while a screen's code loads; it fades in only if the wait is noticeable. */
function ViewLoading() {
  return (
    <div className="view-loading" role="status">
      <BrandSymbol size={26} />
      <span>Abrindo…</span>
    </div>
  );
}

interface Toast {
  id: number;
  text: string;
  tone: NotifyTone;
}
function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: (id: number) => void }) {
  useEffect(() => {
    // Errors stay longer so they can be read; every toast can be dismissed.
    const timer = setTimeout(() => onDismiss(toast.id), toast.tone === 'error' ? 12000 : 5000);
    return () => clearTimeout(timer);
  }, [toast.id, toast.tone, onDismiss]);
  return (
    <div className={`toast ${toast.tone}`}>
      {toast.tone === 'error' ? (
        <AlertTriangle size={18} aria-hidden="true" />
      ) : toast.tone === 'info' ? (
        <Info size={18} aria-hidden="true" />
      ) : (
        <Check size={18} aria-hidden="true" />
      )}
      <span>{toast.text}</span>
      <button className="icon-btn" aria-label="Fechar aviso" onClick={() => onDismiss(toast.id)}>
        <X size={17} />
      </button>
    </div>
  );
}

const stoppable = () =>
  getActivities()
    .filter(a => a.stop)
    .sort(byUrgency);

/** Stops each activity in turn (the recording first), waiting until what it captured is saved. */
async function stopAll(list: readonly Activity[]) {
  for (const activity of list)
    try {
      await activity.stop?.();
    } catch (e) {
      console.error(e);
    }
  return true;
}

interface LeaveAsk {
  /** The navigation that asked (see navSeq). */
  id: number;
  title: string;
  /** What leaving stops; empty when it only discards unsaved work. */
  kinds: readonly Activity['kind'][];
  unsaved: readonly UnsavedWork[];
  /** Leaving was chosen and the recording or session is being saved. */
  busy: boolean;
}

/** The text of the "leave?" dialog. The list is live: the clock keeps running while it is open. */
function LeaveMessage({ ask }: { ask: LeaveAsk }) {
  const running = useActivities()
    .filter(a => a.stop)
    .sort(byUrgency);
  const recording = running.some(a => a.kind === 'recording'),
    practice = running.some(a => a.kind === 'practice');
  const savesRecording = ask.kinds.includes('recording'),
    savesPractice = ask.kinds.includes('practice');
  return (
    // Focus starts here, not on "Encerrar e sair", so a stray Enter does not end a lesson recording.
    <div className="leave-message" tabIndex={-1} data-autofocus>
      {ask.busy ? (
        <p role="status">
          {savesRecording && savesPractice
            ? 'Salvando a gravação e a sessão…'
            : savesRecording
              ? 'Salvando a gravação…'
              : 'Salvando a sessão…'}{' '}
          Você segue assim que terminar.
        </p>
      ) : (
        <>
          {running.length > 0 && (
            <ul>
              {running.map(a => (
                <li key={`${a.kind}:${a.label}`}>
                  <strong>{a.label}</strong>
                  {a.detail ? ` · ${a.detail}` : ''}
                </li>
              ))}
            </ul>
          )}
          {(running.length > 0 || !ask.unsaved.length) && (
            <p>
              {recording && practice
                ? 'Para sair desta tela, a gravação e a prática são encerradas. O áudio e a sessão ficam salvos.'
                : recording
                  ? 'Para sair desta tela, a gravação é encerrada. O áudio gravado até agora fica salvo.'
                  : practice
                    ? 'Para sair desta tela, a prática é encerrada. A sessão fica salva e você pode avaliá-la antes de seguir.'
                    : 'A atividade já terminou. Você pode sair.'}
            </p>
          )}
          {ask.unsaved.map(work => (
            <p key={work.message}>{work.message}</p>
          ))}
        </>
      )}
    </div>
  );
}

interface PageChange {
  /** Scroll position to restore when coming back through history. */
  restoreY?: number;
  /** Element id to bring into view instead of the top of the page. */
  anchor?: string;
  /** What had focus when the change started; focus moves on only if the reader has not moved it since. */
  from: Element | null;
}
/**
 * After a screen change: once its heading renders (screens load lazily and read the database), focus it without
 * scrolling, so screen readers announce the new page; then restore the scroll position or reveal the anchor.
 * A heading replaced right after (a placeholder giving way to the content) passes the focus on.
 */
function settleView(main: HTMLElement, change: PageChange) {
  let focused: HTMLElement | null = null,
    placed = false,
    restoreTimer = 0,
    settleTimer = 0;
  const find = () => {
    const heading = main.querySelector<HTMLElement>('h1');
    if (!heading || !change.anchor) return heading;
    return document.getElementById(change.anchor)?.querySelector<HTMLElement>('h2, h3') ?? null;
  };
  const stop = () => {
    observer.disconnect();
    window.clearTimeout(timeout);
    window.clearTimeout(settleTimer);
  };
  const place = () => {
    if (change.anchor) focused?.scrollIntoView({ block: 'start' });
    else if (change.restoreY) {
      const y = change.restoreY;
      window.scrollTo(0, y);
      // Lists fill in a moment later; try once more unless the reader already scrolled.
      const first = window.scrollY;
      restoreTimer = window.setTimeout(() => {
        if (Math.abs(window.scrollY - first) < 2 && window.scrollY < y) window.scrollTo(0, y);
      }, 400);
    }
  };
  const check = () => {
    const target = find();
    if (!target || target === focused) return;
    const active = document.activeElement;
    // The reader moved the focus into the new screen: leave it there.
    const untouched = !active || active === document.body || active === change.from || active === focused;
    if (!untouched && main.contains(active)) return stop();
    if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
    target.focus({ preventScroll: true });
    focused = target;
    if (!placed) {
      placed = true;
      place();
    }
    window.clearTimeout(settleTimer);
    settleTimer = window.setTimeout(stop, 1200);
  };
  const observer = new MutationObserver(check);
  const timeout = window.setTimeout(stop, 5000);
  observer.observe(main, { childList: true, subtree: true });
  check();
  return () => {
    window.clearTimeout(restoreTimer);
    stop();
  };
}

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const openDialogs = () => new Set(document.querySelectorAll('dialog[open]'));
/** Closes a dialog the way Esc or its X would, so its own "discard?" question still runs. */
const cancelDialog = (dialog: Element) => dialog.dispatchEvent(new Event('cancel', { cancelable: true }));

interface HistoryState {
  /** Scroll position on that screen, restored by Back. */
  y?: number;
  /** Address of the previous entry when the app pushed this one: back links then go back instead. */
  prev?: string;
}
const historyState = () => (window.history.state ?? {}) as HistoryState;
function replaceAddress(url: string, state: unknown = window.history.state) {
  try {
    if (url !== window.location.hash) window.history.replaceState(state, '', url);
  } catch {
    /* Safari limits history updates per second; the screen still changes. */
  }
}
/** Back or Forward moved the address but the screen stays: make its address the current entry again. */
function keepAddress(route: Route) {
  const url = formatRoute(route);
  if (url !== window.location.hash)
    try {
      // The entry Back reached is now the previous one.
      window.history.pushState(
        { y: window.scrollY, prev: window.location.hash } satisfies HistoryState,
        '',
        url,
      );
    } catch {
      /* The address shows the other screen until the next navigation. */
    }
}

function isStandalone() {
  try {
    return (
      window.matchMedia('(display-mode: standalone)').matches ||
      (navigator as Navigator & { standalone?: boolean }).standalone === true
    );
  } catch {
    return false;
  }
}
/**
 * The screen to open: the address, or, when the home-screen app relaunches at its start address (iPadOS
 * closes it in the background), the screen it showed in the last hours.
 */
function initialRoute(): Route {
  const hash = window.location.hash;
  if (isStartAddress(hash) && isStandalone())
    try {
      const resumed = resumeRoute(localStorage.getItem(RESUME_KEY));
      if (resumed) return resumed;
    } catch {
      /* Storage blocked: open Hoje. */
    }
  return parseRoute(hash);
}
function rememberRoute(route: Route) {
  try {
    localStorage.setItem(RESUME_KEY, resumeRecord(route));
  } catch {
    /* Private mode: nothing to reopen next time. */
  }
}
/** Focuses the screen's main heading without scrolling, so screen readers announce where the reader is. */
function focusHeading(main: HTMLElement | null) {
  const heading = main?.querySelector<HTMLElement>('h1') ?? main;
  if (!heading) return;
  if (!heading.hasAttribute('tabindex')) heading.setAttribute('tabindex', '-1');
  heading.focus({ preventScroll: true });
}

export default function App() {
  return (
    <ErrorBoundary>
      <ConfirmProvider>
        <Shell />
      </ConfirmProvider>
    </ErrorBoundary>
  );
}

interface LeaveOptions {
  /** From Back/Forward: the address already shows `next`. */
  pop?: boolean;
  /** The screen itself already asked (e.g. a lesson's own back link): stop what runs without asking again. */
  confirmed?: boolean;
  /** Replace the current entry (it shows something that no longer exists). */
  replace?: boolean;
  restoreY?: number;
  anchor?: string;
}

function Shell() {
  const [route, setRoute] = useState<Route>(initialRoute),
    [progressMount, setProgressMount] = useState(0),
    [adding, setAdding] = useState(false),
    [mobile, setMobile] = useState(false),
    [narrow, setNarrow] = useState(() => window.matchMedia('(max-width:700px)').matches),
    [toasts, setToasts] = useState<Toast[]>([]),
    [leaveAsk, setLeaveAsk] = useState<LeaveAsk | null>(null),
    [online, setOnline] = useState(navigator.onLine);
  const routeRef = useRef(route),
    navSeq = useRef(0),
    leaveAnswer = useRef<((ok: boolean) => void) | null>(null),
    upPending = useRef<{ url: string; confirmed: boolean } | null>(null),
    // The lesson its own back link is leaving (maybe just deleted): no "no longer exists" notice for it.
    leavingLesson = useRef<string | null>(null),
    // The drawer closed around its focused item: the page heading takes the focus once the page is not inert.
    focusPage = useRef(false),
    pendingPage = useRef<PageChange | null>(null),
    cancelSettle = useRef<() => void>(() => {}),
    lastPractice = useRef(route.view === 'practice' ? route.target : undefined),
    toastSeq = useRef(0);
  const mainRef = useRef<HTMLElement>(null),
    menuButton = useRef<HTMLButtonElement>(null),
    sidebarRef = useRef<HTMLElement>(null);
  // Outside an open modal everything is inert and hidden from screen readers: notices go inside the top one.
  const topModal = useTopModal();

  useEffect(() => {
    const query = window.matchMedia('(max-width:700px)');
    const update = () => {
      setNarrow(query.matches);
      setMobile(false);
    };
    // The width may have changed between the first render and this listener.
    setNarrow(query.matches);
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  useEffect(() => {
    const fn = () => setOnline(navigator.onLine);
    window.addEventListener('online', fn);
    window.addEventListener('offline', fn);
    return () => {
      window.removeEventListener('online', fn);
      window.removeEventListener('offline', fn);
    };
  }, []);
  useEffect(() => {
    // A theme chosen in another tab applies here too.
    const sync = () => applyTheme();
    window.addEventListener('storage', sync);
    return () => window.removeEventListener('storage', sync);
  }, []);

  const notify = useCallback<Notify>((text, tone = 'success') => {
    if (!text) return setToasts([]);
    const id = ++toastSeq.current;
    setToasts(list => {
      // The same message again only restarts its timer; beyond three, the oldest non-error goes first.
      const next = [...list.filter(t => t.text !== text), { id, text, tone }];
      while (next.length > MAX_TOASTS) {
        const i = next.findIndex(t => t.tone !== 'error');
        next.splice(i === -1 || i === next.length - 1 ? 0 : i, 1);
      }
      return next;
    });
  }, []);
  const dismissToast = useCallback((id: number) => setToasts(list => list.filter(t => t.id !== id)), []);

  /** Shows `next` and records it in the address bar. Every navigation ends here. */
  const commit = useCallback(
    (
      next: Route,
      mode: 'push' | 'replace' | 'pop',
      options: { restoreY?: number; anchor?: string; fromProgress?: boolean } = {},
    ) => {
      const current = routeRef.current;
      const url = formatRoute(next),
        here = formatRoute(current);
      if (mode === 'push') {
        if (url !== window.location.hash)
          try {
            // Remember where the reader was on this screen, for the Back gesture.
            window.history.replaceState({ ...historyState(), y: window.scrollY }, '');
            window.history.pushState({ y: 0, prev: here } satisfies HistoryState, '', url);
          } catch {
            /* Safari limits history updates per second; the screen still changes. */
          }
      } else if (mode === 'pop' || window.location.hash === here) replaceAddress(url);
      // Otherwise ('replace' while Back waits for an answer) the address shows where Back goes: leave it.
      routeRef.current = next;
      leavingLesson.current = null;
      setRoute(next);
      setMobile(false);
      rememberRoute(next);
      if (next.view === 'practice') lastPractice.current = next.target;
      // Evolução reads its tab when it mounts; a tab chosen from outside (Back, a link) remounts it.
      if (
        next.view === 'progress' &&
        current.view === 'progress' &&
        next.tab !== current.tab &&
        !options.fromProgress
      )
        setProgressMount(n => n + 1);
      const newPage = pageKey(next) !== pageKey(current);
      // A question asked on the screen being left must not stay open over the next one.
      if (newPage)
        for (const dialog of openDialogs())
          if (dialog.querySelector('.confirm-message')) cancelDialog(dialog);
      if (newPage || options.anchor)
        pendingPage.current = {
          restoreY: options.restoreY,
          anchor: options.anchor,
          from: document.activeElement,
        };
    },
    [],
  );

  const askLeave = useCallback(
    (ask: LeaveAsk) =>
      new Promise<boolean>(resolve => {
        leaveAnswer.current?.(false);
        leaveAnswer.current = resolve;
        setLeaveAsk(ask);
      }),
    [],
  );
  const answerLeave = (ok: boolean) => {
    const resolve = leaveAnswer.current;
    leaveAnswer.current = null;
    if (!ok) setLeaveAsk(null);
    resolve?.(ok);
  };

  /**
   * Leaves the current screen. While a recording or a practice runs, or the screen has unsaved work, asks first;
   * "Encerrar e sair" stops what runs, waits until the file or the session is saved (and the practice rating
   * answered, when it opens), then navigates.
   */
  const leave = useCallback(
    async (next: Route, how: LeaveOptions = {}) => {
      if (!how.pop && !how.anchor && sameRoute(next, routeRef.current)) {
        // The item of the screen you are on brings you to its top.
        const fromDrawer = !!sidebarRef.current?.contains(document.activeElement);
        setMobile(false);
        window.scrollTo({ top: 0 });
        if (fromDrawer && window.matchMedia('(max-width:700px)').matches) focusPage.current = true;
        return;
      }
      const seq = ++navSeq.current;
      const latest = () => seq === navSeq.current;
      let blocking = stoppable();
      const unsaved = how.confirmed ? [] : getUnsaved();
      const title = blocking.length
        ? `${activityHead(blocking[0])} em andamento`
        : (unsaved[0]?.title ?? 'Sair desta tela?');
      try {
        if ((blocking.length && !how.confirmed) || unsaved.length) {
          const kinds = blocking.map(a => a.kind);
          const ok = await askLeave({ id: seq, title, kinds, unsaved, busy: false });
          if (!latest()) return;
          if (!ok) {
            // Back already moved the address: put back the screen that stays.
            if (how.pop) keepAddress(routeRef.current);
            return;
          }
          blocking = stoppable();
        }
        if (blocking.length) {
          const kinds = blocking.map(a => a.kind);
          setLeaveAsk({ id: seq, title, kinds, unsaved: [], busy: true });
          const before = openDialogs();
          const saved = await Promise.race([stopAll(blocking), wait(STOP_TIMEOUT).then(() => false)]);
          setLeaveAsk(ask => (ask?.id === seq ? null : ask));
          if (!saved)
            notify(
              kinds.includes('recording')
                ? 'A gravação ainda está sendo salva. Se ela não aparecer, recupere-a em Preferências e dados.'
                : 'A sessão ainda está sendo salva.',
              'info',
            );
          if (!latest()) return;
          // Ending a practice opens "Como foi a prática?": leave once it has been answered.
          if (kinds.includes('practice'))
            for (let i = 0; i < 8 && latest(); i++) {
              const opened = [...openDialogs()].find(
                d => !before.has(d) && !d.querySelector('.leave-message'),
              ) as HTMLDialogElement | undefined;
              if (opened) {
                while (latest() && opened.isConnected && opened.open) await wait(200);
                break;
              }
              await wait(50);
            }
          if (!latest()) return;
        }
        commit(next, how.pop ? 'pop' : how.replace ? 'replace' : 'push', how);
      } finally {
        setLeaveAsk(ask => (ask?.id === seq ? null : ask));
      }
    },
    [askLeave, commit, notify],
  );
  const navigate = useCallback((next: Route) => void leave(next), [leave]);

  /**
   * Back links ("Todas as aulas", "Repertório"): when that list is the previous entry, go back to it, so history
   * does not grow and Back afterwards does not reopen what was just left (or deleted).
   */
  const goUp = useCallback(
    (next: Route, { confirmed = false, gone = false } = {}) => {
      const url = formatRoute(next);
      if (historyState().prev !== url || window.location.hash !== formatRoute(routeRef.current))
        // Opened from elsewhere: a deleted item's entry gives way to the list instead of staying behind it.
        return void leave(next, { confirmed, replace: gone });
      const token = { url, confirmed };
      upPending.current = token;
      window.history.back();
      // Should the browser not go back, navigate forward instead.
      window.setTimeout(() => {
        if (upPending.current !== token) return;
        upPending.current = null;
        void leave(next, { confirmed });
      }, 1000);
    },
    [leave],
  );

  useEffect(() => {
    // Keep the address canonical from the start ("#/hoje" rather than nothing or an old link).
    replaceAddress(formatRoute(routeRef.current));
    rememberRoute(routeRef.current);
    const onPop = (e: PopStateEvent) => {
      const next = parseRoute(window.location.hash);
      const up = upPending.current;
      upPending.current = null;
      const upward = !!up && up.url === formatRoute(next);
      const dialogs = document.querySelectorAll('dialog[open]');
      if (!upward && dialogs.length) {
        // Back (Safari's edge swipe) closes the dialog on top instead of changing the screen under it.
        keepAddress(routeRef.current);
        cancelDialog(dialogs[dialogs.length - 1]);
        return;
      }
      if (sameRoute(next, routeRef.current)) return replaceAddress(formatRoute(next), e.state);
      const y = (e.state as HistoryState | null)?.y;
      void leave(next, {
        pop: true,
        confirmed: upward && up?.confirmed,
        restoreY: typeof y === 'number' ? y : undefined,
      });
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [leave]);

  useEffect(() => {
    const change = pendingPage.current;
    if (!change) return;
    pendingPage.current = null;
    cancelSettle.current();
    if (!change.anchor) window.scrollTo({ top: 0 });
    if (mainRef.current) cancelSettle.current = settleView(mainRef.current, change);
  }, [route]);
  useEffect(() => () => cancelSettle.current(), []);

  // An open piece, lesson or practice target that no longer exists (deleted here or in another tab).
  const pieceInfo = useLiveQuery(async () => {
    if (!route.pieceId) return null;
    const piece = await db.pieces.get(route.pieceId);
    return { id: route.pieceId, exists: !!piece, title: piece?.title, warmup: isWarmup(piece) };
  }, [route.pieceId]);
  const lessonInfo = useLiveQuery(async () => {
    if (!route.lessonId) return null;
    const lesson = await db.lessons.get(route.lessonId);
    return { id: route.lessonId, exists: !!lesson, title: lesson?.title };
  }, [route.lessonId]);
  const target = route.view === 'practice' ? route.target : undefined;
  const targetInfo = useLiveQuery(async () => {
    if (!target) return null;
    const found = target.startsWith('piece:')
      ? await db.pieces.get(target.slice('piece:'.length))
      : await db.segments.get(target);
    return { target, exists: !!found };
  }, [target]);
  useEffect(() => {
    const current = routeRef.current;
    if (!pieceInfo || current.pieceId !== pieceInfo.id) return;
    if (current.view === 'warmups') {
      if (pieceInfo.exists && pieceInfo.warmup) return;
      commit({ view: 'warmups' }, 'replace');
      notify('Esta coleção não está mais no seu aquecimento.', 'info');
      return;
    }
    if (pieceInfo.exists && pieceInfo.warmup) {
      commit({ view: 'warmups', pieceId: pieceInfo.id }, 'replace');
      return;
    }
    if (pieceInfo.exists) return;
    commit({ view: 'library' }, 'replace');
    notify('Esta peça não está mais no seu repertório.', 'info');
  }, [pieceInfo, commit, notify]);
  useEffect(() => {
    if (!lessonInfo || lessonInfo.exists || routeRef.current.lessonId !== lessonInfo.id) return;
    if (leavingLesson.current === lessonInfo.id) return;
    commit({ view: 'lessons' }, 'replace');
    notify('Esta aula não está mais no seu caderno.', 'info');
  }, [lessonInfo, commit, notify]);
  useEffect(() => {
    if (!targetInfo || targetInfo.exists || routeRef.current.target !== targetInfo.target) return;
    // A session in progress keeps its trecho; the practice screen handles it when the session ends.
    if (getActivities().some(a => a.kind === 'practice')) return;
    commit({ view: 'practice' }, 'replace');
    notify(
      targetInfo.target.startsWith('piece:')
        ? 'Esta peça não está mais no seu repertório. Escolha o que praticar.'
        : 'Este trecho não existe mais. Escolha outro para praticar.',
      'info',
    );
  }, [targetInfo, commit, notify]);

  const detailTitle =
    route.pieceId && pieceInfo?.id === route.pieceId
      ? pieceInfo.title
      : route.lessonId && lessonInfo?.id === route.lessonId
        ? lessonInfo.title
        : undefined;
  useEffect(() => {
    document.title = documentTitle(route, detailTitle);
  }, [route, detailTitle]);

  useEffect(() => {
    // Warm up the other screens once the first one is shown, so the first tap on them opens at once.
    const timer = window.setTimeout(() => {
      for (const load of [
        loadPractice,
        loadPieceDetail,
        loadWarmups,
        loadLessons,
        loadProgress,
        loadSettings,
      ])
        void load().catch(() => {});
    }, 3000);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!mobile && focusPage.current) focusHeading(mainRef.current);
    focusPage.current = false;
    if (!mobile) return;
    sidebarRef.current?.querySelector<HTMLElement>('nav button')?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || document.querySelector('dialog[open]')) return;
      setMobile(false);
      menuButton.current?.focus();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mobile]);

  const goView = (view: View) => {
    const current = routeRef.current;
    // The item of the screen you are on brings you to its top; from a piece or a lesson, back to the list.
    if (current.view === view && !current.pieceId && !current.lessonId) return void leave(current);
    navigate(view === 'practice' ? { view, target: lastPractice.current } : { view });
  };
  const openPiece = useCallback((id: string) => navigate({ view: 'library', pieceId: id }), [navigate]);
  const practice = useCallback(
    (id: string) => navigate({ view: 'practice', target: id || undefined }),
    [navigate],
  );
  const selectPractice = useCallback(
    (id: string) => {
      if (routeRef.current.view === 'practice')
        commit({ view: 'practice', target: id || undefined }, 'replace');
    },
    [commit],
  );
  // "Praticar" on an activity of the week: its trecho or exercise, its whole piece or its warm-up collection.
  const practiceActivity = useCallback(
    (target: ActivityTarget) => {
      if (target.kind === 'segment') practice(target.id);
      else if (target.kind === 'piece') practice(`piece:${target.id}`);
      else navigate({ view: 'warmups', pieceId: target.id });
    },
    [practice, navigate],
  );
  // Hoje › "Registrar aula e atividades" opens the form on the lessons screen.
  const [newLesson, setNewLesson] = useState(false);
  const selectWarmup = useCallback(
    (collectionId?: string, exerciseId?: string) => {
      // Choosing a collection or a scale changes the address without adding a history entry.
      if (routeRef.current.view === 'warmups')
        commit({ view: 'warmups', pieceId: collectionId, exerciseId }, 'replace');
    },
    [commit],
  );
  const selectLesson = useCallback(
    (id: string) => {
      if (id) return navigate({ view: 'lessons', lessonId: id });
      // Leaving an open lesson asks on its own screen first (recording, unsaved suggestions).
      const open = routeRef.current.lessonId;
      const list: Route = { view: 'lessons' };
      leavingLesson.current = open ?? null;
      if (!open || historyState().prev === formatRoute(list)) return goUp(list, { confirmed: true });
      // Opened from elsewhere (Hoje, a link): once deleted, its entry gives way to the list.
      db.lessons.get(open).then(
        lesson => goUp(list, { confirmed: true, gone: !lesson }),
        () => goUp(list, { confirmed: true }),
      );
    },
    [navigate, goUp],
  );
  const changeProgressTab = useCallback(
    (tab: ProgressTab) => {
      if (routeRef.current.view === 'progress')
        commit({ view: 'progress', tab }, 'replace', { fromProgress: true });
    },
    [commit],
  );

  const onSettings = route.view === 'settings';
  // The piece (or warm-up collection) on screen is the natural subject of a study session ended there.
  const studyPieceId = route.view === 'library' || route.view === 'warmups' ? route.pieceId : undefined;
  const errors = toasts.filter(t => t.tone === 'error'),
    notes = toasts.filter(t => t.tone !== 'error');
  return (
    <div className="app-shell">
      <a
        className="skip-link"
        href="#conteudo"
        onClick={e => {
          // "#conteudo" would be read as a route: move the focus instead.
          e.preventDefault();
          focusHeading(mainRef.current);
        }}
      >
        Pular para o conteúdo
      </a>
      <div className="mobile-top">
        <button className="brand" aria-label="compasso: ir para Hoje" onClick={() => goView('home')}>
          <BrandSymbol size={26} className="brand-symbol" />
          <span aria-hidden="true">
            compasso<span className="brand-dot">.</span>
          </span>
        </button>
        <StudyClock variant="compact" currentPieceId={studyPieceId} notify={notify} />
        <button
          ref={menuButton}
          className="icon-btn"
          aria-label={mobile ? 'Fechar navegação' : 'Abrir navegação'}
          aria-expanded={mobile}
          aria-controls="app-sidebar"
          onClick={() => setMobile(!mobile)}
        >
          {mobile ? <X /> : <Menu />}
        </button>
      </div>
      {mobile && (
        <button
          className="nav-scrim"
          aria-label="Fechar navegação"
          tabIndex={-1}
          onClick={() => {
            setMobile(false);
            menuButton.current?.focus();
          }}
        />
      )}
      <aside
        id="app-sidebar"
        ref={sidebarRef}
        inert={narrow && !mobile}
        aria-hidden={narrow && !mobile}
        className={`sidebar ${mobile ? 'open' : ''}`}
      >
        <button className="brand" aria-label="compasso: ir para Hoje" onClick={() => goView('home')}>
          <BrandSymbol size={34} className="brand-symbol" />
          <span aria-hidden="true">
            compasso<span className="brand-dot">.</span>
          </span>
        </button>
        <div className="sidebar-caption">SEU CADERNO DE PIANO</div>
        <nav aria-label="Navegação principal">
          {nav.map(([key, label, Icon]) => (
            <button
              key={key}
              className={route.view === key ? 'active' : ''}
              aria-current={route.view === key ? 'page' : undefined}
              onClick={() => goView(key)}
            >
              <Icon size={20} aria-hidden="true" />
              <span>{label}</span>
              {route.view === key && <span className="nav-indicator" aria-hidden="true" />}
            </button>
          ))}
        </nav>
        <StudyClock variant="sidebar" currentPieceId={studyPieceId} notify={notify} />
        <div className="sidebar-bottom">
          <figure className="sidebar-note">
            <blockquote>
              <p>
                O piano é o instrumento mais fácil de tocar no primeiro dia e o mais difícil de dominar no
                quinquagésimo primeiro ano.
              </p>
            </blockquote>
            <figcaption>Vladimir Horowitz</figcaption>
          </figure>
          <button
            className={`settings-nav ${onSettings ? 'active' : ''}`}
            aria-current={onSettings ? 'page' : undefined}
            onClick={() => goView('settings')}
          >
            <Settings2 size={19} aria-hidden="true" />
            Preferências e dados
            {onSettings && <span className="nav-indicator" aria-hidden="true" />}
          </button>
          {!online && (
            <div className="device-state">
              <WifiOff size={15} aria-hidden="true" />
              <span>Você está offline. Tudo continua salvo neste dispositivo.</span>
            </div>
          )}
        </div>
      </aside>
      <main className="main-content" id="conteudo" ref={mainRef} inert={narrow && mobile}>
        <div className="topbar">
          <TopbarActivity />
          <TopbarStatus
            online={online}
            // Both screens already list the interrupted recordings.
            capturesShown={onSettings || (route.view === 'lessons' && !route.lessonId)}
            onOpenSettings={() => goView('settings')}
            onOpenCaptures={() => void leave({ view: 'settings' }, { anchor: CAPTURES_ANCHOR })}
          />
        </div>
        <ErrorBoundary key={pageKey(route)}>
          <Suspense fallback={<ViewLoading />}>
            {route.view === 'home' && (
              <Dashboard
                onNavigate={view => {
                  if (isView(view)) navigate({ view });
                }}
                onPiece={openPiece}
                onPractice={practice}
                onLesson={selectLesson}
                onActivity={practiceActivity}
                onNewLesson={() => {
                  setNewLesson(true);
                  navigate({ view: 'lessons' });
                }}
                onAdd={() => setAdding(true)}
                notify={notify}
              />
            )}
            {route.view === 'library' &&
              (route.pieceId ? (
                <PieceDetail
                  key={route.pieceId}
                  id={route.pieceId}
                  onBack={() => goUp({ view: 'library' })}
                  onPractice={practice}
                  notify={notify}
                />
              ) : (
                <Library onOpen={openPiece} notify={notify} />
              ))}
            {route.view === 'warmups' && (
              <Warmups
                collectionId={route.pieceId}
                exerciseId={route.exerciseId}
                onSelect={selectWarmup}
                onPractice={practice}
                notify={notify}
              />
            )}
            {route.view === 'practice' && (
              <Practice selectedId={route.target ?? ''} onSelect={selectPractice} notify={notify} />
            )}
            {route.view === 'lessons' && (
              <Lessons
                notify={notify}
                selectedId={route.lessonId ?? ''}
                onSelect={selectLesson}
                onPractice={practiceActivity}
                startNew={newLesson}
                onStarted={() => setNewLesson(false)}
              />
            )}
            {route.view === 'progress' && (
              <Progress
                key={progressMount}
                initialTab={route.tab}
                onTabChange={changeProgressTab}
                onPractice={practice}
                notify={notify}
              />
            )}
            {onSettings && <Settings notify={notify} capturesAnchor={CAPTURES_ANCHOR} />}
          </Suspense>
        </ErrorBoundary>
        <footer className="app-footer">
          <span>compasso.</span>
          <span>Seu estudo, uma nota de cada vez.</span>
        </footer>
      </main>
      {adding && (
        <PieceForm
          onClose={() => setAdding(false)}
          onSaved={id => {
            openPiece(id);
            notify('Peça adicionada ao repertório.');
          }}
        />
      )}
      {leaveAsk && (
        <Modal
          title={leaveAsk.title}
          onClose={() => {
            if (!leaveAsk.busy) answerLeave(false);
          }}
        >
          <LeaveMessage ask={leaveAsk} />
          <footer className="modal-actions">
            <button
              type="button"
              className="btn secondary"
              aria-disabled={leaveAsk.busy || undefined}
              onClick={() => {
                if (!leaveAsk.busy) answerLeave(false);
              }}
            >
              Continuar aqui
            </button>
            <button
              type="button"
              className={`btn${leaveAsk.kinds.length ? '' : ' danger'}`}
              aria-disabled={leaveAsk.busy || undefined}
              onClick={() => {
                if (!leaveAsk.busy) answerLeave(true);
              }}
            >
              {leaveAsk.busy ? 'Salvando…' : leaveAsk.kinds.length ? 'Encerrar e sair' : 'Sair sem guardar'}
            </button>
          </footer>
        </Modal>
      )}
      {(() => {
        // Errors are announced at once, the rest politely; each group is a live region that stays mounted.
        const stack = (
          <div className="toast-stack">
            <div className="toast-group" aria-live="polite">
              {notes.map(t => (
                <ToastItem key={t.id} toast={t} onDismiss={dismissToast} />
              ))}
            </div>
            <div className="toast-group" aria-live="assertive">
              {errors.map(t => (
                <ToastItem key={t.id} toast={t} onDismiss={dismissToast} />
              ))}
            </div>
          </div>
        );
        return topModal ? createPortal(stack, topModal) : stack;
      })()}
    </div>
  );
}
