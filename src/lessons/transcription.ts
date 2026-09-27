import { useSyncExternalStore } from 'react';
import { db } from '../db';
import { clock, type Asset } from '../domain';
import { errorText } from '../components/common';
import { aiFetch, AiError } from '../services';
import {
  decodeForTranscription,
  maxSplitSeconds,
  planParts,
  probeAudioFormat,
  probeDuration,
  spokenDuration,
  transcriptFromParts,
  wavPart,
  type TranscriptPart,
} from '../audio/recording';

export const MAX_UPLOAD_BYTES = 24 * 1024 * 1024;

/** A split transcription that stopped after some parts; `text` holds the parts already done. */
export class PartialTranscript extends Error {
  constructor(
    readonly text: string,
    readonly done: number,
    readonly total: number,
    cause: unknown,
  ) {
    super(errorText(cause), { cause });
  }
}

const cancelled = () => new AiError('Operação cancelada.', 0, undefined, true);
const pause = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal.aborted) return reject(cancelled());
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(cancelled());
      },
      { once: true },
    );
  });

function device() {
  const nav = navigator as Navigator & { deviceMemory?: number };
  return {
    webkit: /^Apple/.test(navigator.vendor ?? ''),
    touch: window.matchMedia?.('(pointer: coarse)').matches ?? false,
    deviceMemory: nav.deviceMemory,
  };
}

export type SplitCheck = { ok: true; duration: number; parts: number } | { ok: false; message: string };
/**
 * Whether a file over the upload limit can be split here: the browser decodes the whole file into memory
 * first, so the limit depends on the file's channels and on the device.
 */
export async function checkSplit(blob: Blob, knownDuration?: number): Promise<SplitCheck> {
  const duration =
    knownDuration && Number.isFinite(knownDuration) ? knownDuration : await probeDuration(blob);
  if (!Number.isFinite(duration))
    return {
      ok: false,
      message:
        'Não foi possível medir a duração deste áudio para dividi-lo em partes. Você pode colar uma transcrição feita em outro lugar.',
    };
  const format = await probeAudioFormat(blob);
  const limit = maxSplitSeconds(
    { bytes: blob.size, channels: format?.channels, sampleRate: format?.sampleRate },
    device(),
  );
  if (duration > limit)
    return {
      ok: false,
      message:
        limit < 60
          ? `Este áudio tem ${spokenDuration(duration)} e é grande demais para ser dividido em partes neste dispositivo. Você pode colar uma transcrição feita em outro lugar.`
          : `Este áudio tem ${spokenDuration(duration)}. Para dividi-lo em partes, o navegador abre o áudio inteiro na memória, e neste dispositivo isso é seguro até cerca de ${spokenDuration(limit)}. Você pode colar uma transcrição feita em outro lugar.`,
    };
  return { ok: true, duration, parts: planParts(duration).length };
}

/**
 * Transcribes a lesson. Files over the 24 MB upload limit are decoded to 16 kHz mono and sent as
 * ~10-minute WAV parts, one at a time, with timestamps offset to the whole recording.
 */
async function transcribeAudio(
  asset: Asset,
  signal: AbortSignal,
  onProgress: (text: string) => void,
  knownDuration?: number,
) {
  const send = async (file: Blob, name: string) => {
    for (let attempt = 0; ; attempt++) {
      const form = new FormData();
      form.append('audio', file, name);
      try {
        return (await aiFetch('/api/transcribe', { method: 'POST', body: form, signal })) as {
          text?: string;
          segments?: { start: number; text: string }[];
        };
      } catch (err) {
        if (!(err instanceof AiError) || err.status !== 429 || attempt >= 3) throw err;
        const wait = Math.min(60, err.retryAfter ?? 15);
        onProgress(`O serviço pediu uma pausa. Tentando de novo em ${wait} s…`);
        await pause(wait * 1000, signal);
      }
    }
  };
  if (asset.size <= MAX_UPLOAD_BYTES) {
    onProgress('Enviando o áudio…');
    const data = await send(asset.blob, asset.name);
    return transcriptFromParts([{ offset: 0, text: data.text ?? '', segments: data.segments ?? [] }]);
  }
  onProgress('Medindo o áudio…');
  const check = await checkSplit(asset.blob, knownDuration);
  if (!check.ok) throw new Error(check.message);
  if (signal.aborted) throw cancelled();
  onProgress('Preparando o áudio em partes…');
  const decoded = await decodeForTranscription(asset.blob);
  const plan = planParts(decoded.duration, decoded.sampleRate),
    parts: TranscriptPart[] = [],
    base = asset.name.replace(/\.[^.]+$/, '');
  try {
    for (const [i, part] of plan.entries()) {
      if (signal.aborted) throw cancelled();
      onProgress(`Transcrevendo parte ${i + 1} de ${plan.length}…`);
      const file = wavPart(
        decoded.samples,
        decoded.sampleRate,
        part.start,
        part.end,
        `${base}-parte-${i + 1}.wav`,
      );
      const data = await send(file, file.name);
      parts.push({ offset: part.start, text: data.text ?? '', segments: data.segments ?? [] });
    }
  } catch (err) {
    if (!parts.length) throw err;
    const stop = plan[parts.length].start;
    throw new PartialTranscript(
      `${transcriptFromParts(parts)}\n[${clock(stop)}] (transcrição interrompida aqui)`,
      parts.length,
      plan.length,
      err,
    );
  }
  return transcriptFromParts(parts);
}

export interface TranscriptionJob {
  progress: string;
  controller: AbortController;
}
const jobs = new Map<string, TranscriptionJob>(),
  listeners = new Set<() => void>();
let snapshot: ReadonlyMap<string, TranscriptionJob> = new Map();
const keepOpen = (e: BeforeUnloadEvent) => e.preventDefault();
function emit() {
  snapshot = new Map(jobs);
  // Closing or reloading the tab would lose the work already paid for; in-app navigation does not.
  if (jobs.size) window.addEventListener('beforeunload', keepOpen);
  else window.removeEventListener('beforeunload', keepOpen);
  listeners.forEach(listener => listener());
}
function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
/** The lesson's running transcription, if any (it keeps running when the lesson screen is left). */
export function useTranscription(lessonId: string) {
  return useSyncExternalStore(
    subscribe,
    () => snapshot,
    () => snapshot,
  ).get(lessonId);
}
export function cancelTranscription(lessonId: string) {
  jobs.get(lessonId)?.controller.abort();
}
/**
 * Transcribes the lesson's audio and saves the text (or, for a split that stopped, the parts already done)
 * to the lesson. It does not depend on the screen: leaving the lesson lets it finish, and only
 * cancelTranscription stops it. One job per lesson.
 */
export async function runTranscription(lessonId: string, asset: Asset, knownDuration?: number) {
  if (jobs.has(lessonId)) throw new Error('A transcrição desta aula já está em andamento.');
  const controller = new AbortController();
  jobs.set(lessonId, { progress: '', controller });
  emit();
  const save = (transcript: string) => db.lessons.update(lessonId, { transcript });
  try {
    await save(
      await transcribeAudio(
        asset,
        controller.signal,
        progress => {
          if (!jobs.has(lessonId)) return;
          jobs.set(lessonId, { progress, controller });
          emit();
        },
        knownDuration,
      ),
    );
  } catch (err) {
    if (err instanceof PartialTranscript) await save(err.text).catch(() => {});
    throw err;
  } finally {
    jobs.delete(lessonId);
    emit();
  }
}
