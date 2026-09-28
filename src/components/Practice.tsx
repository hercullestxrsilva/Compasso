import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from 'react';
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
  Video,
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
  type Region,
  type Routine,
} from '../domain';
import { PracticeEngine, type Preroll } from '../practice/engine';
import {
  activeSeconds,
  beatsPerBar,
  buildTimeline,
  isLoop,
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
  sameConfig,
  segmentConfig,
  tapTempo,
  withMetronome,
  writeDevice,
} from '../practice/setup';
import { nextStepIndex, resolveStep, stepDetail, TRANSITION_SECONDS } from '../practice/routine';
import { Modal, Field, ErrorBox, Badge, errorText, type Notify } from './common';
import ScoreViewer from './ScoreViewer';
import Recorder from './Recorder';
import VideoRecorder from './VideoRecorder';
import Routines from './Routines';
import CycleSettings from './practice/CycleSettings';
import SessionReview, { quickRate, reviewContext, type ReviewInfo } from './practice/SessionReview';
import PresetManager from './practice/PresetManager';
import {
  BeatDots,
  CycleSummary,
  PracticeTips,
  PresetOptions,
  QuickRating,
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

/**
 * A transport button clicked with the mouse gives its focus back, so Space keeps pausing and continuing
 * instead of pressing that button again. Keyboard activation (detail 0) keeps the focus where it is.
 */
const releaseFocus = (e: ReactMouseEvent<HTMLElement>) => {
  if (e.detail > 0) e.currentTarget.blur();
};

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
    [run, setRunState] = useState<RoutineRun | null>(null),
    // The score was in full screen: a routine step after one without a score opens it in full screen again.
    [scoreFullscreen, setScoreFullscreen] = useState(false);
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
  // Continuous: no repetitions, rests or end — the clock counts up until the session is ended.
  const loop = isLoop(config);
  const routineActive = run !== null;
  const busy = started || routineActive;

  const setRun = (next: RoutineRun | null) => {
    // Once the routine is over, the console goes back to the selection's own cycle (not the step's).
    if (!next && runRef.current) appliedFor.current = null;
    if (!next) setScoreFullscreen(false);
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

  const finish = async (ended: boolean, advance = false) => {
    const e = engine.current,
      id = sessionId.current;
    if (!e || !id) return;
    // A continuous cycle has no end of its own: ending it is how it completes.
    const complete = ended || isLoop(e.config);
    e.pause();
    setElapsed(e.elapsed);
    setPreroll(null);
    setRunning(false);
    setStarted(false);
    release();
    const info = sessionInfo.current;
    const maxBpm = e.silent ? undefined : maxBpmReached(e.rounds, e.elapsed);
    // In a routine, the trecho's review schedule before any quick rating (read alongside the save), so
    // tapping a rating again gives the same date.
    const scheduling =
      runRef.current && info.segmentId
        ? reviewContext(info.segmentId, id).then(
            c => c?.schedule,
            () => undefined,
          )
        : undefined;
    const result = await persist(complete);
    const r = runRef.current;
    if (r && (complete || advance)) {
      const next = nextStepIndex(r.routine.items, r.index + 1, segments);
      if (next >= 0) {
        const schedule = result === 'saved' ? await scheduling : undefined;
        setRun({
          routine: r.routine,
          index: next,
          countdown: TRANSITION_SECONDS,
          last:
            result === 'saved'
              ? { sessionId: id, segmentId: info.segmentId, title: info.title, schedule }
              : undefined,
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
    if (info.kind === 'segment' && info.segmentId) {
      // An unchanged cycle is not written again: every segment write refreshes the screen's data.
      const known = segments.find(s => s.id === info.segmentId)?.practiceConfig;
      if (sameConfig(known, rememberedConfig(cfg))) return;
      db.segments
        .update(info.segmentId, { practiceConfig: rememberedConfig(cfg) })
        .catch(err => notify(`Não foi possível lembrar o ciclo deste trecho: ${errorText(err)}`, 'error'));
    } else if (info.kind === 'piece' && info.pieceId) {
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
      // Ended (Encerrar in the mini-bar, leaving the screen) while the audio was waking up.
      if (sessionId.current !== id) return;
      setStarted(true);
      setRunning(e.running);
      remember(cfg, sessionInfo.current);
      if (e.running) void keepAwake();
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
      // Paused or ended while the audio was waking up: the engine stayed stopped.
      if (engine.current !== e || !e.running) return;
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
    const last = runRef.current?.last;
    if (!last) return;
    try {
      const { reviewDate, schedule } = await quickRate(last.sessionId, last.segmentId, rating, last.schedule);
      // The countdown may have replaced the run meanwhile; keep the rating on whichever step is shown.
      const now = runRef.current;
      if (now?.last?.sessionId === last.sessionId)
        setRun({ ...now, last: { ...now.last, rating, reviewDate, schedule } });
    } catch (err) {
      notify(`Não foi possível salvar a avaliação: ${errorText(err)}`, 'error');
    }
  };
  const setMetronome = (on: boolean) => {
    setConfig(c => withMetronome(c, on));
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
  // "Gravar vídeo": the title and trecho are read when the dialog opens, like a take's context.
  const [video, setVideo] = useState<AttemptContext | null>(null);
  const onRecorderBusy = useCallback((recording: boolean) => {
    if (!recording) attempt.current = null;
    else attempt.current ??= latest.current?.attemptContext() ?? null;
  }, []);
  // Same rule as attemptContext: the session's trecho while practising, otherwise the selected one.
  const attemptSegment = started ? current?.segmentId : segment?.id;
  const attemptOrigin = useMemo(
    () => ({ kind: 'attempt' as const, segmentId: attemptSegment }),
    [attemptSegment],
  );
  // A value-stable region: other segment writes (review, remembered cycle) must not re-zoom the score.
  const regionKey = segment?.regions[0] ? JSON.stringify([segment.id, segment.regions[0]]) : '';
  const targetRegion = useMemo(
    () => (regionKey ? (JSON.parse(regionKey) as [string, Region])[1] : undefined),
    [regionKey],
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
        const e = engine.current;
        if (e?.running) {
          pause();
          notify('Prática pausada porque a tela ficou inativa.', 'info');
        }
        // A start still waiting for the audio must not begin playing in the background.
        else if (e && startPending.current) e.pause();
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

  // The button or link last pressed with the mouse, a finger or the pencil, until Tab moves on. It may keep the
  // focus (the score's Tela cheia, Focar no trecho, the zoom), but Space is not meant for it.
  const pressedControl = useRef<Element | null>(null);
  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      pressedControl.current = (e.target as Element | null)?.closest?.('button, a') ?? null;
    };
    const onTab = (e: KeyboardEvent) => {
      if (e.key === 'Tab') pressedControl.current = null;
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onTab, true);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onTab, true);
    };
  }, []);
  // Space pauses and continues while a session is open: not while typing, nor on a control reached with the
  // keyboard, which Space presses as usual.
  useEffect(() => {
    if (!started) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== ' ' || e.repeat || e.altKey || e.ctrlKey || e.metaKey) return;
      const target = e.target as Element | null;
      if (target?.closest?.('input, textarea, select, [contenteditable], dialog')) return;
      const control = target?.closest?.('button, a');
      if (control && control !== pressedControl.current) return;
      // Also keeps Space from pressing the clicked button again.
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
  const practiced = activeSeconds(rounds, elapsed);
  const activityLabel =
    started && current ? `Prática · ${current.title}` : run ? `Rotina · ${run.routine.title}` : '';
  const activityDetail = started
    ? loop
      ? `${running ? '' : 'Pausada · '}Contínuo · ${clock(practiced)}`
      : `${running ? '' : 'Pausada · '}Rep ${position.round.index + 1}/${rounds.length} · ${clock(total - elapsed)}`
    : run
      ? run.countdown !== null
        ? `Passo ${run.index + 1} começa em ${run.countdown} s`
        : `Aguardando o passo ${run.index + 1}`
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
    idle: run ? 'A SEGUIR' : timer ? 'SEU CRONÔMETRO' : 'SEU ANDAMENTO',
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
  const retimeHint = canRetime
    ? position.phase === 'rest'
      ? '− e + ajustam a próxima repetição'
      : '− e + ajustam esta repetição'
    : started && running && (position.phase === 'preparation' || position.phase === 'practice')
      ? position.round.end > position.round.practiceEnd
        ? 'Para mudar o andamento, pause ou espere o intervalo'
        : 'Para mudar o andamento, pause'
      : '';
  const repetitionShown = started || elapsed > 0 ? position.round.index + 1 : '—';
  const progress = Math.min(100, (elapsed / total) * 100);
  const nextStepAt = run ? nextStepIndex(run.routine.items, run.index + 1, segments) : -1;
  const stepLabel = run ? `Passo ${run.index + 1} de ${run.routine.items.length}` : '';
  const nextTitle = nextPlan?.title ?? 'Trecho removido';
  const nextDetail = nextItem ? stepDetail(nextItem, nextPlan) : '';
  // Read once per step (and again at 3 s), not on every tick of the countdown.
  const announcement =
    run && !started
      ? `${stepLabel}: ${nextTitle}.${
          run.countdown === null ? '' : ` Começa em ${run.countdown <= 3 ? 3 : TRANSITION_SECONDS} segundos.`
        }`
      : phaseText;
  const groups = groupByPiece(pieces, segments);
  const waitStep = () => {
    if (runRef.current) setRun({ ...runRef.current, countdown: null });
  };

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
  // Full-screen score on the stand: what is playing (or comes next in the routine) and the transport.
  const hud = (
    <div className="practice-hud" data-phase={phaseKey}>
      <p className="hud-context">
        {started && current ? (
          <>
            {stepLabel && <span>{stepLabel} · </span>}
            <strong>{current.title}</strong> · {hands[current.hand]}
          </>
        ) : run ? (
          <>
            <span>{stepLabel} · </span>
            <strong>Próximo: {nextTitle}</strong>
            {nextDetail && ` · ${nextDetail}`}
            {run.countdown !== null && (
              <>
                {' '}
                · começa em <b>{run.countdown}</b> s
              </>
            )}
          </>
        ) : (
          <>
            <strong>{targetInfo().title}</strong> · {hands[hand]}
          </>
        )}
      </p>
      {/* The console with the same rating is hidden behind the full-screen score. */}
      {run && !started && run.last && (
        <QuickRating last={run.last} onRate={rating => void rateLast(rating)} />
      )}
      <span className="phase-pill">
        {phaseText}
        {countIn !== null && <b>{countIn}</b>}
      </span>
      {!loop && (
        <span className="hud-stat">
          <small>Rep</small> {repetitionShown}/{rounds.length}
        </span>
      )}
      {!timer && (
        <span className="hud-stat">
          {shownBpm} <small>BPM</small>
        </span>
      )}
      {!timer &&
        (silentNow ? (
          <span className="silent-note">Em silêncio</span>
        ) : (
          <BeatDots count={beats} lit={litBeat} flashKey={flashKey} />
        ))}
      <span className="hud-stat">{loop ? clock(practiced) : clock(started ? remaining : total)}</span>
      {playButton('hud-play')}
      {started && !timer && !loop && (
        <button
          className="btn secondary hud-btn"
          aria-label="Recomeçar repetição"
          onClick={e => {
            releaseFocus(e);
            restart();
          }}
        >
          <RotateCcw size={20} />
        </button>
      )}
      {run && !started && run.countdown !== null && (
        <button className="btn secondary hud-btn" onClick={waitStep}>
          Esperar
        </button>
      )}
      {run && !started && (
        <button
          className="btn secondary hud-btn"
          aria-label={`Pular o passo ${run.index + 1}`}
          onClick={skipStep}
        >
          <SkipForward size={20} />
          Pular
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
              nextTitle={nextTitle}
              nextDetail={nextDetail}
              onRate={rating => void rateLast(rating)}
              onWait={waitStep}
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
              {announcement}
            </span>
            {timer ? (
              <div className="timer-readout">
                <strong>{loop ? clock(practiced) : clock(started ? remaining : total)}</strong>
                <span>
                  {loop
                    ? 'sem fim · encerre quando quiser'
                    : started
                      ? phaseKey === 'rest'
                        ? 'de intervalo'
                        : 'restantes'
                      : 'no total'}
                </span>
              </div>
            ) : (
              <div className="bpm-control">
                <button
                  aria-label={started ? 'Diminuir o andamento' : 'Diminuir BPM'}
                  disabled={started ? !canRetime || shownBpm <= 20 : busy || config.bpm <= 20}
                  onClick={e => {
                    releaseFocus(e);
                    if (started) retime(-1);
                    else update('bpm', config.bpm - 1);
                  }}
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
                  onClick={e => {
                    releaseFocus(e);
                    if (started) retime(1);
                    else update('bpm', config.bpm + 1);
                  }}
                >
                  +
                </button>
              </div>
            )}
            {started && !timer && (
              // Always present while practising so the buttons below never move between phases.
              <p className="retime-hint">{retimeHint}</p>
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
            {loop ? (
              <div className="cycle-info">
                {!timer && (
                  <div>
                    <span>Compasso</span>
                    <strong>
                      {started && !preroll && position.phase === 'practice' ? position.bar : '—'}
                    </strong>
                  </div>
                )}
                <div>
                  <span>Contínuo</span>
                  <strong>{clock(practiced)}</strong>
                </div>
              </div>
            ) : (
              <>
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
              </>
            )}
            <div className="transport">
              {playButton('play-btn')}
              {started && !timer && !loop && (
                <button
                  className="btn secondary"
                  onClick={e => {
                    releaseFocus(e);
                    restart();
                  }}
                >
                  <RotateCcw size={18} />
                  Recomeçar repetição
                </button>
              )}
              {started && run && nextStepAt >= 0 && (
                <button
                  className="btn secondary"
                  onClick={e => {
                    releaseFocus(e);
                    void finish(false, true);
                  }}
                >
                  <SkipForward size={18} />
                  Ir para o passo {nextStepAt + 1}
                </button>
              )}
              {started && (
                <button
                  className="btn secondary"
                  onClick={e => {
                    releaseFocus(e);
                    void finish(false);
                  }}
                >
                  <Square size={18} />
                  {run ? 'Encerrar rotina' : 'Encerrar'}
                </button>
              )}
            </div>
            <ErrorBox message={error} />
            {/* Right under the transport, so a take can start mid-session without scrolling. Always rendered
                at this spot: moving it would interrupt a recording when a session starts. */}
            <div className="attempt-recorder">
              <Recorder
                profile="music"
                origin={attemptOrigin}
                label="Gravar tentativa"
                onFile={saveAttempt}
                onBusyChange={onRecorderBusy}
              />
              <button type="button" className="btn secondary" onClick={() => setVideo(attemptContext())}>
                <Video size={17} />
                Gravar vídeo
              </button>
            </div>
            {video && (
              <VideoRecorder
                title={video.title}
                notify={notify}
                onClose={() => setVideo(null)}
                onSaveInApp={async file => {
                  attempt.current = video;
                  try {
                    await saveAttempt(file);
                  } finally {
                    attempt.current = null;
                  }
                }}
              />
            )}
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
            {/* No Trecho tool here: trechos are marked on the piece's page. */}
            <ScoreViewer
              score={score}
              targetRegion={targetRegion}
              notify={notify}
              fullscreenOverlay={hud}
              defaultFullscreen={routineActive && scoreFullscreen}
              onFullscreenChange={setScoreFullscreen}
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
