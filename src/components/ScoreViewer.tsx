import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  ChevronLeft,
  ChevronRight,
  PenLine,
  Highlighter,
  Type,
  MousePointer2,
  Scan,
  Undo2,
  Redo2,
  ZoomIn,
  ZoomOut,
  Download,
  Eye,
  EyeOff,
  Eraser,
  Maximize2,
  Minimize2,
  Move,
} from 'lucide-react';
import { db } from '../db';
import { uid, now, type Score, type Annotation, type Point, type Region } from '../domain';
import { Modal, Field, ErrorBox, download, errorText, type Notify } from './common';
import { renderPdfPage } from '../pdf/render';
import { movePoints } from '../annotations';
type Tool = 'navigate' | 'select' | 'pen' | 'highlight' | 'text' | 'region' | 'erase';
const layers = ['Minhas notas', 'Professor', 'Dedilhado'];
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
}
export default function ScoreViewer({
  score,
  onRegion,
  targetRegion,
  notify,
  fullscreenOverlay,
}: ScoreViewerProps) {
  const asset = useLiveQuery(() => db.assets.get(score.assetId), [score.assetId]);
  const [page, setPage] = useState(1),
    [pages, setPages] = useState(1),
    [tool, setTool] = useState<Tool>('navigate');
  const [layer, setLayer] = useState(layers[0]),
    [color, setColor] = useState('#087e8b'),
    [hiddenLayers, setHiddenLayers] = useState<string[]>([]);
  const [zoom, setZoom] = useState(1),
    [ratio, setRatio] = useState(1.414),
    [width, setWidth] = useState(700),
    [error, setError] = useState(''),
    [loading, setLoading] = useState(false);
  const [draft, setDraft] = useState<Point[]>([]),
    [redo, setRedo] = useState<Annotation[]>([]),
    [textPoint, setTextPoint] = useState<Point>(),
    [text, setText] = useState(''),
    [fontSize, setFontSize] = useState(20);
  const [selectedId, setSelectedId] = useState<string | null>(null),
    [movePreview, setMovePreview] = useState<{ id: string; points: Point[] } | null>(null),
    [editingText, setEditingText] = useState<string | null>(null);
  const [focus, setFocus] = useState(false),
    [exporting, setExporting] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const viewer = useRef<HTMLDivElement>(null),
    canvas = useRef<HTMLCanvasElement>(null),
    container = useRef<HTMLDivElement>(null),
    svg = useRef<SVGSVGElement>(null),
    drawing = useRef<Point[]>([]);
  const pointer = useRef<number | null>(null);
  const moving = useRef<{ pointerId: number; annotation: Annotation; start: Point } | null>(null);
  const annotations =
    useLiveQuery(
      () => db.annotations.where('[scoreId+page]').equals([score.id, page]).toArray(),
      [score.id, page],
    ) ?? [];
  useEffect(() => {
    setPage(1);
    setRedo([]);
    setZoom(1);
    setError('');
    setSelectedId(null);
    setMovePreview(null);
  }, [score.id]);
  useEffect(() => {
    setSelectedId(null);
    setMovePreview(null);
    moving.current = null;
  }, [page]);
  useEffect(() => {
    if (targetRegion) {
      setPage(targetRegion.page);
      setFocus(true);
    }
  }, [targetRegion]);
  useEffect(() => {
    if (!container.current) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(240, entry.contentRect.width - 32)));
    observer.observe(container.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!fullscreen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onFullscreenChange = () => {
      if (!document.fullscreenElement) setFullscreen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (document.fullscreenElement === viewer.current) void document.exitFullscreen().catch(() => {});
        setFullscreen(false);
      }
    };
    document.addEventListener('fullscreenchange', onFullscreenChange);
    window.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('fullscreenchange', onFullscreenChange);
      window.removeEventListener('keydown', onKeyDown, true);
    };
  }, [fullscreen]);
  useEffect(() => {
    if (!asset || !canvas.current) return;
    const controller = new AbortController();
    let cleanup: (() => void) | undefined;
    setLoading(true);
    setError('');
    (async () => {
      try {
        const target = canvas.current!;
        if (asset.mime === 'application/pdf' || asset.name.toLowerCase().endsWith('.pdf')) {
          const rendered = await renderPdfPage({
            blob: asset.blob,
            canvas: target,
            page,
            width,
            zoom,
            signal: controller.signal,
          });
          if (controller.signal.aborted) return;
          setPages(rendered.pages);
          setRatio(rendered.ratio);
        } else {
          const url = URL.createObjectURL(asset.blob);
          cleanup = () => URL.revokeObjectURL(url);
          const image = new Image();
          image.src = url;
          await image.decode();
          if (controller.signal.aborted) return;
          setPages(1);
          setRatio(image.height / image.width);
          target.width = image.width;
          target.height = image.height;
          target.getContext('2d')!.drawImage(image, 0, 0);
        }
      } catch (err) {
        if (!controller.signal.aborted) setError(`Não foi possível exibir esta página. ${errorText(err)}`);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => {
      controller.abort();
      cleanup?.();
    };
  }, [asset, page, width, zoom, attempt]);
  const save = async (points: Point[], kind: Annotation['kind'], value?: string, size?: number) => {
    try {
      await db.annotations.add({
        id: uid(),
        scoreId: score.id,
        page,
        layer,
        kind,
        color,
        width: kind === 'highlight' ? 18 : 2.4,
        points,
        text: value,
        fontSize: kind === 'text' ? size : undefined,
        createdAt: now(),
      });
      setRedo([]);
    } catch (err) {
      notify(`A marcação não foi salva: ${errorText(err)}`);
    }
  };
  const point = (event: React.PointerEvent): Point => {
    const r = svg.current!.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(1, (event.clientX - r.left) / r.width)),
      y: Math.max(0, Math.min(1, (event.clientY - r.top) / r.height)),
      pressure: event.pressure,
    };
  };
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
    const points = movePoints(active.annotation.points, at.x - active.start.x, at.y - active.start.y);
    if (
      points.some((p, i) => p.x !== active.annotation.points[i].x || p.y !== active.annotation.points[i].y)
    ) {
      setMovePreview({ id: active.annotation.id, points });
      try {
        await db.annotations.update(active.annotation.id, { points });
        setRedo([]);
      } catch (err) {
        notify(`Não foi possível mover a anotação: ${errorText(err)}`);
      }
    }
    setMovePreview(null);
  };
  const region = targetRegion?.page === page ? targetRegion : undefined;
  // Focus uses a viewport crop of the original canvas and its matching SVG overlay.
  const crop =
    focus && region
      ? {
          x: Math.max(0, region.x - 0.025),
          y: Math.max(0, region.y - 0.025),
          w: Math.min(1 - region.x + 0.025, region.w + 0.05),
          h: Math.min(1 - region.y + 0.025, region.h + 0.05),
        }
      : null;
  const draftPath = draft.map((p, i) => `${i ? 'L' : 'M'}${p.x * 1000},${p.y * 1000}`).join(' ');
  const changePage = (next: number) => {
    setPage(next);
    setFocus(false);
    container.current?.scrollTo({ top: 0, left: 0 });
  };
  const toggleFullscreen = async () => {
    if (fullscreen) {
      if (document.fullscreenElement === viewer.current)
        try {
          await document.exitFullscreen();
        } catch {
          /* CSS mode remains available */
        }
      setFullscreen(false);
      return;
    }
    setFullscreen(true);
    if (viewer.current?.requestFullscreen)
      try {
        await viewer.current.requestFullscreen();
      } catch {
        /* CSS mode supports iPad Safari */
      }
  };
  const pageNavigation = (position: 'superior' | 'inferior') => (
    <>
      <button
        className="icon-btn"
        aria-label={`Página anterior (${position})`}
        disabled={page <= 1}
        onClick={() => changePage(page - 1)}
      >
        <ChevronLeft size={20} />
      </button>
      <span>
        Página {page} de {pages}
      </span>
      <button
        className="icon-btn"
        aria-label={`Próxima página (${position})`}
        disabled={page >= pages}
        onClick={() => changePage(page + 1)}
      >
        <ChevronRight size={20} />
      </button>
    </>
  );
  return (
    <div ref={viewer} className={`score-viewer ${fullscreen ? 'is-fullscreen' : ''}`}>
      {fullscreen && fullscreenOverlay && <div className="score-fullscreen-overlay">{fullscreenOverlay}</div>}
      <div className="score-tools">
        <div className="tool-group">
          {(
            [
              ['navigate', MousePointer2, 'Navegar'],
              ['select', Move, 'Selecionar e mover'],
              ['pen', PenLine, 'Caneta'],
              ['highlight', Highlighter, 'Marca-texto'],
              ['text', Type, 'Texto'],
              ['region', Scan, 'Marcar trecho'],
              ['erase', Eraser, 'Apagar marcação'],
            ] as const
          ).map(([key, Icon, label]) => (
            <button
              key={key}
              className={`icon-btn ${tool === key ? 'selected' : ''}`}
              title={label}
              aria-label={label}
              aria-pressed={tool === key}
              onClick={() => {
                setTool(key);
                if (focus) setFocus(false);
              }}
            >
              <Icon size={19} />
            </button>
          ))}
        </div>
        <div className="tool-group">
          <input
            type="color"
            aria-label="Cor da anotação"
            value={color}
            onChange={e => setColor(e.target.value)}
          />
          <select aria-label="Camada de anotação" value={layer} onChange={e => setLayer(e.target.value)}>
            {layers.map(l => (
              <option key={l}>{l}</option>
            ))}
          </select>
          <button
            className="icon-btn"
            aria-label={hiddenLayers.includes(layer) ? 'Mostrar camada ativa' : 'Ocultar camada ativa'}
            onClick={() =>
              setHiddenLayers(l => (l.includes(layer) ? l.filter(x => x !== layer) : [...l, layer]))
            }
          >
            {hiddenLayers.includes(layer) ? <EyeOff size={18} /> : <Eye size={18} />}
          </button>
        </div>
        <div className="tool-group">
          <button
            className="icon-btn"
            aria-label="Desfazer última anotação nesta camada"
            disabled={!annotations.some(a => a.layer === layer)}
            onClick={async () => {
              const last = annotations
                .filter(a => a.layer === layer)
                .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
                .at(-1);
              if (last)
                try {
                  await db.annotations.delete(last.id);
                  setRedo([...redo, last]);
                } catch (e) {
                  notify(errorText(e));
                }
            }}
          >
            <Undo2 size={18} />
          </button>
          <button
            className="icon-btn"
            aria-label="Refazer anotação"
            disabled={!redo.length}
            onClick={async () => {
              const a = redo.at(-1);
              if (a)
                try {
                  await db.annotations.put(a);
                  setRedo(redo.slice(0, -1));
                } catch (e) {
                  notify(errorText(e));
                }
            }}
          >
            <Redo2 size={18} />
          </button>
          <button
            className="icon-btn"
            aria-label="Exportar partitura anotada"
            disabled={!asset || exporting}
            onClick={async () => {
              if (!asset) return;
              setExporting(true);
              try {
                const { exportAnnotated } = await import('../score-export');
                download(
                  await exportAnnotated(
                    asset,
                    await db.annotations.where('scoreId').equals(score.id).toArray(),
                  ),
                  `${score.title.replace(/\.[^.]+$/, '')}-anotada.pdf`,
                );
              } catch (e) {
                notify(errorText(e));
              } finally {
                setExporting(false);
              }
            }}
          >
            <Download size={18} />
          </button>
        </div>
      </div>
      <div className="score-status">
        <span>
          {tool === 'region'
            ? 'Arraste um retângulo ao redor do trecho.'
            : tool === 'navigate'
              ? 'Leia a partitura. Selecione uma ferramenta para anotar.'
              : tool === 'select'
                ? 'Toque em uma anotação para selecioná-la e arraste para mover.'
                : tool === 'erase'
                  ? 'Toque na marcação da camada ativa para apagar.'
                  : `Anotando em ${layer} · dedo ou caneta`}
        </span>
        {region && (
          <button
            className="link-btn"
            onClick={() => {
              setFocus(!focus);
              setTool('navigate');
            }}
          >
            {focus ? 'Ver página inteira' : 'Focar no trecho'}
          </button>
        )}
      </div>
      <div className="page-controls page-controls-top">
        {pageNavigation('superior')}
        <div className="spacer" />
        <button
          className="btn small secondary score-fullscreen-button"
          aria-label={fullscreen ? 'Sair da tela cheia' : 'Tela cheia'}
          onClick={() => void toggleFullscreen()}
        >
          {fullscreen ? <Minimize2 size={17} /> : <Maximize2 size={17} />}
          <span>{fullscreen ? 'Sair da tela cheia' : 'Tela cheia'}</span>
        </button>
      </div>
      {tool === 'select' && (
        <div className="annotation-selection-bar">
          {selected ? (
            <>
              <span>Selecionada · {selected.layer}</span>
              {selected.kind === 'text' && (
                <button
                  className="btn small secondary"
                  onClick={() => {
                    setEditingText(selected.id);
                    setText(selected.text ?? '');
                    setFontSize(selected.fontSize ?? 20);
                  }}
                >
                  Editar texto e tamanho
                </button>
              )}
              <button className="link-btn" onClick={() => setSelectedId(null)}>
                Desmarcar
              </button>
            </>
          ) : (
            <span>Toque e arraste uma anotação.</span>
          )}
        </div>
      )}
      <ErrorBox message={error} />
      {error && (
        <div className="row" style={{ padding: 12 }}>
          <button className="btn secondary small" onClick={() => setAttempt(n => n + 1)}>
            Tentar novamente
          </button>
          <span className="hint">O arquivo original continua salvo.</span>
        </div>
      )}
      <div className="score-scroll" ref={container}>
        <div
          className="score-sheet"
          style={{
            width: width * zoom,
            height: crop ? (width * zoom * ratio * crop.h) / crop.w : width * zoom * ratio,
            overflow: 'hidden',
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
            <canvas ref={canvas} style={{ width: '100%', height: '100%', display: 'block' }} />
            <svg
              ref={svg}
              className="annotation-overlay"
              viewBox="0 0 1000 1000"
              preserveAspectRatio="none"
              style={{
                touchAction: tool === 'navigate' ? 'pan-x pan-y' : 'none',
                pointerEvents: focus ? 'none' : undefined,
              }}
              onPointerDown={e => {
                if (tool === 'navigate' || focus || pointer.current !== null) return;
                if (tool === 'erase') return;
                if (tool === 'select') {
                  setSelectedId(null);
                  return;
                }
                const p = point(e);
                if (tool === 'text') {
                  setTextPoint(p);
                  setText('');
                  setFontSize(20);
                  return;
                }
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
                if (moving.current?.pointerId === e.pointerId) void finishMove(e.pointerId, e, true);
                pointer.current = null;
                drawing.current = [];
                setDraft([]);
              }}
              onPointerUp={e => {
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
                  );
              }}
            >
              {annotations
                .filter(a => !hiddenLayers.includes(a.layer))
                .map(a => {
                  const points = movePreview?.id === a.id ? movePreview.points : a.points;
                  const path = points.map((p, i) => `${i ? 'L' : 'M'}${p.x * 1000},${p.y * 1000}`).join(' ');
                  const interactive = tool === 'select' || tool === 'erase';
                  return (
                    <g
                      key={a.id}
                      opacity={selectedId === a.id ? 1 : a.layer === layer ? 1 : 0.65}
                      onPointerDown={async e => {
                        if (tool === 'select') {
                          e.stopPropagation();
                          setSelectedId(a.id);
                          moving.current = { pointerId: e.pointerId, annotation: a, start: point(e) };
                          svg.current?.setPointerCapture(e.pointerId);
                        } else if (tool === 'erase' && a.layer === layer) {
                          e.stopPropagation();
                          try {
                            await db.annotations.delete(a.id);
                            setRedo([...redo, a]);
                            setSelectedId(null);
                          } catch (err) {
                            notify(errorText(err));
                          }
                        }
                      }}
                      style={{
                        pointerEvents: interactive ? 'auto' : 'none',
                        cursor: tool === 'select' ? 'grab' : tool === 'erase' ? 'pointer' : undefined,
                      }}
                    >
                      {a.kind === 'text' ? (
                        <text
                          x={points[0].x * 1000}
                          y={points[0].y * 1000}
                          fill={a.color}
                          fontSize={a.fontSize ?? 20}
                          fontFamily="sans-serif"
                          stroke="transparent"
                          strokeWidth={interactive ? 18 : 0}
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
                              strokeWidth={Math.max(18, a.width + 12)}
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
              {region && (
                <rect
                  x={region.x * 1000}
                  y={region.y * 1000}
                  width={region.w * 1000}
                  height={region.h * 1000}
                  fill="#e9af58"
                  fillOpacity=".12"
                  stroke="#bd8023"
                  strokeWidth="2"
                  strokeDasharray="8 4"
                />
              )}
              {tool === 'region' && draft.length > 1 ? (
                <rect
                  x={Math.min(draft[0].x, draft[1].x) * 1000}
                  y={Math.min(draft[0].y, draft[1].y) * 1000}
                  width={Math.abs(draft[0].x - draft[1].x) * 1000}
                  height={Math.abs(draft[0].y - draft[1].y) * 1000}
                  fill="#087e8b"
                  fillOpacity=".15"
                  stroke="#087e8b"
                  strokeWidth="2"
                />
              ) : (
                <path
                  d={draftPath}
                  stroke={color}
                  strokeWidth={tool === 'highlight' ? 18 : 2.4}
                  opacity={tool === 'highlight' ? 0.3 : 1}
                  strokeLinecap="round"
                  fill="none"
                />
              )}
            </svg>
          </div>
        </div>
      </div>
      <div className="page-controls">
        {pageNavigation('inferior')}
        <div className="spacer" />
        <button
          className="icon-btn"
          aria-label="Diminuir zoom"
          disabled={zoom <= 0.75}
          onClick={() => setZoom(Math.max(0.75, zoom - 0.25))}
        >
          <ZoomOut size={18} />
        </button>
        <span>{Math.round(zoom * 100)}%</span>
        <button
          className="icon-btn"
          aria-label="Aumentar zoom"
          disabled={zoom >= 2}
          onClick={() => setZoom(Math.min(2, zoom + 0.25))}
        >
          <ZoomIn size={18} />
        </button>
      </div>
      {(textPoint || editingText) && (
        <Modal
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
                try {
                  await db.annotations.update(editingText, { text: text.trim(), fontSize });
                  setEditingText(null);
                  notify('Texto atualizado na partitura.');
                } catch (err) {
                  notify(errorText(err));
                }
              } else if (textPoint) {
                await save([textPoint], 'text', text.trim(), fontSize);
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
              <small>Entre 10 e 100, proporcional ao tamanho da partitura.</small>
            </Field>
            <footer className="modal-actions">
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
