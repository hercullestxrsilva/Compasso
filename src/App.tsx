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
import { useLiveQuery } from 'dexie-react-hooks';
import {
  LayoutDashboard,
  LibraryBig,
  AudioLines,
  Headphones,
  ChartNoAxesCombined,
  Settings2,
  Menu,
  X,
  WifiOff,
  Check,
  Music2,
  AlertTriangle,
  Info,
} from 'lucide-react';
import Dashboard from './components/Dashboard';
import { Library, PieceForm } from './components/Library';
import { ConfirmProvider, useConfirm, type Notify, type NotifyTone } from './components/common';
import { TopbarActivity, TopbarStatus, activityHead, byUrgency } from './components/Topbar';
import { db } from './db';
import { getActivities, useActivities } from './activity';
import { applyTheme } from './theme';
import {
  documentTitle,
  formatRoute,
  isView,
  pageKey,
  parseRoute,
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
  loadSettings = () => import('./components/Settings');
const PieceDetail = lazy(loadPieceDetail),
  Practice = lazy(loadPractice),
  Lessons = lazy(loadLessons),
  Progress = lazy(loadProgress),
  Settings = lazy(loadSettings);

// The theme chosen in Preferências applies before the first render.
applyTheme();

const nav: readonly (readonly [View, string, typeof LayoutDashboard])[] = [
  ['home', 'Hoje', LayoutDashboard],
  ['library', 'Repertório', LibraryBig],
  ['practice', 'Praticar', AudioLines],
  ['lessons', 'Aulas', Headphones],
  ['progress', 'Evolução', ChartNoAxesCombined],
];
const CAPTURES_ANCHOR = 'gravacoes-recuperaveis';
const MAX_TOASTS = 3;

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
      <Music2 size={22} aria-hidden="true" />
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
    <div className={`toast ${toast.tone}`} role={toast.tone === 'error' ? 'alert' : undefined}>
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

/** Live list of what would stop, inside the "leave?" dialog: the clock keeps running while it is open. */
function LeaveMessage() {
  const running = useActivities()
    .filter(a => a.stop)
    .sort(byUrgency);
  const recording = running.some(a => a.kind === 'recording'),
    practice = running.some(a => a.kind === 'practice');
  return (
    // Focus starts here, not on "Encerrar e sair", so a stray Enter does not end a lesson recording.
    <div className="leave-message" tabIndex={-1} data-autofocus>
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
      <p>
        {recording && practice
          ? 'Para sair desta tela, a gravação e a prática são encerradas. O áudio e a sessão ficam salvos.'
          : recording
            ? 'Para sair desta tela, a gravação é encerrada. O áudio gravado até agora fica salvo.'
            : practice
              ? 'Para sair desta tela, a prática é encerrada. A sessão fica salva e você pode avaliá-la antes de seguir.'
              : 'A atividade já terminou. Você pode sair.'}
      </p>
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
function replaceAddress(url: string, state: unknown = window.history.state) {
  try {
    if (url !== window.location.hash) window.history.replaceState(state, '', url);
  } catch {
    /* Safari limits history updates per second; the screen still changes. */
  }
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

function Shell() {
  const confirm = useConfirm();
  const [route, setRoute] = useState<Route>(() => parseRoute(window.location.hash)),
    [progressMount, setProgressMount] = useState(0),
    [adding, setAdding] = useState(false),
    [mobile, setMobile] = useState(false),
    [narrow, setNarrow] = useState(() => window.matchMedia('(max-width:700px)').matches),
    [toasts, setToasts] = useState<Toast[]>([]),
    [online, setOnline] = useState(navigator.onLine);
  const routeRef = useRef(route),
    navSeq = useRef(0),
    pendingPage = useRef<PageChange | null>(null),
    cancelSettle = useRef<() => void>(() => {}),
    lastPractice = useRef(route.view === 'practice' ? route.target : undefined),
    toastSeq = useRef(0);
  const mainRef = useRef<HTMLElement>(null),
    menuButton = useRef<HTMLButtonElement>(null),
    sidebarRef = useRef<HTMLElement>(null);

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
      mode: 'push' | 'replace',
      options: { restoreY?: number; anchor?: string; fromProgress?: boolean } = {},
    ) => {
      const current = routeRef.current;
      const url = formatRoute(next);
      if (mode === 'push' && url !== window.location.hash)
        try {
          // Remember where the reader was on this screen, for the Back gesture.
          window.history.replaceState({ ...(window.history.state ?? {}), y: window.scrollY }, '');
          window.history.pushState({ y: 0 }, '', url);
        } catch {
          /* Safari limits history updates per second; the screen still changes. */
        }
      else replaceAddress(url);
      routeRef.current = next;
      setRoute(next);
      setMobile(false);
      if (next.view === 'practice') lastPractice.current = next.target;
      // Evolução reads its tab when it mounts; a tab chosen from outside (Back, a link) remounts it.
      if (
        next.view === 'progress' &&
        current.view === 'progress' &&
        next.tab !== current.tab &&
        !options.fromProgress
      )
        setProgressMount(n => n + 1);
      if (pageKey(next) !== pageKey(current) || options.anchor)
        pendingPage.current = {
          restoreY: options.restoreY,
          anchor: options.anchor,
          from: document.activeElement,
        };
    },
    [],
  );

  /**
   * Leaves the current screen. While a recording or a practice runs, asks first; "Encerrar e sair" stops it,
   * waits until the file or the session is saved (and the practice rating answered, when it opens), then
   * navigates. 'pop' comes from Back/Forward (the address already changed); 'confirmed' means the screen
   * itself already asked.
   */
  const leave = useCallback(
    async (
      next: Route,
      how: 'push' | 'pop' | 'confirmed' = 'push',
      options: { restoreY?: number; anchor?: string } = {},
    ) => {
      const seq = ++navSeq.current;
      if (how !== 'pop' && sameRoute(next, routeRef.current) && !options.anchor) {
        setMobile(false);
        window.scrollTo({ top: 0 });
        return;
      }
      let blocking = stoppable();
      if (blocking.length && how !== 'confirmed') {
        const ok = await confirm({
          title: `${activityHead(blocking[0])} em andamento`,
          message: <LeaveMessage />,
          confirmLabel: 'Encerrar e sair',
          cancelLabel: 'Continuar aqui',
        });
        if (seq !== navSeq.current) return;
        if (!ok) {
          // Back already moved the address; put back the screen that stays.
          if (how === 'pop')
            try {
              window.history.pushState({ y: window.scrollY }, '', formatRoute(routeRef.current));
            } catch {
              /* The address shows the other screen until the next navigation. */
            }
          return;
        }
        blocking = stoppable();
      }
      if (blocking.length) {
        const before = openDialogs();
        for (const activity of blocking)
          try {
            await activity.stop?.();
          } catch (e) {
            console.error(e);
          }
        // Ending a practice opens "Como foi a prática?": leave once it has been answered.
        if (blocking.some(a => a.kind === 'practice'))
          for (let i = 0; i < 8 && seq === navSeq.current; i++) {
            const opened = [...openDialogs()].find(d => !before.has(d)) as HTMLDialogElement | undefined;
            if (opened) {
              while (seq === navSeq.current && opened.isConnected && opened.open) await wait(200);
              break;
            }
            await wait(50);
          }
        if (seq !== navSeq.current) return;
      }
      commit(next, how === 'pop' ? 'replace' : 'push', options);
    },
    [commit, confirm],
  );
  const navigate = useCallback((next: Route) => void leave(next), [leave]);

  useEffect(() => {
    // Keep the address canonical from the start ("#/hoje" rather than nothing or an old link).
    replaceAddress(formatRoute(routeRef.current));
    const onPop = (e: PopStateEvent) => {
      const next = parseRoute(window.location.hash);
      if (sameRoute(next, routeRef.current)) return replaceAddress(formatRoute(next), e.state);
      const y = (e.state as { y?: unknown } | null)?.y;
      void leave(next, 'pop', { restoreY: typeof y === 'number' ? y : undefined });
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
    return { id: route.pieceId, exists: !!piece, title: piece?.title };
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
    if (!pieceInfo || pieceInfo.exists || routeRef.current.pieceId !== pieceInfo.id) return;
    commit({ view: 'library' }, 'replace');
    notify('Esta peça não está mais no seu repertório.', 'info');
  }, [pieceInfo, commit, notify]);
  useEffect(() => {
    if (!lessonInfo || lessonInfo.exists || routeRef.current.lessonId !== lessonInfo.id) return;
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
      for (const load of [loadPractice, loadPieceDetail, loadLessons, loadProgress, loadSettings])
        void load().catch(() => {});
    }, 3000);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
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
  const selectLesson = useCallback(
    // Leaving an open lesson asks on its own screen first (recording, unsaved suggestions).
    (id: string) =>
      void leave(id ? { view: 'lessons', lessonId: id } : { view: 'lessons' }, id ? 'push' : 'confirmed'),
    [leave],
  );
  const changeProgressTab = useCallback(
    (tab: ProgressTab) => {
      if (routeRef.current.view === 'progress')
        commit({ view: 'progress', tab }, 'replace', { fromProgress: true });
    },
    [commit],
  );

  const onSettings = route.view === 'settings';
  return (
    <div className="app-shell">
      <a
        className="skip-link"
        href="#conteudo"
        onClick={e => {
          // "#conteudo" would be read as a route: move the focus instead.
          e.preventDefault();
          const main = mainRef.current;
          const heading = main?.querySelector<HTMLElement>('h1') ?? main;
          if (!heading) return;
          if (!heading.hasAttribute('tabindex')) heading.setAttribute('tabindex', '-1');
          heading.focus();
        }}
      >
        Pular para o conteúdo
      </a>
      <div className="mobile-top">
        <button className="brand" aria-label="compasso: ir para Hoje" onClick={() => goView('home')}>
          <Music2 size={24} aria-hidden="true" />
          <span aria-hidden="true">
            compasso<span className="brand-dot">.</span>
          </span>
        </button>
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
          <div className="brand-mark" aria-hidden="true">
            <Music2 size={25} />
          </div>
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
        <div className="sidebar-bottom">
          <div className="sidebar-note">
            <span className="eyebrow">O ESTUDO É SEU.</span>
            <p>
              Cada pequena melhora
              <br />
              merece ser ouvida.
            </p>
          </div>
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
          <TopbarActivity routeRef={routeRef} onNavigate={navigate} />
          <TopbarStatus
            online={online}
            // Both screens already list the interrupted recordings.
            capturesShown={onSettings || (route.view === 'lessons' && !route.lessonId)}
            onOpenSettings={() => goView('settings')}
            onOpenCaptures={() => void leave({ view: 'settings' }, 'push', { anchor: CAPTURES_ANCHOR })}
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
                onAdd={() => setAdding(true)}
                notify={notify}
              />
            )}
            {route.view === 'library' &&
              (route.pieceId ? (
                <PieceDetail
                  key={route.pieceId}
                  id={route.pieceId}
                  onBack={() => navigate({ view: 'library' })}
                  onPractice={practice}
                  notify={notify}
                />
              ) : (
                <Library onOpen={openPiece} notify={notify} />
              ))}
            {route.view === 'practice' && (
              <Practice selectedId={route.target ?? ''} onSelect={selectPractice} notify={notify} />
            )}
            {route.view === 'lessons' && (
              <Lessons notify={notify} selectedId={route.lessonId ?? ''} onSelect={selectLesson} />
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
      <div className="toast-stack" aria-live="polite">
        {toasts.map(t => (
          <ToastItem key={t.id} toast={t} onDismiss={dismissToast} />
        ))}
      </div>
    </div>
  );
}
