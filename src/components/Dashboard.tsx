import { useLiveQuery } from 'dexie-react-hooks';
import {
  ArrowUpRight,
  BookOpen,
  Check,
  Clock3,
  Music2,
  Play,
  Plus,
  Target,
  Headphones,
  CalendarDays,
} from 'lucide-react';
import { db } from '../db';
import { localDay, formatDate, hands } from '../domain';
import { Badge, Empty, errorText } from './common';
export default function Dashboard({
  onNavigate,
  onPiece,
  onPractice,
  onAdd,
  notify,
}: {
  onNavigate: (s: string) => void;
  onPiece: (id: string) => void;
  onPractice: (id: string) => void;
  onAdd: () => void;
  notify: (s: string) => void;
}) {
  const pieces = useLiveQuery(() => db.pieces.orderBy('updatedAt').reverse().toArray()) ?? [];
  const segments = useLiveQuery(() => db.segments.toArray()) ?? [];
  const sessions = useLiveQuery(() => db.sessions.toArray()) ?? [];
  const lessons = useLiveQuery(() => db.lessons.orderBy('date').reverse().limit(3).toArray()) ?? [];
  const tasks = useLiveQuery(() => db.tasks.toArray()) ?? [];
  const today = localDay(),
    todaySessions = sessions.filter(s => localDay(new Date(s.startedAt)) === today);
  const minutes = Math.round(todaySessions.reduce((s, r) => s + r.activeSeconds, 0) / 60),
    studying = pieces.filter(p => p.status === 'studying');
  const pending = tasks.filter(t => !t.done),
    reviews = segments.filter(s => s.reviewDate && s.reviewDate <= today);
  const next = reviews[0] ?? segments.find(s => s.rating !== 'comfortable') ?? segments[0];
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - 6 + i);
    const key = localDay(d);
    return {
      key,
      label: d.toLocaleDateString('pt-BR', { weekday: 'short' }).replace('.', ''),
      seconds: sessions
        .filter(s => localDay(new Date(s.startedAt)) === key)
        .reduce((sum, s) => sum + s.activeSeconds, 0),
    };
  });
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">
            {new Date()
              .toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })
              .toLocaleUpperCase('pt-BR')}
          </span>
          <h1>Hoje, ao piano.</h1>
          <p>Um pouco de atenção. Um novo passo na sua música.</p>
        </div>
        <button className="btn secondary" onClick={onAdd}>
          <Plus size={17} />
          Adicionar peça
        </button>
      </div>
      <div className="stats-grid">
        <div className="stat">
          <span>
            <Clock3 size={17} />
            Prática de hoje
          </span>
          <strong>
            {minutes}
            <small> min</small>
          </strong>
          <p>{todaySessions.length} sessão(ões) registradas</p>
        </div>
        <div className="stat">
          <span>
            <BookOpen size={17} />
            Em estudo
          </span>
          <strong>
            {studying.length}
            <small> peça(s)</small>
          </strong>
          <p>{pieces.length} no seu repertório</p>
        </div>
        <div className="stat">
          <span>
            <Target size={17} />
            Próximos passos
          </span>
          <strong>
            {pending.length}
            <small> tarefa(s)</small>
          </strong>
          <p>{reviews.length} trecho(s) para revisar</p>
        </div>
      </div>
      <div className="dashboard-grid">
        <div>
          <section className="focus-card">
            <div className="focus-copy">
              <span className="eyebrow">{next ? 'CONTINUE DE ONDE PAROU' : 'SEU ESPAÇO DE PRÁTICA'}</span>
              <h2>{next?.title ?? 'Qual será o próximo trecho?'}</h2>
              <p>
                {next?.goal ?? 'Abra uma partitura, marque o que merece atenção e pratique no seu tempo.'}
              </p>
              {next && (
                <div className="focus-meta">
                  <span>{next.measures ? `Compassos ${next.measures}` : next.difficulty}</span>
                  <span>{hands[next.hand]}</span>
                  <span>{next.bpm} BPM</span>
                </div>
              )}
              <button
                className="btn light"
                onClick={() => (next ? onPractice(next.id) : onNavigate('practice'))}
              >
                <Play size={17} fill="currentColor" />
                {next ? 'Praticar este trecho' : 'Abrir metrônomo'}
              </button>
            </div>
            <div className="focus-emblem" aria-hidden="true">
              <Music2 size={90} strokeWidth={0.7} />
              <span>
                UM COMPASSO
                <br />
                DE CADA VEZ
              </span>
            </div>
          </section>
          <section className="panel dashboard-repertoire">
            <div className="section-heading">
              <h2>No seu repertório</h2>
              <button className="link-btn" onClick={() => onNavigate('library')}>
                Ver todas <ArrowUpRight size={16} />
              </button>
            </div>
            {pieces.length ? (
              pieces.slice(0, 4).map((p, i) => (
                <button className="repertoire-row" key={p.id} onClick={() => onPiece(p.id)}>
                  <div className={`mini-cover tone-${i % 4}`}>
                    <BookOpen size={25} strokeWidth={1} />
                  </div>
                  <div className="grow">
                    <h3>{p.title}</h3>
                    <p>{p.composer || 'Compositor não informado'}</p>
                  </div>
                  <Badge variant={p.status}>
                    {p.status === 'studying'
                      ? 'Estudando'
                      : p.status === 'learned'
                        ? 'Estudada'
                        : 'Quero estudar'}
                  </Badge>
                  <ArrowUpRight size={17} />
                </button>
              ))
            ) : (
              <Empty
                title="Seu repertório está esperando"
                text="Importe sua primeira partitura para começar."
                action={
                  <button className="link-btn" onClick={onAdd}>
                    Adicionar uma peça <Plus size={16} />
                  </button>
                }
              />
            )}
          </section>
        </div>
        <aside>
          <section className="panel week-panel">
            <div className="section-heading">
              <h2>Seu ritmo na semana</h2>
              <CalendarDays size={18} />
            </div>
            <div className="week-bars">
              {days.map(d => (
                <div key={d.key}>
                  <div className="bar-track">
                    <span
                      style={{
                        height: d.seconds
                          ? `${Math.max(8, (d.seconds / Math.max(1800, ...days.map(x => x.seconds))) * 100)}%`
                          : '3px',
                      }}
                      className={d.key === today ? 'today' : ''}
                    />
                  </div>
                  <span>{d.label}</span>
                  <strong>{Math.round(d.seconds / 60)}m</strong>
                </div>
              ))}
            </div>
            <p className="hint">Tempo de prática ativa, sem as pausas.</p>
          </section>
          <section className="panel">
            <div className="section-heading">
              <h2>Para o próximo estudo</h2>
              <Target size={18} />
            </div>
            {pending.length ? (
              pending.slice(0, 5).map(t => (
                <div className="task-row" key={t.id}>
                  <button
                    className="check-button"
                    aria-label={`Concluir ${t.title}`}
                    onClick={async () => {
                      try {
                        await db.tasks.update(t.id, { done: true });
                      } catch (e) {
                        notify(errorText(e));
                      }
                    }}
                  >
                    <Check size={13} />
                  </button>
                  <div>
                    <strong>{t.title}</strong>
                    <small>{pieces.find(p => p.id === t.pieceId)?.title ?? 'Tarefa da aula'}</small>
                  </div>
                </div>
              ))
            ) : (
              <p className="subtle-text">As tarefas que você criar nas peças e nas aulas aparecem aqui.</p>
            )}
          </section>
          <section className="panel">
            <div className="section-heading">
              <h2>Últimas aulas</h2>
              <Headphones size={18} />
            </div>
            {lessons.length ? (
              lessons.map(l => (
                <button className="simple-row" key={l.id} onClick={() => onNavigate('lessons')}>
                  <div>
                    <strong>{l.title}</strong>
                    <small>{formatDate(l.date)}</small>
                  </div>
                  <ArrowUpRight size={16} />
                </button>
              ))
            ) : (
              <p className="subtle-text">Guarde gravações e orientações no seu caderno de aulas.</p>
            )}
            <button className="link-btn" onClick={() => onNavigate('lessons')}>
              Abrir caderno <ArrowUpRight size={15} />
            </button>
          </section>
        </aside>
      </div>
    </>
  );
}
