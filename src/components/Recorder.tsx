import { useEffect, useRef, useState } from 'react';
import { Mic, Square } from 'lucide-react';
import { db } from '../db';
import { now, uid, clock } from '../domain';
import { errorText, ErrorBox } from './common';
import { audioLevel, recordingExtension } from '../audio/recording';
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
export default function Recorder({
  onFile,
  label = 'Gravar aula',
  onBusyChange,
}: {
  onFile: (file: File) => Promise<void>;
  label?: string;
  onBusyChange?: (busy: boolean) => void;
}) {
  const recorder = useRef<MediaRecorder | null>(null),
    stream = useRef<MediaStream | null>(null),
    queue = useRef(Promise.resolve()),
    alive = useRef(true);
  const meter = useRef<{ context: AudioContext; timer: number } | null>(null),
    startedAt = useRef(0);
  const [recording, setRecording] = useState(false),
    [busy, setBusy] = useState(false),
    [seconds, setSeconds] = useState(0),
    [error, setError] = useState('');
  const [inputName, setInputName] = useState(''),
    [level, setLevel] = useState(0),
    [noSignal, setNoSignal] = useState(false),
    [deviceId, setDeviceId] = useState(''),
    [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const saving = useRef(false);
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
  useEffect(() => {
    onBusyChange?.(recording || busy);
  }, [recording, busy, onBusyChange]);
  useEffect(() => {
    alive.current = true;
    void listDevices();
    return () => {
      alive.current = false;
      if (recorder.current?.state === 'recording') recorder.current.stop();
      stream.current?.getTracks().forEach(t => t.stop());
      stopMeter();
    };
  }, []);
  useEffect(() => {
    if (!recording) return;
    const timer = setInterval(() => setSeconds(Math.floor((Date.now() - startedAt.current) / 1000)), 250);
    const leave = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener('beforeunload', leave);
    return () => {
      clearInterval(timer);
      window.removeEventListener('beforeunload', leave);
    };
  }, [recording]);
  const startMeter = async (input: MediaStream) => {
    let context: AudioContext | undefined;
    try {
      context = new AudioContext();
      const source = context.createMediaStreamSource(input),
        analyser = context.createAnalyser();
      analyser.fftSize = 2048;
      source.connect(analyser);
      await context.resume();
      if (!alive.current || recorder.current?.state !== 'recording') {
        await context.close();
        return;
      }
      const samples = new Float32Array(analyser.fftSize);
      let lastSignal = Date.now();
      const timer = window.setInterval(() => {
        analyser.getFloatTimeDomainData(samples);
        const current = audioLevel(samples);
        setLevel(Math.min(1, current * 8));
        if (current > 0.001) lastSignal = Date.now();
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
  const begin = async () => {
    if (busy || saving.current) return;
    setBusy(true);
    setError('');
    try {
      if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder)
        throw new Error(
          'A gravação requer HTTPS ou localhost e permissão de microfone. Você também pode importar um áudio.',
        );
      stream.current = await navigator.mediaDevices.getUserMedia({
        audio: deviceId ? { deviceId: { exact: deviceId } } : true,
      });
      if (!alive.current) {
        stream.current.getTracks().forEach(t => t.stop());
        return;
      }
      setInputName(stream.current.getAudioTracks()[0]?.label || 'Microfone selecionado pelo navegador');
      setNoSignal(false);
      void listDevices();
      const mime = ['audio/ogg;codecs=opus', 'audio/mp4', 'audio/webm;codecs=opus', 'audio/webm'].find(t =>
        MediaRecorder.isTypeSupported(t),
      );
      const rec = new MediaRecorder(stream.current, mime ? { mimeType: mime } : undefined);
      recorder.current = rec;
      const id = uid();
      let index = 0,
        bytes = 0,
        failed = false;
      queue.current = Promise.resolve();
      await db.captures.add({
        id,
        title: `Gravação ${new Date().toLocaleDateString('pt-BR').replaceAll('/', '-')}`,
        mime: rec.mimeType,
        createdAt: now(),
      });
      rec.ondataavailable = e => {
        if (!e.data.size) return;
        const chunkIndex = index++;
        bytes += e.data.size;
        queue.current = queue.current
          .then(async () => {
            await db.captureChunks.add({ id: uid(), captureId: id, index: chunkIndex, blob: e.data });
          })
          .catch(() => {
            failed = true;
            if (alive.current)
              setError(
                'O dispositivo não conseguiu salvar uma parte da gravação. Recupere o áudio disponível na lista.',
              );
            if (rec.state === 'recording') rec.stop();
          });
        if (bytes > 90 * 1024 * 1024 && rec.state === 'recording') rec.stop();
      };
      rec.onerror = () => {
        failed = true;
        if (alive.current)
          setError('A gravação foi interrompida. Os blocos salvos ficam disponíveis para recuperação.');
      };
      rec.onstop = async () => {
        stream.current?.getTracks().forEach(t => t.stop());
        stopMeter();
        if (alive.current) {
          setRecording(false);
          setBusy(true);
        }
        saving.current = true;
        await queue.current;
        try {
          if (!failed && alive.current) {
            const file = await recoverCapture(id);
            await onFile(file);
            await clearCapture(id);
          }
        } catch (err) {
          if (alive.current) setError(`${errorText(err)} O áudio salvo pode ser recuperado abaixo.`);
        } finally {
          saving.current = false;
          if (alive.current) setBusy(false);
        }
      };
      rec.start(3000);
      startedAt.current = Date.now();
      setSeconds(0);
      setRecording(true);
      void startMeter(stream.current);
    } catch (err) {
      setError(errorText(err));
      stream.current?.getTracks().forEach(t => t.stop());
      stopMeter();
    } finally {
      if (alive.current) setBusy(false);
    }
  };
  return (
    <div className="recorder">
      <button
        className={`btn ${recording ? 'danger' : 'secondary'}`}
        disabled={busy}
        onClick={() => {
          if (recording) {
            recorder.current?.stop();
          } else void begin();
        }}
      >
        {recording ? <Square size={17} /> : <Mic size={17} />}{' '}
        {busy ? 'Salvando…' : recording ? `Encerrar · ${clock(seconds)}` : label}
      </button>
      {!recording && !busy && devices.length > 1 && (
        <label className="recorder-input">
          Microfone{' '}
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
      <ErrorBox message={error} />
      {recording && (
        <div className="recorder-monitor">
          <p className="hint">Gravando por: {inputName}. Mantenha esta tela aberta.</p>
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
