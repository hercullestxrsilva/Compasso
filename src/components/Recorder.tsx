import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Mic, Square } from 'lucide-react';
import { db } from '../db';
import { now, uid, clock } from '../domain';
import { errorText, ErrorBox, type Notify } from './common';
import { setActivity } from '../activity';
import {
  audioLevel,
  captureConstraints,
  captureTitle,
  meterLevel,
  microphoneError,
  recorderOptions,
  recordingExtension,
  type CaptureProfile,
} from '../audio/recording';
import '../styles/lessons.css';
export async function recoverCapture(id: string) {
  const capture = await db.captures.get(id);
  if (!capture) throw new Error('Gravação não encontrada.');
  const chunks = (await db.captureChunks.where('captureId').equals(id).toArray()).sort(
    (a, b) => a.index - b.index,
  );
  if (!chunks.length) throw new Error('Ainda não há áudio salvo nesta gravação.');
  return new File(
    [
      new Blob(
        chunks.map(c => c.blob),
        { type: capture.mime },
      ),
    ],
    `${capture.title}.${recordingExtension(capture.mime)}`,
    { type: capture.mime },
  );
}
export async function clearCapture(id: string) {
  await db.transaction('rw', [db.captures, db.captureChunks], async () => {
    await db.captureChunks.where('captureId').equals(id).delete();
    await db.captures.delete(id);
  });
}
const activeCaptures = new Set<string>(),
  captureListeners = new Set<() => void>();
let activeSnapshot: string[] = [];
function markActive(captureId: string, active: boolean) {
  if (active) activeCaptures.add(captureId);
  else activeCaptures.delete(captureId);
  activeSnapshot = [...activeCaptures];
  captureListeners.forEach(listener => listener());
}
function subscribeCaptures(listener: () => void) {
  captureListeners.add(listener);
  return () => {
    captureListeners.delete(listener);
  };
}
/** Captures still recording or saving in this tab; recovery lists must not offer them. */
export function useActiveCaptureIds() {
  return useSyncExternalStore(
    subscribeCaptures,
    () => activeSnapshot,
    () => activeSnapshot,
  );
}
/** Every take holds this Web Lock until it is saved, so other tabs can tell a live capture from an interrupted one. */
export const CAPTURE_LOCK_PREFIX = 'compasso-capture:';
/** Resolves once the lock is held; call the returned function to release it. */
function holdCaptureLock(captureId: string) {
  return new Promise<() => void>(resolve => {
    if (!navigator.locks?.request) return resolve(() => {});
    void navigator.locks
      .request(CAPTURE_LOCK_PREFIX + captureId, () => new Promise<void>(release => resolve(release)))
      .catch(() => resolve(() => {}));
  });
}
class CaptureGone extends Error {}
const MAX_CAPTURE_BYTES = 90 * 1024 * 1024;
export interface RecorderProps {
  onFile: (file: File) => Promise<void>;
  label?: string;
  onBusyChange?: (busy: boolean) => void;
  /** 'music' disables echo cancellation, noise suppression and auto gain (piano takes); 'voice' keeps them. */
  profile?: 'music' | 'voice';
  /** Stored with the capture so an interrupted recording can be recovered to the right place. */
  origin?: { kind: 'lesson' | 'attempt'; lessonId?: string; segmentId?: string };
  /** Asked before the microphone opens; return false to cancel (e.g. "replace this lesson's audio?"). */
  beforeStart?: () => Promise<boolean>;
  /** Called about every second while recording with the elapsed seconds. */
  onElapsed?: (seconds: number) => void;
  /** Name the app shell shows while recording, e.g. "Gravação da aula". Defaults to one based on `origin`. */
  activityLabel?: string;
  /** MediaRecorder bitrate; defaults to 128 kbps for 'music' and 64 kbps for 'voice'. */
  bitsPerSecond?: number;
  /** When given, the student can switch between 'music' and 'voice' before recording. */
  onProfileChange?: (profile: CaptureProfile) => void;
  /** Reports problems that happen after this screen was left (the audio then stays recoverable). */
  notify?: Notify;
}
interface Take {
  captureId: string;
  recorder: MediaRecorder;
  startedAt: number;
  stop: () => Promise<void>;
}
type Phase = 'idle' | 'starting' | 'recording' | 'saving';
export default function Recorder({
  onFile,
  label = 'Gravar aula',
  onBusyChange,
  profile = 'music',
  origin,
  beforeStart,
  onElapsed,
  activityLabel,
  bitsPerSecond,
  onProfileChange,
  notify,
}: RecorderProps) {
  const take = useRef<Take | null>(null),
    alive = useRef(true),
    starting = useRef(false);
  const meter = useRef<{ context: AudioContext; timer: number } | null>(null);
  // The shell shows this as a status ("Gravação da aula · 3:12"), so it is not the button's command.
  const status =
    activityLabel ??
    (origin?.kind === 'lesson'
      ? 'Gravação da aula'
      : origin?.kind === 'attempt'
        ? 'Gravação da tentativa'
        : 'Gravação em andamento');
  // A recording that outlives this screen still saves through the latest callbacks.
  const latest = useRef({ onFile, onElapsed, notify, label: status });
  useEffect(() => {
    latest.current = { onFile, onElapsed, notify, label: status };
  });
  const [phase, setPhase] = useState<Phase>('idle'),
    [seconds, setSeconds] = useState(0),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  const [inputName, setInputName] = useState(''),
    [level, setLevel] = useState(0),
    [noSignal, setNoSignal] = useState(false),
    [deviceId, setDeviceId] = useState(''),
    [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const stopMeter = () => {
    const active = meter.current;
    if (active) {
      window.clearInterval(active.timer);
      void active.context.close().catch(() => {});
      meter.current = null;
    }
    if (alive.current) setLevel(0);
  };
  const listDevices = async () => {
    try {
      setDevices((await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'audioinput'));
    } catch {
      /* Permission or device listing may be unavailable. */
    }
  };
  const report = (message: string) => {
    if (alive.current) setError(message);
    else latest.current.notify?.(message, 'error');
  };
  useEffect(() => {
    onBusyChange?.(phase !== 'idle');
  }, [phase, onBusyChange]);
  useEffect(() => {
    alive.current = true;
    void listDevices();
    return () => {
      alive.current = false;
      // Leaving the screen ends the take but still saves it: onstop hands the file to onFile.
      const current = take.current;
      if (current && current.recorder.state !== 'inactive') current.recorder.stop();
      stopMeter();
    };
  }, []);
  useEffect(() => {
    if (phase !== 'recording') return;
    const timer = setInterval(() => {
      if (take.current) setSeconds(Math.floor((Date.now() - take.current.startedAt) / 1000));
    }, 250);
    const leave = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener('beforeunload', leave);
    return () => {
      clearInterval(timer);
      window.removeEventListener('beforeunload', leave);
    };
  }, [phase]);
  useEffect(() => {
    const current = take.current;
    if (phase !== 'recording' || !current) return;
    latest.current.onElapsed?.(seconds);
    setActivity(`recording:${current.captureId}`, {
      kind: 'recording',
      label: latest.current.label,
      detail: clock(seconds),
      stop: current.stop,
    });
  }, [phase, seconds]);
  const startMeter = async (input: MediaStream) => {
    let context: AudioContext | undefined;
    try {
      context = new AudioContext();
      const source = context.createMediaStreamSource(input),
        analyser = context.createAnalyser();
      analyser.fftSize = 2048;
      source.connect(analyser);
      await context.resume();
      if (!alive.current || take.current?.recorder.state !== 'recording') {
        await context.close();
        return;
      }
      const samples = new Float32Array(analyser.fftSize);
      let lastSignal = Date.now();
      const timer = window.setInterval(() => {
        analyser.getFloatTimeDomainData(samples);
        const current = audioLevel(samples);
        setLevel(meterLevel(current));
        // Unprocessed (music) input is quieter, so it gets a lower silence threshold.
        if (current > (profile === 'music' ? 0.0005 : 0.001)) lastSignal = Date.now();
        setNoSignal(Date.now() - lastSignal > 5000);
      }, 250);
      meter.current = { context, timer };
    } catch {
      if (context)
        void context
          .close()
          .catch(() => {}); /* Recording continues even if the level meter is unavailable. */
    }
  };
  const openMicrophone = async () => {
    const supported = navigator.mediaDevices.getSupportedConstraints?.() ?? {};
    try {
      return await navigator.mediaDevices.getUserMedia({
        audio: captureConstraints(profile, deviceId, supported),
      });
    } catch (err) {
      // A remembered microphone may be gone; fall back to the browser's default input.
      if (!deviceId || (err as { name?: string })?.name !== 'OverconstrainedError') throw err;
      return navigator.mediaDevices.getUserMedia({ audio: captureConstraints(profile, '', supported) });
    }
  };
  const begin = async () => {
    if (phase !== 'idle' || starting.current) return;
    starting.current = true;
    setError('');
    setNotice('');
    let stream: MediaStream | undefined,
      created = '',
      releaseLock = () => {};
    try {
      if (beforeStart && !(await beforeStart())) return;
      if (!alive.current) return;
      setPhase('starting');
      if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder)
        throw new Error(
          'A gravação requer HTTPS ou localhost e permissão de microfone. Você também pode importar um áudio.',
        );
      stream = await openMicrophone().catch((err: unknown) => {
        throw new Error(microphoneError(err) ?? errorText(err));
      });
      if (!alive.current) {
        stream.getTracks().forEach(t => t.stop());
        return;
      }
      const track = stream.getAudioTracks()[0];
      setInputName(track?.label || 'Microfone selecionado pelo navegador');
      const settings = track?.getSettings?.();
      if (profile === 'music' && (settings?.autoGainControl || settings?.noiseSuppression))
        setNotice(
          'Este navegador manteve o ajuste automático do microfone. A dinâmica do piano pode soar mais achatada.',
        );
      setNoSignal(false);
      void listDevices();
      const options = recorderOptions(profile, t => MediaRecorder.isTypeSupported(t), bitsPerSecond);
      let recorder: MediaRecorder;
      try {
        recorder = new MediaRecorder(stream, options);
      } catch {
        recorder = new MediaRecorder(stream, options.mimeType ? { mimeType: options.mimeType } : undefined);
      }
      const captureId = uid(),
        key = `recording:${captureId}`,
        input = stream;
      let index = 0,
        bytes = 0,
        failed = false,
        capped = false,
        mime = recorder.mimeType || options.mimeType || 'audio/webm';
      let queue = Promise.resolve();
      markActive(captureId, true);
      created = captureId;
      releaseLock = await holdCaptureLock(captureId);
      await db.captures.add({
        id: captureId,
        title: captureTitle(new Date()),
        mime,
        createdAt: now(),
        origin: origin?.kind,
        lessonId: origin?.lessonId,
        segmentId: origin?.segmentId,
      });
      // Left the screen while the capture row was being created: release the microphone (see catch).
      if (!alive.current) throw new Error('A tela foi fechada antes de a gravação começar.');
      let saved!: () => void;
      const done = new Promise<void>(resolve => (saved = resolve));
      recorder.ondataavailable = e => {
        if (!e.data.size) return;
        const chunkIndex = index++;
        bytes += e.data.size;
        const type = e.data.type;
        queue = queue
          .then(() =>
            db.transaction('rw', [db.captures, db.captureChunks], async () => {
              // Deleted or recovered elsewhere (e.g. in a browser without Web Locks): stop instead of
              // writing chunks that no capture row would ever list.
              if (!(await db.captures.get(captureId))) throw new CaptureGone();
              // Some browsers only report the final container type once data arrives.
              if (type && type !== mime) {
                mime = type;
                await db.captures.update(captureId, { mime: type });
              }
              await db.captureChunks.add({ id: uid(), captureId, index: chunkIndex, blob: e.data });
            }),
          )
          .catch(err => {
            if (failed) return;
            failed = true;
            report(
              err instanceof CaptureGone
                ? 'Esta gravação foi excluída ou guardada em outra janela do app, por isso foi encerrada.'
                : 'O dispositivo não conseguiu salvar uma parte da gravação. O áudio já gravado ficou em “Gravações recuperáveis”.',
            );
            if (recorder.state === 'recording') recorder.stop();
          });
        if (bytes > MAX_CAPTURE_BYTES && recorder.state === 'recording') {
          capped = true;
          recorder.stop();
        }
      };
      recorder.onerror = () => {
        failed = true;
        report('A gravação foi interrompida. O áudio já gravado ficou em “Gravações recuperáveis”.');
      };
      recorder.onstop = async () => {
        input.getTracks().forEach(t => t.stop());
        stopMeter();
        setActivity(key, { kind: 'recording', label: latest.current.label, detail: 'salvando…' });
        if (alive.current) setPhase('saving');
        await queue;
        try {
          if (failed) return;
          if (!index) {
            await clearCapture(captureId);
            report('A gravação terminou sem áudio. Confira o microfone e tente de novo.');
            return;
          }
          const file = await recoverCapture(captureId);
          await latest.current.onFile(file);
          await clearCapture(captureId);
          if (capped && alive.current)
            setNotice('A gravação chegou ao limite de 90 MB e foi encerrada. O áudio foi salvo.');
        } catch (err) {
          report(`${errorText(err)} O áudio gravado ficou em “Gravações recuperáveis”.`);
        } finally {
          take.current = null;
          setActivity(key, null);
          markActive(captureId, false);
          releaseLock();
          if (alive.current) setPhase('idle');
          saved();
        }
      };
      recorder.start(3000);
      take.current = {
        captureId,
        recorder,
        startedAt: Date.now(),
        stop: () => {
          if (recorder.state !== 'inactive') recorder.stop();
          return done;
        },
      };
      setSeconds(0);
      setPhase('recording');
      void startMeter(stream);
    } catch (err) {
      stream?.getTracks().forEach(t => t.stop());
      stopMeter();
      if (created && !take.current) {
        markActive(created, false);
        void clearCapture(created)
          .catch(() => {})
          .finally(releaseLock);
      }
      if (alive.current) setError(errorText(err));
    } finally {
      starting.current = false;
      if (alive.current) setPhase(current => (current === 'starting' ? 'idle' : current));
    }
  };
  const recording = phase === 'recording';
  return (
    <div className="recorder">
      <button
        type="button"
        className={`btn ${recording ? 'danger' : 'secondary'}`}
        disabled={phase === 'starting' || phase === 'saving'}
        onClick={() => {
          if (recording) void take.current?.stop();
          else void begin();
        }}
      >
        {recording ? <Square size={17} /> : <Mic size={17} />}{' '}
        {phase === 'saving'
          ? 'Salvando…'
          : phase === 'starting'
            ? 'Abrindo o microfone…'
            : recording
              ? `Encerrar · ${clock(seconds)}`
              : label}
      </button>
      {phase === 'idle' && (onProfileChange || devices.length > 1) && (
        <div className="recorder-options">
          {onProfileChange && (
            <label className="recorder-input">
              Som da gravação
              <select value={profile} onChange={e => onProfileChange(e.target.value as CaptureProfile)}>
                <option value="music">Natural (piano e voz)</option>
                <option value="voice">Só voz, com redução de ruído</option>
              </select>
            </label>
          )}
          {devices.length > 1 && (
            <label className="recorder-input">
              Microfone
              <select value={deviceId} onChange={e => setDeviceId(e.target.value)}>
                <option value="">Padrão do navegador</option>
                {devices.map((d, i) => (
                  <option key={d.deviceId || i} value={d.deviceId}>
                    {d.label || `Microfone ${i + 1}`}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
      )}
      <ErrorBox message={error} />
      {notice && <p className="recorder-warning">{notice}</p>}
      {recording && (
        <div className="recorder-monitor">
          <p className="hint">
            Gravando por: {inputName}. O áudio é guardado a cada 3 segundos; mantenha esta tela aberta.
          </p>
          <div
            className="recorder-level"
            role="meter"
            aria-label="Nível do microfone"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(level * 100)}
          >
            <span style={{ width: `${Math.max(2, level * 100)}%` }} />
          </div>
          {noSignal && (
            <p className="recorder-warning">
              Nenhum som foi detectado nos últimos 5 segundos. Confira o microfone antes de continuar.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
