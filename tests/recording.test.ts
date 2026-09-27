import { describe, expect, it } from 'vitest';
import { audioLevel, encodeWav, recordingExtension, recordingHealthMessage } from '../src/audio/recording';

describe('recording playback', () => {
  it('uses the extension matching the recorded container', () => {
    expect(recordingExtension('audio/ogg;codecs=opus')).toBe('ogg');
    expect(recordingExtension('audio/mp4')).toBe('m4a');
    expect(recordingExtension('audio/webm;codecs=opus')).toBe('webm');
  });

  it('writes a finite stereo WAV without cancelling one channel', async () => {
    const left = new Float32Array([0, 1, -1, 0]);
    const right = new Float32Array([0, 0, 0, 0]);
    const audio = { length: 4, numberOfChannels: 2, sampleRate: 8000, getChannelData: (i: number) => i ? right : left } as AudioBuffer;
    const result = encodeWav(audio);
    const view = new DataView(await result.blob.arrayBuffer());
    expect(result.duration).toBe(.0005);
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
    expect(audioLevel(new Float32Array([.5, -.5]))).toBe(.5);
    expect(recordingHealthMessage(120, 0)).toContain('não contém sinal audível');
    expect(recordingHealthMessage(120, .05)).toBe('');
  });
});
