import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  ChevronLeft,
  ChevronRight,
  Hand,
  Move,
  PenLine,
  Highlighter,
  Type,
  SquareDashed,
  Eraser,
  Undo2,
  Redo2,
  ZoomIn,
  ZoomOut,
  Download,
  Maximize2,
  Minimize2,
  MoreHorizontal,
  MoveHorizontal,
  RectangleVertical,
  Trash2,
  Plus,
} from 'lucide-react';
import { db } from '../db';
import { uid, now, type Score, type Annotation, type Point, type Region } from '../domain';
import { Modal, Field, ErrorBox, download, errorText, type Notify } from './common';
import { PdfRenderer } from '../pdf/render';
import {
  focusCrop,
  movePoints,
  overlayPath,
  overlayRect,
  overlayViewBox,
  pointFromClient,
  sameRegion,
  toOverlay,
  type FocusContext,
} from '../annotations';
import {
  historyFor,
  StaleHistoryError,
  type AnnotationOp,
  type AnnotationStore,
} from '../annotation-history';
import {
  clampZoom,
  exportFileName,
  fitPageZoom,
  isEditableTarget,
  loadViewState,
  pageKeyAction,
  readFlag,
  saveViewState,
  scoreAreaHeight,
  writeFlag,
  MAX_ZOOM,
  MIN_ZOOM,
  PENCIL_ONLY_KEY,
  SHOW_SEGMENTS_KEY,
  type FitMode,
  type PageKeyAction,
} from '../score-view';
import '../styles/score.css';

type Tool = 'navigate' | 'select' | 'pen' | 'highlight' | 'text' | 'region' | 'erase';
const tools = [
  ['navigate', Hand, 'Navegar', 'Navegar: ler e rolar a partitura'],
  ['select', Move, 'Mover', 'Selecionar e mover anotações'],
  ['pen', PenLine, 'Caneta', 'Caneta'],
  ['highlight', Highlighter, 'Marca-texto', 'Marca-texto'],
  ['text', Type, 'Texto', 'Texto'],
  ['region', SquareDashed, 'Trecho', 'Marcar trecho para praticar'],
  ['erase', Eraser, 'Borracha', 'Borracha: apagar anotação da camada ativa'],
] as const;
const layers = [
  { name: 'Minhas notas', color: '#087e8b' },
  { name: 'Professor', color: '#c0392b' },
  { name: 'Dedilhado', color: '#1f5fbf' },
];
const swatches = [
  ['#087e8b', 'Verde-azulado'],
  ['#c0392b', 'Vermelho'],
  ['#1f5fbf', 'Azul'],
  ['#1d2a2e', 'Grafite'],
  ['#e0a100', 'Amarelo'],
] as const;
const kindLabels: Record<Annotation['kind'], string> = {
  pen: 'Traço',
  highlight: 'Marca-texto',
  text: 'Texto',
};

const annotationStore: AnnotationStore = {
  get: id => db.annotations.get(id),
  put: annotation => db.annotations.put(annotation),
  delete: id => db.annotations.delete(id),
  update: (id, changes) => db.annotations.update(id, changes),
};

interface Anchor {
  /** Position under the fingers or cursor as a fraction of the sheet, kept in place while zooming. */
  fx: number;
  fy: number;
  clientX: number;
  clientY: number;
}

/**
 * Makes everything outside the full-screen viewer inert, so keyboard focus cannot reach controls hidden
 * behind it (the CSS fallback used on iPad does not do that by itself). Returns the undo function.
 */
function inertOutside(element: HTMLElement) {
  const changed: HTMLElement[] = [];
  for (
    let node: HTMLElement = element;
    node.parentElement && node !== document.body;
    node = node.parentElement
  ) {
    for (const sibling of Array.from(node.parentElement.children)) {
      if (sibling === node || !(sibling instanceof HTMLElement) || sibling.inert) continue;
      if (sibling instanceof HTMLDialogElement || sibling instanceof HTMLScriptElement) continue;
      sibling.inert = true;
      changed.push(sibling);
    }
  }
  return () => {
    for (const element of changed) element.inert = false;
  };
}

export interface ScoreViewerProps {
  score: Score;
  onRegion: (region: Region) => void;
  targetRegion?: Region;
  notify: Notify;
  /** Extra controls kept visible while the score is in full screen (e.g. the practice transport). */
  fullscreenOverlay?: ReactNode;
  /** Marked trechos drawn on the score; tapping one calls onSegmentClick. */
  segments?: { id: string; title: string; regions: Region[] }[];
  onSegmentClick?: (segmentId: string) => void;
  /** Selects the region tool each time this number changes (e.g. "Marcar na partitura" on a trecho). */
  requestRegion?: number;
  /** Replaces the region tool's hint, e.g. with the name of the trecho being marked. */
  regionPrompt?: string;
  /** Called when the region tool is left without drawing a region. */
  onRegionCancel?: () => void;
  /**
   * targetRegion is compared by value, so a fresh copy of the same region does nothing. Change this number
   * to go to the target and focus on it again (e.g. "Ver" pressed twice).
   */
  focusRequest?: number;
}
export default function ScoreViewer({
  score,
  onRegion,
  targetRegion,
  notify,
  fullscreenOverlay,
  segments,
  onSegmentClick,
  requestRegion,
  regionPrompt,
  onRegionCancel,
  focusRequest,
}: ScoreViewerProps) {
  const asset = useLiveQuery(() => db.assets.get(score.assetId), [score.assetId]);
  const isPdf = !!asset && (asset.mime === 'application/pdf' || asset.name.toLowerCase().endsWith('.pdf'));
  const [initial] = useState(() => loadViewState(score.id));
  const [viewFor, setViewFor] = useState(score.id);
  const [page, setPage] = useState(initial.page ?? 1),
    [pages, setPages] = useState(0),
    [ratio, setRatio] = useState(1.414);
  const [zoom, setZoom] = useState(initial.zoom ?? 1),
    [fit, setFit] = useState<FitMode | null>(initial.fit === undefined ? 'width' : initial.fit),
    [box, setBox] = useState({ w: 0, h: 0 }),
    [gesture, setGesture] = useState<{ scale: number; x: number; y: number } | null>(null);
  const [tool, setTool] = useState<Tool>('navigate'),
    [layer, setLayer] = useState(layers[0].name),
    [color, setColor] = useState(layers[0].color),
    [hiddenLayers, setHiddenLayers] = useState<string[]>([]);
  const [error, setError] = useState(''),
    [loading, setLoading] = useState(false),
    [attempt, setAttempt] = useState(0);
  const [draft, setDraft] = useState<Point[]>([]),
    [textPoint, setTextPoint] = useState<{ point: Point; page: number }>(),
    [text, setText] = useState(''),
    [fontSize, setFontSize] = useState(20);
  const [selectedId, setSelectedId] = useState<string | null>(null),
    [movePreview, setMovePreview] = useState<{ id: string; points: Point[] } | null>(null),
    [editingText, setEditingText] = useState<Annotation | null>(null);
  const [focus, setFocus] = useState(false),
    [focusContext, setFocusContext] = useState<FocusContext>('lead-in'),
    [targetHidden, setTargetHidden] = useState(false);
  const [exporting, setExporting] = useState(false),
    [fullscreen, setFullscreen] = useState(false),
    [menuOpen, setMenuOpen] = useState(false),
    [limit, setLimit] = useState<number>();
  const [pencilOnly, setPencilOnly] = useState(() => readFlag(PENCIL_ONLY_KEY) ?? false),
    [pencilOffer, setPencilOffer] = useState(false),
    [showSegments, setShowSegments] = useState(() => readFlag(SHOW_SEGMENTS_KEY) ?? true);
  const viewer = useRef<HTMLDivElement>(null),
    canvas = useRef<HTMLCanvasElement>(null),
    container = useRef<HTMLDivElement>(null),
    sheet = useRef<HTMLDivElement>(null),
    svg = useRef<SVGSVGElement>(null),
    menu = useRef<HTMLDivElement>(null),
    menuButton = useRef<HTMLButtonElement>(null),
    fullscreenButton = useRef<HTMLButtonElement>(null),
    bottomBar = useRef<HTMLDivElement>(null);
  const drawing = useRef<Point[]>([]),
    pointer = useRef<number | null>(null),
    moving = useRef<{ pointerId: number; annotation: Annotation; start: Point } | null>(null),
    penDown = useRef(false),
    pinching = useRef(false),
    anchor = useRef<Anchor | null>(null),
    renderer = useRef<{ key: string; renderer: PdfRenderer } | null>(null),
    appliedTarget = useRef<{ region?: Region; request?: number }>({}),
    penOfferQueued = useRef(false);
  const history = historyFor(score.id);
  useSyncExternalStore(history.subscribe, () => history.version);
  const annotations =
    useLiveQuery(
      () => db.annotations.where('[scoreId+page]').equals([score.id, page]).toArray(),
      [score.id, page],
    ) ?? [];

  // A different score in the same viewer (Practice switches segments) starts from its own saved view.
  if (viewFor !== score.id) {
    const saved = loadViewState(score.id);
    setViewFor(score.id);
    setPage(saved.page ?? 1);
    setZoom(saved.zoom ?? 1);
    setFit(saved.fit === undefined ? 'width' : saved.fit);
    setPages(0);
    setError('');
    setSelectedId(null);
    setMovePreview(null);
    setFocus(false);
    setTargetHidden(false);
  }

  const region = !targetHidden && targetRegion?.page === page ? targetRegion : undefined;
  // Focus shows a crop of the page; the page itself is rendered larger so the crop stays sharp.
  const crop = focus && region ? focusCrop(region, focusContext) : null;
  // "Página inteira" fits what is shown: the whole page, or the focused trecho.
  const shownRatio = crop ? (ratio * crop.h) / crop.w : ratio;
  const effectiveZoom = fit === 'width' ? 1 : fit === 'page' ? fitPageZoom(box.w, box.h, shownRatio) : zoom;
  const renderWidth = Math.max(1, Math.round(box.w * effectiveZoom));
  const pageWidth = Math.round(crop ? renderWidth / crop.w : renderWidth);
  /** Overlay units per CSS pixel, to keep labels and hit areas the same size at any zoom. */
  const unit = 1000 / pageWidth;
  const sheetHeight = crop ? (renderWidth * ratio * crop.h) / crop.w : renderWidth * ratio;

  useEffect(() => saveViewState(score.id, { page, zoom, fit }), [score.id, page, zoom, fit]);
  useEffect(() => {
    setSelectedId(null);
    setMovePreview(null);
    moving.current = null;
  }, [page]);
  // By value: a live query that returns a fresh copy of the same region (Practice saving its settings)
  // must not pull the student back to the trecho after they turned the page or left focus.
  useEffect(() => {
    if (!targetRegion) {
      appliedTarget.current = {};
      return;
    }
    const last = appliedTarget.current;
    if (sameRegion(last.region, targetRegion) && last.request === focusRequest) return;
    appliedTarget.current = { region: targetRegion, request: focusRequest };
    setTargetHidden(false);
    setPage(targetRegion.page);
    setFocus(true);
  }, [targetRegion, focusRequest]);
  const regionRequest = useRef(requestRegion);
  useEffect(() => {
    if (requestRegion === regionRequest.current) return;
    regionRequest.current = requestRegion;
    setTool('region');
    setFocus(false);
  }, [requestRegion]);

  // Measure the visible area. Resizes are debounced so dragging a window does not re-render every frame.
  useLayoutEffect(() => {
    const element = container.current,
      root = viewer.current;
    if (!element || !root) return;
    const measure = () => {
      const style = getComputedStyle(element);
      const padX = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
      const padY = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
      // In full screen the flex layout gives the score all the room left by the bars.
      let height = element.clientHeight;
      if (!root.classList.contains('is-fullscreen')) {
        const top = element.getBoundingClientRect().top + window.scrollY;
        height = scoreAreaHeight(window.innerHeight, top, bottomBar.current?.offsetHeight ?? 0);
        setLimit(current => (current === height ? current : height));
      }
      const w = Math.max(240, Math.floor(element.clientWidth - padX));
      const h = Math.max(160, Math.floor(height - padY));
      setBox(current => (current.w === w && current.h === h ? current : { w, h }));
    };
    measure();
    let timer: number | undefined;
    const schedule = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(measure, 150);
    };
    const observer = new ResizeObserver(schedule);
    observer.observe(element);
    // The viewer grows when a bar appears above the score (tools, notices), which moves the score down.
    observer.observe(root);
    window.addEventListener('resize', schedule);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', schedule);
      window.clearTimeout(timer);
    };
  }, []);

  useEffect(
    () => () => {
      renderer.current?.renderer.destroy();
      renderer.current = null;
    },
    [],
  );
  useEffect(() => {
    if (!asset || !isPdf || !canvas.current || !box.w) return;
    const key = `${asset.id}:${attempt}`;
    if (renderer.current?.key !== key) {
      renderer.current?.renderer.destroy();
      renderer.current = { key, renderer: new PdfRenderer(asset.blob) };
    }
    const pdf = renderer.current.renderer;
    const controller = new AbortController();
    setLoading(true);
    setError('');
    pdf.render({ canvas: canvas.current, page, width: pageWidth, zoom: 1, signal: controller.signal }).then(
      result => {
        if (controller.signal.aborted) return;
        setPages(result.pages);
        setRatio(result.ratio);
        setLoading(false);
        if (page > result.pages) setPage(result.pages);
        else if (page < result.pages) pdf.prefetch({ page: page + 1, width: pageWidth, zoom: 1 });
      },
      err => {
        if (controller.signal.aborted) return;
        setError(`Não foi possível exibir esta página. ${errorText(err)}`);
        setLoading(false);
      },
    );
    return () => controller.abort();
  }, [asset, isPdf, page, pageWidth, attempt, box.w]);
  useEffect(() => {
    if (!asset || isPdf || !canvas.current) return;
    // Images are drawn once at full resolution; zoom only changes their CSS size.
    const target = canvas.current;
    const url = URL.createObjectURL(asset.blob);
    const image = new Image();
    let cancelled = false;
    image.src = url;
    setLoading(true);
    setError('');
    image.decode().then(
      () => {
        if (cancelled) return;
        target.width = image.naturalWidth;
        target.height = image.naturalHeight;
        target.getContext('2d')?.drawImage(image, 0, 0);
        setPages(1);
        setPage(1);
        setRatio(image.naturalHeight / image.naturalWidth);
        setLoading(false);
      },
      err => {
        if (cancelled) return;
        setError(`Não foi possível exibir esta imagem. ${errorText(err)}`);
        setLoading(false);
      },
    );
    return () => {
      cancelled = true;
      URL.revokeObjectURL(url);
    };
  }, [asset, isPdf, attempt]);

  // Keep the point under the fingers or cursor in place after a zoom.
  useLayoutEffect(() => {
    const pin = anchor.current,
      element = container.current,
      target = sheet.current;
    anchor.current = null;
    if (!pin || !element || !target) return;
    const rect = target.getBoundingClientRect();
    element.scrollLeft += rect.left + pin.fx * rect.width - pin.clientX;
    element.scrollTop += rect.top + pin.fy * rect.height - pin.clientY;
  }, [renderWidth]);

  const anchorAt = (clientX: number, clientY: number): Anchor | null => {
    const rect = sheet.current?.getBoundingClientRect();
    if (!rect?.width || !rect.height) return null;
    return {
      fx: (clientX - rect.left) / rect.width,
      fy: (clientY - rect.top) / rect.height,
      clientX,
      clientY,
    };
  };
  const applyZoom = (next: number, pin: Anchor | null) => {
    const value = clampZoom(next);
    setFit(null);
    setZoom(value);
    anchor.current = Math.round(box.w * value) === renderWidth ? null : pin;
  };
  const stepZoom = (direction: 1 | -1) => {
    const rect = container.current?.getBoundingClientRect();
    const pin = rect
      ? anchorAt(
          rect.left + rect.width / 2,
          rect.top + Math.max(0, Math.min(rect.height, window.innerHeight - rect.top)) / 2,
        )
      : null;
    applyZoom(effectiveZoom * (direction > 0 ? 1.25 : 0.8), pin);
  };
  const chooseFit = (mode: FitMode) => {
    setFit(mode);
    anchor.current = null;
    container.current?.scrollTo({ top: 0, left: 0 });
  };

  const live = useRef({ effectiveZoom, tool, pencilOnly, applyZoom });
  useEffect(() => {
    live.current = { effectiveZoom, tool, pencilOnly, applyZoom };
  });

  // Pinch (two fingers) and ctrl+wheel / trackpad pinch zoom the score itself, not the whole page.
  useEffect(() => {
    const element = container.current;
    if (!element) return;
    let pinch: { distance: number; base: number; pin: Anchor; scale: number } | null = null;
    let wheel: { base: number; pin: Anchor; scale: number; timer: number } | null = null;
    const pinFor = (clientX: number, clientY: number) => {
      const rect = sheet.current?.getBoundingClientRect();
      if (!rect?.width || !rect.height) return null;
      return {
        fx: (clientX - rect.left) / rect.width,
        fy: (clientY - rect.top) / rect.height,
        clientX,
        clientY,
      };
    };
    const limit = (base: number, scale: number) => clampZoom(base * scale) / base;
    // iPadOS lists the Apple Pencil in TouchList too: pencil plus a resting finger or palm is not a pinch.
    const fingers = (touches: TouchList) =>
      Array.from(touches).filter(t => (t as Touch & { touchType?: string }).touchType !== 'stylus');
    const spread = (touches: Touch[]) =>
      Math.hypot(touches[0].clientX - touches[1].clientX, touches[0].clientY - touches[1].clientY);
    const onTouchStart = (event: TouchEvent) => {
      const touches = fingers(event.touches);
      if (touches.length !== 2 || penDown.current) return;
      const pin = pinFor(
        (touches[0].clientX + touches[1].clientX) / 2,
        (touches[0].clientY + touches[1].clientY) / 2,
      );
      if (!pin) return;
      // A second finger turns a finger stroke that just started into a pinch.
      pinching.current = true;
      pointer.current = null;
      drawing.current = [];
      setDraft([]);
      if (moving.current) {
        moving.current = null;
        setMovePreview(null);
      }
      pinch = {
        distance: Math.max(1, spread(touches)),
        base: live.current.effectiveZoom,
        pin,
        scale: 1,
      };
    };
    const onTouchMove = (event: TouchEvent) => {
      const touches = fingers(event.touches);
      if (!pinch || touches.length !== 2) return;
      if (event.cancelable) event.preventDefault();
      pinch.scale = limit(pinch.base, spread(touches) / pinch.distance);
      setGesture({ scale: pinch.scale, x: pinch.pin.fx, y: pinch.pin.fy });
    };
    const onTouchEnd = (event: TouchEvent) => {
      const left = fingers(event.touches).length;
      if (left === 0) pinching.current = false;
      if (!pinch || left >= 2) return;
      const done = pinch;
      pinch = null;
      setGesture(null);
      if (Math.abs(done.scale - 1) > 0.02) live.current.applyZoom(done.base * done.scale, done.pin);
    };
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey) return;
      event.preventDefault();
      if (!wheel) {
        const pin = pinFor(event.clientX, event.clientY);
        if (!pin) return;
        wheel = { base: live.current.effectiveZoom, pin, scale: 1, timer: 0 };
      }
      const delta = event.deltaMode === 1 ? event.deltaY * 16 : event.deltaY;
      wheel.scale = limit(wheel.base, wheel.scale * Math.exp(-delta * 0.003));
      setGesture({ scale: wheel.scale, x: wheel.pin.fx, y: wheel.pin.fy });
      window.clearTimeout(wheel.timer);
      wheel.timer = window.setTimeout(() => {
        const done = wheel;
        wheel = null;
        setGesture(null);
        if (done) live.current.applyZoom(done.base * done.scale, done.pin);
      }, 200);
    };
    // Safari's own page zoom would fight the score zoom.
    const stopNativeZoom = (event: Event) => event.preventDefault();
    // A pencil lifted outside the score (or taken over by scrolling) is no longer down.
    const penUp = (event: PointerEvent) => {
      if (event.pointerType === 'pen') penDown.current = false;
    };
    window.addEventListener('pointerup', penUp);
    window.addEventListener('pointercancel', penUp);
    element.addEventListener('touchstart', onTouchStart, { passive: true });
    element.addEventListener('touchmove', onTouchMove, { passive: false });
    element.addEventListener('touchend', onTouchEnd);
    element.addEventListener('touchcancel', onTouchEnd);
    element.addEventListener('wheel', onWheel, { passive: false });
    element.addEventListener('gesturestart', stopNativeZoom);
    element.addEventListener('gesturechange', stopNativeZoom);
    return () => {
      element.removeEventListener('touchstart', onTouchStart);
      element.removeEventListener('touchmove', onTouchMove);
      element.removeEventListener('touchend', onTouchEnd);
      element.removeEventListener('touchcancel', onTouchEnd);
      element.removeEventListener('wheel', onWheel);
      element.removeEventListener('gesturestart', stopNativeZoom);
      element.removeEventListener('gesturechange', stopNativeZoom);
      window.removeEventListener('pointerup', penUp);
      window.removeEventListener('pointercancel', penUp);
      if (wheel) window.clearTimeout(wheel.timer);
    };
  }, []);

  // In "Só Apple Pencil" mode fingers may scroll; the pencil must not, or its strokes would pan the page.
  useEffect(() => {
    const element = svg.current;
    if (!element) return;
    const onTouch = (event: TouchEvent) => {
      if (live.current.tool === 'navigate' || !live.current.pencilOnly) return;
      const stylus =
        penDown.current ||
        Array.from(event.changedTouches).some(
          touch => (touch as Touch & { touchType?: string }).touchType === 'stylus',
        );
      if (stylus && event.cancelable) event.preventDefault();
    };
    element.addEventListener('touchstart', onTouch, { passive: false });
    element.addEventListener('touchmove', onTouch, { passive: false });
    return () => {
      element.removeEventListener('touchstart', onTouch);
      element.removeEventListener('touchmove', onTouch);
    };
  }, []);

  useEffect(() => {
    if (!fullscreen || !viewer.current) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const restoreInert = inertOutside(viewer.current);
    const onFullscreenChange = () => {
      // The browser takes Esc to leave native full screen even with a dialog open. Keep the score covering
      // the window (CSS mode) so only the dialog is affected; its own Esc or "Sair" close the rest.
      if (!document.fullscreenElement && !document.querySelector('dialog[open]')) setFullscreen(false);
    };
    document.addEventListener('fullscreenchange', onFullscreenChange);
    return () => {
      document.body.style.overflow = previousOverflow;
      restoreInert();
      document.removeEventListener('fullscreenchange', onFullscreenChange);
    };
  }, [fullscreen]);
  useEffect(() => {
    if (!fullscreen && !menuOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      // An open dialog handles its own Escape; closing it must not also leave full screen.
      if (event.key !== 'Escape' || document.querySelector('dialog[open]')) return;
      event.preventDefault();
      if (menuOpen) {
        setMenuOpen(false);
        menuButton.current?.focus();
        return;
      }
      if (document.fullscreenElement === document.documentElement)
        void document.exitFullscreen().catch(() => {});
      setFullscreen(false);
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [fullscreen, menuOpen]);
  useEffect(() => {
    if (!menuOpen) return;
    menu.current?.querySelector<HTMLElement>('button:not(:disabled), input')?.focus();
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (menu.current?.contains(target) || menuButton.current?.contains(target)) return;
      setMenuOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, [menuOpen]);

  const changePage = (next: number, at: 'top' | 'bottom' = 'top') => {
    setPage(next);
    setFocus(false);
    const element = container.current;
    if (!element) return;
    element.scrollTo({ top: 0, left: 0 });
    if (at === 'bottom')
      requestAnimationFrame(() => element.scrollTo({ top: element.scrollHeight, left: 0 }));
  };
  const turnPage = ({ direction, scrollFirst }: PageKeyAction) => {
    const element = container.current;
    if (scrollFirst && element && !focus) {
      // A zoomed page is read top to bottom before the pedal turns it.
      const step = Math.max(80, element.clientHeight * 0.85);
      if (direction > 0 && element.scrollTop + element.clientHeight < element.scrollHeight - 4)
        return element.scrollBy({ top: step });
      if (direction < 0 && element.scrollTop > 4) return element.scrollBy({ top: -step });
    }
    const next = page + direction;
    if (next < 1 || (pages > 0 && next > pages)) return;
    changePage(next, direction < 0 && scrollFirst ? 'bottom' : 'top');
  };

  const showOp = (op: AnnotationOp | undefined) => {
    if (!op) return;
    setSelectedId(null);
    setHiddenLayers(list => list.filter(l => l !== op.annotation.layer));
    if (op.annotation.page !== page) changePage(op.annotation.page);
  };
  const step = async (direction: 'undo' | 'redo') => {
    try {
      showOp(await (direction === 'undo' ? history.undo(annotationStore) : history.redo(annotationStore)));
    } catch (err) {
      if (err instanceof StaleHistoryError)
        notify(
          'As anotações desta partitura mudaram por fora (por exemplo, com um backup restaurado). O histórico de desfazer recomeça a partir de agora.',
          'info',
        );
      else
        notify(
          `Não foi possível ${direction === 'undo' ? 'desfazer' : 'refazer'}. ${errorText(err)}`,
          'error',
        );
    }
  };
  const undo = () => step('undo');
  const redo = () => step('redo');

  const keys = useRef<(event: KeyboardEvent) => void>(() => {});
  useEffect(() => {
    keys.current = event => {
      if (event.defaultPrevented || event.isComposing || menuOpen) return;
      if (isEditableTarget(event.target) || document.querySelector('dialog[open]')) return;
      const focused = document.activeElement;
      const nearScore =
        fullscreen || !focused || focused === document.body || !!viewer.current?.contains(focused);
      const key = event.key.toLowerCase();
      if ((event.ctrlKey || event.metaKey) && !event.altKey && (key === 'z' || key === 'y')) {
        // Only while annotating or working in the viewer: Ctrl+Z after typing a note elsewhere on the page
        // must not silently remove the last mark from the score.
        if (!annotating && !nearScore) return;
        event.preventDefault();
        void (key === 'y' || event.shiftKey ? redo() : undo());
        return;
      }
      const action = pageKeyAction(event);
      // Pedals always send ← and →. ↑ ↓ and PageUp/PageDown keep scrolling the page unless the score has
      // the focus (or fills the screen), so the trechos and notes below it stay reachable by keyboard.
      if (!action || (action.scrollFirst && !nearScore)) return;
      event.preventDefault();
      turnPage(action);
    };
  });
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => keys.current(event);
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const ensureLayerVisible = () => {
    if (!hiddenLayers.includes(layer)) return;
    setHiddenLayers(list => list.filter(l => l !== layer));
    notify(`A camada “${layer}” estava oculta e voltou a aparecer.`, 'info');
  };
  const save = async (
    points: Point[],
    kind: Annotation['kind'],
    onPage: number,
    value?: string,
    size?: number,
  ) => {
    const annotation: Annotation = {
      id: uid(),
      scoreId: score.id,
      page: onPage,
      layer,
      kind,
      color,
      width: kind === 'highlight' ? 18 : 2.4,
      points,
      text: value,
      fontSize: kind === 'text' ? size : undefined,
      createdAt: now(),
    };
    try {
      await db.annotations.add(annotation);
      history.record({ type: 'create', annotation });
      return true;
    } catch (err) {
      notify(`A marcação não foi salva. ${errorText(err)}`, 'error');
      return false;
    }
  };
  const erase = async (annotation: Annotation) => {
    try {
      await db.annotations.delete(annotation.id);
      history.record({ type: 'delete', annotation });
      setSelectedId(id => (id === annotation.id ? null : id));
    } catch (err) {
      notify(`Não foi possível apagar a anotação. ${errorText(err)}`, 'error');
    }
  };
  const point = (event: { clientX: number; clientY: number; pressure: number }): Point => ({
    ...pointFromClient(event.clientX, event.clientY, svg.current!.getBoundingClientRect()),
    pressure: event.pressure,
  });
  const selected = annotations.find(a => a.id === selectedId);
  const finishMove = async (
    pointerId: number,
    event: React.PointerEvent<SVGSVGElement>,
    cancelled = false,
  ) => {
    const active = moving.current;
    if (!active || active.pointerId !== pointerId) return;
    moving.current = null;
    if (event.currentTarget.hasPointerCapture(pointerId))
      event.currentTarget.releasePointerCapture(pointerId);
    if (cancelled) {
      setMovePreview(null);
      return;
    }
    const at = point(event);
    const before = active.annotation.points;
    const points = movePoints(before, at.x - active.start.x, at.y - active.start.y);
    if (points.some((p, i) => p.x !== before[i].x || p.y !== before[i].y)) {
      setMovePreview({ id: active.annotation.id, points });
      try {
        await db.annotations.update(active.annotation.id, { points });
        history.record({
          type: 'update',
          annotation: active.annotation,
          before: { points: before },
          after: { points },
        });
      } catch (err) {
        notify(`Não foi possível mover a anotação. ${errorText(err)}`, 'error');
      }
    }
    setMovePreview(null);
  };
  const chooseTool = (next: Tool) => {
    if (tool === 'region' && next !== 'region') onRegionCancel?.();
    setTool(next);
    setMenuOpen(false);
    if (focus) setFocus(false);
    if (next !== 'select') setSelectedId(null);
  };
  const chooseLayer = (name: string) => {
    setLayer(name);
    setColor(layers.find(l => l.name === name)?.color ?? color);
  };
  const toggleLayer = (name: string) =>
    setHiddenLayers(list => (list.includes(name) ? list.filter(l => l !== name) : [...list, name]));
  const setPencil = (value: boolean) => {
    setPencilOnly(value);
    setPencilOffer(false);
    writeFlag(PENCIL_ONLY_KEY, value);
  };
  const notePen = (pointerId: number) => {
    penDown.current = true;
    if (pencilOnly || penOfferQueued.current || readFlag(PENCIL_ONLY_KEY) !== undefined) return;
    penOfferQueued.current = true;
    // Offered once the stroke ends: a bar appearing above the score now would move the page under the pencil.
    const offer = (event: PointerEvent) => {
      if (event.pointerId !== pointerId) return;
      window.removeEventListener('pointerup', offer);
      window.removeEventListener('pointercancel', offer);
      setPencilOffer(true);
    };
    window.addEventListener('pointerup', offer);
    window.addEventListener('pointercancel', offer);
  };
  const exportScore = async () => {
    if (!asset) return;
    setExporting(true);
    try {
      const { exportAnnotated } = await import('../score-export');
      download(
        await exportAnnotated(asset, await db.annotations.where('scoreId').equals(score.id).toArray()),
        exportFileName(score.title),
      );
      setMenuOpen(false);
    } catch (err) {
      notify(`Não foi possível exportar a partitura. ${errorText(err)}`, 'error');
    } finally {
      setExporting(false);
    }
  };
  const toggleFullscreen = async () => {
    setMenuOpen(false);
    const root = document.documentElement;
    if (fullscreen) {
      if (document.fullscreenElement === root)
        try {
          await document.exitFullscreen();
        } catch {
          /* CSS mode remains available */
        }
      setFullscreen(false);
      return;
    }
    // The whole document goes full screen and the viewer covers it with CSS, so notices, confirmations
    // and the practice screen's messages (rendered outside the viewer) stay visible.
    setFullscreen(true);
    if (root.requestFullscreen)
      try {
        await root.requestFullscreen();
      } catch {
        /* CSS mode supports iPad Safari */
      }
    fullscreenButton.current?.focus();
  };

  const pageLabel = `Página ${page}${pages ? ` de ${pages}` : ''}`;
  const pager = (position: 'superior' | 'inferior') => (
    <>
      <button
        type="button"
        className="icon-btn"
        aria-label={`Página anterior (${position})`}
        disabled={page <= 1}
        onClick={() => changePage(page - 1)}
      >
        <ChevronLeft size={20} />
      </button>
      {position === 'superior' ? (
        <span className="score-pager-short" aria-hidden>
          {page}
          {pages ? ` / ${pages}` : ''}
        </span>
      ) : (
        <span>{pageLabel}</span>
      )}
      <button
        type="button"
        className="icon-btn"
        aria-label={`Próxima página (${position})`}
        disabled={pages > 0 && page >= pages}
        onClick={() => changePage(page + 1)}
      >
        <ChevronRight size={20} />
      </button>
    </>
  );
  const annotating =
    tool === 'select' || tool === 'pen' || tool === 'highlight' || tool === 'text' || tool === 'erase';
  const drawingTool = tool === 'pen' || tool === 'highlight' || tool === 'text';
  const interactive = tool === 'select' || tool === 'erase';
  // Marking a trecho leaves no ink, so a finger may draw the rectangle even in "Só Apple Pencil" mode.
  const fingerDraws = !pencilOnly || tool === 'region';
  const touchAction = tool === 'navigate' || !fingerDraws ? 'pan-x pan-y' : 'none';
  const visibleAnnotations = annotations.filter(a => !hiddenLayers.includes(a.layer));
  const segmentsHere = segments
    ? segments.flatMap(s =>
        s.regions
          .map((r, i) => ({ key: `${s.id}-${i}`, id: s.id, title: s.title, region: r }))
          .filter(m => m.region.page === page && (showSegments || sameRegion(m.region, region))),
      )
    : [];
  // The trecho opened with "Ver" is drawn in gold as one of the marks, so it stays tappable.
  const targetMarked = segmentsHere.some(m => sameRegion(m.region, region));
  const segmentsClickable = tool === 'navigate' && !!onSegmentClick && !focus;

  return (
    <div
      ref={viewer}
      className={`score-viewer ${fullscreen ? 'is-fullscreen' : ''}`}
      role="region"
      aria-label={fullscreen ? `Partitura em tela cheia: ${score.title}` : `Partitura: ${score.title}`}
    >
      <div className="score-toolbar">
        <div className="score-toolset" role="group" aria-label="Ferramentas da partitura">
          {tools.map(([key, Icon, short, label]) => (
            <button
              key={key}
              type="button"
              className={`score-tool ${tool === key ? 'active' : ''}`}
              aria-label={label}
              aria-pressed={tool === key}
              onClick={() => chooseTool(key)}
            >
              <Icon size={19} aria-hidden />
              <span className="score-tool-label">{short}</span>
            </button>
          ))}
        </div>
        <div className="score-toolbar-end">
          <div className="score-pager score-pager-top">{pager('superior')}</div>
          <button
            ref={menuButton}
            type="button"
            className={`score-tool ${menuOpen ? 'open' : ''}`}
            aria-label="Mais opções da partitura"
            aria-expanded={menuOpen}
            aria-haspopup="dialog"
            onClick={() => setMenuOpen(open => !open)}
          >
            <MoreHorizontal size={19} aria-hidden />
            <span className="score-tool-label">Mais</span>
          </button>
          <button
            ref={fullscreenButton}
            type="button"
            className="score-tool"
            aria-label={fullscreen ? 'Sair da tela cheia' : 'Tela cheia'}
            onClick={() => void toggleFullscreen()}
          >
            {fullscreen ? <Minimize2 size={19} aria-hidden /> : <Maximize2 size={19} aria-hidden />}
            <span className="score-tool-label">{fullscreen ? 'Sair' : 'Tela cheia'}</span>
          </button>
        </div>
        {menuOpen && (
          <div ref={menu} className="score-menu" role="dialog" aria-label="Mais opções da partitura">
            <button
              type="button"
              className="score-menu-item"
              disabled={!asset || exporting}
              onClick={() => void exportScore()}
            >
              <Download size={18} aria-hidden />
              {exporting ? 'Exportando…' : 'Exportar PDF com anotações'}
            </button>
            <fieldset className="score-menu-group">
              <legend>Camadas visíveis</legend>
              {layers.map(l => (
                <label key={l.name} className="score-menu-check">
                  <input
                    type="checkbox"
                    checked={!hiddenLayers.includes(l.name)}
                    onChange={() => toggleLayer(l.name)}
                  />
                  <span className="layer-dot" style={{ '--dot': l.color } as CSSProperties} aria-hidden />
                  {l.name}
                </label>
              ))}
            </fieldset>
            <fieldset className="score-menu-group">
              <legend>Leitura e escrita</legend>
              {segments && (
                <label className="score-menu-check">
                  <input
                    type="checkbox"
                    checked={showSegments}
                    onChange={e => {
                      setShowSegments(e.target.checked);
                      writeFlag(SHOW_SEGMENTS_KEY, e.target.checked);
                    }}
                  />
                  <span>
                    Mostrar trechos
                    <small>Retângulos discretos nos trechos marcados.</small>
                  </span>
                </label>
              )}
              <label className="score-menu-check">
                <input type="checkbox" checked={pencilOnly} onChange={e => setPencil(e.target.checked)} />
                <span>
                  Só Apple Pencil
                  <small>A caneta escreve; o dedo rola e amplia a partitura.</small>
                </span>
              </label>
            </fieldset>
            <p className="score-menu-hint">
              Teclado ou pedal: → e ← viram a página. ↓ e ↑ rolam a página ampliada e depois viram, quando
              você está na partitura ou em tela cheia.
            </p>
          </div>
        )}
      </div>
      {pencilOffer && (
        <div className="score-notice" role="status">
          <p>
            Apple Pencil por aqui. Quer que só a caneta escreva? Assim o dedo rola e amplia a partitura sem
            riscar.
          </p>
          <button type="button" className="btn small" onClick={() => setPencil(true)}>
            Usar só a caneta
          </button>
          <button type="button" className="btn small secondary" onClick={() => setPencil(false)}>
            Agora não
          </button>
        </div>
      )}
      {(annotating || tool === 'region' || region) && (
        <div className="score-subbar">
          {annotating && (
            <>
              <div className="score-subgroup">
                <button
                  type="button"
                  className="icon-btn"
                  aria-label="Desfazer"
                  title="Desfazer (Ctrl+Z)"
                  disabled={!history.canUndo}
                  onClick={() => void undo()}
                >
                  <Undo2 size={18} />
                </button>
                <button
                  type="button"
                  className="icon-btn"
                  aria-label="Refazer"
                  title="Refazer (Ctrl+Shift+Z)"
                  disabled={!history.canRedo}
                  onClick={() => void redo()}
                >
                  <Redo2 size={18} />
                </button>
              </div>
              {tool !== 'select' && (
                <select
                  className="score-layer-select"
                  aria-label="Camada"
                  value={layer}
                  onChange={e => chooseLayer(e.target.value)}
                >
                  {layers.map(l => (
                    <option key={l.name}>{l.name}</option>
                  ))}
                </select>
              )}
              {drawingTool && (
                <div className="score-swatches" role="group" aria-label="Cor">
                  {swatches.map(([value, name]) => (
                    <button
                      key={value}
                      type="button"
                      className="score-swatch"
                      aria-label={name}
                      aria-pressed={color === value}
                      style={{ '--swatch': value } as CSSProperties}
                      onClick={() => setColor(value)}
                    />
                  ))}
                  <label
                    className="score-swatch score-swatch-custom"
                    data-active={!swatches.some(([value]) => value === color)}
                    style={{ '--swatch': color } as CSSProperties}
                  >
                    <Plus size={14} aria-hidden />
                    <input
                      type="color"
                      aria-label="Outra cor"
                      value={color}
                      onChange={e => setColor(e.target.value)}
                    />
                  </label>
                </div>
              )}
              {drawingTool && hiddenLayers.includes(layer) && (
                <span className="score-warning">
                  “{layer}” está oculta
                  <button type="button" className="link-btn" onClick={() => toggleLayer(layer)}>
                    Mostrar
                  </button>
                </span>
              )}
              {tool === 'erase' && <span className="score-hint">Toque numa anotação de “{layer}”.</span>}
              {tool === 'select' &&
                (selected ? (
                  <>
                    <span className="score-hint strong">
                      {kindLabels[selected.kind]}
                      {selected.kind === 'text' && selected.text
                        ? ` “${selected.text.slice(0, 24)}”`
                        : ''} · {selected.layer}
                    </span>
                    {selected.kind === 'text' && (
                      <button
                        type="button"
                        className="btn small secondary"
                        onClick={() => {
                          setEditingText(selected);
                          setText(selected.text ?? '');
                          setFontSize(selected.fontSize ?? 20);
                        }}
                      >
                        Editar texto
                      </button>
                    )}
                    <button
                      type="button"
                      className="btn small secondary"
                      onClick={() => void erase(selected)}
                    >
                      <Trash2 size={15} aria-hidden />
                      Apagar
                    </button>
                    <button type="button" className="link-btn" onClick={() => setSelectedId(null)}>
                      Desmarcar
                    </button>
                  </>
                ) : (
                  <span className="score-hint">
                    Toque numa anotação para selecioná-la e arraste para mover.
                  </span>
                ))}
            </>
          )}
          {tool === 'region' && (
            <>
              <span className={`score-hint ${regionPrompt ? 'strong' : ''}`}>
                {regionPrompt ?? 'Arraste um retângulo ao redor do trecho que você quer praticar.'}
              </span>
              <button type="button" className="link-btn" onClick={() => chooseTool('navigate')}>
                Cancelar
              </button>
            </>
          )}
          {tool === 'navigate' && region && (
            <>
              <span className="score-hint">Trecho marcado nesta página.</span>
              <button
                type="button"
                className="btn small secondary"
                aria-pressed={focus}
                onClick={() => setFocus(!focus)}
              >
                {focus ? 'Ver página inteira' : 'Focar no trecho'}
              </button>
              {focus && (
                <button
                  type="button"
                  className="btn small secondary"
                  aria-pressed={focusContext === 'system'}
                  onClick={() => setFocusContext(c => (c === 'system' ? 'lead-in' : 'system'))}
                >
                  Sistema inteiro
                </button>
              )}
              <button
                type="button"
                className="link-btn"
                onClick={() => {
                  setTargetHidden(true);
                  setFocus(false);
                }}
              >
                Fechar trecho
              </button>
            </>
          )}
        </div>
      )}
      <ErrorBox message={error} />
      {error && (
        <div className="row" style={{ padding: 12 }}>
          <button type="button" className="btn secondary small" onClick={() => setAttempt(n => n + 1)}>
            Tentar novamente
          </button>
          <span className="hint">O arquivo original continua salvo.</span>
        </div>
      )}
      <div className="score-scroll" ref={container} style={{ maxHeight: fullscreen ? undefined : limit }}>
        <div
          ref={sheet}
          className="score-sheet"
          style={{
            width: renderWidth,
            height: sheetHeight,
            overflow: 'hidden',
            transform: gesture ? `scale(${gesture.scale})` : undefined,
            transformOrigin: gesture ? `${gesture.x * 100}% ${gesture.y * 100}%` : undefined,
          }}
        >
          {loading && <span className="loading-label">Carregando partitura…</span>}
          <div
            style={{
              position: 'relative',
              width: crop ? `${100 / crop.w}%` : '100%',
              height: crop ? `${100 / crop.h}%` : '100%',
              transform: crop ? `translate(${-crop.x * 100}%, ${-crop.y * 100}%)` : undefined,
              transformOrigin: 'top left',
            }}
          >
            <canvas
              ref={canvas}
              role="img"
              aria-label={`Partitura ${score.title}, ${pageLabel.toLowerCase()}`}
              style={{ width: '100%', height: '100%', display: 'block' }}
            />
            <svg
              ref={svg}
              className="annotation-overlay"
              viewBox={overlayViewBox(ratio)}
              preserveAspectRatio="none"
              role="group"
              aria-label="Anotações e trechos"
              style={{ touchAction, pointerEvents: focus ? 'none' : undefined }}
              onPointerDownCapture={e => {
                if (e.pointerType === 'pen') notePen(e.pointerId);
              }}
              onPointerDown={e => {
                if (tool === 'navigate' || focus || pointer.current !== null || pinching.current) return;
                if (!fingerDraws && e.pointerType === 'touch') return;
                if (tool === 'erase') return;
                if (tool === 'select') {
                  setSelectedId(null);
                  return;
                }
                const p = point(e);
                if (tool === 'text') {
                  ensureLayerVisible();
                  setTextPoint({ point: p, page });
                  setText('');
                  setFontSize(20);
                  return;
                }
                if (tool !== 'region') ensureLayerVisible();
                pointer.current = e.pointerId;
                e.currentTarget.setPointerCapture(e.pointerId);
                drawing.current = [p];
                setDraft([p]);
              }}
              onPointerMove={e => {
                if (moving.current?.pointerId === e.pointerId) {
                  const at = point(e),
                    active = moving.current;
                  setMovePreview({
                    id: active.annotation.id,
                    points: movePoints(
                      active.annotation.points,
                      at.x - active.start.x,
                      at.y - active.start.y,
                    ),
                  });
                  return;
                }
                if (pointer.current !== e.pointerId) return;
                const p = point(e);
                drawing.current = tool === 'region' ? [drawing.current[0], p] : [...drawing.current, p];
                setDraft(drawing.current);
              }}
              onPointerCancel={e => {
                if (e.pointerType === 'pen') penDown.current = false;
                if (moving.current?.pointerId === e.pointerId) void finishMove(e.pointerId, e, true);
                if (pointer.current !== e.pointerId) return;
                pointer.current = null;
                drawing.current = [];
                setDraft([]);
              }}
              onPointerUp={e => {
                if (e.pointerType === 'pen') penDown.current = false;
                if (moving.current?.pointerId === e.pointerId) {
                  void finishMove(e.pointerId, e);
                  return;
                }
                if (pointer.current !== e.pointerId) return;
                pointer.current = null;
                const points = drawing.current;
                drawing.current = [];
                setDraft([]);
                if (tool === 'region' && points.length > 1) {
                  const a = points[0],
                    b = points.at(-1)!;
                  if (Math.abs(a.x - b.x) > 0.015 && Math.abs(a.y - b.y) > 0.008) {
                    onRegion({
                      page,
                      x: Math.min(a.x, b.x),
                      y: Math.min(a.y, b.y),
                      w: Math.abs(a.x - b.x),
                      h: Math.abs(a.y - b.y),
                    });
                    setTool('navigate');
                  }
                } else if (tool === 'pen' || tool === 'highlight')
                  void save(
                    points.length === 1 ? [points[0], { ...points[0], x: points[0].x + 0.0001 }] : points,
                    tool,
                    page,
                  );
              }}
            >
              {segmentsHere.map(mark => {
                const rect = overlayRect(mark.region, ratio);
                const labelSize = 12 * unit;
                const label = mark.title.length > 32 ? `${mark.title.slice(0, 31)}…` : mark.title;
                const target = sameRegion(mark.region, region);
                return (
                  <g
                    key={mark.key}
                    className={`segment-mark ${segmentsClickable ? 'interactive' : ''} ${target ? 'is-target' : ''}`}
                    role={segmentsClickable ? 'button' : undefined}
                    tabIndex={segmentsClickable ? 0 : undefined}
                    aria-label={segmentsClickable ? `Trecho ${mark.title}` : undefined}
                    onClick={segmentsClickable ? () => onSegmentClick?.(mark.id) : undefined}
                    onKeyDown={
                      segmentsClickable
                        ? e => {
                            if (e.key !== 'Enter' && e.key !== ' ') return;
                            e.preventDefault();
                            onSegmentClick?.(mark.id);
                          }
                        : undefined
                    }
                  >
                    <rect
                      {...rect}
                      rx={4 * unit}
                      className="segment-mark-box"
                      strokeWidth={(target ? 2 : 1.5) * unit}
                      strokeDasharray={`${(target ? 8 : 6) * unit} ${4 * unit}`}
                    />
                    <text
                      className="segment-mark-label"
                      x={rect.x + 3 * unit}
                      y={rect.y > labelSize * 1.5 ? rect.y - labelSize * 0.4 : rect.y + labelSize * 1.1}
                      fontSize={labelSize}
                      strokeWidth={3 * unit}
                    >
                      {label}
                    </text>
                  </g>
                );
              })}
              {visibleAnnotations.map(a => {
                const points = movePreview?.id === a.id ? movePreview.points : a.points;
                const path = overlayPath(points, ratio);
                const hitWidth = Math.max(a.width + 12, 24 * unit);
                return (
                  <g
                    key={a.id}
                    opacity={selectedId === a.id ? 1 : a.layer === layer ? 1 : 0.65}
                    className={selectedId === a.id ? 'annotation-selected' : undefined}
                    onPointerDown={e => {
                      if (pencilOnly && e.pointerType === 'touch') return;
                      if (tool === 'select') {
                        e.stopPropagation();
                        setSelectedId(a.id);
                        moving.current = { pointerId: e.pointerId, annotation: a, start: point(e) };
                        svg.current?.setPointerCapture(e.pointerId);
                      } else if (tool === 'erase' && a.layer === layer) {
                        e.stopPropagation();
                        void erase(a);
                      }
                    }}
                    style={{
                      pointerEvents: interactive ? 'auto' : 'none',
                      cursor: tool === 'select' ? 'grab' : tool === 'erase' ? 'pointer' : undefined,
                    }}
                  >
                    {a.kind === 'text' ? (
                      <text
                        {...toOverlay(points[0], ratio)}
                        fill={a.color}
                        fontSize={a.fontSize ?? 20}
                        fontFamily="Helvetica, Arial, sans-serif"
                        stroke="transparent"
                        strokeWidth={interactive ? Math.max(18, 16 * unit) : 0}
                        paintOrder="stroke"
                        style={{ pointerEvents: interactive ? 'visiblePainted' : 'none' }}
                      >
                        {a.text}
                      </text>
                    ) : (
                      <>
                        {interactive && (
                          <path
                            d={path}
                            stroke="transparent"
                            strokeWidth={hitWidth}
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            fill="none"
                            pointerEvents="stroke"
                          />
                        )}
                        <path
                          d={path}
                          stroke={a.color}
                          strokeWidth={a.width}
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          opacity={a.kind === 'highlight' ? 0.3 : 1}
                          fill="none"
                          pointerEvents="none"
                        />
                      </>
                    )}
                  </g>
                );
              })}
              {region && !targetMarked && (
                <rect
                  {...overlayRect(region, ratio)}
                  fill="#e9af58"
                  fillOpacity=".12"
                  stroke="#bd8023"
                  strokeWidth={2 * unit}
                  strokeDasharray={`${8 * unit} ${4 * unit}`}
                />
              )}
              {tool === 'region' && draft.length > 1 ? (
                <rect
                  {...overlayRect(
                    {
                      x: Math.min(draft[0].x, draft[1].x),
                      y: Math.min(draft[0].y, draft[1].y),
                      w: Math.abs(draft[0].x - draft[1].x),
                      h: Math.abs(draft[0].y - draft[1].y),
                    },
                    ratio,
                  )}
                  fill="#087e8b"
                  fillOpacity=".15"
                  stroke="#087e8b"
                  strokeWidth={2 * unit}
                />
              ) : (
                draft.length > 0 && (
                  <path
                    d={overlayPath(draft, ratio)}
                    stroke={color}
                    strokeWidth={tool === 'highlight' ? 18 : 2.4}
                    opacity={tool === 'highlight' ? 0.3 : 1}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    fill="none"
                  />
                )
              )}
            </svg>
          </div>
        </div>
      </div>
      <div className="page-controls score-bottom" ref={bottomBar}>
        <div className="score-pager">{pager('inferior')}</div>
        {/* Kept in reach after going back to Navegar; the tool row has no room left on a tablet. */}
        {!annotating && (history.canUndo || history.canRedo) && (
          <div className="score-history" role="group" aria-label="Histórico de anotações">
            <button
              type="button"
              className="icon-btn"
              aria-label="Desfazer última anotação"
              title="Desfazer (Ctrl+Z)"
              disabled={!history.canUndo}
              onClick={() => void undo()}
            >
              <Undo2 size={18} />
            </button>
            <button
              type="button"
              className="icon-btn"
              aria-label="Refazer anotação"
              title="Refazer (Ctrl+Shift+Z)"
              disabled={!history.canRedo}
              onClick={() => void redo()}
            >
              <Redo2 size={18} />
            </button>
          </div>
        )}
        {fullscreen && fullscreenOverlay && <div className="score-overlay-slot">{fullscreenOverlay}</div>}
        <div className="score-zoom" role="group" aria-label="Tamanho da partitura">
          <button
            type="button"
            className={`score-fit ${fit === 'width' ? 'active' : ''}`}
            aria-label="Ajustar à largura"
            aria-pressed={fit === 'width'}
            onClick={() => chooseFit('width')}
          >
            <MoveHorizontal size={17} aria-hidden />
            <span>Largura</span>
          </button>
          <button
            type="button"
            className={`score-fit ${fit === 'page' ? 'active' : ''}`}
            aria-label="Página inteira"
            aria-pressed={fit === 'page'}
            onClick={() => chooseFit('page')}
          >
            <RectangleVertical size={17} aria-hidden />
            <span>Página inteira</span>
          </button>
          <button
            type="button"
            className="icon-btn"
            aria-label="Diminuir zoom"
            disabled={effectiveZoom <= MIN_ZOOM}
            onClick={() => stepZoom(-1)}
          >
            <ZoomOut size={18} />
          </button>
          <span className="score-zoom-value">{Math.round(effectiveZoom * 100)}%</span>
          <button
            type="button"
            className="icon-btn"
            aria-label="Aumentar zoom"
            disabled={effectiveZoom >= MAX_ZOOM}
            onClick={() => stepZoom(1)}
          >
            <ZoomIn size={18} />
          </button>
        </div>
      </div>
      <span className="score-sr-only" aria-live="polite">
        {pageLabel}
      </span>
      {(textPoint || editingText) && (
        <Modal
          guard
          title={editingText ? 'Editar anotação de texto' : 'Anotação na partitura'}
          onClose={() => {
            setTextPoint(undefined);
            setEditingText(null);
          }}
        >
          <form
            onSubmit={async e => {
              e.preventDefault();
              if (!text.trim() || fontSize < 10 || fontSize > 100) return;
              if (editingText) {
                const before = { text: editingText.text, fontSize: editingText.fontSize };
                const after = { text: text.trim(), fontSize };
                try {
                  await db.annotations.update(editingText.id, after);
                  history.record({ type: 'update', annotation: editingText, before, after });
                  setEditingText(null);
                  notify('Texto atualizado na partitura.');
                } catch (err) {
                  notify(`O texto não foi atualizado. ${errorText(err)}`, 'error');
                }
              } else if (textPoint) {
                if (await save([textPoint.point], 'text', textPoint.page, text.trim(), fontSize))
                  setTextPoint(undefined);
              }
            }}
          >
            <Field label="Texto">
              <input
                value={text}
                maxLength={160}
                onChange={e => setText(e.target.value)}
                autoFocus
                data-autofocus
                required
                placeholder="Ex.: 1–2–4 / atenção ao pedal"
              />
            </Field>
            <Field label="Tamanho da fonte">
              <input
                type="number"
                min={10}
                max={100}
                step={1}
                value={fontSize}
                onChange={e => setFontSize(Number(e.target.value))}
                required
              />
              <small>Entre 10 e 100, proporcional à largura da página.</small>
            </Field>
            <footer className="modal-actions">
              <button
                type="button"
                className="btn secondary"
                onClick={() => {
                  setTextPoint(undefined);
                  setEditingText(null);
                }}
              >
                Cancelar
              </button>
              <button
                className="btn"
                disabled={!text.trim() || !Number.isInteger(fontSize) || fontSize < 10 || fontSize > 100}
              >
                {editingText ? 'Salvar alterações' : 'Salvar anotação'}
              </button>
            </footer>
          </form>
        </Modal>
      )}
    </div>
  );
}
