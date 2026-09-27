import { useEffect, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Play, Pause, Square, Save, SlidersHorizontal, RotateCcw, Music2, Volume2 } from 'lucide-react';
import { db } from '../db';
import {
  defaultConfig,
  configSchema,
  hands,
  uid,
  now,
  clock,
  type Hand,
  type PracticeConfig,
  type Rating,
} from '../domain';
import { PracticeEngine } from '../practice/engine';
import { activeSeconds, buildTimeline, completedRounds, positionAt } from '../practice/timeline';
import { Modal, Field, ErrorBox, Badge, errorText } from './common';
import ScoreViewer from './ScoreViewer';
import Routines from './Routines';

export default function Practice({
  selectedId,
  onSelect,
  notify,
}: {
  selectedId: string;
  onSelect: (id: string) => void;
  notify: (s: string) => void;
}) {
  const segments = useLiveQuery(() => db.segments.toArray()) ?? [],
    presets = useLiveQuery(() => db.presets.toArray()) ?? [];
  const selected = segments.find(s => s.id === selectedId);
  const score = useLiveQuery(
    () => (selected?.scoreId ? db.scores.get(selected.scoreId) : undefined),
    [selected?.scoreId],
  );
  const [config, setConfig] = useState<PracticeConfig>({ ...defaultConfig }),
    [hand, setHand] = useState<Hand>('both');
  const [running, setRunning] = useState(false),
    [started, setStarted] = useState(false),
    [elapsed, setElapsed] = useState(0),
    [error, setError] = useState('');
  const [settings, setSettings] = useState(false),
    [result, setResult] = useState<string>(),
    [rating, setRating] = useState<Rating>('improving'),
    [note, setNote] = useState('');
  const [presetName, setPresetName] = useState<string | null>(null);
  const engine = useRef<PracticeEngine | null>(null),
    sessionId = useRef<string | null>(null),
    startedAt = useRef(''),
    sessionInfo = useRef({
      title: 'Prática livre',
      hand: 'both' as Hand,
      segmentId: undefined as string | undefined,
      pieceId: undefined as string | undefined,
    });
  const lock = useRef<WakeLockSentinel | null>(null),
    startPending = useRef(false),
    checkpointAt = useRef(0);
  const rounds = buildTimeline(config),
    position = positionAt(rounds, elapsed),
    total = rounds.at(-1)!.end;
  const persist = async (complete: boolean, finalize = true) => {
    const current = engine.current,
      id = sessionId.current;
    if (!current || !id) return;
    if (finalize) sessionId.current = null;
    try {
      await db.sessions.put({
        id,
        ...sessionInfo.current,
        config: { ...current.config },
        startedAt: startedAt.current,
        endedAt: now(),
        activeSeconds: activeSeconds(current.rounds, current.elapsed),
        completedRepetitions: completedRounds(current.rounds, current.elapsed),
        note: '',
        completed: complete,
      });
      return id;
    } catch (e) {
      if (finalize && !sessionId.current) sessionId.current = id;
      notify(`Não foi possível salvar a sessão: ${errorText(e)}`);
    }
  };
  useEffect(() => {
    if (!started && selected) {
      setConfig(c => ({ ...c, bpm: selected.bpm, targetBpm: Math.max(c.targetBpm, selected.bpm) }));
      setHand(selected.hand);
    }
  }, [selected?.id]);
  useEffect(() => {
    const hide = () => {
      if (document.hidden && engine.current?.running) {
        engine.current.pause();
        setElapsed(engine.current.elapsed);
        setRunning(false);
        void persist(false, false);
        void lock.current?.release();
        notify('Prática pausada porque a tela ficou inativa.');
      }
    };
    document.addEventListener('visibilitychange', hide);
    const leave = (e: BeforeUnloadEvent) => {
      if (sessionId.current) {
        e.preventDefault();
      }
    };
    window.addEventListener('beforeunload', leave);
    return () => {
      document.removeEventListener('visibilitychange', hide);
      window.removeEventListener('beforeunload', leave);
      if (engine.current) {
        engine.current.pause();
        void persist(false);
        void engine.current.destroy();
      }
      void lock.current?.release();
    };
  }, []);
  const release = () => {
    void lock.current?.release();
    lock.current = null;
  };
  const finish = async (complete: boolean) => {
    engine.current?.pause();
    setRunning(false);
    setStarted(false);
    release();
    const id = await persist(complete);
    if (id) {
      setResult(id);
      setNote('');
      setRating('improving');
    }
  };
  const start = async () => {
    if (startPending.current) return;
    startPending.current = true;
    setError('');
    try {
      configSchema.parse(config);
      if (!Number.isInteger(rounds[0].beatsPerBar))
        throw new Error('Escolha uma unidade de BPM que divida o compasso em pulsações inteiras.');
      if (!engine.current || !sessionId.current) {
        await engine.current?.destroy();
        setElapsed(0);
        checkpointAt.current = 0;
        sessionInfo.current = {
          title: selected?.title ?? 'Prática livre',
          hand,
          segmentId: selected?.id,
          pieceId: selected?.pieceId,
        };
        startedAt.current = now();
        sessionId.current = uid();
        engine.current = new PracticeEngine({ ...config }, (value, complete) => {
          setElapsed(value);
          if (complete) void finish(true);
          else if (value - checkpointAt.current >= 5) {
            checkpointAt.current = value;
            void persist(false, false);
          }
        });
      }
      await engine.current.start();
      setStarted(true);
      setRunning(true);
      void persist(false, false);
      if ('wakeLock' in navigator)
        try {
          lock.current = await navigator.wakeLock.request('screen');
        } catch {
          /* may be denied by device */
        }
      engine.current.context?.addEventListener('statechange', () => {
        if (engine.current?.running && engine.current.context?.state === 'suspended') {
          engine.current.pause();
          setRunning(false);
          setElapsed(engine.current.elapsed);
          notify('O áudio foi interrompido. Toque em continuar quando estiver pronto.');
        }
      });
    } catch (e) {
      setError(errorText(e));
      if (!started) {
        sessionId.current = null;
        await engine.current?.destroy();
        engine.current = null;
      }
    } finally {
      startPending.current = false;
    }
  };
  function update<K extends keyof PracticeConfig>(key: K, value: PracticeConfig[K]) {
    setConfig(c => ({ ...c, [key]: value }));
    setElapsed(0);
  }
  const numeric = (label: string, key: keyof PracticeConfig, min: number, max: number) => (
    <Field label={label}>
      <input
        type="number"
        value={Number(config[key])}
        min={min}
        max={max}
        required
        onChange={e => {
          const n = Number(e.target.value);
          if (Number.isFinite(n)) update(key, Math.min(max, Math.max(min, n)));
        }}
      />
    </Field>
  );
  const bpm = position.round.bpm;
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">PRESENÇA EM CADA COMPASSO</span>
          <h1>Hora de praticar</h1>
          <p>Escolha um trecho. Encontre seu ritmo.</p>
        </div>
        <Badge variant={running ? 'studying' : ''}>
          {running ? 'Em prática' : started ? 'Pausado' : 'Pronto para começar'}
        </Badge>
      </div>
      <div className={`practice-layout ${score ? 'with-score' : ''}`}>
        <section className="practice-console">
          <Routines
            disabled={started}
            notify={notify}
            onStart={(id, minutes) => {
              const segment = segments.find(s => s.id === id);
              onSelect(id);
              setConfig({
                ...defaultConfig,
                mode: 'seconds',
                seconds: minutes * 60,
                repetitions: 1,
                bpm: segment?.bpm ?? 60,
                targetBpm: Math.max(90, segment?.bpm ?? 60),
              });
              setElapsed(0);
            }}
          />
          <div className="practice-selector">
            <Field label="O que vamos estudar?">
              <select
                value={selectedId}
                disabled={started}
                onChange={e => {
                  onSelect(e.target.value);
                  setElapsed(0);
                }}
              >
                <option value="">Prática livre / metrônomo</option>
                {segments.map(s => (
                  <option key={s.id} value={s.id}>
                    {s.title}
                    {s.measures ? ` · c. ${s.measures}` : ''}
                  </option>
                ))}
              </select>
            </Field>
            {selected?.goal && <p className="practice-goal">{selected.goal}</p>}
            <div className="hand-switch" aria-label="Mão a praticar">
              {Object.entries(hands).map(([key, label]) => (
                <button
                  key={key}
                  disabled={started}
                  className={hand === key ? 'active' : ''}
                  onClick={() => setHand(key as Hand)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div className={`metronome-face ${running ? 'is-playing' : ''}`}>
            <span className="eyebrow">
              {position.phase === 'complete'
                ? 'SESSÃO CONCLUÍDA'
                : started
                  ? {
                      preparation: 'PREPARE-SE',
                      practice: 'PRATIQUE',
                      rest: 'RESPIRE',
                      complete: 'CONCLUÍDO',
                    }[position.phase]
                  : 'SEU ANDAMENTO'}
            </span>
            <div className="bpm-control">
              <button
                aria-label="Diminuir BPM"
                disabled={started || config.bpm <= 20}
                onClick={() => update('bpm', config.bpm - 1)}
              >
                −
              </button>
              <div>
                <strong>{started ? bpm : config.bpm}</strong>
                <span>
                  BPM ·{' '}
                  {config.beatUnit === 'dotted-quarter'
                    ? 'semínima pontuada'
                    : config.beatUnit === 'eighth'
                      ? 'colcheia'
                      : 'semínima'}
                </span>
              </div>
              <button
                aria-label="Aumentar BPM"
                disabled={started || config.bpm >= 300}
                onClick={() => update('bpm', config.bpm + 1)}
              >
                +
              </button>
            </div>
            <input
              type="range"
              aria-label="Andamento em BPM"
              min={20}
              max={240}
              value={Math.min(240, config.bpm)}
              disabled={started}
              onChange={e => update('bpm', Number(e.target.value))}
            />
            <div
              className="beat-dots"
              aria-label={`Pulso ${Math.floor(position.beat) + 1} de ${rounds[0].beatsPerBar}`}
            >
              {Array.from({ length: Math.max(1, Math.floor(rounds[0].beatsPerBar)) }, (_, i) => (
                <span
                  key={i}
                  className={`${i === 0 ? 'accent' : ''} ${running && position.phase !== 'rest' && Math.floor(position.beat) === i ? 'lit' : ''}`}
                />
              ))}
            </div>
            <div className="cycle-info">
              <div>
                <span>Repetição</span>
                <strong>
                  {started || elapsed > 0 ? position.round.index + 1 : '—'}{' '}
                  <small>/ {config.repetitions}</small>
                </strong>
              </div>
              <div>
                <span>{position.phase === 'rest' ? 'Intervalo' : 'Tempo restante'}</span>
                <strong>{clock(started ? position.remaining : total)}</strong>
              </div>
            </div>
            <div
              className="session-progress"
              role="progressbar"
              aria-label="Progresso da sessão"
              aria-valuenow={Math.round((elapsed / total) * 100)}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              <span style={{ width: `${Math.min(100, (elapsed / total) * 100)}%` }} />
            </div>
            <div className="transport">
              {running ? (
                <button
                  className="btn play-btn"
                  onClick={() => {
                    engine.current?.pause();
                    setElapsed(engine.current?.elapsed ?? 0);
                    setRunning(false);
                    release();
                  }}
                >
                  <Pause size={22} />
                  Pausar
                </button>
              ) : (
                <button className="btn play-btn" onClick={() => void start()}>
                  <Play size={22} fill="currentColor" />
                  {started ? 'Continuar' : 'Iniciar prática'}
                </button>
              )}
              {started && (
                <button className="btn secondary" onClick={() => void finish(false)}>
                  <Square size={18} />
                  Encerrar
                </button>
              )}
            </div>
            <ErrorBox message={error} />
            <p className="quiet-hint">
              <Volume2 size={14} />
              Mantenha a tela ativa durante o estudo.
            </p>
          </div>
          <div className="practice-summary">
            <span>
              {config.numerator}/{config.denominator}
            </span>
            <span>{config.mode === 'bars' ? `${config.bars} compassos` : `${config.seconds} segundos`}</span>
            <span>{config.countInBars} de preparação</span>
            <span>{config.restSeconds}s de pausa</span>
          </div>
          <div className="row wrap">
            <button className="btn secondary" disabled={started} onClick={() => setSettings(true)}>
              <SlidersHorizontal size={17} />
              Configurar ciclos
            </button>
            <button
              className="btn secondary"
              disabled={started}
              onClick={() => setPresetName(selected?.title ?? 'Minha prática')}
            >
              <Save size={16} />
              Salvar configuração
            </button>
          </div>
          {presets.length > 0 && (
            <Field label="Minhas configurações">
              <select
                disabled={started}
                value=""
                onChange={e => {
                  const preset = presets.find(p => p.id === e.target.value);
                  if (preset) {
                    setConfig(preset.config);
                    setElapsed(0);
                    if (preset.segmentId) onSelect(preset.segmentId);
                  }
                }}
              >
                <option value="">Carregar uma configuração…</option>
                {presets.map(p => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </Field>
          )}
        </section>
        {score ? (
          <section className="score-card practice-score">
            <div className="section-heading">
              <div>
                <Music2 size={18} />
                <h2>{selected?.title}</h2>
              </div>
              <Badge>{selected?.measures ? `c. ${selected.measures}` : 'Partitura'}</Badge>
            </div>
            <ScoreViewer
              score={score}
              targetRegion={selected?.regions[0]}
              notify={notify}
              onRegion={() => notify('Para criar outro trecho, abra a peça no repertório.')}
            />
          </section>
        ) : (
          <aside className="practice-tips">
            <span className="eyebrow">UM PLANO SIMPLES</span>
            <h2>
              Menos pressa.
              <br />
              Mais atenção.
            </h2>
            <ol>
              <li>
                <strong>Escolha um objetivo</strong>
                <p>Um trecho, uma mão, uma dificuldade por vez.</p>
              </li>
              <li>
                <strong>Comece confortável</strong>
                <p>Use um andamento que permita ouvir o que está tocando.</p>
              </li>
              <li>
                <strong>Observe ao terminar</strong>
                <p>Registre o que melhorou e o que quer rever.</p>
              </li>
            </ol>
            <div className="tip-note">
              <RotateCcw size={21} />
              <p>O ciclo marca o tempo. Você e seu professor avaliam a música.</p>
            </div>
          </aside>
        )}
      </div>
      {settings && (
        <Modal title="Seu ciclo de prática" onClose={() => setSettings(false)} wide>
          <div className="form-grid three">
            {numeric('BPM inicial', 'bpm', 20, 300)}
            {numeric('Numerador', 'numerator', 1, 12)}
            <Field label="Denominador">
              <select
                value={config.denominator}
                onChange={e => update('denominator', Number(e.target.value))}
              >
                {[2, 4, 8, 16].map(n => (
                  <option key={n}>{n}</option>
                ))}
              </select>
            </Field>
            <Field label="Unidade do BPM">
              <select
                value={config.beatUnit}
                onChange={e => update('beatUnit', e.target.value as PracticeConfig['beatUnit'])}
              >
                <option value="quarter">Semínima</option>
                <option value="dotted-quarter">Semínima pontuada</option>
                <option value="eighth">Colcheia</option>
              </select>
            </Field>
            <Field label="Subdivisões">
              <select
                value={config.subdivision}
                onChange={e => update('subdivision', Number(e.target.value))}
              >
                {[1, 2, 3, 4].map(n => (
                  <option key={n}>{n}</option>
                ))}
              </select>
            </Field>
            <Field label="Duração por">
              <select
                value={config.mode}
                onChange={e => update('mode', e.target.value as 'bars' | 'seconds')}
              >
                <option value="bars">Compassos</option>
                <option value="seconds">Segundos</option>
              </select>
            </Field>
            {config.mode === 'bars'
              ? numeric('Compassos por repetição', 'bars', 1, 128)
              : numeric('Segundos por repetição', 'seconds', 5, 3600)}
            {numeric('Repetições', 'repetitions', 1, 100)}
            {numeric('Compassos de preparação', 'countInBars', 0, 4)}
            {numeric('Pausa entre repetições (s)', 'restSeconds', 0, 300)}
            {numeric('Aumentar a cada N repetições (0 = não)', 'increaseEvery', 0, 20)}
            {numeric('Aumento em BPM', 'increaseBpm', 1, 20)}
            {numeric('BPM máximo', 'targetBpm', 20, 300)}
            {numeric('Compassos audíveis', 'audibleBars', 1, 16)}
            {numeric('Compassos silenciosos (0 = não)', 'silentBars', 0, 8)}
          </div>
          <p className="hint">
            Preparação antes de cada repetição. Sem pausa após a última. O modo por segundos pode terminar no
            meio do compasso. Pausar e continuar preserva a posição, sem uma nova contagem.
          </p>
          <p>
            <strong>Previsão:</strong> {clock(total)} de sessão · {clock(activeSeconds(rounds, total))} de
            prática.
          </p>
          <footer className="modal-actions">
            <button className="btn" onClick={() => setSettings(false)}>
              Aplicar configuração
            </button>
          </footer>
        </Modal>
      )}
      {presetName !== null && (
        <Modal title="Salvar configuração" onClose={() => setPresetName(null)}>
          <form
            onSubmit={async e => {
              e.preventDefault();
              try {
                await db.presets.put({
                  id: uid(),
                  name: presetName.trim(),
                  segmentId: selectedId || undefined,
                  config,
                });
                setPresetName(null);
                notify('Configuração salva.');
              } catch (err) {
                notify(errorText(err));
              }
            }}
          >
            <Field label="Nome">
              <input
                autoFocus
                required
                value={presetName}
                maxLength={120}
                onChange={e => setPresetName(e.target.value)}
              />
            </Field>
            <footer className="modal-actions">
              <button className="btn" disabled={!presetName.trim()}>
                Salvar
              </button>
            </footer>
          </form>
        </Modal>
      )}
      {result && (
        <Modal title="Como foi a prática?" onClose={() => setResult(undefined)}>
          <p>A sessão já está salva. Acrescente sua percepção para acompanhar a evolução.</p>
          <div className="rating-buttons">
            {(
              [
                ['difficult', 'Difícil'],
                ['improving', 'Melhorando'],
                ['comfortable', 'Confortável'],
              ] as const
            ).map(([k, v]) => (
              <button key={k} className={rating === k ? 'selected' : ''} onClick={() => setRating(k)}>
                {v}
              </button>
            ))}
          </div>
          <Field label="O que você percebeu?">
            <textarea
              rows={3}
              value={note}
              maxLength={3000}
              onChange={e => setNote(e.target.value)}
              placeholder="Ex.: a passagem ficou mais regular hoje."
            />
          </Field>
          <footer className="modal-actions">
            <button
              className="btn"
              onClick={async () => {
                try {
                  await db.sessions.update(result, { rating, note });
                  if (sessionInfo.current.segmentId)
                    await db.segments.update(sessionInfo.current.segmentId, { rating });
                  setResult(undefined);
                  notify('Observação salva no histórico.');
                } catch (err) {
                  notify(errorText(err));
                }
              }}
            >
              Salvar observação
            </button>
          </footer>
        </Modal>
      )}
    </>
  );
}
