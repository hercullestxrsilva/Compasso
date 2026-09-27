import { describe, expect, it } from 'vitest';
import {
  audioLevel,
  captureConstraints,
  captureTitle,
  encodeWav,
  LESSON_BITS_PER_SECOND,
  maxSplitSeconds,
  meterLevel,
  microphoneError,
  planParts,
  readAudioFormat,
  recorderOptions,
  recordingExtension,
  recordingHealthMessage,
  spokenDuration,
  transcriptFromParts,
  wavPart,
} from '../src/audio/recording';

describe('capture settings', () => {
  it('turns voice-call processing off for music and keeps it for voice', () => {
    expect(captureConstraints('music')).toEqual({
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
      channelCount: { ideal: 1 },
    });
    expect(captureConstraints('voice', 'mic-2')).toEqual({
      deviceId: { exact: 'mic-2' },
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
      channelCount: { ideal: 1 },
    });
  });
  it('leaves out constraints the browser says it does not support', () => {
    expect(captureConstraints('music', '', { deviceId: true, echoCancellation: true })).toEqual({
      echoCancellation: false,
    });
    expect(captureConstraints('music', '', { channelCount: true })).toEqual({ channelCount: { ideal: 1 } });
  });
  it('picks the first supported container and a higher bitrate for music', () => {
    expect(recorderOptions('music', t => t.startsWith('audio/webm'))).toEqual({
      mimeType: 'audio/webm;codecs=opus',
      audioBitsPerSecond: 128000,
    });
    expect(recorderOptions('voice', () => false)).toEqual({ audioBitsPerSecond: 64000 });
    // Lessons: a 50-minute recording at this rate still fits one 24 MB transcription upload.
    expect(recorderOptions('music', () => false, LESSON_BITS_PER_SECOND)).toEqual({
      audioBitsPerSecond: 64000,
    });
    expect((LESSON_BITS_PER_SECOND / 8) * 50 * 60).toBeLessThan(24 * 1024 * 1024);
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
  });
  it('limits splitting by the memory the decode needs on each kind of device', () => {
    const chrome = { webkit: false, touch: false },
      ipad = { webkit: true, touch: true };
    const lesson = { bytes: 30 * 1024 * 1024, channels: 1, sampleRate: 48000 };
    // Chromium holds the 48 kHz decode and the 16 kHz copy: about 65 min of mono fit in 1 GB.
    expect(maxSplitSeconds(lesson, chrome) / 60).toBeGreaterThan(60);
    expect(maxSplitSeconds(lesson, chrome) / 60).toBeLessThan(70);
    // Unknown channels count as stereo, which halves the limit.
    expect(maxSplitSeconds({ bytes: lesson.bytes }, chrome)).toBeLessThan(
      maxSplitSeconds(lesson, chrome) / 1.9,
    );
    // WebKit resamples while decoding, so an hour-long stereo lesson still fits the iPad budget.
    expect(maxSplitSeconds({ bytes: lesson.bytes }, ipad) / 60).toBeGreaterThan(60);
    expect(maxSplitSeconds(lesson, ipad)).toBeLessThanOrEqual(150 * 60);
    // Devices that report little memory get less.
    expect(maxSplitSeconds(lesson, { ...chrome, deviceMemory: 2 })).toBeLessThan(
      maxSplitSeconds(lesson, chrome) / 3,
    );
    expect(maxSplitSeconds({ bytes: 2000 * 1024 * 1024 }, chrome)).toBe(0);
  });
  it('says how long an audio is without looking like a time of day', () => {
    expect(spokenDuration(52.4)).toBe('52 s');
    expect(spokenDuration(45 * 60)).toBe('45 min');
    expect(spokenDuration(62 * 60 + 10)).toBe('1 h 02 min');
    expect(spokenDuration(120 * 60)).toBe('2 h');
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

describe('reading the audio format from the file header', () => {
  const bytes = (...parts: (string | number[])[]) =>
    new Uint8Array(parts.flatMap(p => (typeof p === 'string' ? [...p].map(c => c.charCodeAt(0)) : p)));
  const u16 = (n: number) => [n >> 8, n & 0xff];
  const u32 = (n: number) => [n >>> 24, (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
  it('reads WAV, Ogg Opus and FLAC headers', async () => {
    const left = new Float32Array(8),
      audio = {
        length: 8,
        numberOfChannels: 2,
        sampleRate: 22050,
        getChannelData: () => left,
      } as AudioBuffer;
    const wav = new Uint8Array(await encodeWav(audio).blob.arrayBuffer());
    expect(readAudioFormat(wav)).toEqual({ channels: 2, sampleRate: 22050 });
    const opus = bytes('OggS', Array(24).fill(0), 'OpusHead', [1, 1, 0x38, 0x01, 0x80, 0x3e, 0, 0]);
    expect(readAudioFormat(opus)).toEqual({ channels: 1, sampleRate: 48000 });
    const flac = bytes('fLaC', [0, 0, 0, 34], Array(10).fill(0), [0x0a, 0xc4, 0x42, 0xf0]);
    expect(readAudioFormat(flac)).toEqual({ channels: 2, sampleRate: 44100 });
  });
  it('finds the Audio element of a WebM recording, skipping look-alike bytes', () => {
    const rate = new Uint8Array(new Float32Array([48000]).buffer).reverse();
    const webm = bytes(
      [0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81, 0x01],
      [0xe1, 0x85, 0x00, 0x00, 0x00, 0x00, 0x00],
      [0xe1, 0x8d, 0xb5, 0x84, ...rate, 0x9f, 0x81, 0x01, 0x62, 0x64, 0x81, 0x20],
    );
    expect(readAudioFormat(webm)).toEqual({ channels: 1, sampleRate: 48000 });
  });
  it('reads an MP4 sample entry, also when the index is at the end of the file', () => {
    const entry = [...u32(0x40), ...bytes('mp4a'), ...Array(6).fill(0), ...u16(1), ...Array(8).fill(0)];
    const format = [...u16(1), ...u16(16), 0, 0, 0, 0, ...u16(44100), 0, 0];
    const head = bytes([...u32(0x18)], 'ftypM4A ', Array(12).fill(0), [...u32(8)], 'mdat');
    expect(readAudioFormat(head)).toBeNull();
    expect(readAudioFormat(head, bytes([...u32(16)], 'moov', entry, format))).toEqual({
      channels: 1,
      sampleRate: 44100,
    });
  });
  it('reads the first MP3 frame after an ID3 tag and gives up on unknown formats', () => {
    const mp3 = bytes('ID3', [3, 0, 0, 0, 0, 0, 10], Array(10).fill(0), [0xff, 0xfb, 0x90, 0xc4]);
    expect(readAudioFormat(mp3)).toEqual({ channels: 1, sampleRate: 44100 });
    expect(readAudioFormat(bytes('not audio at all'))).toBeNull();
  });
});

describe('microphone errors', () => {
  const failure = (name: string, message = 'Permission denied') =>
    Object.assign(new Error(message), { name });

  it('explains a refused or missing microphone in Portuguese and offers the import', () => {
    for (const name of ['NotAllowedError', 'SecurityError']) {
      const text = microphoneError(failure(name));
      expect(text).toMatch(/^O acesso ao microfone não foi permitido\./);
      expect(text).toContain('Ajustes › Safari › Microfone');
      expect(text).toContain('importar um arquivo de áudio');
    }
    for (const name of ['NotFoundError', 'OverconstrainedError'])
      expect(microphoneError(failure(name, 'Requested device not found'))).toMatch(
        /^Nenhum microfone foi encontrado\..*importar um arquivo de áudio\.$/,
      );
    expect(microphoneError(failure('NotReadableError', 'Could not start audio source'))).toMatch(
      /outro aplicativo pode estar usando-o/,
    );
  });

  it('leaves other errors to their own message', () => {
    expect(microphoneError(new Error('Sem espaço'))).toBeNull();
    expect(microphoneError(failure('QuotaExceededError'))).toBeNull();
    expect(microphoneError(null)).toBeNull();
    expect(microphoneError('NotAllowedError')).toBeNull();
  });
});
