import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  ArrowLeftRight,
  ChevronRight,
  ClipboardList,
  Copy,
  Download,
  Play,
  Plus,
  Clock3,
  Target,
  AudioLines,
  Trash2,
} from 'lucide-react';
import { db, storeAsset } from '../db';
import {
  hands,
  now,
  uid,
  formatDate,
  clock,
  localDay,
  type Hand,
  type Piece,
  type Recording,
  type Segment,
  type Session,
} from '../domain';
import { Badge, Empty, Field, Modal, download, errorText, useConfirm, type Notify } from './common';
import Recorder from './Recorder';
import { makePlayableCopy, recordingHealthMessage } from '../audio/recording';
import { lastPracticeBySegment, reviewStatus, type ReviewStatus } from '../practice/plan';
import {
  addDays,
  buildLessonReport,
  dayOf,
  daysBetween,
  detectQuestions,
  formatMinutes,
  lastLessonDay,
  plural,
  ratingLabels,
  reachedBpm,
  relativeDay,
  sessionKind,
  summarizeSegment,
  type DayPoint,
} from '../practice/stats';
import '../styles/progress.css';

export type ProgressTab = 'history' | 'recordings' | 'review';

function RecordingPlayer({
  assetId,
  audioRef,
  onPlay,
}: {
  assetId: string;
  audioRef?: RefObject<HTMLAudioElement | null>;
  onPlay?: () => void;
}) {
  const asset = useLiveQuery(() => db.assets.get(assetId), [assetId]);
  const [url, setUrl] = useState(''),
    [playbackError, setPlaybackError] = useState('');
  useEffect(() => {
    if (!asset) return;
    const u = URL.createObjectURL(asset.blob);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [asset]);
  return url ? (
    <>
      <audio
        ref={audioRef}
        controls
        src={url}
        preload="metadata"
        onPlay={onPlay}
        onLoadedMetadata={e =>
          setPlaybackError(
            Number.isFinite(e.currentTarget.duration)
              ? ''
              : 'O navegador não reconheceu a duração. Use “Criar cópia reproduzível” para corrigir a barra de progresso.',
          )
        }
        onDurationChange={e => {
          if (Number.isFinite(e.currentTarget.duration)) setPlaybackError('');
        }}
        onError={() =>
          setPlaybackError('Não foi possível reproduzir este arquivo. Tente criar uma cópia reproduzível.')
        }
      />
      {playbackError && (
        <p className="recorder-warning" role="status">
          {playbackError}
        </p>
      )}
    </>
  ) : null;
}
function RecordingDownload({ assetId }: { assetId: string }) {
  const asset = useLiveQuery(() => db.assets.get(assetId), [assetId]);
  return asset ? (
    <button className="btn small secondary" onClick={() => download(asset.blob, asset.name)}>
      <Download size={14} />
      Baixar arquivo
    </button>
  ) : null;
}

const ratingBadge = (s: Session) =>
  s.rating ? (
    <Badge variant={`rating-${s.rating}`}>{ratingLabels[s.rating]}</Badge>
  ) : s.completed ? (
    <Badge>Concluída</Badge>
  ) : (
    <Badge variant="partial">Parcial</Badge>
  );

function tempoText(s: Session) {
  if (s.config.metronome === false) return 'Sem metrônomo';
  const reached = reachedBpm(s);
  return reached && reached !== s.config.bpm ? `${s.config.bpm} → ${reached} BPM` : `${s.config.bpm} BPM`;
}

/** BPM and hand of a take: stored on the recording, or taken from the session it belongs to. */
function takeDetails(r: Recording, sessions: Session[]) {
  const session = r.sessionId ? sessions.find(s => s.id === r.sessionId) : undefined;
  return {
    bpm: r.bpm ?? (session ? (reachedBpm(session) ?? undefined) : undefined),
    hand: r.hand ?? session?.hand,
    session,
  };
}

function useElementWidth<T extends HTMLElement>(fallback: number) {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(fallback);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Measure before the first paint so the chart never overflows while ResizeObserver catches up.
    setWidth(Math.round(el.getBoundingClientRect().width) || fallback);
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.round(entry.contentRect.width)));
    observer.observe(el);
    return () => observer.disconnect();
  }, [fallback]);
  return [ref, width] as const;
}

const niceStep = (range: number) => (range <= 12 ? 2 : range <= 30 ? 5 : range <= 60 ? 10 : 20);

/** A column with rounded top corners, square on the baseline. */
function columnPath(cx: number, base: number, height: number, width: number) {
  const r = Math.min(4, width / 2, height),
    l = cx - width / 2,
    top = base - height;
  return `M${l},${base} V${top + r} Q${l},${top} ${l + r},${top} H${l + width - r} Q${l + width},${top} ${l + width},${top + r} V${base} Z`;
}

/** Tempo reached per day (line) above practice minutes per day (columns), sharing the date axis. */
function TempoChart({ days }: { days: DayPoint[] }) {
  const [box, width] = useElementWidth<HTMLDivElement>(560);
  const [active, setActive] = useState<number | null>(null);
  const left = 40,
    right = 16,
    tempoHeight = 170,
    minutesHeight = 76;
  const plotWidth = Math.max(120, width - left - right);
  const first = days[0].day,
    span = Math.max(1, daysBetween(first, days.at(-1)!.day));
  const x = (day: string) =>
    days.length === 1 ? left + plotWidth / 2 : left + (daysBetween(first, day) / span) * plotWidth;
  const tempos = days.map(d => d.bpm).filter((b): b is number => b !== null);
  const step = niceStep((tempos.length ? Math.max(...tempos) - Math.min(...tempos) : 0) + 4);
  const low = tempos.length ? Math.floor((Math.min(...tempos) - 2) / step) * step : 60;
  const high = tempos.length
    ? Math.max(low + step * 2, Math.ceil((Math.max(...tempos) + 2) / step) * step)
    : 80;
  const yTempo = (bpm: number) => 14 + (1 - (bpm - low) / (high - low)) * (tempoHeight - 34);
  const ticks = Array.from({ length: Math.round((high - low) / step) + 1 }, (_, i) => low + i * step);
  const maxMinutes = Math.max(5, ...days.map(d => d.seconds / 60));
  const yMinutes = (m: number) => minutesHeight - 18 - (m / maxMinutes) * (minutesHeight - 30);
  const slot = days.length > 1 ? plotWidth / (span + 1) : plotWidth;
  const column = Math.max(3, Math.min(24, slot * 0.6));
  const withTempo = days.map((d, i) => ({ ...d, i })).filter(d => d.bpm !== null);
  const path = withTempo.map((d, i) => `${i ? 'L' : 'M'}${x(d.day).toFixed(1)},${yTempo(d.bpm!)}`).join(' ');
  const labelled = new Set([withTempo[0]?.i, withTempo.at(-1)?.i]);
  // Each day owns the band up to halfway to its neighbours, so the pointer only has to be closest to it.
  const edges = days.map((d, i) => (i ? (x(days[i - 1].day) + x(d.day)) / 2 : left - 12));
  const hits = (height: number) =>
    days.map((d, i) => (
      <rect
        key={d.day}
        x={edges[i]}
        y={0}
        width={(i < days.length - 1 ? edges[i + 1] : left + plotWidth + 12) - edges[i]}
        height={height}
        fill="transparent"
        onPointerEnter={() => setActive(i)}
        onPointerDown={() => setActive(i)}
      />
    ));
  const current = active !== null ? days[active] : undefined;
  const summary = tempos.length
    ? `Andamento de ${tempos[0]} a ${tempos.at(-1)} BPM entre ${formatDate(first)} e ${formatDate(days.at(-1)!.day)}`
    : 'Sem registros de andamento: as sessões foram feitas sem metrônomo';
  return (
    <div
      className="tempo-chart"
      ref={box}
      onPointerLeave={e => {
        // On touch the pointer "leaves" as soon as the finger lifts; keep the tapped day visible.
        if (e.pointerType === 'mouse') setActive(null);
      }}
    >
      <p className="chart-title">Andamento alcançado (BPM)</p>
      <svg width={width} height={tempoHeight} role="img" aria-label={summary}>
        {ticks.map(t => (
          <g key={t}>
            <line x1={left} x2={left + plotWidth} y1={yTempo(t)} y2={yTempo(t)} className="chart-grid" />
            <text x={left - 8} y={yTempo(t) + 4} textAnchor="end" className="chart-axis">
              {t}
            </text>
          </g>
        ))}
        {current && (
          <line
            x1={x(current.day)}
            x2={x(current.day)}
            y1={8}
            y2={tempoHeight - 16}
            className="chart-cross"
          />
        )}
        {path && <path d={path} className="chart-line" />}
        {withTempo.map(d => (
          <g key={d.day}>
            <circle cx={x(d.day)} cy={yTempo(d.bpm!)} r={active === d.i ? 6 : 4.5} className="chart-dot" />
            {labelled.has(d.i) && (
              <text
                x={x(d.day)}
                y={yTempo(d.bpm!) - 11}
                textAnchor={
                  d.i === 0 && days.length > 1
                    ? 'start'
                    : d.i === days.length - 1 && days.length > 1
                      ? 'end'
                      : 'middle'
                }
                className="chart-label"
              >
                {d.bpm}
              </text>
            )}
          </g>
        ))}
        <g aria-hidden="true">{hits(tempoHeight)}</g>
      </svg>
      <p className="chart-title">Minutos de prática por dia</p>
      <svg width={width} height={minutesHeight} aria-hidden="true">
        <line
          x1={left}
          x2={left + plotWidth}
          y1={minutesHeight - 18}
          y2={minutesHeight - 18}
          className="chart-grid"
        />
        {days.map((d, i) => (
          <path
            key={d.day}
            className={`chart-column ${active === i ? 'active' : ''}`}
            d={columnPath(
              x(d.day),
              minutesHeight - 18,
              Math.max(2, minutesHeight - 18 - yMinutes(d.seconds / 60)),
              column,
            )}
          />
        ))}
        <text x={left} y={minutesHeight - 3} className="chart-axis">
          {formatDate(first)}
        </text>
        {days.length > 1 && (
          <text x={left + plotWidth} y={minutesHeight - 3} textAnchor="end" className="chart-axis">
            {formatDate(days.at(-1)!.day)}
          </text>
        )}
        {hits(minutesHeight)}
      </svg>
      {current && (
        <div
          className="chart-tooltip"
          style={{ left: Math.min(Math.max(x(current.day), 90), width - 90) }}
          aria-hidden="true"
        >
          <strong>{current.bpm !== null ? `${current.bpm} BPM` : 'Sem metrônomo'}</strong>
          <span>
            {formatDate(current.day)} · {formatMinutes(current.seconds)} ·{' '}
            {plural(current.sessions, 'sessão', 'sessões')}
          </span>
        </div>
      )}
      <details className="chart-table">
        <summary>Ver os dados em tabela</summary>
        <table>
          <thead>
            <tr>
              <th scope="col">Dia</th>
              <th scope="col">Andamento</th>
              <th scope="col">Prática</th>
              <th scope="col">Sessões</th>
            </tr>
          </thead>
          <tbody>
            {days.map(d => (
              <tr key={d.day}>
                <td>{formatDate(d.day)}</td>
                <td>{d.bpm !== null ? `${d.bpm} BPM` : '—'}</td>
                <td>{formatMinutes(d.seconds)}</td>
                <td>{d.sessions}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}

function Sparkline({ days }: { days: DayPoint[] }) {
  const tempos = days.map(d => d.bpm).filter((b): b is number => b !== null);
  if (tempos.length < 2) return null;
  const low = Math.min(...tempos),
    high = Math.max(low + 1, ...tempos);
  const points = tempos.map(
    (t, i) => `${(i / (tempos.length - 1)) * 76 + 2},${22 - ((t - low) / (high - low)) * 18}`,
  );
  return (
    <svg className="sparkline" width={80} height={26} aria-hidden="true">
      <polyline points={points.join(' ')} />
      <circle cx={points.at(-1)!.split(',')[0]} cy={points.at(-1)!.split(',')[1]} r={3} />
    </svg>
  );
}

/** Tempo evolution for the filtered trecho, or a list of trechos to pick from. */
function TempoPanel({
  sessions,
  segments,
  pieces,
  filter,
  onFilter,
}: {
  sessions: Session[];
  segments: Segment[];
  pieces: Piece[];
  filter: string;
  onFilter: (id: string) => void;
}) {
  const [all, setAll] = useState(false);
  const today = localDay();
  if (filter) {
    const summary = summarizeSegment(sessions, filter);
    const segment = segments.find(s => s.id === filter);
    if (!summary.days.length) return null;
    return (
      <section className="panel tempo-panel">
        <div className="section-heading">
          <div className="tempo-heading">
            <h2>Evolução de {segment?.title ?? 'trecho'}</h2>
            <p className="hint">
              {[
                pieces.find(p => p.id === segment?.pieceId)?.title,
                summary.firstBpm !== null &&
                  summary.lastBpm !== null &&
                  `${summary.firstBpm} → ${summary.lastBpm} BPM`,
                `${formatMinutes(summary.seconds)} em ${plural(summary.days.length, 'dia', 'dias')}`,
              ]
                .filter(Boolean)
                .join(' · ')}
            </p>
          </div>
          <button className="link-btn" onClick={() => onFilter('')}>
            Ver todos os trechos
          </button>
        </div>
        <TempoChart days={summary.days} />
      </section>
    );
  }
  const rows = segments
    .map(segment => ({ segment, summary: summarizeSegment(sessions, segment.id) }))
    .filter(r => r.summary.sessions)
    .sort((a, b) => (b.summary.lastPractice ?? '').localeCompare(a.summary.lastPractice ?? ''));
  if (!rows.length) return null;
  const shown = all ? rows : rows.slice(0, 5);
  return (
    <section className="panel tempo-panel">
      <div className="section-heading">
        <h2>Andamento por trecho</h2>
        <span className="hint">Escolha um trecho para ver o gráfico</span>
      </div>
      <ul className="tempo-list">
        {shown.map(({ segment, summary }) => (
          <li key={segment.id}>
            <button className="tempo-row" onClick={() => onFilter(segment.id)}>
              <span className="grow">
                <strong>{segment.title}</strong>
                <small>
                  {[
                    pieces.find(p => p.id === segment.pieceId)?.title,
                    `${formatMinutes(summary.seconds)} de prática`,
                    summary.lastPractice && `última ${relativeDay(summary.lastPractice, today)}`,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </small>
              </span>
              <Sparkline days={summary.days} />
              <span className="tempo-change">
                {summary.firstBpm === null || summary.lastBpm === null
                  ? '—'
                  : summary.firstBpm === summary.lastBpm
                    ? `${summary.lastBpm} BPM`
                    : `${summary.firstBpm} → ${summary.lastBpm} BPM`}
              </span>
              <ChevronRight size={16} aria-hidden="true" />
            </button>
          </li>
        ))}
      </ul>
      {rows.length > 5 && (
        <button className="link-btn" onClick={() => setAll(!all)}>
          {all ? 'Mostrar menos' : `Mostrar todos (${rows.length})`}
        </button>
      )}
    </section>
  );
}

function HistoryRow({
  s,
  canPractice,
  onPractice,
}: {
  s: Session;
  canPractice: boolean;
  onPractice: (id: string) => void;
}) {
  const kind = sessionKind(s);
  return (
    <article className="history-row">
      <div className="history-time">
        {clock(s.activeSeconds)}
        <small>PRÁTICA ATIVA</small>
      </div>
      <div className="grow">
        <h3>
          {s.title}
          {kind !== 'segment' && (
            <Badge variant="kind">{kind === 'piece' ? 'Peça inteira' : 'Prática livre'}</Badge>
          )}
        </h3>
        <p>
          {formatDate(s.startedAt)} · {hands[s.hand]} · {tempoText(s)} ·{' '}
          {plural(s.completedRepetitions, 'repetição', 'repetições')}
        </p>
        {s.intention?.trim() && (
          <p className="session-detail">
            <strong>Intenção:</strong> {s.intention}
          </p>
        )}
        {s.note && <p className="session-note">{s.note}</p>}
        {s.nextStep?.trim() && (
          <p className="session-detail">
            <strong>Próximo passo:</strong> {s.nextStep}
          </p>
        )}
      </div>
      {ratingBadge(s)}
      {canPractice && (
        <button
          className="icon-btn"
          aria-label={`Praticar ${s.title}`}
          onClick={() => onPractice(s.segmentId!)}
        >
          <Play size={18} />
        </button>
      )}
    </article>
  );
}

/** Two takes of the same trecho side by side; the switch jumps to the same moment in the other take. */
function ComparePanel({ takes, sessions }: { takes: Recording[]; sessions: Session[] }) {
  // null means "the oldest" (A) and "the newest" (B): a new take moves B along, a deleted one never lingers.
  const [aId, setAId] = useState<string | null>(null),
    [bId, setBId] = useState<string | null>(null),
    [playing, setPlaying] = useState<'a' | 'b'>('a');
  const aRef = useRef<HTMLAudioElement>(null),
    bRef = useRef<HTMLAudioElement>(null);
  const oldest = takes[0],
    newest = takes.at(-1)!;
  const a = takes.find(t => t.id === aId) ?? oldest,
    b = takes.find(t => t.id === bId) ?? newest;
  const switchTake = () => {
    const [from, to] = playing === 'a' ? [aRef.current, bRef.current] : [bRef.current, aRef.current];
    if (!from || !to) return;
    const wasPlaying = !from.paused;
    from.pause();
    to.currentTime = Number.isFinite(to.duration)
      ? Math.min(from.currentTime, Math.max(0, to.duration - 0.05))
      : from.currentTime;
    setPlaying(playing === 'a' ? 'b' : 'a');
    if (wasPlaying) void to.play().catch(() => {});
  };
  const column = (
    label: 'A' | 'B',
    take: Recording,
    onChange: (id: string) => void,
    ref: RefObject<HTMLAudioElement | null>,
    other: RefObject<HTMLAudioElement | null>,
  ) => {
    const { bpm, hand, session } = takeDetails(take, sessions);
    return (
      <div className={`compare-take ${playing === label.toLowerCase() ? 'current' : ''}`}>
        <Field label={`Tentativa ${label}`}>
          <select value={take.id} onChange={e => onChange(e.target.value)}>
            {takes.map(t => (
              <option key={t.id} value={t.id}>
                {formatDate(t.createdAt)} · {t.title}
              </option>
            ))}
          </select>
        </Field>
        <p className="take-meta">
          <span>
            {new Date(take.createdAt).toLocaleDateString('pt-BR', {
              day: 'numeric',
              month: 'short',
              year: 'numeric',
            })}
          </span>
          <span>{bpm ? `${bpm} BPM` : 'BPM não informado'}</span>
          <span>{hand ? hands[hand] : 'Mão não informada'}</span>
          {session?.rating && (
            <Badge variant={`rating-${session.rating}`}>{ratingLabels[session.rating]}</Badge>
          )}
        </p>
        <RecordingPlayer
          key={take.assetId}
          assetId={take.assetId}
          audioRef={ref}
          onPlay={() => {
            other.current?.pause();
            setPlaying(label === 'A' ? 'a' : 'b');
          }}
        />
      </div>
    );
  };
  return (
    <section className="panel compare-panel">
      <div className="section-heading">
        <h2>Comparar tentativas</h2>
        <button className="btn small secondary" onClick={switchTake} disabled={a.id === b.id}>
          <ArrowLeftRight size={15} />
          Ouvir {playing === 'a' ? 'B' : 'A'} no mesmo ponto
        </button>
      </div>
      <div className="compare-grid">
        {column('A', a, id => setAId(id === oldest.id ? null : id), aRef, bRef)}
        {column('B', b, id => setBId(id === newest.id ? null : id), bRef, aRef)}
      </div>
    </section>
  );
}

/**
 * Saves on blur or Enter. Typing a date fires a change per digit (year 0002, 0020...), and saving each one
 * would move the card to another group and take the focus away mid-edit.
 */
function ReviewDateInput({
  value,
  onCommit,
  notify,
}: {
  value: string;
  onCommit: (date: string) => void;
  notify: Notify;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = (input: HTMLInputElement) => {
    if (draft === null) return;
    setDraft(null);
    const date = input.value;
    // An incomplete date reads as '' with badInput set; only a fully emptied field clears the review.
    if (input.validity.badInput || date === value) return;
    if (date && (date < '2000-01-01' || date > '2099-12-31')) {
      notify('Confira o ano da revisão: a data não foi alterada.', 'error');
      return;
    }
    onCommit(date);
  };
  return (
    <input
      type="date"
      min="2000-01-01"
      max="2099-12-31"
      value={draft ?? value}
      onChange={e => setDraft(e.target.value)}
      onBlur={e => commit(e.currentTarget)}
      onKeyDown={e => {
        if (e.key === 'Enter') e.currentTarget.blur();
      }}
    />
  );
}

const reviewGroups: { status: ReviewStatus; title: string }[] = [
  { status: 'overdue', title: 'Atrasadas' },
  { status: 'today', title: 'Hoje' },
  { status: 'soon', title: 'Próximos 7 dias' },
  { status: 'later', title: 'Mais adiante' },
  { status: 'none', title: 'Sem data' },
];

function ReviewBoard({
  segments,
  pieces,
  sessions,
  pieceFilter,
  onPractice,
  notify,
}: {
  segments: Segment[];
  pieces: Piece[];
  sessions: Session[];
  pieceFilter: string;
  onPractice: (id: string) => void;
  notify: Notify;
}) {
  const today = localDay();
  const [scope, setScope] = useState<'due' | 'all' | null>(null);
  const last = lastPracticeBySegment(sessions);
  const lastSession = (id: string) => sessions.find(s => s.segmentId === id && s.startedAt === last.get(id));
  const visible = segments
    .filter(s => !pieceFilter || s.pieceId === pieceFilter)
    .sort(
      (a, b) =>
        (a.reviewDate || '9999').localeCompare(b.reviewDate || '9999') ||
        a.title.localeCompare(b.title, 'pt-BR'),
    );
  const dueCount = visible.filter(s =>
    ['overdue', 'today'].includes(reviewStatus(s.reviewDate, today)),
  ).length;
  const shownScope = scope ?? (dueCount ? 'due' : 'all');
  const reschedule = async (s: Segment, reviewDate: string) => {
    // Keep the view you are in: moving the last due card must not flip the board to "Todas" under your finger.
    setScope(shownScope);
    try {
      await db.segments.update(s.id, { reviewDate });
      notify(
        reviewDate
          ? `Revisão de “${s.title}” marcada para ${formatDate(reviewDate)}.`
          : `Revisão de “${s.title}” ficou sem data.`,
      );
    } catch (err) {
      notify(errorText(err), 'error');
    }
  };
  if (!segments.length)
    return (
      <Empty
        title="Seu repertório continua vivo"
        text="Crie trechos nas partituras para definir quando quer revisitá-los."
      />
    );
  return (
    <>
      <div className="review-scope" role="group" aria-label="Quais revisões mostrar">
        <button
          aria-pressed={shownScope === 'due'}
          className={shownScope === 'due' ? 'active' : ''}
          onClick={() => setScope('due')}
        >
          Atrasadas e hoje ({dueCount})
        </button>
        <button
          aria-pressed={shownScope === 'all'}
          className={shownScope === 'all' ? 'active' : ''}
          onClick={() => setScope('all')}
        >
          Todas ({visible.length})
        </button>
      </div>
      {shownScope === 'due' && !dueCount && (
        <p className="subtle-text">Nenhuma revisão atrasada ou marcada para hoje.</p>
      )}
      {reviewGroups
        .filter(g => shownScope === 'all' || g.status === 'overdue' || g.status === 'today')
        .map(group => {
          const items = visible.filter(s => reviewStatus(s.reviewDate, today) === group.status);
          if (!items.length) return null;
          return (
            <section key={group.status} className="review-group" aria-label={group.title}>
              <h2 className="review-group-title">
                {group.title} <span>{items.length}</span>
              </h2>
              <div className="piece-grid">
                {items.map(s => {
                  const session = lastSession(s.id);
                  const late = group.status === 'overdue' ? daysBetween(s.reviewDate, today) : 0;
                  return (
                    <article className={`panel review-card ${group.status}`} key={s.id}>
                      <div className="row between wrap">
                        {group.status === 'overdue' ? (
                          <Badge variant="overdue">Atrasada {plural(late, 'dia', 'dias')}</Badge>
                        ) : group.status === 'today' ? (
                          <Badge variant="due-today">Revisar hoje</Badge>
                        ) : s.reviewDate ? (
                          <Badge>{formatDate(s.reviewDate)}</Badge>
                        ) : (
                          <Badge>Sem data</Badge>
                        )}
                        {s.difficulty && <small className="hint">{s.difficulty}</small>}
                      </div>
                      <h3>{s.title}</h3>
                      <p className="hint">
                        {[pieces.find(p => p.id === s.pieceId)?.title, hands[s.hand], `${s.bpm} BPM`]
                          .filter(Boolean)
                          .join(' · ')}
                      </p>
                      <p className="hint review-last">
                        {session ? (
                          <>
                            Última prática {relativeDay(session.startedAt, today)}
                            {session.rating && (
                              <>
                                {' · '}
                                <Badge variant={`rating-${session.rating}`}>
                                  {ratingLabels[session.rating]}
                                </Badge>
                              </>
                            )}
                          </>
                        ) : (
                          'Ainda não praticado'
                        )}
                      </p>
                      <Field label="Próxima revisão">
                        <ReviewDateInput
                          value={s.reviewDate}
                          onCommit={date => void reschedule(s, date)}
                          notify={notify}
                        />
                      </Field>
                      <div
                        className="review-quick"
                        role="group"
                        aria-label={`Remarcar a revisão de ${s.title}`}
                      >
                        {(
                          [
                            [1, 'Amanhã'],
                            [3, 'Em 3 dias'],
                            [7, 'Em 1 semana'],
                          ] as const
                        ).map(([n, text]) => (
                          <button
                            key={n}
                            className="btn small secondary"
                            onClick={() => void reschedule(s, addDays(today, n))}
                          >
                            {text}
                          </button>
                        ))}
                      </div>
                      <button className="btn small" onClick={() => onPractice(s.id)}>
                        <Play size={15} />
                        Revisar trecho
                      </button>
                    </article>
                  );
                })}
              </div>
            </section>
          );
        })}
    </>
  );
}

function LessonPrep({
  onClose,
  notify,
  sessions,
  segments,
  pieces,
}: {
  onClose: () => void;
  notify: Notify;
  sessions: Session[];
  segments: Segment[];
  pieces: Piece[];
}) {
  const lessons = useLiveQuery(() => db.lessons.toArray());
  const tasks = useLiveQuery(() => db.tasks.toArray()) ?? [],
    notes = useLiveQuery(() => db.notes.toArray()),
    recordings = useLiveQuery(() => db.recordings.toArray()) ?? [];
  const today = localDay();
  const lastLesson = lastLessonDay(lessons ?? [], today);
  const [from, setFrom] = useState<string | null>(null),
    [questions, setQuestions] = useState<string | null>(null);
  const start = from ?? lastLesson ?? addDays(today, -14);
  const questionText = questions ?? detectQuestions(notes ?? [], start).join('\n');
  const report = buildLessonReport({
    from: start,
    to: today,
    sessions,
    segments,
    pieces,
    tasks,
    recordings,
    questions: questionText.split('\n'),
  });
  const inPeriod = sessions.filter(s => dayOf(s.startedAt) >= start && s.activeSeconds > 0);
  const trechos = new Set(inPeriod.filter(s => s.segmentId).map(s => s.segmentId)).size;
  return (
    <Modal title="Preparar próxima aula" onClose={onClose} wide guard>
      <div className="form-grid">
        <Field
          label="Incluir a prática desde"
          hint={
            lastLesson
              ? `Sua última aula foi em ${formatDate(lastLesson)}.`
              : 'Nenhuma aula registrada: começando pelas últimas duas semanas.'
          }
        >
          <input
            type="date"
            value={start}
            max={today}
            required
            onChange={e => setFrom(e.target.value || null)}
          />
        </Field>
        <div className="prep-summary" aria-live="polite">
          <strong>{formatMinutes(inPeriod.reduce((sum, s) => sum + s.activeSeconds, 0))}</strong> de prática ·{' '}
          {plural(trechos, 'trecho', 'trechos')} ·{' '}
          {plural(tasks.filter(t => !t.done).length, 'tarefa pendente', 'tarefas pendentes')}
        </div>
      </div>
      <Field
        label="Perguntas para o professor"
        hint="Uma por linha. Trazemos as anotações do período que terminam com “?”."
      >
        <textarea
          rows={4}
          value={questionText}
          maxLength={5000}
          onChange={e => setQuestions(e.target.value)}
          placeholder="Ex.: Posso usar o pedal nos compassos 5 a 8?"
        />
      </Field>
      <p className="field-label">Prévia</p>
      <pre className="report-preview" tabIndex={0} aria-label="Prévia do texto">
        {report}
      </pre>
      <footer className="modal-actions">
        <button
          type="button"
          className="btn secondary"
          onClick={async () => {
            try {
              if (!navigator.clipboard) throw new Error('Este navegador não permite copiar automaticamente.');
              await navigator.clipboard.writeText(report);
              notify('Texto copiado.');
            } catch (err) {
              notify(errorText(err), 'error');
            }
          }}
        >
          <Copy size={16} />
          Copiar texto
        </button>
        <button
          type="button"
          className="btn"
          onClick={() => {
            download(new Blob([report], { type: 'text/markdown;charset=utf-8' }), `proxima-aula-${today}.md`);
            notify('Resumo baixado.');
          }}
        >
          <Download size={16} />
          Baixar Markdown
        </button>
      </footer>
    </Modal>
  );
}

export default function Progress({
  onPractice,
  notify,
  initialTab = 'history',
}: {
  onPractice: (id: string) => void;
  notify: Notify;
  /** Lets the app open a tab directly, e.g. the reviews from the "Hoje" screen. */
  initialTab?: ProgressTab;
}) {
  const confirm = useConfirm();
  const sessions = useLiveQuery(() => db.sessions.orderBy('startedAt').reverse().toArray()) ?? [];
  const segments = useLiveQuery(() => db.segments.toArray()) ?? [],
    recordings = useLiveQuery(() => db.recordings.toArray()) ?? [],
    pieces = useLiveQuery(() => db.pieces.toArray()) ?? [];
  const [tab, setTab] = useState<ProgressTab>(initialTab),
    [filter, setFilter] = useState(''),
    [pieceFilter, setPieceFilter] = useState(''),
    [preparing, setPreparing] = useState(false),
    [repairingId, setRepairingId] = useState('');
  const [link, setLink] = useState(''),
    [recordTitle, setRecordTitle] = useState(''),
    [recordBpm, setRecordBpm] = useState(''),
    [recordHand, setRecordHand] = useState<Hand | ''>(''),
    // Once you pick the trecho, BPM or hand yourself, the filter no longer suggests a link.
    [linkTouched, setLinkTouched] = useState(false),
    [recording, setRecording] = useState(false);
  // The header follows the filter that is visible: the piece on the review tab, the trecho elsewhere.
  const filtered = sessions.filter(s =>
      tab === 'review' ? !pieceFilter || s.pieceId === pieceFilter : !filter || s.segmentId === filter,
    ),
    minutes = Math.round(filtered.reduce((s, x) => s + x.activeSeconds, 0) / 60),
    days = new Set(filtered.map(s => localDay(new Date(s.startedAt)))).size;
  // The recorder saves after it stops; read the form as it is then, not as it was when recording began.
  const form = useRef({ link, recordTitle, recordBpm, recordHand });
  useEffect(() => {
    form.current = { link, recordTitle, recordBpm, recordHand };
  });
  const busyRef = useRef(false);
  const onRecorderBusy = useCallback((busy: boolean) => {
    busyRef.current = busy;
    setRecording(busy);
  }, []);
  const onRecordingsTab = tab === 'recordings';
  useEffect(() => {
    if (!onRecordingsTab) return;
    // The Recorder reports "busy" only from an effect, never when it unmounts: clear what it registered.
    return () => onRecorderBusy(false);
  }, [onRecordingsTab, onRecorderBusy]);
  const chooseLink = (id: string) => {
    setLink(id);
    const segment = segments.find(s => s.id === id);
    if (!segment) {
      setRecordBpm('');
      setRecordHand('');
      return;
    }
    const latest = sessions.find(s => s.segmentId === id && s.activeSeconds > 0);
    setRecordBpm(String((latest && reachedBpm(latest)) || segment.bpm));
    setRecordHand(latest?.hand ?? segment.hand);
  };
  const changeFilter = (id: string) => {
    setFilter(id);
    // The filter never clears or overrides a link: it only suggests one until you choose yourself.
    if (id && !recording && !linkTouched) chooseLink(id);
  };
  const saveRecording = async (file: File) => {
    const { link: segmentId, recordTitle: title, recordBpm: bpmText, recordHand: hand } = form.current;
    const segment = segments.find(s => s.id === segmentId);
    const bpm = Number(bpmText);
    await db.transaction('rw', [db.assets, db.recordings], async () => {
      const asset = await storeAsset(file);
      await db.recordings.add({
        id: uid(),
        assetId: asset.id,
        segmentId: segment?.id,
        title: title.trim() || `${segment?.title ?? 'Minha prática'} · ${formatDate(now())}`,
        createdAt: now(),
        bpm: Number.isInteger(bpm) && bpm >= 20 && bpm <= 300 ? bpm : undefined,
        hand: hand || undefined,
      });
    });
    notify(segment ? `Tentativa salva em “${segment.title}”.` : 'Tentativa salva.');
    setRecordTitle('');
  };
  const repairRecording = async (source: Recording) => {
    if (repairingId) return;
    setRepairingId(source.id);
    try {
      const original = await db.assets.get(source.assetId);
      if (!original) throw new Error('Arquivo original não encontrado.');
      const repaired = await makePlayableCopy(original.blob, original.name);
      const silence = recordingHealthMessage(repaired.duration, repaired.rms);
      if (silence) throw new Error(silence);
      await db.transaction('rw', [db.assets, db.recordings], async () => {
        const asset = await storeAsset(repaired.file);
        await db.recordings.add({
          ...source,
          id: uid(),
          assetId: asset.id,
          title: `${source.title} (cópia reproduzível)`,
          // Same date as the take it copies: it is the same performance, not a new attempt.
          createdAt: source.createdAt,
        });
      });
      notify(`Cópia reproduzível criada (${clock(repaired.duration)}). A gravação original foi preservada.`);
    } catch (err) {
      notify(errorText(err), 'error');
    } finally {
      setRepairingId('');
    }
  };
  const removeRecording = async (r: Recording) => {
    const ok = await confirm({
      title: 'Excluir gravação?',
      message: `“${r.title}” será apagada deste dispositivo. Não é possível desfazer.`,
      confirmLabel: 'Excluir',
      danger: true,
    });
    if (!ok) return;
    try {
      await db.transaction('rw', [db.recordings, db.assets], async () => {
        await db.recordings.delete(r.id);
        await db.assets.delete(r.assetId);
      });
      notify('Gravação excluída.');
    } catch (err) {
      notify(errorText(err), 'error');
    }
  };
  const takes = recordings
    .filter(r => !filter || r.segmentId === filter)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const comparable = filter ? [...takes].reverse() : [];
  const segmentTitle = (id?: string) => segments.find(s => s.id === id)?.title;
  // Grouped by piece: titles such as "Introdução" or "Seção A" repeat across pieces.
  const byTitle = (a: { title: string }, b: { title: string }) =>
    a.title.localeCompare(b.title, 'pt-BR', { numeric: true });
  const segmentGroups = [
    ...[...pieces]
      .sort(byTitle)
      .map(p => ({ id: p.id, label: p.title, items: segments.filter(s => s.pieceId === p.id) })),
    { id: '', label: 'Sem peça', items: segments.filter(s => !pieces.some(p => p.id === s.pieceId)) },
  ].filter(g => g.items.length);
  const segmentOptions: ReactNode = segmentGroups.map(g => (
    <optgroup key={g.id} label={g.label}>
      {[...g.items].sort(byTitle).map(s => (
        <option key={s.id} value={s.id}>
          {s.title}
        </option>
      ))}
    </optgroup>
  ));
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">PERCEBA O CAMINHO PERCORRIDO</span>
          <h1>Sua evolução</h1>
          <p>Escute as mudanças. Registre as pequenas conquistas.</p>
        </div>
        <button className="btn secondary" onClick={() => setPreparing(true)}>
          <ClipboardList size={17} />
          Preparar próxima aula
        </button>
      </div>
      <div className="stats-grid">
        <div className="stat">
          <span>
            <Clock3 size={17} />
            Tempo de prática
          </span>
          <strong>
            {minutes}
            <small> min</small>
          </strong>
          <p>Exclui preparação e intervalos</p>
        </div>
        <div className="stat">
          <span>
            <AudioLines size={17} />
            Sessões
          </span>
          <strong>{filtered.length}</strong>
          <p>Concluídas e parciais</p>
        </div>
        <div className="stat">
          <span>
            <Target size={17} />
            Dias com prática
          </span>
          <strong>{days}</strong>
          <p>No histórico selecionado</p>
        </div>
      </div>
      <div className="toolbar">
        <div className="tabs">
          {(
            [
              ['history', 'Histórico'],
              ['recordings', 'Minhas gravações'],
              ['review', 'Revisões'],
            ] as const
          ).map(([k, v]) => (
            <button
              key={k}
              className={tab === k ? 'active' : ''}
              // Leaving the tab would unmount the Recorder and stop the take before it is saved.
              disabled={recording && k !== tab}
              aria-describedby={recording && k !== tab ? 'progress-tabs-locked' : undefined}
              onClick={() => setTab(k)}
            >
              {v}
            </button>
          ))}
        </div>
        {tab === 'review' ? (
          <select
            aria-label="Filtrar por peça"
            value={pieceFilter}
            onChange={e => setPieceFilter(e.target.value)}
          >
            <option value="">Todas as peças</option>
            {pieces
              .filter(p => segments.some(s => s.pieceId === p.id))
              .map(p => (
                <option key={p.id} value={p.id}>
                  {p.title}
                </option>
              ))}
          </select>
        ) : (
          <select aria-label="Filtrar por trecho" value={filter} onChange={e => changeFilter(e.target.value)}>
            <option value="">Todos os trechos</option>
            {segmentOptions}
          </select>
        )}
      </div>
      {recording && (
        <p id="progress-tabs-locked" className="hint tabs-locked">
          Termine a gravação para trocar de aba.
        </p>
      )}
      {tab === 'history' && (
        <>
          <TempoPanel
            sessions={sessions}
            segments={segments}
            pieces={pieces}
            filter={filter}
            onFilter={changeFilter}
          />
          {filtered.length ? (
            <div className="progress-list">
              {filtered.map(s => (
                <HistoryRow
                  key={s.id}
                  s={s}
                  canPractice={!!s.segmentId && segments.some(x => x.id === s.segmentId)}
                  onPractice={onPractice}
                />
              ))}
            </div>
          ) : filter ? (
            <Empty
              title="Nenhuma sessão deste trecho ainda"
              text="Quando você praticar este trecho, o tempo e o andamento aparecem aqui."
              action={
                <button className="link-btn" onClick={() => changeFilter('')}>
                  Ver todos os trechos
                </button>
              }
            />
          ) : (
            <Empty
              title="Cada sessão conta uma história"
              text="Ao encerrar uma prática, seu tempo e suas observações aparecem aqui."
            />
          )}
        </>
      )}
      {tab === 'recordings' && (
        <>
          {comparable.length >= 2 && <ComparePanel key={filter} takes={comparable} sessions={sessions} />}
          <div className="settings-grid">
            <section className="panel">
              <h2>Gravar uma tentativa</h2>
              <p className="hint">
                Grave o trecho como está hoje. Com duas ou mais tentativas do mesmo trecho, você pode
                compará-las lado a lado.
              </p>
              <Field
                label="Vincular ao trecho"
                hint={recording ? 'Termine a gravação para trocar o trecho.' : undefined}
              >
                <select
                  value={link}
                  disabled={recording}
                  onChange={e => {
                    setLinkTouched(true);
                    chooseLink(e.target.value);
                  }}
                >
                  <option value="">Nenhum (prática livre)</option>
                  {segmentOptions}
                </select>
              </Field>
              <div className="form-grid">
                <Field label="Andamento (BPM)">
                  <input
                    type="number"
                    min={20}
                    max={300}
                    inputMode="numeric"
                    value={recordBpm}
                    onChange={e => {
                      setLinkTouched(true);
                      setRecordBpm(e.target.value);
                    }}
                    placeholder="Opcional"
                  />
                </Field>
                <Field label="Mão">
                  <select
                    value={recordHand}
                    onChange={e => {
                      setLinkTouched(true);
                      setRecordHand(e.target.value as Hand | '');
                    }}
                  >
                    <option value="">Não informada</option>
                    {Object.entries(hands).map(([k, v]) => (
                      <option key={k} value={k}>
                        {v}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
              <Field label="Nome da tentativa (opcional)">
                <input
                  value={recordTitle}
                  maxLength={160}
                  onChange={e => setRecordTitle(e.target.value)}
                  placeholder="Ex.: Antes de rever o dedilhado"
                />
              </Field>
              <Recorder
                profile="music"
                origin={{ kind: 'attempt', segmentId: link || undefined }}
                onFile={saveRecording}
                onBusyChange={onRecorderBusy}
                label="Gravar tentativa"
              />
              <label className="btn secondary file-button import-attempt">
                <Plus size={16} />
                Importar tentativa
                <input
                  type="file"
                  accept="audio/*"
                  onChange={async e => {
                    const f = e.target.files?.[0];
                    if (f)
                      try {
                        if (!f.type.startsWith('audio/')) throw new Error('Escolha um arquivo de áudio.');
                        await saveRecording(f);
                      } catch (err) {
                        notify(errorText(err), 'error');
                      }
                    e.target.value = '';
                  }}
                />
              </label>
            </section>
            <section className="panel">
              <h2>Tentativas salvas</h2>
              {!filter && takes.length >= 2 && (
                <p className="hint">Para comparar duas tentativas, escolha o trecho no filtro acima.</p>
              )}
              {takes.map(r => {
                const { bpm, hand } = takeDetails(r, sessions);
                return (
                  <div className="recording-row" key={r.id}>
                    <div className="row between">
                      <strong>{r.title}</strong>
                      <button
                        className="icon-btn"
                        aria-label={`Excluir gravação ${r.title}`}
                        onClick={() => void removeRecording(r)}
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                    <span className="hint">
                      {[
                        formatDate(r.createdAt),
                        !filter && segmentTitle(r.segmentId),
                        bpm && `${bpm} BPM`,
                        hand && hands[hand],
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                    <RecordingPlayer assetId={r.assetId} />
                    <div className="row wrap" style={{ marginTop: 10 }}>
                      <button
                        className="btn small secondary"
                        disabled={!!repairingId}
                        onClick={() => void repairRecording(r)}
                      >
                        {repairingId === r.id ? 'Preparando cópia…' : 'Criar cópia reproduzível'}
                      </button>
                      <RecordingDownload assetId={r.assetId} />
                    </div>
                  </div>
                );
              })}
              {!takes.length && (
                <p className="subtle-text">
                  {filter ? 'Nenhuma gravação deste trecho ainda.' : 'Suas gravações aparecerão aqui.'}
                </p>
              )}
            </section>
          </div>
        </>
      )}
      {tab === 'review' && (
        <ReviewBoard
          segments={segments}
          pieces={pieces}
          sessions={sessions}
          pieceFilter={pieceFilter}
          onPractice={onPractice}
          notify={notify}
        />
      )}
      {preparing && (
        <LessonPrep
          onClose={() => setPreparing(false)}
          notify={notify}
          sessions={sessions}
          segments={segments}
          pieces={pieces}
        />
      )}
    </>
  );
}
