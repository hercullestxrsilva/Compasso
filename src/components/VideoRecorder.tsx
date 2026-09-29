import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Circle, Download, Eye, EyeOff, FolderOpen, Square, Video } from 'lucide-react';
import { clock } from '../domain';
import { setActivity } from '../activity';
import { captureConstraints } from '../audio/recording';
import {
  canPickFolder,
  canWrite,
  cameraError,
  pickVideoFolder,
  savedVideoFolder,
  videoConstraints,
  videoFileName,
  videoRecorderOptions,
  type VideoQuality,
} from '../video/recording';
import { ErrorBox, Field, Modal, download, errorText, type Notify } from './common';

type Destination = 'folder' | 'app';
type Phase = 'idle' | 'recording' | 'saving';
interface Result {
  name: string;
  /** Where it went, for the message: the folder's name or "no app". */
  where: string;
  /** Kept in memory when the video was not written to a folder, so it can still be downloaded. */
  file?: File;
}

const QUALITY_KEY = 'compasso:video-quality';
const readQuality = (): VideoQuality => {
  try {
    return localStorage.getItem(QUALITY_KEY) === '1080' ? '1080' : '720';
  } catch {
    return '720';
  }
};
/** Videos kept in the app stay below the size of any other stored file. */
const APP_LIMIT = 100 * 1024 * 1024;

/**
 * "Gravar vídeo": a camera and a microphone chosen among those on the system, a live preview, and the file
 * written straight into a folder of the computer (Chrome and Edge) or kept in the app, ready to download.
 */
export default function VideoRecorder({
  title,
  onClose,
  onSaveInApp,
  notify,
}: {
  /** What is being practised; names the file. */
  title: string;
  onClose: () => void;
  /** Keeps a video in Evolução › Minhas gravações (linked to the trecho and the session). */
  onSaveInApp: (file: File) => Promise<void>;
  notify: Notify;
}) {
  const folderable = canPickFolder();
  const preview = useRef<HTMLVideoElement>(null),
    stream = useRef<MediaStream | null>(null),
    recorder = useRef<{ stop: () => Promise<void> } | null>(null);
  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([]),
    [mics, setMics] = useState<MediaDeviceInfo[]>([]),
    // What the student chose ('' = the system default) and what the open stream actually uses.
    [cameraId, setCameraId] = useState(''),
    [micId, setMicId] = useState(''),
    [activeCamera, setActiveCamera] = useState(''),
    [activeMic, setActiveMic] = useState(''),
    [ready, setReady] = useState(false),
    [quality, setQuality] = useState<VideoQuality>(readQuality),
    [destination, setDestination] = useState<Destination>(folderable ? 'folder' : 'app'),
    [folder, setFolder] = useState<FileSystemDirectoryHandle | null>(null),
    [phase, setPhase] = useState<Phase>('idle'),
    [startedAt, setStartedAt] = useState(0),
    [now, setNow] = useState(0),
    [error, setError] = useState(''),
    [result, setResult] = useState<Result | null>(null);

  useEffect(() => {
    if (folderable) void savedVideoFolder().then(setFolder);
  }, [folderable]);

  // The live preview follows the camera, microphone and quality chosen (not while recording).
  useEffect(() => {
    if (phase !== 'idle') return;
    let cancelled = false;
    (async () => {
      setError('');
      setReady(false);
      try {
        const next = await navigator.mediaDevices.getUserMedia({
          video: videoConstraints(cameraId, quality),
          audio: captureConstraints('music', micId, navigator.mediaDevices.getSupportedConstraints?.()),
        });
        if (cancelled) return next.getTracks().forEach(t => t.stop());
        stream.current?.getTracks().forEach(t => t.stop());
        stream.current = next;
        if (preview.current) preview.current.srcObject = next;
        // Device names are only listed once access was granted.
        const devices = await navigator.mediaDevices.enumerateDevices();
        if (cancelled) return;
        setCameras(devices.filter(d => d.kind === 'videoinput'));
        setMics(devices.filter(d => d.kind === 'audioinput'));
        setActiveCamera(next.getVideoTracks()[0]?.getSettings().deviceId ?? '');
        setActiveMic(next.getAudioTracks()[0]?.getSettings().deviceId ?? '');
        setReady(true);
      } catch (err) {
        if (!cancelled) setError(cameraError(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [cameraId, micId, quality, phase]);
  useEffect(
    () => () => {
      stream.current?.getTracks().forEach(t => t.stop());
      setActivity('video-recording', null);
    },
    [],
  );
  useEffect(() => {
    if (phase !== 'recording') return;
    const timer = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(timer);
  }, [phase]);
  const elapsed = phase === 'recording' ? Math.max(0, (now - startedAt) / 1000) : 0;

  const stop = useCallback(async () => {
    await recorder.current?.stop();
  }, []);
  useEffect(() => {
    if (phase === 'idle') return setActivity('video-recording', null);
    setActivity('video-recording', {
      kind: 'recording',
      label: `Vídeo · ${title}`,
      detail: phase === 'saving' ? 'salvando…' : clock(elapsed),
      stop,
    });
  }, [phase, elapsed, title, stop]);

  const chooseFolder = async () => {
    try {
      const picked = await pickVideoFolder();
      if (picked) {
        setFolder(picked);
        setDestination('folder');
      }
    } catch (err) {
      setError(`Não foi possível usar esta pasta. ${errorText(err)}`);
    }
  };

  const start = async () => {
    const media = stream.current;
    if (!media) return;
    setError('');
    setResult(null);
    const options = videoRecorderOptions(t => MediaRecorder.isTypeSupported(t), quality);
    const mime = options.mimeType ?? 'video/webm';
    const name = videoFileName(title, mime);
    let write: (chunk: Blob) => Promise<void>, finish: () => Promise<Result>;
    try {
      if (destination === 'folder') {
        const dir = folder ?? (await pickVideoFolder());
        if (!dir) return;
        setFolder(dir);
        if (!(await canWrite(dir))) throw new Error('O navegador não permitiu gravar nesta pasta.');
        // Written while recording: a long take never has to fit in memory.
        const handle = await dir.getFileHandle(name, { create: true });
        const writable = await handle.createWritable();
        write = chunk => writable.write(chunk);
        finish = async () => {
          await writable.close();
          return { name, where: dir.name };
        };
      } else {
        const chunks: Blob[] = [];
        write = async chunk => void chunks.push(chunk);
        finish = async () => {
          const file = new File(chunks, name, { type: mime });
          if (file.size > APP_LIMIT) return { name, where: 'memória', file }; // too big for the app: offered for download only
          await onSaveInApp(file);
          return { name, where: 'app', file };
        };
      }
    } catch (err) {
      setError(errorText(err));
      return;
    }
    const rec = new MediaRecorder(media, options);
    let queue = Promise.resolve(),
      failed: unknown = null;
    rec.ondataavailable = e => {
      if (!e.data.size) return;
      queue = queue.then(() => write(e.data)).catch(err => void (failed ??= err));
    };
    let done: () => void = () => {};
    const stopped = new Promise<void>(resolve => (done = resolve));
    rec.onstop = async () => {
      setPhase('saving');
      await queue;
      try {
        if (failed) throw failed;
        const saved = await finish();
        setResult(saved);
        if (saved.where !== 'app')
          notify(
            saved.where === 'memória'
              ? 'O vídeo passou de 100 MB: baixe o arquivo para guardá-lo.'
              : `Vídeo salvo na pasta “${saved.where}”.`,
          );
      } catch (err) {
        setError(`O vídeo não foi salvo. ${errorText(err)}`);
        notify(`O vídeo não foi salvo. ${errorText(err)}`, 'error');
      } finally {
        setPhase('idle');
        done();
      }
    };
    recorder.current = {
      stop: async () => {
        if (rec.state !== 'inactive') rec.stop();
        await stopped;
      },
    };
    rec.start(1000);
    setStartedAt(Date.now());
    setNow(Date.now());
    setPhase('recording');
  };

  const [thumb, setThumb] = useState(true);
  const close = async () => {
    // Closing while recording ends and saves the take first.
    if (phase !== 'idle') await stop();
    onClose();
  };

  // While recording, the dialog gives way to a small panel in a corner: the score and the metronome stay in
  // view and usable. In full screen it goes inside the full-screen element, the only part the browser shows.
  if (phase !== 'idle') {
    const host =
      document.fullscreenElement ?? document.querySelector('.score-viewer.is-fullscreen') ?? document.body;
    return createPortal(
      <div className="video-float" role="region" aria-label="Gravação de vídeo">
        {thumb && (
          <video
            className="video-float-preview"
            autoPlay
            muted
            playsInline
            aria-label="Imagem da câmera"
            ref={el => {
              if (el && el.srcObject !== stream.current) el.srcObject = stream.current;
            }}
          />
        )}
        <div className="video-float-bar">
          <span className="video-float-time" role="timer">
            <Circle size={10} fill="currentColor" aria-hidden="true" />
            {phase === 'saving' ? 'Salvando…' : clock(elapsed)}
          </span>
          <button
            type="button"
            className="icon-btn"
            aria-label={thumb ? 'Esconder a imagem da câmera' : 'Mostrar a imagem da câmera'}
            onClick={() => setThumb(t => !t)}
          >
            {thumb ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
          <button
            type="button"
            className="btn small danger"
            disabled={phase === 'saving'}
            onClick={() => void stop()}
          >
            <Square size={13} fill="currentColor" />
            Parar
          </button>
        </div>
      </div>,
      host,
    );
  }
  return (
    <Modal title="Gravar vídeo" onClose={() => void close()} wide guard>
      <div className="video-recorder">
        <div className="video-preview">
          <video ref={preview} autoPlay muted playsInline aria-label="Imagem da câmera" />
        </div>
        <div className="video-options">
          <div className="form-grid">
            <Field label="Câmera">
              <select
                value={cameraId || activeCamera}

                onChange={e => setCameraId(e.target.value)}
              >
                {cameras.map((c, i) => (
                  <option key={c.deviceId || i} value={c.deviceId}>
                    {c.label || `Câmera ${i + 1}`}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Microfone">
              <select
                value={micId || activeMic}

                onChange={e => setMicId(e.target.value)}
              >
                {mics.map((m, i) => (
                  <option key={m.deviceId || i} value={m.deviceId}>
                    {m.label || `Microfone ${i + 1}`}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <Field
            label="Qualidade"
            hint="1080p mostra melhor os dedos; o arquivo fica com o dobro do tamanho."
          >
            <select
              value={quality}

              onChange={e => {
                const q = e.target.value as VideoQuality;
                setQuality(q);
                try {
                  localStorage.setItem(QUALITY_KEY, q);
                } catch {
                  /* Only a convenience. */
                }
              }}
            >
              <option value="720">720p (cerca de 19 MB por minuto)</option>
              <option value="1080">1080p (cerca de 38 MB por minuto)</option>
            </select>
          </Field>
          <fieldset className="video-destination">
            <legend>Salvar em</legend>
            {folderable ? (
              <>
                <label>
                  <input
                    type="radio"
                    name="video-destination"
                    checked={destination === 'folder'}
                    onChange={() => setDestination('folder')}
                  />
                  Uma pasta do computador
                </label>
                <div className="video-folder">
                  <span>{folder ? `Pasta: ${folder.name}` : 'Nenhuma pasta escolhida'}</span>
                  <button type="button" className="btn small secondary" onClick={() => void chooseFolder()}>
                    <FolderOpen size={15} />
                    {folder ? 'Trocar pasta' : 'Escolher pasta'}
                  </button>
                </div>
                <label>
                  <input
                    type="radio"
                    name="video-destination"
                    checked={destination === 'app'}
                    onChange={() => setDestination('app')}
                  />
                  Neste app (Evolução › Minhas gravações)
                </label>
              </>
            ) : (
              <p className="hint">
                Neste navegador o vídeo fica no app (Evolução › Minhas gravações) e pode ser baixado para a
                pasta que você quiser. Para gravar direto numa pasta, use o Chrome ou o Edge no computador.
              </p>
            )}
          </fieldset>
        </div>
      </div>
      <ErrorBox message={error} />
      {result && (
        <p className="video-result" role="status">
          {result.where === 'app'
            ? `“${result.name}” foi guardado no app.`
            : result.where === 'memória'
              ? `“${result.name}” tem mais de 100 MB e não coube no app: baixe-o agora.`
              : `“${result.name}” está na pasta “${result.where}”.`}
          {result.file && (
            <button
              type="button"
              className="btn small secondary"
              onClick={() => download(result.file!, result.name)}
            >
              <Download size={15} />
              Baixar vídeo
            </button>
          )}
        </p>
      )}
      <footer className="modal-actions">
        <button type="button" className="btn secondary" onClick={() => void close()}>
          Fechar
        </button>
        <button type="button" className="btn" disabled={!ready} onClick={() => void start()}>
          <Video size={17} />
          {result ? 'Gravar outro' : 'Gravar'}
        </button>
      </footer>
    </Modal>
  );
}
