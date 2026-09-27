import { clock } from '../domain';

const MAX_WAV_BYTES = 100 * 1024 * 1024;

export type CaptureProfile = 'music' | 'voice';

/**
 * Microphone constraints. Browsers default to voice-call processing (echo cancellation, noise suppression,
 * automatic gain), which gates piano sustain and flattens dynamics, so 'music' turns it off.
 * Mono is preferred: with processing off, Chrome may record a stereo interface in stereo, which doubles
 * the file size and the memory needed to transcribe it.
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
  if (!listed || supported.channelCount) constraints.channelCount = { ideal: 1 };
  return constraints;
}

/**
 * Lesson recordings: mono at 64 kbps is plenty for the teacher's voice and the piano, and keeps lessons
 * of up to about 50 minutes under the 24 MB transcription upload limit, so they need no splitting.
 */
export const LESSON_BITS_PER_SECOND = 64000;
const recordingTypes = ['audio/ogg;codecs=opus', 'audio/mp4', 'audio/webm;codecs=opus', 'audio/webm'];
/** MediaRecorder options: the first supported container, with a higher default bitrate for music. */
export function recorderOptions(
  profile: CaptureProfile,
  isSupported: (type: string) => boolean,
  bitsPerSecond?: number,
) {
  const mimeType = recordingTypes.find(isSupported);
  return {
    ...(mimeType ? { mimeType } : {}),
    audioBitsPerSecond: bitsPerSecond ?? (profile === 'music' ? 128000 : 64000),
  } satisfies MediaRecorderOptions;
}

const IMPORT_INSTEAD = 'Você também pode importar um arquivo de áudio.';
/**
 * The microphone could not be opened: what happened and what to do, in Portuguese. Browsers report it in
 * English ("Permission denied"). Null for other errors, which keep their own message.
 */
export function microphoneError(error: unknown): string | null {
  switch ((error as { name?: unknown } | null)?.name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return `O acesso ao microfone não foi permitido. Libere o microfone para este site nas configurações do navegador (no iPad: Ajustes › Safari › Microfone) e tente de novo. ${IMPORT_INSTEAD}`;
    case 'NotFoundError':
    case 'OverconstrainedError':
      return `Nenhum microfone foi encontrado. Conecte um microfone e tente de novo. ${IMPORT_INSTEAD}`;
    case 'NotReadableError':
    case 'AbortError':
      return `O microfone não pôde ser aberto: outro aplicativo pode estar usando-o. Feche-o e tente de novo. ${IMPORT_INSTEAD}`;
    default:
      return null;
  }
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
const MB = 1024 * 1024;

export interface SplitDevice {
  /** Safari and every iOS browser: WebKit resamples while decoding, so it only holds the 16 kHz copy. */
  webkit: boolean;
  touch: boolean;
  /** navigator.deviceMemory in GB, where the browser reports it. */
  deviceMemory?: number;
}
/** Memory the split may use at its peak: less on tablets and on devices that report little memory. */
export function splitBudget({ touch, deviceMemory }: SplitDevice) {
  const budget = (touch ? 500 : 1000) * MB;
  return deviceMemory ? Math.min(budget, deviceMemory * 125 * MB) : budget;
}
/**
 * Longest audio that can be split in the browser, which decodes the whole file into memory first.
 * Chromium and Firefox decode at the file's own rate and channel count (assumed 48 kHz stereo when the
 * header could not be read) before resampling to 16 kHz, and the compressed file is held in memory too.
 */
export function maxSplitSeconds(
  file: { bytes: number; channels?: number; sampleRate?: number },
  device: SplitDevice,
) {
  const channels = Math.min(8, Math.max(1, file.channels ?? 2));
  const native = device.webkit ? 0 : Math.max(TRANSCRIPTION_RATE, file.sampleRate ?? 48000);
  const perSecond = channels * 4 * (TRANSCRIPTION_RATE + native);
  return Math.min(150 * 60, Math.max(0, (splitBudget(device) - file.bytes) / perSecond));
}

/** "52 s", "45 min", "1 h 02 min": reads as a length, not as a time of day. */
export function spokenDuration(seconds: number) {
  if (seconds < 60) return `${Math.max(0, Math.round(seconds))} s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = `${Math.floor(minutes / 60)} h`;
  return minutes % 60 ? `${hours} ${String(minutes % 60).padStart(2, '0')} min` : hours;
}

type AudioFormat = { channels: number; sampleRate?: number };
const ascii = (bytes: Uint8Array, at: number, length: number) =>
  at >= 0 && at + length <= bytes.length ? String.fromCharCode(...bytes.subarray(at, at + length)) : '';
function findText(bytes: Uint8Array, signature: string, from = 0) {
  for (
    let i = bytes.indexOf(signature.charCodeAt(0), from);
    i >= 0;
    i = bytes.indexOf(signature.charCodeAt(0), i + 1)
  )
    if (ascii(bytes, i, signature.length) === signature) return i;
  return -1;
}
const plausible = (format: AudioFormat) => (format.channels >= 1 && format.channels <= 8 ? format : null);
/** The 'mp4a' sample entry: channel count and the integer part of the 16.16 sample rate. */
function readMp4(bytes: Uint8Array): AudioFormat | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let at = findText(bytes, 'mp4a'); at >= 4; at = findText(bytes, 'mp4a', at + 1))
    if (view.getUint32(at - 4) >= 36 && at + 30 <= bytes.length)
      return plausible({
        channels: view.getUint16(at + 20),
        sampleRate: view.getUint16(at + 28) || undefined,
      });
  return null;
}
/** Reads an EBML variable-length integer; `marker` keeps the length bits (element IDs). */
function readVint(bytes: Uint8Array, at: number, marker: boolean) {
  const first = bytes[at];
  if (!first) return null;
  const length = Math.clz32(first) - 23;
  if (length > 8 || at + length > bytes.length) return null;
  let value = marker ? first : first & (0xff >> length);
  for (let i = 1; i < length; i++) value = value * 256 + bytes[at + i];
  return { value, length };
}
/** The WebM/Matroska Audio element (0xE1): Channels (0x9F) and SamplingFrequency (0xB5). */
function readWebm(bytes: Uint8Array): AudioFormat | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let at = bytes.indexOf(0xe1); at >= 0; at = bytes.indexOf(0xe1, at + 1)) {
    const size = readVint(bytes, at + 1, false);
    if (!size || size.value > 64) continue;
    const end = at + 1 + size.length + size.value;
    let channels: number | undefined,
      sampleRate: number | undefined,
      i = at + 1 + size.length;
    while (i < end && end <= bytes.length) {
      const id = readVint(bytes, i, true),
        length = id && readVint(bytes, i + id.length, false);
      if (!id || !length) break;
      const data = i + id.length + length.length;
      if (id.value === 0x9f && length.value === 1) channels = bytes[data];
      if (id.value === 0xb5 && length.value === 4) sampleRate = view.getFloat32(data);
      if (id.value === 0xb5 && length.value === 8) sampleRate = view.getFloat64(data);
      i = data + length.value;
    }
    if (i === end && (channels || sampleRate))
      return plausible({ channels: channels ?? 1, sampleRate: sampleRate && Math.round(sampleRate) });
  }
  return null;
}
/** The first MPEG audio frame header after an optional ID3v2 tag. */
function readMp3(bytes: Uint8Array): AudioFormat | null {
  let at = 0;
  if (ascii(bytes, 0, 3) === 'ID3' && bytes.length > 10)
    at = 10 + ((bytes[6] << 21) | (bytes[7] << 14) | (bytes[8] << 7) | bytes[9]);
  const rates: Record<number, number[]> = {
    3: [44100, 48000, 32000],
    2: [22050, 24000, 16000],
    0: [11025, 12000, 8000],
  };
  for (const limit = at + 64 * 1024; at + 4 <= bytes.length && at < limit; at++) {
    if (bytes[at] !== 0xff || (bytes[at + 1] & 0xe0) !== 0xe0) continue;
    const version = (bytes[at + 1] >> 3) & 3,
      layer = (bytes[at + 1] >> 1) & 3,
      bitrate = bytes[at + 2] >> 4,
      rate = (bytes[at + 2] >> 2) & 3;
    if (version === 1 || !layer || !bitrate || bitrate === 15 || rate === 3) continue;
    return { channels: bytes[at + 3] >> 6 === 3 ? 1 : 2, sampleRate: rates[version][rate] };
  }
  return null;
}
/**
 * Channel count and sample rate from the first bytes of a WAV, Ogg (Opus/Vorbis), WebM, MP4/M4A or MP3
 * file. MP4 files may keep their index at the end, so `tail` (the last bytes) is searched too.
 * Returns null when the format is not recognised.
 */
export function readAudioFormat(head: Uint8Array, tail?: Uint8Array): AudioFormat | null {
  const view = new DataView(head.buffer, head.byteOffset, head.byteLength);
  if (ascii(head, 0, 4) === 'RIFF' && ascii(head, 8, 4) === 'WAVE') {
    const fmt = findText(head, 'fmt ', 12);
    if (fmt < 0 || fmt + 16 > head.length) return null;
    return plausible({
      channels: view.getUint16(fmt + 10, true),
      sampleRate: view.getUint32(fmt + 12, true),
    });
  }
  if (ascii(head, 0, 4) === 'OggS') {
    const opus = findText(head, 'OpusHead');
    // Opus always decodes at 48 kHz, whatever input rate the header mentions.
    if (opus >= 0 && opus + 10 <= head.length)
      return plausible({ channels: head[opus + 9], sampleRate: 48000 });
    const vorbis = findText(head, '\x01vorbis');
    if (vorbis >= 0 && vorbis + 16 <= head.length)
      return plausible({ channels: head[vorbis + 11], sampleRate: view.getUint32(vorbis + 12, true) });
    return null;
  }
  if (ascii(head, 0, 4) === 'fLaC' && head.length >= 21)
    return plausible({
      channels: ((head[20] >> 1) & 7) + 1,
      sampleRate: (head[18] << 12) | (head[19] << 4) | (head[20] >> 4),
    });
  if (view.byteLength >= 4 && view.getUint32(0) === 0x1a45dfa3) return readWebm(head);
  if (ascii(head, 4, 4) === 'ftyp') return readMp4(head) ?? (tail ? readMp4(tail) : null);
  return readMp3(head);
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

/** Channel count and sample rate read from the file's header, or null. */
export async function probeAudioFormat(blob: Blob) {
  const edge = 256 * 1024;
  try {
    const head = new Uint8Array(await blob.slice(0, edge).arrayBuffer());
    const tail = blob.size > edge ? new Uint8Array(await blob.slice(-edge).arrayBuffer()) : undefined;
    return readAudioFormat(head, tail);
  } catch {
    return null;
  }
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
    // iOS may ignore `preload` on an element that is not in the page; an explicit load() asks for metadata.
    audio.load();
  });
}

/**
 * Decodes to mono samples at 16 kHz. Peak memory depends on the browser (see maxSplitSeconds), so callers
 * check the duration against that limit first.
 */
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
