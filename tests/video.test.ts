import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import {
  cameraError,
  videoConstraints,
  videoExtension,
  videoFileName,
  videoRecorderOptions,
} from '../src/video/recording';

describe('video recording', () => {
  it('prefers MP4 and falls back to WebM, at a bitrate for the quality', () => {
    const chrome = (t: string) => t.startsWith('video/webm');
    expect(videoRecorderOptions(chrome, '720')).toMatchObject({
      mimeType: 'video/webm;codecs=vp9,opus',
      videoBitsPerSecond: 2_500_000,
    });
    expect(videoRecorderOptions(() => true, '1080')).toMatchObject({
      mimeType: 'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
      videoBitsPerSecond: 5_000_000,
    });
    expect(videoRecorderOptions(() => false, '720').mimeType).toBeUndefined();
    expect(videoExtension('video/mp4;codecs=avc1')).toBe('mp4');
    expect(videoExtension('video/webm')).toBe('webm');
  });
  it('asks the chosen camera for the resolution of the quality', () => {
    expect(videoConstraints('cam-2', '1080')).toMatchObject({
      deviceId: { exact: 'cam-2' },
      width: { ideal: 1920 },
      height: { ideal: 1080 },
    });
    expect(videoConstraints('', '720').deviceId).toBeUndefined();
  });
  it('names files so they sort by date and are valid on every system', () => {
    const at = new Date(2026, 8, 28, 14, 5);
    expect(videoFileName('Entrada: mão esquerda / c. 1–4', 'video/mp4', at)).toBe(
      'Compasso - Entrada- mão esquerda - c. 1–4 - 2026-09-28 14h05.mp4',
    );
    expect(videoFileName('  ', 'video/webm', at)).toBe('Compasso - Prática - 2026-09-28 14h05.webm');
  });
  it('explains camera problems in Portuguese', () => {
    expect(cameraError({ name: 'NotAllowedError' })).toMatch(/não foi permitido/);
    expect(cameraError({ name: 'NotReadableError' })).toMatch(/outro aplicativo/);
    expect(cameraError(new Error('x'))).toBe('Não foi possível abrir a câmera.');
  });
});
