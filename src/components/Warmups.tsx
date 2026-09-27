import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  ArrowDown,
  ArrowUp,
  Check,
  FilePlus2,
  FileText,
  LayoutList,
  Pencil,
  Play,
  Shuffle,
  Trash2,
  X,
} from 'lucide-react';
import { db, removePiece } from '../db';
import {
  isWarmup,
  type Asset,
  type Piece,
  type Region,
  type ScaleMode,
  type Segment,
  type WarmupKind,
} from '../domain';
import { segmentStats, plural, relativeDay, type SegmentStats } from '../segment-stats';
import { titleFromFileName } from '../score-view';
import { inspectFile, pageExercises, type Inspection } from '../warmups/detect';
import {
  addExercise,
  addPageExercises,
  collectionRank,
  createCollection,
  deleteExercise,
  moveExercise,
  renameCollection,
  renameExercise,
  sortExercises,
  type CollectionSummary,
} from '../warmups/collections';
import { keyOrder, keySide, keySignature, modeLabels, signatureLabel, tonicName } from '../warmups/scales';
import {
  Empty,
  ErrorBox,
  Field,
  Modal,
  errorText,
  onTabListKeyDown,
  useConfirm,
  type Notify,
} from './common';
import ScoreViewer from './ScoreViewer';
import '../styles/warmups.css';

const LAST_KEY = 'compasso:warmup-last';
/** The exercise last opened in each collection, so coming back shows the same scale. */
function rememberedExercise(collectionId: string) {
  try {
    const saved = JSON.parse(localStorage.getItem(LAST_KEY) ?? '{}') as Record<string, string>;
    return typeof saved[collectionId] === 'string' ? saved[collectionId] : undefined;
  } catch {
    return undefined;
  }
}
function rememberExercise(collectionId: string, exerciseId: string) {
  try {
    const saved = JSON.parse(localStorage.getItem(LAST_KEY) ?? '{}') as Record<string, string>;
    localStorage.setItem(LAST_KEY, JSON.stringify({ ...saved, [collectionId]: exerciseId }));
  } catch {
    /* Blocked storage: the first exercise opens instead. */
  }
}

const kindLabels: Record<WarmupKind, string> = {
  scales: 'Escalas',
  etudes: 'Estudos (Czerny, Hanon…)',
  other: 'Outro',
};
const modeOrder: ScaleMode[] = ['major', 'natural-minor', 'harmonic-minor', 'melodic-minor'];
const scaleOf = (s: Segment) =>
  s.exercise?.tonic && s.exercise.mode ? { tonic: s.exercise.tonic, mode: s.exercise.mode } : undefined;

export default function Warmups({
  collectionId,
  exerciseId,
  onSelect,
  onPractice,
  notify,
}: {
  collectionId?: string;
  exerciseId?: string;
  onSelect: (collectionId?: string, exerciseId?: string) => void;
  onPractice: (segmentId: string) => void;
  notify: Notify;
}) {
  const confirm = useConfirm();
  const piecesQuery = useLiveQuery(() => db.pieces.toArray());
  const warmupIds = (piecesQuery ?? [])
    .filter(isWarmup)
    .map(p => p.id)
    .join(',');
  // Exercise count and scale modes per collection: the tabs show the count and follow collectionRank.
  const summariesQuery = useLiveQuery(
    async () =>
      new Map<string, CollectionSummary>(
        await Promise.all(
          warmupIds
            .split(',')
            .filter(Boolean)
            .map(async id => {
              const list = await db.segments.where('pieceId').equals(id).toArray();
              const modes = new Set(list.flatMap(s => (s.exercise?.mode ? [s.exercise.mode] : [])));
              return [id, { count: list.length, modes }] as const;
            }),
        ),
      ),
    [warmupIds],
  );
  const summaries = useMemo(() => summariesQuery ?? new Map<string, CollectionSummary>(), [summariesQuery]);
  const collections = useMemo(
    () =>
      (piecesQuery ?? [])
        .filter(isWarmup)
        .sort(
          (a, b) =>
            collectionRank(a, summaries.get(a.id)) - collectionRank(b, summaries.get(b.id)) ||
            a.createdAt.localeCompare(b.createdAt),
        ),
    [piecesQuery, summaries],
  );
  const active = collections.find(c => c.id === collectionId) ?? collections[0];
  const activeId = active?.id;
  const exercisesQuery = useLiveQuery(
    () => (activeId ? db.segments.where('pieceId').equals(activeId).toArray() : []),
    [activeId],
  );
  const exercises = useMemo(() => sortExercises(exercisesQuery ?? []), [exercisesQuery]);
  const remembered = activeId ? rememberedExercise(activeId) : undefined;
  const selected =
    exercises.find(e => e.id === exerciseId) ?? exercises.find(e => e.id === remembered) ?? exercises[0];
  const selectedId = selected?.id;
  useEffect(() => {
    if (activeId && selectedId) rememberExercise(activeId, selectedId);
  }, [activeId, selectedId]);
  const sessions = useLiveQuery(
    () => (activeId ? db.sessions.where('pieceId').equals(activeId).toArray() : []),
    [activeId],
  );
  const stats = useMemo(() => segmentStats(sessions ?? []), [sessions]);
  const score = useLiveQuery(async () => {
    if (!activeId) return undefined;
    if (selected?.scoreId) {
      const own = await db.scores.get(selected.scoreId);
      if (own) return own;
    }
    return (await db.scores.where('pieceId').equals(activeId).sortBy('createdAt'))[0];
  }, [activeId, selected?.scoreId]);
  const asset = useLiveQuery(() => (score ? db.assets.get(score.assetId) : undefined), [score?.assetId]);

  const [importing, setImporting] = useState(false),
    [editing, setEditing] = useState(false),
    [renaming, setRenaming] = useState<{ kind: 'collection' | 'exercise'; id: string; title: string } | null>(
      null,
    );
  const tabIds = useId();
  useEffect(() => setEditing(false), [activeId]);

  if (piecesQuery === undefined) return null;
  const choose = (id: string) => onSelect(activeId, id);
  const isScales = exercises.some(e => scaleOf(e));

  const shuffle = () => {
    if (!selected) return;
    // Same form (for scales) and never the one on screen; the least recently practised are the likeliest.
    const mode = scaleOf(selected)?.mode;
    const pool = exercises.filter(e => e.id !== selected.id && (!mode || scaleOf(e)?.mode === mode));
    if (!pool.length) return;
    const byAge = [...pool].sort((a, b) =>
      (stats.get(a.id)?.lastAt ?? '').localeCompare(stats.get(b.id)?.lastAt ?? ''),
    );
    const pick = byAge[Math.floor(Math.random() * Math.min(3, byAge.length))];
    choose(pick.id);
  };

  const removeCollection = async (collection: Piece) => {
    const ok = await confirm({
      title: 'Excluir coleção?',
      message: `Excluir “${collection.title}” e o PDF importado? O histórico das sessões de prática continua em Evolução.`,
      confirmLabel: 'Excluir coleção',
      danger: true,
    });
    if (!ok) return;
    try {
      await removePiece(collection.id);
      onSelect(undefined);
      notify('Coleção excluída.');
    } catch (err) {
      notify(`Não foi possível excluir a coleção. ${errorText(err)}`, 'error');
    }
  };
  const removeExercise = async (exercise: Segment) => {
    const ok = await confirm({
      title: 'Excluir exercício?',
      message: `Excluir “${exercise.title}” desta coleção? O PDF e o histórico de prática continuam salvos.`,
      confirmLabel: 'Excluir exercício',
      danger: true,
    });
    if (!ok) return;
    try {
      await deleteExercise(exercise.id);
      notify('Exercício excluído.');
    } catch (err) {
      notify(`Não foi possível excluir o exercício. ${errorText(err)}`, 'error');
    }
  };

  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">ANTES DO REPERTÓRIO</span>
          <h1>Aquecimento</h1>
          <p>Escalas e estudos para despertar as mãos.</p>
        </div>
        <button className="btn secondary" onClick={() => setImporting(true)}>
          <FilePlus2 size={17} />
          Importar PDF
        </button>
      </div>
      {!collections.length ? (
        <section className="panel">
          <Empty
            title="Seu aquecimento começa aqui"
            text="Importe um PDF de escalas ou de estudos (Czerny, Hanon…). Livros de escalas conhecidos, ou com o nome de cada escala no texto, são divididos sozinhos; nos outros, você marca cada exercício na partitura."
            action={
              <button className="btn" onClick={() => setImporting(true)}>
                <FilePlus2 size={17} />
                Importar PDF
              </button>
            }
          />
        </section>
      ) : (
        <>
          <div
            className="tabs warmup-tabs"
            role="tablist"
            aria-label="Coleções de aquecimento"
            onKeyDown={onTabListKeyDown}
          >
            {collections.map(c => (
              <button
                key={c.id}
                id={`${tabIds}-${c.id}`}
                type="button"
                role="tab"
                aria-selected={c.id === activeId}
                aria-controls={`${tabIds}-panel`}
                tabIndex={c.id === activeId ? 0 : -1}
                className={c.id === activeId ? 'active' : ''}
                onClick={() => onSelect(c.id)}
              >
                {c.title}
                <span>{summaries.get(c.id)?.count ?? '…'}</span>
              </button>
            ))}
          </div>
          {active && (
            <section
              id={`${tabIds}-panel`}
              role="tabpanel"
              aria-labelledby={`${tabIds}-${active.id}`}
              className="warmup-panel"
            >
              {editing && score ? (
                <CollectionEditor
                  collection={active}
                  scoreId={score.id}
                  asset={asset}
                  exercises={exercises}
                  onDone={() => setEditing(false)}
                  notify={notify}
                />
              ) : (
                <div className="warmup-layout">
                  <div className="panel warmup-picker">
                    {isScales ? (
                      <ScalePicker
                        exercises={exercises}
                        selected={selected}
                        stats={stats}
                        onChoose={choose}
                      />
                    ) : (
                      <ExerciseChips
                        exercises={exercises}
                        selected={selected}
                        stats={stats}
                        onChoose={choose}
                      />
                    )}
                    <div className="warmup-collection-actions">
                      <button className="link-btn" onClick={() => setEditing(true)} disabled={!score}>
                        <LayoutList size={15} />
                        Organizar exercícios
                      </button>
                      <button
                        className="link-btn"
                        onClick={() =>
                          setRenaming({ kind: 'collection', id: active.id, title: active.title })
                        }
                      >
                        <Pencil size={15} />
                        Renomear coleção
                      </button>
                      <button className="link-btn danger-link" onClick={() => void removeCollection(active)}>
                        <Trash2 size={15} />
                        Excluir coleção
                      </button>
                    </div>
                  </div>
                  {selected ? (
                    <ExerciseCard
                      collection={active}
                      exercise={selected}
                      asset={asset}
                      stats={stats.get(selected.id)}
                      canShuffle={exercises.length > 1}
                      onPractice={() => onPractice(selected.id)}
                      onShuffle={shuffle}
                      onRename={() =>
                        setRenaming({ kind: 'exercise', id: selected.id, title: selected.title })
                      }
                      onDelete={() => void removeExercise(selected)}
                    />
                  ) : (
                    <section className="panel">
                      <Empty
                        title="Nenhum exercício ainda"
                        text="Marque cada exercício na partitura ou comece com um exercício por página."
                        action={
                          <button className="btn" onClick={() => setEditing(true)} disabled={!score}>
                            <LayoutList size={17} />
                            Organizar exercícios
                          </button>
                        }
                      />
                    </section>
                  )}
                </div>
              )}
            </section>
          )}
        </>
      )}
      {importing && (
        <ImportDialog
          collections={collections}
          onClose={() => setImporting(false)}
          onImported={(created, failure) => {
            setImporting(false);
            if (failure) notify(failure, 'error');
            const first = created[0];
            if (!first) return;
            onSelect(first.id);
            if (first.manual) setEditing(true);
            const total = created.reduce((sum, c) => sum + c.exercises, 0);
            notify(
              created.length === 1
                ? first.exercises
                  ? `${first.title}: ${plural(first.exercises, 'exercício pronto', 'exercícios prontos')}.`
                  : `${first.title} importado. Marque os exercícios na partitura.`
                : `${plural(created.length, 'coleção importada', 'coleções importadas')}, ${plural(total, 'exercício', 'exercícios')}.`,
            );
          }}
        />
      )}
      {renaming && (
        <Modal
          title={renaming.kind === 'collection' ? 'Renomear coleção' : 'Renomear exercício'}
          onClose={() => setRenaming(null)}
          guard
        >
          <form
            onSubmit={async e => {
              e.preventDefault();
              if (!renaming.title.trim()) return;
              try {
                if (renaming.kind === 'collection') await renameCollection(renaming.id, renaming.title);
                else await renameExercise(renaming.id, renaming.title);
                setRenaming(null);
              } catch (err) {
                notify(`Não foi possível renomear. ${errorText(err)}`, 'error');
              }
            }}
          >
            <Field label="Nome">
              <input
                data-autofocus
                required
                maxLength={160}
                value={renaming.title}
                onChange={e => setRenaming({ ...renaming, title: e.target.value })}
              />
            </Field>
            <footer className="modal-actions">
              <button type="button" className="btn secondary" onClick={() => setRenaming(null)}>
                Cancelar
              </button>
              <button className="btn" disabled={!renaming.title.trim()}>
                Salvar
              </button>
            </footer>
          </form>
        </Modal>
      )}
    </>
  );
}

/** Practised in the last two days: a small mark on the chip, so today's rotation is easy to follow. */
const recent = (stats?: SegmentStats) =>
  !!stats && Date.now() - Date.parse(stats.lastAt) < 2 * 24 * 60 * 60 * 1000;

function ScalePicker({
  exercises,
  selected,
  stats,
  onChoose,
}: {
  exercises: Segment[];
  selected?: Segment;
  stats: Map<string, SegmentStats>;
  onChoose: (id: string) => void;
}) {
  const scales = exercises.filter(e => scaleOf(e));
  const modes = modeOrder.filter(m => scales.some(e => scaleOf(e)!.mode === m));
  const current = selected && scaleOf(selected);
  const mode = current && modes.includes(current.mode) ? current.mode : modes[0];
  const inMode = scales
    .filter(e => scaleOf(e)!.mode === mode)
    .sort((a, b) => keyOrder(scaleOf(a)!.tonic, mode) - keyOrder(scaleOf(b)!.tonic, mode));
  const pickMode = (next: ScaleMode) => {
    const same = scales.find(e => scaleOf(e)!.mode === next && scaleOf(e)!.tonic === current?.tonic);
    const target = same ?? scales.find(e => scaleOf(e)!.mode === next);
    if (target) onChoose(target.id);
  };
  const rows = (
    [
      ['sharps', 'Sustenidos'],
      ['flats', 'Bemóis'],
    ] as const
  )
    .map(([side, label]) => ({ label, items: inMode.filter(e => keySide(scaleOf(e)!.tonic, mode) === side) }))
    .filter(r => r.items.length);
  const mixed = modes.includes('major') && modes.length > 1;
  return (
    <div className="scale-picker">
      {modes.length > 1 && (
        <div className="hand-switch warmup-modes" role="group" aria-label="Forma da escala">
          {modes.map(m => (
            <button
              key={m}
              aria-pressed={m === mode}
              className={m === mode ? 'active' : ''}
              onClick={() => pickMode(m)}
            >
              {mixed && m !== 'major' ? `Menor ${modeLabels[m].toLowerCase()}` : modeLabels[m]}
            </button>
          ))}
        </div>
      )}
      {rows.map(row => (
        <div key={row.label} className="key-row">
          <span className="key-row-label">{row.label}</span>
          <div className="key-chips">
            {row.items.map(e => {
              const { tonic } = scaleOf(e)!;
              const count = keySignature(tonic, mode);
              const on = e.id === selected?.id;
              return (
                <button
                  key={e.id}
                  className={`key-chip ${on ? 'active' : ''}`}
                  aria-pressed={on}
                  aria-label={`${e.title}, ${signatureLabel(count)}${recent(stats.get(e.id)) ? ', praticada recentemente' : ''}`}
                  onClick={() => onChoose(e.id)}
                >
                  <strong>{tonicName(tonic)}</strong>
                  <small aria-hidden="true">{count ? signatureLabel(count) : '—'}</small>
                  {recent(stats.get(e.id)) && <span className="key-dot" aria-hidden="true" />}
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

function ExerciseChips({
  exercises,
  selected,
  stats,
  onChoose,
}: {
  exercises: Segment[];
  selected?: Segment;
  stats: Map<string, SegmentStats>;
  onChoose: (id: string) => void;
}) {
  if (!exercises.length) return <p className="hint">Esta coleção ainda não tem exercícios marcados.</p>;
  return (
    <div className="key-chips exercise-chips">
      {exercises.map(e => {
        const on = e.id === selected?.id;
        return (
          <button
            key={e.id}
            className={`key-chip ${on ? 'active' : ''}`}
            aria-pressed={on}
            aria-label={`${e.title}${recent(stats.get(e.id)) ? ', praticado recentemente' : ''}`}
            onClick={() => onChoose(e.id)}
          >
            <strong>{e.title}</strong>
            {recent(stats.get(e.id)) && <span className="key-dot" aria-hidden="true" />}
          </button>
        );
      })}
    </div>
  );
}

function statsLine(stats?: SegmentStats) {
  if (!stats) return 'Ainda não praticado.';
  const parts = [plural(stats.count, 'sessão', 'sessões'), `última ${relativeDay(stats.lastAt)}`];
  if (stats.lastBpm)
    parts.push(
      stats.bestBpm && stats.bestBpm > stats.lastBpm
        ? `${stats.lastBpm} BPM (melhor ${stats.bestBpm})`
        : `${stats.lastBpm} BPM`,
    );
  return parts.join(' · ');
}

function ExerciseCard({
  collection,
  exercise,
  asset,
  stats,
  canShuffle,
  onPractice,
  onShuffle,
  onRename,
  onDelete,
}: {
  collection: Piece;
  exercise: Segment;
  asset?: Asset;
  stats?: SegmentStats;
  canShuffle: boolean;
  onPractice: () => void;
  onShuffle: () => void;
  onRename: () => void;
  onDelete: () => void;
}) {
  const titleId = useId();
  const scale = scaleOf(exercise);
  const region = exercise.regions[0];
  const meta = [
    scale ? signatureLabel(keySignature(scale.tonic, scale.mode)) : '',
    exercise.goal,
    !scale && region ? `página ${region.page}` : '',
  ].filter(Boolean);
  return (
    <article className="panel warmup-card" aria-labelledby={titleId}>
      <header className="warmup-card-head">
        <div>
          <span className="eyebrow">{collection.title.toLocaleUpperCase('pt-BR')}</span>
          <h2 id={titleId}>{exercise.title}</h2>
          {meta.length > 0 && <p className="hint">{meta.join(' · ')}</p>}
        </div>
        <div className="warmup-card-actions">
          <button className="btn" aria-label={`Praticar ${exercise.title}`} onClick={onPractice}>
            <Play size={17} fill="currentColor" />
            Praticar
          </button>
          {canShuffle && (
            <button className="btn secondary" onClick={onShuffle}>
              <Shuffle size={17} />
              Sortear
            </button>
          )}
        </div>
      </header>
      {asset && region ? (
        <RegionPreview asset={asset} region={region} label={`Partitura: ${exercise.title}`} />
      ) : (
        <p className="hint">Este exercício ainda não tem um trecho marcado na partitura.</p>
      )}
      <footer className="warmup-card-foot">
        <p className="warmup-stats">{statsLine(stats)}</p>
        <div className="row">
          <button className="link-btn" onClick={onRename}>
            <Pencil size={15} />
            Renomear
          </button>
          <button className="link-btn danger-link" onClick={onDelete}>
            <Trash2 size={15} />
            Excluir
          </button>
        </div>
      </footer>
    </article>
  );
}

/** Keeps the canvas memory of a crop bounded on tablets. */
const MAX_PIXELS = 6_000_000;

/** Renders only the marked region of a page, at the width it is shown, on white paper in both themes. */
function RegionPreview({ asset, region, label }: { asset: Asset; region: Region; label: string }) {
  const box = useRef<HTMLDivElement>(null),
    canvas = useRef<HTMLCanvasElement>(null);
  const [width, setWidth] = useState(0),
    [error, setError] = useState(''),
    [loading, setLoading] = useState(true);
  const pdf = asset.mime === 'application/pdf' || /\.pdf$/i.test(asset.name);
  // One parsed document per file while the screen is open; choosing another scale only renders a new crop.
  const [handle, setHandle] = useState<import('../pdf/render').PdfHandle | null>(null);
  useEffect(() => {
    if (!pdf) return;
    let alive = true,
      opened: import('../pdf/render').PdfHandle | undefined;
    void import('../pdf/render').then(({ openPdf }) => {
      if (!alive) return;
      opened = openPdf(asset.blob);
      setHandle(opened);
    });
    return () => {
      alive = false;
      opened?.close();
      setHandle(null);
    };
  }, [asset, pdf]);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.round(entry.contentRect.width / 8) * 8));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const { page: pageNo, x, y, w, h } = region;
  useEffect(() => {
    const target = canvas.current;
    if (!width || !target || (pdf && !handle)) return;
    const controller = new AbortController();
    setLoading(true);
    setError('');
    (async () => {
      const dpr = Math.min(globalThis.devicePixelRatio || 1, 2);
      const buffer = document.createElement('canvas');
      if (pdf && handle) {
        const doc = await handle.promise;
        const page = await doc.getPage(Math.min(pageNo, doc.numPages));
        try {
          const base = page.getViewport({ scale: 1 });
          let scale = (width * dpr) / (w * base.width);
          const pixels = w * base.width * scale * (h * base.height * scale);
          if (pixels > MAX_PIXELS) scale *= Math.sqrt(MAX_PIXELS / pixels);
          const viewport = page.getViewport({
            scale,
            offsetX: -x * base.width * scale,
            offsetY: -y * base.height * scale,
          });
          buffer.width = Math.max(1, Math.round(w * base.width * scale));
          buffer.height = Math.max(1, Math.round(h * base.height * scale));
          const task = page.render({ canvas: buffer, viewport });
          controller.signal.addEventListener('abort', () => task.cancel(), { once: true });
          await task.promise;
        } finally {
          page.cleanup();
        }
      } else {
        const bitmap = await createImageBitmap(asset.blob);
        try {
          const sx = x * bitmap.width,
            sy = y * bitmap.height,
            sw = w * bitmap.width,
            sh = h * bitmap.height;
          const scale = Math.min((width * dpr) / sw, 1.5);
          buffer.width = Math.max(1, Math.round(sw * scale));
          buffer.height = Math.max(1, Math.round(sh * scale));
          buffer.getContext('2d')!.drawImage(bitmap, sx, sy, sw, sh, 0, 0, buffer.width, buffer.height);
        } finally {
          bitmap.close();
        }
      }
      if (controller.signal.aborted) return;
      target.width = buffer.width;
      target.height = buffer.height;
      target.getContext('2d')!.drawImage(buffer, 0, 0);
      buffer.width = buffer.height = 0;
      setLoading(false);
    })().catch(err => {
      if (controller.signal.aborted) return;
      setLoading(false);
      setError(`Não foi possível mostrar este trecho. ${errorText(err)}`);
    });
    return () => controller.abort();
  }, [asset, pdf, handle, width, pageNo, x, y, w, h]);
  return (
    <div ref={box} className={`region-preview ${loading ? 'is-loading' : ''}`}>
      <canvas ref={canvas} role="img" aria-label={label} />
      {loading && !error && <span className="loading-label">Carregando…</span>}
      <ErrorBox message={error} />
    </div>
  );
}

function CollectionEditor({
  collection,
  scoreId,
  asset,
  exercises,
  onDone,
  notify,
}: {
  collection: Piece;
  scoreId: string;
  asset?: Asset;
  exercises: Segment[];
  onDone: () => void;
  notify: Notify;
}) {
  const confirm = useConfirm();
  const score = useLiveQuery(() => db.scores.get(scoreId), [scoreId]);
  // Each new mark re-selects the region tool, so a book can be marked exercise after exercise.
  const [regionRequest, setRegionRequest] = useState(0),
    [focused, setFocused] = useState<string>(),
    [drafts, setDrafts] = useState<Record<string, string>>({}),
    [busy, setBusy] = useState(false);
  // The viewer selects the tool when the number changes after it mounts (it mounts once the score loads):
  // the editor opens ready to mark.
  const loaded = !!score;
  useEffect(() => {
    if (loaded) setRegionRequest(n => n || 1);
  }, [loaded]);
  const commitTitle = async (exercise: Segment) => {
    const title = drafts[exercise.id];
    if (title === undefined) return;
    setDrafts(({ [exercise.id]: _done, ...rest }) => rest);
    if (!title.trim() || title.trim() === exercise.title) return;
    try {
      await renameExercise(exercise.id, title);
    } catch (err) {
      notify(`Não foi possível renomear. ${errorText(err)}`, 'error');
    }
  };
  const splitPages = async () => {
    if (!asset) return;
    setBusy(true);
    try {
      let pages = 1;
      if (asset.mime === 'application/pdf' || /\.pdf$/i.test(asset.name)) {
        const { openPdf } = await import('../pdf/render');
        const handle = openPdf(asset.blob);
        try {
          pages = (await handle.promise).numPages;
        } finally {
          handle.close();
        }
      }
      await addPageExercises(collection, scoreId, pages);
      notify(plural(pages, 'exercício criado', 'exercícios criados') + ', um por página.');
    } catch (err) {
      notify(`Não foi possível dividir por página. ${errorText(err)}`, 'error');
    } finally {
      setBusy(false);
    }
  };
  if (!score) return null;
  return (
    <div className="warmup-editor">
      <div className="warmup-editor-head">
        <div>
          <h2>Organizar exercícios</h2>
          <p className="hint">
            Com a ferramenta <strong>Trecho</strong>, desenhe um retângulo em volta de cada exercício. Os
            nomes e a ordem podem ser ajustados na lista.
          </p>
        </div>
        <div className="row wrap">
          {!exercises.length && (
            <button className="btn secondary" disabled={busy} onClick={() => void splitPages()}>
              <FileText size={16} />
              Um exercício por página
            </button>
          )}
          <button className="btn" onClick={onDone}>
            <Check size={17} />
            Concluir
          </button>
        </div>
      </div>
      <div className="warmup-editor-body">
        <section className="score-card">
          <ScoreViewer
            score={score}
            notify={notify}
            requestRegion={regionRequest}
            regionPrompt="Desenhe um retângulo em volta do próximo exercício."
            segments={exercises.map(e => ({ id: e.id, title: e.title, regions: e.regions }))}
            onSegmentClick={setFocused}
            onRegion={async region => {
              try {
                const created = await addExercise(collection, scoreId, region);
                setFocused(created.id);
                setRegionRequest(n => n + 1);
                notify(`${created.title} marcado.`);
              } catch (err) {
                notify(`Não foi possível criar o exercício. ${errorText(err)}`, 'error');
              }
            }}
          />
        </section>
        <aside className="panel warmup-editor-list">
          <h3>{plural(exercises.length, 'exercício', 'exercícios')}</h3>
          {exercises.length ? (
            <ol>
              {exercises.map((e, i) => (
                <li key={e.id} className={focused === e.id ? 'focused' : ''}>
                  <input
                    aria-label={`Nome do exercício ${i + 1}`}
                    value={drafts[e.id] ?? e.title}
                    maxLength={160}
                    onFocus={() => setFocused(e.id)}
                    onChange={ev => setDrafts(d => ({ ...d, [e.id]: ev.target.value }))}
                    onBlur={() => void commitTitle(e)}
                    onKeyDown={ev => {
                      if (ev.key === 'Enter') ev.currentTarget.blur();
                    }}
                  />
                  <button
                    className="icon-btn"
                    aria-label={`Subir ${e.title}`}
                    disabled={i === 0}
                    onClick={() => void moveExercise(exercises, i, -1)}
                  >
                    <ArrowUp size={16} />
                  </button>
                  <button
                    className="icon-btn"
                    aria-label={`Descer ${e.title}`}
                    disabled={i === exercises.length - 1}
                    onClick={() => void moveExercise(exercises, i, 1)}
                  >
                    <ArrowDown size={16} />
                  </button>
                  <button
                    className="icon-btn subtle"
                    aria-label={`Excluir ${e.title}`}
                    onClick={async () => {
                      const ok = await confirm({
                        title: 'Excluir exercício?',
                        message: `Excluir “${e.title}”? O histórico de prática continua salvo.`,
                        confirmLabel: 'Excluir',
                        danger: true,
                      });
                      if (!ok) return;
                      try {
                        await deleteExercise(e.id);
                      } catch (err) {
                        notify(`Não foi possível excluir. ${errorText(err)}`, 'error');
                      }
                    }}
                  >
                    <Trash2 size={15} />
                  </button>
                </li>
              ))}
            </ol>
          ) : (
            <p className="hint">Nenhum exercício marcado ainda.</p>
          )}
        </aside>
      </div>
    </div>
  );
}

interface Pending {
  key: string;
  file: File;
  inspection?: Inspection;
  error?: string;
  title: string;
  kind: WarmupKind;
  split: 'pages' | 'manual';
  include: boolean;
  duplicateOf?: string;
}
export interface ImportedCollection {
  id: string;
  title: string;
  exercises: number;
  /** Imported without a split: the student marks the exercises next. */
  manual: boolean;
}

const accepted = ['application/pdf', 'image/png', 'image/jpeg', 'image/webp'];

function ImportDialog({
  collections,
  onClose,
  onImported,
}: {
  collections: Piece[];
  onClose: () => void;
  /** failure: an error that stopped the import after some collections were already created. */
  onImported: (created: ImportedCollection[], failure?: string) => void;
}) {
  const [items, setItems] = useState<Pending[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const update = (key: string, patch: Partial<Pending>) =>
    setItems(list => list.map(i => (i.key === key ? { ...i, ...patch } : i)));
  const add = (files: FileList | null) => {
    setError('');
    for (const file of files ? [...files] : []) {
      const key = `${file.name}-${file.size}-${file.lastModified}-${Math.random()}`;
      if (!accepted.includes(file.type) && !/\.pdf$/i.test(file.name)) {
        setError(`“${file.name}” não é um PDF nem uma imagem.`);
        continue;
      }
      setItems(list => [
        ...list,
        { key, file, title: titleFromFileName(file.name), kind: 'etudes', split: 'pages', include: true },
      ]);
      inspectFile(file)
        .then(inspection => {
          const d = inspection.detection;
          const duplicate = collections.find(
            c => !!inspection.sha256 && c.warmup?.fingerprint === inspection.sha256,
          );
          update(key, {
            inspection,
            title: d.kind === 'known' ? d.layout.title : (inspection.title ?? titleFromFileName(file.name)),
            kind: d.kind === 'none' ? 'etudes' : 'scales',
            duplicateOf: duplicate?.title,
            include: !duplicate,
          });
        })
        .catch(err =>
          update(key, { error: `Não foi possível ler o arquivo. ${errorText(err)}`, include: false }),
        );
    }
  };
  const ready = items.filter(i => i.include && i.inspection && !i.error && i.title.trim());
  const reading = items.some(i => !i.inspection && !i.error);
  const run = async () => {
    setBusy(true);
    setError('');
    const created: ImportedCollection[] = [];
    try {
      for (const item of ready) {
        const inspection = item.inspection!;
        const d = inspection.detection;
        const drafts =
          d.kind !== 'none'
            ? d.exercises
            : item.split === 'pages'
              ? pageExercises(inspection.pages, item.kind)
              : [];
        const id = await createCollection({
          file: item.file,
          title: item.title,
          kind: d.kind === 'none' ? item.kind : 'scales',
          fingerprint: inspection.sha256 || undefined,
          source: d.kind === 'known' ? d.layout.source : undefined,
          drafts,
        });
        created.push({ id, title: item.title.trim(), exercises: drafts.length, manual: !drafts.length });
      }
      onImported(created);
    } catch (err) {
      const message = `Não foi possível importar. ${errorText(err)}`;
      // What was already imported stays; the dialog closes on it and the error goes to a notice.
      if (created.length) onImported(created, message);
      else setError(message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title="Importar para o aquecimento" onClose={onClose} guard wide>
      <p className="hint">
        PDFs de escalas conhecidos, ou com o nome de cada escala no texto, são divididos sozinhos. Os outros
        podem ser divididos por página ou marcados na partitura depois. Os arquivos ficam só neste
        dispositivo.
      </p>
      <label className="btn secondary file-button import-picker">
        <FilePlus2 size={17} />
        {items.length ? 'Adicionar outro arquivo' : 'Escolher PDFs ou imagens'}
        <input
          type="file"
          accept="application/pdf,image/png,image/jpeg,image/webp"
          multiple
          onChange={e => {
            add(e.target.files);
            e.target.value = '';
          }}
        />
      </label>
      {items.length > 0 && (
        <ul className="import-list">
          {items.map(item => {
            const d = item.inspection?.detection;
            return (
              <li key={item.key} className="import-item">
                <div className="import-file">
                  <FileText size={18} aria-hidden="true" />
                  <strong>{item.file.name}</strong>
                  <button
                    type="button"
                    className="icon-btn subtle"
                    aria-label={`Remover ${item.file.name} da lista`}
                    onClick={() => setItems(list => list.filter(i => i.key !== item.key))}
                  >
                    <X size={16} />
                  </button>
                </div>
                {item.error ? (
                  <ErrorBox message={item.error} />
                ) : !item.inspection ? (
                  <p className="hint" role="status">
                    Analisando o arquivo…
                  </p>
                ) : d?.kind === 'known' ? (
                  <p className="import-found">
                    <Check size={16} aria-hidden="true" />
                    Reconhecido: {plural(d.exercises.length, 'escala', 'escalas')} de {d.layout.source}.
                  </p>
                ) : d?.kind === 'labels' ? (
                  <p className="import-found">
                    <Check size={16} aria-hidden="true" />
                    Encontramos {plural(d.exercises.length, 'escala', 'escalas')} pelos títulos do PDF.
                  </p>
                ) : (
                  <div className="import-options">
                    <p className="hint">
                      Não reconhecemos a divisão deste arquivo (
                      {plural(item.inspection.pages, 'página', 'páginas')}
                      ).
                    </p>
                    <Field label="Tipo">
                      <select
                        value={item.kind}
                        onChange={e => update(item.key, { kind: e.target.value as WarmupKind })}
                      >
                        {(Object.keys(kindLabels) as WarmupKind[]).map(k => (
                          <option key={k} value={k}>
                            {kindLabels[k]}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <fieldset className="import-split">
                      <legend>Como dividir</legend>
                      <label>
                        <input
                          type="radio"
                          name={`split-${item.key}`}
                          checked={item.split === 'pages'}
                          onChange={() => update(item.key, { split: 'pages' })}
                        />
                        Um exercício por página
                      </label>
                      <label>
                        <input
                          type="radio"
                          name={`split-${item.key}`}
                          checked={item.split === 'manual'}
                          onChange={() => update(item.key, { split: 'manual' })}
                        />
                        Vou marcar cada exercício na partitura
                      </label>
                    </fieldset>
                  </div>
                )}
                {item.duplicateOf && (
                  <label className="import-duplicate">
                    <input
                      type="checkbox"
                      checked={item.include}
                      onChange={e => update(item.key, { include: e.target.checked })}
                    />
                    Você já importou este arquivo em “{item.duplicateOf}”. Importar mesmo assim
                  </label>
                )}
                {item.inspection && !item.error && (
                  <Field label="Nome da coleção">
                    <input
                      value={item.title}
                      maxLength={160}
                      required
                      onChange={e => update(item.key, { title: e.target.value })}
                    />
                  </Field>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <ErrorBox message={error} />
      <footer className="modal-actions">
        <button type="button" className="btn secondary" onClick={onClose}>
          Cancelar
        </button>
        <button className="btn" disabled={busy || reading || !ready.length} onClick={() => void run()}>
          {busy ? 'Importando…' : ready.length > 1 ? `Importar ${ready.length} arquivos` : 'Importar'}
        </button>
      </footer>
    </Modal>
  );
}
