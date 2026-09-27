import { clock } from '../domain';

const MAX_WAV_BYTES = 100 * 1024 * 1024;

export type CaptureProfile = 'music' | 'voice';

/**
 * Microphone constraints. Browsers default to voice-call processing (echo cancellation, noise suppression,
 * automatic gain), which gates piano sustain and flattens dynamics, so 'music' turns it off.
 * Unsupported keys are left out when the browser lists what it supports.
 */
export function captureConstraints(
  profile: CaptureProfile,
  deviceId = '',
  supported: MediaTrackSupportedConstraints = {},
): MediaTrackConstraints {
  const processing = profile === 'voice';
  const listed = Object.keys(supported).length > 0;
  const constraints: MediaTrackConstraints = deviceId ? { deviceId: { exact: deviceId } } : {};
  for (const key of ['echoCancellation', 'noiseSuppression', 'autoGainControl'] as const)
    if (!listed || supported[key]) constraints[key] = processing;
  return constraints;
}

const recordingTypes = ['audio/ogg;codecs=opus', 'audio/mp4', 'audio/webm;codecs=opus', 'audio/webm'];
/** MediaRecorder options: the first supported container, with a higher bitrate for music. */
export function recorderOptions(profile: CaptureProfile, isSupported: (type: string) => boolean) {
  const mimeType = recordingTypes.find(isSupported);
  return {
    ...(mimeType ? { mimeType } : {}),
    audioBitsPerSecond: profile === 'music' ? 128000 : 64000,
  } satisfies MediaRecorderOptions;
}

/** Level meter position (0–1) on a decibel scale, so quiet unprocessed input still moves the bar. */
export function meterLevel(rms: number) {
  if (!(rms > 0)) return 0;
  return Math.min(1, Math.max(0, (20 * Math.log10(rms) + 60) / 54));
}

/** "Gravação 26-09-2026 14h03" — safe as a file name on every system. */
export function captureTitle(date: Date) {
  const two = (n: number) => String(n).padStart(2, '0');
  return `Gravação ${two(date.getDate())}-${two(date.getMonth() + 1)}-${date.getFullYear()} ${two(date.getHours())}h${two(date.getMinutes())}`;
}

export function recordingExtension(mime: string) {
  if (mime.includes('ogg')) return 'ogg';
  if (mime.includes('mp4')) return 'm4a';
  if (mime.includes('wav')) return 'wav';
  return 'webm';
}

export function audioLevel(samples: Float32Array) {
  if (!samples.length) return 0;
  let power = 0;
  for (const sample of samples) power += sample * sample;
  return Math.sqrt(power / samples.length);
}

export function encodeWav(buffer: AudioBuffer) {
  const { length, numberOfChannels, sampleRate } = buffer;
  const channels = Math.min(2, numberOfChannels);
  const size = 44 + length * channels * 2;
  if (!length || !channels || size > MAX_WAV_BYTES)
    throw new Error(
      `O áudio é longo demais para criar uma cópia WAV (máximo de ${Math.floor((MAX_WAV_BYTES - 44) / (sampleRate * channels * 2 * 60))} min). O original foi preservado.`,
    );
  const bytes = new ArrayBuffer(size),
    view = new DataView(bytes);
  const ascii = (at: number, value: string) => {
    for (let i = 0; i < value.length; i++) view.setUint8(at + i, value.charCodeAt(i));
  };
  ascii(0, 'RIFF');
  view.setUint32(4, size - 8, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * channels * 2, true);
  view.setUint16(32, channels * 2, true);
  view.setUint16(34, 16, true);
  ascii(36, 'data');
  view.setUint32(40, length * channels * 2, true);
  const data = Array.from({ length: channels }, (_, i) => buffer.getChannelData(i));
  let power = 0,
    peak = 0;
  for (let i = 0; i < length; i++) {
    for (let channel = 0; channel < channels; channel++) {
      const sample = Math.max(-1, Math.min(1, data[channel][i]));
      power += sample * sample;
      peak = Math.max(peak, Math.abs(sample));
      view.setInt16(
        44 + (i * channels + channel) * 2,
        sample < 0 ? Math.round(sample * 32768) : Math.round(sample * 32767),
        true,
      );
    }
  }
  return {
    blob: new Blob([bytes], { type: 'audio/wav' }),
    duration: length / sampleRate,
    rms: Math.sqrt(power / (length * channels)),
    peak,
  };
}

export async function makePlayableCopy(blob: Blob, name: string) {
  const context = new AudioContext();
  try {
    const decoded = await context.decodeAudioData(await blob.arrayBuffer());
    const result = encodeWav(decoded);
    if (result.duration < 0.25)
      throw new Error('O arquivo contém menos de um quarto de segundo de áudio. O original foi preservado.');
    return {
      ...result,
      file: new File([result.blob], `${name.replace(/\.[^.]+$/, '')}-reparado.wav`, { type: 'audio/wav' }),
    };
  } catch (error) {
    if (error instanceof Error && /preservado|cópia WAV/.test(error.message)) throw error;
    throw new Error('O navegador não conseguiu decodificar a gravação. O arquivo original foi preservado.', {
      cause: error,
    });
  } finally {
    await context.close().catch(() => {});
  }
}

export function recordingHealthMessage(duration: number, rms: number) {
  if (rms < 0.0001)
    return `O arquivo tem ${clock(duration)} de áudio, mas não contém sinal audível. A cópia reparada não foi criada; verifique a entrada do microfone antes de uma nova gravação.`;
  return '';
}

/** Whisper resamples to 16 kHz anyway; mono 16-bit WAV at this rate is under 2 MB per minute. */
export const TRANSCRIPTION_RATE = 16000;
const PART_BYTES = 20 * 1024 * 1024;

/**
 * Longest audio that is split in the browser: the whole file is decoded in memory first
 * (about 64 KB per second at 16 kHz, more while the browser decodes), so tablets get a lower limit.
 */
export function maxSplitSeconds(touch: boolean) {
  return (touch ? 45 : 90) * 60;
}

/** Parts that fit the 24 MB upload limit as WAV; a last sliver under 30 s joins the previous part. */
export function planParts(duration: number, sampleRate = TRANSCRIPTION_RATE) {
  const size = Math.floor(PART_BYTES / (sampleRate * 2));
  const parts: { start: number; end: number }[] = [];
  for (let start = 0; start < duration; start += size)
    parts.push({ start, end: Math.min(duration, start + size) });
  const last = parts.at(-1);
  if (parts.length > 1 && last && last.end - last.start < 30) {
    parts.pop();
    parts[parts.length - 1].end = last.end;
  }
  return parts;
}

export interface TranscriptPart {
  /** Where this part starts in the full recording, in seconds. */
  offset: number;
  text: string;
  segments: { start: number; text: string }[];
}
/** Joins transcribed parts into "[m:ss] text" lines with times relative to the whole recording. */
export function transcriptFromParts(parts: TranscriptPart[]) {
  return parts
    .flatMap(part => {
      if (part.segments.length)
        return part.segments.map(s => `[${clock(part.offset + s.start)}] ${s.text.trim()}`);
      const text = part.text.trim();
      if (!text) return [];
      return [parts.length > 1 ? `[${clock(part.offset)}] ${text}` : text];
    })
    .join('\n');
}

/** A mono 16-bit WAV file with the samples between `start` and `end` seconds. */
export function wavPart(samples: Float32Array, sampleRate: number, start: number, end: number, name: string) {
  const view = samples.subarray(Math.floor(start * sampleRate), Math.floor(end * sampleRate));
  const { blob } = encodeWav({
    length: view.length,
    numberOfChannels: 1,
    sampleRate,
    getChannelData: () => view,
  } as unknown as AudioBuffer);
  return new File([blob], name, { type: 'audio/wav' });
}

/** Duration in seconds, or NaN. Recordings without it in the header (Chrome's WebM) are measured by seeking. */
export function probeDuration(blob: Blob) {
  return new Promise<number>(resolve => {
    const audio = document.createElement('audio'),
      url = URL.createObjectURL(blob);
    let settled = false;
    const finish = (value: number) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      audio.removeAttribute('src');
      audio.load();
      URL.revokeObjectURL(url);
      resolve(value);
    };
    const timer = window.setTimeout(() => finish(NaN), 15000);
    audio.preload = 'metadata';
    audio.onerror = () => finish(NaN);
    audio.ondurationchange = () => {
      if (Number.isFinite(audio.duration) && audio.duration > 0) finish(audio.duration);
    };
    audio.onloadedmetadata = () => {
      if (Number.isFinite(audio.duration)) finish(audio.duration);
      else audio.currentTime = Number.MAX_SAFE_INTEGER;
    };
    audio.src = url;
  });
}

/** Decodes to mono samples at 16 kHz (the browser resamples while decoding). */
export async function decodeForTranscription(blob: Blob) {
  let decoded: AudioBuffer;
  try {
    const context = new OfflineAudioContext(1, 1, TRANSCRIPTION_RATE);
    decoded = await context.decodeAudioData(await blob.arrayBuffer());
  } catch (error) {
    throw new Error(
      'O navegador não conseguiu preparar este áudio em partes. Importe um trecho menor ou cole a transcrição.',
      { cause: error },
    );
  }
  // Mix into the first channel in place instead of allocating another buffer.
  const mono = decoded.getChannelData(0),
    channels = decoded.numberOfChannels;
  if (channels > 1) {
    for (let c = 1; c < channels; c++) {
      const other = decoded.getChannelData(c);
      for (let i = 0; i < mono.length; i++) mono[i] += other[i];
    }
    for (let i = 0; i < mono.length; i++) mono[i] /= channels;
  }
  return { samples: mono, sampleRate: decoded.sampleRate, duration: decoded.duration };
}
