import { useState, type FormEvent } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  ArrowDown,
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
  ListChecks,
  ListPlus,
  Settings2,
} from 'lucide-react';
import { db } from '../db';
import { localDay, formatDate, hands, uid, type Session } from '../domain';
import { Badge, Empty, Field, Modal, errorText, type Notify } from './common';
import { buildDailyPlan, dueReviews, pickFocus, planToRoutine, reasonText } from '../practice/plan';
import {
  goalProgress,
  lastDays,
  parseGoal,
  plural,
  practiceStreak,
  reachedBpm,
  relativeDay,
  secondsByDay,
  type WeeklyGoal,
} from '../practice/stats';
import '../styles/progress.css';

const GOAL_KEY = 'compasso:weekly-goal',
  BUDGET_KEY = 'compasso:plan-minutes';
const budgets = [15, 30, 45];

/** localStorage may be unavailable (private mode, blocked site data); these preferences then last one visit. */
function readStored(key: string) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function writeStored(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* Kept in memory only. */
  }
}

export default function Dashboard({
  onNavigate,
  onPiece,
  onPractice,
  onLesson,
  onAdd,
  notify,
}: {
  onNavigate: (s: string) => void;
  onPiece: (id: string) => void;
  onPractice: (id: string) => void;
  /** Opens that lesson (the list when absent). */
  onLesson?: (id: string) => void;
  onAdd: () => void;
  notify: Notify;
}) {
  const pieces = useLiveQuery(() => db.pieces.orderBy('updatedAt').reverse().toArray()) ?? [];
  const segments = useLiveQuery(() => db.segments.toArray()) ?? [];
  const sessions = useLiveQuery(() => db.sessions.toArray()) ?? [];
  const lessons = useLiveQuery(() => db.lessons.orderBy('date').reverse().limit(3).toArray()) ?? [];
  const tasks = useLiveQuery(() => db.tasks.toArray()) ?? [];
  const [budget, setBudget] = useState(() => {
    const stored = Number(readStored(BUDGET_KEY));
    return budgets.includes(stored) ? stored : 30;
  });
  const today = localDay(),
    todaySessions = sessions.filter(s => localDay(new Date(s.startedAt)) === today);
  const minutes = Math.round(todaySessions.reduce((s, r) => s + r.activeSeconds, 0) / 60),
    studying = pieces.filter(p => p.status === 'studying');
  const pending = tasks.filter(t => !t.done),
    reviews = dueReviews(segments, today);
  const plan = buildDailyPlan({ segments, sessions, tasks, pieces, today, budget });
  const routineItems = planToRoutine(plan.items);
  // Saving the same plan twice would only duplicate the routine; the button re-enables when the plan changes.
  const planKey = `${today}:${JSON.stringify(routineItems)}`;
  const [savedPlan, setSavedPlan] = useState('');
  const focus = pickFocus(segments, sessions, pieces, today);
  const next = focus?.segment;
  const lastBpm = focus?.session ? reachedBpm(focus.session) : null;
  const overdue = focus?.source === 'review' ? reviews.find(r => r.segment.id === next?.id)?.daysOverdue : 0;
  const showPlan = () => {
    document.getElementById('plano-de-hoje')?.scrollIntoView({ block: 'start' });
    document.getElementById('plano-de-hoje-titulo')?.focus({ preventScroll: true });
  };
  const saveRoutine = async () => {
    try {
      await db.routines.add({
        id: uid(),
        title: `Plano de ${formatDate(today)} · ${plan.minutes} min`,
        items: routineItems,
      });
      setSavedPlan(planKey);
      notify('Plano salvo. Ele aparece em Praticar › Rotinas de estudo.');
    } catch (e) {
      notify(errorText(e), 'error');
    }
  };
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
          <p>
            {todaySessions.length
              ? plural(todaySessions.length, 'sessão registrada', 'sessões registradas')
              : 'Nenhuma sessão ainda'}
          </p>
        </div>
        <div className="stat">
          <span>
            <BookOpen size={17} />
            Em estudo
          </span>
          <strong>
            {studying.length}
            <small> {studying.length === 1 ? 'peça' : 'peças'}</small>
          </strong>
          <p>{pieces.length ? `${pieces.length} no seu repertório` : 'Repertório vazio'}</p>
        </div>
        <div className="stat">
          <span>
            <Target size={17} />
            Próximos passos
          </span>
          <strong>
            {pending.length}
            <small> {pending.length === 1 ? 'tarefa' : 'tarefas'}</small>
          </strong>
          {reviews.length ? (
            <button className="link-btn stat-link" onClick={showPlan}>
              {plural(reviews.length, 'trecho para revisar', 'trechos para revisar')}
              <ArrowDown size={14} />
            </button>
          ) : (
            <p>Nenhuma revisão para hoje</p>
          )}
        </div>
      </div>
      <div className="dashboard-grid">
        <div>
          <section className="focus-card">
            <div className="focus-copy">
              <span className="eyebrow">
                {!focus
                  ? 'SEU ESPAÇO DE PRÁTICA'
                  : focus.source === 'resume'
                    ? 'CONTINUE DE ONDE PAROU'
                    : focus.source === 'review'
                      ? 'PARA REVISAR HOJE'
                      : 'PRÓXIMO TRECHO'}
              </span>
              <h2>{next?.title ?? 'Qual será o próximo trecho?'}</h2>
              <p>
                {focus?.session?.nextStep?.trim()
                  ? `Próximo passo: ${focus.session.nextStep.trim()}`
                  : next
                    ? next.goal ||
                      'Um passo de cada vez: escute, ajuste e repita no andamento em que tudo soa claro.'
                    : 'Abra uma partitura, marque o que merece atenção e pratique no seu tempo.'}
              </p>
              {next && (
                <div className="focus-meta">
                  {(next.measures || next.difficulty) && (
                    <span>{next.measures ? `Compassos ${next.measures}` : next.difficulty}</span>
                  )}
                  <span>{hands[next.hand]}</span>
                  {focus?.session ? (
                    <span>
                      Última prática {relativeDay(focus.session.startedAt, today)}
                      {lastBpm ? ` · ${lastBpm} BPM` : ''}
                    </span>
                  ) : (
                    <span>{next.bpm} BPM</span>
                  )}
                  {overdue ? <span>Revisão atrasada {plural(overdue, 'dia', 'dias')}</span> : null}
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
          <section className="panel plan-panel" id="plano-de-hoje" aria-labelledby="plano-de-hoje-titulo">
            <div className="section-heading">
              <div>
                <ListChecks size={18} />
                <h2 id="plano-de-hoje-titulo" tabIndex={-1}>
                  Plano de hoje
                </h2>
              </div>
              <div className="plan-budget" role="group" aria-label="Tempo disponível hoje">
                {budgets.map(m => (
                  <button
                    key={m}
                    aria-pressed={budget === m}
                    className={budget === m ? 'active' : ''}
                    onClick={() => {
                      setBudget(m);
                      writeStored(BUDGET_KEY, String(m));
                    }}
                  >
                    {m} min
                  </button>
                ))}
              </div>
            </div>
            {plan.items.length ? (
              <>
                <ol className="plan-list">
                  {plan.items.map(item => (
                    <li className="plan-item" key={item.segment.id}>
                      <div className="grow">
                        <strong>{item.segment.title}</strong>
                        <small>
                          {[
                            item.pieceTitle,
                            item.segment.measures && `c. ${item.segment.measures}`,
                            hands[item.segment.hand],
                            item.lastPractice && `praticado ${relativeDay(item.lastPractice, today)}`,
                          ]
                            .filter(Boolean)
                            .join(' · ')}
                        </small>
                        <span className="plan-reasons">
                          {item.reasons.map((r, i) => (
                            <span key={i} className={`plan-reason ${r.kind}`}>
                              {reasonText(r)}
                            </span>
                          ))}
                        </span>
                      </div>
                      <span className="plan-minutes">{item.minutes} min</span>
                      <button
                        className="btn small"
                        aria-label={`Praticar ${item.segment.title}`}
                        onClick={() => onPractice(item.segment.id)}
                      >
                        <Play size={14} />
                        Praticar
                      </button>
                    </li>
                  ))}
                </ol>
                <div className="plan-footer">
                  <span>
                    {plan.minutes} min de prática
                    {plan.leftover
                      ? ` · ${plural(plan.leftover, 'trecho fica', 'trechos ficam')} para outro momento`
                      : ''}
                  </span>
                  {savedPlan === planKey ? (
                    <span className="plan-saved" role="status">
                      <Check size={15} />
                      Salvo em Rotinas de estudo
                    </span>
                  ) : (
                    <button className="link-btn" onClick={() => void saveRoutine()}>
                      <ListPlus size={15} />
                      Salvar como rotina
                    </button>
                  )}
                </div>
                {plan.leftoverReviews.length > 0 && (
                  <details className="plan-later">
                    <summary>
                      {plan.leftoverReviews.length === 1
                        ? 'Ver a revisão que não coube no tempo de hoje'
                        : `Ver as ${plan.leftoverReviews.length} revisões que não couberam no tempo de hoje`}
                    </summary>
                    <ul>
                      {plan.leftoverReviews.map(({ segment, pieceTitle, daysOverdue }) => (
                        <li key={segment.id}>
                          <div className="grow">
                            <strong>{segment.title}</strong>
                            <small>
                              {[
                                pieceTitle,
                                reasonText(
                                  daysOverdue ? { kind: 'overdue', days: daysOverdue } : { kind: 'due' },
                                ),
                              ]
                                .filter(Boolean)
                                .join(' · ')}
                            </small>
                          </div>
                          <button
                            className="btn small secondary"
                            aria-label={`Praticar ${segment.title}`}
                            onClick={() => onPractice(segment.id)}
                          >
                            <Play size={14} />
                            Praticar
                          </button>
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </>
            ) : (
              <p className="subtle-text">
                {segments.length
                  ? 'Nada pendente por hoje: nenhuma revisão, tarefa ou trecho difícil. Escolha uma peça e pratique livremente.'
                  : 'Marque trechos nas suas partituras e o plano do dia aparece aqui, com revisões e tarefas.'}
              </p>
            )}
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
                    <strong className="repertoire-title">{p.title}</strong>
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
          <WeekPanel sessions={sessions} today={today} />
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
                        notify(errorText(e), 'error');
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
                <button
                  className="simple-row"
                  key={l.id}
                  onClick={() => (onLesson ? onLesson(l.id) : onNavigate('lessons'))}
                >
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

function WeekPanel({ sessions, today }: { sessions: Session[]; today: string }) {
  const [goal, setGoal] = useState<WeeklyGoal>(() => parseGoal(readStored(GOAL_KEY)));
  const [editing, setEditing] = useState(false);
  const days = lastDays(today, 7);
  const seconds = secondsByDay(sessions, days);
  const progress = goalProgress(goal, seconds);
  const streak = practiceStreak(sessions, today);
  const scale = Math.max(1800, progress.lineMinutes * 60 * 1.25, ...seconds);
  const linePercent = ((progress.lineMinutes * 60) / scale) * 100;
  const headline =
    goal.mode === 'days'
      ? `${progress.done} de ${plural(goal.days, 'dia', 'dias')}`
      : `${progress.done} de ${goal.minutes} min`;
  return (
    <section className="panel week-panel">
      <div className="section-heading">
        <h2>Seu ritmo na semana</h2>
        <CalendarDays size={18} />
      </div>
      <div className="week-goal">
        <div className="row between">
          <p>
            <strong>{headline}</strong>{' '}
            {goal.mode === 'days'
              ? `com ${goal.dayMinutes} min ou mais nos últimos 7 dias`
              : 'nos últimos 7 dias'}
          </p>
          <button className="link-btn" onClick={() => setEditing(true)}>
            <Settings2 size={14} />
            Ajustar meta
          </button>
        </div>
        <div
          className="goal-meter"
          role="progressbar"
          aria-label="Meta semanal"
          aria-valuemin={0}
          aria-valuemax={progress.target}
          aria-valuenow={Math.min(progress.done, progress.target)}
          aria-valuetext={headline}
        >
          <span
            style={{ width: `${Math.min(100, (progress.done / Math.max(1, progress.target)) * 100)}%` }}
          />
        </div>
        {(progress.met || streak.days >= 2) && (
          <p className="week-note">
            {progress.met && (
              <>
                <Check size={14} /> Meta alcançada.{' '}
              </>
            )}
            {streak.days >= 2 &&
              `${streak.days} dias seguidos de prática${streak.includesToday ? '' : ' até ontem'}.`}
          </p>
        )}
      </div>
      <div className="week-bars" role="list" aria-label="Minutos de prática nos últimos 7 dias">
        {days.map((key, i) => {
          const d = new Date(`${key}T12:00:00`),
            m = Math.round(seconds[i] / 60),
            met = progress.dayMet[i];
          return (
            <div
              key={key}
              role="listitem"
              aria-label={`${d.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })}: ${m} min${met ? ', meta do dia alcançada' : ''}`}
            >
              <div className="bar-track" aria-hidden="true">
                <i className="goal-line" style={{ bottom: `${linePercent}%` }} />
                <span
                  style={{
                    height: seconds[i] ? `${Math.max(8, (seconds[i] / scale) * 100)}%` : '3px',
                  }}
                  className={[key === today && 'today', met && 'met'].filter(Boolean).join(' ')}
                />
              </div>
              <span aria-hidden="true">
                {d.toLocaleDateString('pt-BR', { weekday: 'short' }).replace('.', '')}
              </span>
              <strong aria-hidden="true">
                {m}m{met && <Check size={10} strokeWidth={3} />}
              </strong>
            </div>
          );
        })}
      </div>
      <p className="hint">
        Tempo de prática ativa, sem as pausas. A linha marca{' '}
        {goal.mode === 'days'
          ? `${goal.dayMinutes} min por dia`
          : `a média diária para a meta (${progress.lineMinutes} min)`}
        .
      </p>
      {editing && (
        <GoalForm
          goal={goal}
          onClose={() => setEditing(false)}
          onSave={next => {
            setGoal(next);
            writeStored(GOAL_KEY, JSON.stringify(next));
            setEditing(false);
          }}
        />
      )}
    </section>
  );
}

function GoalForm({
  goal,
  onClose,
  onSave,
}: {
  goal: WeeklyGoal;
  onClose: () => void;
  onSave: (goal: WeeklyGoal) => void;
}) {
  const [mode, setMode] = useState(goal.mode);
  const [days, setDays] = useState(String(goal.mode === 'days' ? goal.days : 5)),
    [dayMinutes, setDayMinutes] = useState(String(goal.mode === 'days' ? goal.dayMinutes : 15)),
    [weekMinutes, setWeekMinutes] = useState(String(goal.mode === 'minutes' ? goal.minutes : 120));
  const submit = (e: FormEvent) => {
    e.preventDefault();
    onSave(
      parseGoal(
        JSON.stringify(
          mode === 'days'
            ? { mode, days: Number(days), dayMinutes: Number(dayMinutes) }
            : { mode, minutes: Number(weekMinutes) },
        ),
      ),
    );
  };
  return (
    <Modal title="Meta semanal" onClose={onClose} guard>
      <form onSubmit={submit}>
        <fieldset className="goal-modes">
          <legend>O que conta para a meta?</legend>
          <label>
            <input type="radio" name="goal-mode" checked={mode === 'days'} onChange={() => setMode('days')} />
            Dias com prática
          </label>
          <label>
            <input
              type="radio"
              name="goal-mode"
              checked={mode === 'minutes'}
              onChange={() => setMode('minutes')}
            />
            Minutos na semana
          </label>
        </fieldset>
        {mode === 'days' ? (
          <div className="form-grid">
            <Field label="Dias por semana">
              <input
                type="number"
                min={1}
                max={7}
                required
                value={days}
                onChange={e => setDays(e.target.value)}
              />
            </Field>
            <Field label="Mínimo em cada dia (min)">
              <input
                type="number"
                min={1}
                max={240}
                required
                value={dayMinutes}
                onChange={e => setDayMinutes(e.target.value)}
              />
            </Field>
          </div>
        ) : (
          <Field label="Minutos por semana">
            <input
              type="number"
              min={10}
              max={3000}
              step={5}
              required
              value={weekMinutes}
              onChange={e => setWeekMinutes(e.target.value)}
            />
          </Field>
        )}
        <p className="hint">
          A meta considera os últimos 7 dias e fica salva neste navegador. Ela é uma referência para manter a
          regularidade, não uma cobrança.
        </p>
        <footer className="modal-actions">
          <button type="button" className="btn secondary" onClick={onClose}>
            Cancelar
          </button>
          <button className="btn">Salvar meta</button>
        </footer>
      </form>
    </Modal>
  );
}
