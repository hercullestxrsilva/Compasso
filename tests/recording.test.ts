import { describe, expect, it } from 'vitest';
import {
  audioLevel,
  captureConstraints,
  captureTitle,
  encodeWav,
  maxSplitSeconds,
  meterLevel,
  planParts,
  recorderOptions,
  recordingExtension,
  recordingHealthMessage,
  transcriptFromParts,
  wavPart,
} from '../src/audio/recording';

describe('capture settings', () => {
  it('turns voice-call processing off for music and keeps it for voice', () => {
    expect(captureConstraints('music')).toEqual({
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
    });
    expect(captureConstraints('voice', 'mic-2')).toEqual({
      deviceId: { exact: 'mic-2' },
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    });
  });
  it('leaves out constraints the browser says it does not support', () => {
    expect(captureConstraints('music', '', { deviceId: true, echoCancellation: true })).toEqual({
      echoCancellation: false,
    });
  });
  it('picks the first supported container and a higher bitrate for music', () => {
    expect(recorderOptions('music', t => t.startsWith('audio/webm'))).toEqual({
      mimeType: 'audio/webm;codecs=opus',
      audioBitsPerSecond: 128000,
    });
    expect(recorderOptions('voice', () => false)).toEqual({ audioBitsPerSecond: 64000 });
  });
  it('shows quiet input on the level meter and names captures safely', () => {
    expect(meterLevel(0)).toBe(0);
    expect(meterLevel(0.001)).toBe(0);
    expect(meterLevel(0.01)).toBeGreaterThan(0.3);
    expect(meterLevel(1)).toBe(1);
    expect(captureTitle(new Date(2026, 8, 26, 14, 3))).toBe('Gravação 26-09-2026 14h03');
  });
});

describe('split transcription', () => {
  it('plans parts under the upload limit and merges a short tail', () => {
    const parts = planParts(3600);
    expect(parts[0]).toEqual({ start: 0, end: 655 });
    expect(parts.at(-1)!.end).toBe(3600);
    expect(parts.every(p => (p.end - p.start) * 16000 * 2 < 24 * 1024 * 1024)).toBe(true);
    expect(planParts(655 + 10)).toEqual([{ start: 0, end: 665 }]);
    expect(planParts(0)).toEqual([]);
    expect(maxSplitSeconds(true)).toBeLessThan(maxSplitSeconds(false));
  });
  it('offsets part timestamps to the whole recording', () => {
    expect(
      transcriptFromParts([
        { offset: 0, text: '', segments: [{ start: 2, text: ' Olá.' }] },
        { offset: 655, text: '', segments: [{ start: 5, text: ' Mão esquerda.' }] },
      ]),
    ).toBe('[0:02] Olá.\n[11:00] Mão esquerda.');
    expect(
      transcriptFromParts([
        { offset: 0, text: 'Primeira parte', segments: [] },
        { offset: 600, text: ' Segunda ', segments: [] },
      ]),
    ).toBe('[0:00] Primeira parte\n[10:00] Segunda');
    expect(transcriptFromParts([{ offset: 0, text: 'Só texto', segments: [] }])).toBe('Só texto');
  });
  it('writes a mono WAV with only the requested samples', async () => {
    const samples = new Float32Array(3 * 8000).fill(0.5);
    const file = wavPart(samples, 8000, 1, 2, 'parte-2.wav');
    const view = new DataView(await file.arrayBuffer());
    expect(file.name).toBe('parte-2.wav');
    expect(file.size).toBe(44 + 8000 * 2);
    expect(view.getUint16(22, true)).toBe(1);
    expect(view.getUint32(24, true)).toBe(8000);
  });
});

describe('recording playback', () => {
  it('uses the extension matching the recorded container', () => {
    expect(recordingExtension('audio/ogg;codecs=opus')).toBe('ogg');
    expect(recordingExtension('audio/mp4')).toBe('m4a');
    expect(recordingExtension('audio/webm;codecs=opus')).toBe('webm');
  });

  it('writes a finite stereo WAV without cancelling one channel', async () => {
    const left = new Float32Array([0, 1, -1, 0]);
    const right = new Float32Array([0, 0, 0, 0]);
    const audio = {
      length: 4,
      numberOfChannels: 2,
      sampleRate: 8000,
      getChannelData: (i: number) => (i ? right : left),
    } as AudioBuffer;
    const result = encodeWav(audio);
    const view = new DataView(await result.blob.arrayBuffer());
    expect(result.duration).toBe(0.0005);
    expect(result.peak).toBe(1);
    expect(view.getUint32(4, true)).toBe(52);
    expect(view.getUint16(22, true)).toBe(2);
    expect(view.getUint32(24, true)).toBe(8000);
    expect(view.getInt16(48, true)).toBe(32767);
    expect(view.getInt16(50, true)).toBe(0);
    expect(view.getInt16(52, true)).toBe(-32768);
  });

  it('distinguishes silence from a live microphone signal', () => {
    expect(audioLevel(new Float32Array([0, 0, 0]))).toBe(0);
    expect(audioLevel(new Float32Array([0.5, -0.5]))).toBe(0.5);
    expect(recordingHealthMessage(120, 0)).toContain('não contém sinal audível');
    expect(recordingHealthMessage(120, 0.05)).toBe('');
  });
});
