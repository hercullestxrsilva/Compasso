import { useEffect, useId, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  ArrowLeft,
  Plus,
  Play,
  Pencil,
  MessageSquare,
  FileUp,
  FileMusic,
  Check,
  Trash2,
  Focus,
  CalendarDays,
  Layers,
  SquareDashed,
} from 'lucide-react';
import { db, storeAsset } from '../db';
import {
  now,
  uid,
  hands,
  statuses,
  localDay,
  formatDate,
  type Segment,
  type Region,
  type Hand,
  type Score,
} from '../domain';
import { Modal, Field, Empty, Badge, ErrorBox, errorText, useConfirm, type Notify } from './common';
import { PieceForm } from './Library';
import ScoreViewer from './ScoreViewer';
import { forgetHistory } from '../annotation-history';
import { forgetViewState, loadLastScore, saveLastScore, titleFromFileName } from '../score-view';
import { plural, ratingLabels, relativeDay, segmentStats, type SegmentStats } from '../segment-stats';
import '../styles/score.css';

const scoreTypes = ['application/pdf', 'image/png', 'image/jpeg', 'image/webp'];

export function SegmentForm({
  pieceId,
  scoreId,
  region,
  segment,
  onClose,
  onSaved,
}: {
  pieceId: string;
  scoreId: string;
  region?: Region;
  segment?: Segment;
  onClose: () => void;
  onSaved: (id: string) => void;
}) {
  const [title, setTitle] = useState(segment?.title ?? ''),
    [measures, setMeasures] = useState(segment?.measures ?? ''),
    [goal, setGoal] = useState(segment?.goal ?? '');
  const [difficulty, setDifficulty] = useState(segment?.difficulty ?? 'Ritmo'),
    [hand, setHand] = useState<Hand>(segment?.hand ?? 'both'),
    [bpm, setBpm] = useState(segment?.bpm ?? 60);
  const [review, setReview] = useState(segment?.reviewDate ?? ''),
    [error, setError] = useState('');
  return (
    <Modal guard title={segment ? 'Editar trecho' : 'Novo trecho de estudo'} onClose={onClose}>
      <form
        onSubmit={async e => {
          e.preventDefault();
          try {
            const id = segment?.id ?? uid();
            await db.segments.put({
              ...segment,
              id,
              pieceId,
              scoreId,
              title: title.trim(),
              measures,
              goal,
              difficulty,
              hand,
              bpm,
              reviewDate: review,
              regions: segment?.regions ?? (region ? [region] : []),
              createdAt: segment?.createdAt ?? now(),
            });
            onSaved(id);
            onClose();
          } catch (err) {
            setError(errorText(err));
          }
        }}
      >
        <Field label="Nome do trecho">
          <input
            required
            maxLength={160}
            value={title}
            onChange={e => setTitle(e.target.value)}
            placeholder="Ex.: Entrada da mão esquerda"
            autoFocus
            data-autofocus
          />
        </Field>
        <div className="form-grid">
          <Field label="Compassos">
            <input
              value={measures}
              onChange={e => setMeasures(e.target.value)}
              placeholder="Ex.: 17–24"
              maxLength={40}
            />
          </Field>
          <Field label="O que precisa de atenção">
            <select value={difficulty} onChange={e => setDifficulty(e.target.value)}>
              {[
                'Ritmo',
                'Leitura',
                'Dedilhado',
                'Articulação',
                'Dinâmica',
                'Pedal',
                'Coordenação',
                'Memória',
              ].map(x => (
                <option key={x}>{x}</option>
              ))}
            </select>
          </Field>
        </div>
        <Field label="Objetivo / orientação">
          <textarea
            value={goal}
            onChange={e => setGoal(e.target.value)}
            rows={3}
            maxLength={3000}
            placeholder="O que você quer melhorar neste trecho?"
          />
        </Field>
        <div className="form-grid">
          <Field label="Mão">
            <select value={hand} onChange={e => setHand(e.target.value as Hand)}>
              {Object.entries(hands).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </Field>
          <Field label="BPM inicial">
            <input
              type="number"
              min={20}
              max={300}
              required
              value={bpm}
              onChange={e => setBpm(Number(e.target.value))}
            />
          </Field>
        </div>
        <Field label="Revisar em (opcional)">
          <input type="date" value={review} onChange={e => setReview(e.target.value)} />
        </Field>
        <ErrorBox message={error} />
        <footer className="modal-actions">
          <button type="button" className="btn secondary" onClick={onClose}>
            Cancelar
          </button>
          <button className="btn" disabled={!title.trim()}>
            Salvar trecho
          </button>
        </footer>
      </form>
    </Modal>
  );
}

function SegmentHistory({ stats }: { stats?: SegmentStats }) {
  if (!stats) return <p className="segment-history unpracticed">Ainda não praticado.</p>;
  const minutes = Math.round(stats.totalSeconds / 60);
  return (
    <div className="segment-history">
      <p>
        {plural(stats.count, 'sessão', 'sessões')} · última {relativeDay(stats.lastAt)}
        {minutes > 0 && ` · ${minutes} min`}
      </p>
      {stats.lastBpm !== undefined && (
        <p>
          Último andamento: {stats.lastBpm} BPM
          {stats.bestBpm !== undefined && stats.bestBpm > stats.lastBpm && ` · melhor: ${stats.bestBpm} BPM`}
        </p>
      )}
      {stats.lastRating && (
        <p>
          Última avaliação:
          <span className={`rating-chip ${stats.lastRating}`}>{ratingLabels[stats.lastRating]}</span>
        </p>
      )}
      {stats.lastNote && <blockquote>“{stats.lastNote}”</blockquote>}
      {stats.nextStep && (
        <p>
          <strong>Próximo passo:</strong> {stats.nextStep}
        </p>
      )}
    </div>
  );
}

function ImportScoreButton({
  onFile,
  big = false,
}: {
  onFile: (file: File) => void | Promise<void>;
  big?: boolean;
}) {
  return (
    <label className={`btn file-button ${big ? 'score-import-big' : 'small secondary'}`}>
      {big ? <FileUp size={20} /> : <Plus size={16} />}
      {big ? 'Importar partitura (PDF ou imagem)' : 'Importar'}
      <input
        type="file"
        accept={scoreTypes.join(',')}
        aria-label={big ? undefined : 'Importar outra versão da partitura'}
        onChange={async e => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file) await onFile(file);
        }}
      />
    </label>
  );
}

function ScoreVersions({
  scores,
  segments,
  activeId,
  onClose,
  onDeleted,
  notify,
}: {
  scores: Score[];
  segments: Segment[];
  activeId?: string;
  onClose: () => void;
  onDeleted: (id: string) => void;
  notify: Notify;
}) {
  const confirm = useConfirm();
  const counts =
    useLiveQuery(
      async () =>
        new Map(
          await Promise.all(
            scores.map(
              async s => [s.id, await db.annotations.where('scoreId').equals(s.id).count()] as const,
            ),
          ),
        ),
      [scores.map(s => s.id).join()],
    ) ?? new Map<string, number>();
  const [renaming, setRenaming] = useState<{ id: string; title: string } | null>(null);
  const remove = async (score: Score) => {
    const marks = counts.get(score.id) ?? 0,
      linked = segments.filter(s => s.scoreId === score.id).length;
    const ok = await confirm({
      title: 'Excluir esta versão?',
      message: (
        <>
          <p>
            {marks === 0
              ? `“${score.title}” será excluída deste dispositivo.`
              : marks === 1
                ? `“${score.title}” e a marcação feita nela serão excluídas deste dispositivo.`
                : `“${score.title}” e as ${marks} marcações feitas nela serão excluídas deste dispositivo.`}{' '}
            Esta ação não pode ser desfeita.
          </p>
          {linked > 0 && (
            <p>
              {linked === 1
                ? 'O trecho ligado a ela continua na lista, sem a marcação na partitura.'
                : `Os ${linked} trechos ligados a ela continuam na lista, sem a marcação na partitura.`}
            </p>
          )}
        </>
      ),
      confirmLabel: 'Excluir versão',
      danger: true,
    });
    if (!ok) return;
    const remaining = scores.find(s => s.id !== score.id);
    try {
      await db.transaction('rw', [db.scores, db.annotations, db.assets, db.segments], async () => {
        await db.annotations.where('scoreId').equals(score.id).delete();
        await db.segments
          .where('scoreId')
          .equals(score.id)
          .modify({ regions: [], scoreId: remaining?.id ?? '' });
        await db.scores.delete(score.id);
        if (!(await db.scores.where('assetId').equals(score.assetId).count()))
          await db.assets.delete(score.assetId);
      });
      forgetHistory(score.id);
      forgetViewState(score.id);
      onDeleted(score.id);
      notify('Versão da partitura excluída.');
    } catch (err) {
      notify(`Não foi possível excluir a versão. ${errorText(err)}`, 'error');
    }
  };
  return (
    <Modal title="Versões da partitura" onClose={onClose} guard={!!renaming}>
      <ul className="version-list">
        {scores.map(score => {
          const marks = counts.get(score.id) ?? 0,
            linked = segments.filter(s => s.scoreId === score.id).length;
          return (
            <li key={score.id} className={score.id === activeId ? 'current' : ''}>
              {renaming?.id === score.id ? (
                <form
                  className="version-rename"
                  onSubmit={async e => {
                    e.preventDefault();
                    const title = renaming.title.trim();
                    if (!title) return;
                    try {
                      await db.scores.update(score.id, { title });
                      setRenaming(null);
                    } catch (err) {
                      notify(`Não foi possível renomear. ${errorText(err)}`, 'error');
                    }
                  }}
                >
                  <input
                    aria-label="Nome da versão"
                    value={renaming.title}
                    maxLength={160}
                    autoFocus
                    onChange={e => setRenaming({ id: score.id, title: e.target.value })}
                  />
                  <button className="btn small" disabled={!renaming.title.trim()}>
                    Salvar
                  </button>
                  <button type="button" className="btn small secondary" onClick={() => setRenaming(null)}>
                    Cancelar
                  </button>
                </form>
              ) : (
                <>
                  <div className="version-info">
                    <strong>{score.title}</strong>
                    <small>
                      {score.id === activeId && 'Aberta agora · '}
                      Importada em {formatDate(score.createdAt)} · {plural(marks, 'marcação', 'marcações')} ·{' '}
                      {plural(linked, 'trecho', 'trechos')}
                    </small>
                  </div>
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label={`Renomear ${score.title}`}
                    onClick={() => setRenaming({ id: score.id, title: score.title })}
                  >
                    <Pencil size={16} />
                  </button>
                  <button
                    type="button"
                    className="icon-btn subtle"
                    aria-label={`Excluir ${score.title}`}
                    onClick={() => void remove(score)}
                  >
                    <Trash2 size={16} />
                  </button>
                </>
              )}
            </li>
          );
        })}
      </ul>
    </Modal>
  );
}

export default function PieceDetail({
  id,
  onBack,
  onPractice,
  notify,
}: {
  id: string;
  onBack: () => void;
  onPractice: (segmentId: string) => void;
  notify: Notify;
}) {
  const confirm = useConfirm();
  const piece = useLiveQuery(() => db.pieces.get(id), [id]);
  const scores = useLiveQuery(() => db.scores.where('pieceId').equals(id).sortBy('createdAt'), [id]) ?? [];
  const segments = useLiveQuery(() => db.segments.where('pieceId').equals(id).toArray(), [id]) ?? [];
  const notes = useLiveQuery(() => db.notes.where('pieceId').equals(id).toArray(), [id]) ?? [];
  const tasks = useLiveQuery(() => db.tasks.where('pieceId').equals(id).toArray(), [id]) ?? [];
  const stats =
    useLiveQuery(async () => {
      const ids = (await db.segments.where('pieceId').equals(id).primaryKeys()) as string[];
      return segmentStats(ids.length ? await db.sessions.where('segmentId').anyOf(ids).toArray() : []);
    }, [id]) ?? new Map<string, SegmentStats>();
  const [scoreId, setScoreId] = useState(() => loadLastScore(id)),
    [tab, setTab] = useState('segments'),
    [edit, setEdit] = useState(false),
    [versions, setVersions] = useState(false),
    [segmentForm, setSegmentForm] = useState<{ region?: Region; segment?: Segment } | null>(null),
    [sheet, setSheet] = useState<string | null>(null),
    [marking, setMarking] = useState<Segment | null>(null),
    [regionRequest, setRegionRequest] = useState(0);
  const [target, setTarget] = useState<Region>(),
    [focusRequest, setFocusRequest] = useState(0),
    [note, setNote] = useState(''),
    [source, setSource] = useState<'mine' | 'teacher'>('teacher'),
    [task, setTask] = useState(''),
    [taskSegment, setTaskSegment] = useState('');
  const scoreCard = useRef<HTMLElement>(null);
  const tabIds = useId();
  const active = scores.find(s => s.id === scoreId) ?? scores[0];
  const sheetSegment = segments.find(s => s.id === sheet);
  useEffect(() => {
    if (active) saveLastScore(id, active.id);
  }, [id, active]);
  if (!piece) return <Empty title="Carregando peça" text="Preparando seu espaço de estudo." />;

  const importScore = async (file: File) => {
    try {
      if (!scoreTypes.includes(file.type)) throw new Error('Use uma partitura em PDF, PNG, JPG ou WebP.');
      let next = '';
      await db.transaction('rw', [db.assets, db.scores], async () => {
        const asset = await storeAsset(file);
        next = uid();
        await db.scores.add({
          id: next,
          pieceId: id,
          assetId: asset.id,
          title: titleFromFileName(file.name),
          createdAt: now(),
        });
      });
      setScoreId(next);
      setTarget(undefined);
      notify('Partitura salva neste dispositivo.');
    } catch (err) {
      notify(`A partitura não foi importada. ${errorText(err)}`, 'error');
    }
  };
  /** On a portrait tablet the score sits above the trechos: bring it on screen before changing it. */
  const revealScore = () => {
    const card = scoreCard.current;
    if (!card) return;
    const top = card.getBoundingClientRect().top;
    if (top >= 0 && top < window.innerHeight * 0.4) return;
    const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    card.scrollIntoView({ block: 'start', behavior: still ? 'auto' : 'smooth' });
  };
  const view = (segment: Segment) => {
    if (!segment.regions.length) return;
    setScoreId(segment.scoreId);
    setTarget(segment.regions[0]);
    setFocusRequest(n => n + 1);
    revealScore();
  };
  const markOnScore = (segment: Segment) => {
    setMarking(segment);
    setRegionRequest(n => n + 1);
    revealScore();
  };
  const removeSegment = async (segment: Segment) => {
    const ok = await confirm({
      title: 'Excluir trecho?',
      message: `Excluir o trecho “${segment.title}”? A partitura e o histórico de prática serão preservados.`,
      confirmLabel: 'Excluir trecho',
      danger: true,
    });
    if (!ok) return;
    try {
      await db.transaction('rw', [db.segments, db.presets, db.tasks], async () => {
        await db.segments.delete(segment.id);
        await db.presets.where('segmentId').equals(segment.id).delete();
        await db.tasks.where('segmentId').equals(segment.id).modify({ segmentId: undefined });
      });
      setTaskSegment(current => (current === segment.id ? '' : current));
      if (marking?.id === segment.id) setMarking(null);
      notify('Trecho excluído.');
    } catch (err) {
      notify(`Não foi possível excluir o trecho. ${errorText(err)}`, 'error');
    }
  };

  return (
    <div className="piece-detail">
      <header className="piece-header">
        <button className="back-link" onClick={onBack}>
          <ArrowLeft size={17} />
          Repertório
        </button>
        <div className="piece-header-main">
          <h1>{piece.title}</h1>
          <p>
            <Badge variant={piece.status}>{statuses[piece.status]}</Badge>
            <span>
              {piece.composer || 'Seu repertório'}
              {piece.tags && ` · ${piece.tags}`}
            </span>
          </p>
        </div>
        <button className="btn secondary small" onClick={() => setEdit(true)}>
          <Pencil size={16} />
          Editar peça
        </button>
      </header>
      <div className="study-layout">
        <section className="score-card" ref={scoreCard}>
          <div className="section-heading score-card-heading">
            <div className="score-version">
              <FileMusic size={18} aria-hidden />
              {scores.length > 1 ? (
                <select
                  aria-label="Versão da partitura"
                  value={active?.id ?? ''}
                  onChange={e => {
                    setScoreId(e.target.value);
                    setTarget(undefined);
                    setMarking(null);
                  }}
                >
                  {scores.map(s => (
                    <option key={s.id} value={s.id}>
                      {s.title}
                    </option>
                  ))}
                </select>
              ) : (
                <h2>{active?.title ?? 'Partitura'}</h2>
              )}
              {active && (
                <button
                  type="button"
                  className="btn small secondary score-versions-button"
                  aria-label="Versões da partitura: renomear ou excluir"
                  onClick={() => setVersions(true)}
                >
                  <Layers size={15} aria-hidden />
                  Versões
                </button>
              )}
            </div>
            <ImportScoreButton onFile={importScore} />
          </div>
          {active ? (
            <ScoreViewer
              key={active.id}
              score={active}
              notify={notify}
              targetRegion={target}
              focusRequest={focusRequest}
              segments={segments.filter(s => s.scoreId === active.id)}
              onSegmentClick={setSheet}
              requestRegion={regionRequest}
              regionPrompt={marking ? `Arraste um retângulo ao redor de “${marking.title}”.` : undefined}
              onRegionCancel={() => setMarking(null)}
              onRegion={async region => {
                if (!marking) return setSegmentForm({ region });
                setMarking(null);
                try {
                  // The trecho may have been deleted meanwhile: then the rectangle starts a new one.
                  if (!(await db.segments.update(marking.id, { scoreId: active.id, regions: [region] })))
                    return setSegmentForm({ region });
                  notify(`“${marking.title}” marcado na partitura.`);
                } catch (err) {
                  notify(`Não foi possível marcar o trecho. ${errorText(err)}`, 'error');
                }
              }}
            />
          ) : (
            <Empty
              title="Traga sua partitura"
              text="Importe um PDF ou uma imagem. Você poderá escrever sobre ela e marcar os trechos que quer praticar."
              action={<ImportScoreButton big onFile={importScore} />}
            />
          )}
        </section>
        <aside className="study-aside">
          <div
            className="tabs small-tabs"
            role="tablist"
            aria-label="Estudo da peça"
            onKeyDown={e => {
              // Arrow keys, Home and End move between the tabs (roving focus).
              const buttons = [...e.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
              const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
              const moves: Record<string, number> = {
                ArrowRight: at + 1,
                ArrowLeft: at - 1,
                Home: 0,
                End: buttons.length - 1,
              };
              const step = moves[e.key];
              if (at < 0 || step === undefined) return;
              e.preventDefault();
              const next = buttons[(step + buttons.length) % buttons.length];
              next.focus();
              next.click();
            }}
          >
            {[
              ['segments', 'Trechos'],
              ['notes', 'Notas'],
              ['tasks', 'Tarefas'],
            ].map(([k, v]) => (
              <button
                key={k}
                id={`${tabIds}-${k}`}
                type="button"
                role="tab"
                aria-selected={tab === k}
                aria-controls={`${tabIds}-panel`}
                tabIndex={tab === k ? 0 : -1}
                className={tab === k ? 'active' : ''}
                onClick={() => setTab(k)}
              >
                {v}
              </button>
            ))}
          </div>
          {tab === 'segments' && (
            <div id={`${tabIds}-panel`} role="tabpanel" aria-labelledby={`${tabIds}-${tab}`}>
              <div className="aside-heading">
                <h2>Um trecho de cada vez</h2>
                <button className="icon-btn" aria-label="Adicionar trecho" onClick={() => setSegmentForm({})}>
                  <Plus size={20} />
                </button>
              </div>
              {segments.length ? (
                segments.map(s => (
                  <article className={`segment-card ${s.rating ? `rated-${s.rating}` : ''}`} key={s.id}>
                    <div className="row between">
                      <Badge>{s.difficulty}</Badge>
                      <button
                        className="icon-btn"
                        aria-label={`Editar trecho ${s.title}`}
                        onClick={() => setSegmentForm({ segment: s })}
                      >
                        <Pencil size={15} />
                      </button>
                    </div>
                    <h3>{s.title}</h3>
                    <p>
                      {s.measures ? `Compassos ${s.measures} · ` : ''}
                      {hands[s.hand]}
                    </p>
                    {s.goal && <p className="segment-goal">{s.goal}</p>}
                    <div className="segment-meta">
                      <strong>
                        {s.bpm} <small>BPM inicial</small>
                      </strong>
                      {s.reviewDate && (
                        <span className={s.reviewDate <= localDay() ? 'due' : ''}>
                          <CalendarDays size={14} />
                          {s.reviewDate <= localDay() ? 'Revisar: ' : 'Revisão em '}
                          {s.reviewDate.split('-').reverse().join('/')}
                        </span>
                      )}
                    </div>
                    <SegmentHistory stats={stats.get(s.id)} />
                    <div className="row wrap">
                      <button className="btn small" onClick={() => onPractice(s.id)}>
                        <Play size={15} />
                        Praticar
                      </button>
                      {s.regions.length > 0 ? (
                        <button className="btn small secondary" onClick={() => view(s)}>
                          <Focus size={15} />
                          Ver
                        </button>
                      ) : (
                        active && (
                          <button className="btn small secondary" onClick={() => markOnScore(s)}>
                            <SquareDashed size={15} />
                            Marcar na partitura
                          </button>
                        )
                      )}
                      <button
                        className="icon-btn subtle segment-delete"
                        aria-label={`Excluir trecho ${s.title}`}
                        onClick={() => void removeSegment(s)}
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </article>
                ))
              ) : (
                <Empty
                  title="Onde concentrar o estudo?"
                  text="Marque uma região na partitura com a ferramenta Trecho ou adicione um trecho pelo botão +."
                />
              )}
            </div>
          )}
          {tab === 'notes' && (
            <div id={`${tabIds}-panel`} role="tabpanel" aria-labelledby={`${tabIds}-${tab}`}>
              <h2 className="aside-title">O que lembrar</h2>
              <form
                className="note-form"
                onSubmit={async e => {
                  e.preventDefault();
                  if (!note.trim()) return;
                  try {
                    await db.notes.add({
                      id: uid(),
                      pieceId: id,
                      text: note.trim(),
                      source,
                      createdAt: now(),
                    });
                    setNote('');
                  } catch (err) {
                    notify(`A nota não foi salva. ${errorText(err)}`, 'error');
                  }
                }}
              >
                <Field label="Origem">
                  <select value={source} onChange={e => setSource(e.target.value as 'mine' | 'teacher')}>
                    <option value="teacher">Orientação do professor, registrada por mim</option>
                    <option value="mine">Minha observação</option>
                  </select>
                </Field>
                <textarea
                  aria-label="Nova observação"
                  value={note}
                  onChange={e => setNote(e.target.value)}
                  rows={4}
                  maxLength={5000}
                  placeholder="Dedilhado, interpretação, o que perguntar na próxima aula…"
                />
                <button className="btn small" disabled={!note.trim()}>
                  <Plus size={15} />
                  Salvar nota
                </button>
              </form>
              {notes
                .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
                .map(n => (
                  <article className="note-card" key={n.id}>
                    <span>
                      <MessageSquare size={14} />
                      {n.source === 'teacher'
                        ? 'Orientação registrada'
                        : n.source === 'ai'
                          ? 'Sugestão da IA'
                          : 'Minha nota'}
                    </span>
                    <p>{n.text}</p>
                    <button
                      className="icon-btn subtle"
                      aria-label="Excluir observação"
                      onClick={async () => {
                        const ok = await confirm({
                          title: 'Excluir observação?',
                          message: 'Esta observação será excluída deste dispositivo.',
                          confirmLabel: 'Excluir',
                          danger: true,
                        });
                        if (ok)
                          try {
                            await db.notes.delete(n.id);
                          } catch (err) {
                            notify(`Não foi possível excluir a observação. ${errorText(err)}`, 'error');
                          }
                      }}
                    >
                      <Trash2 size={14} />
                    </button>
                  </article>
                ))}
            </div>
          )}
          {tab === 'tasks' && (
            <div id={`${tabIds}-panel`} role="tabpanel" aria-labelledby={`${tabIds}-${tab}`}>
              <h2 className="aside-title">Próximos passos</h2>
              <form
                className="task-form"
                onSubmit={async e => {
                  e.preventDefault();
                  if (!task.trim()) return;
                  try {
                    await db.tasks.add({
                      id: uid(),
                      pieceId: id,
                      // Only a trecho that still exists; a deleted one leaves the task unlinked.
                      segmentId: segments.some(s => s.id === taskSegment) ? taskSegment : undefined,
                      title: task.trim(),
                      done: false,
                      dueDate: '',
                      createdAt: now(),
                    });
                    setTask('');
                  } catch (err) {
                    notify(`A tarefa não foi salva. ${errorText(err)}`, 'error');
                  }
                }}
              >
                <div className="inline-form">
                  <input
                    aria-label="Nova tarefa"
                    value={task}
                    maxLength={300}
                    onChange={e => setTask(e.target.value)}
                    placeholder="O que praticar?"
                  />
                  <button className="icon-btn selected" disabled={!task.trim()} aria-label="Adicionar tarefa">
                    <Plus size={19} />
                  </button>
                </div>
                {segments.length > 0 && (
                  <select
                    aria-label="Trecho da tarefa (opcional)"
                    value={taskSegment}
                    onChange={e => setTaskSegment(e.target.value)}
                  >
                    <option value="">Sem trecho específico</option>
                    {segments.map(s => (
                      <option key={s.id} value={s.id}>
                        Trecho: {s.title}
                      </option>
                    ))}
                  </select>
                )}
              </form>
              {tasks.map(t => {
                const linked = segments.find(s => s.id === t.segmentId);
                return (
                  <div className="task-row" key={t.id}>
                    <button
                      className={`check-button ${t.done ? 'checked' : ''}`}
                      aria-label={`${t.done ? 'Reabrir' : 'Concluir'} ${t.title}`}
                      onClick={async () => {
                        try {
                          await db.tasks.update(t.id, { done: !t.done });
                        } catch (err) {
                          notify(`Não foi possível atualizar a tarefa. ${errorText(err)}`, 'error');
                        }
                      }}
                    >
                      {t.done && <Check size={14} />}
                    </button>
                    <div>
                      <span className={t.done ? 'done' : ''}>{t.title}</span>
                      {linked && <small>Trecho: {linked.title}</small>}
                    </div>
                    {linked && !t.done && (
                      <button
                        className="btn small"
                        aria-label={`Praticar ${linked.title}`}
                        onClick={() => onPractice(linked.id)}
                      >
                        <Play size={14} />
                        Praticar
                      </button>
                    )}
                    <button
                      className="icon-btn subtle"
                      aria-label={`Excluir tarefa ${t.title}`}
                      onClick={async () => {
                        const ok = await confirm({
                          title: 'Excluir tarefa?',
                          message: `Excluir “${t.title}”?`,
                          confirmLabel: 'Excluir',
                          danger: true,
                        });
                        if (ok)
                          try {
                            await db.tasks.delete(t.id);
                          } catch (err) {
                            notify(`Não foi possível excluir a tarefa. ${errorText(err)}`, 'error');
                          }
                      }}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </aside>
      </div>
      {edit && (
        <PieceForm
          piece={piece}
          onClose={() => setEdit(false)}
          onSaved={(_, newScore) => {
            notify(newScore ? 'Peça atualizada. A nova partitura já está aberta.' : 'Peça atualizada.');
            if (!newScore) return;
            setScoreId(newScore);
            setTarget(undefined);
            setMarking(null);
          }}
        />
      )}
      {versions && (
        <ScoreVersions
          scores={scores}
          segments={segments}
          activeId={active?.id}
          notify={notify}
          onClose={() => setVersions(false)}
          onDeleted={deleted => {
            if (deleted === active?.id) {
              setScoreId('');
              setTarget(undefined);
              setMarking(null);
            }
            if (scores.length <= 1) setVersions(false);
          }}
        />
      )}
      {sheetSegment && (
        <Modal title={sheetSegment.title} onClose={() => setSheet(null)}>
          <div className="segment-sheet">
            <p className="segment-sheet-meta">
              {sheetSegment.measures ? `Compassos ${sheetSegment.measures} · ` : ''}
              {hands[sheetSegment.hand]} · {sheetSegment.bpm} BPM inicial
            </p>
            {sheetSegment.goal && <p className="segment-goal">{sheetSegment.goal}</p>}
            <SegmentHistory stats={stats.get(sheetSegment.id)} />
            <div className="segment-sheet-actions">
              <button className="btn" data-autofocus onClick={() => onPractice(sheetSegment.id)}>
                <Play size={17} />
                Praticar
              </button>
              <button
                className="btn secondary"
                onClick={() => {
                  view(sheetSegment);
                  setSheet(null);
                }}
              >
                <Focus size={17} />
                Ver
              </button>
              <button
                className="btn secondary"
                onClick={() => {
                  setSegmentForm({ segment: sheetSegment });
                  setSheet(null);
                }}
              >
                <Pencil size={17} />
                Editar
              </button>
            </div>
          </div>
        </Modal>
      )}
      {segmentForm && (
        <SegmentForm
          pieceId={id}
          scoreId={segmentForm.segment?.scoreId || active?.id || ''}
          region={segmentForm.region}
          segment={segmentForm.segment}
          onClose={() => setSegmentForm(null)}
          onSaved={() => notify('Trecho salvo. Você já pode praticar.')}
        />
      )}
    </div>
  );
}
