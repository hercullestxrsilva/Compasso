import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  Play,
  Pause,
  Square,
  Save,
  SlidersHorizontal,
  RotateCcw,
  Music2,
  Volume2,
  Pointer,
  SkipForward,
  Timer,
  Settings2,
} from 'lucide-react';
import { db, storeAsset } from '../db';
import { setActivity } from '../activity';
import {
  defaultConfig,
  configSchema,
  hands,
  uid,
  now,
  clock,
  formatDate,
  type Hand,
  type PracticeConfig,
  type Rating,
  type Routine,
} from '../domain';
import { PracticeEngine, type Preroll } from '../practice/engine';
import {
  beatsPerBar,
  buildTimeline,
  isSilentBar,
  maxBpmReached,
  positionAt,
  type Round,
} from '../practice/timeline';
import {
  completeConfig,
  deviceVolume,
  groupByPiece,
  parseTarget,
  pieceDefaultConfig,
  readDevice,
  rememberedConfig,
  segmentConfig,
  tapTempo,
  writeDevice,
} from '../practice/setup';
import { nextStepIndex, resolveStep, stepDetail, TRANSITION_SECONDS } from '../practice/routine';
import { Modal, Field, ErrorBox, Badge, errorText, type Notify } from './common';
import ScoreViewer from './ScoreViewer';
import Recorder from './Recorder';
import Routines from './Routines';
import CycleSettings from './practice/CycleSettings';
import SessionReview, { quickRate, type ReviewInfo } from './practice/SessionReview';
import PresetManager from './practice/PresetManager';
import {
  BeatDots,
  CycleSummary,
  PracticeTips,
  PresetOptions,
  RoutineStrip,
  RoutineTransition,
  TargetOptions,
  type RoutineRun,
} from './practice/Parts';
import '../styles/practice.css';

/** Sessions with less practice than this are not kept in the history. */
const MIN_ACTIVE_SECONDS = 5;

interface SessionInfo {
  kind: 'segment' | 'piece' | 'free';
  title: string;
  hand: Hand;
  segmentId?: string;
  pieceId?: string;
  intention?: string;
  routineId?: string;
}
interface AttemptContext {
  segmentId?: string;
  title: string;
  sessionId?: string;
  bpm?: number;
  hand: Hand;
}
interface Handlers {
  update: (elapsed: number, complete: boolean) => void;
  interrupted: () => void;
  persist: (complete: boolean) => Promise<unknown>;
  hidden: () => void;
  toggle: () => void;
  stop: () => Promise<void>;
  startStep: (run: RoutineRun) => Promise<void>;
  attemptContext: () => AttemptContext;
}
type PhaseKey = 'idle' | 'paused' | 'preparation' | 'practice' | 'rest' | 'complete';

const beatUnitNames = {
  quarter: 'semínima',
  'dotted-quarter': 'semínima pontuada',
  eighth: 'colcheia',
} as const;

export default function Practice({
  selectedId,
  onSelect,
  notify,
}: {
  selectedId: string;
  onSelect: (id: string) => void;
  notify: Notify;
}) {
  const segmentsQuery = useLiveQuery(() => db.segments.toArray()),
    piecesQuery = useLiveQuery(() => db.pieces.toArray()),
    presets = useLiveQuery(() => db.presets.toArray()) ?? [];
  const segments = useMemo(() => segmentsQuery ?? [], [segmentsQuery]),
    pieces = useMemo(() => piecesQuery ?? [], [piecesQuery]);
  const loaded = segmentsQuery !== undefined && piecesQuery !== undefined;
  const target = parseTarget(selectedId);
  const segment = target.kind === 'segment' ? segments.find(s => s.id === target.id) : undefined;
  const wholePiece = target.kind === 'piece' ? pieces.find(p => p.id === target.id) : undefined;
  const scorePieceId = wholePiece?.id ?? '';
  const score = useLiveQuery(async () => {
    if (segment?.scoreId) return db.scores.get(segment.scoreId);
    if (scorePieceId) return (await db.scores.where('pieceId').equals(scorePieceId).sortBy('createdAt'))[0];
    return undefined;
  }, [segment?.scoreId, scorePieceId]);
  const lastNextStep =
    useLiveQuery(async () => {
      const t = parseTarget(selectedId);
      if (t.kind === 'free') return '';
      const list = await db.sessions
        .where(t.kind === 'segment' ? 'segmentId' : 'pieceId')
        .equals(t.id)
        .reverse()
        .sortBy('startedAt');
      return (
        list.find(s => (t.kind === 'segment' || s.kind === 'piece') && s.nextStep?.trim())?.nextStep ?? ''
      );
    }, [selectedId]) ?? '';

  const [config, setConfig] = useState<PracticeConfig>(defaultConfig),
    [hand, setHand] = useState<Hand>('both'),
    [intention, setIntention] = useState('');
  const [running, setRunning] = useState(false),
    [started, setStarted] = useState(false),
    [elapsed, setElapsed] = useState(0),
    [liveRounds, setLiveRounds] = useState<Round[] | null>(null),
    [preroll, setPreroll] = useState<Preroll | null>(null),
    [current, setCurrent] = useState<SessionInfo | null>(null),
    [error, setError] = useState('');
  const [settings, setSettings] = useState(false),
    [review, setReview] = useState<ReviewInfo | null>(null),
    [presetName, setPresetName] = useState<string | null>(null),
    [presetId, setPresetId] = useState(''),
    [managing, setManaging] = useState(false);
  const [volume, setVolume] = useState(deviceVolume),
    [resumeWithCountIn, setResumeWithCountIn] = useState(() => readDevice().resumeWithCountIn !== false),
    [taps, setTaps] = useState<number[]>([]),
    [run, setRunState] = useState<RoutineRun | null>(null);
  const engine = useRef<PracticeEngine | null>(null),
    audio = useRef<AudioContext | null>(null),
    sessionId = useRef<string | null>(null),
    recentSession = useRef<string | undefined>(undefined),
    startedAt = useRef(''),
    sessionInfo = useRef<SessionInfo>({ kind: 'free', title: 'Prática livre', hand: 'both' }),
    runRef = useRef<RoutineRun | null>(null),
    appliedFor = useRef<string | null>(null),
    attempt = useRef<AttemptContext | null>(null),
    latest = useRef<Handlers | null>(null);
  const lock = useRef<WakeLockSentinel | null>(null),
    startPending = useRef(false),
    checkpointAt = useRef(0),
    tapTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const planned = useMemo(() => buildTimeline(config), [config]);
  const rounds = liveRounds ?? planned,
    total = rounds.at(-1)!.end,
    position = positionAt(rounds, elapsed);
  const timer = config.metronome === false;
  const routineActive = run !== null;
  const busy = started || routineActive;

  const setRun = (next: RoutineRun | null) => {
    // Once the routine is over, the console goes back to the selection's own cycle (not the step's).
    if (!next && runRef.current) appliedFor.current = null;
    runRef.current = next;
    setRunState(next);
  };
  const resetTimeline = () => {
    setElapsed(0);
    setLiveRounds(null);
    setPresetId('');
  };
  function update<K extends keyof PracticeConfig>(key: K, value: PracticeConfig[K]) {
    setConfig(c => ({ ...c, [key]: value }));
    resetTimeline();
  }

  // Pointing the screen at a trecho, a piece or free practice restores what was used there last time. A
  // preset or a routine step sets `appliedFor` first so its own values are not overwritten.
  useEffect(() => {
    if (!loaded || started || routineActive || appliedFor.current === selectedId) return;
    // null: first visit, or the same selection again after a routine.
    const moved = appliedFor.current !== null;
    appliedFor.current = selectedId;
    const device = readDevice();
    if (segment) {
      setConfig(segmentConfig(segment));
      setHand(segment.hand);
    } else if (wholePiece) {
      setConfig(completeConfig(device.pieces?.[wholePiece.id], pieceDefaultConfig));
      setHand('both');
    } else {
      setConfig(completeConfig(device.free));
      setHand('both');
    }
    setElapsed(0);
    setLiveRounds(null);
    setPresetId('');
    setError('');
    if (moved) {
      setIntention('');
      recentSession.current = undefined;
    }
  }, [loaded, started, routineActive, selectedId, segment, wholePiece]);

  /** Resumes the shared AudioContext inside the tap (iPad Safari only allows it there). */
  const unlockAudio = () => {
    try {
      if (!audio.current || audio.current.state === 'closed') audio.current = new AudioContext();
      void audio.current.resume().catch(() => {});
    } catch {
      /* Without Web Audio the timer still works. */
    }
  };
  const release = () => {
    void lock.current?.release().catch(() => {});
    lock.current = null;
  };
  const keepAwake = async () => {
    if (!('wakeLock' in navigator) || lock.current) return;
    try {
      lock.current = await navigator.wakeLock.request('screen');
    } catch {
      /* may be denied by device */
    }
  };
  const destroyEngine = async () => {
    const e = engine.current;
    engine.current = null;
    await e?.destroy();
  };

  const persist = async (
    complete: boolean,
    finalize = true,
  ): Promise<'saved' | 'short' | 'failed' | undefined> => {
    const e = engine.current,
      id = sessionId.current;
    if (!e || !id) return;
    const active = e.activeSeconds;
    // Checkpoints only start once there is something worth keeping.
    if (!finalize && active < MIN_ACTIVE_SECONDS) return;
    if (finalize) sessionId.current = null;
    try {
      if (active < MIN_ACTIVE_SECONDS) {
        await db.sessions.delete(id);
        return 'short';
      }
      await db.sessions.put({
        id,
        ...sessionInfo.current,
        config: { ...e.config },
        startedAt: startedAt.current,
        endedAt: now(),
        activeSeconds: active,
        completedRepetitions: e.completedRepetitions,
        note: '',
        completed: complete,
      });
      return 'saved';
    } catch (err) {
      if (finalize && !sessionId.current) sessionId.current = id;
      notify(`Não foi possível salvar a sessão: ${errorText(err)}`, 'error');
      return 'failed';
    }
  };

  /** Shows a routine step in the console (trecho, cycle, hand) without starting it. */
  const showStep = (routine: Routine, index: number) => {
    const item = routine.items[index];
    const plan = resolveStep(
      item,
      segments.find(s => s.id === item.segmentId),
    );
    if (!plan) return null;
    const selection = plan.segmentId ?? '';
    appliedFor.current = selection;
    if (selection !== selectedId) onSelect(selection);
    setConfig(plan.config);
    setHand(plan.hand);
    resetTimeline();
    return plan;
  };

  const finish = async (complete: boolean, advance = false) => {
    const e = engine.current,
      id = sessionId.current;
    if (!e || !id) return;
    e.pause();
    setElapsed(e.elapsed);
    setPreroll(null);
    setRunning(false);
    setStarted(false);
    release();
    const info = sessionInfo.current;
    const maxBpm = e.silent ? undefined : maxBpmReached(e.rounds, e.elapsed);
    const result = await persist(complete);
    const r = runRef.current;
    if (r && (complete || advance)) {
      const next = nextStepIndex(r.routine.items, r.index + 1, segments);
      if (next >= 0) {
        setRun({
          routine: r.routine,
          index: next,
          countdown: TRANSITION_SECONDS,
          last:
            result === 'saved' ? { sessionId: id, segmentId: info.segmentId, title: info.title } : undefined,
        });
        showStep(r.routine, next);
        return;
      }
    }
    if (r) setRun(null);
    if (result === 'short') notify('Menos de 5 segundos de prática: a sessão não foi salva.', 'info');
    else if (result === 'saved')
      setReview({
        sessionId: id,
        title: info.title,
        segmentId: info.segmentId,
        intention: info.intention,
        maxBpm,
        completed: complete,
        routineTitle: r && complete ? r.routine.title : undefined,
      });
  };

  /** Remembers the cycle used, so the next visit starts from it. Routine steps are derived, not remembered. */
  const remember = (cfg: PracticeConfig, info: SessionInfo) => {
    if (info.routineId) return;
    if (info.kind === 'segment' && info.segmentId)
      db.segments
        .update(info.segmentId, { practiceConfig: rememberedConfig(cfg) })
        .catch(err => notify(`Não foi possível lembrar o ciclo deste trecho: ${errorText(err)}`, 'error'));
    else if (info.kind === 'piece' && info.pieceId) {
      const { [info.pieceId]: _previous, ...others } = readDevice().pieces ?? {};
      writeDevice({ pieces: { ...others, [info.pieceId]: cfg } });
    } else writeDevice({ free: cfg });
  };

  const begin = async ({
    config: cfg,
    hand: h,
    info,
  }: {
    config: PracticeConfig;
    hand: Hand;
    info: SessionInfo;
  }) => {
    if (startPending.current) return;
    startPending.current = true;
    setError('');
    try {
      if (!configSchema.safeParse(cfg).success)
        throw new Error('Revise o ciclo de prática: há um valor fora do permitido.');
      if (!Number.isInteger(beatsPerBar(cfg)))
        throw new Error('Escolha uma unidade de BPM que divida o compasso em pulsações inteiras.');
      await destroyEngine();
      checkpointAt.current = 0;
      setElapsed(0);
      setPreroll(null);
      sessionInfo.current = { ...info, hand: h };
      setCurrent(sessionInfo.current);
      startedAt.current = now();
      const id = uid();
      sessionId.current = id;
      recentSession.current = id;
      const e = new PracticeEngine({ ...cfg }, (value, complete) => latest.current?.update(value, complete), {
        context: audio.current,
        volume,
        onInterrupted: () => latest.current?.interrupted(),
      });
      engine.current = e;
      setLiveRounds(e.rounds);
      await e.start();
      setStarted(true);
      setRunning(true);
      remember(cfg, sessionInfo.current);
      void keepAwake();
    } catch (err) {
      setError(errorText(err));
      sessionId.current = null;
      await destroyEngine();
      setCurrent(null);
      setLiveRounds(null);
      if (runRef.current) setRun({ ...runRef.current, countdown: null });
    } finally {
      startPending.current = false;
    }
  };

  const resume = async () => {
    const e = engine.current;
    if (!e || startPending.current) return;
    startPending.current = true;
    setError('');
    try {
      await e.resume(resumeWithCountIn);
      setRunning(true);
      void keepAwake();
    } catch (err) {
      setError(errorText(err));
    } finally {
      startPending.current = false;
    }
  };

  const pause = () => {
    const e = engine.current;
    if (!e) return;
    e.pause();
    setElapsed(e.elapsed);
    setPreroll(null);
    setRunning(false);
    release();
    void persist(false, false);
  };

  const targetInfo = (): SessionInfo => {
    const base = { hand, intention: intention.trim() || undefined };
    if (segment)
      return {
        ...base,
        kind: 'segment',
        title: segment.title,
        segmentId: segment.id,
        pieceId: segment.pieceId,
      };
    if (wholePiece)
      return { ...base, kind: 'piece', title: `Peça inteira · ${wholePiece.title}`, pieceId: wholePiece.id };
    return { ...base, kind: 'free', title: 'Prática livre' };
  };

  const startStep = async (r: RoutineRun) => {
    if (startPending.current) return;
    const index = nextStepIndex(r.routine.items, r.index, segments);
    const plan = index >= 0 ? showStep(r.routine, index) : null;
    if (!plan) {
      setRun(null);
      notify('Rotina encerrada: os próximos trechos não existem mais.', 'info');
      return;
    }
    setRun({ routine: r.routine, index, countdown: null });
    await begin({
      config: plan.config,
      hand: plan.hand,
      info: {
        kind: plan.segmentId ? 'segment' : 'free',
        title: plan.title,
        hand: plan.hand,
        segmentId: plan.segmentId,
        pieceId: plan.pieceId,
        intention: intention.trim() || undefined,
        routineId: r.routine.id,
      },
    });
  };

  const play = () => {
    unlockAudio();
    if (engine.current && sessionId.current) void resume();
    else if (runRef.current) void startStep(runRef.current);
    else void begin({ config, hand, info: targetInfo() });
  };
  const restart = () => {
    const e = engine.current;
    if (!e) return;
    unlockAudio();
    e.restartRound();
    if (!e.running) void resume();
  };
  const retime = (delta: number) => {
    const e = engine.current;
    if (e?.retime(delta)) setLiveRounds([...e.rounds]);
  };
  const skipStep = () => {
    const r = runRef.current;
    if (!r) return;
    const next = nextStepIndex(r.routine.items, r.index + 1, segments);
    if (next < 0) {
      setRun(null);
      notify('Rotina encerrada.', 'info');
      return;
    }
    setRun({ routine: r.routine, index: next, countdown: r.countdown === null ? null : TRANSITION_SECONDS });
    showStep(r.routine, next);
  };
  const rateLast = async (rating: Rating) => {
    const r = runRef.current,
      last = r?.last;
    if (!r || !last) return;
    try {
      await quickRate(last.sessionId, last.segmentId, rating);
      if (runRef.current === r) setRun({ ...r, last: { ...last, rating } });
    } catch (err) {
      notify(`Não foi possível salvar a avaliação: ${errorText(err)}`, 'error');
    }
  };
  const setMetronome = (on: boolean) => {
    setConfig(c => {
      const { metronome: _metronome, ...rest } = c;
      return on ? rest : { ...rest, metronome: false, mode: 'seconds' };
    });
    resetTimeline();
  };
  const tap = () => {
    const next = tapTempo(taps, performance.now() / 1000);
    setTaps(next.taps);
    if (next.bpm) update('bpm', next.bpm);
    clearTimeout(tapTimer.current);
    tapTimer.current = setTimeout(() => setTaps([]), 3000);
  };
  const changeVolume = (value: number) => {
    setVolume(value);
    engine.current?.setVolume(value);
    writeDevice({ volume: value });
  };
  const loadPreset = (id: string) => {
    const preset = presets.find(p => p.id === id);
    if (!preset) return setPresetId('');
    const presetSegment = segments.find(s => s.id === preset.segmentId);
    const selection = presetSegment ? presetSegment.id : selectedId;
    // The preset's own values (including its BPM) win over the segment's defaults.
    appliedFor.current = selection;
    if (selection !== selectedId) {
      onSelect(selection);
      if (presetSegment) setHand(presetSegment.hand);
      setIntention('');
    }
    setConfig(completeConfig(preset.config));
    setElapsed(0);
    setLiveRounds(null);
    setPresetId(id);
  };

  const shownBpm = !started
    ? config.bpm
    : position.phase === 'rest'
      ? (rounds[position.round.index + 1]?.bpm ?? position.round.bpm)
      : position.round.bpm;
  const attemptContext = (): AttemptContext => ({
    segmentId: started ? current?.segmentId : segment?.id,
    title: started && current ? current.title : targetInfo().title,
    sessionId: sessionId.current ?? undefined,
    bpm: timer ? undefined : shownBpm,
    hand,
  });
  const saveAttempt = async (file: File) => {
    const ctx = attempt.current ?? attemptContext();
    await db.transaction('rw', [db.assets, db.recordings, db.sessions], async () => {
      const candidate = ctx.sessionId ?? recentSession.current;
      const session = candidate ? await db.sessions.get(candidate) : undefined;
      const asset = await storeAsset(file);
      await db.recordings.add({
        id: uid(),
        assetId: asset.id,
        segmentId: ctx.segmentId,
        title: `${ctx.title} · ${formatDate(now())}`,
        createdAt: now(),
        sessionId: session?.id,
        bpm: ctx.bpm,
        hand: ctx.hand,
      });
    });
    notify('Tentativa gravada. Ouça em Evolução › Minhas gravações.');
  };
  const onRecorderBusy = useCallback((recording: boolean) => {
    if (!recording) attempt.current = null;
    else attempt.current ??= latest.current?.attemptContext() ?? null;
  }, []);
  const attemptOrigin = useMemo(
    () => ({ kind: 'attempt' as const, segmentId: current?.segmentId ?? segment?.id }),
    [current?.segmentId, segment?.id],
  );

  useLayoutEffect(() => {
    latest.current = {
      update: (value, complete) => {
        setElapsed(value);
        setPreroll(engine.current?.preroll ?? null);
        if (complete) void finish(true);
        else if (Math.abs(value - checkpointAt.current) >= 5) {
          checkpointAt.current = value;
          void persist(false, false);
        }
      },
      interrupted: () => {
        setRunning(false);
        setPreroll(null);
        release();
        void persist(false, false);
        notify('O áudio foi interrompido. Toque em continuar quando estiver pronto.', 'info');
      },
      persist,
      hidden: () => {
        if (!engine.current?.running) return;
        pause();
        notify('Prática pausada porque a tela ficou inativa.', 'info');
      },
      toggle: () => {
        if (!engine.current || !sessionId.current) return;
        if (engine.current.running) pause();
        else {
          unlockAudio();
          void resume();
        }
      },
      stop: async () => {
        if (engine.current && sessionId.current) await finish(false);
        else if (runRef.current) setRun(null);
      },
      startStep,
      attemptContext,
    };
  });

  useEffect(() => {
    const hide = () => {
      if (document.hidden) latest.current?.hidden();
    };
    const leave = (e: BeforeUnloadEvent) => {
      if (sessionId.current) e.preventDefault();
    };
    document.addEventListener('visibilitychange', hide);
    window.addEventListener('beforeunload', leave);
    return () => {
      document.removeEventListener('visibilitychange', hide);
      window.removeEventListener('beforeunload', leave);
      const e = engine.current;
      if (e) {
        e.pause();
        void latest.current?.persist(false).finally(() => e.destroy());
        engine.current = null;
      }
      void audio.current?.close().catch(() => {});
      audio.current = null;
      void lock.current?.release().catch(() => {});
      lock.current = null;
      clearTimeout(tapTimer.current);
      setActivity('practice', null);
    };
  }, []);

  // Space pauses and continues while a session is open (not while typing or on a focused control).
  useEffect(() => {
    if (!started) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== ' ' || e.repeat || e.altKey || e.ctrlKey || e.metaKey) return;
      if (
        (e.target as Element | null)?.closest?.(
          'input, textarea, select, button, a, [contenteditable], dialog',
        )
      )
        return;
      e.preventDefault();
      latest.current?.toggle();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [started]);

  // Between routine steps: count down (only while the screen is visible), then start the next step.
  const counting = run !== null && run.countdown !== null && !started;
  useEffect(() => {
    if (!counting) return;
    const tick = setInterval(() => {
      const r = runRef.current;
      if (document.hidden || !r || r.countdown === null) return;
      if (r.countdown <= 1) void latest.current?.startStep(r);
      else {
        const next = { ...r, countdown: r.countdown - 1 };
        runRef.current = next;
        setRunState(next);
      }
    }, 1000);
    return () => clearInterval(tick);
  }, [counting]);

  const nextItem = run ? run.routine.items[run.index] : undefined;
  const nextPlan = nextItem
    ? resolveStep(
        nextItem,
        segments.find(s => s.id === nextItem.segmentId),
      )
    : null;
  const activityLabel =
    started && current ? `Prática · ${current.title}` : run ? `Rotina · ${run.routine.title}` : '';
  const activityDetail = started
    ? `${running ? '' : 'Pausada · '}Rep ${position.round.index + 1}/${rounds.length} · ${clock(total - elapsed)}`
    : run
      ? run.countdown !== null
        ? `Próximo passo em ${run.countdown} s`
        : 'Aguardando o próximo passo'
      : '';
  useEffect(() => {
    if (!activityLabel) setActivity('practice', null);
    else
      setActivity('practice', {
        kind: 'practice',
        label: activityLabel,
        detail: activityDetail,
        stop: () => latest.current?.stop(),
      });
  }, [activityLabel, activityDetail]);

  const silentNow =
    started && running && !preroll && position.phase === 'practice' && isSilentBar(config, position.bar);
  const phaseKey: PhaseKey = !started
    ? elapsed > 0 && position.phase === 'complete'
      ? 'complete'
      : 'idle'
    : !running
      ? 'paused'
      : preroll
        ? 'preparation'
        : position.phase;
  const phaseText = {
    idle: run ? 'PRÓXIMO PASSO' : timer ? 'SEU CRONÔMETRO' : 'SEU ANDAMENTO',
    paused: 'PAUSADO',
    preparation: 'PREPARE-SE',
    practice: 'PRATIQUE',
    rest: 'RESPIRE',
    complete: 'SESSÃO CONCLUÍDA',
  }[phaseKey];
  const remaining = preroll ? preroll.remaining : position.remaining;
  const countIn =
    phaseKey === 'preparation' && !timer
      ? Math.max(1, Math.ceil(remaining / position.round.beatSeconds - 1e-6))
      : null;
  const beats = Math.max(1, Math.floor(rounds[0].beatsPerBar));
  const litBeat =
    !running || timer || silentNow
      ? -1
      : preroll
        ? preroll.beat
        : position.phase === 'preparation' || position.phase === 'practice'
          ? position.beat
          : -1;
  const flashKey = preroll
    ? `p${countIn}`
    : `${position.round.index}-${position.phase}-${position.beatCount}`;
  const canRetime =
    started &&
    !timer &&
    (!running || position.phase === 'rest') &&
    position.phase !== 'complete' &&
    (position.phase !== 'rest' || position.round.index + 1 < rounds.length);
  const remainingLabel = {
    idle: 'Duração',
    complete: 'Duração',
    paused:
      position.phase === 'rest'
        ? 'Intervalo'
        : position.phase === 'preparation'
          ? 'Preparação'
          : 'Tempo restante',
    preparation: 'Preparação',
    practice: 'Tempo restante',
    rest: 'Intervalo',
  }[phaseKey];
  const repetitionShown = started || elapsed > 0 ? position.round.index + 1 : '—';
  const progress = Math.min(100, (elapsed / total) * 100);
  const nextStepExists = run ? nextStepIndex(run.routine.items, run.index + 1, segments) >= 0 : false;
  const groups = groupByPiece(pieces, segments);

  const playButton = (className: string) =>
    running ? (
      <button className={`btn ${className}`} onClick={pause}>
        <Pause size={22} />
        Pausar
      </button>
    ) : (
      <button className={`btn ${className}`} onClick={play}>
        <Play size={22} fill="currentColor" />
        {started ? 'Continuar' : run ? `Começar passo ${run.index + 1}` : 'Iniciar prática'}
      </button>
    );
  const hud = (
    <div className="practice-hud" data-phase={phaseKey}>
      <span className="phase-pill">
        {phaseText}
        {countIn !== null && <b>{countIn}</b>}
      </span>
      <span className="hud-stat">
        <small>Rep</small> {repetitionShown}/{rounds.length}
      </span>
      {!timer && (
        <span className="hud-stat">
          {shownBpm} <small>BPM</small>
        </span>
      )}
      {!timer && <BeatDots compact count={beats} lit={litBeat} flashKey={flashKey} />}
      <span className="hud-stat">{clock(started ? remaining : total)}</span>
      {playButton('hud-play')}
      {started && !timer && (
        <button className="btn secondary hud-btn" aria-label="Recomeçar repetição" onClick={restart}>
          <RotateCcw size={20} />
        </button>
      )}
    </div>
  );

  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">PRESENÇA EM CADA COMPASSO</span>
          <h1>Hora de praticar</h1>
          <p>Escolha um trecho. Encontre seu ritmo.</p>
        </div>
        <Badge variant={running ? 'studying' : ''}>
          {running ? 'Em prática' : started ? 'Pausado' : run ? 'Rotina em andamento' : 'Pronto para começar'}
        </Badge>
      </div>
      <div className={`practice-layout ${score ? 'with-score' : ''} ${busy ? 'is-busy' : ''}`}>
        <section className="practice-console">
          {run && <RoutineStrip run={run} />}
          {run && !started && (
            <RoutineTransition
              run={run}
              nextTitle={nextPlan?.title ?? 'Trecho removido'}
              nextDetail={nextItem ? stepDetail(nextItem, nextPlan) : ''}
              onRate={rating => void rateLast(rating)}
              onWait={() => setRun({ ...run, countdown: null })}
              onSkip={skipStep}
              onEnd={() => setRun(null)}
            />
          )}
          {started && current && (
            <div className="practice-now">
              <strong>{current.title}</strong>
              <span>{hands[current.hand]}</span>
              {current.intention && <p>Hoje: “{current.intention}”</p>}
            </div>
          )}
          {!busy && (
            <>
              <Routines
                disabled={false}
                notify={notify}
                onStart={(routine, from) => {
                  unlockAudio();
                  void startStep({ routine, index: from, countdown: null });
                }}
              />
              <div className="practice-selector">
                <Field label="O que vamos estudar?">
                  <select
                    value={selectedId}
                    onChange={e => {
                      onSelect(e.target.value);
                      setElapsed(0);
                    }}
                  >
                    <TargetOptions groups={groups} />
                  </select>
                </Field>
                {segment?.goal && <p className="practice-goal">{segment.goal}</p>}
                <div className="hand-switch" role="group" aria-label="Mão a praticar">
                  {Object.entries(hands).map(([key, label]) => (
                    <button
                      key={key}
                      aria-pressed={hand === key}
                      className={hand === key ? 'active' : ''}
                      onClick={() => setHand(key as Hand)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <div className="hand-switch sound-switch" role="group" aria-label="Som da prática">
                  <button
                    aria-pressed={!timer}
                    className={!timer ? 'active' : ''}
                    onClick={() => setMetronome(true)}
                  >
                    <Music2 size={15} />
                    Metrônomo
                  </button>
                  <button
                    aria-pressed={timer}
                    className={timer ? 'active' : ''}
                    onClick={() => setMetronome(false)}
                  >
                    <Timer size={15} />
                    Só cronômetro
                  </button>
                </div>
                <Field label="Intenção de hoje (opcional)">
                  <input
                    value={intention}
                    maxLength={200}
                    placeholder="Hoje quero…"
                    onChange={e => setIntention(e.target.value)}
                  />
                </Field>
                {lastNextStep && intention.trim() !== lastNextStep.trim() && (
                  <button
                    className="link-btn intention-suggestion"
                    onClick={() => setIntention(lastNextStep)}
                  >
                    Usar o próximo passo anotado: “{lastNextStep}”
                  </button>
                )}
              </div>
            </>
          )}
          <div
            className={`metronome-face ${running ? 'is-playing' : ''} ${timer ? 'is-timer' : ''}`}
            data-phase={phaseKey}
          >
            <span className="phase-pill" aria-hidden="true">
              {phaseText}
              {countIn !== null && <b>{countIn}</b>}
            </span>
            <span className="practice-sr" aria-live="polite">
              {phaseText}
            </span>
            {timer ? (
              <div className="timer-readout">
                <strong>{clock(started ? remaining : total)}</strong>
                <span>{started ? (phaseKey === 'rest' ? 'de intervalo' : 'restantes') : 'no total'}</span>
              </div>
            ) : (
              <div className="bpm-control">
                <button
                  aria-label={started ? 'Diminuir o andamento' : 'Diminuir BPM'}
                  disabled={started ? !canRetime || shownBpm <= 20 : busy || config.bpm <= 20}
                  onClick={() => (started ? retime(-1) : update('bpm', config.bpm - 1))}
                >
                  −
                </button>
                <div>
                  <strong>{shownBpm}</strong>
                  <span>BPM · {beatUnitNames[config.beatUnit]}</span>
                </div>
                <button
                  aria-label={started ? 'Aumentar o andamento' : 'Aumentar BPM'}
                  disabled={started ? !canRetime || shownBpm >= 300 : busy || config.bpm >= 300}
                  onClick={() => (started ? retime(1) : update('bpm', config.bpm + 1))}
                >
                  +
                </button>
              </div>
            )}
            {started && !timer && (
              // Always present while practising so the buttons below never move between phases.
              <p className="retime-hint">
                {canRetime
                  ? position.phase === 'rest'
                    ? '− e + ajustam a próxima repetição'
                    : '− e + ajustam esta repetição'
                  : ''}
              </p>
            )}
            {!busy && !timer && (
              <input
                type="range"
                aria-label="Andamento em BPM"
                min={20}
                max={300}
                value={config.bpm}
                onChange={e => update('bpm', Number(e.target.value))}
              />
            )}
            {!timer && (
              <div className="metronome-tools">
                {!busy && (
                  <button type="button" className="btn small secondary" onClick={tap}>
                    <Pointer size={16} />
                    {taps.length === 1 ? 'Toque de novo' : 'Toque o pulso'}
                  </button>
                )}
                <label className="volume-control">
                  <Volume2 size={16} aria-hidden="true" />
                  <input
                    type="range"
                    aria-label="Volume do metrônomo"
                    aria-valuetext={`${Math.round(volume * 100)}%`}
                    min={0}
                    max={200}
                    step={5}
                    value={Math.round(volume * 100)}
                    onChange={e => changeVolume(Number(e.target.value) / 100)}
                  />
                </label>
              </div>
            )}
            {!timer && (
              <div className="beat-area">
                {silentNow ? (
                  <p className="silent-note">Em silêncio — continue contando</p>
                ) : (
                  <BeatDots count={beats} lit={litBeat} flashKey={flashKey} />
                )}
              </div>
            )}
            <div className="cycle-info">
              <div>
                <span>Repetição</span>
                <strong>
                  {repetitionShown} <small>/ {rounds.length}</small>
                </strong>
              </div>
              {!timer && config.mode === 'bars' && (
                <div>
                  <span>Compasso</span>
                  <strong>
                    {started && !preroll && position.phase === 'practice' ? position.bar : '—'}{' '}
                    <small>/ {config.bars}</small>
                  </strong>
                </div>
              )}
              <div>
                <span>{timer ? 'Sessão' : remainingLabel}</span>
                <strong>{clock(timer ? total - elapsed : started ? remaining : total)}</strong>
              </div>
            </div>
            <div
              className="session-progress"
              role="progressbar"
              aria-label="Progresso da sessão"
              aria-valuenow={Math.round(progress)}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              <span style={{ width: `${progress}%` }} />
            </div>
            <div className="transport">
              {playButton('play-btn')}
              {started && !timer && (
                <button className="btn secondary" onClick={restart}>
                  <RotateCcw size={18} />
                  Recomeçar repetição
                </button>
              )}
              {started && run && nextStepExists && (
                <button className="btn secondary" onClick={() => void finish(false, true)}>
                  <SkipForward size={18} />
                  Próximo passo
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
              {started
                ? 'Espaço pausa e continua. Mantenha a tela ativa.'
                : 'Mantenha a tela ativa durante o estudo.'}
            </p>
          </div>
          {!busy && (
            <>
              <CycleSummary config={config} />
              <div className="row wrap">
                <button className="btn secondary" onClick={() => setSettings(true)}>
                  <SlidersHorizontal size={17} />
                  Configurar ciclos
                </button>
                <button
                  className="btn secondary"
                  onClick={() => setPresetName(segment?.title ?? wholePiece?.title ?? 'Minha prática')}
                >
                  <Save size={16} />
                  Salvar configuração
                </button>
              </div>
              {presets.length > 0 && (
                <div className="preset-row">
                  <Field label="Minhas configurações">
                    <select value={presetId} onChange={e => loadPreset(e.target.value)}>
                      <PresetOptions presets={presets} segments={segments} segmentId={segment?.id} />
                    </select>
                  </Field>
                  <button className="btn secondary" onClick={() => setManaging(true)}>
                    <Settings2 size={16} />
                    Gerenciar
                  </button>
                </div>
              )}
            </>
          )}
          <div className="attempt-recorder">
            <Recorder
              profile="music"
              origin={attemptOrigin}
              label="Gravar tentativa"
              onFile={saveAttempt}
              onBusyChange={onRecorderBusy}
            />
          </div>
        </section>
        {score ? (
          <section className="score-card practice-score">
            <div className="section-heading">
              <div>
                <Music2 size={18} />
                <h2>{segment?.title ?? wholePiece?.title}</h2>
              </div>
              <Badge>
                {segment?.measures ? `c. ${segment.measures}` : wholePiece ? 'Peça inteira' : 'Partitura'}
              </Badge>
            </div>
            <ScoreViewer
              score={score}
              targetRegion={segment?.regions[0]}
              notify={notify}
              onRegion={() => notify('Para criar outro trecho, abra a peça no repertório.', 'info')}
              fullscreenOverlay={hud}
            />
          </section>
        ) : (
          <PracticeTips />
        )}
      </div>
      {settings && (
        <CycleSettings
          config={config}
          resumeWithCountIn={resumeWithCountIn}
          onClose={() => setSettings(false)}
          onApply={(next, resumeChoice) => {
            setConfig(next);
            resetTimeline();
            setResumeWithCountIn(resumeChoice);
            writeDevice({ resumeWithCountIn: resumeChoice });
            setSettings(false);
          }}
        />
      )}
      {managing && (
        <PresetManager
          presets={presets}
          segments={segments}
          notify={notify}
          onClose={() => setManaging(false)}
        />
      )}
      {presetName !== null && (
        <Modal title="Salvar configuração" onClose={() => setPresetName(null)} guard>
          <form
            onSubmit={async e => {
              e.preventDefault();
              try {
                const id = uid();
                await db.presets.put({ id, name: presetName.trim(), segmentId: segment?.id, config });
                setPresetName(null);
                setPresetId(id);
                notify('Configuração salva.');
              } catch (err) {
                notify(`Não foi possível salvar a configuração: ${errorText(err)}`, 'error');
              }
            }}
          >
            <Field
              label="Nome"
              hint={
                segment
                  ? `Fica ligada ao trecho “${segment.title}”.`
                  : 'Fica disponível para qualquer prática.'
              }
            >
              <input
                autoFocus
                required
                value={presetName}
                maxLength={120}
                onChange={e => setPresetName(e.target.value)}
              />
            </Field>
            <footer className="modal-actions">
              <button type="button" className="btn secondary" onClick={() => setPresetName(null)}>
                Cancelar
              </button>
              <button className="btn" disabled={!presetName.trim()}>
                Salvar
              </button>
            </footer>
          </form>
        </Modal>
      )}
      {review && (
        <SessionReview
          info={review}
          notify={notify}
          onDone={raised => {
            // The trecho's new tempo becomes the console's starting point right away.
            if (raised && !started && review.segmentId && review.segmentId === segment?.id)
              update('bpm', raised);
            setReview(null);
          }}
        />
      )}
    </>
  );
}
