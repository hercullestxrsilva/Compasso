import { clock } from '../domain';

const MAX_WAV_BYTES = 100 * 1024 * 1024;

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
  if (!length || !channels || size > MAX_WAV_BYTES) throw new Error(`O áudio é longo demais para criar uma cópia WAV (máximo de ${Math.floor((MAX_WAV_BYTES - 44) / (sampleRate * channels * 2 * 60))} min). O original foi preservado.`);
  const bytes = new ArrayBuffer(size), view = new DataView(bytes);
  const ascii = (at: number, value: string) => { for (let i = 0; i < value.length; i++) view.setUint8(at + i, value.charCodeAt(i)); };
  ascii(0, 'RIFF'); view.setUint32(4, size - 8, true); ascii(8, 'WAVE');
  ascii(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true);
  view.setUint16(22, channels, true); view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * channels * 2, true); view.setUint16(32, channels * 2, true); view.setUint16(34, 16, true);
  ascii(36, 'data'); view.setUint32(40, length * channels * 2, true);
  const data = Array.from({ length: channels }, (_, i) => buffer.getChannelData(i));
  let power = 0, peak = 0;
  for (let i = 0; i < length; i++) {
    for (let channel = 0; channel < channels; channel++) {
      const sample = Math.max(-1, Math.min(1, data[channel][i]));
      power += sample * sample; peak = Math.max(peak, Math.abs(sample));
      view.setInt16(44 + (i * channels + channel) * 2, sample < 0 ? Math.round(sample * 32768) : Math.round(sample * 32767), true);
    }
  }
  return { blob: new Blob([bytes], { type: 'audio/wav' }), duration: length / sampleRate, rms: Math.sqrt(power / (length * channels)), peak };
}

export async function makePlayableCopy(blob: Blob, name: string) {
  const context = new AudioContext();
  try {
    const decoded = await context.decodeAudioData(await blob.arrayBuffer());
    const result = encodeWav(decoded);
    if (result.duration < 0.25) throw new Error('O arquivo contém menos de um quarto de segundo de áudio. O original foi preservado.');
    return { ...result, file: new File([result.blob], `${name.replace(/\.[^.]+$/, '')}-reparado.wav`, { type: 'audio/wav' }) };
  } catch (error) {
    if (error instanceof Error && /preservado|cópia WAV/.test(error.message)) throw error;
    throw new Error('O navegador não conseguiu decodificar a gravação. O arquivo original foi preservado.');
  } finally { await context.close().catch(() => {}); }
}

export function recordingHealthMessage(duration: number, rms: number) {
  if (rms < 0.0001) return `O arquivo tem ${clock(duration)} de áudio, mas não contém sinal audível. A cópia reparada não foi criada; verifique a entrada do microfone antes de uma nova gravação.`;
  return '';
}
