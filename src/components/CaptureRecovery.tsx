import { useEffect, useId, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Download, RotateCcw, Trash2 } from 'lucide-react';
import { db, storeAsset } from '../db';
import { uid, formatDate, type Capture, type Lesson, type Piece, type Segment } from '../domain';
import { download, errorText, useConfirm, type Notify } from './common';
import { CAPTURE_LOCK_PREFIX, clearCapture, recoverCapture, useActiveCaptureIds } from './Recorder';
import '../styles/lessons.css';

/** Makes `file` the lesson's audio and deletes the previous one. */
export async function setLessonAudio(lessonId: string, file: File) {
  await db.transaction('rw', [db.assets, db.lessons], async () => {
    const lesson = await db.lessons.get(lessonId);
    if (!lesson) throw new Error('Esta aula não existe mais.');
    const asset = await storeAsset(file);
    await db.lessons.update(lessonId, { assetId: asset.id });
    if (lesson.assetId) await db.assets.delete(lesson.assetId);
  });
}
/** Saves an interrupted capture as a lesson's audio and removes the capture, all or nothing. */
export async function recoverCaptureToLesson(captureId: string, lessonId: string) {
  await db.transaction('rw', [db.captures, db.captureChunks, db.assets, db.lessons], async () => {
    await setLessonAudio(lessonId, await recoverCapture(captureId));
    await clearCapture(captureId);
  });
}
/** Saves an interrupted capture as a practice recording (optionally linked to a segment), all or nothing. */
export async function recoverCaptureToAttempt(captureId: string, segmentId?: string) {
  await db.transaction(
    'rw',
    [db.captures, db.captureChunks, db.assets, db.recordings, db.segments],
    async () => {
      const capture = await db.captures.get(captureId);
      if (!capture) throw new Error('Gravação não encontrada.');
      const segment = segmentId ? await db.segments.get(segmentId) : undefined;
      const asset = await storeAsset(await recoverCapture(captureId));
      await db.recordings.add({
        id: uid(),
        assetId: asset.id,
        segmentId: segment?.id,
        title: `${segment?.title ?? 'Minha prática'} · ${formatDate(capture.createdAt)} (recuperada)`,
        createdAt: capture.createdAt,
      });
      await clearCapture(captureId);
    },
  );
}
export function formatSize(bytes: number) {
  const mb = bytes / (1024 * 1024);
  return mb >= 0.1
    ? `${mb.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}
/**
 * Where a capture goes by default: its origin when that still exists. Without a known origin the student
 * picks the place, so a piano take is never one tap away from becoming a lesson's audio.
 */
export function defaultDestination(
  capture: Capture,
  lessons: Pick<Lesson, 'id'>[],
  segments: Pick<Segment, 'id'>[],
) {
  if (capture.origin === 'lesson' && capture.lessonId && lessons.some(l => l.id === capture.lessonId))
    return `lesson:${capture.lessonId}`;
  if (capture.origin === 'attempt')
    return `attempt:${segments.some(s => s.id === capture.segmentId) ? capture.segmentId : ''}`;
  return '';
}

/**
 * Captures still being recorded in another tab or window (each take holds a Web Lock), or null until
 * that is known. Without Web Locks nothing can be known, and the Recorder stops a take whose row vanished.
 */
function useCapturesRecordingElsewhere(watch: boolean) {
  const [held, setHeld] = useState<string[] | null>(null);
  useEffect(() => {
    if (!watch) return;
    if (!navigator.locks?.query) {
      setHeld([]);
      return;
    }
    let current = true;
    const check = async () => {
      try {
        const { held: locks = [] } = await navigator.locks.query();
        const ids = locks
          .map(lock => lock.name ?? '')
          .filter(name => name.startsWith(CAPTURE_LOCK_PREFIX))
          .map(name => name.slice(CAPTURE_LOCK_PREFIX.length))
          .sort();
        if (current) setHeld(previous => (previous?.join() === ids.join() ? previous : ids));
      } catch {
        if (current) setHeld([]);
      }
    };
    void check();
    // A take ends (and its lock is released) when the other tab saves it or is closed.
    const timer = window.setInterval(() => void check(), 4000);
    return () => {
      current = false;
      window.clearInterval(timer);
    };
  }, [watch]);
  return held;
}

/**
 * Recordings that were interrupted before they were saved (tab closed, app reloaded, storage error),
 * each recoverable to a lesson or to the practice recordings. With `lessonId`, lists only that lesson's
 * captures plus old ones with no recorded origin.
 */
export default function CaptureRecovery({
  notify,
  lessonId,
  level = 2,
}: {
  notify: Notify;
  lessonId?: string;
  level?: 2 | 3;
}) {
  const captures = useLiveQuery(() => db.captures.toArray());
  const lessons = useLiveQuery(() => db.lessons.orderBy('date').reverse().toArray()) ?? [];
  const segments = useLiveQuery(() => db.segments.toArray()) ?? [];
  const pieces = useLiveQuery(() => db.pieces.toArray()) ?? [];
  const active = useActiveCaptureIds();
  const elsewhere = useCapturesRecordingElsewhere(!!captures?.length);
  const titleId = useId();
  if (!elsewhere) return null;
  const visible = (captures ?? [])
    .filter(c => !active.includes(c.id) && !elsewhere.includes(c.id))
    .filter(c => !lessonId || c.lessonId === lessonId || !c.origin)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  if (!visible.length) return null;
  const Heading = level === 2 ? 'h2' : 'h3';
  return (
    <section className={`capture-recovery ${lessonId ? 'inline' : ''}`} aria-labelledby={titleId}>
      <Heading id={titleId}>Gravações recuperáveis</Heading>
      <p className="hint">
        {visible.length === 1
          ? 'Esta gravação foi interrompida antes de ser guardada.'
          : `Estas ${visible.length} gravações foram interrompidas antes de serem guardadas.`}{' '}
        Escolha onde guardar; o final pode estar incompleto.
      </p>
      {visible.map(c => (
        <CaptureRow
          key={c.id}
          capture={c}
          lessons={lessons}
          segments={segments}
          pieces={pieces}
          notify={notify}
        />
      ))}
    </section>
  );
}
function CaptureRow({
  capture,
  lessons,
  segments,
  pieces,
  notify,
}: {
  capture: Capture;
  lessons: Lesson[];
  segments: Segment[];
  pieces: Piece[];
  notify: Notify;
}) {
  const confirm = useConfirm();
  const size = useLiveQuery(
    async () =>
      (await db.captureChunks.where('captureId').equals(capture.id).toArray()).reduce(
        (sum, c) => sum + c.blob.size,
        0,
      ),
    [capture.id],
  );
  const [choice, setChoice] = useState<string>(),
    [busy, setBusy] = useState(false);
  const destination = choice ?? defaultDestination(capture, lessons, segments);
  const originLesson = lessons.find(l => l.id === capture.lessonId),
    originSegment = segments.find(s => s.id === capture.segmentId);
  const origin =
    capture.origin === 'lesson'
      ? `Gravada na aula ${originLesson ? `“${originLesson.title}”` : 'que foi excluída'}`
      : capture.origin === 'attempt'
        ? `Tentativa de prática${originSegment ? ` · ${originSegment.title}` : ''}`
        : 'Origem não registrada';
  const when = new Date(capture.createdAt);
  const run = async (task: () => Promise<void>) => {
    setBusy(true);
    try {
      await task();
    } catch (err) {
      notify(errorText(err), 'error');
    } finally {
      setBusy(false);
    }
  };
  const recover = () =>
    run(async () => {
      const [kind, id] = destination.split(':');
      if (kind === 'lesson') {
        const lesson = await db.lessons.get(id);
        if (!lesson) throw new Error('Esta aula não existe mais. Escolha outro destino.');
        if (
          lesson.assetId &&
          !(await confirm({
            title: 'Substituir o áudio da aula?',
            message: `“${lesson.title}” já tem um áudio. Ele será apagado e trocado por esta gravação. As anotações continuam, mas os tempos marcados nelas vão apontar para esta gravação.`,
            confirmLabel: 'Substituir áudio',
            danger: true,
          }))
        )
          return;
        await recoverCaptureToLesson(capture.id, lesson.id);
        notify(`Gravação guardada na aula “${lesson.title}”.`);
      } else {
        await recoverCaptureToAttempt(capture.id, id || undefined);
        notify('Gravação guardada em Evolução, nas suas gravações.');
      }
    });
  const pieceTitle = (segment: Segment) => pieces.find(p => p.id === segment.pieceId)?.title;
  const selectId = useId();
  return (
    <article className="capture-row">
      <div className="capture-info">
        <strong>{capture.title}</strong>
        <small>
          {origin} · {formatDate(capture.createdAt)},{' '}
          {when.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
          {size !== undefined && ` · ${size ? formatSize(size) : 'sem áudio salvo'}`}
        </small>
      </div>
      <div className="capture-actions">
        <label className="capture-destination" htmlFor={selectId}>
          Guardar em
        </label>
        <select id={selectId} value={destination} onChange={e => setChoice(e.target.value)} disabled={busy}>
          <option value="" disabled>
            Escolha o destino
          </option>
          {lessons.length > 0 && (
            <optgroup label="Aulas">
              {lessons.map(l => (
                <option key={l.id} value={`lesson:${l.id}`}>
                  {l.title} · {formatDate(l.date)}
                </option>
              ))}
            </optgroup>
          )}
          <optgroup label="Gravações de prática">
            <option value="attempt:">Sem trecho</option>
            {segments.map(s => (
              <option key={s.id} value={`attempt:${s.id}`}>
                {s.title}
                {pieceTitle(s) ? ` · ${pieceTitle(s)}` : ''}
              </option>
            ))}
          </optgroup>
        </select>
        <button
          type="button"
          className="btn small"
          disabled={busy || !destination || size === 0}
          onClick={() => void recover()}
        >
          <RotateCcw size={15} />
          {busy ? 'Guardando…' : 'Recuperar'}
        </button>
        <button
          type="button"
          className="icon-btn"
          aria-label={`Baixar ${capture.title}`}
          disabled={busy || size === 0}
          onClick={() =>
            void run(async () => {
              const file = await recoverCapture(capture.id);
              download(file, file.name);
            })
          }
        >
          <Download size={17} />
        </button>
        <button
          type="button"
          className="icon-btn danger"
          aria-label={`Excluir ${capture.title}`}
          disabled={busy}
          onClick={() =>
            void run(async () => {
              if (
                await confirm({
                  title: 'Excluir esta gravação?',
                  message: `O áudio de “${capture.title}”${size ? ` (${formatSize(size)})` : ''} será apagado deste dispositivo. Não é possível desfazer.`,
                  confirmLabel: 'Excluir gravação',
                  danger: true,
                })
              )
                await clearCapture(capture.id);
            })
          }
        >
          <Trash2 size={17} />
        </button>
      </div>
    </article>
  );
}
